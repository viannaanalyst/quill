---
type: convencao
tags: [documentacao, padrao, claude, processo, frameworks]
updated: 2026-11-17
---

# Convenções de documentação do Quill

Toda documentação deste projeto segue os três planos abaixo. Leia este arquivo antes de documentar qualquer coisa.

Este padrão veio do projeto inchurch-contratos, passou pela techbpo e foi adaptado para o Quill em 2026-11-17: os
exemplos, a estrutura de pastas e a nomenclatura abaixo são os deste repositório.

**O que já se aplica hoje:** ficha e SIPOC na visão geral, arquitetura (C4), ADRs, guia rápido, tutorial de uso
(Diataxis), referência com glossário e dicionário de dados, e changelog.

**O que entra depois:**
- **BPMN:** quando houver um fluxo com mais de um ator ou com muitas ramificações. Por exemplo, a sincronização com
  banco local (SQLite), o envio agendado ou a publicação do app do Google.
- **RACI (`03-responsabilidades.md`):** quando mais de uma pessoa mantiver ou usar o Quill. Hoje é só o Gabriel.
- **VSM:** quando houver um processo com tempo de espera a medir, como a montagem e a distribuição do app.

---

## Os Três Planos Obrigatórios

```
┌─────────────────────────────────────────────────────────┐
│                   DOCUMENTAÇÃO COMPLETA                  │
├─────────────┬──────────────────────┬────────────────────┤
│  TÉCNICA    │  LÓGICA/ESTRATÉGICA  │   USO DO OUTPUT    │
│  (O QUÊ    │  (POR QUÊ foi assim) │  (COMO usar o      │
│  foi feito) │  e PARA QUÊ serve)   │   resultado)       │
│             │                      │                     │
│  Audiência: │  Audiência:          │  Audiência:         │
│  Engenheiro │  Gestor / Analista   │  Usuário final      │
│  Arquiteto  │  PO / Stakeholder    │  Operador           │
└─────────────┴──────────────────────┴────────────────────┘
```

No Quill, o "usuário final" é quem usa o app no Mac (hoje, o Gabriel). O "engenheiro" é o agente de IA ou a pessoa
que mexe no código.

---

## PLANO 1 — Documentação Técnica

### 1.1 BPMN 2.0 — Mapa do Processo
**Framework:** OMG Standard ISO/IEC 19510

Modelagem visual obrigatória quando o processo tem ramificações ou múltiplos atores.

**Elementos essenciais:**

| Elemento | Quando usar |
|---|---|
| Círculo simples | Evento de início (trigger) |
| Retângulo | Tarefa executada por ator |
| Losango com X | Gateway XOR — decisão exclusiva |
| Losango com + | Gateway AND — paralelismo |
| Círculo duplo | Evento intermediário (espera, timer) |
| Círculo grosso | Evento de fim |
| Pool/Lane | Separação por ator ou sistema |

**Ferramentas:** draw.io (gratuito), Lucidchart, Miro, Camunda Modeler.

**No Quill, ainda não se aplica.** Os fluxos de hoje (login, enviar com "Desfazer", responder convite) cabem em texto
no `01-arquitetura-tecnica.md`. Candidatos a BPMN quando surgirem: sincronização com cache local, envio agendado e o
processo de publicar o app do Google.

---

### 1.2 C4 Model — Arquitetura do Sistema
**Framework:** Simon Brown — adotado por ThoughtWorks, Spotify, AWS docs

Quatro níveis de zoom com públicos diferentes:

- **Nível 1 — Context:** O que o sistema faz e com o que se conecta?
- **Nível 2 — Container:** Quais são as peças tecnológicas e como se comunicam?
- **Nível 3 — Component:** Quais módulos internos compõem cada container?
- **Nível 4 — Code:** Apenas para sistemas críticos que justificam esse detalhe.

**No Quill:** os níveis 1 a 3 ficam em `01-arquitetura-tecnica.md`.
- Contexto: Gmail, Google Agenda, People API, iCloud (IMAP/SMTP/CalDAV/CardDAV), outros provedores IMAP, Chaves do
  macOS, Gravatar e ícones de sites.
