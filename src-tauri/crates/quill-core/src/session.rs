//! Sessão das contas Google no app de computador: login pela página oficial (navegador ou folha do macOS), token de
//! atualização no cofre único das Chaves do sistema (`vault.rs`) e acesso renovado sozinho.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::accounts::{Account, AccountStore};
use crate::gmail::MessageSummary;
use crate::google::{GoogleClient, LoginError, Loopback, Profile, SCOPES};
use crate::oauth::{AuthRequest, Pkce, google_auth_url, random_token};
use crate::vault::{SecretKind, Vault};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(4 * 60);

pub struct GoogleSession {
    client: GoogleClient,
    store: AccountStore,
    /// cofre único (o mesmo da sessão do iCloud/IMAP)
    vault: Arc<Vault>,
    /// e-mail → (token de acesso, quando expira); só na memória
    tokens: Mutex<HashMap<String, (String, Instant)>>,
    /// avisado quando a pessoa cancela o login em andamento
    cancel: tokio::sync::Notify,
    /// endereço do login em andamento (para abrir de novo ou copiar)
    auth_url: Mutex<Option<String>>,
}

impl GoogleSession {
    pub fn new(client_id: &str, client_secret: &str, accounts_file: PathBuf, vault: Arc<Vault>) -> Self {
        Self {
            client: GoogleClient::new(client_id, client_secret),
            store: AccountStore::new(accounts_file),
            vault,
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

    /// Para o login em andamento (a pessoa fechou a janela de login ou desistiu).
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

    /// Login com a página do Google aberta no navegador padrão.
    pub async fn sign_in(&self, login_hint: Option<String>) -> Result<(Account, Profile), LoginError> {
        self.sign_in_with(login_hint, |url| open::that_detached(url).map_err(|e| e.to_string()), || {}).await
    }

    /// Login abrindo a página do Google com `open` (ex.: a folha de login do macOS). `wait_ended` é chamado
    /// assim que a espera pelo código termina (chegou, foi recusado, cancelado ou deu tempo), antes de trocar
    /// o código pelos tokens: é a hora de fechar a janela que `open` abriu.
    pub async fn sign_in_with(
        &self,
        login_hint: Option<String>,
        open: impl FnOnce(&str) -> Result<(), String>,
        wait_ended: impl FnOnce(),
    ) -> Result<(Account, Profile), LoginError> {
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
        if let Err(e) = open(&url) {
            *self.auth_url.lock().expect("trava do login") = None;
            return Err(LoginError::Network(format!("não consegui abrir a página de login: {e}")));
        }

        let waited = loopback.wait_for_code_or_cancel(&state, LOGIN_TIMEOUT, &self.cancel).await;
        *self.auth_url.lock().expect("trava do login") = None;
        wait_ended();
        let code = waited?;
        let tokens = self.client.exchange_code(&code, &pkce.verifier, &redirect_uri).await?;
        let profile = self.client.profile(&tokens.access_token).await?;
        let refresh = tokens
            .refresh_token
            .ok_or_else(|| LoginError::Google("o Google não devolveu o acesso permanente; tente de novo".into()))?;

        self.vault.set(SecretKind::Google, &profile.email_address, &refresh).map_err(LoginError::Vault)?;
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
        let refresh = self.vault.get(SecretKind::Google, email).map_err(LoginError::Vault)?.ok_or(LoginError::NeedsLogin)?;
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

    pub async fn draft_save(&self, message: &crate::gmail::OutgoingMessage, draft_id: Option<&str>, thread_id: Option<&str>) -> Result<String, LoginError> {
        let token = self.access_token(&message.from).await?;
        self.client.draft_save(&token, &crate::gmail::build_mime(message), draft_id, thread_id).await
    }

    pub async fn draft_delete(&self, email: &str, draft_id: &str) -> Result<(), LoginError> {
        let token = self.access_token(email).await?;
        self.client.draft_delete(&token, draft_id).await
    }

    pub async fn draft_get(&self, email: &str, message_id: &str) -> Result<crate::gmail::DraftContent, LoginError> {
        let token = self.access_token(email).await?;
        self.client.draft_get(&token, message_id).await
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

    /// Sugestões de destinatário da conta: contatos do Google + quem aparece nos enviados.
    /// Se a conta ainda não deu permissão de contatos (login antigo), usa só os enviados.
    pub async fn contacts(&self, email: &str) -> Result<Vec<crate::contacts::Contact>, LoginError> {
        let token = self.access_token(email).await?;
        let (google, sent) = tokio::join!(self.client.google_contacts(&token), self.client.sent_contacts(&token, 150));
        let own: Vec<String> = self.store.list().into_iter().map(|a| a.email).collect();
        Ok(crate::contacts::merge_contacts(vec![google.unwrap_or_default(), sent.unwrap_or_default()], &own))
    }

    pub async fn rsvp(&self, email: &str, calendar_id: &str, event_id: &str, status: &str) -> Result<(), LoginError> {
        let token = self.access_token(email).await?;
        self.client.rsvp(&token, calendar_id, event_id, status).await
    }

    pub async fn update_event(&self, email: &str, calendar_id: &str, event_id: &str, p: &crate::calendar::EventPatch) -> Result<crate::calendar::CalEvent, LoginError> {
        let token = self.access_token(email).await?;
        self.client.update_event(&token, calendar_id, event_id, p).await
    }

    pub async fn delete_event(&self, email: &str, calendar_id: &str, event_id: &str) -> Result<(), LoginError> {
        let token = self.access_token(email).await?;
        self.client.delete_event(&token, calendar_id, event_id).await
    }

    pub async fn create_event(&self, email: &str, calendar_id: &str, e: &crate::calendar::NewEvent) -> Result<crate::calendar::CalEvent, LoginError> {
        let token = self.access_token(email).await?;
        self.client.create_event(&token, calendar_id, e).await
    }

    /// Ação num e-mail: archive, unarchive, spam, notspam, star, unstar, unread, read, trash, untrash.
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
            "untrash" => {
                self.client.untrash(&token, id).await?;
                // volta para a Entrada, que é o que a pessoa espera ao "mover para a Entrada"
                (&["INBOX"], &[])
            }
            other => return Err(LoginError::Google(format!("ação desconhecida: {other}"))),
        };
        self.client.modify(&token, id, add, remove).await
    }

    pub async fn mark_read(&self, email: &str, id: &str) -> Result<(), LoginError> {
        let token = self.access_token(email).await?;
        self.client.mark_read(&token, id).await
    }

    /// Apaga de vez os e-mails escolhidos (sem volta).
    pub async fn delete_forever(&self, email: &str, ids: &[String]) -> Result<(), LoginError> {
        if ids.is_empty() {
            return Ok(());
        }
        let token = self.access_token(email).await?;
        self.client.batch_delete(&token, ids).await
    }

    /// Esvazia a Lixeira da conta; devolve quantos e-mails saíram.
    pub async fn empty_trash(&self, email: &str) -> Result<usize, LoginError> {
        let token = self.access_token(email).await?;
        let ids = self.client.trash_ids(&token).await?;
        self.client.batch_delete(&token, &ids).await?;
        Ok(ids.len())
    }

    /// Tira a conta do Quill neste computador (nada é apagado no Google).
    pub fn remove(&self, email: &str) -> Result<(), LoginError> {
        // se as Chaves recusarem, a conta sai da lista do mesmo jeito (como antes)
        let _ = self.vault.remove(SecretKind::Google, email);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    use crate::vault::memory::MemoryStore;
    use crate::vault::{SecretKind, VAULT_ACCOUNT, VAULT_SERVICE, Vault};

    fn temp_file() -> PathBuf {
        std::env::temp_dir().join(format!("quill-test-{}.json", random_token(8)))
    }

    fn session_with(store: &MemoryStore) -> (GoogleSession, Arc<Vault>) {
        let file = temp_file();
        let vault = Arc::new(Vault::new(Box::new(store.clone()), file.clone()));
        (GoogleSession::new("id-teste", "segredo-teste", file, vault.clone()), vault)
    }

    fn session() -> GoogleSession {
        session_with(&MemoryStore::default()).0
    }

    #[test]
    fn remove_apaga_so_o_token_da_conta_no_cofre_unico() {
        let store = MemoryStore::default();
        store.put(VAULT_SERVICE, VAULT_ACCOUNT, r#"{"google":{"ana@gmail.com":"r1","caio@gmail.com":"r2"},"imap":{"bia@icloud.com":"s1"}}"#);
        let (s, vault) = session_with(&store);
        s.store.add(Account::google("ana@gmail.com")).unwrap();
        s.remove("Ana@gmail.com").unwrap();
        assert_eq!(vault.get(SecretKind::Google, "ana@gmail.com").unwrap(), None);
        assert_eq!(vault.get(SecretKind::Google, "caio@gmail.com").unwrap().as_deref(), Some("r2"));
        assert_eq!(vault.get(SecretKind::Imap, "bia@icloud.com").unwrap().as_deref(), Some("s1"));
        assert!(s.accounts().is_empty());
    }

    #[tokio::test]
    async fn access_token_sem_token_no_cofre_pede_login() {
        let s = session();
        assert!(matches!(s.access_token("ana@gmail.com").await, Err(LoginError::NeedsLogin)));
    }

    #[tokio::test]
    async fn access_token_com_as_chaves_recusadas_avisa_sem_repetir_o_pedido() {
        let store = MemoryStore::default();
        store.put(VAULT_SERVICE, VAULT_ACCOUNT, "{}");
        store.fail(VAULT_SERVICE, VAULT_ACCOUNT);
        let (s, _) = session_with(&store);
        for email in ["ana@gmail.com", "caio@gmail.com"] {
            assert!(matches!(s.access_token(email).await, Err(LoginError::Vault(_))));
        }
        assert_eq!(store.reads(), 1);
    }

    #[tokio::test]
    async fn sign_in_with_avisa_quando_nao_consegue_abrir() {
        let s = session();
        let ended = AtomicBool::new(false);
        let got = s.sign_in_with(None, |_| Err("sem janela".into()), || ended.store(true, Ordering::SeqCst)).await;
        assert!(matches!(got, Err(LoginError::Network(ref m)) if m.contains("sem janela")));
        assert_eq!(s.auth_url(), None);
        // a janela nem abriu, então não há o que fechar
        assert!(!ended.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn cancelar_termina_a_espera_e_chama_wait_ended() {
        let s = Arc::new(session());
        let opened = Arc::new(Mutex::new(None::<String>));
        let ended = Arc::new(AtomicBool::new(false));
        let (s2, o2, e2) = (s.clone(), opened.clone(), ended.clone());
        let task = tokio::spawn(async move {
            s2.sign_in_with(
                Some("ana@exemplo.com".into()),
                move |url| {
                    *o2.lock().unwrap() = Some(url.to_string());
                    Ok(())
                },
                move || e2.store(true, Ordering::SeqCst),
            )
            .await
        });
        // espera a página "abrir" e o login ficar em andamento
        for _ in 0..200 {
            if s.auth_url().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let url = opened.lock().unwrap().clone().expect("abriu a página");
        assert!(url.starts_with("https://accounts.google.com/"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1"));
        assert_eq!(s.auth_url().as_deref(), Some(url.as_str()));

        // o aviso só vale para quem já está esperando; repete até a espera pegar
        while !task.is_finished() {
            s.cancel_sign_in();
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let got = task.await.unwrap();
        assert!(matches!(got, Err(LoginError::Cancelled)));
        assert!(ended.load(Ordering::SeqCst));
        assert_eq!(s.auth_url(), None);
    }
}
