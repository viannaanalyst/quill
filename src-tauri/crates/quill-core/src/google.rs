//! Conversa com o Google: recebe a volta do navegador, troca o código por tokens e usa a API do Gmail.
//! Só existe com o recurso `net`.

use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

use crate::oauth::{self, AuthError};

/// Escopos pedidos: ler/organizar e enviar e-mail, e a agenda.
pub const SCOPES: [&str; 3] = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoginError {
    Denied,
    TimedOut,
    StateMismatch,
    Network(String),
    Google(String),
    /// não conseguiu ler ou gravar no cofre do sistema
    Vault(String),
    /// o acesso expirou ou foi revogado: a conta precisa entrar de novo
    NeedsLogin,
}

impl std::fmt::Display for LoginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoginError::Denied => write!(f, "O acesso não foi autorizado no Google."),
            LoginError::TimedOut => write!(f, "O login demorou demais. Tente de novo."),
            LoginError::StateMismatch => write!(f, "A resposta do login não confere. Tente de novo."),
            LoginError::Network(e) => write!(f, "Sem conexão com o Google: {e}"),
            LoginError::Google(e) => write!(f, "O Google recusou o pedido: {e}"),
            LoginError::Vault(e) => write!(f, "Não consegui usar as Chaves do sistema: {e}"),
            LoginError::NeedsLogin => write!(f, "Essa conta precisa entrar de novo."),
        }
    }
}

