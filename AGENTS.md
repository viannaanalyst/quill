# Quill: instruções para agentes

App de e-mail e calendário, **macOS primeiro**, depois Windows. Começou como uso pessoal do Gabriel, mas a ideia é que outras pessoas possam usar. **Sem IA dentro do app.** Responda sempre em português do Brasil, em linguagem simples (o Gabriel não é técnico).

## Documentação

- Comece por `Documentacoes/README.md`. Decisões ficam em `Documentacoes/02-decisoes-adrs/`.
- Toda documentação segue `Documentacoes/_referencia/convencoes-documentacao.md`.
- Ao mudar algo, atualize `Documentacoes/06-changelog.md` e os documentos afetados (decisão nova vira ADR novo, sem renumerar os antigos).
- O guia de estilo continua em `docs/design.md`; a documentação aponta para ele.
- Se código e documentação divergirem, investigue e corrija o que estiver errado.

## Stack

- **Tauri v2**: app de desktop; a parte nativa fica em Rust, em `src-tauri/`.
- **React 19 + Vite + TypeScript**: as telas, em `src/`.
- **CSS puro com tokens** (`src/styles/tokens.css`). Sem biblioteca de componentes com visual pronto (nada de MUI, Chakra ou Ant).
- Ícones: **Lucide**, importados um a um (`import Inbox from "lucide-react/icons/inbox"`), nunca de `"lucide-react"`.
- Fonte: **Inter** com tamanho óptico, só o alfabeto latino (`src/assets/fonts/inter-latin-opsz.woff2`, 73 KB), guardada dentro do app para funcionar sem internet.
- Peças sem visual, quando forem precisas: Radix UI (só os pacotes usados), TanStack Virtual para listas longas.
- Dados:
  - banco **só local** (SQLite) para o cache dos e-mails;
  - tokens e senhas no cofre do sistema (Chaves do macOS / Credential Manager do Windows), nunca no localStorage;
  - agenda pelo EventKit no Mac e pelas APIs do Google/Microsoft no Windows.

## Comandos

- `npm install`: instala as dependências.
- `npm run dev`: só as telas, no navegador (porta 1420). Parâmetros da prévia: `?theme=dark`, `?step=3` (onboarding), `?screen=inbox|read|compose|day|week|month|settings`, `?native=1` (simula a janela do Mac), `?preload=onboarding` (pega estilos vazando entre telas).
- `npm run build`: confere os tipos e gera `dist/`.
- `npm test`: testes das partes das telas sem React (`src/**/*.test.ts`, rodam direto no Node).
- `npm run tauri dev`: abre o app de verdade. Precisa de Rust; no Mac, também do Xcode.
- `npm run tauri build`: gera o instalador.

## Design