- Containers: telas React, parte nativa Tauri (`src-tauri/src`) e crate `quill-core`.
- Componentes: módulos da `quill-core`, comandos do `lib.rs` e o estado das telas (`src/state/*`).

---

### 1.3 ADR — Architecture Decision Records
**Framework:** Michael Nygard (2011) — usado por Google, Netflix, Zalando

Documenta decisões técnicas irreversíveis com seu contexto e consequências.

**Template ADR:**

```markdown
---
type: adr
tags: [quill, ...]
updated: AAAA-MM-DD
---

# ADR-00X: [Título da Decisão]

**Status:** Proposto | Aceito | Depreciado | Substituído por ADR-00X (AAAA-MM-DD)

**Contexto**
Qual era o problema? Quais restrições existiam (tempo, tecnologia, custo, equipe)?

**Decisão**
O que foi decidido, de forma direta. "Decidimos usar X porque..."

**Consequências**
- Positivas: o que ficou melhor
- Negativas: o que ficou pior ou precisará de atenção
- Trade-offs aceitos conscientemente

**Alternativas consideradas**
Por que Y e Z foram descartados.
```

**Exemplo Quill:**
```markdown
# ADR-008: Nomes de classe CSS com prefixo por tela

**Status:** Aceito (2026-11-17)

**Contexto**
As telas carregam sob demanda (`React.lazy`). O CSS de uma tela continua ativo
depois que ela fecha. As classes `.invite` e `.today` do onboarding vazaram
para a caixa de entrada e sobrepuseram um cartão.

**Decisão**
Cada tela usa um prefixo próprio (`ob-`, `inbox-`, `cal-`, `st-`…) ou CSS Modules.

**Consequências**
- Positivo: uma tela não estraga a outra
- Negativo: nomes mais longos
- Atenção: a prévia tem `?preload=onboarding` para pegar vazamentos

**Alternativas consideradas**
- CSS-in-JS: pesa mais e foge do "CSS puro com tokens"
```

---

### 1.4 Dicionário de Dados

Para o que envolve dados ou configuração, documentar cada campo relevante.

**No Quill**, o dicionário fica em `05-referencia.md` e cobre:
- as preferências guardadas no `localStorage` com prefixo `quill.`;
- o arquivo `accounts.json` (lista das contas, sem senhas);
- os serviços das Chaves do sistema (`app.quill.desktop.google`, `app.quill.desktop.imap`).

Exemplo:

```markdown
## Preferências (localStorage, prefixo `quill.`)

| Chave | Tipo | Valores | Significado |
|---|---|---|---|
| theme | string | `system`, `light`, `dark` | Tema do app; `system` segue o Mac |
| undoSeconds | number | 5, 10, 20, 30 | Segundos que o e-mail espera antes de sair |
| touchId | boolean | true, false | Pede Touch ID ao abrir o app (só no Mac) |
```

**Regra:** Documentar o campo *e seus valores válidos*, não apenas o nome. Senha, token e ID de cliente OAuth nunca
entram na documentação, nem como exemplo.

---

## PLANO 2 — Documentação Lógica/Estratégica

### 2.1 SIPOC
**Framework:** Six Sigma (Motorola/GE) — primeiro artefato a criar, antes do BPMN

```
Suppliers | Inputs | Process | Outputs | Customers
Quem fornece os dados/recursos? | O que entra? | Etapas (5–7 passos) | O que sai? | Quem recebe e usa?
```

**Exemplo — Quill:**

| Suppliers | Inputs | Process | Outputs | Customers |
|---|---|---|---|---|
| Google (Gmail, Agenda, Contatos) | E-mails, eventos, contatos | 1. Abre o app (Touch ID, se ligado) | Caixa de entrada unificada | Gabriel |
| Apple iCloud / outros IMAP | E-mails, eventos, contatos | 2. Conecta as contas na página oficial de cada serviço | E-mails enviados e respondidos | Quem recebe os e-mails |
| Chaves do macOS | Tokens e senhas de app | 3. Lê e organiza os e-mails | Convites respondidos, eventos criados | Quem convidou |
| Gabriel | Preferências, assinatura, foto | 4. Escreve e envia (com "Desfazer") | — | — |
| — | — | 5. Consulta e cria compromissos no Calendário | — | — |

