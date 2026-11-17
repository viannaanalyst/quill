---
type: adr
tags: [quill, adr, seguranca, privacidade, leitura]
updated: 2026-11-17
---

# ADR-010: E-mail formatado num quadro isolado, sem scripts

**Status:** Aceito (2026-11-17)

**Contexto**
E-mails em HTML podem trazer scripts, formulários e imagens de rastreamento (que avisam o remetente quando você abre).
Mostrar só o texto simples deixava os e-mails feios e difíceis de ler.

**Decisão**
- O e-mail formatado aparece num `iframe` isolado com `sandbox="allow-same-origin allow-popups"`, **sem
  `allow-scripts`**. Antes de mostrar, scripts, formulários e atributos de evento são retirados.
- **Imagens externas bloqueadas por padrão**, com o botão **"Mostrar imagens"** no e-mail e a opção em Ajustes →
  Privacidade (`quill.blockRemoteImages`). Imagens embutidas no próprio e-mail aparecem.
- Links abrem no navegador do sistema, só `http`, `https` e `mailto`.
- O "papel" do e-mail é branco mesmo no modo escuro, porque os e-mails são desenhados para fundo claro.

**Consequências**
- Positivas: e-mail bonito sem rodar código de terceiros; remetentes não sabem que você abriu.
- Negativas: alguns e-mails ficam incompletos até clicar em "Mostrar imagens".

**Alternativas consideradas**
- **Só texto simples:** seguro, mas ruim de ler.
- **Mostrar o HTML direto na tela:** o CSS e os scripts do e-mail vazariam para o app.
