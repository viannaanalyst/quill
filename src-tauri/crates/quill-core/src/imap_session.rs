//! Contas iCloud/IMAP no app de computador: senha de app no cofre do sistema
//! (Chaves do macOS / Credential Manager do Windows), servidores no `accounts.json`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::accounts::{Account, AccountStore};
use crate::gmail::{DraftContent, MessageBody, MessageSummary, OutgoingMessage, UserInfo};
use crate::imap::{ImapConfig, ImapError};
use crate::imap_client::{Guess, ImapClient};

/// Nome do "serviço" no cofre; cada conta fica guardada pelo e-mail.
const VAULT_SERVICE: &str = "app.quill.desktop.imap";

fn vault(email: &str) -> Result<keyring::Entry, ImapError> {
    keyring::Entry::new(VAULT_SERVICE, &email.to_lowercase()).map_err(|e| ImapError::Vault(e.to_string()))
}

pub struct ImapSession {
    client: ImapClient,
    store: AccountStore,
    /// e-mail → senha, só na memória (para não abrir o cofre a cada pedido)
    passwords: Mutex<HashMap<String, String>>,
}

impl ImapSession {
    pub fn new(accounts_file: PathBuf) -> Self {
        Self { client: ImapClient::new(), store: AccountStore::new(accounts_file), passwords: Mutex::new(HashMap::new()) }
    }

    /// A conta é iCloud/IMAP (e não Google)?
    pub fn is_imap(&self, email: &str) -> bool {
        self.store.get(email).is_some_and(|a| a.imap.is_some())
    }

    fn config(&self, email: &str) -> Result<ImapConfig, ImapError> {
        self.store.get(email).and_then(|a| a.imap).ok_or(ImapError::NeedsLogin)
    }

    fn password(&self, email: &str) -> Result<String, ImapError> {
        let key = email.to_lowercase();
        if let Some(p) = self.passwords.lock().expect("trava das senhas").get(&key) {
            return Ok(p.clone());
        }
        let p = vault(email)?.get_password().map_err(|_| ImapError::NeedsLogin)?;
        self.passwords.lock().expect("trava das senhas").insert(key, p.clone());
        Ok(p)
    }

    fn creds(&self, email: &str) -> Result<(ImapConfig, String), ImapError> {
        Ok((self.config(email)?, self.password(email)?))
    }

    /// Palpite de servidores para o formulário.
    pub async fn guess(&self, email: &str, provider: &str) -> Guess {
        self.client.guess(email, provider).await
    }

    /// Testa IMAP e SMTP; só se os dois funcionarem guarda a senha no cofre e a conta na lista.
    pub async fn connect(&self, config: &ImapConfig, password: &str) -> Result<Account, ImapError> {
        let cfg = config.validated()?;
        let password = password.trim();
        if password.is_empty() {
            return Err(ImapError::Invalid("Digite a senha.".into()));
        }
        if has_control(password) {
            return Err(ImapError::Invalid("A senha tem caracteres que não dá para usar.".into()));
        }
        self.client.forget(&cfg.email);
        self.client.check_login(&cfg, password).await?;
        vault(&cfg.email)?.set_password(password).map_err(|e| ImapError::Vault(e.to_string()))?;
        let account = Account::imap(cfg);
        self.store.add(account.clone()).map_err(|e| ImapError::Vault(e.to_string()))?;
        self.passwords.lock().expect("trava das senhas").insert(account.email.clone(), password.to_string());
        Ok(account)
    }

    pub async fn folder(&self, email: &str, folder: &str, max: u32, now_ms: i64, tz_offset_min: i32) -> Result<Vec<MessageSummary>, ImapError> {
        let (cfg, pw) = self.creds(email)?;
        self.client.list(&cfg, &pw, folder, max, now_ms, tz_offset_min).await
    }

    pub async fn counts(&self, email: &str) -> Result<HashMap<String, u64>, ImapError> {
        let (cfg, pw) = self.creds(email)?;
        self.client.counts(&cfg, &pw).await
    }

    pub async fn body(&self, email: &str, id: &str) -> Result<MessageBody, ImapError> {
        let (cfg, pw) = self.creds(email)?;
        self.client.body(&cfg, &pw, id).await
    }

    pub async fn attachment(&self, email: &str, message_id: &str, attachment_id: &str) -> Result<Vec<u8>, ImapError> {
        let (cfg, pw) = self.creds(email)?;
        self.client.attachment(&cfg, &pw, message_id, attachment_id).await
    }

    pub async fn act(&self, email: &str, id: &str, action: &str) -> Result<(), ImapError> {
        let (cfg, pw) = self.creds(email)?;
        self.client.act(&cfg, &pw, id, action).await
    }

    pub async fn mark_read(&self, email: &str, id: &str) -> Result<(), ImapError> {
        self.act(email, id, "read").await
    }

    /// Envia pela conta `message.from`.
    pub async fn send(&self, message: &OutgoingMessage) -> Result<String, ImapError> {
        let (cfg, pw) = self.creds(&message.from)?;
        self.client.send(&cfg, &pw, message).await
    }

    pub async fn draft_save(&self, message: &OutgoingMessage, draft_id: Option<&str>) -> Result<String, ImapError> {
        let (cfg, pw) = self.creds(&message.from)?;
        self.client.draft_save(&cfg, &pw, message, draft_id).await
    }

    pub async fn draft_delete(&self, email: &str, draft_id: &str) -> Result<(), ImapError> {
        let (cfg, pw) = self.creds(email)?;
        self.client.draft_delete(&cfg, &pw, draft_id).await
    }

    pub async fn draft_get(&self, email: &str, message_id: &str) -> Result<DraftContent, ImapError> {
        let (cfg, pw) = self.creds(email)?;
        self.client.draft_get(&cfg, &pw, message_id).await
    }

    /// Nome informado ao conectar (contas IMAP não têm foto).
    pub fn profile(&self, email: &str) -> UserInfo {
        UserInfo { name: self.config(email).ok().and_then(|c| c.name), picture: None }
    }

    /// Tira a conta do Quill neste computador e apaga a senha do cofre (nada muda no servidor).
    pub fn remove(&self, email: &str) -> Result<(), ImapError> {
        if let Ok(entry) = vault(email) {
            let _ = entry.delete_credential();
        }
        self.passwords.lock().expect("trava das senhas").remove(&email.to_lowercase());
        self.client.forget(&email.to_lowercase());
        self.store.remove(email).map_err(|e| ImapError::Vault(e.to_string()))
    }
}

fn has_control(s: &str) -> bool {
    s.chars().any(char::is_control)
}
