//! Conversa com o Google: recebe a volta do navegador, troca o código por tokens e usa a API do Gmail.
//! Só existe com o recurso `net`.

use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

use crate::oauth::{self, AuthError};

/// Escopos pedidos: ler/organizar e enviar e-mail, e a agenda.
pub const SCOPES: [&str; 13] = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.modify",
    // acesso completo ao Gmail: o único que deixa "Excluir para sempre" (batchDelete), ADR-027
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
    // sugestões de destinatário como no Gmail (contatos e "Outros contatos"), só leitura
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/contacts.other.readonly",
    // Google Chat (só contas Workspace): conversas, mensagens (ler e enviar) e pessoas de cada conversa
    "https://www.googleapis.com/auth/chat.spaces.readonly",
    "https://www.googleapis.com/auth/chat.messages",
    "https://www.googleapis.com/auth/chat.memberships.readonly",
    // nomes e fotos das pessoas da empresa (People API), porque o Chat só devolve o id de quem enviou
    "https://www.googleapis.com/auth/directory.readonly",
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
    /// falta uma permissão no acesso já dado (a conta precisa entrar de novo para concedê-la)
    Permission(String),
}

/// Mensagem quando o acesso antigo não tem o escopo de excluir para sempre.
pub const DELETE_NEEDS_PERMISSION: &str =
    "Para excluir para sempre, entre de novo com esta conta (o Google pede uma permissão a mais)";

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
            LoginError::Permission(m) => write!(f, "{m}"),
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
    /// contatos (People API)
    people_api: String,
    /// Google Chat
    chat_api: String,
    /// envio de arquivos do Google Chat
    chat_upload_api: String,
}

/// Avisa quanto do envio já foi (bytes enviados, total).
pub type Progress = std::sync::Arc<dyn Fn(u64, u64) + Send + Sync>;

fn net(e: reqwest::Error) -> LoginError {
    LoginError::Network(e.to_string())
}

