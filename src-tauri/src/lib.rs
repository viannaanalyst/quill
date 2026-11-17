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
        LoginError::Cancelled => "cancelled".into(),
        other => other.to_string(),
    }
}

fn google(state: &AppState) -> Result<&GoogleSession, String> {
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

/// Cancela o login em andamento (botão Cancelar na tela).
#[tauri::command]
fn google_sign_in_cancel(state: State<'_, AppState>) -> Result<(), String> {
    google(&state)?.cancel_sign_in();
    Ok(())
}

/// Abre de novo a página de login do Google em andamento.
#[tauri::command]
fn google_sign_in_reopen(state: State<'_, AppState>) -> Result<(), String> {
    google(&state)?.reopen_auth_url().map_err(err)
}

/// Endereço da página de login em andamento (para copiar e colar em outro navegador).
#[tauri::command]
fn google_sign_in_url(state: State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(google(&state)?.auth_url())
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
async fn folder_fetch(state: State<'_, AppState>, email: String, folder: String, tz_offset_min: i32) -> Result<Vec<MessageSummary>, String> {
    google(&state)?.folder(&email, &folder, 30, now_ms(), tz_offset_min).await.map_err(err)
}

#[tauri::command]
async fn folder_counts(state: State<'_, AppState>, email: String) -> Result<std::collections::HashMap<String, u64>, String> {
    google(&state)?.counts(&email).await.map_err(err)
}

/// Nome e foto da conta; sem o escopo "profile" (contas antigas) devolve vazio em vez de erro.
#[tauri::command]
async fn account_profile(state: State<'_, AppState>, email: String) -> Result<quill_core::gmail::UserInfo, String> {
    Ok(google(&state)?.profile(&email).await.unwrap_or_default())
}

#[tauri::command]
async fn message_body(state: State<'_, AppState>, email: String, id: String) -> Result<quill_core::gmail::MessageBody, String> {
    google(&state)?.body(&email, &id).await.map_err(err)
}

#[tauri::command]
async fn message_mark_read(state: State<'_, AppState>, email: String, id: String) -> Result<(), String> {
    google(&state)?.mark_read(&email, &id).await.map_err(err)
}

/// Envia um e-mail pela conta `message.from`; `thread_id` mantém a resposta na mesma conversa.
#[tauri::command]
async fn message_send(state: State<'_, AppState>, message: quill_core::gmail::OutgoingMessage, thread_id: Option<String>) -> Result<String, String> {
    if message.to.is_empty() && message.cc.is_empty() && message.bcc.is_empty() {
        return Err("Coloque pelo menos um destinatário.".into());
    }
    google(&state)?.send(&message, thread_id.as_deref()).await.map_err(err)
}

/// Arquivar, spam, estrela, não lido, lixeira… (ver GoogleSession::act).
#[tauri::command]
async fn message_action(state: State<'_, AppState>, email: String, id: String, action: String) -> Result<(), String> {
    google(&state)?.act(&email, &id, &action).await.map_err(err)
}

/// Agendas e eventos de uma conta Google entre duas datas (RFC 3339).
#[tauri::command]
async fn calendar_agenda(state: State<'_, AppState>, email: String, time_min: String, time_max: String) -> Result<quill_core::session::Agenda, String> {
    google(&state)?.agenda(&email, &time_min, &time_max).await.map_err(err)
}

/// Responde a um convite: accepted, declined ou tentative.
#[tauri::command]
async fn calendar_rsvp(state: State<'_, AppState>, email: String, calendar_id: String, event_id: String, status: String) -> Result<(), String> {
    google(&state)?.rsvp(&email, &calendar_id, &event_id, &status).await.map_err(err)
}

#[tauri::command]
async fn calendar_create(
    state: State<'_, AppState>,
    email: String,
    calendar_id: String,
    event: quill_core::calendar::NewEvent,
) -> Result<quill_core::calendar::CalEvent, String> {
    google(&state)?.create_event(&email, &calendar_id, &event).await.map_err(err)
}

/// Baixa um anexo e faz o que a pessoa pediu:
/// "save" guarda em Downloads (e devolve o caminho), "open" guarda e abre no app padrão,
/// "preview" guarda numa pasta temporária do Quill e mostra o Quick Look (Mac).
#[tauri::command]
async fn attachment_get(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    email: String,
    message_id: String,
    attachment_id: String,
    name: String,
    action: String,
) -> Result<String, String> {
    let bytes = google(&state)?.attachment(&email, &message_id, &attachment_id).await.map_err(err)?;
    let dir = match action.as_str() {
        "preview" => app.path().app_cache_dir().map_err(|e| e.to_string())?.join("previa"),
        _ => app.path().download_dir().map_err(|e| e.to_string())?,
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = if action == "preview" {
        dir.join(quill_core::files::safe_file_name(&name))
    } else {
        quill_core::files::unique_path(&dir, &name)
    };
    std::fs::write(&path, bytes).map_err(|e| format!("não consegui salvar o arquivo: {e}"))?;
    match action.as_str() {
        "open" => quill_core::files::open_file(&path)?,
        "preview" => quill_core::files::quick_look(&path)?,
        _ => {}
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Mostra um arquivo baixado pelo Quill na pasta (Finder no Mac). Só aceita a pasta Downloads.
#[tauri::command]
fn reveal_download(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    let p = std::path::PathBuf::from(&path);
    if !p.starts_with(&downloads) {
        return Err("caminho fora de Downloads".into());
    }
    quill_core::files::open_file(p.parent().unwrap_or(&downloads))
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
            google_sign_in_cancel,
            google_sign_in_reopen,
            google_sign_in_url,
            accounts_list,
            account_remove,
            inbox_fetch,
            folder_fetch,
            folder_counts,
            account_profile,
            message_body,
            message_mark_read,
            message_send,
            message_action,
            calendar_agenda,
            calendar_rsvp,
            calendar_create,
            attachment_get,
            reveal_download
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Quill");
}
