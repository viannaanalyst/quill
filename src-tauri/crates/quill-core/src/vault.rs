//! Cofre único do Quill: todos os segredos (tokens do Google e senhas de app do iCloud/IMAP) num **só** item
//! das Chaves do sistema (serviço `app.quill.desktop`, conta `cofre`), lido uma vez por abertura do app e
//! guardado na memória. Assim o macOS pede autorização uma vez só, e não uma por conta (ADR-024).
//!
//! O valor do item é um JSON `{ "google": { "<email>": "<token>" }, "imap": { "<email>": "<senha>" } }`.
//! Ele só existe na memória e nas Chaves: nunca vai para arquivo, log ou mensagem de erro.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::accounts::AccountStore;

/// Serviço e conta do item único nas Chaves.
pub const VAULT_SERVICE: &str = "app.quill.desktop";
pub const VAULT_ACCOUNT: &str = "cofre";

/// Serviços antigos (um item por conta, com o e-mail como conta). Só lidos na migração, depois apagados.
pub const LEGACY_GOOGLE_SERVICE: &str = "app.quill.desktop.google";
pub const LEGACY_IMAP_SERVICE: &str = "app.quill.desktop.imap";

/// Onde os segredos ficam guardados de verdade (as Chaves do sistema no app; a memória nos testes).
/// Os erros são frases curtas e nunca contêm o segredo.
pub trait SecretStore: Send + Sync {
    /// `Ok(None)` quando o item não existe.
    fn get(&self, service: &str, account: &str) -> Result<Option<String>, String>;
    fn set(&self, service: &str, account: &str, value: &str) -> Result<(), String>;
    /// Apagar um item que não existe não é erro.
    fn delete(&self, service: &str, account: &str) -> Result<(), String>;
}

/// De que tipo é o segredo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretKind {
    /// token de atualização (acesso permanente) de uma conta Google
    Google,
    /// senha de app de uma conta iCloud ou "Outro e-mail"
    Imap,
}

/// Conteúdo do cofre. O `Debug` mostra só os e-mails, nunca os segredos.
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Secrets {
    #[serde(default)]
    pub google: BTreeMap<String, String>,
    #[serde(default)]
    pub imap: BTreeMap<String, String>,
}

