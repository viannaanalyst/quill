//! Contas iCloud/IMAP no app de computador: senha de app no cofre único das Chaves do sistema (`vault.rs`),
//! servidores no `accounts.json`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use crate::accounts::{Account, AccountStore};
use crate::gmail::{DraftContent, MessageBody, MessageSummary, OutgoingMessage, UserInfo};
use crate::imap::{ImapConfig, ImapError};
use crate::imap_client::{Guess, ImapClient};
use crate::vault::{SecretKind, Vault};

pub struct ImapSession {
    client: ImapClient,
    store: AccountStore,
    /// cofre único (o mesmo da sessão do Google); ele mesmo guarda as senhas na memória depois de abrir
    vault: Arc<Vault>,
}

impl ImapSession {
    pub fn new(accounts_file: PathBuf, vault: Arc<Vault>) -> Self {
        Self { client: ImapClient::new(), store: AccountStore::new(accounts_file), vault }
    }

    /// A conta é iCloud/IMAP (e não Google)?
    pub fn is_imap(&self, email: &str) -> bool {
        self.store.get(email).is_some_and(|a| a.imap.is_some())
    }

    fn config(&self, email: &str) -> Result<ImapConfig, ImapError> {
        self.store.get(email).and_then(|a| a.imap).ok_or(ImapError::NeedsLogin)
    }

    fn password(&self, email: &str) -> Result<String, ImapError> {
        self.vault.get(SecretKind::Imap, email).map_err(ImapError::Vault)?.ok_or(ImapError::NeedsLogin)
    }

    /// A conta é do iCloud? (aí a agenda e os contatos vêm pelo CalDAV/CardDAV)
    pub fn is_icloud(&self, email: &str) -> bool {
        self.config(email).is_ok_and(|c| c.is_icloud())
    }

    /// Usuário e senha de app de uma conta iCloud (a mesma do e-mail, lida do cofre),
    /// para a agenda e os contatos. Nunca sai do processo.
    pub fn icloud_creds(&self, email: &str) -> Result<crate::dav_client::Creds, ImapError> {
        let cfg = self.config(email)?;
        if !cfg.is_icloud() {
            return Err(ImapError::Invalid("Essa conta não é do iCloud.".into()));
        }
        Ok(crate::dav_client::Creds { username: cfg.username.clone(), password: self.password(email)? })
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
        self.vault.set(SecretKind::Imap, &cfg.email, password).map_err(ImapError::Vault)?;
        let account = Account::imap(cfg);
        self.store.add(account.clone()).map_err(|e| ImapError::Vault(e.to_string()))?;
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
        // se as Chaves recusarem, a conta sai da lista do mesmo jeito (como antes)
        let _ = self.vault.remove(SecretKind::Imap, email);
        self.client.forget(&email.to_lowercase());
        self.store.remove(email).map_err(|e| ImapError::Vault(e.to_string()))
    }
}

fn has_control(s: &str) -> bool {
    s.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::memory::MemoryStore;
    use crate::vault::{SecretKind, VAULT_ACCOUNT, VAULT_SERVICE, Vault};
    use std::sync::Arc;

    fn icloud(email: &str) -> ImapConfig {
        ImapConfig {
            email: email.into(),
            name: Some("Bia".into()),
            provider: "icloud".into(),
            imap_host: "imap.mail.me.com".into(),
            imap_port: 993,
            smtp_host: "smtp.mail.me.com".into(),
            smtp_port: 587,
            smtp_security: None,
            username: "bia".into(),
        }
    }

    fn session_with(store: &MemoryStore) -> (ImapSession, Arc<Vault>) {
        let file = std::env::temp_dir().join(format!("quill-imap-test-{}.json", crate::oauth::random_token(8)));
        AccountStore::new(file.clone()).add(Account::imap(icloud("bia@icloud.com"))).unwrap();
        let vault = Arc::new(Vault::new(Box::new(store.clone()), file.clone()));
        (ImapSession::new(file, vault.clone()), vault)
    }

    #[test]
    fn senha_do_icloud_vem_do_cofre_unico_lido_uma_vez() {
        let store = MemoryStore::default();
        store.put(VAULT_SERVICE, VAULT_ACCOUNT, r#"{"imap":{"bia@icloud.com":"abcd-efgh-ijkl-mnop"}}"#);
        let (s, _) = session_with(&store);
        for _ in 0..3 {
            let creds = s.icloud_creds("Bia@iCloud.com").unwrap();
            assert_eq!(creds.username, "bia");
            assert_eq!(creds.password, "abcd-efgh-ijkl-mnop");
        }
        assert_eq!(store.reads(), 1);
    }

    #[test]
    fn sem_senha_no_cofre_pede_login() {
        let (s, _) = session_with(&MemoryStore::default());
        assert!(matches!(s.icloud_creds("bia@icloud.com"), Err(ImapError::NeedsLogin)));
    }

    #[test]
    fn cofre_recusado_vira_erro_das_chaves() {
        let store = MemoryStore::default();
        store.put(VAULT_SERVICE, VAULT_ACCOUNT, "{}");
        store.fail(VAULT_SERVICE, VAULT_ACCOUNT);
        let (s, _) = session_with(&store);
        assert!(matches!(s.icloud_creds("bia@icloud.com"), Err(ImapError::Vault(_))));
    }

    #[test]
    fn remove_apaga_a_senha_do_cofre_unico() {
        let store = MemoryStore::default();
        store.put(VAULT_SERVICE, VAULT_ACCOUNT, r#"{"google":{"ana@gmail.com":"r1"},"imap":{"bia@icloud.com":"s1"}}"#);
        let (s, vault) = session_with(&store);
        s.remove("bia@icloud.com").unwrap();
        assert_eq!(vault.get(SecretKind::Imap, "bia@icloud.com").unwrap(), None);
        assert_eq!(vault.get(SecretKind::Google, "ana@gmail.com").unwrap().as_deref(), Some("r1"));
        assert!(!s.is_imap("bia@icloud.com"));
    }
}
