---
type: adr
tags: [quill, adr, google-chat, workspace, anexos, audio, reacoes]
updated: 2026-11-17
---

# ADR-023: Google Chat pela API com login do usuário (só Workspace), atualização por consulta periódica

**Status:** Aceito (2026-11-17)

**Contexto**
O Gabriel quer o Google Chat da conta da empresa (Google Workspace) dentro do Quill: conversas diretas, grupos e
espaços, com leitura, envio, anexos, áudio e vídeo. O desenho aprovado está na página "Chat" do canvas no Doop. A API
do Google Chat tem limites que mudam o que dá para mostrar:
- só funciona com contas **Google Workspace**; contas pessoais (Gmail) não têm Chat pela API;
- com login do usuário, a API devolve só o id de quem enviou (`users/<id>`), sem nome nem foto;
- não avisa em tempo real (o aviso por eventos exige um app de Chat publicado e um servidor público);
- o recurso Space **não tem ícone, avatar nem emoji** do espaço; tem `membershipCount` e `spaceUri`;
- os anexos não trazem tamanho, número de páginas nem miniatura que o app possa abrir sem o cookie do Google.

**Decisão**
- **Login do próprio usuário** (OAuth), com quatro permissões novas no login do Google: `chat.spaces.readonly`,
  `chat.messages` (ler e enviar), `chat.memberships.readonly` e `directory.readonly` (nomes e fotos das pessoas da
  empresa pela People API). Quem entrou antes precisa entrar de novo; o erro de permissão vira aviso com botão.
- **Nomes e fotos** pela People API (`people:batchGet`, o mesmo id do `users/<id>`), guardados na memória enquanto o
  app está aberto (`ChatService`, em `quill-core/src/chat_client.rs`).
- **Ícone de espaço e grupo:** até 3 fotos das pessoas empilhadas; o "#" só aparece quando não dá para saber quem está.
- **Atualização por consulta periódica**, só com a tela do Chat aberta e a janela à vista: a conversa aberta a cada
  8 s e a lista a cada 30 s. Com o Chat fechado, a lista atualiza junto com os e-mails (a cada 3 min), para a bolinha
  da barra lateral.
- **Não lidas controladas no app:** guarda até quando cada conversa foi vista (`quill.chat.seen`) e compara com a
  atividade da API. Na primeira vez de cada conta, o que já existe conta como lido. A lista traz o horário das 10
  últimas mensagens dos outros, e o contador azul mostra quantas chegaram depois ("9+" acima disso).
- **Anexos:**
  - receber: o conteúdo vem pelo `media.download` (até 50 MB para mostrar no app, até 200 MB para salvar em
    Downloads); imagem e GIF em miniatura, vídeo com player, áudio com player compacto e ondinha, os demais com
    `FileIcon`, "Ver" (prévia do app) e "Baixar"; anexos do Google Drive abrem no navegador;
  - enviar: o arquivo sobe pelo `attachments:upload` (até 200 MB) assim que entra na caixa, com barra de progresso
    real (evento `chat-upload-progress`) e "Tentar de novo"; o conteúdo vai cru no corpo do pedido à parte nativa,
    sem base64; cada arquivo vira uma mensagem (o texto vai junto do primeiro).
- **Gravar áudio** com `getUserMedia` + `MediaRecorder` (mp4 no WebView do Mac, webm nos outros), com a frase de
  permissão do microfone no `src-tauri/Info.plist`.
- **Fixadas** só neste computador (`quill.chat.pinned`): a API não diz o que está fixado no Google Chat.

**Consequências**
- Positivas: o Chat da empresa fica ao lado dos e-mails, sem servidor do Quill e sem guardar mensagens em disco.
- Negativas:
  - mensagens novas aparecem com até 8 s de atraso e não há notificação do sistema;
  - as não lidas não acompanham a leitura feita no celular ou no navegador;
  - o que não vem da API fica de fora do desenho: "online", tamanho e páginas do PDF, duração do áudio na lista,
    "lido" (dois tiques) e o ícone real do espaço;
  - ligar e criar conversa nova abrem o Google Chat no navegador.

**Alternativas consideradas**
- **Eventos em tempo real (Workspace Events / app de Chat com webhook):** exigem servidor público e app de Chat
  publicado; fica para depois, se o atraso incomodar.
