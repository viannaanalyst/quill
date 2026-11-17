---
type: adr
tags: [quill, adr, google-chat, workspace, anexos, audio]
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