const DONE_PAGE: &str = r#"<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Quill</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f1f1f2;color:#1b1c1e}
@media(prefers-color-scheme:dark){body{background:#0b0b0d;color:#f1f1f2}}main{text-align:center}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{margin:0;color:#8f9196}</style></head>
<body><main><h1>Pronto! Sua conta está conectada ao Quill.</h1><p>Pode fechar esta aba e voltar para o app.</p></main></body></html>"#;

const DENIED_PAGE: &str = r#"<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Quill</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f1f1f2;color:#1b1c1e}
@media(prefers-color-scheme:dark){body{background:#0b0b0d;color:#f1f1f2}}main{text-align:center}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{margin:0;color:#8f9196}</style></head>
<body><main><h1>O login no Quill foi cancelado.</h1><p>Feche esta aba e tente de novo pelo app quando quiser.</p></main></body></html>"#;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub email_address: String,
    #[serde(default)]
    pub messages_total: u64,
}

/// Cliente da API do Google (endereços trocáveis para testes).
#[derive(Clone)]
pub struct GoogleClient {
    http: reqwest::Client,
    client_id: String,
    client_secret: String,
    token_url: String,
    api: String,
}

fn net(e: reqwest::Error) -> LoginError {
    LoginError::Network(e.to_string())
}

impl GoogleClient {
    pub fn new(client_id: &str, client_secret: &str) -> Self {
        Self::with_endpoints(client_id, client_secret, oauth::GOOGLE_TOKEN_ENDPOINT, crate::gmail::GMAIL_API)
    }

    pub fn with_endpoints(client_id: &str, client_secret: &str, token_url: &str, api: &str) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Quill/0.1")
            .build()
            .expect("cliente HTTP");
        Self {
            http,
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            token_url: token_url.into(),
            api: api.trim_end_matches('/').into(),
        }
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    async fn token_request(&self, form: String) -> Result<oauth::TokenResponse, LoginError> {
        let body = self
            .http
            .post(&self.token_url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(form)
            .send()
            .await
            .map_err(net)?
            .text()
            .await
            .map_err(net)?;
        oauth::parse_token_response(&body).map_err(|e| LoginError::Google(e.to_string()))
    }

    pub async fn exchange_code(&self, code: &str, verifier: &str, redirect_uri: &str) -> Result<oauth::TokenResponse, LoginError> {
        self.token_request(oauth::code_exchange_form(&self.client_id, &self.client_secret, code, verifier, redirect_uri)).await
    }

    pub async fn refresh(&self, refresh_token: &str) -> Result<oauth::TokenResponse, LoginError> {
        self.token_request(oauth::refresh_form(&self.client_id, &self.client_secret, refresh_token)).await
    }

    async fn get(&self, token: &str, path: &str) -> Result<String, LoginError> {
        let resp = self.http.get(format!("{}{path}", self.api)).bearer_auth(token).send().await.map_err(net)?;
        let status = resp.status();
        let body = resp.text().await.map_err(net)?;
        if !status.is_success() {
            return Err(LoginError::Google(format!("{status}: {body}")));
        }
        Ok(body)
    }

    pub async fn profile(&self, token: &str) -> Result<Profile, LoginError> {
        let body = self.get(token, "/profile").await?;
        serde_json::from_str(&body).map_err(|e| LoginError::Google(e.to_string()))
    }

    /// Últimos e-mails da Entrada, já no formato da lista.
    pub async fn inbox(&self, token: &str, max: u32, now_ms: i64, tz_offset_min: i32) -> Result<Vec<crate::gmail::MessageSummary>, LoginError> {
        let list = self.get(token, &format!("/messages?labelIds=INBOX&maxResults={max}")).await?;
        let ids = crate::gmail::parse_message_list(&list).map_err(LoginError::Google)?;
        let mut out = Vec::with_capacity(ids.len());
        // um pedido por e-mail, em grupos de 10 ao mesmo tempo (limite educado de uso da API)
        for chunk in ids.chunks(10) {
            let mut set = tokio::task::JoinSet::new();
            for (i, id) in chunk.iter().enumerate() {
                let this = self.clone();
                let token = token.to_string();
                let path = format!("/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject");
                set.spawn(async move { (i, this.get(&token, &path).await) });
            }
            let mut got = Vec::new();
            while let Some(res) = set.join_next().await {
                let (i, body) = res.map_err(|e| LoginError::Network(e.to_string()))?;
                got.push((i, crate::gmail::parse_message_metadata(&body?, now_ms, tz_offset_min).map_err(LoginError::Google)?));
            }
            got.sort_by_key(|(i, _)| *i);
            out.extend(got.into_iter().map(|(_, m)| m));
        }
        Ok(out)
    }

    /// Texto do e-mail.
    pub async fn body(&self, token: &str, id: &str) -> Result<String, LoginError> {
        let json = self.get(token, &format!("/messages/{id}?format=full")).await?;
        crate::gmail::extract_body_text(&json).map_err(LoginError::Google)
    }

    /// Marca como lido no Gmail (tira o marcador UNREAD).
    pub async fn mark_read(&self, token: &str, id: &str) -> Result<(), LoginError> {
        let resp = self
            .http
            .post(format!("{}/messages/{id}/modify", self.api))
            .bearer_auth(token)
            .header("Content-Type", "application/json")
            .body(r#"{"removeLabelIds":["UNREAD"]}"#)
            .send()
            .await
            .map_err(net)?;
        if !resp.status().is_success() {
            return Err(LoginError::Google(resp.status().to_string()));
        }
        Ok(())
    }
}

/// Servidor mínimo em 127.0.0.1 (porta livre escolhida pelo sistema) que recebe a volta do navegador.
pub struct Loopback {
    listener: TcpListener,
    port: u16,
}

impl Loopback {
    pub async fn bind() -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let port = listener.local_addr()?.port();
        Ok(Self { listener, port })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Espera o navegador voltar com o código. Pedidos que não são o retorno (favicon) recebem 404.
    pub async fn wait_for_code(self, state: &str, timeout: Duration) -> Result<String, LoginError> {
        tokio::time::timeout(timeout, async {
            loop {
                let (stream, _) = self.listener.accept().await.map_err(|e| LoginError::Network(e.to_string()))?;
                let mut reader = BufReader::new(stream);
                let mut line = String::new();
                if reader.read_line(&mut line).await.is_err() {
                    continue;
                }
                // descarta o resto dos cabeçalhos
                let mut header = String::new();
                while reader.read_line(&mut header).await.map(|n| n > 2).unwrap_or(false) {
                    header.clear();
                }
                let result = oauth::parse_redirect(&line, state);
                let (status, body) = match &result {
                    Ok(_) => ("200 OK", DONE_PAGE),
                    Err(AuthError::Denied) => ("200 OK", DENIED_PAGE),
                    Err(AuthError::StateMismatch) => ("400 Bad Request", DENIED_PAGE),
                    Err(AuthError::InvalidRedirect) => ("404 Not Found", ""),
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let mut stream = reader.into_inner();
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
                match result {
                    Ok(code) => return Ok(code),
                    Err(AuthError::Denied) => return Err(LoginError::Denied),
                    Err(AuthError::StateMismatch) => return Err(LoginError::StateMismatch),
                    Err(AuthError::InvalidRedirect) => continue,
                }
            }
        })
        .await
        .unwrap_or(Err(LoginError::TimedOut))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn browser_hits(port: u16, path: &str) -> String {
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes()).await.unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).await.unwrap();
        buf
    }

    #[tokio::test]
    async fn loopback_ignores_favicon_and_returns_code() {
        let listener = Loopback::bind().await.unwrap();
        let port = listener.port();
        assert!(listener.redirect_uri().starts_with("http://127.0.0.1:"));
        let server = tokio::spawn(async move { listener.wait_for_code("S1", std::time::Duration::from_secs(5)).await });

        let fav = browser_hits(port, "/favicon.ico").await;
        assert!(fav.starts_with("HTTP/1.1 404"));
        let page = browser_hits(port, "/?state=S1&code=abc").await;
        assert!(page.starts_with("HTTP/1.1 200"));
        assert!(page.contains("Quill"));

        assert_eq!(server.await.unwrap(), Ok("abc".to_string()));
    }

    #[tokio::test]
    async fn loopback_reports_cancel() {
        let listener = Loopback::bind().await.unwrap();
        let port = listener.port();
        let server = tokio::spawn(async move { listener.wait_for_code("S1", std::time::Duration::from_secs(5)).await });
        let page = browser_hits(port, "/?state=S1&error=access_denied").await;
        assert!(page.starts_with("HTTP/1.1 200"));
        assert_eq!(server.await.unwrap(), Err(LoginError::Denied));
    }

    /// Servidor falso: responde cada pedido com o próximo corpo JSON e guarda o que recebeu.
    async fn fake_google(bodies: Vec<&'static str>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let handle = tokio::spawn(async move {
            let mut seen = Vec::new();
            for body in bodies {
                let (mut s, _) = listener.accept().await.unwrap();
                let mut buf = vec![0u8; 16384];
                let n = s.read(&mut buf).await.unwrap();
                seen.push(String::from_utf8_lossy(&buf[..n]).into_owned());
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                s.write_all(resp.as_bytes()).await.unwrap();
                s.shutdown().await.ok();
            }
            seen
        });
        (base, handle)
    }

    fn client(base: &str) -> GoogleClient {
        GoogleClient::with_endpoints("id", "secret", &format!("{base}/token"), &format!("{base}/gmail"))
    }

    #[tokio::test]
    async fn exchange_code_returns_tokens() {
        let (base, srv) = fake_google(vec![r#"{"access_token":"ya29","expires_in":3599,"refresh_token":"1//r"}"#]).await;
        let t = client(&base).exchange_code("CODE", "VER", "http://127.0.0.1:9").await.unwrap();
        assert_eq!(t.refresh_token.as_deref(), Some("1//r"));
        let req = &srv.await.unwrap()[0];
        assert!(req.starts_with("POST /token"));
        assert!(req.contains("code_verifier=VER"));
    }

    #[tokio::test]
    async fn profile_returns_email() {
        let (base, srv) = fake_google(vec![r#"{"emailAddress":"gabriel@exemplo.com","messagesTotal":1284}"#]).await;
        let p = client(&base).profile("ya29").await.unwrap();
        assert_eq!(p.email_address, "gabriel@exemplo.com");
        assert_eq!(p.messages_total, 1284);
        let req = &srv.await.unwrap()[0];
        assert!(req.starts_with("GET /gmail/profile"));
        assert!(req.to_ascii_lowercase().contains("authorization: bearer ya29"));
    }

    #[tokio::test]
    async fn inbox_lists_then_reads_each_message() {
        let msg = r#"{"id":"a","threadId":"t","labelIds":["INBOX","UNREAD"],"snippet":"oi","internalDate":"1794917520000",
          "payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"Ana <ana@x.com>"},{"name":"Subject","value":"Olá"}]}}"#;
        let (base, srv) = fake_google(vec![r#"{"messages":[{"id":"a","threadId":"t"}]}"#, msg]).await;
        let list = client(&base).inbox("ya29", 20, 1_794_927_600_000, -180).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].from.name, "Ana");
        assert_eq!(list[0].date, "09:12");
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("GET /gmail/messages?labelIds=INBOX&maxResults=20"));
        assert!(reqs[1].starts_with("GET /gmail/messages/a?format=metadata"));
    }

    #[tokio::test]
    async fn mark_read_removes_unread_label() {
        let (base, srv) = fake_google(vec![r#"{"id":"a"}"#]).await;
        client(&base).mark_read("ya29", "a").await.unwrap();
        let req = &srv.await.unwrap()[0];
        assert!(req.starts_with("POST /gmail/messages/a/modify"));
        assert!(req.contains(r#""removeLabelIds":["UNREAD"]"#));
    }

    #[tokio::test]
    async fn loopback_times_out() {
        let listener = Loopback::bind().await.unwrap();
        let got = listener.wait_for_code("S1", std::time::Duration::from_millis(50)).await;
        assert_eq!(got, Err(LoginError::TimedOut));
    }
}
