//! Lógica pura do Quill (sem janela, sem rede): login OAuth e leitura dos dados do Gmail.
//! Fica separada para poder ser testada em qualquer máquina.

pub mod oauth;
pub mod gmail;
pub mod accounts;
pub mod calendar;
pub mod files;
pub mod contacts;
pub mod imap;

#[cfg(feature = "net")]
pub mod google;

#[cfg(feature = "net")]
pub mod imap_client;

#[cfg(feature = "desktop")]
pub mod session;

#[cfg(feature = "desktop")]
pub mod imap_session;
