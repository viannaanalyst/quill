//! Guardar anexos baixados: nome seguro e sem sobrescrever arquivos que já existem.

use std::path::{Path, PathBuf};

/// Nome de arquivo seguro: sem pastas, sem caracteres proibidos, sem começar com ponto.
pub fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim().to_string();
    if cleaned.is_empty() { "anexo".to_string() } else { cleaned }
}

/// Caminho livre na pasta: "nota.pdf", depois "nota (2).pdf", "nota (3).pdf"…
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let name = safe_file_name(name);
    let first = dir.join(&name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name.as_str(), ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("sempre acha um nome livre")
}

/// Link que pode ser aberto fora do app: só páginas da web e e-mail (nada de arquivos ou apps locais).
pub fn is_safe_link(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")
}

/// Pacote `.app` de um executável do Mac (`…/Quill.app/Contents/MacOS/quill` → `…/Quill.app`).
/// Fora de um pacote (modo de desenvolvimento, Windows), `None`.
pub fn app_bundle_root(exe: &std::path::Path) -> Option<std::path::PathBuf> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let named = |p: &std::path::Path, n: &str| p.file_name().is_some_and(|f| f == n);
    (named(macos, "MacOS") && named(contents, "Contents") && bundle.extension().is_some_and(|e| e == "app")).then(|| bundle.to_path_buf())
}

/// Abre um link da web (ou mailto) no navegador padrão.
#[cfg(feature = "desktop")]
pub fn open_link(url: &str) -> Result<(), String> {
    if !is_safe_link(url) {
        return Err("link não permitido".into());
    }
    open::that_detached(url.trim()).map_err(|e| e.to_string())
}

/// Abre o arquivo no app padrão do sistema.
#[cfg(feature = "desktop")]
pub fn open_file(path: &Path) -> Result<(), String> {
    open::that_detached(path).map_err(|e| e.to_string())
}

/// Prévia rápida sem abrir outro app: Quick Look no Mac; nos outros sistemas, abre no app padrão.
#[cfg(feature = "desktop")]
pub fn quick_look(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/qlmanage")
            .arg("-p")
            .arg(path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        open_file(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acha_o_pacote_app_a_partir_do_executavel() {
        use std::path::Path;
        assert_eq!(app_bundle_root(Path::new("/Applications/Quill.app/Contents/MacOS/quill")).as_deref(), Some(Path::new("/Applications/Quill.app")));
        // fora de um pacote .app (npm run tauri dev, Windows) não há pacote para reabrir
        assert_eq!(app_bundle_root(Path::new("/Users/x/quill/target/debug/quill")), None);
        assert_eq!(app_bundle_root(Path::new("/Applications/Quill.app/Contents/Resources/quill")), None);
    }

    #[test]
    fn nome_seguro_tira_pastas_e_caracteres_proibidos() {
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("C:\\Users\\x\\nota:fiscal?.pdf"), "nota_fiscal_.pdf");
        assert_eq!(safe_file_name(".bashrc"), "bashrc");
        assert_eq!(safe_file_name("   "), "anexo");
        assert_eq!(safe_file_name("relatório final.xlsx"), "relatório final.xlsx");
    }

    #[test]
    fn nao_sobrescreve_arquivo_existente() {
        let dir = std::env::temp_dir().join(format!("quill-files-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_path(&dir, "nota.pdf"), dir.join("nota.pdf"));
        std::fs::write(dir.join("nota.pdf"), b"1").unwrap();
        assert_eq!(unique_path(&dir, "nota.pdf"), dir.join("nota (2).pdf"));
        std::fs::write(dir.join("nota (2).pdf"), b"2").unwrap();
        assert_eq!(unique_path(&dir, "nota.pdf"), dir.join("nota (3).pdf"));
        std::fs::write(dir.join("LEIAME"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "LEIAME"), dir.join("LEIAME (2)"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn so_abre_links_da_web_e_de_email() {
        assert!(is_safe_link("https://indeed.com/vaga?id=1"));
        assert!(is_safe_link("http://exemplo.com"));
        assert!(is_safe_link("mailto:ana@x.com"));
        assert!(!is_safe_link("file:///etc/passwd"));
        assert!(!is_safe_link("javascript:alert(1)"));
        assert!(!is_safe_link("/Applications/Calculator.app"));
        assert!(!is_safe_link("smb://servidor/pasta"));
    }
}
