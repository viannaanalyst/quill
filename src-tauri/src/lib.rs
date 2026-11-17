//! Parte nativa do Quill. Por enquanto só abre a janela; contas, cofre de senhas,
//! agenda e Touch ID entram aqui nas próximas etapas.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Quill");
}
