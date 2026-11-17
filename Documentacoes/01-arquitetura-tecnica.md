---
type: arquitetura
tags: [quill, tauri, react, rust, oauth, imap, caldav]
updated: 2026-11-17
---

# Arquitetura técnica

Estado do código no commit `731e03d` (2026-11-17). Mudanças ainda não commitadas (como o ícone do Dock, em andamento)
não entram aqui.

## Contexto (C4 nível 1)

```
                         ┌──────────────────────────────────────────┐
                         │                 Gabriel                  │
                         └────────────────────┬─────────────────────┘
                                              │ usa no Mac (Touch ID opcional)
                                              ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                  Quill (app no Mac)                                    │
└──┬───────────────┬────────────────┬────────────────┬───────────────┬──────────────┬───┘
   │ HTTPS/OAuth   │ HTTPS          │ IMAP/SMTP TLS  │ CalDAV/CardDAV│ cofre local  │ HTTPS (imagens)
   ▼               ▼                ▼                ▼               ▼              ▼
 Google          Google         iCloud e outros    iCloud         Chaves do      Gravatar, ícones
 (login,         Agenda,        provedores IMAP    (agenda e      macOS          de sites (Google,
 Gmail API)      People API                        contatos)      (keyring)      DuckDuckGo)
```

| Sistema externo | Para quê | Como |
|---|---|---|
| Google OAuth | Login | Página oficial no navegador, PKCE, volta em `127.0.0.1` |
| Gmail API | Ler, organizar, enviar, rascunhos, anexos, contadores | HTTPS com token de acesso |
| Google Agenda | Agendas, eventos, convites, criar/editar/apagar, Meet | HTTPS com token de acesso |
| People API | Contatos e "Outros contatos" (só leitura) para sugestões | HTTPS com token de acesso |
| iCloud IMAP/SMTP | E-mail das contas iCloud | TLS (rustls), senha de app |
| iCloud CalDAV/CardDAV | Agenda e contatos do iCloud | HTTPS, senha de app, só `*.icloud.com` |
| Outros provedores IMAP/SMTP | E-mail de "Outro e-mail" | TLS (rustls), senha do provedor |
| Chaves do macOS | Guardar tokens do Google e senhas de app | `keyring` (Credential Manager no Windows) |
| Gravatar, ícones do Google e da DuckDuckGo | Fotos e logos dos remetentes | Imagem carregada pela tela; desligável |

## Peças (C4 nível 2)

| Peça | Tecnologia | Onde | Papel |
|---|---|---|---|
| Telas | React 19, Vite, TypeScript, CSS puro com tokens, Radix (Dialog, Popover, Select), ícones Lucide | `src/` | Tudo o que se vê; chama a parte nativa por `invoke` |
| Parte nativa | Tauri v2 (Rust) | `src-tauri/src/` | Janela do Mac, 31 comandos, Touch ID; liga as telas à `quill-core` |
| Lógica | Crate Rust `quill-core` | `src-tauri/crates/quill-core/` | Login, Gmail, Agenda, IMAP/SMTP, CalDAV/CardDAV, contas, anexos; testada sozinha |

```
 Telas (WebView)  ──invoke (IPC)──>  Parte nativa (lib.rs)  ──chama──>  quill-core  ──rede──>  Google / iCloud / IMAP
      │                                     │                              │
 localStorage (quill.*)              accounts.json (pasta de dados)   Chaves do sistema
 só preferências                     só e-mail, serviço e servidores  tokens e senhas
```

As telas não falam direto com a internet: a CSP só deixa conectar no IPC do Tauri (`connect-src ipc:
http://ipc.localhost`). A exceção são as imagens (avatares, logos e imagens de e-mail liberadas).

## Estrutura de pastas

```
quill/
  AGENTS.md                 regras para agentes de IA
  docs/design.md            guia de estilo (cópia do canvas do Doop)
  design/telas/             imagens das telas aprovadas (claro e escuro)
  logo/, assets/icon/       logo e ícones do app (make-icons.swift gera os .icns)
  referencias/              print que inspirou o visual
  Documentacoes/            esta documentação
  index.html, vite.config.ts, tsconfig.json, package.json
  src/                      telas (React)
  src-tauri/                parte nativa (Tauri) e a crate quill-core
```

### Telas (`src/`)

