//! Lógica pura do Quill (sem janela, sem rede): login OAuth e leitura dos dados do Gmail.
//! Fica separada para poder ser testada em qualquer máquina.

pub mod oauth;
pub mod gmail;
pub mod accounts;

#[cfg(feature = "net")]
pub mod google;

#[cfg(feature = "desktop")]
pub mod session;
