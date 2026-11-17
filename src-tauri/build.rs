//! Coloca as credenciais do app do Google no programa na hora de montar.
//! Origem (nessa ordem): variáveis de ambiente (ex.: `infisical run --env=prod -- npm run tauri build`)
//! ou o arquivo `src-tauri/oauth.local.env`, que fica fora do git.
//! Sem credenciais o app monta normalmente; só o botão "Continuar com Google" avisa que falta configurar.
use std::collections::HashMap;

fn main() {
    println!("cargo:rerun-if-env-changed=GOOGLE_OAUTH_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=GOOGLE_OAUTH_CLIENT_SECRET");
    println!("cargo:rerun-if-changed=oauth.local.env");

    let mut values: HashMap<String, String> = HashMap::new();
    if let Ok(text) = std::fs::read_to_string("oauth.local.env") {
        for line in text.lines() {
            if let Some((k, v)) = line.split_once('=') {
                values.insert(k.trim().to_string(), v.trim().trim_matches('"').trim_matches('\'').to_string());
            }
        }
    }
    for key in ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"] {
        if let Ok(v) = std::env::var(key) {
            if !v.is_empty() {
                values.insert(key.to_string(), v);
            }
        }
    }
    for (key, out) in [("GOOGLE_OAUTH_CLIENT_ID", "QUILL_GOOGLE_CLIENT_ID"), ("GOOGLE_OAUTH_CLIENT_SECRET", "QUILL_GOOGLE_CLIENT_SECRET")] {
        if let Some(v) = values.get(key) {
            println!("cargo:rustc-env={out}={v}");
        }
    }

    tauri_build::build()
}
