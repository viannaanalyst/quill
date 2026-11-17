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
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub struct GoogleSession {
    client: GoogleClient,
    store: AccountStore,
    /// e-mail → (token de acesso, quando expira); só na memória
    tokens: Mutex<HashMap<String, (String, Instant)>>,
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
    pub async fn sign_in(&self, login_hint: Option<String>) -> Result<(Account, Profile), LoginError> {
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
        open::that(&url).map_err(|e| LoginError::Network(format!("não consegui abrir o navegador: {e}")))?;

        let code = loopback.wait_for_code(&state, LOGIN_TIMEOUT).await?;
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

    pub async fn body(&self, email: &str, id: &str) -> Result<String, LoginError> {
        let token = self.access_token(email).await?;
        self.client.body(&token, id).await
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
