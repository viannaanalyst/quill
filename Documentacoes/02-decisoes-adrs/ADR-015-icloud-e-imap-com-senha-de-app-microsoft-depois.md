---
type: adr
tags: [quill, adr, icloud, imap, caldav, carddav, microsoft]
updated: 2026-11-17
---

# ADR-015: iCloud e outros provedores por IMAP/SMTP/CalDAV/CardDAV com senha de app; Microsoft depois

**Status:** Aceito (2026-11-17)

**Contexto**
O Gabriel usa iCloud além do Google. A Apple não oferece login OAuth para apps de terceiros lerem o e-mail: o jeito
oficial é a senha de app. Para a Microsoft, é preciso registrar o app no portal da Microsoft (Azure) para ter um ID de
aplicativo, e em 2026-11-17 o Gabriel não conseguiu entrar no portal.

**Decisão**
- **iCloud:** e-mail por IMAP/SMTP, agenda por CalDAV e contatos por CardDAV, todos com a mesma **senha de app**,
  guardada nas Chaves (`app.quill.desktop.imap`). A senha só é enviada por HTTPS para `icloud.com` e `*.icloud.com`.
- **Outro e-mail:** qualquer provedor com IMAP/SMTP, com palpite dos servidores pelo domínio. Sem agenda por enquanto.
- O Quill testa a entrada no IMAP e no SMTP **antes** de guardar a senha.
- Os comandos do `lib.rs` escolhem Google ou IMAP pelo provedor da conta; a agenda do iCloud vira os mesmos tipos da do
  Google, então as telas não mudam.
- **Microsoft adiada** até o app ser registrado no portal da Microsoft (depois: login OAuth e Microsoft Graph).

**Consequências**
- Positivas: iCloud completo (e-mail, agenda, contatos); qualquer provedor de e-mail funciona.
- Negativas: a pessoa precisa criar a senha de app no site da Apple; Microsoft ainda indisponível.
- Atenção: em 2026-11-17 o iCloud foi verificado só nos testes (199 no total da crate) e na prévia; **não foi testado
  com conta real no Mac**.

**Alternativas consideradas**
- **Agenda do Mac pelo EventKit:** previsto no `AGENTS.md` para o futuro; não cobriria o e-mail do iCloud.
- **Microsoft por IMAP com senha:** a Microsoft não aceita mais a senha simples para IMAP nas contas Outlook/Hotmail.
