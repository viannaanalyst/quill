//! Sessão das contas Google no app de computador: login pelo navegador, tokens no cofre do sistema
//! (Chaves do macOS / Credential Manager do Windows) e acesso renovado sozinho.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::accounts::{Account, AccountStore};
use crate::gmail::MessageSummary;
use crate::google::{GoogleClient, LoginError, Loopback, Profile, SCOPES};
use crate::oauth::{AuthRequest, Pkce, google_auth_url, random_token};

/// Nome do "serviço" no cofre; cada conta fica guardada pelo e-mail.
const VAULT_SERVICE: &str = "app.quill.desktop.google";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(4 * 60);

pub struct GoogleSession {
    client: GoogleClient,
    store: AccountStore,
    /// e-mail → (token de acesso, quando expira); só na memória
    tokens: Mutex<HashMap<String, (String, Instant)>>,
    /// avisado quando a pessoa cancela o login em andamento
    cancel: tokio::sync::Notify,
    /// endereço do login em andamento (para abrir de novo ou copiar)
    auth_url: Mutex<Option<String>>,
}

fn vault(email: &str) -> Result<keyring::Entry, LoginError> {
    keyring::Entry::new(VAULT_SERVICE, &email.to_lowercase()).map_err(|e| LoginError::Vault(e.to_string()))
}

impl GoogleSession {
    pub fn new(client_id: &str, client_secret: &str, accounts_file: PathBuf) -> Self {
        Self {
            client: GoogleClient::new(client_id, client_secret),
            store: AccountStore::new(accounts_file),
            tokens: Mutex::new(HashMap::new()),
            cancel: tokio::sync::Notify::new(),
            auth_url: Mutex::new(None),
        }
    }

    pub fn accounts(&self) -> Vec<Account> {
        self.store.list()
    }

    fn remember(&self, email: &str, token: String, expires_in: u64) {
        // renova 1 minuto antes de expirar
        let until = Instant::now() + Duration::from_secs(expires_in.saturating_sub(60));
        self.tokens.lock().expect("trava dos tokens").insert(email.to_lowercase(), (token, until));
    }

    /// Abre a página oficial do Google no navegador e espera a pessoa autorizar.
    /// Para o login em andamento (a pessoa fechou o navegador ou desistiu).
    pub fn cancel_sign_in(&self) {
        self.cancel.notify_waiters();
    }

    /// Endereço do login em andamento, se houver.
    pub fn auth_url(&self) -> Option<String> {
        self.auth_url.lock().expect("trava do login").clone()
    }

    /// Abre de novo a página de login do Google (ex.: a pessoa fechou a aba).
    pub fn reopen_auth_url(&self) -> Result<(), LoginError> {
        let url = self.auth_url().ok_or(LoginError::Cancelled)?;
        open::that_detached(&url).map_err(|e| LoginError::Network(format!("não consegui abrir o navegador: {e}")))
    }

    pub async fn sign_in(&self, login_hint: Option<String>) -> Result<(Account, Profile), LoginError> {
        // um login por vez: um pedido novo encerra o anterior
        self.cancel.notify_waiters();
        let loopback = Loopback::bind().await.map_err(|e| LoginError::Network(e.to_string()))?;
        let redirect_uri = loopback.redirect_uri();
        let pkce = Pkce::generate();
        let state = random_token(24);
        let url = google_auth_url(&AuthRequest {
            client_id: self.client.client_id().to_string(),
            redirect_uri: redirect_uri.clone(),
            scopes: SCOPES.iter().map(|s| s.to_string()).collect(),
            challenge: pkce.challenge.clone(),
            state: state.clone(),
            login_hint,
        });
        *self.auth_url.lock().expect("trava do login") = Some(url.clone());
        open::that_detached(&url).map_err(|e| LoginError::Network(format!("não consegui abrir o navegador: {e}")))?;

        let waited = loopback.wait_for_code_or_cancel(&state, LOGIN_TIMEOUT, &self.cancel).await;
        *self.auth_url.lock().expect("trava do login") = None;
        let code = waited?;
        let tokens = self.client.exchange_code(&code, &pkce.verifier, &redirect_uri).await?;
        let profile = self.client.profile(&tokens.access_token).await?;
        let refresh = tokens
            .refresh_token
            .ok_or_else(|| LoginError::Google("o Google não devolveu o acesso permanente; tente de novo".into()))?;

        vault(&profile.email_address)?
            .set_password(&refresh)
            .map_err(|e| LoginError::Vault(e.to_string()))?;
        let account = Account::google(&profile.email_address);
        self.store.add(account.clone()).map_err(|e| LoginError::Vault(e.to_string()))?;
        self.remember(&account.email, tokens.access_token, tokens.expires_in);
        Ok((account, profile))
    }

    /// Token de acesso válido para a conta (renova com o token guardado no cofre quando preciso).
    pub async fn access_token(&self, email: &str) -> Result<String, LoginError> {
        if let Some((token, until)) = self.tokens.lock().expect("trava dos tokens").get(&email.to_lowercase())
            && Instant::now() < *until {
                return Ok(token.clone());
            }
        let refresh = vault(email)?.get_password().map_err(|_| LoginError::NeedsLogin)?;
        match self.client.refresh(&refresh).await {
            Ok(t) => {
                self.remember(email, t.access_token.clone(), t.expires_in);
                Ok(t.access_token)
            }
            Err(LoginError::Google(msg)) if msg.contains("invalid_grant") => Err(LoginError::NeedsLogin),
            Err(e) => Err(e),
        }
    }

