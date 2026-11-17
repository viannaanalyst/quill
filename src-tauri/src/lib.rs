//! Parte nativa do Quill: comandos que as telas chamam para entrar com o Google e ler os e-mails.
//! A lógica fica em `crates/quill-core` (testada); aqui só a ligação com o Tauri.

use std::time::{SystemTime, UNIX_EPOCH};

use quill_core::gmail::MessageSummary;
use quill_core::google::LoginError;
use quill_core::session::GoogleSession;
use serde::Serialize;
use tauri::{Manager, State};

struct AppState {
    google: Option<GoogleSession>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountInfo {
    email: String,
    provider: String,
    messages_total: Option<u64>,
}

/// Erros para a tela: "needs_login" (entrar de novo), "not_configured" ou uma frase explicando.
fn err(e: LoginError) -> String {
    match e {
        LoginError::NeedsLogin => "needs_login".into(),
        other => other.to_string(),
    }
}

fn google(state: &State<'_, AppState>) -> Result<&GoogleSession, String> {
    state.google.as_ref().ok_or_else(|| "not_configured".to_string())
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[tauri::command]
async fn google_sign_in(state: State<'_, AppState>, login_hint: Option<String>) -> Result<AccountInfo, String> {
    let (account, profile) = google(&state)?.sign_in(login_hint).await.map_err(err)?;
    Ok(AccountInfo { email: account.email, provider: account.provider, messages_total: Some(profile.messages_total) })
}

#[tauri::command]
fn accounts_list(state: State<'_, AppState>) -> Vec<AccountInfo> {
    state
        .google
        .as_ref()
        .map(|g| {
            g.accounts()
                .into_iter()
                .map(|a| AccountInfo { email: a.email, provider: a.provider, messages_total: None })
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
fn account_remove(state: State<'_, AppState>, email: String) -> Result<(), String> {
    google(&state)?.remove(&email).map_err(err)
}

#[tauri::command]
async fn inbox_fetch(state: State<'_, AppState>, email: String, tz_offset_min: i32) -> Result<Vec<MessageSummary>, String> {
    google(&state)?.inbox(&email, 30, now_ms(), tz_offset_min).await.map_err(err)
}

#[tauri::command]
async fn message_body(state: State<'_, AppState>, email: String, id: String) -> Result<String, String> {
    google(&state)?.body(&email, &id).await.map_err(err)
}

#[tauri::command]
async fn message_mark_read(state: State<'_, AppState>, email: String, id: String) -> Result<(), String> {
    google(&state)?.mark_read(&email, &id).await.map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let google = match (option_env!("QUILL_GOOGLE_CLIENT_ID"), option_env!("QUILL_GOOGLE_CLIENT_SECRET")) {
                (Some(id), Some(secret)) => Some(GoogleSession::new(id, secret, data_dir.join("accounts.json"))),
                _ => None,
            };
            app.manage(AppState { google });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            google_sign_in,
            accounts_list,
            account_remove,
            inbox_fetch,
            message_body,
            message_mark_read
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Quill");
}