O SIPOC completo fica em `00-visao-geral.md`.

---

### 2.2 Matriz RACI
**Framework:** PMI — define responsabilidades humanas no processo

| Etapa | Ator A | Ator B | Ator C |
|---|---|---|---|
| Extração | **R** | I | C |
| Validação | C | **R** | — |
| Publicação | **R** | I | C |
| Aprovação | C | C | **A** |

- **R** = Responsible (executa)
- **A** = Accountable (aprova, responde pelo resultado — exatamente um por linha)
- **C** = Consulted (consultado antes/durante)
- **I** = Informed (informado depois)

**Regra crítica:** Cada linha deve ter exatamente **um A**. Mais de um A = ninguém é responsável.

**No Quill, ainda não se aplica:** o Gabriel decide e aprova tudo, e os agentes de IA executam. Criar
`03-responsabilidades.md` quando outra pessoa entrar (por exemplo, quem for testar a versão para Windows).

---

### 2.3 Ficha Estratégica do Processo

```markdown
## Ficha do Processo: [Nome]

**Propósito:** Em uma frase — qual problema este processo resolve?
**Gatilho:** O que inicia o processo? (evento, periodicidade, demanda manual)
**Frequência:** Diário / Semanal / Sob demanda

**KPIs do Processo**
- Tempo de execução esperado: X minutos
- Taxa de erro aceitável: < X%
- SLA de entrega: até D+1

**Dependências críticas**
- [Sistema A] deve estar disponível
- [Aprovação de B] necessária antes da etapa 3

**Riscos e Mitigações**
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Google desconecta a cada 7 dias (app em "Testando") | Alta | Médio | Entrar de novo; publicar o app do Google |
| Senha de app do iCloud revogada | Baixa | Médio | Conectar a conta de novo com outra senha de app |

**Histórico de versões**
| Versão | Data | Autor | O que mudou |
|---|---|---|---|
| 1.0 | AAAA-MM-DD | [Nome] | Criação inicial |
```

No Quill, a ficha fica no começo de `00-visao-geral.md`. Não há KPIs medidos ainda; não inventar.

---

### 2.4 Value Stream Map (VSM) — Identificar Desperdícios
**Framework:** Lean Manufacturing (Toyota Production System)

Mostra o fluxo de valor com tempos, revelando onde o processo perde tempo ou qualidade:

```
[Coleta]   →   [Transformação]   →   [Validação]   →   [Publicação]
  5 min            15 min              10 min              2 min

Tempo de valor agregado: 32 min
Lead time real: 4 horas (aguarda job noturno)
Eficiência do fluxo: 32min / 240min = 13% ← oportunidade de melhoria
```

Use VSM para justificar automações e priorizações de melhoria.

**No Quill, ainda não se aplica.** Candidato futuro: o caminho de uma mudança até o app montado no Mac (VPS →
GitHub → Mac → `npm run tauri build`), se esse tempo virar um problema.

---

## PLANO 3 — Documentação de Uso do Output

### 3.1 Framework Diataxis
**Framework:** Daniele Procida — adotado por Google, Kubernetes, Django docs

```
┌──────────────────────┬──────────────────────┐
│   TUTORIAL           │   HOW-TO GUIDE        │
│   (aprender fazendo) │   (resolver problema) │
│   Orientado ao       │   Orientado ao        │
│   aprendizado        │   objetivo            │
├──────────────────────┼──────────────────────┤
│   EXPLANATION        │   REFERENCE           │
│   (entender o por    │   (consulta rápida)   │
│    quê)              │   Orientado à         │
│   Orientado ao       │   informação          │
│   entendimento       │                       │
└──────────────────────┴──────────────────────┘
```

Cada quadrante serve um momento diferente do usuário. Uma documentação completa tem os quatro.

**No Quill:**