```
src/
  main.tsx                  tema, classe da plataforma, carrega e-mails, atualização a cada 3 min
  App.tsx                   onboarding x app, tela de bloqueio (Touch ID), parâmetros da prévia
  shell/                    AppShell (barra lateral + painel), atalhos (shortcuts.ts)
  onboarding/               apresentação em 6 passos e tela de entrar (prefixo ob-)
  inbox/                    caixa de entrada, saudação e ilustrações (prefixo inbox-)
  read/                     leitura, EmailFrame (quadro isolado), conversas
  compose/                  Escrever, barra de formatação, sugestões de destinatário
  calendar/                 dia, semana, mês e formulário de evento (prefixo cal-)
  settings/                 Ajustes e suas seções (prefixo st-)
  components/               peças comuns: Select, DatePicker, SliderGroup, Toasts, CommandPalette,
                            AccountMenu, ImapConnect, LockScreen, MessageAvatar, FileIcon, PhotoCropper…
  state/                    estado compartilhado entre telas (ver abaixo)
  lib/                      api.ts (chamadas à parte nativa), storage.ts e usePref.ts (preferências),
                            platform.ts (app x prévia, tema), signature.ts, files.ts, md5.ts
  styles/                   tokens.css (cores claro/escuro) e components.css (botões, dicas, avisos, rolagem)
  assets/                   fonte Inter, logos dos serviços, ilustrações da saudação (WebP), ícone
```

Telas pesadas carregam sob demanda (`React.lazy`): onboarding, AppShell, Calendário, Escrever, Ajustes, busca ⌘K,
formulário do iCloud/IMAP. O Vite separa React e ícones em pacotes próprios.

### Parte nativa (`src-tauri/`)

```
src-tauri/
  tauri.conf.json           janela, CSP, ícones, macOS 13+
  capabilities/default.json permissões mínimas (core:default e arrastar a janela)
  build.rs                  embute as credenciais do Google na montagem
  Cargo.toml                perfil de release enxuto (opt-level "s", LTO, strip)
  src/main.rs               chama quill_lib::run()
  src/lib.rs                os 31 comandos e o estado do app
  src/touchid.rs            Touch ID (LocalAuthentication; só compila no Mac)
  crates/quill-core/        a lógica (abaixo)
```

## Módulos da `quill-core` (C4 nível 3)

A crate tem dois recursos (features): `net` liga a rede (reqwest, tokio, IMAP, SMTP); `desktop` liga também o cofre
do sistema (`keyring`) e abrir o navegador (`open`). O app usa `desktop`; os testes rodam com `net`.

| Módulo | Recurso | O que faz | Testes |
|---|---|---|---|
| `oauth` | — | PKCE, endereço de login, leitura da volta do navegador, resposta de tokens | 11 |
| `gmail` | — | Lê as respostas da API do Gmail: lista, corpo, anexos, rascunhos, mensagem a enviar | 29 |
| `calendar` | — | Google Agenda: monta pedidos e lê agendas, eventos, convites | 8 |
| `contacts` | — | Sugestões de destinatário: contatos do Google + quem aparece nos enviados | 3 |
| `accounts` | — | `accounts.json`: lista das contas (sem senhas) | 7 |
| `files` | — | Nome seguro para anexos, sem sobrescrever; links só http/https/mailto | 3 |
| `imap` | — | Configuração e predefinições IMAP/SMTP, mapa de pastas, ids, leitura das mensagens | 38 |
| `ical` | — | Formato iCalendar e vCard (linhas de conteúdo), preservando o que o Quill não entende | 5 |
| `dav` | — | WebDAV: corpo dos pedidos e leitura das respostas `multistatus` | 7 |
| `caldav` | — | Agenda do iCloud: agendas, eventos, repetições, fusos; monta os `.ics` | 23 |
| `carddav` | — | Contatos do iCloud: catálogos e vCards (nome, e-mails, foto) | 8 |
| `google` | `net` | Conversa com o Google: volta do navegador, troca e renovação de tokens, Gmail, Agenda, People | 26 |
| `imap_client` | `net` | Conversa com servidores IMAP e SMTP (TLS com rustls), palpite de servidores | 17 |
| `dav_client` | `net` | CalDAV/CardDAV com o iCloud: HTTP Basic só em HTTPS e só para `*.icloud.com`; redirecionamentos à mão | 14 |
| `session` | `desktop` | Sessão das contas Google: login (tempo máximo de 4 min, cancelável), tokens nas Chaves, renovação, ações | 0 |
| `imap_session` | `desktop` | Contas iCloud/IMAP: senha de app nas Chaves, servidores no `accounts.json` | 0 |
| **Total** | | | **199** |

`session` e `imap_session` só juntam o cofre do sistema e a rede; a lógica que eles usam está testada nos outros
módulos.

## Comandos da parte nativa (`src-tauri/src/lib.rs`)

Cada comando de e-mail olha o provedor da conta: iCloud/IMAP vai por `ImapSession`; o resto, pelo Google. Agenda e
contatos do iCloud vão por CalDAV/CardDAV com a mesma senha de app. Erros que pedem novo login voltam como
`needs_login`; sem credenciais do Google, `not_configured`.

