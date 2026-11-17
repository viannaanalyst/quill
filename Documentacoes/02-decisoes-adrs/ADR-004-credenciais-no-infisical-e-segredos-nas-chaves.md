---
type: adr
tags: [quill, adr, seguranca, segredos, infisical, keyring]
updated: 2026-11-17
---

# ADR-004: Credenciais no Infisical; tokens e senhas só nas Chaves do sistema

**Status:** Aceito (2026-11-17)

**Contexto**
O app do Google precisa de um ID e um segredo de cliente OAuth na hora de montar. Depois do login, cada conta tem um
token de renovação (Google) ou uma senha de app (iCloud/IMAP) que dá acesso aos e-mails. Nada disso pode ir para o
git, para arquivos comuns ou para o armazenamento das telas.

**Decisão**
- As credenciais do app do Google ficam no **Infisical, projeto `quill`** (variáveis `GOOGLE_OAUTH_CLIENT_ID` e
  `GOOGLE_OAUTH_CLIENT_SECRET`, ambientes `dev` e `prod`).
- O `src-tauri/build.rs` embute as duas no programa na montagem, vindas das variáveis
  (`infisical run --env=prod -- npm run tauri build`) ou do arquivo `src-tauri/oauth.local.env` (fora do git).
- Tokens e senhas de app ficam **só nas Chaves do sistema** (Chaves do macOS / Credential Manager do Windows), pela
  biblioteca `keyring`, nos serviços `app.quill.desktop.google` e `app.quill.desktop.imap`.
- O `accounts.json` guarda só e-mail, serviço e servidores. O `localStorage` guarda só preferências.

**Consequências**
- Positivas: nenhum segredo no repositório; tokens protegidos pelo próprio sistema; "Sair" apaga os tokens das Chaves.
- Negativas: montar sem o Infisical gera um app sem login do Google (avisa "não configurado"; iCloud e IMAP seguem
  funcionando).
- Atenção: senha e token nunca aparecem em erro, log ou documentação.

**Alternativas consideradas**
- **Arquivo `.env` no repositório:** vazaria no GitHub.
- **Tokens no `localStorage` ou em arquivo:** qualquer programa do usuário leria.
