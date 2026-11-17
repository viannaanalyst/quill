//! Ícone do Dock escolhido pela pessoa (Ajustes → Aparência). Vale enquanto o app está aberto;
//! com o app fechado, o Dock mostra o ícone padrão do Quill.

/// Troca o ícone do Dock pela imagem PNG dada; sem bytes, volta ao padrão. Precisa da linha principal.
#[cfg(target_os = "macos")]
pub fn set_icon(png: Option<Vec<u8>>) -> Result<(), String> {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let mtm = MainThreadMarker::new().ok_or("precisa rodar na linha principal do app")?;
    let app = NSApplication::sharedApplication(mtm);
    match png {
        Some(bytes) => {
            let data = NSData::with_bytes(&bytes);
            let image = NSImage::initWithData(NSImage::alloc(), &data).ok_or("imagem do ícone inválida")?;
            // SAFETY: chamada simples do AppKit na linha principal, com uma imagem válida.
            unsafe { app.setApplicationIconImage(Some(&image)) };
        }
        // SAFETY: idem; None volta ao ícone do pacote do app.
        None => unsafe { app.setApplicationIconImage(None) },
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_icon(_png: Option<Vec<u8>>) -> Result<(), String> {
    Ok(())
}
