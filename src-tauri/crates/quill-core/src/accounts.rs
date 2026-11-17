//! Lista das contas conectadas (só e-mail e serviço; senhas e tokens ficam no cofre do sistema).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub email: String,
    /// "google" por enquanto; depois "microsoft", "icloud", "imap"
    pub provider: String,
}

impl Account {
    pub fn google(email: &str) -> Self {
        Self { email: email.to_lowercase(), provider: "google".into() }
    }
}

/// Arquivo `accounts.json` na pasta de dados do app.
pub struct AccountStore {
    path: PathBuf,
}

impl AccountStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn list(&self) -> Vec<Account> {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save(&self, accounts: &[Account]) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_string_pretty(accounts).expect("lista serializável");
        // grava num arquivo temporário e troca, para nunca deixar o arquivo pela metade
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(tmp, &self.path)
    }

    pub fn add(&self, account: Account) -> std::io::Result<()> {
        let mut all = self.list();
        if !all.iter().any(|a| a.email.eq_ignore_ascii_case(&account.email)) {
            all.push(account);
        }
        self.save(&all)
    }

    pub fn remove(&self, email: &str) -> std::io::Result<()> {
        let all: Vec<Account> = self.list().into_iter().filter(|a| !a.email.eq_ignore_ascii_case(email)).collect();
        self.save(&all)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("quill-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("accounts.json")
    }

    #[test]
    fn empty_when_file_does_not_exist() {
        let store = AccountStore::new(temp_file("empty"));
        assert!(store.list().is_empty());
    }

    #[test]
    fn added_accounts_are_saved_and_read_back() {
        let path = temp_file("add");
        AccountStore::new(path.clone()).add(Account::google("gabriel@exemplo.com")).unwrap();
        let again = AccountStore::new(path);
        assert_eq!(again.list(), vec![Account::google("gabriel@exemplo.com")]);
    }

    #[test]
    fn adding_same_email_twice_keeps_one() {
        let store = AccountStore::new(temp_file("dup"));
        store.add(Account::google("a@x.com")).unwrap();
        store.add(Account::google("A@x.com")).unwrap();
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn removed_account_disappears() {
        let store = AccountStore::new(temp_file("rm"));
        store.add(Account::google("a@x.com")).unwrap();
        store.add(Account::google("b@x.com")).unwrap();
        store.remove("a@x.com").unwrap();
        assert_eq!(store.list(), vec![Account::google("b@x.com")]);
    }
}