| Grupo | Comando | O que faz |
|---|---|---|
| Login Google | `google_sign_in` | Abre a página do Google e espera a volta; devolve a conta |
| | `google_sign_in_cancel` | Cancela o login em andamento |
| | `google_sign_in_reopen` | Reabre a página do login em andamento |
| | `google_sign_in_url` | Endereço do login em andamento (para copiar) |
| Contas | `accounts_list` | Contas conectadas (Google, iCloud, IMAP) |
| | `account_remove` | Desconecta uma conta (tira token/senha das Chaves) |
| | `account_profile` | Nome e foto da conta |
| iCloud/IMAP | `imap_guess` | Palpite de servidores IMAP/SMTP pelo domínio |
| | `imap_connect` | Testa IMAP e SMTP e só então guarda a senha nas Chaves |
| E-mail | `inbox_fetch` | E-mails da Entrada |
| | `folder_fetch` | E-mails de uma pasta |
| | `folder_counts` | Contadores das pastas |
| | `message_body` | Corpo, anexos e imagens embutidas de um e-mail |
| | `message_mark_read` | Marca como lido |
| | `message_action` | `archive`, `unarchive`, `spam`, `notspam`, `star`, `unstar`, `unread`, `read`, `trash`, `untrash` |
| | `message_send` | Envia (mantém a conversa com `thread_id`) |
| Rascunhos | `draft_save` | Cria ou atualiza o rascunho no servidor |
| | `draft_get` | Abre um rascunho para continuar |
| | `draft_delete` | Apaga o rascunho (depois de enviar ou descartar) |
| Agenda | `calendar_agenda` | Agendas e eventos entre duas datas (Google ou iCloud; IMAP genérico devolve vazio) |
| | `calendar_rsvp` | Responde convite: `accepted`, `declined`, `tentative` |
| | `calendar_create` | Cria evento |
| | `calendar_update` | Edita evento |
| | `calendar_delete` | Apaga evento |
| Contatos | `contacts_list` | Sugestões de destinatário (contatos + enviados) |
| Anexos | `attachment_get` | `save` (Downloads), `open` (app padrão) ou `preview` (Quick Look) |
| | `attachment_data` | Conteúdo em base64 para a prévia dentro do app |
| | `reveal_download` | Mostra o arquivo no Finder (só aceita a pasta Downloads) |
| Sistema | `open_link` | Abre link no navegador (só http, https, mailto) |
| | `touch_id_available` | O Mac pode pedir Touch ID ou senha? |
| | `touch_id_authenticate` | Pede o Touch ID (true = confirmado, false = cancelado) |

## Estado das telas (`src/state/`)

| Arquivo | Guarda |
|---|---|
| `store.ts` | Tela atual, e-mails lidos nesta sessão, resposta do convite (com desfazer), agendas visíveis da prévia, texto inicial do Escrever |
| `mailbox.ts` | Contas conectadas, e-mails por pasta, contadores, corpos e anexos já abertos, fotos, contas que precisam entrar de novo; atualização a cada 3 min com a janela à vista; Sair de todas |
| `calendar.ts` | Agendas e eventos de todas as contas, juntando cópias do mesmo convite (iCalUID + início) e escondendo feriados repetidos em outro idioma; criar, editar, apagar, responder |
| `contacts.ts` | Sugestões de destinatário, com cache em `quill.contacts.cache` |
| `outbox.ts` | Caixa de saída com "Desfazer": segura o e-mail N segundos antes de enviar |

Preferências que várias telas leem ficam no `localStorage` (prefixo `quill.`) por `usePref`/`getPref`. Lista completa
em [05-referencia.md](05-referencia.md).

Na prévia do navegador, `mailbox.ts` e `calendar.ts` usam dados de exemplo; no app sem conta, nada
([ADR-020](02-decisoes-adrs/ADR-020-dados-de-exemplo-so-na-previa.md)).

## Fluxos principais

**Login Google**
1. A tela chama `google_sign_in`.
2. A `quill-core` gera o PKCE, abre um servidor só em `127.0.0.1` numa porta livre e abre o navegador na página do
   Google.
3. O Google devolve o código para `127.0.0.1`; a `quill-core` troca por tokens.
4. O token de renovação vai para as Chaves (serviço `app.quill.desktop.google`); a conta entra no `accounts.json`.
5. Tempo máximo de espera: 4 minutos. Cancelar ou começar outro login encerra o anterior.

**Conectar iCloud/IMAP**
1. `imap_guess` sugere os servidores; iCloud já vem predefinido.
2. `imap_connect` testa a entrada no IMAP e no SMTP.
3. Só se os dois funcionarem, a senha vai para as Chaves (serviço `app.quill.desktop.imap`) e os servidores para o
   `accounts.json`.

**Enviar com "Desfazer"**
1. Escrever monta a mensagem (com a assinatura da conta) e chama `queueSend`.
2. A barra "Desfazer" conta os segundos de `quill.undoSeconds`.
3. Se desfizer, volta ao Escrever com tudo preenchido; se não, `message_send` e o rascunho é apagado.