impl GoogleClient {
    pub fn new(client_id: &str, client_secret: &str) -> Self {
        let mut c = Self::with_endpoints(client_id, client_secret, oauth::GOOGLE_TOKEN_ENDPOINT, crate::gmail::GMAIL_API);
        c.userinfo_url = "https://www.googleapis.com/oauth2/v2/userinfo".into();
        c.cal_api = crate::calendar::CALENDAR_API.into();
        c.upload_api = crate::gmail::GMAIL_UPLOAD_API.into();
        c.people_api = crate::contacts::PEOPLE_API.into();
        c.chat_api = crate::chat::CHAT_API.into();
        c.chat_upload_api = crate::chat::CHAT_UPLOAD_API.into();
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
            people_api: format!("{}/people", api.trim_end_matches('/')),
            chat_api: format!("{}/chat", api.trim_end_matches('/')),
            chat_upload_api: format!("{}/chatup", api.trim_end_matches('/')),
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

    /// Cria (sem `draft_id`) ou atualiza um rascunho no Gmail, pelo upload (aceita anexos). Devolve o id do rascunho.
    pub async fn draft_save(&self, token: &str, mime: &str, draft_id: Option<&str>, thread_id: Option<&str>) -> Result<String, LoginError> {
        let boundary = format!("quill-up-{}", oauth::random_token(12));
        let meta = match thread_id {
            Some(t) => serde_json::json!({ "message": { "threadId": t } }),
            None => serde_json::json!({ "message": {} }),
        };
        let (method, url) = match draft_id {
            Some(id) => (reqwest::Method::PUT, format!("{}/drafts/{id}?uploadType=multipart", self.upload_api)),
            None => (reqwest::Method::POST, format!("{}/drafts?uploadType=multipart", self.upload_api)),
        };
        let resp = self
            .http
            .request(method, url)
            .bearer_auth(token)
            .header("Content-Type", format!("multipart/related; boundary={boundary}"))
            .timeout(Duration::from_secs(180))
            .body(crate::gmail::upload_body_with_meta(mime, &meta.to_string(), &boundary))
            .send()
            .await
            .map_err(net)?;
        let status = resp.status();
        let text = resp.text().await.map_err(net)?;
        if !status.is_success() {
            return Err(LoginError::Google(format!("{status}: {text}")));
        }
        #[derive(serde::Deserialize)]
        struct Draft {
            id: String,
        }
        serde_json::from_str::<Draft>(&text).map(|d| d.id).map_err(|e| LoginError::Google(e.to_string()))
    }

    pub async fn draft_delete(&self, token: &str, draft_id: &str) -> Result<(), LoginError> {
        self.request(reqwest::Method::DELETE, format!("{}/drafts/{draft_id}", self.api), token, None).await.map(|_| ())
    }

    /// Id do rascunho que contém a mensagem (a lista Rascunhos mostra mensagens, não rascunhos).
    pub async fn find_draft_id(&self, token: &str, message_id: &str) -> Result<String, LoginError> {
        #[derive(serde::Deserialize)]
        struct List {
            #[serde(default)]
            drafts: Vec<D>,
        }
        #[derive(serde::Deserialize)]
        struct D {
            id: String,
            message: M,
        }
        #[derive(serde::Deserialize)]
        struct M {
            id: String,
        }
        let body = self.get(token, "/drafts?maxResults=500").await?;
        let list: List = serde_json::from_str(&body).map_err(|e| LoginError::Google(e.to_string()))?;
        list.drafts
            .into_iter()
            .find(|d| d.message.id == message_id)
            .map(|d| d.id)
            .ok_or_else(|| LoginError::Google("esse rascunho não existe mais".into()))
    }

    /// Conteúdo do rascunho para editar.
    pub async fn draft_get(&self, token: &str, message_id: &str) -> Result<crate::gmail::DraftContent, LoginError> {
        let draft_id = self.find_draft_id(token, message_id).await?;
        let json = self.get(token, &format!("/messages/{message_id}?format=full")).await?;
        crate::gmail::parse_draft_content(&json, &draft_id).map_err(LoginError::Google)
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

    // ---------- Google Chat (só Workspace) ----------

    fn check_space(space: &str) -> Result<(), LoginError> {
        if crate::chat::valid_space_name(space) {
            Ok(())
        } else {
            Err(LoginError::Google("conversa inválida".into()))
        }
    }

    /// Conversas da conta (até 3 páginas de 200), da mais recente para a mais antiga.
    pub async fn chat_spaces(&self, token: &str) -> Result<Vec<crate::chat::RawSpace>, LoginError> {
        let mut out = Vec::new();
        let mut page: Option<String> = None;
        for _ in 0..3 {
            let mut url = format!("{}/spaces?pageSize=200", self.chat_api);
            if let Some(p) = &page {
                url.push_str(&format!("&pageToken={}", url::form_urlencoded::byte_serialize(p.as_bytes()).collect::<String>()));
            }
            let body = self.request(reqwest::Method::GET, url, token, None).await?;
            let (list, next) = crate::chat::parse_spaces(&body).map_err(LoginError::Google)?;
            out.extend(list);
            match next {
                Some(n) if !n.is_empty() => page = Some(n),
                _ => break,
            }
        }
        crate::chat::sort_spaces(&mut out);
        Ok(out)
    }

    /// Pessoas (`users/<id>`) de uma conversa.
    pub async fn chat_members(&self, token: &str, space: &str) -> Result<Vec<String>, LoginError> {
        Self::check_space(space)?;
        let body = self.request(reqwest::Method::GET, format!("{}/{space}/members?pageSize=100", self.chat_api), token, None).await?;
        crate::chat::parse_members(&body).map_err(LoginError::Google)
    }

    /// Uma página de mensagens (mais novas primeiro, como a API devolve).
    pub async fn chat_messages(
        &self,
        token: &str,
        space: &str,
        page_token: Option<&str>,
        page_size: u32,
    ) -> Result<(Vec<crate::chat::RawMessage>, Option<String>), LoginError> {
        Self::check_space(space)?;
        let url = format!("{}/{space}/messages?{}", self.chat_api, crate::chat::messages_query(page_token, page_size));
        let body = self.request(reqwest::Method::GET, url, token, None).await?;
        crate::chat::parse_messages(&body).map_err(LoginError::Google)
    }

    /// Envia uma mensagem (texto e/ou anexos já enviados); com `thread`, responde naquela conversa.
    pub async fn chat_send(
        &self,
        token: &str,
        space: &str,
        text: &str,
        thread: Option<&str>,
        attachments: &[crate::chat::AttachmentRef],
        quote: Option<&crate::chat::QuoteRef>,
    ) -> Result<crate::chat::RawMessage, LoginError> {
        Self::check_space(space)?;
        if thread.is_some_and(|t| !t.starts_with(&format!("{space}/threads/"))) {
            return Err(LoginError::Google("conversa inválida".into()));
        }
        if let Some(q) = quote {
            crate::chat::quote_allowed(space, q).map_err(LoginError::Google)?;
        }
        let (body, query) = crate::chat::send_request(text, thread, attachments, quote);
        let url = if query.is_empty() { format!("{}/{space}/messages", self.chat_api) } else { format!("{}/{space}/messages?{query}", self.chat_api) };
        let resp = self.request(reqwest::Method::POST, url, token, Some(body)).await?;
        crate::chat::parse_message(&resp).map_err(LoginError::Google)
    }

    fn check_message(message: &str) -> Result<(), LoginError> {
        if crate::chat::valid_message_name(message) {
            Ok(())
        } else {
            Err(LoginError::Google("mensagem inválida".into()))
        }
    }

    /// Reage a uma mensagem com um emoji. `false` quando a conta já tinha reagido com ele (o Google responde 409).
    pub async fn chat_react(&self, token: &str, message: &str, emoji: &str) -> Result<bool, LoginError> {
        Self::check_message(message)?;
        let body = crate::chat::reaction_body(emoji).map_err(LoginError::Google)?;
        match self.request(reqwest::Method::POST, format!("{}/{message}/reactions", self.chat_api), token, Some(body)).await {
            Ok(_) => Ok(true),
            Err(LoginError::Google(m)) if m.starts_with("409") => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// Reações de uma pessoa (`users/<id>`) com um emoji numa mensagem (para achar o nome e tirar a reação).
    pub async fn chat_reactions(&self, token: &str, message: &str, user_id: &str, emoji: &str) -> Result<Vec<crate::chat::RawReaction>, LoginError> {
        Self::check_message(message)?;
        let url = format!("{}/{message}/reactions?{}", self.chat_api, crate::chat::my_reactions_query(user_id, emoji));
        let body = self.request(reqwest::Method::GET, url, token, None).await?;
        crate::chat::parse_reactions(&body).map_err(LoginError::Google)
    }

    /// Tira uma reação (`spaces/<id>/messages/<id>/reactions/<id>`).
    pub async fn chat_delete_reaction(&self, token: &str, reaction: &str) -> Result<(), LoginError> {
        if !crate::chat::valid_reaction_name(reaction) {
            return Err(LoginError::Google("reação inválida".into()));
        }
        self.request(reqwest::Method::DELETE, format!("{}/{reaction}", self.chat_api), token, None).await.map(|_| ())
    }

    /// Troca o texto de uma mensagem da própria conta e devolve como ficou.
    pub async fn chat_edit(&self, token: &str, message: &str, text: &str) -> Result<crate::chat::RawMessage, LoginError> {
        Self::check_message(message)?;
        let (body, query) = crate::chat::edit_request(text);
        let resp = self.request(reqwest::Method::PATCH, format!("{}/{message}?{query}", self.chat_api), token, Some(body)).await?;
        crate::chat::parse_message(&resp).map_err(LoginError::Google)
    }

    /// Apaga uma mensagem. Sem `force`: se ela tiver respostas, o Google recusa (não apaga as respostas dos outros).
    pub async fn chat_delete(&self, token: &str, message: &str) -> Result<(), LoginError> {
        Self::check_message(message)?;
        self.request(reqwest::Method::DELETE, format!("{}/{message}", self.chat_api), token, None).await.map(|_| ())
    }

    /// Conteúdo de um anexo do Chat (`media.download`), até `max` bytes.
    pub async fn chat_media(&self, token: &str, resource: &str, max: u64) -> Result<Vec<u8>, LoginError> {
        if !crate::chat::valid_media_resource(resource) {
            return Err(LoginError::Google("anexo inválido".into()));
        }
        let too_big = || LoginError::Google(format!("arquivo grande demais para abrir no Quill (mais de {} MB)", max / (1024 * 1024)));
        let mut resp = self
            .http
            .get(format!("{}/media/{resource}?alt=media", self.chat_api))
            .bearer_auth(token)
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(net)?;
        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(LoginError::NeedsLogin);
        }
        if !status.is_success() {
            let text = resp.text().await.map_err(net)?;
            return Err(LoginError::Google(format!("{status}: {text}")));
        }
        if resp.content_length().is_some_and(|n| n > max) {
            return Err(too_big());
        }
        let mut out = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(net)? {
            if (out.len() + chunk.len()) as u64 > max {
                return Err(too_big());
            }
            out.extend_from_slice(&chunk);
        }
        Ok(out)
    }

    /// Envia um arquivo para uma conversa (`attachments:upload`) e devolve a referência para a mensagem.
    /// `progress` recebe (bytes já entregues à conexão, total).
    pub async fn chat_upload(
        &self,
        token: &str,
        space: &str,
        filename: &str,
        content_type: &str,
        bytes: Vec<u8>,
        progress: Progress,
    ) -> Result<crate::chat::AttachmentRef, LoginError> {
        if bytes.len() > crate::chat::MAX_UPLOAD {
            return Err(LoginError::Google("O Google Chat aceita arquivos de até 200 MB.".into()));
        }
        Self::check_space(space)?;
        let boundary = format!("quill-chat-{}", oauth::random_token(12));
        let body = crate::chat::upload_body(filename, content_type, &bytes, &boundary);
        drop(bytes);
        let total = body.len() as u64;
        let body = std::sync::Arc::new(body);
        const CHUNK: usize = 256 * 1024;
        let chunks = (0..body.len()).step_by(CHUNK).map(move |start| {
            let end = (start + CHUNK).min(body.len());
            progress(end as u64, total);
            Ok::<_, std::io::Error>(body[start..end].to_vec())
        });
        let resp = self
            .http
            .post(format!("{}/{space}/attachments:upload?uploadType=multipart", self.chat_upload_api))
            .bearer_auth(token)
            .header("Content-Type", format!("multipart/related; boundary={boundary}"))
            .header("Content-Length", total)
            .timeout(Duration::from_secs(900))
            .body(reqwest::Body::wrap_stream(futures_util::stream::iter(chunks)))
            .send()
            .await
            .map_err(net)?;
        let status = resp.status();
        let text = resp.text().await.map_err(net)?;
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(LoginError::NeedsLogin);
        }
        if !status.is_success() {
            return Err(LoginError::Google(format!("{status}: {text}")));
        }
        crate::chat::parse_upload(&text).map_err(LoginError::Google)
    }

    /// Nome, foto e e-mail de várias pessoas do Chat (`users/<id>`) pela People API (de 50 em 50).
    /// Ids que não são de pessoas (apps) ficam de fora.
    pub async fn people_batch(&self, token: &str, user_ids: &[String]) -> Result<Vec<crate::chat::ChatPerson>, LoginError> {
        let resources: Vec<String> = user_ids.iter().filter_map(|u| crate::chat::people_resource(u)).collect();
        let mut out = Vec::new();
        for chunk in resources.chunks(50) {
            let q: String = chunk
                .iter()
                .map(|r| format!("resourceNames={}", url::form_urlencoded::byte_serialize(r.as_bytes()).collect::<String>()))
                .collect::<Vec<_>>()
                .join("&");
            let url = format!("{}/people:batchGet?{q}&personFields=names,photos,emailAddresses", self.people_api);
            let body = self.request(reqwest::Method::GET, url, token, None).await?;
            out.extend(crate::chat::parse_people_batch(&body).map_err(LoginError::Google)?);
        }
        Ok(out)
    }

    /// Id do Chat (`users/<id>`) da própria conta.
    pub async fn people_me(&self, token: &str) -> Result<String, LoginError> {
        let body = self.request(reqwest::Method::GET, format!("{}/people/me?personFields=names", self.people_api), token, None).await?;
        crate::chat::parse_me(&body).map_err(LoginError::Google)
    }

    /// Contatos do Google: os salvos (peso 5) e os "Outros contatos" que o Gmail cria (peso 2). Até 3 páginas de cada.
    pub async fn google_contacts(&self, token: &str) -> Result<Vec<crate::contacts::Contact>, LoginError> {
        let mut out = Vec::new();
        for (path, weight) in [
            ("/people/me/connections?personFields=names,emailAddresses,photos&pageSize=1000", 5),
            ("/otherContacts?readMask=names,emailAddresses,photos&pageSize=1000", 2),
        ] {
            let mut page: Option<String> = None;
            for _ in 0..3 {
                let url = match &page {
                    Some(p) => format!("{}{path}&pageToken={}", self.people_api, url::form_urlencoded::byte_serialize(p.as_bytes()).collect::<String>()),
                    None => format!("{}{path}", self.people_api),
                };
                let body = self.request(reqwest::Method::GET, url, token, None).await?;
                let (list, next) = crate::contacts::parse_people(&body, weight).map_err(LoginError::Google)?;
                out.extend(list);
                match next {
                    Some(n) => page = Some(n),
                    None => break,
                }
            }
        }
        Ok(out)
    }

    /// Pessoas para quem você escreveu (cabeçalhos To/Cc dos últimos enviados), 3 pontos por vez.
    pub async fn sent_contacts(&self, token: &str, max: u32) -> Result<Vec<crate::contacts::Contact>, LoginError> {
        let list = self.get(token, &format!("/messages?labelIds=SENT&maxResults={max}")).await?;
        let ids = crate::gmail::parse_message_list(&list).map_err(LoginError::Google)?;
        let mut out = Vec::new();
        for chunk in ids.chunks(10) {
            let mut set = tokio::task::JoinSet::new();
            for id in chunk {
                let this = self.clone();
                let token = token.to_string();
                let path = format!("/messages/{id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc");
                set.spawn(async move { this.get(&token, &path).await });
            }
            while let Some(res) = set.join_next().await {
                let Ok(Ok(body)) = res else { continue };
                for value in crate::gmail::header_values(&body, &["To", "Cc"]) {
                    for (name, email) in crate::contacts::parse_address_list(&value) {
                        out.push(crate::contacts::Contact { name, email, photo: None, score: 3 });
                    }
                }
            }
        }
        Ok(out)
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
        let url = format!("{}{}/events{}", self.cal_api, crate::calendar::calendar_path(calendar_id), crate::calendar::new_event_query(e));
        let body = self.request(reqwest::Method::POST, url, token, Some(crate::calendar::new_event_body(e))).await?;
        let (mut list, _) = crate::calendar::parse_events(&format!(r#"{{"items":[{body}]}}"#), calendar_id).map_err(LoginError::Google)?;
        list.pop().ok_or_else(|| LoginError::Google("o Google não devolveu o evento".into()))
    }

    /// Muda um evento (título, horário, local, convidados, lembretes) e avisa os convidados.
    pub async fn update_event(&self, token: &str, calendar_id: &str, event_id: &str, p: &crate::calendar::EventPatch) -> Result<crate::calendar::CalEvent, LoginError> {
        let enc: String = url::form_urlencoded::byte_serialize(event_id.as_bytes()).collect();
        let url = format!("{}{}/events/{enc}?sendUpdates=all", self.cal_api, crate::calendar::calendar_path(calendar_id));
        let body = self.request(reqwest::Method::PATCH, url, token, Some(crate::calendar::event_patch_body(p))).await?;
        let (mut list, _) = crate::calendar::parse_events(&format!(r#"{{"items":[{body}]}}"#), calendar_id).map_err(LoginError::Google)?;
        list.pop().ok_or_else(|| LoginError::Google("o Google não devolveu o evento".into()))
    }

    /// Apaga um evento (e avisa os convidados).
    pub async fn delete_event(&self, token: &str, calendar_id: &str, event_id: &str) -> Result<(), LoginError> {
        let enc: String = url::form_urlencoded::byte_serialize(event_id.as_bytes()).collect();
        let url = format!("{}{}/events/{enc}?sendUpdates=all", self.cal_api, crate::calendar::calendar_path(calendar_id));
        self.request(reqwest::Method::DELETE, url, token, None).await.map(|_| ())
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

    /// Troca o 403 de "escopo insuficiente" por um pedido claro para entrar de novo.
    fn delete_error(e: LoginError) -> LoginError {
        match e {
            LoginError::Google(m)
                if m.starts_with("403") && (m.contains("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || m.to_ascii_lowercase().contains("insufficient")) =>
            {
                LoginError::Permission(DELETE_NEEDS_PERMISSION.into())
            }
            other => other,
        }
    }

    /// Apaga um e-mail de vez (sem passar pela Lixeira). Precisa do escopo https://mail.google.com/.
    pub async fn delete_message(&self, token: &str, id: &str) -> Result<(), LoginError> {
        crate::gmail::check_id(id).map_err(LoginError::Google)?;
        self.request(reqwest::Method::DELETE, format!("{}/messages/{id}", self.api), token, None)
            .await
            .map(|_| ())
            .map_err(Self::delete_error)
    }

    /// Apaga vários e-mails de vez, em grupos de até 1000 (limite do batchDelete).
    pub async fn batch_delete(&self, token: &str, ids: &[String]) -> Result<(), LoginError> {
        for id in ids {
            crate::gmail::check_id(id).map_err(LoginError::Google)?;
        }
        for chunk in ids.chunks(1000) {
            let body = serde_json::json!({ "ids": chunk }).to_string();
            self.request(reqwest::Method::POST, format!("{}/messages/batchDelete", self.api), token, Some(body))
                .await
                .map_err(Self::delete_error)?;
        }
        Ok(())
    }

    /// Ids de tudo o que está na Lixeira (segue todas as páginas, até 100 mil e-mails).
    pub async fn trash_ids(&self, token: &str) -> Result<Vec<String>, LoginError> {
        let mut out = Vec::new();
        let mut page: Option<String> = None;
        for _ in 0..200 {
            let mut path = "/messages?labelIds=TRASH&includeSpamTrash=true&maxResults=500".to_string();
            if let Some(p) = &page {
                let p: String = url::form_urlencoded::byte_serialize(p.as_bytes()).collect();
                path.push_str(&format!("&pageToken={p}"));
            }
            let body = self.get(token, &path).await?;
            let (ids, next) = crate::gmail::parse_message_page(&body).map_err(LoginError::Google)?;
            out.extend(ids);
            match next {
                Some(n) if !n.is_empty() => page = Some(n),
                _ => break,
            }
        }
        Ok(out)
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
        fake_google_with(bodies.into_iter().map(|b| (200, b)).collect()).await
    }

    /// Igual a `fake_google`, com o código HTTP de cada resposta. Lê o pedido inteiro (cabeçalhos + Content-Length).
    async fn fake_google_with(replies: Vec<(u16, &'static str)>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let handle = tokio::spawn(async move {
            let mut seen = Vec::new();
            for (status, body) in replies {
                let (mut s, _) = listener.accept().await.unwrap();
                let mut buf = Vec::new();
                let mut chunk = vec![0u8; 65536];
                loop {
                    let n = s.read(&mut chunk).await.unwrap();
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf);
                    if let Some(end) = text.find("\r\n\r\n") {
                        let len = text[..end]
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                            .unwrap_or(0);
                        if buf.len() >= end + 4 + len {
                            break;
                        }
                    }
                }
                seen.push(String::from_utf8_lossy(&buf).into_owned());
                let reason = if status == 200 { "OK" } else { "Erro" };
                let resp = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
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
            attendees: vec![],
            reminders: None,
            meet: false,
        };
        let created = client(&base).create_event("ya29", "primary", &e).await.unwrap();
        assert_eq!(created.id, "novo");
        assert_eq!(created.calendar_id, "primary");
        assert!(srv.await.unwrap()[0].starts_with("POST /gmail/calendar/calendars/primary/events"));
    }

    #[test]
    fn scopes_include_full_gmail_access_for_permanent_delete() {
        assert!(SCOPES.contains(&"https://mail.google.com/"));
    }

    #[tokio::test]
    async fn delete_removes_for_good() {
        let (base, srv) = fake_google_with(vec![(204, "")]).await;
        client(&base).delete_message("ya29", "a").await.unwrap();
        assert!(srv.await.unwrap()[0].starts_with("DELETE /gmail/messages/a "));
    }

    #[tokio::test]
    async fn batch_delete_sends_ids_in_groups_of_1000() {
        let (base, srv) = fake_google_with(vec![(204, ""), (204, "")]).await;
        let ids: Vec<String> = (0..1001).map(|i| format!("m{i}")).collect();
        client(&base).batch_delete("ya29", &ids).await.unwrap();
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("POST /gmail/messages/batchDelete"));
        assert!(reqs[0].contains(r#""m0""#) && reqs[0].contains(r#""m999""#) && !reqs[0].contains(r#""m1000""#));
        assert!(reqs[1].starts_with("POST /gmail/messages/batchDelete"));
        assert!(reqs[1].contains(r#"{"ids":["m1000"]}"#));
    }

    #[tokio::test]
    async fn batch_delete_with_nothing_does_not_call_google() {
        client("http://127.0.0.1:9").batch_delete("ya29", &[]).await.unwrap();
    }

    #[tokio::test]
    async fn delete_without_full_permission_asks_to_sign_in_again() {
        let insufficient = r#"{"error":{"code":403,"message":"Request had insufficient authentication scopes.","status":"PERMISSION_DENIED","details":[{"reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}"#;
        let (base, _srv) = fake_google_with(vec![(403, insufficient), (403, insufficient)]).await;
        let c = client(&base);
        let e = c.delete_message("ya29", "a").await.unwrap_err();
        assert_eq!(e, LoginError::Permission(DELETE_NEEDS_PERMISSION.into()));
        assert_eq!(
            e.to_string(),
            "Para excluir para sempre, entre de novo com esta conta (o Google pede uma permissão a mais)"
        );
        let e = c.batch_delete("ya29", &["a".into()]).await.unwrap_err();
        assert_eq!(e, LoginError::Permission(DELETE_NEEDS_PERMISSION.into()));
    }

    #[tokio::test]
    async fn trash_ids_follow_all_pages() {
        let (base, srv) = fake_google(vec![
            r#"{"messages":[{"id":"a","threadId":"t"},{"id":"b","threadId":"t"}],"nextPageToken":"p2"}"#,
            r#"{"messages":[{"id":"c","threadId":"u"}]}"#,
        ])
        .await;
        let ids = client(&base).trash_ids("ya29").await.unwrap();
        assert_eq!(ids, vec!["a", "b", "c"]);
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("GET /gmail/messages?labelIds=TRASH&includeSpamTrash=true&maxResults=500 "));
        assert!(reqs[1].starts_with("GET /gmail/messages?labelIds=TRASH&includeSpamTrash=true&maxResults=500&pageToken=p2 "));
    }

    #[tokio::test]
    async fn untrash_brings_back_from_trash() {
        let (base, srv) = fake_google(vec![r#"{"id":"a"}"#]).await;
        client(&base).untrash("ya29", "a").await.unwrap();
        assert!(srv.await.unwrap()[0].starts_with("POST /gmail/messages/a/untrash"));
    }

    #[tokio::test]
    async fn sent_contacts_read_to_and_cc() {
        let (base, srv) = fake_google(vec![
            r#"{"messages":[{"id":"s1","threadId":"t"}]}"#,
            r#"{"id":"s1","payload":{"headers":[{"name":"To","value":"Ana <ana@x.com>, bia@y.com"},{"name":"Cc","value":"Caio <caio@z.com>"}]}}"#,
        ])
        .await;
        let list = client(&base).sent_contacts("ya29", 50).await.unwrap();
        let emails: Vec<_> = list.iter().map(|c| c.email.as_str()).collect();
        assert_eq!(emails, ["ana@x.com", "bia@y.com", "caio@z.com"]);
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("GET /gmail/messages?labelIds=SENT&maxResults=50"));
    }

    #[tokio::test]
    async fn google_contacts_reads_both_lists() {
        let (base, srv) = fake_google(vec![
            r#"{"connections":[{"names":[{"displayName":"Davi"}],"emailAddresses":[{"value":"davi@x.com"}]}]}"#,
            r#"{"otherContacts":[{"emailAddresses":[{"value":"maq@hotmail.com"}]}]}"#,
        ])
        .await;
        let list = client(&base).google_contacts("ya29").await.unwrap();
        assert_eq!(list.len(), 2);
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("GET /gmail/people/people/me/connections?personFields="));
        assert!(reqs[1].starts_with("GET /gmail/people/otherContacts?readMask="));
    }

    #[tokio::test]
    async fn draft_create_then_update_via_upload() {
        let (base, srv) = fake_google(vec![r#"{"id":"r1","message":{"id":"m1"}}"#, r#"{"id":"r1","message":{"id":"m2"}}"#]).await;
        let c = client(&base);
        assert_eq!(c.draft_save("ya29", "From: eu\r\n\r\noi", None, Some("t1")).await.unwrap(), "r1");
        assert_eq!(c.draft_save("ya29", "From: eu\r\n\r\noi 2", Some("r1"), None).await.unwrap(), "r1");
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("POST /gmail/upload/drafts?uploadType=multipart"));
        assert!(reqs[0].contains(r#"{"message":{"threadId":"t1"}}"#));
        assert!(reqs[1].starts_with("PUT /gmail/upload/drafts/r1?uploadType=multipart"));
        assert!(reqs[1].contains(r#"{"message":{}}"#));
    }

    #[tokio::test]
    async fn draft_delete_and_find_by_message() {
        let (base, srv) = fake_google(vec![
            "",
            r#"{"drafts":[{"id":"r9","message":{"id":"m9"}},{"id":"r1","message":{"id":"m1"}}]}"#,
        ])
        .await;
        let c = client(&base);
        c.draft_delete("ya29", "r1").await.unwrap();
        assert_eq!(c.find_draft_id("ya29", "m1").await.unwrap(), "r1");
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("DELETE /gmail/drafts/r1"));
        assert!(reqs[1].starts_with("GET /gmail/drafts?maxResults=500"));
    }

    #[tokio::test]
    async fn update_and_delete_event_notify_guests() {
        let (base, srv) = fake_google(vec![r#"{"id":"e1","summary":"Novo","start":{"date":"2026-11-20"},"end":{"date":"2026-11-21"}}"#, ""]).await;
        let c = client(&base);
        let p = crate::calendar::EventPatch { title: Some("Novo".into()), ..Default::default() };
        assert_eq!(c.update_event("ya29", "eu@x.com", "e1", &p).await.unwrap().title, "Novo");
        c.delete_event("ya29", "eu@x.com", "e1").await.unwrap();
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("PATCH /gmail/calendar/calendars/eu%40x.com/events/e1?sendUpdates=all"));
        assert!(reqs[1].starts_with("DELETE /gmail/calendar/calendars/eu%40x.com/events/e1?sendUpdates=all"));
    }

    // ---------- Google Chat ----------

    #[tokio::test]
    async fn chat_spaces_follow_pages_and_sort() {
        let (base, srv) = fake_google(vec![
            r#"{"spaces":[{"name":"spaces/A","spaceType":"SPACE","displayName":"A","lastActiveTime":"2026-11-17T10:00:00Z"}],"nextPageToken":"p2"}"#,
            r#"{"spaces":[{"name":"spaces/B","spaceType":"DIRECT_MESSAGE","lastActiveTime":"2026-11-17T11:00:00Z"}]}"#,
        ])
        .await;
        let list = client(&base).chat_spaces("ya29").await.unwrap();
        assert_eq!(list.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["spaces/B", "spaces/A"]);
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("GET /gmail/chat/spaces?pageSize="));
        assert!(reqs[0].to_ascii_lowercase().contains("authorization: bearer ya29"));
        assert!(reqs[1].contains("pageToken=p2"));
    }

    #[tokio::test]
    async fn chat_members_and_messages_use_space_path() {
        let (base, srv) = fake_google(vec![
            r#"{"memberships":[{"member":{"name":"users/1","type":"HUMAN"}}]}"#,
            r#"{"messages":[{"name":"spaces/B/messages/1","sender":{"name":"users/1"},"createTime":"2026-11-17T11:00:00Z","text":"oi"}],"nextPageToken":"old"}"#,
        ])
        .await;
        let c = client(&base);
        assert_eq!(c.chat_members("ya29", "spaces/B").await.unwrap(), ["users/1"]);
        let (msgs, next) = c.chat_messages("ya29", "spaces/B", Some("tok"), 50).await.unwrap();
        assert_eq!(msgs[0].text, "oi");
        assert_eq!(next.as_deref(), Some("old"));
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("GET /gmail/chat/spaces/B/members?pageSize="));
        assert!(reqs[1].starts_with("GET /gmail/chat/spaces/B/messages?orderBy=createTime%20desc&pageSize=50&pageToken=tok"));
    }

    #[tokio::test]
    async fn chat_rejects_strange_space_names_without_network() {
        let c = client("http://127.0.0.1:9");
        assert!(c.chat_messages("ya29", "spaces/../x", None, 50).await.is_err());
        assert!(c.chat_members("ya29", "users/1").await.is_err());
        assert!(c.chat_send("ya29", "spaces/a/b", "oi", None, &[], None).await.is_err());
    }

    #[tokio::test]
    async fn chat_send_replies_in_thread() {
        let (base, srv) = fake_google(vec![
            r#"{"name":"spaces/B/messages/9","sender":{"name":"users/me1"},"createTime":"2026-11-17T12:00:00Z","text":"ok","thread":{"name":"spaces/B/threads/T"}}"#,
        ])
        .await;
        let m = client(&base).chat_send("ya29", "spaces/B", "ok", Some("spaces/B/threads/T"), &[], None).await.unwrap();
        assert_eq!(m.name, "spaces/B/messages/9");
        let req = &srv.await.unwrap()[0];
        assert!(req.starts_with("POST /gmail/chat/spaces/B/messages?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"));
        assert!(req.contains(r#""thread":{"name":"spaces/B/threads/T"}"#));
    }

    #[tokio::test]
    async fn chat_permission_error_keeps_google_reason() {
        let (base, _srv) = fake_google_with(vec![(
            403,
            r#"{"error":{"code":403,"message":"Request had insufficient authentication scopes.","status":"PERMISSION_DENIED","details":[{"reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}"#,
        )])
        .await;
        let e = client(&base).chat_spaces("ya29").await.unwrap_err();
        let LoginError::Google(msg) = e else { panic!("esperava erro do Google") };
        assert_eq!(crate::chat::classify_error(&msg), crate::chat::ChatErrorKind::Permission);
    }

    #[tokio::test]
    async fn chat_expired_token_needs_login() {
        let (base, _srv) = fake_google_with(vec![(401, r#"{"error":{"code":401}}"#)]).await;
        assert_eq!(client(&base).chat_spaces("ya29").await.unwrap_err(), LoginError::NeedsLogin);
    }

    #[tokio::test]
    async fn chat_media_downloads_bytes() {
        let (base, srv) = fake_google(vec!["GIF89a"]).await;
        let bytes = client(&base).chat_media("ya29", "ClxD/abc==", 1024).await.unwrap();
        assert_eq!(bytes, b"GIF89a");
        let req = &srv.await.unwrap()[0];
        assert!(req.starts_with("GET /gmail/chat/media/ClxD/abc==?alt=media"));
    }

    #[tokio::test]
    async fn chat_media_refuses_big_files_and_bad_names() {
        let (base, _srv) = fake_google(vec!["0123456789"]).await;
        let e = client(&base).chat_media("ya29", "abc", 5).await.unwrap_err();
        assert!(e.to_string().contains("grande demais"));
        assert!(client("http://127.0.0.1:9").chat_media("ya29", "a?alt=json", 5).await.is_err());
    }

    #[tokio::test]
    async fn chat_upload_sends_multipart_and_reports_progress() {
        let (base, srv) = fake_google(vec![r#"{"attachmentDataRef":{"resourceName":"res1","attachmentUploadToken":"tok1"}}"#]).await;
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let s2 = seen.clone();
        let progress = std::sync::Arc::new(move |sent: u64, total: u64| s2.lock().unwrap().push((sent, total)));
        let r = client(&base)
            .chat_upload("ya29", "spaces/B", "nota.m4a", "audio/mp4", b"AUDIO-BYTES".to_vec(), progress)
            .await
            .unwrap();
        assert_eq!(r.attachment_upload_token.as_deref(), Some("tok1"));
        let req = &srv.await.unwrap()[0];
        assert!(req.starts_with("POST /gmail/chatup/spaces/B/attachments:upload?uploadType=multipart"));
        assert!(req.to_ascii_lowercase().contains("content-type: multipart/related; boundary="));
        assert!(req.contains(r#"{"filename":"nota.m4a"}"#));
        assert!(req.contains("Content-Type: audio/mp4\r\n\r\nAUDIO-BYTES"));
        let seen = seen.lock().unwrap();
        let (last_sent, total) = *seen.last().unwrap();
        assert_eq!(last_sent, total);
        assert!(total > 11);
    }

    #[tokio::test]
    async fn chat_upload_refuses_files_over_limit() {
        let big = vec![0u8; crate::chat::MAX_UPLOAD + 1];
        let e = client("http://127.0.0.1:9").chat_upload("ya29", "spaces/B", "x.bin", "", big, std::sync::Arc::new(|_, _| {})).await.unwrap_err();
        assert!(e.to_string().contains("200 MB"));
    }

    #[tokio::test]
    async fn chat_react_posts_unicode_emoji() {
        let (base, srv) = fake_google(vec![r#"{"name":"spaces/B/messages/1.1/reactions/R1","emoji":{"unicode":"👍"}}"#]).await;
        assert!(client(&base).chat_react("ya29", "spaces/B/messages/1.1", "👍").await.unwrap());
        let req = &srv.await.unwrap()[0];
        assert!(req.starts_with("POST /gmail/chat/spaces/B/messages/1.1/reactions HTTP"));
        assert!(req.contains(r#"{"emoji":{"unicode":"👍"}}"#));
    }

    #[tokio::test]
    async fn chat_react_twice_is_not_an_error() {
        let (base, _srv) = fake_google_with(vec![(409, r#"{"error":{"code":409,"message":"Reaction already exists.","status":"ALREADY_EXISTS"}}"#)]).await;
        assert!(!client(&base).chat_react("ya29", "spaces/B/messages/1", "👍").await.unwrap(), "já tinha reagido: devolve false");
    }

    #[tokio::test]
    async fn chat_unreact_finds_own_reaction_then_deletes() {
        let (base, srv) = fake_google(vec![
            r#"{"reactions":[{"name":"spaces/B/messages/1/reactions/R7","user":{"name":"users/42"},"emoji":{"unicode":"❤️"}}]}"#,
            "{}",
        ])
        .await;
        let c = client(&base);
        let found = c.chat_reactions("ya29", "spaces/B/messages/1", "users/42", "❤️").await.unwrap();
        assert_eq!(found.len(), 1);
        c.chat_delete_reaction("ya29", &found[0].name).await.unwrap();
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("GET /gmail/chat/spaces/B/messages/1/reactions?filter=emoji.unicode"));
        assert!(reqs[0].contains("user.name+%3D+%22users%2F42%22"));
        assert!(reqs[1].starts_with("DELETE /gmail/chat/spaces/B/messages/1/reactions/R7 HTTP"));
    }

    #[tokio::test]
    async fn chat_edit_patches_only_text() {
        let (base, srv) = fake_google(vec![
            r#"{"name":"spaces/B/messages/1","sender":{"name":"users/42"},"createTime":"2026-11-17T12:00:00Z","lastUpdateTime":"2026-11-17T12:01:00Z","text":"certo"}"#,
        ])
        .await;
        let m = client(&base).chat_edit("ya29", "spaces/B/messages/1", "certo").await.unwrap();
        assert!(m.edited);
        assert_eq!(m.text, "certo");
        let req = &srv.await.unwrap()[0];
        assert!(req.starts_with("PATCH /gmail/chat/spaces/B/messages/1?updateMask=text HTTP"));
        assert!(req.ends_with(r#"{"text":"certo"}"#));
    }

    #[tokio::test]
    async fn chat_delete_sends_delete_without_force() {
        let (base, srv) = fake_google(vec!["{}"]).await;
        client(&base).chat_delete("ya29", "spaces/B/messages/1").await.unwrap();
        let req = &srv.await.unwrap()[0];
        assert!(req.starts_with("DELETE /gmail/chat/spaces/B/messages/1 HTTP"), "sem force: não apaga as respostas dos outros");
    }

    #[tokio::test]
    async fn chat_message_actions_reject_strange_names_without_network() {
        let c = client("http://127.0.0.1:9");
        assert!(c.chat_react("ya29", "spaces/B/messages/../x", "👍").await.is_err());
        assert!(c.chat_react("ya29", "spaces/B/messages/1", "abc").await.is_err());
        assert!(c.chat_reactions("ya29", "spaces/B", "users/1", "👍").await.is_err());
        assert!(c.chat_delete_reaction("ya29", "spaces/B/messages/1").await.is_err());
        assert!(c.chat_edit("ya29", "spaces/B/messages/1?x", "a").await.is_err());
        assert!(c.chat_delete("ya29", "spaces/B").await.is_err());
    }

    #[tokio::test]
    async fn people_batch_and_me() {
        let (base, srv) = fake_google(vec![
            r#"{"responses":[{"person":{"resourceName":"people/1","names":[{"displayName":"Ana"}]}}]}"#,
            r#"{"resourceName":"people/77"}"#,
        ])
        .await;
        let c = client(&base);
        let list = c.people_batch("ya29", &["users/1".to_string(), "users/app".to_string()]).await.unwrap();
        assert_eq!(list[0].name, "Ana");
        assert_eq!(c.people_me("ya29").await.unwrap(), "users/77");
        let reqs = srv.await.unwrap();
        assert!(reqs[0].starts_with("GET /gmail/people/people:batchGet?resourceNames=people%2F1&personFields=names,photos,emailAddresses"));
        assert!(!reqs[0].contains("app"));
        assert!(reqs[1].starts_with("GET /gmail/people/people/me?personFields=names"));
    }

    #[tokio::test]
    async fn people_batch_without_valid_ids_skips_network() {
        let list = client("http://127.0.0.1:9").people_batch("ya29", &["users/app".to_string()]).await.unwrap();
        assert!(list.is_empty());
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
