//! Parte nativa do Quill: comandos que as telas chamam para entrar (Google, iCloud ou IMAP) e ler os e-mails.
//! Cada comando de e-mail olha o provedor da conta: iCloud/IMAP vai por `ImapSession`, o resto pelo Google.
//! Agenda e contatos do iCloud vão por CalDAV/CardDAV (`ICloudDav`), com a mesma senha de app do e-mail.
//! A lógica fica em `crates/quill-core` (testada); aqui só a ligação com o Tauri.

mod dock;
mod touchid;

use std::time::{SystemTime, UNIX_EPOCH};

use quill_core::dav_client::{Creds, DavError, ICloudDav};
use quill_core::gmail::MessageSummary;
use quill_core::google::LoginError;
use quill_core::imap::{ImapConfig, ImapError};
use quill_core::imap_session::ImapSession;
use quill_core::session::GoogleSession;
use serde::Serialize;
use tauri::{Manager, State};

struct AppState {
    google: Option<GoogleSession>,
    /// contas iCloud e IMAP (não dependem das credenciais do Google)
    imap: ImapSession,
    /// agenda e contatos das contas iCloud (CalDAV/CardDAV)
    icloud: ICloudDav,
    accounts_file: std::path::PathBuf,
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

/// Erros das contas IMAP: senha recusada ou fora do cofre vira "needs_login" (conectar de novo).
fn imap_err(e: ImapError) -> String {
    match e {
        ImapError::NeedsLogin | ImapError::Auth { .. } => "needs_login".into(),
        other => other.to_string(),
    }
}

/// Contas "Outro e-mail" (IMAP genérico) não têm agenda.
const IMAP_NO_CALENDAR: &str = "A agenda dessa conta ainda não está disponível no Quill.";

/// Erros da agenda/contatos do iCloud: senha recusada vira "needs_login" (conectar de novo).
fn dav_err(e: DavError) -> String {
    match e {
        DavError::NeedsLogin => "needs_login".into(),
        other => other.to_string(),
    }
}

/// E-mail e senha de app (do cofre) de uma conta iCloud, para o CalDAV/CardDAV.
fn icloud_creds(state: &AppState, email: &str) -> Result<Creds, String> {
    state.imap.icloud_creds(email).map_err(imap_err)
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

/// Todas as contas conectadas (Google, iCloud e IMAP), com o provedor de cada uma.
#[tauri::command]
fn accounts_list(state: State<'_, AppState>) -> Vec<AccountInfo> {
    quill_core::accounts::AccountStore::new(state.accounts_file.clone())
        .list()
        .into_iter()
        // contas Google só aparecem quando o login do Google está configurado nesta versão
        .filter(|a| a.imap.is_some() || state.google.is_some())
        .map(|a| AccountInfo { email: a.email, provider: a.provider, messages_total: None })
        .collect()
}

#[tauri::command]
fn account_remove(state: State<'_, AppState>, email: String) -> Result<(), String> {
    if state.imap.is_imap(&email) {
        return state.imap.remove(&email).map_err(imap_err);
    }
    google(&state)?.remove(&email).map_err(err)
}

/// Palpite de servidores IMAP/SMTP para o formulário (domínio conhecido, MX ou imap./smtp.<domínio>).
#[tauri::command]
async fn imap_guess(state: State<'_, AppState>, email: String, provider: String) -> Result<quill_core::imap_client::Guess, String> {
    Ok(state.imap.guess(&email, &provider).await)
}

/// Conecta uma conta iCloud/IMAP: testa a entrada no IMAP e no SMTP e só então guarda
/// a senha de app nas Chaves do sistema. Erro vem como frase pronta para mostrar.
#[tauri::command]
async fn imap_connect(state: State<'_, AppState>, config: ImapConfig, password: String) -> Result<AccountInfo, String> {
    let account = state.imap.connect(&config, &password).await.map_err(|e| e.to_string())?;
    Ok(AccountInfo { email: account.email, provider: account.provider, messages_total: None })
}

#[tauri::command]
async fn inbox_fetch(state: State<'_, AppState>, email: String, tz_offset_min: i32) -> Result<Vec<MessageSummary>, String> {
    if state.imap.is_imap(&email) {
        return state.imap.folder(&email, "inbox", 30, now_ms(), tz_offset_min).await.map_err(imap_err);
    }
    google(&state)?.inbox(&email, 30, now_ms(), tz_offset_min).await.map_err(err)
}

#[tauri::command]
async fn folder_fetch(state: State<'_, AppState>, email: String, folder: String, tz_offset_min: i32) -> Result<Vec<MessageSummary>, String> {
    if state.imap.is_imap(&email) {
        return state.imap.folder(&email, &folder, 30, now_ms(), tz_offset_min).await.map_err(imap_err);
    }
    google(&state)?.folder(&email, &folder, 30, now_ms(), tz_offset_min).await.map_err(err)
}

#[tauri::command]
async fn folder_counts(state: State<'_, AppState>, email: String) -> Result<std::collections::HashMap<String, u64>, String> {
    if state.imap.is_imap(&email) {
        return state.imap.counts(&email).await.map_err(imap_err);
    }
    google(&state)?.counts(&email).await.map_err(err)
}

/// Nome e foto da conta; sem o escopo "profile" (contas antigas) devolve vazio em vez de erro.
/// Contas IMAP: só o nome informado ao conectar.
#[tauri::command]
async fn account_profile(state: State<'_, AppState>, email: String) -> Result<quill_core::gmail::UserInfo, String> {
    if state.imap.is_imap(&email) {
        return Ok(state.imap.profile(&email));
    }
    Ok(google(&state)?.profile(&email).await.unwrap_or_default())
}

#[tauri::command]
async fn message_body(state: State<'_, AppState>, email: String, id: String) -> Result<quill_core::gmail::MessageBody, String> {
    if state.imap.is_imap(&email) {
        return state.imap.body(&email, &id).await.map_err(imap_err);
    }
    google(&state)?.body(&email, &id).await.map_err(err)
}

#[tauri::command]
async fn message_mark_read(state: State<'_, AppState>, email: String, id: String) -> Result<(), String> {
    if state.imap.is_imap(&email) {
        return state.imap.mark_read(&email, &id).await.map_err(imap_err);
    }
    google(&state)?.mark_read(&email, &id).await.map_err(err)
}

/// Envia um e-mail pela conta `message.from`; `thread_id` mantém a resposta na mesma conversa.
#[tauri::command]
async fn message_send(state: State<'_, AppState>, message: quill_core::gmail::OutgoingMessage, thread_id: Option<String>) -> Result<String, String> {
    if message.to.is_empty() && message.cc.is_empty() && message.bcc.is_empty() {
        return Err("Coloque pelo menos um destinatário.".into());
    }
    if state.imap.is_imap(&message.from) {
        return state.imap.send(&message).await.map_err(imap_err);
    }
    google(&state)?.send(&message, thread_id.as_deref()).await.map_err(err)
}

/// Cria ou atualiza o rascunho no Gmail (salvo sozinho enquanto a pessoa escreve).
#[tauri::command]
async fn draft_save(
    state: State<'_, AppState>,
    message: quill_core::gmail::OutgoingMessage,
    draft_id: Option<String>,
    thread_id: Option<String>,
) -> Result<String, String> {
    if state.imap.is_imap(&message.from) {
        return state.imap.draft_save(&message, draft_id.as_deref()).await.map_err(imap_err);
    }
    google(&state)?.draft_save(&message, draft_id.as_deref(), thread_id.as_deref()).await.map_err(err)
}

#[tauri::command]
async fn draft_delete(state: State<'_, AppState>, email: String, draft_id: String) -> Result<(), String> {
    if state.imap.is_imap(&email) {
        return state.imap.draft_delete(&email, &draft_id).await.map_err(imap_err);
    }
    google(&state)?.draft_delete(&email, &draft_id).await.map_err(err)
}

#[tauri::command]
async fn draft_get(state: State<'_, AppState>, email: String, message_id: String) -> Result<quill_core::gmail::DraftContent, String> {
    if state.imap.is_imap(&email) {
        return state.imap.draft_get(&email, &message_id).await.map_err(imap_err);
    }
    google(&state)?.draft_get(&email, &message_id).await.map_err(err)
}

/// Arquivar, spam, estrela, não lido, lixeira… (ver GoogleSession::act).
#[tauri::command]
async fn message_action(state: State<'_, AppState>, email: String, id: String, action: String) -> Result<(), String> {
    if state.imap.is_imap(&email) {
        return state.imap.act(&email, &id, &action).await.map_err(imap_err);
    }
    google(&state)?.act(&email, &id, &action).await.map_err(err)
}

/// Agendas e eventos de uma conta entre duas datas (RFC 3339): Google, ou iCloud pelo CalDAV.
/// Contas "Outro e-mail" não têm agenda (devolve vazio).
#[tauri::command]
async fn calendar_agenda(state: State<'_, AppState>, email: String, time_min: String, time_max: String) -> Result<quill_core::session::Agenda, String> {
    if state.imap.is_imap(&email) {
        if !state.imap.is_icloud(&email) {
            return Ok(quill_core::session::Agenda { calendars: Vec::new(), events: Vec::new() });
        }
        let creds = icloud_creds(&state, &email)?;
        let (calendars, events) = state.icloud.agenda(&email, &creds, &time_min, &time_max).await.map_err(dav_err)?;
        return Ok(quill_core::session::Agenda { calendars, events });
    }
    google(&state)?.agenda(&email, &time_min, &time_max).await.map_err(err)
}

/// Sugestões de destinatário de uma conta: contatos (Google ou iCloud) e quem aparece nos enviados.
#[tauri::command]
async fn contacts_list(state: State<'_, AppState>, email: String) -> Result<Vec<quill_core::contacts::Contact>, String> {
    if state.imap.is_imap(&email) {
        if !state.imap.is_icloud(&email) {
            return Ok(Vec::new());
        }
        let creds = icloud_creds(&state, &email)?;
        let sent = async {
            match state.imap.folder(&email, "sent", 100, now_ms(), 0).await {
                Ok(list) => quill_core::carddav::contacts_from_sent(&list),
                Err(_) => Vec::new(),
            }
        };
        let own: Vec<String> = quill_core::accounts::AccountStore::new(state.accounts_file.clone()).list().into_iter().map(|a| a.email).collect();
        return Ok(state.icloud.suggestions(&email, &creds, sent, &own).await);
    }
    google(&state)?.contacts(&email).await.map_err(err)
}

/// Responde a um convite: accepted, declined ou tentative.
#[tauri::command]
async fn calendar_rsvp(state: State<'_, AppState>, email: String, calendar_id: String, event_id: String, status: String) -> Result<(), String> {
    if state.imap.is_imap(&email) {
        if !state.imap.is_icloud(&email) {
            return Err(IMAP_NO_CALENDAR.into());
        }
        let creds = icloud_creds(&state, &email)?;
        return state.icloud.rsvp(&email, &creds, &calendar_id, &event_id, &status).await.map_err(dav_err);
    }
    google(&state)?.rsvp(&email, &calendar_id, &event_id, &status).await.map_err(err)
}

#[tauri::command]
async fn calendar_update(
    state: State<'_, AppState>,
    email: String,
    calendar_id: String,
    event_id: String,
    patch: quill_core::calendar::EventPatch,
) -> Result<quill_core::calendar::CalEvent, String> {
    if state.imap.is_imap(&email) {
        if !state.imap.is_icloud(&email) {
            return Err(IMAP_NO_CALENDAR.into());
        }
        let creds = icloud_creds(&state, &email)?;
        return state.icloud.update(&email, &creds, &calendar_id, &event_id, &patch).await.map_err(dav_err);
    }
    google(&state)?.update_event(&email, &calendar_id, &event_id, &patch).await.map_err(err)
}

#[tauri::command]
async fn calendar_delete(state: State<'_, AppState>, email: String, calendar_id: String, event_id: String) -> Result<(), String> {
    if state.imap.is_imap(&email) {
        if !state.imap.is_icloud(&email) {
            return Err(IMAP_NO_CALENDAR.into());
        }
        let creds = icloud_creds(&state, &email)?;
        return state.icloud.delete(&email, &creds, &calendar_id, &event_id).await.map_err(dav_err);
    }
    google(&state)?.delete_event(&email, &calendar_id, &event_id).await.map_err(err)
}

#[tauri::command]
async fn calendar_create(
    state: State<'_, AppState>,
    email: String,
    calendar_id: String,
    event: quill_core::calendar::NewEvent,
) -> Result<quill_core::calendar::CalEvent, String> {
    if state.imap.is_imap(&email) {
        if !state.imap.is_icloud(&email) {
            return Err(IMAP_NO_CALENDAR.into());
        }
        // no iCloud não existe Google Meet: o pedido de sala é ignorado
        let creds = icloud_creds(&state, &email)?;
        return state.icloud.create(&email, &creds, &calendar_id, &event).await.map_err(dav_err);
    }
    google(&state)?.create_event(&email, &calendar_id, &event).await.map_err(err)
}

/// Conteúdo de um anexo, pela conta certa (Google ou IMAP).
async fn attachment_bytes(state: &AppState, email: &str, message_id: &str, attachment_id: &str) -> Result<Vec<u8>, String> {
    if state.imap.is_imap(email) {
        return state.imap.attachment(email, message_id, attachment_id).await.map_err(imap_err);
    }
    google(state)?.attachment(email, message_id, attachment_id).await.map_err(err)
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
    let bytes = attachment_bytes(&state, &email, &message_id, &attachment_id).await?;
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

/// Troca o ícone do Dock (PNG em base64); vazio volta ao ícone padrão.
#[tauri::command]
async fn set_dock_icon(app: tauri::AppHandle, png_base64: String) -> Result<(), String> {
    use base64::Engine;
    let png = if png_base64.is_empty() {
        None
    } else {
        Some(base64::engine::general_purpose::STANDARD.decode(png_base64.trim()).map_err(|_| "imagem inválida".to_string())?)
    };
    if png.as_ref().is_some_and(|b| b.len() > 4 * 1024 * 1024) {
        return Err("imagem grande demais para o ícone".into());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    // comando assíncrono (fora da linha principal): o AppKit roda na principal e a resposta volta pelo canal
    app.run_on_main_thread(move || {
        let _ = tx.send(dock::set_icon(png));
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())??
}

/// O Mac pode pedir Touch ID (ou a senha do Mac)?
#[tauri::command]
fn touch_id_available() -> bool {
    touchid::available()
}

/// Pede o Touch ID. true = confirmado, false = cancelado.
#[tauri::command]
async fn touch_id_authenticate(reason: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || touchid::authenticate(&reason))
        .await
        .map_err(|e| e.to_string())?
}

/// Abre um link de e-mail ou evento no navegador (só http, https e mailto).
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    quill_core::files::open_link(&url)
}

/// Conteúdo de um anexo em base64 (para a prévia dentro do app: imagens, PDF, texto, vídeo).
#[tauri::command]
async fn attachment_data(state: State<'_, AppState>, email: String, message_id: String, attachment_id: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = attachment_bytes(&state, &email, &message_id, &attachment_id).await?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
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
            let accounts_file = data_dir.join("accounts.json");
            let google = match (option_env!("QUILL_GOOGLE_CLIENT_ID"), option_env!("QUILL_GOOGLE_CLIENT_SECRET")) {
                (Some(id), Some(secret)) => Some(GoogleSession::new(id, secret, accounts_file.clone())),
                _ => None,
            };
            let imap = ImapSession::new(accounts_file.clone());
            app.manage(AppState { google, imap, icloud: ICloudDav::default(), accounts_file });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            google_sign_in,
            google_sign_in_cancel,
            google_sign_in_reopen,
            google_sign_in_url,
            accounts_list,
            account_remove,
            imap_guess,
            imap_connect,
            inbox_fetch,
            folder_fetch,
            folder_counts,
            account_profile,
            message_body,
            message_mark_read,
            message_send,
            message_action,
            draft_save,
            draft_delete,
            draft_get,
            calendar_agenda,
            contacts_list,
            calendar_rsvp,
            calendar_create,
            calendar_update,
            calendar_delete,
            attachment_get,
            attachment_data,
            reveal_download,
            open_link,
            touch_id_available,
            set_dock_icon,
            touch_id_authenticate
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Quill");
}
