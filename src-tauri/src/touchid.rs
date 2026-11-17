//! Abrir o Quill com Touch ID (no Mac). Usa a autenticação do próprio macOS (LocalAuthentication):
//! digital, ou a senha do Mac quando a digital não dá. Nos outros sistemas, por enquanto não existe.

/// O Mac tem como confirmar o dono (Touch ID ou senha)?
pub fn available() -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2_local_authentication::{LAContext, LAPolicy};
        // SAFETY: chamadas simples ao framework do sistema, sem ponteiros guardados.
        unsafe { LAContext::new().canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication).is_ok() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Pede o Touch ID. `Ok(true)` = confirmado; `Ok(false)` = a pessoa cancelou; `Err` = deu erro.
/// Bloqueia até a resposta, então chame fora da linha principal (spawn_blocking).
pub fn authenticate(reason: &str) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use block2::RcBlock;
        use objc2::runtime::Bool;
        use objc2_foundation::{NSError, NSString};
        use objc2_local_authentication::{LAContext, LAPolicy};
        use std::sync::{mpsc, Mutex};

        let (tx, rx) = mpsc::channel::<Result<bool, String>>();
        let tx = Mutex::new(Some(tx));
        let block = RcBlock::new(move |ok: Bool, err: *mut NSError| {
            let result = if ok.as_bool() {
                Ok(true)
            } else {
                // SAFETY: o sistema passa um NSError válido (ou nulo) só durante a chamada.
                match unsafe { err.as_ref() } {
                    // -2 cancelou, -4 o sistema cancelou, -9 o app cancelou
                    Some(e) if matches!(e.code(), -2 | -4 | -9) => Ok(false),
                    Some(e) => Err(e.localizedDescription().to_string()),
                    None => Ok(false),
                }
            };
            if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
                let _ = tx.send(result);
            }
        });
        // SAFETY: o contexto e o bloco ficam vivos até a resposta chegar (esperamos no rx abaixo).
        let ctx = unsafe { LAContext::new() };
        let reason = NSString::from_str(reason);
        unsafe { ctx.evaluatePolicy_localizedReason_reply(LAPolicy::DeviceOwnerAuthentication, &reason, &block) };
        let got = rx.recv().map_err(|e| e.to_string())?;
        drop(ctx);
        got
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = reason;
        Err("Touch ID só existe no Mac.".into())
    }
}