    pub async fn inbox(&self, email: &str, max: u32, now_ms: i64, tz_offset_min: i32) -> Result<Vec<MessageSummary>, LoginError> {
        let token = self.access_token(email).await?;
        self.client.inbox(&token, max, now_ms, tz_offset_min).await
    }

    pub async fn folder(&self, email: &str, folder: &str, max: u32, now_ms: i64, tz_offset_min: i32) -> Result<Vec<MessageSummary>, LoginError> {
        let token = self.access_token(email).await?;
        self.client.folder(&token, folder, max, now_ms, tz_offset_min).await
    }

    /// Contadores das caixas: não lidos na Entrada e no Spam, total em Rascunhos.
    pub async fn counts(&self, email: &str) -> Result<HashMap<String, u64>, LoginError> {
        let token = self.access_token(email).await?;
        let (inbox, drafts, spam) = tokio::join!(
            self.client.label_counts(&token, "INBOX"),
            self.client.label_counts(&token, "DRAFT"),
            self.client.label_counts(&token, "SPAM"),
        );
        let mut out = HashMap::new();
        out.insert("inbox".to_string(), inbox?.unread);
        out.insert("drafts".to_string(), drafts?.total);
        out.insert("spam".to_string(), spam?.unread);
        Ok(out)
    }

    /// Nome e foto da conta (pede o escopo "profile"; contas conectadas antes dele precisam entrar de novo).
    pub async fn profile(&self, email: &str) -> Result<crate::gmail::UserInfo, LoginError> {
        let token = self.access_token(email).await?;
        self.client.userinfo(&token).await
    }

    pub async fn body(&self, email: &str, id: &str) -> Result<crate::gmail::MessageBody, LoginError> {
        let token = self.access_token(email).await?;
        self.client.body(&token, id).await
    }

    /// Envia pela conta `message.from` (o remetente é sempre a própria conta).
    pub async fn send(&self, message: &crate::gmail::OutgoingMessage, thread_id: Option<&str>) -> Result<String, LoginError> {
        let token = self.access_token(&message.from).await?;
        let mime = crate::gmail::build_mime(message);
        self.client.send(&token, &mime, thread_id).await
    }

    pub async fn attachment(&self, email: &str, message_id: &str, attachment_id: &str) -> Result<Vec<u8>, LoginError> {
        let token = self.access_token(email).await?;
        self.client.attachment(&token, message_id, attachment_id).await
    }

    /// Agendas visíveis da conta e os eventos delas no intervalo (todas ao mesmo tempo).
    pub async fn agenda(&self, email: &str, time_min: &str, time_max: &str) -> Result<Agenda, LoginError> {
        let token = self.access_token(email).await?;
        let calendars = self.client.calendars(&token).await?;
        let mut set = tokio::task::JoinSet::new();
        for c in calendars.iter().filter(|c| c.selected) {
            let client = self.client.clone();
            let (token, id, min, max) = (token.clone(), c.id.clone(), time_min.to_string(), time_max.to_string());
            set.spawn(async move { client.events(&token, &id, &min, &max).await });
        }
        let mut events = Vec::new();
        while let Some(res) = set.join_next().await {
            // uma agenda com erro (ex.: sem permissão) não derruba as outras
            if let Ok(Ok(list)) = res {
                events.extend(list);
            }
        }
        Ok(Agenda { calendars, events })
    }

    pub async fn rsvp(&self, email: &str, calendar_id: &str, event_id: &str, status: &str) -> Result<(), LoginError> {
        let token = self.access_token(email).await?;
        self.client.rsvp(&token, calendar_id, event_id, status).await
    }

    pub async fn create_event(&self, email: &str, calendar_id: &str, e: &crate::calendar::NewEvent) -> Result<crate::calendar::CalEvent, LoginError> {
        let token = self.access_token(email).await?;
        self.client.create_event(&token, calendar_id, e).await
    }

    /// Ação num e-mail: archive, unarchive, spam, notspam, star, unstar, unread, read, trash.
    pub async fn act(&self, email: &str, id: &str, action: &str) -> Result<(), LoginError> {
        let token = self.access_token(email).await?;
        let (add, remove): (&[&str], &[&str]) = match action {
            "archive" => (&[], &["INBOX"]),
            "unarchive" => (&["INBOX"], &[]),
            "spam" => (&["SPAM"], &["INBOX"]),
            "notspam" => (&["INBOX"], &["SPAM"]),
            "star" => (&["STARRED"], &[]),
            "unstar" => (&[], &["STARRED"]),
            "unread" => (&["UNREAD"], &[]),
            "read" => (&[], &["UNREAD"]),
            "trash" => return self.client.trash(&token, id).await,
            other => return Err(LoginError::Google(format!("ação desconhecida: {other}"))),
        };
        self.client.modify(&token, id, add, remove).await
    }

    pub async fn mark_read(&self, email: &str, id: &str) -> Result<(), LoginError> {
        let token = self.access_token(email).await?;
        self.client.mark_read(&token, id).await
    }

    /// Tira a conta do Quill neste computador (nada é apagado no Google).
    pub fn remove(&self, email: &str) -> Result<(), LoginError> {
        if let Ok(entry) = vault(email) {
            let _ = entry.delete_credential();
        }
        self.tokens.lock().expect("trava dos tokens").remove(&email.to_lowercase());
        self.store.remove(email).map_err(|e| LoginError::Vault(e.to_string()))
    }
}

/// Agendas e eventos de uma conta.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Agenda {
    pub calendars: Vec<crate::calendar::CalendarInfo>,
    pub events: Vec<crate::calendar::CalEvent>,
}
