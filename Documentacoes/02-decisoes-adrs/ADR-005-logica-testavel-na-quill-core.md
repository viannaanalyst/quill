---
type: adr
tags: [quill, adr, rust, testes, arquitetura]
updated: 2026-11-17
---

# ADR-005: Lógica testável separada na crate quill-core

**Status:** Aceito (2026-11-17)

**Contexto**
O app inteiro só monta no Mac, mas a maior parte do trabalho é feita na VPS, que não tem Xcode nem janela. Login,
leitura do Gmail, IMAP, CalDAV e CardDAV têm muitos detalhes que quebram fácil e precisam de testes.

**Decisão**
Toda a lógica fica numa crate Rust separada, `src-tauri/crates/quill-core`, sem janela e sem Tauri. A rede entra com o
recurso `net` e o cofre do sistema com `desktop`. O `src-tauri/src/lib.rs` só liga os comandos do Tauri à crate.

**Consequências**
- Positivas: `cargo test --features net` roda na VPS; em 2026-11-17 são 199 testes, com servidores falsos do Google,
  do IMAP e do iCloud; a lógica pode ser reaproveitada no Windows.
- Negativas: duas crates para manter; as partes de cofre e sessão (`session`, `imap_session`) não têm teste próprio.
- Trade-off: os testes provam a lógica, não o app no Mac. O que passa nos testes ainda precisa ser conferido no Mac.

**Alternativas consideradas**
- **Tudo dentro do `src-tauri/src`:** os testes dependeriam do Tauri e não rodariam bem na VPS.
