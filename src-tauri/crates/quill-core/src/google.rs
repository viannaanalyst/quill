//! Conversa com o Google: recebe a volta do navegador, troca o código por tokens e usa a API do Gmail.
//! Só existe com o recurso `net`.

use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

use crate::oauth::{self, AuthError};

/// Escopos pedidos: ler/organizar e enviar e-mail, e a agenda.
pub const SCOPES: [&str; 6] = [
    "openid",
    "email",
    "profile",
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
    /// a pessoa cancelou o login no Quill
    Cancelled,
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
            LoginError::Cancelled => write!(f, "Login cancelado."),
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
    userinfo_url: String,
    /// Google Agenda
    cal_api: String,
    /// envio com anexos (upload do Gmail)
    upload_api: String,
}

fn net(e: reqwest::Error) -> LoginError {
    LoginError::Network(e.to_string())
}

impl GoogleClient {
    pub fn new(client_id: &str, client_secret: &str) -> Self {
        let mut c = Self::with_endpoints(client_id, client_secret, oauth::GOOGLE_TOKEN_ENDPOINT, crate::gmail::GMAIL_API);
        c.userinfo_url = "https://www.googleapis.com/oauth2/v2/userinfo".into();
        c.cal_api = crate::calendar::CALENDAR_API.into();
        c.upload_api = crate::gmail::GMAIL_UPLOAD_API.into();
        c
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
            userinfo_url: format!("{}/userinfo", api.trim_end_matches('/')),
            cal_api: format!("{}/calendar", api.trim_end_matches('/')),
            upload_api: format!("{}/upload", api.trim_end_matches('/')),
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
        self.folder(token, "inbox", max, now_ms, tz_offset_min).await
    }