- **`chat.users.readstate.readonly` para as não lidas:** seria um pedido por conversa a cada atualização e mais uma
  permissão; o controle no app resolve sem custo. Pode entrar depois para acompanhar a leitura feita em outro lugar.
- **Mostrar o Chat do Google numa janela web dentro do app:** sem o visual do Quill e com o login do Google na janela.

## Acréscimo (2026-11-17): reações, editar e apagar

**Contexto**
A permissão `chat.messages`, que já estava no login, cobre `reactions.create`, `reactions.list`, `reactions.delete`,
`messages.patch` e `messages.delete` (conferido na documentação da API). Mas:
- a mensagem traz só o resumo das reações (`emojiReactionSummaries`: emoji e contagem), **sem dizer se a própria conta
  reagiu**;
- para tirar uma reação é preciso o nome dela (`…/reactions/<id>`), que só vem pelo `reactions.list`;
- apagar mensagem que tem respostas no fio falha, a não ser com `force=true`, que apaga as respostas de todo mundo;
- a documentação não diz o que acontece ao reagir duas vezes com o mesmo emoji.

**Decisão**
- **Reações suas guardadas no app** (`quill.chat.reacted`, até 2.000 mensagens): o chip fica azul quando o emoji está
  nessa lista e a mensagem ainda mostra a reação. Buscar `reactions.list` de cada mensagem a cada 8 s seria um pedido
  por mensagem; fica só para a hora de tirar a reação.
- **Tirar reação:** `reactions.list` com o filtro `emoji.unicode = "…" AND user.name = "users/<próprio id>"`, e o
  Quill confere de novo que a reação é da própria conta antes de apagar.
- **Reagir duas vezes:** se o Google responder 409, o Quill trata como "já era sua" (não soma de novo).
- **Editar** só o texto (`updateMask=text`); a mensagem mostra "(editada)" quando `lastUpdateTime` é depois do envio.
- **Apagar sem `force`:** o Quill nunca apaga respostas de outras pessoas; se o Google recusar, aparece a frase
  "Essa mensagem tem respostas…".
- Emoji próprio da empresa (sem unicode) não aparece nos chips.
- A tela muda na hora (contagem, texto, mensagem saindo com animação) e volta ao que era se o Google recusar.

**Consequências**
- Reações feitas pelo celular ou pelo navegador aparecem na contagem, mas sem o destaque azul até você clicar nelas
  no Quill.
- Editar e apagar respostas dentro do fio (a lista aberta em "N respostas") ainda não têm botão; reagir nelas, sim,
  pelos chips.

## Acréscimo (2026-11-17): visual do Google Chat, formatação, citação e barra da mensagem

**Contexto**
O Gabriel usou o Chat com a conta real e comparou com o Google Chat: aparecia rolagem para o lado, as mensagens dos
outros não tinham balão, negrito e emoji não apareciam direito (ex.: "💸 *Compra lançada (paga)*"), a citação de outra
mensagem não aparecia e os botões da mensagem eram diferentes da barrinha do Google. Na API:
- `formattedText` traz a marcação (`*negrito*`, `_itálico_`, `~tachado~`, código, listas, `<url|texto>`, menções
  `<users/…>` e emoji da empresa `:nome:`); o nome de quem foi mencionado não vem junto;
- `quotedMessageMetadata` traz o nome da mensagem citada e, quando o Google manda, uma cópia (`quotedMessageSnapshot`)
  com quem escreveu e o texto;
- emoji próprio da empresa vem em `annotations` (`CUSTOM_EMOJI`) e nas reações com um link temporário da imagem;
- as "respostas sugeridas" do Google Chat não vêm pela API.

**Decisão**
- **Texto da mensagem:** `formattedText` (ou `text`, se não vier) interpretado em `src/chat/format.ts` (sem React,
  com testes no Node: `npm test`) e montado com elementos React em `chatText.tsx`. Nada do texto vira HTML; links só
  `http(s)`/`mailto`, abertos no navegador. Emojis ficam numa fonte colorida; 1 a 3 emojis sozinhos aparecem grandes.
- **Citação, menções e emoji da empresa** lidos na `quill-core` (`quoted`, `mentions`, `customEmojis` e `image` na
  reação). O nome de quem foi citado ou mencionado vem do mesmo cache da People API. A imagem do emoji da empresa só
  passa se for `https` de um endereço do Google. Sem a cópia da citada, a tela procura a mensagem entre as já
  carregadas; clicar no cartão leva até ela.