| Quadrante | Onde |
|---|---|
| Tutorial | `04-tutorial-uso.md`, parte "Primeiro dia com o Quill" |
| How-to | `04-tutorial-uso.md`, parte "Como fazer" (uma tarefa por seção) e `guia-rapido.md` |
| Explanation | `02-decisoes-adrs/` (o porquê de cada escolha) |
| Reference | `05-referencia.md` (glossário, preferências, cores, parâmetros da prévia) |

---

### 3.2 Template — Tutorial de Uso

```markdown
# Como usar: [Nome do Dashboard/Output]

## O que você vai aprender
Ao final deste tutorial, você conseguirá:
- [ ] Navegar pelo sistema
- [ ] Interpretar as métricas principais
- [ ] Exportar dados para análise pontual

## Pré-requisitos
- Acesso ao [link do sistema]
- Permissão de visualização (solicitar para: fulano@empresa.com)

## Passo a Passo

### Passo 1 — Acesso
1. Acesse [URL]
2. Faça login com sua conta Google corporativa

> **Dica:** Se aparecer erro de permissão, aguarde 24h após solicitar acesso.

### Passo 2 — [Próxima ação]
[Descrição com screenshot ou texto visual]

## Erros comuns e como resolver

| Sintoma | Causa provável | Solução |
|---|---|---|
| Dados zerados | Job não rodou | Verificar data de atualização no rodapé |
| Valor inesperado | Filtro ativo | Limpar todos os filtros (botão "Reset") |
| Sem acesso | Permissão expirou | Solicitar via [link do formulário] |
```

No Quill, prints do app real mostram e-mails pessoais: use texto ou as imagens de `design/telas/`, nunca um print da
caixa de entrada de verdade.

---

### 3.3 Template — How-To Guide

```markdown
# Como fazer: [Tarefa específica]

**Quando usar:** [contexto de uso]
**Tempo estimado:** X minutos

## Passos
1. [Passo 1]
2. [Passo 2]

## O que o resultado contém
- [Campo A]: [significado]
- [Campo B]: [significado]

## Limitações
- [Limitação 1]
- Para volumes maiores, [alternativa]
```

---

### 3.4 Template — Reference (Glossário)

```markdown
# Referência: Glossário

| Termo | Definição | Onde aparece | Observação |
|---|---|---|---|
| Senha de app | Senha gerada no site da Apple só para o Quill | Conectar iCloud | Não é a senha do Apple ID |
| Prévia | As telas abertas no navegador, sem a parte nativa | `npm run dev` | Usa dados de exemplo |
```

---

## Seção Obrigatória: Guia Rápido

**Toda documentação de processo deve conter uma seção "Guia Rápido"** voltada para o usuário final.
Deve vir logo após a visão geral, antes dos detalhes técnicos.

O Guia Rápido deve conter:
- Links diretos para acessar o sistema
- Passo a passo em linguagem simples
- O que acontece após cada ação (onde cai, quem é notificado)
- Segmentado por perfil quando há mais de um ator
- Alertas automáticos explicados (quando chegam, o que contêm, para quem)

No Quill, o guia rápido (`guia-rapido.md`) cobre: instalar e abrir, conectar contas, sair e entrar de novo, atalhos,
o que fazer quando o Google desconecta e como pedir uma montagem nova.

---

## Estrutura de pastas

```
Documentacoes/
├── README.md                  ← índice: por onde começar
├── guia-rapido.md             ← instalar, conectar contas, atalhos, Google desconectado
├── 00-visao-geral.md          ← ficha do projeto + SIPOC + o que funciona + pendências e riscos
├── 01-arquitetura-tecnica.md  ← C4, pastas, módulos, comandos, segurança, montagem, verificação
├── 02-decisoes-adrs/
│   ├── ADR-001-[titulo].md
│   └── ADR-002-[titulo].md
├── 03-responsabilidades.md    ← RACI (criar quando houver mais de uma pessoa)
├── 04-tutorial-uso.md         ← Diataxis: tutorial + how-to do dia a dia
├── 05-referencia.md           ← glossário, dicionário de dados, cores, parâmetros da prévia
├── 06-changelog.md            ← o que mudou, por data
└── _referencia/               ← este arquivo e materiais de apoio
```