    /// Últimos e-mails de uma caixa ("inbox", "sent", "spam"…), já no formato da lista.
    pub async fn folder(
        &self,
        token: &str,
        folder: &str,
        max: u32,
        now_ms: i64,
        tz_offset_min: i32,
    ) -> Result<Vec<crate::gmail::MessageSummary>, LoginError> {
        let query = crate::gmail::folder_query(folder).ok_or_else(|| LoginError::Google(format!("caixa desconhecida: {folder}")))?;
        let list = self.get(token, &format!("/messages?{query}&maxResults={max}")).await?;
        let ids = crate::gmail::parse_message_list(&list).map_err(LoginError::Google)?;
        let mut out = Vec::with_capacity(ids.len());
        // um pedido por e-mail, em grupos de 10 ao mesmo tempo (limite educado de uso da API)
        for chunk in ids.chunks(10) {
            let mut set = tokio::task::JoinSet::new();
            for (i, id) in chunk.iter().enumerate() {
                let this = self.clone();
                let token = token.to_string();
                let path = format!("/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject");
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

    /// Total e não lidos de um marcador do Gmail (INBOX, SPAM, DRAFT…).
    pub async fn label_counts(&self, token: &str, label: &str) -> Result<crate::gmail::LabelCounts, LoginError> {
        let body = self.get(token, &format!("/labels/{label}")).await?;
        crate::gmail::parse_label_counts(&body).map_err(LoginError::Google)
    }

    /// Nome e foto da conta Google.
    pub async fn userinfo(&self, token: &str) -> Result<crate::gmail::UserInfo, LoginError> {
        let resp = self.http.get(&self.userinfo_url).bearer_auth(token).send().await.map_err(net)?;
        if !resp.status().is_success() {
            return Err(LoginError::Google(resp.status().to_string()));
        }
        let body = resp.text().await.map_err(net)?;
        crate::gmail::parse_userinfo(&body).map_err(LoginError::Google)
    }

    /// Texto do e-mail.
    pub async fn body(&self, token: &str, id: &str) -> Result<crate::gmail::MessageBody, LoginError> {
        let json = self.get(token, &format!("/messages/{id}?format=full")).await?;
        crate::gmail::parse_message_body(&json).map_err(LoginError::Google)
    }

    /// Marca como lido no Gmail (tira o marcador UNREAD).
    /// Envia um e-mail já montado (texto RFC 2822, com anexos se houver) pelo upload do Gmail.
    /// Com `thread_id`, entra na mesma conversa. Devolve o id novo.
    pub async fn send(&self, token: &str, mime: &str, thread_id: Option<&str>) -> Result<String, LoginError> {
        let boundary = format!("quill-up-{}", oauth::random_token(12));
        let resp = self
            .http
            .post(format!("{}/messages/send?uploadType=multipart", self.upload_api))
            .bearer_auth(token)
            .header("Content-Type", format!("multipart/related; boundary={boundary}"))
            .timeout(Duration::from_secs(180))
            .body(crate::gmail::upload_body(mime, thread_id, &boundary))
            .send()
            .await
            .map_err(net)?;
        let status = resp.status();
        let text = resp.text().await.map_err(net)?;
        if !status.is_success() {
            return Err(LoginError::Google(format!("{status}: {text}")));
        }
        #[derive(serde::Deserialize)]
        struct Sent {
            id: String,
        }
        serde_json::from_str::<Sent>(&text).map(|s| s.id).map_err(|e| LoginError::Google(e.to_string()))
    }

    /// Conteúdo de um anexo recebido.
    pub async fn attachment(&self, token: &str, message_id: &str, attachment_id: &str) -> Result<Vec<u8>, LoginError> {
        let json = self.get(token, &format!("/messages/{message_id}/attachments/{attachment_id}")).await?;
        crate::gmail::decode_attachment(&json).map_err(LoginError::Google)
    }

    /// Pedido com corpo JSON opcional; devolve o texto da resposta ou o erro do Google.
    async fn request(&self, method: reqwest::Method, url: String, token: &str, body: Option<String>) -> Result<String, LoginError> {
        let mut req = self.http.request(method, url).bearer_auth(token);
        if let Some(b) = body {
            req = req.header("Content-Type", "application/json").body(b);
        }
        let resp = req.send().await.map_err(net)?;
        let status = resp.status();
        let text = resp.text().await.map_err(net)?;
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(LoginError::NeedsLogin);
        }
        if !status.is_success() {
            return Err(LoginError::Google(format!("{status}: {text}")));
        }
        Ok(text)
    }

    /// Agendas da conta.
    pub async fn calendars(&self, token: &str) -> Result<Vec<crate::calendar::CalendarInfo>, LoginError> {
        let body = self.request(reqwest::Method::GET, format!("{}/users/me/calendarList?maxResults=250", self.cal_api), token, None).await?;
        crate::calendar::parse_calendar_list(&body).map_err(LoginError::Google)
    }

    /// Eventos de uma agenda no intervalo (segue até 5 páginas de 250).
    pub async fn events(&self, token: &str, calendar_id: &str, time_min: &str, time_max: &str) -> Result<Vec<crate::calendar::CalEvent>, LoginError> {
        let base = format!("{}{}/events", self.cal_api, crate::calendar::calendar_path(calendar_id));
        let mut out = Vec::new();
        let mut page: Option<String> = None;
        for _ in 0..5 {
            let q = crate::calendar::events_query(time_min, time_max, page.as_deref());
            let body = self.request(reqwest::Method::GET, format!("{base}?{q}"), token, None).await?;
            let (events, next) = crate::calendar::parse_events(&body, calendar_id).map_err(LoginError::Google)?;
            out.extend(events);
            match next {
                Some(n) => page = Some(n),
                None => break,
            }
        }
        Ok(out)
    }

    /// Responde a um convite (sim, não, talvez) e avisa o organizador.
    pub async fn rsvp(&self, token: &str, calendar_id: &str, event_id: &str, status: &str) -> Result<(), LoginError> {
        let enc: String = url::form_urlencoded::byte_serialize(event_id.as_bytes()).collect();
        let url = format!("{}{}/events/{enc}", self.cal_api, crate::calendar::calendar_path(calendar_id));
        let event = self.request(reqwest::Method::GET, url.clone(), token, None).await?;
        let patch = crate::calendar::rsvp_patch(&event, status).map_err(LoginError::Google)?;
        self.request(reqwest::Method::PATCH, format!("{url}?sendUpdates=all"), token, Some(patch)).await?;
        Ok(())
    }

    /// Cria um evento e devolve como ficou no Google.
    pub async fn create_event(&self, token: &str, calendar_id: &str, e: &crate::calendar::NewEvent) -> Result<crate::calendar::CalEvent, LoginError> {
        let url = format!("{}{}/events", self.cal_api, crate::calendar::calendar_path(calendar_id));
        let body = self.request(reqwest::Method::POST, url, token, Some(crate::calendar::new_event_body(e))).await?;
        let (mut list, _) = crate::calendar::parse_events(&format!(r#"{{"items":[{body}]}}"#), calendar_id).map_err(LoginError::Google)?;
        list.pop().ok_or_else(|| LoginError::Google("o Google não devolveu o evento".into()))
    }

    /// POST sem resposta útil (só confere se deu certo).
    async fn post_ok(&self, token: &str, path: &str, body: String) -> Result<(), LoginError> {
        let resp = self
            .http
            .post(format!("{}{path}", self.api))
            .bearer_auth(token)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(net)?;
        if !resp.status().is_success() {
            return Err(LoginError::Google(resp.status().to_string()));
        }
        Ok(())
    }

    /// Põe e tira marcadores (arquivar = tirar INBOX; spam = pôr SPAM; estrela = STARRED; não lido = UNREAD).
    pub async fn modify(&self, token: &str, id: &str, add: &[&str], remove: &[&str]) -> Result<(), LoginError> {
        let body = serde_json::json!({ "addLabelIds": add, "removeLabelIds": remove }).to_string();
        self.post_ok(token, &format!("/messages/{id}/modify"), body).await
    }

    /// Manda para a Lixeira (o Gmail apaga de vez depois de 30 dias).
    pub async fn trash(&self, token: &str, id: &str) -> Result<(), LoginError> {
        self.post_ok(token, &format!("/messages/{id}/trash"), String::new()).await
    }

    /// Tira da Lixeira (volta para onde estava).
    pub async fn untrash(&self, token: &str, id: &str) -> Result<(), LoginError> {
        self.post_ok(token, &format!("/messages/{id}/untrash"), String::new()).await
    }

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
    /// Igual a `wait_for_code`, mas para na hora quando `cancel` é avisado (botão Cancelar no app).
    pub async fn wait_for_code_or_cancel(self, state: &str, timeout: Duration, cancel: &tokio::sync::Notify) -> Result<String, LoginError> {
        tokio::select! {
            got = self.wait_for_code(state, timeout) => got,
            _ = cancel.notified() => Err(LoginError::Cancelled),
        }
    }

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
    async fn sent_folder_uses_sent_label_and_reads_to_header() {
        let msg = r#"{"id":"s","threadId":"t","labelIds":["SENT"],"snippet":"","internalDate":"1794917520000",
          "payload":{"mimeType":"text/plain","headers":[{"name":"To","value":"Ana <ana@x.com>"},{"name":"Subject","value":"Oi"}]}}"#;
        let (base, srv) = fake_google(vec![r#"{"messages":[{"id":"s","threadId":"t"}]}"#, msg]).await;
        let list = client(&base).folder("ya29", "sent", 25, 1_794_927_600_000, -180).await.unwrap();
        assert_eq!(list[0].to.as_ref().unwrap().name, "Ana");
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("GET /gmail/messages?labelIds=SENT&maxResults=25"));
        assert!(reqs[1].contains("metadataHeaders=To"));
    }

    #[tokio::test]
    async fn unknown_folder_is_an_error() {
        assert!(client("http://127.0.0.1:9").folder("ya29", "nada", 5, 0, 0).await.is_err());
    }

    #[tokio::test]
    async fn label_counts_come_from_labels_endpoint() {
        let (base, srv) = fake_google(vec![r#"{"id":"SPAM","messagesTotal":12,"messagesUnread":4}"#]).await;
        let c = client(&base).label_counts("ya29", "SPAM").await.unwrap();
        assert_eq!((c.total, c.unread), (12, 4));
        assert!(srv.await.unwrap()[0].starts_with("GET /gmail/labels/SPAM"));
    }

    #[tokio::test]
    async fn userinfo_returns_photo() {
        let (base, srv) = fake_google(vec![r#"{"name":"Gabriel","picture":"https://lh3.googleusercontent.com/a/x"}"#]).await;
        let u = client(&base).userinfo("ya29").await.unwrap();
        assert_eq!(u.picture.as_deref(), Some("https://lh3.googleusercontent.com/a/x"));
        assert!(srv.await.unwrap()[0].starts_with("GET /gmail/userinfo"));
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
    async fn send_uploads_whole_message() {
        let (base, srv) = fake_google(vec![r#"{"id":"novo","threadId":"t1"}"#]).await;
        let id = client(&base).send("ya29", "From: eu\r\n\r\noi", None).await.unwrap();
        assert_eq!(id, "novo");
        let req = &srv.await.unwrap()[0];
        assert!(req.starts_with("POST /gmail/upload/messages/send?uploadType=multipart"));
        assert!(req.contains("Bearer ya29"));
        assert!(req.to_lowercase().contains("content-type: multipart/related; boundary="));
        assert!(req.contains("Content-Type: message/rfc822\r\n\r\nFrom: eu\r\n\r\noi"));
        assert!(!req.contains("threadId"));
    }

    #[tokio::test]
    async fn send_reply_keeps_thread() {
        let (base, srv) = fake_google(vec![r#"{"id":"novo","threadId":"t1"}"#]).await;
        client(&base).send("ya29", "x", Some("t1")).await.unwrap();
        assert!(srv.await.unwrap()[0].contains(r#"{"threadId":"t1"}"#));
    }

    #[tokio::test]
    async fn downloads_attachment_bytes() {
        let (base, srv) = fake_google(vec![r#"{"size":3,"data":"T2zh"}"#]).await;
        let bytes = client(&base).attachment("ya29", "m1", "ANX1").await.unwrap();
        assert_eq!(bytes, b"Ol\xe1".to_vec());
        assert!(srv.await.unwrap()[0].starts_with("GET /gmail/messages/m1/attachments/ANX1"));
    }

    #[tokio::test]
    async fn modify_adds_and_removes_labels() {
        let (base, srv) = fake_google(vec![r#"{"id":"a"}"#]).await;
        client(&base).modify("ya29", "a", &["SPAM"], &["INBOX"]).await.unwrap();
        let req = &srv.await.unwrap()[0];
        assert!(req.starts_with("POST /gmail/messages/a/modify"));
        assert!(req.contains(r#""addLabelIds":["SPAM"]"#));
        assert!(req.contains(r#""removeLabelIds":["INBOX"]"#));
    }

    #[tokio::test]
    async fn trash_moves_to_trash() {
        let (base, srv) = fake_google(vec![r#"{"id":"a"}"#]).await;
        client(&base).trash("ya29", "a").await.unwrap();
        assert!(srv.await.unwrap()[0].starts_with("POST /gmail/messages/a/trash"));
    }

    #[tokio::test]
    async fn events_follow_pages() {
        let (base, srv) = fake_google(vec![
            r#"{"items":[{"id":"a","start":{"date":"2026-11-20"},"end":{"date":"2026-11-21"}}],"nextPageToken":"p2"}"#,
            r#"{"items":[{"id":"b","start":{"date":"2026-11-21"},"end":{"date":"2026-11-22"}}]}"#,
        ])
        .await;
        let events = client(&base).events("ya29", "eu@gmail.com", "2026-11-16T00:00:00Z", "2026-11-23T00:00:00Z").await.unwrap();
        assert_eq!(events.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("GET /gmail/calendar/calendars/eu%40gmail.com/events?timeMin="));
        assert!(reqs[1].contains("pageToken=p2"));
    }

    #[tokio::test]
    async fn rsvp_reads_then_patches_and_notifies() {
        let (base, srv) = fake_google(vec![
            r#"{"id":"e1","attendees":[{"email":"eu@x.com","self":true,"responseStatus":"needsAction"}]}"#,
            r#"{"id":"e1"}"#,
        ])
        .await;
        client(&base).rsvp("ya29", "eu@x.com", "e1", "accepted").await.unwrap();
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("GET /gmail/calendar/calendars/eu%40x.com/events/e1"));
        assert!(reqs[1].starts_with("PATCH /gmail/calendar/calendars/eu%40x.com/events/e1?sendUpdates=all"));
        assert!(reqs[1].contains(r#""responseStatus":"accepted""#));
    }

    #[tokio::test]
    async fn create_event_posts_and_returns_it() {
        let (base, srv) = fake_google(vec![r#"{"id":"novo","summary":"Almoço","start":{"date":"2026-11-20"},"end":{"date":"2026-11-21"}}"#]).await;
        let e = crate::calendar::NewEvent {
            title: "Almoço".into(),
            start: crate::calendar::EventTime { date_time: None, date: Some("2026-11-20".into()) },
            end: crate::calendar::EventTime { date_time: None, date: Some("2026-11-21".into()) },
            location: None,
            description: None,
        };
        let created = client(&base).create_event("ya29", "primary", &e).await.unwrap();
        assert_eq!(created.id, "novo");
        assert_eq!(created.calendar_id, "primary");
        assert!(srv.await.unwrap()[0].starts_with("POST /gmail/calendar/calendars/primary/events"));
    }

    #[tokio::test]
    async fn untrash_brings_back_from_trash() {
        let (base, srv) = fake_google(vec![r#"{"id":"a"}"#]).await;
        client(&base).untrash("ya29", "a").await.unwrap();
        assert!(srv.await.unwrap()[0].starts_with("POST /gmail/messages/a/untrash"));
    }

    #[tokio::test]
    async fn loopback_times_out() {
        let listener = Loopback::bind().await.unwrap();
        let got = listener.wait_for_code("S1", std::time::Duration::from_millis(50)).await;
        assert_eq!(got, Err(LoginError::TimedOut));
    }

    #[tokio::test]
    async fn loopback_stops_when_cancelled() {
        let listener = Loopback::bind().await.unwrap();
        let cancel = std::sync::Arc::new(tokio::sync::Notify::new());
        let c = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            c.notify_waiters();
        });
        let got = listener.wait_for_code_or_cancel("S1", std::time::Duration::from_secs(5), &cancel).await;
        assert_eq!(got, Err(LoginError::Cancelled));
    }
}