- Fonte da verdade: canvas "Quill" no Doop (https://sirus-vps.tail6e87c3.ts.net:10001/c/LmKkz1PF7S), guideline `quill-estilo`. Há uma cópia em `docs/design.md` e as imagens das telas estão em `design/telas/`.
- Cada tela tem que ficar **igual ao desenho aprovado**, em modo claro e escuro.
- Botões em pílula com degradê e brilho no topo (acabamento do runelay); nunca botão verde.
- **Nomes de classe CSS exclusivos por tela.** O CSS de uma tela carregada sob demanda continua ativo depois que ela fecha, então nomes genéricos repetidos (`.invite`, `.today`, `.week`) vazam de uma tela para outra. Use um prefixo por tela (`ob-`, `inbox-`, `cal-`…) ou CSS Modules (`*.module.css`) nas telas novas.
- Leveza é requisito:
  - nada de dependência grande sem necessidade;
  - telas pesadas com carregamento sob demanda (`React.lazy`);
  - animações só com `transform`/`opacity`.

## Login e segredos

- Credenciais do app do Google (OAuth "App para computador"): no **Infisical, projeto `quill`** (`.infisical.json` na raiz), variáveis `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET` (ambientes `dev` e `prod`).
- O `src-tauri/build.rs` embute as duas na montagem, vindas das variáveis (`infisical run --env=prod -- npm run tauri build`) ou do arquivo `src-tauri/oauth.local.env` (fora do git). Sem elas o app monta, mas o login avisa "não configurado".
- O app do Google está em **Testando** (usuários de teste: as contas do Gabriel). Nesse modo o Google desconecta a cada 7 dias; para publicar faltam página inicial e política de privacidade na aba Branding.
- Google Agenda: `quill-core/src/calendar.rs` (leitura, resposta a convites, criar evento); nas telas, `src/state/calendar.ts` junta as cópias do mesmo convite entre contas (iCalUID + início) para não repetir evento. Microsoft (Graph) ainda precisa do login Microsoft.
- Anexos: envio pelo upload do Gmail (até 25 MB), download para Downloads, "ver sem baixar" com Quick Look (`quill-core/src/files.rs`). Ícone real do tipo de arquivo: `FileIcon`.
- Agenda e contatos do iCloud: CalDAV/CardDAV em `quill-core/src/{ical,dav,caldav,carddav,dav_client}.rs` (só para `*.icloud.com`, mesma senha de app).
- iCloud e "Outro e-mail": IMAP/SMTP em `quill-core/src/imap*.rs` (senha de app no cofre único das Chaves); os comandos do `lib.rs` escolhem Google ou IMAP pelo provedor da conta. Microsoft ainda falta (precisa do ID do app registrado no Azure).
- Atualização automática: `tauri-plugin-updater` lendo as releases do GitHub; publicar com `scripts/release-mac.sh` no Mac (chave em `~/.tauri/quill-updater.key`), ADR-026.
- Touch ID: `src-tauri/src/touchid.rs` (LocalAuthentication, só compila no Mac).
- Login do Google no Mac: janela de login do sistema (ASWebAuthenticationSession) em `src-tauri/src/websheet.rs`, volta ainda pelo `127.0.0.1`; cai para o navegador se não abrir (ADR-022).
- Lógica do login e do Gmail em `src-tauri/crates/quill-core` (testes: `cargo test --features net` dentro dessa pasta; roda até na VPS). Tokens de acesso permanentes e senhas de app ficam num único item das Chaves do sistema (`app.quill.desktop` / `cofre`, lido uma vez por abertura, `quill-core/src/vault.rs`, ADR-024), nunca em arquivo.

## Fluxo de trabalho

- Conferir as telas na **prévia** (navegador) com prints, em claro e escuro.
- **REGRA: nunca gerar, montar ou instalar o app no Mac sem o Gabriel pedir na hora.** Ele avisa quando quer o app novo. Vale também para agentes no Mac: se for indispensável compilar para conferir código só de Mac, compile sem instalar, sem abrir e sem trocar o app em /Applications.
- No Mac, os prints são só da janela do Quill (`screencapture -l <id>`), nunca da tela inteira, porque ela mostra os e-mails pessoais.

## Padrões de interface

- Botões só com ícone: `aria-label` + dica `data-tip="…"` (pílula escura; `data-tip-pos="right"` na barra lateral).
- Barra de rolagem fina e arredondada, definida em `src/styles/components.css`.
- Resposta a convite: confirmação com barrinha de tempo (4 s, dá para desfazer), depois o convite some (`RsvpButtons` / `InviteGate`).
- Estado compartilhado entre telas (tela atual, lidos, resposta do convite, agendas visíveis) em `src/state/store.ts`; e-mails, contas, contadores e fotos em `src/state/mailbox.ts`.
- Nada de `<select>` nativo: use `Select` (`src/components/Select.tsx`). Janelinhas flutuantes com Radix Popover e a classe `qp-content` (já anima a entrada e a saída).
- Abas e botões segmentados com `SliderGroup` (o destaque desliza até o item com `aria-current`/`aria-pressed`/`aria-checked`).
- Avisos rápidos: `toast("texto")` ou `toast("texto", "error")` (`src/components/Toasts.tsx`).
- Preferências que outras telas precisam ver na hora: `usePref` (`src/lib/usePref.ts`).
- Entrada das telas: o `AppShell` aplica `.screen-enter`; listas usam `.stagger`.
- Busca geral ⌘K (`CommandPalette`, carregada só na primeira vez) e atalhos em `src/shell/shortcuts.ts`: ⌘K, ⌘, (Ajustes), ⌘N (escrever), ⌘R (atualizar), C, / e G depois E ou C.

## Skills obrigatórias

Carregue a skill **antes** de começar o tipo de trabalho correspondente:

| Quando | Skills |
|---|---|
| Qualquer código React/Vite | `react-best-practices`, `react-vite-best-practices` |
| Qualquer coisa em `src-tauri/` (Rust, `tauri.conf.json`, plugins, comandos) | `tauri-v2` |
| Permissões, capabilities, CSP, tokens, senhas, login | `tauri-security` |
| Animações e transições | `motion-design`, `fixing-motion-performance` |
| Telas novas ou ajustes visuais | `baseline-ui`, `fixing-accessibility` |
| Bug, erro ou comportamento estranho | `systematic-debugging` |
| Lógica nova (sincronização, parser, banco) | `test-driven-development` |
| Testes de ponta a ponta das telas | `playwright-best-practices` |
| Etapa grande (várias telas ou recursos) | `writing-plans` |
| Antes de dizer que terminou, commitar ou abrir PR | `verification-before-completion` |

## Git

- Repositório **público** `viannaanalyst/quill` (desde 2026-11-17, para a atualização automática), branch `main`. Nunca commite segredos. Autor: viannaanalyst <contato@inovawebtech.com.br>.
- Commit e push só quando o Gabriel pedir ou autorizar.
- Cópias de trabalho: VPS (`/home/dev/projetos/quill`) e MacBook (`/Users/gabrielvianna/Projetos/quill`). O Mac monta e testa o app; a sincronização é pelo GitHub.

## Para quando chegar a hora (pedidos já feitos)

- Login = entrar com Google / Microsoft / iCloud / IMAP na página oficial de cada serviço. Não existe conta Quill.
- Abrir o app com Touch ID no Mac (Windows Hello no Windows).
