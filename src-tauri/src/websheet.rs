//! Login do Google numa folha do macOS por cima do Quill (ASWebAuthenticationSession), em vez do navegador.
//! O Google aceita essa folha (ela é do sistema, com os dados do Safari) e bloqueia webviews próprias.
//!
//! A volta do Google continua sendo o servidor local `http://127.0.0.1:<porta>` da quill-core: a folha carrega
//! essa página no fim, o servidor recebe o código e o app fecha a folha (`close`). Se a pessoa fechar a folha
//! antes, chamamos `on_user_close` (o app cancela a espera, como o botão Cancelar).
//! Em outros sistemas, `open` devolve erro e o app usa o navegador.

/// Abre a folha de login com `url` por cima da janela principal. `owner` identifica o login que pediu
/// (só esse login fecha a folha depois). Uma folha aberta antes é fechada sem contar como desistência.
/// Pode ser chamada de qualquer linha: o AppKit roda na principal e a resposta volta por um canal.
#[cfg(target_os = "macos")]
pub fn open<F>(app: &tauri::AppHandle, url: &str, owner: u64, on_user_close: F) -> Result<(), String>
where
    F: Fn() + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    let (app2, url) = (app.clone(), url.to_string());
    app.run_on_main_thread(move || {
        let _ = tx.send(mac::start(&app2, &url, owner, on_user_close));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "a folha de login não respondeu".to_string())?
}

/// Fecha a folha, se ela ainda for do login `owner` (para o fluxo, não é desistência).
#[cfg(target_os = "macos")]
pub fn close(app: &tauri::AppHandle, owner: u64) {
    let _ = app.run_on_main_thread(move || mac::close(Some(owner)));
}

#[cfg(not(target_os = "macos"))]
pub fn open<F>(_app: &tauri::AppHandle, _url: &str, _owner: u64, _on_user_close: F) -> Result<(), String>
where
    F: Fn() + Send + 'static,
{
    Err("a folha de login só existe no Mac".into())
}

#[cfg(not(target_os = "macos"))]
pub fn close(_app: &tauri::AppHandle, _owner: u64) {}

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
    use objc2_app_kit::NSWindow;
    use objc2_authentication_services::{ASWebAuthenticationPresentationContextProviding, ASWebAuthenticationSession};
    use objc2_foundation::{NSError, NSObject, NSObjectProtocol, NSString, NSURL};
    use tauri::Manager;

    /// Só para criar a sessão: o fim de verdade vem pelo servidor local (http://127.0.0.1).
    const CALLBACK_SCHEME: &str = "quill-auth";

    define_class!(
        // SAFETY: NSObject não tem exigências para subclasses e `SheetAnchor` não implementa Drop.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "QuillLoginSheetAnchor"]
        #[ivars = Retained<NSWindow>]
        struct SheetAnchor;

        unsafe impl NSObjectProtocol for SheetAnchor {}

        unsafe impl ASWebAuthenticationPresentationContextProviding for SheetAnchor {
            /// A janela por cima da qual a folha aparece: a do Quill.
            #[unsafe(method_id(presentationAnchorForWebAuthenticationSession:))]
            fn anchor(&self, _session: &ASWebAuthenticationSession) -> Retained<NSWindow> {
                self.ivars().clone()
            }
        }
    );

    impl SheetAnchor {
        fn new(mtm: MainThreadMarker, window: Retained<NSWindow>) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(window);
            // SAFETY: init do NSObject, sem argumentos.
            unsafe { msg_send![super(this), init] }
        }
    }

    /// A folha aberta agora. A sessão guarda o `presentationContextProvider` sem segurar a referência,
    /// então o "anchor" e o bloco ficam aqui enquanto ela existir.
    struct Sheet {
        owner: u64,
        session: Retained<ASWebAuthenticationSession>,
        /// true quando foi o Quill que fechou (não é desistência)
        closed_by_app: Rc<Cell<bool>>,
        _anchor: Retained<SheetAnchor>,
        _done: RcBlock<dyn Fn(*mut NSURL, *mut NSError)>,
    }

    thread_local! {
        // só mexida na linha principal
        static CURRENT: RefCell<Option<Sheet>> = const { RefCell::new(None) };
    }

    pub fn start<F: Fn() + 'static>(app: &tauri::AppHandle, url: &str, owner: u64, on_user_close: F) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("precisa rodar na linha principal do app")?;
        close(None);

        let window = app.get_webview_window("main").ok_or("janela do Quill não encontrada")?;
        let ptr = window.ns_window().map_err(|e| e.to_string())?.cast::<NSWindow>();
        // SAFETY: o Tauri devolve o NSWindow da janela principal, vivo enquanto ela existir; aqui ele é retido.
        let ns_window = unsafe { Retained::retain(ptr) }.ok_or("janela do Quill inválida")?;
        let ns_url = NSURL::URLWithString(&NSString::from_str(url)).ok_or("endereço de login inválido")?;

        let closed_by_app = Rc::new(Cell::new(false));
        let flag = closed_by_app.clone();
        // chamado quando a folha fecha por qualquer motivo (a pessoa fechou ou o Quill chamou cancel)
        let done = RcBlock::new(move |_url: *mut NSURL, err: *mut NSError| {
            // SAFETY: o sistema passa um NSError válido (ou nulo) só durante a chamada.
            if let Some(e) = unsafe { err.as_ref() } {
                eprintln!("folha de login fechou: {} {} ({})", e.domain(), e.code(), e.localizedDescription());
            }
            if !flag.get() {
                on_user_close();
            }
        });
        let scheme = NSString::from_str(CALLBACK_SCHEME);
        // O init com `callback:` só existe a partir do macOS 14.4; o Quill aceita o 13.
        #[allow(deprecated)]
        // SAFETY: URL, esquema e bloco válidos; a sessão copia o bloco e o bloco também fica guardado em `Sheet`.
        let session = unsafe {
            ASWebAuthenticationSession::initWithURL_callbackURLScheme_completionHandler(
                ASWebAuthenticationSession::alloc(),
                &ns_url,
                Some(&scheme),
                RcBlock::as_ptr(&done),
            )
        };
        let anchor = SheetAnchor::new(mtm, ns_window);
        // SAFETY: chamadas do AuthenticationServices na linha principal, com objetos vivos (guardados em `Sheet`).
        let started = unsafe {
            session.setPresentationContextProvider(Some(ProtocolObject::from_ref(&*anchor)));
            // aproveita o login que a pessoa já tem no Safari
            session.setPrefersEphemeralWebBrowserSession(false);
            session.start()
        };
        if !started {
            return Err("a folha de login não abriu".into());
        }
        CURRENT.with(|c| *c.borrow_mut() = Some(Sheet { owner, session, closed_by_app, _anchor: anchor, _done: done }));
        Ok(())
    }

    /// Fecha a folha aberta (se `owner` for dado, só se ela for desse login).
    pub fn close(owner: Option<u64>) {
        // tira da lista antes do cancel: o bloco de fim pode rodar dentro dele
        let sheet = CURRENT.with(|c| {
            let mut c = c.borrow_mut();
            match (&*c, owner) {
                (Some(s), Some(o)) if s.owner != o => None,
                _ => c.take(),
            }
        });
        if let Some(sheet) = sheet {
            sheet.closed_by_app.set(true);
            // SAFETY: sessão viva, na linha principal; cancel numa sessão já terminada não faz nada.
            unsafe { sheet.session.cancel() };
        }
    }
}
