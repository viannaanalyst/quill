---
type: indice
tags: [quill, email, calendario, documentacao]
updated: 2026-11-17
---

# Documentação do Quill

App de e-mail e calendário para o Mac (depois Windows), feito em Tauri v2 + React. Sem IA dentro do app. Esta pasta
segue as [convenções de documentação do Quill](_referencia/convencoes-documentacao.md), adaptadas do padrão usado no
inchurch-contratos e na techbpo.

## Por onde começar

| Você quer | Leia |
|---|---|
| Instalar, conectar contas ou resolver "o Google desconectou" | [guia-rapido.md](guia-rapido.md) |
| Aprender a usar o dia a dia (ler, responder, agenda, Chat, Touch ID…) | [04-tutorial-uso.md](04-tutorial-uso.md) |
| Entender para que o app serve, o que já funciona e o que falta | [00-visao-geral.md](00-visao-geral.md) |
| Mexer no código | [01-arquitetura-tecnica.md](01-arquitetura-tecnica.md) |
| Saber por que algo foi feito de um jeito | [02-decisoes-adrs/](02-decisoes-adrs/) (24 decisões) |
| Consultar termos, preferências, cores e parâmetros da prévia | [05-referencia.md](05-referencia.md) |
| Ver o que mudou e quando | [06-changelog.md](06-changelog.md) |
| Ver o guia de estilo visual | [`docs/design.md`](../docs/design.md) e [`design/telas/`](../design/telas/) |

## Decisões registradas

| ADR | Decisão |
|---|---|
| [001](02-decisoes-adrs/ADR-001-app-em-tauri-e-react.md) | App próprio em Tauri v2 + React |
| [002](02-decisoes-adrs/ADR-002-sem-ia-dentro-do-app.md) | Sem IA dentro do app |
| [003](02-decisoes-adrs/ADR-003-login-pela-pagina-oficial-de-cada-servico.md) | Login pela página oficial de cada serviço; não existe conta Quill |
| [004](02-decisoes-adrs/ADR-004-credenciais-no-infisical-e-segredos-nas-chaves.md) | Credenciais no Infisical; tokens e senhas só nas Chaves |
| [005](02-decisoes-adrs/ADR-005-logica-testavel-na-quill-core.md) | Lógica testável separada na crate `quill-core` |
| [006](02-decisoes-adrs/ADR-006-visual-pelo-canvas-do-doop.md) | Visual: canvas do Doop como fonte da verdade |
| [007](02-decisoes-adrs/ADR-007-nada-de-controle-nativo.md) | Nada de controle nativo (selects, datas, cores) |
| [008](02-decisoes-adrs/ADR-008-classes-css-com-prefixo-por-tela.md) | Classes CSS com prefixo por tela |
| [009](02-decisoes-adrs/ADR-009-conferir-na-previa-e-montar-so-quando-pedir.md) | Conferir na prévia; montar no Mac só quando pedir |
| [010](02-decisoes-adrs/ADR-010-email-formatado-em-quadro-isolado.md) | E-mail formatado em quadro isolado, imagens externas bloqueadas |
| [011](02-decisoes-adrs/ADR-011-fotos-e-logos-dos-remetentes.md) | Fotos e logos dos remetentes, desligáveis |
| [012](02-decisoes-adrs/ADR-012-convites-repetidos-entre-contas-juntados.md) | Convites repetidos entre contas juntados |
| [013](02-decisoes-adrs/ADR-013-desfazer-envio-com-espera.md) | Desfazer envio: o e-mail espera antes de sair |
| [014](02-decisoes-adrs/ADR-014-rascunhos-no-servidor-assinatura-so-no-envio.md) | Rascunhos no servidor; assinatura só no envio |
| [015](02-decisoes-adrs/ADR-015-icloud-e-imap-com-senha-de-app-microsoft-depois.md) | iCloud e IMAP com senha de app; Microsoft adiado |
| [016](02-decisoes-adrs/ADR-016-onboarding-uma-vez-so.md) | Onboarding uma vez só; Sair não volta para ele |
| [017](02-decisoes-adrs/ADR-017-touch-id-pelo-macos.md) | Touch ID pela autenticação do macOS |
| [018](02-decisoes-adrs/ADR-018-ilustracoes-geradas-pelo-codex.md) | Ilustrações e variações do ícone geradas pelo Codex |
| [019](02-decisoes-adrs/ADR-019-avisos-no-topo-e-dicas-sem-sobrepor-menus.md) | Avisos no topo; dicas somem com menu aberto |
| [020](02-decisoes-adrs/ADR-020-dados-de-exemplo-so-na-previa.md) | Dados de exemplo só na prévia |
| [021](02-decisoes-adrs/ADR-021-anexos-so-em-downloads-e-previa-sem-baixar.md) | Anexos só em Downloads e prévia sem baixar |
| [022](02-decisoes-adrs/ADR-022-login-google-na-folha-do-macos.md) | Login do Google na janela de login do macOS |
| [023](02-decisoes-adrs/ADR-023-google-chat-pela-api-so-workspace.md) | Google Chat pela API (só Workspace), atualização por consulta periódica |
| [024](02-decisoes-adrs/ADR-024-cofre-unico-nas-chaves.md) | Cofre único nas Chaves, lido uma vez por abertura |

## O que das convenções não se aplica ainda

- **BPMN:** os fluxos de hoje (login, envio com "Desfazer", resposta a convite) cabem em texto no
  `01-arquitetura-tecnica.md`. Entra quando houver sincronização com cache local, envio agendado de verdade ou o
  processo de publicar o app do Google.
- **RACI (`03-responsabilidades.md`):** só o Gabriel usa e decide. Entra quando outra pessoa usar ou testar o app.
- **VSM:** não há processo com tempo de espera medido.
- **KPIs na ficha:** nada foi medido além dos testes e do tamanho do app; não há meta definida.

## Quem mantém

O Gabriel decide; os agentes de IA que mexem no código atualizam o [changelog](06-changelog.md) e os documentos
afetados a cada mudança (regra no `AGENTS.md` da raiz).