impl std::fmt::Debug for Secrets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Secrets")
            .field("google", &self.google.keys().collect::<Vec<_>>())
            .field("imap", &self.imap.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl Secrets {
    fn map(&self, kind: SecretKind) -> &BTreeMap<String, String> {
        match kind {
            SecretKind::Google => &self.google,
            SecretKind::Imap => &self.imap,
        }
    }

    fn map_mut(&mut self, kind: SecretKind) -> &mut BTreeMap<String, String> {
        match kind {
            SecretKind::Google => &mut self.google,
            SecretKind::Imap => &mut self.imap,
        }
    }

    fn is_empty(&self) -> bool {
        self.google.is_empty() && self.imap.is_empty()
    }
}

/// O cofre único, compartilhado pelas sessões do Google e do iCloud/IMAP.
pub struct Vault {
    store: Box<dyn SecretStore>,
    accounts_file: PathBuf,
    state: Mutex<State>,
}

enum State {
    /// ainda não abriu as Chaves nesta abertura do app
    Unloaded,
    Ready(Secrets),
    /// as Chaves recusaram (ex.: a pessoa clicou em "Negar"); não pede de novo até o app reabrir,
    /// e nunca grava por cima do que não conseguiu ler
    Failed(String),
}

impl Vault {
    /// `accounts_file` é o `accounts.json`, usado só na migração dos itens antigos.
    pub fn new(store: Box<dyn SecretStore>, accounts_file: PathBuf) -> Self {
        Self { store, accounts_file, state: Mutex::new(State::Unloaded) }
    }

    /// Segredo da conta, se houver.
    pub fn get(&self, kind: SecretKind, email: &str) -> Result<Option<String>, String> {
        self.with_secrets(|s| Ok(s.map(kind).get(&email.to_lowercase()).cloned()))
    }

    /// Guarda o segredo da conta (só grava nas Chaves se mudou).
    pub fn set(&self, kind: SecretKind, email: &str, secret: &str) -> Result<(), String> {
        let key = email.to_lowercase();
        self.with_secrets(|s| {
            if s.map(kind).get(&key).map(String::as_str) == Some(secret) {
                return Ok(());
            }
            let mut next = s.clone();
            next.map_mut(kind).insert(key, secret.to_string());
            self.save(&next)?;
            *s = next;
            Ok(())
        })
    }

    /// Tira o segredo da conta (só grava nas Chaves se ele existia).
    pub fn remove(&self, kind: SecretKind, email: &str) -> Result<(), String> {
        let key = email.to_lowercase();
        self.with_secrets(|s| {
            if !s.map(kind).contains_key(&key) {
                return Ok(());
            }
            let mut next = s.clone();
            next.map_mut(kind).remove(&key);
            self.save(&next)?;
            *s = next;
            Ok(())
        })
    }

    /// Abre o cofre na primeira vez (com a trava segura: chamadas ao mesmo tempo esperam e o macOS pede uma vez só)
    /// e entrega o conteúdo da memória para `f`.
    fn with_secrets<T>(&self, f: impl FnOnce(&mut Secrets) -> Result<T, String>) -> Result<T, String> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if matches!(*state, State::Unloaded) {
            *state = match self.load() {
                Ok(s) => State::Ready(s),
                Err(e) => State::Failed(e),
            };
        }
        match &mut *state {
            State::Ready(s) => f(s),
            State::Failed(e) => Err(e.clone()),
            State::Unloaded => unreachable!("o cofre acabou de ser aberto"),
        }
    }

    fn load(&self) -> Result<Secrets, String> {
        match self.store.get(VAULT_SERVICE, VAULT_ACCOUNT)? {
            // estragado (não deveria acontecer): começa vazio e as contas pedem login de novo
            Some(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
            None => self.migrate(),
        }
    }

    /// Junta no cofre único os itens antigos (um por conta) das contas do `accounts.json`, grava e apaga os antigos.
    /// Item antigo que não abriu (ex.: a pessoa negou) fica onde está; a conta pede login de novo.
    fn migrate(&self) -> Result<Secrets, String> {
        let mut secrets = Secrets::default();
        let mut moved = Vec::new();
        for account in AccountStore::new(self.accounts_file.clone()).list() {
            let (kind, service) =
                if account.imap.is_some() { (SecretKind::Imap, LEGACY_IMAP_SERVICE) } else { (SecretKind::Google, LEGACY_GOOGLE_SERVICE) };
            let email = account.email.to_lowercase();
            if let Ok(Some(secret)) = self.store.get(service, &email) {
                secrets.map_mut(kind).insert(email.clone(), secret);
                moved.push((service, email));
            }
        }
        if secrets.is_empty() {
            return Ok(secrets);
        }
        self.save(&secrets)?;
        for (service, email) in moved {
            // se não conseguir apagar, o item antigo só fica sobrando: ninguém mais lê
            let _ = self.store.delete(service, &email);
        }
        Ok(secrets)
    }

    fn save(&self, secrets: &Secrets) -> Result<(), String> {
        let json = serde_json::to_string(secrets).map_err(|_| "não consegui preparar o cofre".to_string())?;
        self.store.set(VAULT_SERVICE, VAULT_ACCOUNT, &json)
    }
}

/// As Chaves do sistema (Chaves do macOS / Credential Manager do Windows).
#[cfg(feature = "desktop")]
pub struct KeyringStore;

#[cfg(feature = "desktop")]
impl SecretStore for KeyringStore {
    fn get(&self, service: &str, account: &str) -> Result<Option<String>, String> {
        match entry(service, account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keyring_error(&e)),
        }
    }
    fn set(&self, service: &str, account: &str, value: &str) -> Result<(), String> {
        entry(service, account)?.set_password(value).map_err(|e| keyring_error(&e))
    }
    fn delete(&self, service: &str, account: &str) -> Result<(), String> {
        match entry(service, account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keyring_error(&e)),
        }
    }
}

