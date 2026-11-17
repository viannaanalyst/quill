# Quill: instruções para agentes

App de e-mail e calendário, **macOS primeiro**, depois Windows. Começou como uso pessoal do Gabriel, mas a ideia é que outras pessoas possam usar. **Sem IA dentro do app.** Responda sempre em português do Brasil, em linguagem simples (o Gabriel não é técnico).

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

## Fluxo de trabalho

- Conferir as telas na **prévia** (navegador) com prints, em claro e escuro. **Não remontar o app no Mac a cada mudança** (pedido do Gabriel, para economizar): montar só quando terminar uma etapa grande ou quando for preciso ver algo que só existe na janela nativa.
- No Mac, os prints são só da janela do Quill (`screencapture -l <id>`), nunca da tela inteira, porque ela mostra os e-mails pessoais.

## Padrões de interface

- Botões só com ícone: `aria-label` + dica `data-tip="…"` (pílula escura; `data-tip-pos="right"` na barra lateral).
- Barra de rolagem fina e arredondada, definida em `src/styles/components.css`.
- Resposta a convite: confirmação com barrinha de tempo (4 s, dá para desfazer), depois o convite some (`RsvpButtons` / `InviteGate`).
- Estado compartilhado entre telas (tela atual, lidos, resposta do convite, agendas visíveis) em `src/state/store.ts`.

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

- Repositório privado `viannaanalyst/quill`, branch `main`. Autor: viannaanalyst <contato@inovawebtech.com.br>.
- Commit e push só quando o Gabriel pedir ou autorizar.
- Cópias de trabalho: VPS (`/home/dev/projetos/quill`) e MacBook (`/Users/gabrielvianna/Projetos/quill`). O Mac monta e testa o app; a sincronização é pelo GitHub.

## Para quando chegar a hora (pedidos já feitos)

- Anexos com o ícone real do tipo de arquivo, prévia sem baixar (Quick Look no Mac) e barra de progresso de envio animada.
- Login = entrar com Google / Microsoft / iCloud / IMAP na página oficial de cada serviço. Não existe conta Quill.
- Abrir o app com Touch ID no Mac (Windows Hello no Windows).