O guia de estilo visual continua em `docs/design.md` (cópia do canvas do Doop), e as imagens das telas aprovadas em
`design/telas/`. A documentação aponta para eles; não copia.

---

## Onde salvar

| Tipo | Lugar |
|---|---|
| Documentação do projeto | `Documentacoes/` |
| Decisão que muda o rumo do projeto | `Documentacoes/02-decisoes-adrs/` |
| Guia de estilo visual | `docs/design.md` (espelho do canvas "Quill" no Doop) |
| Regras para agentes de IA | `AGENTS.md` na raiz |
| Fato que precisa valer entre conversas | memória no runelay |
| Prévias e desenhos de tela | canvas "Quill" no Doop (link em `05-referencia.md`) |
| Credenciais do app do Google | Infisical, projeto `quill` (nunca no repositório nem na documentação) |

---

## Padrão de nomenclatura

- Arquivos numerados em minúsculas com hífen: `00-visao-geral.md`, `06-changelog.md`.
- ADRs: `ADR-NNN-titulo-curto-da-decisao.md`, numerados em sequência e nunca renumerados. Decisão revista ganha um ADR
  novo, e a antiga muda o status para "Substituído por ADR-NNN".
- O nome descreve o assunto, não a ferramenta.
  - ✅ `ADR-013-desfazer-envio-com-espera.md`
  - ❌ `ADR-013-outbox-ts.md`
- Todo arquivo começa com o cabeçalho `type`, `tags` e `updated`.

---

## Regras de conteúdo do Quill

- Não inventar números nem resultados. Número só entra se foi medido (testes rodados, tamanho do app montado) e com
  a data.
- Dizer com clareza o que foi verificado e o que não foi. Exemplo: "testado na prévia do navegador; ainda não testado
  no app do Mac".
- Datas sempre absolutas (`2026-11-17`), nunca "ontem" ou "semana passada".
- Português do Brasil, frases diretas, em linguagem que o Gabriel entenda (ele não é técnico). Termo técnico, quando
  precisar, vai explicado no glossário.
- Nada de segredos: IDs de cliente OAuth, senhas, tokens e senhas de app nunca entram. O Infisical é citado só como
  "projeto quill".
- Nada de dado pessoal: nenhum e-mail, assunto ou nome de contato real em exemplo ou print.

---

## Checklist de Qualidade

**Completude**
- [ ] Um não-técnico entende o propósito lendo apenas `00-visao-geral.md`?
- [ ] Um engenheiro novo consegue replicar lendo `01-arquitetura-tecnica.md`?
- [ ] O usuário final consegue usar o output sem perguntar para ninguém?

**Manutenibilidade**
- [ ] Tem data de criação e autor?
- [ ] Tem histórico de versões?
- [ ] Está claro quem mantém o documento atualizado?

**Precisão**
- [ ] Todo termo de negócio está no glossário?
- [ ] Campos de dados têm valores válidos documentados?
- [ ] Screenshots têm data ou foram substituídos por texto que não desatualiza?

**Acessibilidade**
- [ ] Está em lugar que todos os stakeholders acessam?
- [ ] O nome do arquivo é descritivo o suficiente para ser encontrado por busca?

---

## Frameworks de Referência

| Framework | Origem | Melhor para | No Quill |
|---|---|---|---|
| BPMN 2.0 | OMG / ISO 19510 | Modelagem visual de fluxos com decisões | Depois |
| C4 Model | Simon Brown | Arquitetura de software em múltiplos níveis | `01-arquitetura-tecnica.md` |
| ADR | Michael Nygard | Registro de decisões técnicas irreversíveis | `02-decisoes-adrs/` |
| SIPOC | Six Sigma / Motorola | Visão estratégica rápida de qualquer processo | `00-visao-geral.md` |
| RACI | PMI / BPM CBOK | Clareza de responsabilidades humanas | Depois |
| VSM | Toyota / Lean | Identificação de desperdícios e lead time | Depois |
| Diataxis | Daniele Procida | Estruturação de documentação de uso | `04-tutorial-uso.md` + `05-referencia.md` |
| Arc42 | Gernot Starke | Documentação de arquitetura de software completa | Referência para crescer o `01` |