#[cfg(feature = "desktop")]
fn entry(service: &str, account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, account).map_err(|e| keyring_error(&e))
}

/// Frase do erro das Chaves. Usa só o texto (`Display`), que nunca traz o segredo; o `Debug` de alguns erros traz os bytes.
#[cfg(feature = "desktop")]
fn keyring_error(e: &keyring::Error) -> String {
    e.to_string()
}

#[cfg(feature = "desktop")]
impl Vault {
    /// O cofre do app, nas Chaves do sistema.
    pub fn system(accounts_file: PathBuf) -> Self {
        Self::new(Box::new(KeyringStore), accounts_file)
    }
}

#[cfg(test)]
pub(crate) mod memory {
    //! Cofre na memória, para os testes: conta leituras, gravações e quantas vezes apagou.
    use super::SecretStore;
    use std::collections::{HashMap, HashSet};
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    pub struct Inner {
        pub items: HashMap<(String, String), String>,
        /// itens que dão erro ao ler (como se a pessoa negasse o acesso)
        pub failing: HashSet<(String, String)>,
        pub reads: usize,
        pub writes: usize,
        pub deletes: usize,
    }

    #[derive(Clone, Default)]
    pub struct MemoryStore(pub Arc<Mutex<Inner>>);

    impl MemoryStore {
        pub fn put(&self, service: &str, account: &str, value: &str) {
            self.0.lock().unwrap().items.insert((service.into(), account.into()), value.into());
        }
        pub fn item(&self, service: &str, account: &str) -> Option<String> {
            self.0.lock().unwrap().items.get(&(service.into(), account.into())).cloned()
        }
        pub fn fail(&self, service: &str, account: &str) {
            self.0.lock().unwrap().failing.insert((service.into(), account.into()));
        }
        pub fn reads(&self) -> usize {
            self.0.lock().unwrap().reads
        }
        pub fn writes(&self) -> usize {
            self.0.lock().unwrap().writes
        }
    }

