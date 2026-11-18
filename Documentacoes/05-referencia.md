---
type: referencia
tags: [quill, glossario, dicionario-de-dados, tokens, previa]
updated: 2026-11-18
---

# Referência

Consulta rápida. O guia de estilo completo (cores, tipografia, botões, estrutura da janela, telas) está em
[`docs/design.md`](../docs/design.md), cópia do canvas do Doop.

## Links

| O quê | Onde |
|---|---|
| Canvas "Quill" no Doop (fonte da verdade do visual, guideline `quill-estilo`) | https://sirus-vps.tail6e87c3.ts.net:10001/c/LmKkz1PF7S (só pela rede Tailscale) |
| Guia de estilo (cópia) | [`docs/design.md`](../docs/design.md) |
| Imagens das telas aprovadas | [`design/telas/`](../design/telas/) |
| Repositório | `viannaanalyst/quill` (privado), branch `main` |
| Credenciais do app do Google | Infisical, projeto `quill`, ambientes `dev` e `prod` |
| Senhas de app da Apple | https://appleid.apple.com → Entrar e segurança → Senhas de app |

## Glossário

| Termo | Significado aqui | Onde aparece |
|---|---|---|
| Prévia | As telas abertas no navegador (`npm run dev`), sem a parte nativa, com dados de exemplo | Desenvolvimento |
| App / janela nativa | O Quill montado pelo Tauri e aberto no Mac | `npm run tauri build` |
| Montar | Gerar o `Quill.app` no Mac a partir do código | [guia rápido](guia-rapido.md#pedir-uma-montagem-nova-do-app) |
| Espaço (Chat) | Conversa do Google Chat: espaço com nome, grupo sem nome ou mensagem direta (`spaces/<id>`) | Tela Chat |
| Onboarding | Apresentação em 6 passos na primeira abertura, terminando na tela de entrar | `src/onboarding/` |
| Saudação / banner | Cartão "Bom dia, …" com o resumo do dia e uma ilustração | Caixa de entrada |
| Cartão "Hoje" | Coluna da direita com a semana, compromissos do dia e o convite pendente | Caixa de entrada |
| Caixa de saída | Onde o e-mail espera os segundos do "Desfazer" antes de sair | `src/state/outbox.ts` |
| Convite | Evento em que você foi convidado; sem resposta aparece listrado | Calendário, lista de e-mails |
| RSVP | Resposta ao convite: Aceitar, Talvez ou Recusar | `RsvpButtons`, `calendar_rsvp` |
| Busca geral | Janela do ⌘K que acha e-mails, eventos, telas e comandos | `CommandPalette` |
| Toast / aviso | Pílula rápida no topo da janela confirmando uma ação ou um erro | `src/components/Toasts.tsx` |
| Dica (tooltip) | Pílula escura com o nome do botão só de ícone, ao passar o mouse | atributo `data-tip` |
| OAuth | Jeito padrão de entrar numa conta pela página oficial do serviço, sem dar a senha ao app | Login Google |
| PKCE | Proteção do OAuth para apps de computador: só quem começou o login consegue terminá-lo | `quill-core/src/oauth.rs` |
| Loopback / 127.0.0.1 | Endereço do próprio Mac; o Google devolve o login para lá | Login Google |
| Token de renovação | Chave permanente que o Google dá depois do login, para pegar acessos novos sem pedir senha | Chaves do macOS |
| Modo "Testando" | Estado do app do Google antes de publicado: só usuários de teste e login a cada 7 dias | Google Cloud |
| Senha de app | Senha gerada no site do provedor (Apple, por exemplo) só para um app; não é a senha da conta | iCloud, Outro e-mail |
| IMAP / SMTP | Padrões para ler (IMAP) e enviar (SMTP) e-mail em qualquer provedor | iCloud, Outro e-mail |
| CalDAV / CardDAV | Padrões para agenda (CalDAV) e contatos (CardDAV); o iCloud usa os dois | iCloud |
| iCalUID | Identificador único de um evento, igual em todas as cópias do mesmo convite | Junção de convites |
| Chaves do macOS | Cofre de senhas do sistema (Keychain); no Windows, Credential Manager | Tokens e senhas |
| Cofre único | O único item do Quill nas Chaves (`app.quill.desktop` / `cofre`), com todos os tokens e senhas | Chaves do macOS |
| Assinatura ad-hoc | Montagem sem certificado fixo; para o macOS, cada versão é um app novo e pede a senha das Chaves de novo | Montagem no Mac |
| Crate | Pacote de código Rust | `quill-core` |
| `quill-core` | Crate com a lógica do Quill (login, Gmail, IMAP, iCloud), testada sem o app | `src-tauri/crates/quill-core` |
| Comando (Tauri) | Função da parte nativa que as telas chamam | `src-tauri/src/lib.rs` |
| CSP | Regra que diz de onde o app pode carregar coisas | `tauri.conf.json` |
| Quick Look | Prévia de arquivos do Mac (barra de espaço no Finder) | Anexos |
| Gravatar | Serviço de fotos de perfil ligado ao e-mail | Avatares |
| Doop | Canvas de design que roda na VPS, onde as telas foram desenhadas | Link acima |
| Codex (Luna 6) | Ferramenta de IA usada para gerar as ilustrações e ícones (fora do app) | ADR-018 |

## Dicionário de dados

### Preferências (localStorage, prefixo `quill.`)

Guardadas pelo `setPref`/`usePref` (`src/lib/storage.ts`, `src/lib/usePref.ts`) como JSON, só neste Mac. "Apagar
dados deste Mac" (Ajustes → Privacidade) apaga todas. Nunca guardam senha nem token.

| Chave | Tipo | Valores válidos | Padrão | Significado |
|---|---|---|---|---|
| `theme` | string | `system`, `light`, `dark` | `system` | Tema; `system` segue o claro/escuro do Mac |
| `onboarded` | boolean | `true`, `false` | `false` | Já viu o onboarding (marcado ao chegar na tela de entrar, no app) |
| `touchId` | boolean | `true`, `false` | `false` | Pede Touch ID ao abrir (só no app do Mac) |
| `startScreen` | string | `inbox`, `calendar` | `inbox` | Tela ao abrir o app (Calendário abre na semana) |
| `markReadOnOpen` | boolean | `true`, `false` | `true` | Marca como lido ao abrir o e-mail |
| `confirmDelete` | boolean | `true`, `false` | `true` (ver nota) | Pergunta antes de mandar para a Lixeira |
| `undoSeconds` | number | `5`, `10`, `20`, `30` | `10` | Segundos que o e-mail espera antes de sair |
| `density` | string | `comfortable`, `compact` | `comfortable` | Densidade da lista de e-mails |
| `showBanner` | boolean | `true`, `false` | `true` | Mostra a saudação na caixa de entrada |
| `showPreview` | boolean | `true`, `false` | `true` | Mostra a primeira linha do e-mail embaixo do assunto |
| `bannerScene` | string | `auto`, `sky`, `mountains`, `sea`, `city`, `aurora`, `field`, `photo`, `none` | `auto` | Imagem da saudação; `auto` muda com o horário |
| `bannerPhoto` | string | `""` ou imagem em `data:image/jpeg;base64,…` | `""` | Foto própria da saudação (usada com `bannerScene = photo`) |
| `avatarPhoto` | string ou null | `null` ou imagem em `data:image/jpeg;base64,…` | `null` | Foto própria do avatar (recortada); `null` usa a foto do Google |
| `blockRemoteImages` | boolean | `true`, `false` | `true` | Bloqueia imagens externas nos e-mails |
| `senderLogos` | boolean | `true`, `false` | `true` | Busca fotos e logos dos remetentes (Gravatar, Google, DuckDuckGo) |
| `folders.visible` | string[] | ids entre `inbox`, `starred`, `sent`, `drafts`, `archive`, `spam`, `trash` | todas | Pastas mostradas na barra lateral (`inbox` sempre aparece) |
| `calendar.hidden` | string[] | chaves `"<e-mail da conta>\|<id da agenda>"` | `[]` | Agendas escondidas no Calendário |
| `signature:<e-mail>` | string | texto livre | `""` | Assinatura da conta (na prévia, `<e-mail>` é o id da conta de exemplo) |
| `account:<e-mail>:signature` | string | `account`, `none` | `account` | Assinatura padrão da conta: a dela ou nenhuma |
| `account:<e-mail>:nickname` | string | texto livre | nome tirado do e-mail | Apelido da conta no Quill |
| `account:<e-mail>:color` | string | `#5A8CB7`, `#7C9A74`, `#C8925A`, `#7A8CA8`, `#A592B8` | uma das cinco, pela ordem da conta | Cor da conta (bolinha, etiquetas, eventos) |
| `contacts.cache` | objeto | `{ "<e-mail>": { at: <ms>, list: [contatos] } }` | `{}` | Cache das sugestões de destinatário por conta; vale 6 horas |
| `notifSeenAt` | number | data em milissegundos | `0` | Quando o sino foi aberto pela última vez (o que chegou depois aparece como novo) |
| `notify` | boolean | `true`, `false` | `true` | Avisar quando chegar e-mail (**ainda sem efeito**) |
| `notifySound` | boolean | `true`, `false` | `true` | Tocar som com o aviso (**ainda sem efeito**) |
| `notifyPeopleOnly` | boolean | `true`, `false` | `true` | Avisar só e-mails de pessoas (**ainda sem efeito**) |
| `quietHours` | boolean | `true`, `false` | `false` | Horário silencioso (**ainda sem efeito**) |
| `quietFrom` / `quietTo` | string | `"00:00"` a `"23:00"`, de hora em hora | `"22:00"` / `"07:00"` | Começo e fim do horário silencioso (**ainda sem efeito**) |

**Google Chat** ([ADR-023](02-decisoes-adrs/ADR-023-google-chat-pela-api-so-workspace.md)):

| Chave | Tipo | Valores válidos | Padrão | Significado |
|---|---|---|---|---|
| `chat.account` | string | e-mail de uma conta Workspace conectada | a primeira conta Workspace | Conta mostrada no Chat |
| `chat.seen` | objeto | `{"<conta>\|<spaces/id>": ms}` | `{}` | Até quando cada conversa foi vista (base das não lidas) |
| `chat.baseline.<conta>` | boolean | `true`, `false` | `false` | Já abriu o Chat dessa conta (na primeira vez, o que existe conta como lido) |
| `chat.pinned` | lista | `["<conta>\|<spaces/id>", …]` | `[]` | Conversas fixadas (só neste Mac; a API não informa as do Google Chat) |
| `chat.reacted` | objeto | `{"<conta>\|<spaces/id/messages/id>": ["👍", …]}` (até 2.000 mensagens) | `{}` | Emojis com que você reagiu, para destacar o chip (a API só informa a contagem) |
| `chat.reactionUse` | objeto | `{"👍": 3, …}` (até 40 emojis) | `{}` | Quantas vezes você reagiu com cada emoji; as 3 mais usadas viram as reações rápidas da barra (começa com ✅ 🫡 🤣) |
| `chat.listWidth` | número | 240 a 420 | 300 | Largura da coluna de conversas do Chat (arrastando a divisória) |

**Notificações (2026-11-17):** `notifyChat` (boolean, padrão `true`: avisar mensagens do Chat), `notifySoundEmail` e
`notifySoundChat` (`pop` (padrão), `gota`, `sino`, `cristal`, `marimba`, `brisa`; arquivos em `src/assets/sounds/`).
`notify`, `notifySound`, `notifyPeopleOnly`, `quietHours`, `quietFrom` e `quietTo` agora funcionam de verdade
(`src/lib/notify.ts`).

**Nota sobre `confirmDelete`:** ligado por padrão em todo o app (corrigido em 2026-11-17). A pergunta usa a janela
própria do Quill (`askConfirm`, em `src/components/ConfirmHost.tsx`), porque o `window.confirm` do navegador não
funciona dentro do app.

**`dockIcon`:** ícone do Dock escolhido em Ajustes → Aparência. Valores: `default` (Escuro, o ícone do app), `classico` (creme), `azul`,
`salvia`, `grafite`, `branco`, `noite`, `papel`. Imagens em `src/assets/dock/` (512 px, formato do macOS); originais do
Codex em `assets/icon/variants/`. O antigo `escuro` vale como `default`.

### `accounts.json`

Arquivo na pasta de dados do app (no Mac, `~/Library/Application Support/app.quill.desktop/accounts.json`). Lista das
contas conectadas, **sem senhas nem tokens**.

| Campo | Tipo | Valores | Significado |
|---|---|---|---|
| `email` | string | e-mail em minúsculas | Conta conectada |
| `provider` | string | `google`, `icloud`, `imap` (depois `microsoft`) | Serviço da conta |
| `imap` | objeto ou ausente | só em `icloud` e `imap` | Servidores da conta (abaixo) |
| `imap.email` | string | e-mail | Endereço da conta |
| `imap.name` | string ou null | texto | Nome que aparece para quem recebe |
| `imap.provider` | string | `icloud`, `imap` | Igual ao `provider` |
| `imap.imapHost` / `imap.imapPort` | string / número | ex.: `imap.mail.me.com` / `993` | Servidor de leitura |
| `imap.smtpHost` / `imap.smtpPort` | string / número | ex.: `smtp.mail.me.com` / `587` | Servidor de envio |
| `imap.smtpSecurity` | string ou null | `tls`, `starttls`, `null` | `null` = escolhe pela porta (465 → TLS, outras → STARTTLS) |
| `imap.username` | string | `""` ou usuário | Vazio = o próprio e-mail |

### Chaves do sistema (Keychain)

Um **único item** para todas as contas ([ADR-024](02-decisoes-adrs/ADR-024-cofre-unico-nas-chaves.md)), lido uma
vez por abertura do app e guardado na memória (`quill-core/src/vault.rs`).

| Serviço | Conta (nome do item) | Guarda | Quem grava |
|---|---|---|---|
| `app.quill.desktop` | `cofre` | JSON `{ "google": { "<e-mail>": "<token de renovação>" }, "imap": { "<e-mail>": "<senha de app>" } }`, e-mails em minúsculas | `Vault`: depois do login do Google (`session.rs`), depois de testar IMAP e SMTP (`imap_session.rs`) e ao desconectar |

Itens antigos, de antes do cofre único (só lidos na migração e depois apagados):

| Serviço | Conta (nome do item) | Guardava |
|---|---|---|
| `app.quill.desktop.google` | e-mail em minúsculas | Token de renovação do Google |
| `app.quill.desktop.imap` | e-mail em minúsculas | Senha de app (iCloud) ou senha do provedor (IMAP) |

"Sair" e "Desconectar" tiram a conta do cofre (o item é gravado de novo sem ela). "Apagar dados deste Mac" **não**
mexe nas Chaves.

## Tokens de cor principais

Definidos em `src/styles/tokens.css`. Tabela completa em [`docs/design.md`](../docs/design.md#cores).

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--win` | `#F1F1F2` | `#0B0B0D` | Fundo da janela e barra de ícones |
| `--panel` | `#FCFCFC` | `#131416` | Painel principal |
| `--surface` | `#FFFFFF` | `#1A1B1E` | Cartões |
| `--surface2` | `#F2F2F3` | `#232428` | Pílula ativa, hover |
| `--line` / `--line2` | `#E7E7E9` / `#EEEEF0` | `#2A2B2F` / `#222327` | Bordas e separadores |
| `--ink` / `--ink2` / `--ink3` | `#1B1C1E` / `#56585D` / `#8F9196` | `#F1F1F2` / `#B3B5BA` / `#7A7C82` | Texto principal, secundário, apagado |
| `--blue` | `#4F86B5` | `#7FB0D8` | Não lido, selo, avisos |
| `--sage` | `#6F9068` | `#9BB893` | Sincronizado, detalhes |
| `--sel` | `#F5F8FB` | `#181C21` | Linha selecionada |
| `--btop` → `--bbot` | `#404145` → `#17181A` | `#FFFFFF` → `#D1D2D5` | Degradê do botão principal |
| `--bhl` | `rgba(255,255,255,.24)` | `rgba(255,255,255,.95)` | Brilho de 1px no topo do botão |
| `--gfill` / `--gedge` | `rgba(27,28,30,.045)` / `rgba(27,28,30,.10)` | `rgba(255,255,255,.05)` / `rgba(255,255,255,.09)` | Botão secundário ("vidro") |

Cores das contas: `--acc-pessoal #5A8CB7`, `--acc-moradah #7C9A74`, `--acc-inchurch #C8925A`, `--acc-outlook #7A8CA8`,
`--acc-icloud #A592B8`. Fonte: `--font` = Inter.

## Parâmetros da prévia

Valem só em `npm run dev` (http://localhost:1420). Podem ser combinados (`?screen=week&theme=dark&native=1`).

| Parâmetro | Valores | Efeito |
|---|---|---|
| `?screen=` | `inbox`, `read`, `compose`, `day`, `week`, `month`, `chat`, `settings`, `onboarding` | Abre direto nessa tela |
| `&chat=` | `none`, `rec`, `att` | Com `?screen=chat`: sem conta Workspace, gravando áudio, ou enviando anexos |
| `?theme=` | `light`, `dark` | Força o tema |
| `?step=` | `1` a `6` | Abre o onboarding nesse passo (5 = tela de entrar; 6 = depois de entrar) |
| `?native=1` | — | Simula a janela do Mac (barra para os botões nativos, linha fina em volta do painel) |
| `?preload=onboarding` | — | Carrega o onboarding junto, para pegar estilos que vazam entre telas (ADR-008) |

## Atalhos

| Atalho | O que faz |
|---|---|
| ⌘K | Busca geral |
| ⌘, | Ajustes |
| ⌘N | Escrever |
| ⌘R | Atualizar e-mails |
| C | Escrever (fora de campo de texto) |
| / | Busca geral (fora de campo de texto) |
| G depois E | Caixa de entrada |
| G depois C | Calendário (semana) |
| Esc | Fechar |

A tela Ajustes → Atalhos também lista R (responder), E (arquivar) e # (lixeira); esses três ainda não estão ligados em
`src/shell/shortcuts.ts`.
