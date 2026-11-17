---
type: adr
tags: [quill, adr, seguranca, touch-id, mac]
updated: 2026-11-17
---

# ADR-017: Touch ID pela autenticação do macOS

**Status:** Aceito (2026-11-17)

**Contexto**
O Gabriel pediu para abrir o app com Touch ID, já que o Quill mostra e-mails pessoais e fica aberto no Mac.

**Decisão**
- Opção em Ajustes → Privacidade → Abrir o app com Touch ID (`quill.touchId`) e no onboarding.
- Usa a **LocalAuthentication** do macOS com a política `DeviceOwnerAuthentication`: digital, ou a senha do Mac quando
  a digital não dá (`src-tauri/src/touchid.rs`, só compila no Mac).
- Ao ligar, o Quill confere se o Mac tem Touch ID ou senha e pede uma vez para confirmar.
- Com a opção ligada, o app abre numa tela de bloqueio até confirmar.
- No Windows, depois: Windows Hello.

**Consequências**
- Positivas: proteção simples usando o que o Mac já tem; nenhum segredo novo para guardar.
- Negativas: a trava é da tela do Quill, não criptografia dos dados (as contas já estão protegidas pelas Chaves).
- Atenção: **não testado no Mac** em 2026-11-17.

**Alternativas consideradas**
- **Senha própria do Quill:** mais uma senha para lembrar e guardar.