- **Reagir com emoji da empresa** fica fora: a API cria reação por unicode; o chip aparece com a imagem, sem clique.
- **Barra da mensagem** (no lugar dos botões antigos): 3 reações rápidas, adicionar reação, responder no fio e ⋮
  (Editar, Apagar, Copiar texto, Abrir no Google Chat). As rápidas começam com ✅ 🫡 🤣 e passam a ser as 3 que a
  pessoa mais usa (`quill.chat.reactionUse`, só neste computador). Um ponto de Tab por mensagem; as setas andam na barra.
- **Editar e apagar respostas do fio** passam a ter a mesma barra (antes só dava para reagir nelas).
- **"Abrir no Google Chat"** abre a conversa (`spaceUri`): o formato do link direto de uma mensagem não é documentado.
- **Respostas sugeridas** não entram (não vêm pela API).
- **Layout:** coluna de conversas com 300 px, arrastável de 240 a 420 px (`quill.chat.listWidth`); a área das
  mensagens nunca rola para o lado (tudo quebra a linha ou encolhe).

**Consequências**
- Se o Google não mandar a cópia da citada e ela for antiga (não carregada), o cartão mostra só "Mensagem citada".
- O link temporário do emoji da empresa pode expirar; a próxima atualização da conversa traz um novo.

## Acréscimo (2026-11-17): Markdown no texto, emojis animados e dicas que não cortam

**Contexto**
Notas de reunião do Gemini apareciam com asteriscos (`*Abertura e Dinâmica Inicial*` em negrito, mas com os `*` à
vista) e com barras invertidas (`\[Richard Reis\]`): o texto vem em Markdown (`**negrito**`, escapes), e o Quill só
entendia a marcação do Google Chat. O Gabriel também pediu os emojis animados do Google Chat e reclamou de dicas
cortadas embaixo na caixa de escrever.

**Decisão**
- **Os dois mundos no mesmo interpretador** (`src/chat/format.ts`): a marcação do Google Chat continua igual e o
  Markdown entra junto (`**`/`__` negrito, `~~` tachado, `[texto](url)`, títulos `#`–`######` como linha em negrito,
  listas `1.`/`1)`/`-`/`*`/`+`/`•` aninhadas pelo recuo, citação `>` e linha `---`). Escape `\` + pontuação mostra só
  o caractere. Marca dupla sem par fica inteira como texto (nunca sobra um `*` virando negrito); asterisco solto
  (`5 * 3`) é texto. Dentro de código nada é interpretado. Link do Markdown só `http(s)`/`mailto`.
- **Título como linha em negrito dentro do parágrafo** (e não um bloco à parte), para a linha em branco antes dele
  continuar aparecendo.
- **Emojis animados do Google** (Noto Animated Emoji, licença livre), carregados de `fonts.gstatic.com`:
  `…/<código>/512.webp` (animado, só parte dos emojis tem) e `…/<código>/emoji.svg` (parado, todos têm). O código é
  o hexadecimal minúsculo, com `_` entre os pedaços, sem `fe0f` e com pelo menos 4 dígitos (`0031_20e3`), conferido
  nos endereços reais. Só na mensagem com 1 a 3 emojis (grande e animado) e nos chips e reações rápidas (parado,
  animando com o mouse em cima). No meio do texto o emoji continua texto. `loading="lazy"`; o que falha uma vez não é
  pedido de novo até reabrir; sem os dois arquivos volta o caractere; com "Reduzir movimento", nunca anima. A CSP já
  permitia imagens `https:`.
- **Dicas na tela do Chat:** os botões da caixa de escrever abrem a dica para cima (`top`, e `top-start`/`top-end` só
  dentro de `.chat-cmp`, para os botões das pontas); na lista de mensagens, a dica escolhe o lado que cabe quando o
  mouse ou o Tab chega no botão (a lista rola e corta o que passa da borda, inclusive a moldura do vídeo).

**Consequências**
- O Google fica sabendo que alguém abriu aquele emoji (o pedido sai do computador, sem `Referer`). É o mesmo serviço
  de onde já vêm as fotos e anexos do Chat.
- Uma linha de texto comum que comece com `1. `, `> ` ou `# ` passa a virar lista, citação ou título, como no Markdown.
- Os arquivos animados têm de 90 a 380 KB cada; por isso só carregam nos emojis grandes e ao passar o mouse.