## Segurança

| Ponto | Como está |
|---|---|
| CSP | `default-src 'self'`; `connect-src` só o IPC do Tauri; `frame-src` só `self`, `about:`, `data:`, `blob:`; imagens de `https:`/`http:` liberadas para avatares e e-mails |
| Permissões do Tauri | Só `core:default` e arrastar a janela; nenhum plugin com acesso a arquivos ou shell |
| E-mail formatado | Num `iframe` com `sandbox="allow-same-origin allow-popups"` (sem `allow-scripts`); scripts, formulários e eventos são retirados antes de mostrar; imagens externas bloqueadas por padrão |
| Links | Abrem no navegador do sistema pelo `open_link`, que só aceita `http`, `https` e `mailto` |
| Tokens e senhas | Só nas Chaves do sistema (`app.quill.desktop.google`, `app.quill.desktop.imap`); nunca em arquivo, log ou `localStorage` |
| `accounts.json` | Só e-mail, serviço e servidores; nunca senha |
| Senha do iCloud | Enviada só por HTTPS e só para `icloud.com` / `*.icloud.com`; redirecionamentos seguidos à mão e conferidos; a senha nunca aparece em erro |
| IMAP/SMTP | Sempre TLS com rustls e o verificador de certificados do sistema |
| Anexos | Nome de arquivo limpo, sem sobrescrever; `reveal_download` só aceita caminhos dentro de Downloads |
| Credenciais do Google | Embutidas na montagem pelo `build.rs` (Infisical ou `oauth.local.env`, fora do git); nunca no repositório |
| Touch ID | `LocalAuthentication` do macOS (`DeviceOwnerAuthentication`: digital ou senha do Mac) |

Observação: em app de computador o "segredo" do cliente OAuth do Google não é secreto de verdade (qualquer um pode
extrair do programa). Quem protege a conta é o PKCE e a volta só para `127.0.0.1`.

## Comandos

```bash
npm install            # dependências das telas
npm run dev            # prévia no navegador (porta 1420), com dados de exemplo
npm run build          # confere os tipos (tsc) e gera dist/
npm run tauri dev      # app de verdade (precisa de Rust; no Mac, Xcode)
npm run tauri build    # instalador
```

Testes da lógica (rodam na VPS):

```bash
cd src-tauri/crates/quill-core
cargo test --features net
```

## Como montar no Mac

Pré-requisitos: Node, Rust (`rustup`), Xcode (ou as ferramentas de linha de comando) e o Infisical logado no projeto
`quill`.

```bash
cd /Users/gabrielvianna/Projetos/quill
git pull
npm install
infisical run --env=prod -- npm run tauri build
```

- O `.app` fica em `src-tauri/target/release/bundle/macos/` e o `.dmg` em `src-tauri/target/release/bundle/dmg/`.
- Sem as variáveis `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET` (nem o arquivo `src-tauri/oauth.local.env`),
  o app monta, mas o login com Google avisa que não está configurado. iCloud e IMAP funcionam mesmo assim.
- O app ainda não é assinado nem autenticado pela Apple.
- Só montar quando o Gabriel pedir ([ADR-009](02-decisoes-adrs/ADR-009-conferir-na-previa-e-montar-so-quando-pedir.md)).

## Como foi verificado

Em 2026-11-17, na VPS:

- **Testes da `quill-core`:** `cargo test --features net` → **199 testes passaram, 0 falharam**. Cobrem OAuth, leitura
  do Gmail e da Agenda, contatos, contas, anexos, IMAP (com servidor falso), iCalendar/vCard, WebDAV, CalDAV e
  CardDAV, e as conversas com o Google e o iCloud (com servidores falsos). Não falam com servidores reais.
- **Telas:** `npm run build` sem erros de tipo. Atenção: rodou com mudanças de outros agentes ainda não commitadas na
  pasta (ícone do Dock).
- **Prévia do navegador:** as telas foram conferidas por prints em claro e escuro durante o desenvolvimento, com os
  parâmetros `?screen=`, `?theme=` e `?native=1`.

No Mac:
- Rodaram no app montado (pelo histórico do git): onboarding, janela nativa, login com Google, caixa de entrada e
  leitura com e-mails reais, menu do avatar.
- **Ainda não testado no Mac:** tudo o que entrou a partir do commit `37189cc`, incluindo iCloud, "Outro e-mail",
  Touch ID, envio, rascunhos, desfazer envio, Google Agenda, editor novo e prévia de anexos. Lista em
  [00-visao-geral.md](00-visao-geral.md).
- Tamanho do app: cerca de 6 MB, segundo a montagem no Mac em 2026-11-17 (não medido de novo para esta documentação).

Não há testes automáticos das telas (Playwright) nem de ponta a ponta.