    impl SecretStore for MemoryStore {
        fn get(&self, service: &str, account: &str) -> Result<Option<String>, String> {
            let mut s = self.0.lock().unwrap();
            s.reads += 1;
            let key = (service.to_string(), account.to_string());
            if s.failing.contains(&key) {
                return Err("acesso negado".into());
            }
            Ok(s.items.get(&key).cloned())
        }
        fn set(&self, service: &str, account: &str, value: &str) -> Result<(), String> {
            let mut s = self.0.lock().unwrap();
            s.writes += 1;
            s.items.insert((service.into(), account.into()), value.into());
            Ok(())
        }
        fn delete(&self, service: &str, account: &str) -> Result<(), String> {
            let mut s = self.0.lock().unwrap();
            s.deletes += 1;
            s.items.remove(&(service.to_string(), account.to_string()));
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::memory::MemoryStore;
    use super::*;
    use crate::accounts::Account;

    fn temp_accounts(accounts: &[Account]) -> PathBuf {
        let file = std::env::temp_dir().join(format!("quill-vault-{}.json", crate::oauth::random_token(8)));
        let store = AccountStore::new(file.clone());
        for a in accounts {
            store.add(a.clone()).unwrap();
        }
        file
    }

    fn imap_account(email: &str) -> Account {
        Account::imap(crate::imap::ImapConfig {
            email: email.into(),
            provider: "icloud".into(),
            name: None,
            username: email.into(),
            imap_host: "imap.mail.me.com".into(),
            imap_port: 993,
            smtp_host: "smtp.mail.me.com".into(),
            smtp_port: 587,
            smtp_security: None,
        })
    }

    fn vault_with(store: &MemoryStore, accounts: &[Account]) -> Vault {
        Vault::new(Box::new(store.clone()), temp_accounts(accounts))
    }

    fn unified(store: &MemoryStore) -> Secrets {
        serde_json::from_str(&store.item(VAULT_SERVICE, VAULT_ACCOUNT).expect("cofre único gravado")).unwrap()
    }

    #[test]
    fn le_as_chaves_uma_vez_so_por_abertura() {
        let store = MemoryStore::default();
        store.put(VAULT_SERVICE, VAULT_ACCOUNT, r#"{"google":{"ana@gmail.com":"r1"},"imap":{"bia@icloud.com":"s1"}}"#);
        let v = vault_with(&store, &[]);
        for _ in 0..5 {
            assert_eq!(v.get(SecretKind::Google, "ana@gmail.com").unwrap().as_deref(), Some("r1"));
            assert_eq!(v.get(SecretKind::Imap, "bia@icloud.com").unwrap().as_deref(), Some("s1"));
        }
        assert_eq!(store.reads(), 1);
        assert_eq!(store.writes(), 0);
    }

    #[test]
    fn email_vale_sem_diferenca_de_maiusculas() {
        let store = MemoryStore::default();
        let v = vault_with(&store, &[]);
        v.set(SecretKind::Google, "Ana@Gmail.com", "r1").unwrap();
        assert_eq!(v.get(SecretKind::Google, "ana@gmail.com").unwrap().as_deref(), Some("r1"));
        assert!(unified(&store).google.contains_key("ana@gmail.com"));
    }

    #[test]
    fn conta_sem_segredo_devolve_none() {
        let store = MemoryStore::default();
        let v = vault_with(&store, &[]);
        assert_eq!(v.get(SecretKind::Google, "ana@gmail.com").unwrap(), None);
        // o tipo importa: senha de IMAP não serve como token do Google
        v.set(SecretKind::Imap, "ana@gmail.com", "s1").unwrap();
        assert_eq!(v.get(SecretKind::Google, "ana@gmail.com").unwrap(), None);
    }

    #[test]
    fn set_grava_tudo_num_item_so() {
        let store = MemoryStore::default();
        let v = vault_with(&store, &[]);
        v.set(SecretKind::Google, "ana@gmail.com", "r1").unwrap();
        v.set(SecretKind::Imap, "bia@icloud.com", "s1").unwrap();
        let s = unified(&store);
        assert_eq!(s.google.get("ana@gmail.com").map(String::as_str), Some("r1"));
        assert_eq!(s.imap.get("bia@icloud.com").map(String::as_str), Some("s1"));
        assert_eq!(store.0.lock().unwrap().items.len(), 1);
    }

    #[test]
    fn set_com_o_mesmo_valor_nao_grava_de_novo() {
        let store = MemoryStore::default();
        let v = vault_with(&store, &[]);
        v.set(SecretKind::Google, "ana@gmail.com", "r1").unwrap();
        let writes = store.writes();
        v.set(SecretKind::Google, "ana@gmail.com", "r1").unwrap();
        assert_eq!(store.writes(), writes);
        v.set(SecretKind::Google, "ana@gmail.com", "r2").unwrap();
        assert_eq!(store.writes(), writes + 1);
        assert_eq!(unified(&store).google["ana@gmail.com"], "r2");
    }

    #[test]
    fn remove_tira_a_conta_e_so_grava_se_existia() {
        let store = MemoryStore::default();
        let v = vault_with(&store, &[]);
        v.set(SecretKind::Google, "ana@gmail.com", "r1").unwrap();
        v.set(SecretKind::Imap, "bia@icloud.com", "s1").unwrap();
        let writes = store.writes();
        v.remove(SecretKind::Google, "ANA@gmail.com").unwrap();
        assert_eq!(store.writes(), writes + 1);
        assert_eq!(v.get(SecretKind::Google, "ana@gmail.com").unwrap(), None);
        let s = unified(&store);
        assert!(s.google.is_empty());
        assert_eq!(s.imap.len(), 1);
        v.remove(SecretKind::Google, "ninguem@gmail.com").unwrap();
        assert_eq!(store.writes(), writes + 1);
    }

    #[test]
    fn migra_os_itens_antigos_das_contas_e_apaga_eles() {
        let store = MemoryStore::default();
        store.put(LEGACY_GOOGLE_SERVICE, "ana@gmail.com", "r1");
        store.put(LEGACY_IMAP_SERVICE, "bia@icloud.com", "s1");
        // item antigo de conta que não está mais no accounts.json: não é lido nem apagado
        store.put(LEGACY_GOOGLE_SERVICE, "velha@gmail.com", "r0");
        let v = vault_with(&store, &[Account::google("ana@gmail.com"), imap_account("bia@icloud.com")]);

        assert_eq!(v.get(SecretKind::Google, "ana@gmail.com").unwrap().as_deref(), Some("r1"));
        assert_eq!(v.get(SecretKind::Imap, "bia@icloud.com").unwrap().as_deref(), Some("s1"));

        let s = unified(&store);
        assert_eq!(s.google.len(), 1);
        assert_eq!(s.imap.get("bia@icloud.com").map(String::as_str), Some("s1"));
        assert_eq!(store.item(LEGACY_GOOGLE_SERVICE, "ana@gmail.com"), None);
        assert_eq!(store.item(LEGACY_IMAP_SERVICE, "bia@icloud.com"), None);
        assert_eq!(store.item(LEGACY_GOOGLE_SERVICE, "velha@gmail.com").as_deref(), Some("r0"));
    }

    #[test]
    fn depois_de_migrar_a_proxima_abertura_le_um_item_so() {
        let store = MemoryStore::default();
        store.put(LEGACY_GOOGLE_SERVICE, "ana@gmail.com", "r1");
        store.put(LEGACY_GOOGLE_SERVICE, "caio@gmail.com", "r2");
        let accounts = [Account::google("ana@gmail.com"), Account::google("caio@gmail.com")];
        vault_with(&store, &accounts).get(SecretKind::Google, "ana@gmail.com").unwrap();

        let before = store.reads();
        let v = vault_with(&store, &accounts);
        assert_eq!(v.get(SecretKind::Google, "caio@gmail.com").unwrap().as_deref(), Some("r2"));
        assert_eq!(v.get(SecretKind::Google, "ana@gmail.com").unwrap().as_deref(), Some("r1"));
        assert_eq!(store.reads(), before + 1);
    }

    #[test]
    fn item_antigo_que_nao_abriu_fica_guardado() {
        let store = MemoryStore::default();
        store.put(LEGACY_GOOGLE_SERVICE, "ana@gmail.com", "r1");
        store.put(LEGACY_GOOGLE_SERVICE, "caio@gmail.com", "r2");
        store.fail(LEGACY_GOOGLE_SERVICE, "caio@gmail.com");
        let v = vault_with(&store, &[Account::google("ana@gmail.com"), Account::google("caio@gmail.com")]);

        assert_eq!(v.get(SecretKind::Google, "ana@gmail.com").unwrap().as_deref(), Some("r1"));
        assert_eq!(v.get(SecretKind::Google, "caio@gmail.com").unwrap(), None);
        assert_eq!(store.item(LEGACY_GOOGLE_SERVICE, "ana@gmail.com"), None);
        assert_eq!(store.item(LEGACY_GOOGLE_SERVICE, "caio@gmail.com").as_deref(), Some("r2"));
    }

    #[test]
    fn sem_itens_antigos_nao_cria_o_cofre_a_toa() {
        let store = MemoryStore::default();
        let v = vault_with(&store, &[Account::google("ana@gmail.com")]);
        assert_eq!(v.get(SecretKind::Google, "ana@gmail.com").unwrap(), None);
        assert_eq!(store.writes(), 0);
        assert_eq!(store.item(VAULT_SERVICE, VAULT_ACCOUNT), None);
    }

    #[test]
    fn cofre_que_nao_abriu_nao_e_sobrescrito_nem_pede_de_novo() {
        let store = MemoryStore::default();
        store.put(VAULT_SERVICE, VAULT_ACCOUNT, r#"{"google":{"ana@gmail.com":"r1"}}"#);
        store.fail(VAULT_SERVICE, VAULT_ACCOUNT);
        store.put(LEGACY_GOOGLE_SERVICE, "caio@gmail.com", "r2");
        let v = vault_with(&store, &[Account::google("caio@gmail.com")]);

        assert!(v.get(SecretKind::Google, "ana@gmail.com").is_err());
        assert!(v.set(SecretKind::Google, "caio@gmail.com", "r3").is_err());
        assert!(v.remove(SecretKind::Google, "ana@gmail.com").is_err());
        assert!(v.get(SecretKind::Imap, "bia@icloud.com").is_err());
        // uma leitura só (sem repetir o pedido de senha) e nada gravado nem apagado
        assert_eq!(store.reads(), 1);
        assert_eq!(store.writes(), 0);
        assert_eq!(store.item(LEGACY_GOOGLE_SERVICE, "caio@gmail.com").as_deref(), Some("r2"));
        assert_eq!(store.0.lock().unwrap().items[&(VAULT_SERVICE.into(), VAULT_ACCOUNT.into())], r#"{"google":{"ana@gmail.com":"r1"}}"#);
    }

    #[test]
    fn cofre_estragado_comeca_vazio() {
        let store = MemoryStore::default();
        store.put(VAULT_SERVICE, VAULT_ACCOUNT, "isto não é json");
        let v = vault_with(&store, &[]);
        assert_eq!(v.get(SecretKind::Google, "ana@gmail.com").unwrap(), None);
        v.set(SecretKind::Google, "ana@gmail.com", "r1").unwrap();
        assert_eq!(unified(&store).google["ana@gmail.com"], "r1");
    }

    #[test]
    fn debug_nao_mostra_os_segredos() {
        let mut s = Secrets::default();
        s.google.insert("ana@gmail.com".into(), "segredo-google".into());
        s.imap.insert("bia@icloud.com".into(), "segredo-imap".into());
        let shown = format!("{s:?}");
        assert!(shown.contains("ana@gmail.com"));
        assert!(!shown.contains("segredo"));
    }

    #[test]
    fn erro_ao_gravar_nao_mostra_o_segredo() {
        struct Broken;
        impl SecretStore for Broken {
            fn get(&self, _: &str, _: &str) -> Result<Option<String>, String> {
                Ok(None)
            }
            fn set(&self, _: &str, _: &str, _: &str) -> Result<(), String> {
                Err("cofre trancado".into())
            }
            fn delete(&self, _: &str, _: &str) -> Result<(), String> {
                Ok(())
            }
        }
        let v = Vault::new(Box::new(Broken), temp_accounts(&[]));
        let err = v.set(SecretKind::Imap, "bia@icloud.com", "senha-secreta").unwrap_err();
        assert!(!err.contains("senha-secreta"));
        // não guardou na memória o que não conseguiu gravar
        assert_eq!(v.get(SecretKind::Imap, "bia@icloud.com").unwrap(), None);
    }

    #[cfg(feature = "desktop")]
    #[test]
    fn chaves_do_sistema_item_inexistente_e_none() {
        // cofre "de mentira" do próprio keyring: nada toca nas Chaves de verdade
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        assert_eq!(KeyringStore.get(VAULT_SERVICE, "nao-existe").unwrap(), None);
        KeyringStore.delete(VAULT_SERVICE, "nao-existe").unwrap();
        KeyringStore.set(VAULT_SERVICE, "teste", "valor").unwrap();
    }
}
