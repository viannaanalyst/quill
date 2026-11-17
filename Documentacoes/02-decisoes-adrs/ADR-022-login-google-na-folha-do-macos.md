---
type: adr
tags: [quill, adr, login, oauth, mac, seguranca]
updated: 2026-11-17
---

# ADR-022: Login do Google na janela de login do macOS

**Status:** Aceito (2026-11-17)

**Contexto**
Ao conectar uma conta Google, o Quill abria o navegador padrão (ADR-003). O Gabriel pediu que o login aparecesse
numa janelinha do macOS ligada ao Quill, sem ir para o navegador. O Google bloqueia login em webviews próprias do app,
mas aceita a janela de login do sistema, o **ASWebAuthenticationSession**.

**Decisão**
- No Mac, `google_sign_in` abre a página do Google num `ASWebAuthenticationSession` (`src-tauri/src/websheet.rs`,
  crate `objc2-authentication-services`), com `prefersEphemeralWebBrowserSession = false` para aproveitar o login que
  a pessoa já tem no Safari, e a janela do Quill como âncora (`presentationContextProvider`).
- A volta continua sendo o servidor local `http://127.0.0.1:<porta>` da `quill-core`: o cliente do Google é do tipo
  "App para computador" e não aceita esquema próprio. A janela carrega essa página no fim; quando o servidor recebe o
  código (ou a espera acaba por qualquer motivo), o app fecha a janela com `cancel()`. O esquema `quill-auth` só
  existe para criar a sessão.
- Se a pessoa fechar a janela antes do fim, o app chama `cancel_sign_in()`, como o botão Cancelar, e a tela mostra
  "Login cancelado".
- A `quill-core` ganhou `GoogleSession::sign_in_with(login_hint, open, wait_ended)`: o app escolhe como abrir a página
  e é avisado quando a espera termina. `sign_in` continua abrindo o navegador.
- Se a janela não abrir (ou fora do Mac), o app cai para o navegador. "Abrir de novo" também usa a janela;
  "Copiar link" continua lá.
- Cada login tem um número (`LOGIN_SEQ` no `lib.rs`): só o login que abriu a janela pode fechá-la, para um login
  antigo que terminou não fechar a janela de um login novo.

**Consequências**
- Positivas: a pessoa não perde o Quill de vista entre abas do navegador; o Google aceita; o Quill continua sem ver a
  senha (a página é do sistema, com os dados do Safari).
- Negativas: com o Safari como navegador, o macOS mostra o login numa **janela própria do Safari** (sem barra de
  endereço, do tamanho da última janela do Safari; no teste, a tela inteira), não numa folha presa à janela do Quill.
  O tamanho e a posição dessa janela ficam com o sistema.
- Atenção (teste de 2026-11-17, sem fazer login): a janela abriu; fechá-la cancelou a espera; Cancelar no Quill
  fechou a janela. **O login completo (código chegando ao `127.0.0.1` dentro da janela e a janela fechando sozinha)
  ainda não foi testado.** O Gabriel testa com a conta dele.

**Alternativas consideradas**
- **Webview própria (Tauri/WKWebView):** o Google bloqueia login em navegadores embutidos.
- **Esquema próprio na volta (`quill-auth://`):** o cliente "App para computador" do Google só aceita o loopback;
  exigiria outro tipo de cliente OAuth (iOS) e outras regras.
- **Continuar só com o navegador:** funciona, mas é o que o Gabriel pediu para mudar. Fica como reserva automática.
