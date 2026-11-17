---
type: adr
tags: [quill, adr, stack, tauri, react, mac, windows]
updated: 2026-11-17
---

# ADR-001: App próprio em Tauri v2 + React

**Status:** Aceito (2026-11-17)

**Contexto**
O Gabriel queria um app de e-mail e calendário próprio, bonito e leve, para o Mac primeiro e depois para o Windows.
Os apps prontos não juntavam bem várias contas (Google, iCloud, Microsoft) com o visual desejado. Um protótipo em Swift
nativo foi testado e deixado de lado: só serviria para o Mac, e a versão para Windows teria de ser escrita de novo.

**Decisão**
O app é feito em **Tauri v2**: a parte nativa em Rust (`src-tauri/`) e as telas em **React 19 + Vite + TypeScript**
(`src/`), com CSS puro e tokens. O Tauri usa o navegador que já vem no sistema (WebKit no Mac, WebView2 no Windows) em
vez de levar um navegador inteiro dentro do app.

**Consequências**
- Positivas: app pequeno (cerca de 6 MB na montagem do Mac em 2026-11-17); o mesmo código de telas serve para Mac e
  Windows; a lógica em Rust é rápida e testável (ver ADR-005).
- Negativas: o app inteiro só monta no Mac (precisa do Xcode); a VPS só roda as telas e os testes da lógica.
- Trade-offs: recursos do Mac (Touch ID, Quick Look) exigem código nativo por sistema; o visual não é o padrão do
  macOS, é o do Quill (ver ADR-006 e ADR-007).

**Alternativas consideradas**
- **Swift nativo (SwiftUI):** protótipo testado; ficaria preso ao Mac.
- **Electron:** leva um navegador Chromium inteiro; apps de 100 MB ou mais e mais memória. Contraria "leveza é
  requisito".
- **Usar um app pronto (Apple Mail, Spark, Outlook):** não juntava as contas e o visual como o Gabriel queria.
