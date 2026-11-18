---
type: changelog
tags: [quill]
updated: 2026-11-18
---

# Changelog

Baseado no `git log` e nas mensagens dos commits. Horários em Brasília (UTC−3). Todos os 25 commits são de
2026-11-17.

## 2026-11-17

### Desenho e começo (08:33 – 09:29)
- Logo, print de referência, telas aprovadas (claro e escuro) e guia de estilo `docs/design.md`, copiado do canvas
  "Quill" no Doop (`6a894e3`).
- Ícones do app e originais do logo (`a540230`).
- App começa em **Tauri v2 + React 19 + Vite + TypeScript**, com perfil de montagem enxuto; onboarding em 6 passos
  igual ao desenho, com animações calmas que pausam com a janela escondida; base da janela (barra de ícones + painel);
  fonte Inter só com alfabeto latino; ícones Lucide um a um; permissões mínimas no Tauri; `AGENTS.md` com stack,
  regras e skills obrigatórias (`a93041e`).
- Onboarding sem moldura dupla na janela nativa; eventos sem barrinha lateral colorida (regra no `docs/design.md`)
  (`9eabebf`).
- Primeira montagem no Mac (`ed04d89`, Cargo.lock).

### Telas com dados de exemplo (09:37 – 10:22)
- Caixa de entrada igual ao desenho: busca, abas em pílula, cartão de contas com filtro, lista com banner, selo de
  verificado, etiqueta da conta, anexos, convite com Aceitar/Talvez/Recusar, coluna "Hoje" (`87318ef`).
- **Correção:** cartão de convite sobreposto na caixa de entrada, porque o CSS do onboarding vazava. Classes do
  onboarding ganharam prefixo; o `AGENTS.md` passou a pedir nomes exclusivos por tela; prévia ganhou
  `?preload=onboarding` (`22d3b2b`).
- Leitura, Escrever, Calendário (dia, semana, mês) e Ajustes de contas iguais aos desenhos; navegação pela barra
  lateral; estado compartilhado em `src/state/store.ts`; dicas nos ícones; barra de rolagem fina; convite com
  barrinha de 4 s e desfazer; telas em pacotes sob demanda (`a180943`).
- Janela do Mac: barra de 80px para os botões nativos, sem rolagem horizontal; linha fina em volta do painel e
  conteúdo centralizado em janelas grandes (`5d5f338`, `825bd2e`).
- Calendário: grade de 24 horas que preenche a altura, abre às 7h30 (`75ceb6d`).

### Login com Google e e-mails reais (10:52 – 11:04)
- `quill-core`: PKCE, login pelo navegador com volta em 127.0.0.1, troca e renovação de tokens, perfil, lista e texto
  dos e-mails, marcar como lido (37 testes na época, com servidor falso do Google) (`ba8e9b7`).
- Tokens nas Chaves do sistema; lista de contas em `accounts.json`; credenciais do Google embutidas na montagem a partir
  do Infisical (projeto quill) ou de `oauth.local.env` (`ba8e9b7`).
- Pasta de compilação fora do repositório; correção de compilação feita no Mac (`a26bf67`, `96e831b`, `e3f1ebf`).
- **Login funcionando no app:** o app passa a se reconhecer pelo endereço interno (`tauri://localhost`); antes se
  achava "prévia" e o botão do Google só pulava de tela. No app sem conta, nada de dados de exemplo. Menu do avatar com
  contas, Aparência e Sair (`58df050`).
- Cargo.lock atualizado no Mac (`2473000`): último commit feito no Mac.

### App funcional (12:10 – 12:21)
- Pastas reais do Gmail e contadores; enviar, responder, encaminhar, arquivar, lixeira, spam, estrela e não lido.
- Anexos: enviar (até 25 MB, arrastar e soltar), baixar, abrir e Quick Look; ícone do tipo de arquivo.
- Google Agenda de todas as contas sem repetir convites; responder; criar evento; navegação por datas reais.
- Foto do Google no avatar e foto própria; atualização a cada 3 minutos; busca geral ⌘K e atalhos; Ajustes completos;
  menus e datas sem controles nativos; animações de entrada e abas deslizantes (`37189cc`).
- Login do Google pode ser cancelado, reaberto ou ter o link copiado; espera máxima de 4 minutos; um login novo encerra
  o anterior. "Sair" desconecta as contas e fica no app. Onboarding só uma vez, com "Rever o onboarding" nos Ajustes
  (`4f906d6`, `2146ec6`).

### E-mail formatado e ações em massa (12:33)
- Leitura do e-mail formatado num quadro isolado: sem scripts, imagens externas sob pedido, links no navegador.
- Logo da empresa no avatar do remetente (desligável em Privacidade).
- Seleção em massa e barra de ações por caixa; tirar da Lixeira; filtro de contas compacto.
- Calendário: barra reorganizada, fim de semana sem destaque, agendas agrupadas por conta, feriados repetidos em outro
  idioma removidos.
- Busca do topo abre a busca geral ⌘K, que também acha eventos (`910403d`).

### iCloud/IMAP, editor e Touch ID (13:23)
- Contas iCloud e "Outro e-mail" por IMAP/SMTP, com senha de app nas Chaves.
- Editor do Escrever com a barra do Gmail; rascunhos salvos sozinhos no Gmail.
- Desfazer envio com contagem; sugestões de destinatário pelos contatos do Google e enviados.
- Calendário: editar e apagar eventos, convidados, lembretes, Google Meet e descrição.
- Imagens embutidas no e-mail; links mais confiáveis; prévia de anexos dentro do app; recorte e zoom da foto do avatar.
- Touch ID ao abrir o app (LocalAuthentication).
- Fotos dos remetentes pelo Gravatar e ícones de sites; seleção ao lado do avatar.
- Ilustrações da saudação geradas pelo Codex, com escolha nos Ajustes e no cartão.
- Avisos no topo; dicas somem com menu aberto; barra lateral mais compacta; colunas do calendário alinhadas
  (`e2b0517`).
- `AGENTS.md` atualizado com iCloud/IMAP e Touch ID (`59da826`).

### Agenda e contatos do iCloud (13:49)
- Agendas e eventos do iCloud no Calendário (fusos, dia inteiro, repetições): criar, editar, apagar e responder.
- Contatos do iCloud nas sugestões de destinatário.
- Senha de app enviada só para `*.icloud.com`; gravação com `If-Match` (`1c76314`).
- Google Meet só aparece em agendas do Google (`731e03d`).

### Documentação
- Criada a pasta `Documentacoes/` com convenções próprias (adaptadas do padrão do inchurch-contratos e da techbpo),
  README, guia rápido, visão geral, arquitetura, 21 ADRs, tutorial de uso, referência e este changelog. Seção
  "Documentação" acrescentada ao `AGENTS.md`.
- Verificação feita para esta documentação: `cargo test --features net` na `quill-core` com 199 testes passando e
  `npm run build` sem erros.

### Em andamento (não commitado em 2026-11-17)
- Escolha do ícone do Dock em Ajustes → Aparência, com as variações geradas pelo Codex.

### Ícone do Dock e documentação

- Ajustes → Aparência → **Ícone no Dock**: Clássico, Escuro e 6 variações geradas pelo Codex (Azul, Sálvia, Grafite,
  Branco, Noite, Papel), com o formato arredondado do macOS. A troca é feita pelo AppKit (`src-tauri/src/dock.rs`) e
  vale enquanto o app está aberto; o Quill reaplica a escolha ao abrir.
- Documentação criada em `Documentacoes/` no padrão dos projetos do Gabriel (convenções, guia rápido, visão geral,
  arquitetura, 21 ADRs, tutorial, referência e este changelog).

- "Confirmar antes de apagar" agora vale de verdade (ligado por padrão) e usa a janela própria do Quill; o
  `window.confirm` do navegador não funciona dentro do app.
- Filtro de contas mostra a foto real de cada conta (a do Google, ou a escolhida no Quill para a conta principal), com
  o logo do serviço só quando não há foto.
- Calendário: a data fica entre as setas (‹ período ›) com "Hoje" ao lado; menu "Todas as contas" na lista de agendas
  para mostrar ou esconder as agendas de cada conta conectada (contas sem agenda aparecem como "só e-mail"); saiu o
  texto de rodapé da lista.
- A saudação aparece em todas as pastas (contando os não lidos da Entrada); saíram as bolinhas coloridas dos eventos no
  cartão "Hoje".
- Ícone do Dock: corrigido o erro "Não consegui trocar o ícone" (a regra de segurança do app, CSP, não deixava o
  Quill ler a própria imagem; `connect-src` ganhou `'self'`). O aviso de erro agora mostra o motivo.
- Saudação: saiu a faixa escura sobre a ilustração; a ilustração original (SVG com envelopes) voltou como opção
  "Original".
- Imagens dentro dos e-mails aparecem por padrão, como no Gmail (dá para bloquear em Ajustes → Privacidade).
- Ajustes → Contas: saiu o botão "Adicionar conta" (os quatro cartões abrem o fluxo); "Cor da conta" ganhou o botão
  "+" com uma paleta de 60 cores, cinzas e código #RRGGBB. Apelido e cor escolhidos agora valem no app todo.
- Regra registrada: nunca gerar ou instalar o app no Mac sem o Gabriel pedir.

### Login do Google na janela de login do macOS

- No Mac, conectar uma conta Google abre a página do Google na janela de login do sistema (ASWebAuthenticationSession,
  `src-tauri/src/websheet.rs`) em vez do navegador. A volta continua pelo `127.0.0.1`; quando o código chega, o Quill
  fecha a janela. Fechar a janela antes cancela o login, como o botão Cancelar. Se a janela não abrir (ou fora do
  Mac), o navegador abre como antes. "Abrir de novo" também usa a janela
  ([ADR-022](02-decisoes-adrs/ADR-022-login-google-na-folha-do-macos.md)).
- `quill-core`: `GoogleSession::sign_in_with` deixa o app escolher como abrir a página e avisa quando a espera
  termina; `sign_in` continua com o navegador. Dois testes novos (201 com `--features desktop`; 199 com `net`).
- Telas: "Termine o login na janela que abriu" e "Esperando o login…".
- Testado no Mac em 2026-11-17, sem fazer login: a janela abre (com o Safari como navegador, é uma janela do Safari
  sem barra de endereço, não uma folha presa ao Quill); fechar a janela cancela a espera; Cancelar no Quill fecha a
  janela. O login completo fica para o Gabriel testar.

### Roda de cores e prévias mais leves

- "Mais cores" virou uma roda de cores (todas as cores; o centro é claro, a borda é forte), com barra de brilho, cinzas
  e código #RRGGBB; funciona com mouse e teclado.
- Prévias do Chat no Doop mais leves: as animações rodam uma vez só e os ícones carregam sem travar o desenho.

### Google Chat (contas Workspace)

- Tela nova **Chat** na barra lateral (depois do Calendário, como no desenho do Doop), com bolinha de não lidas:
  conversas diretas, grupos e espaços, busca, abas Todas / Não lidas / Espaços, Fixadas e Recentes, contador azul,
  respostas da conversa ("2 respostas"), links clicáveis, busca dentro da conversa e seletor de conta quando há mais
  de uma conta Workspace ([ADR-023](02-decisoes-adrs/ADR-023-google-chat-pela-api-so-workspace.md)).
- Fotos reais das pessoas pela People API; a própria foto pelo avatar do Quill; espaços e grupos com as fotos das
  pessoas empilhadas (a API não tem ícone de espaço).
- Anexos: imagem e GIF em miniatura (clicar amplia), vídeo com play no lugar e botão de ampliar, áudio com player e
  ondinha, PDF e outros arquivos com "Ver" e "Baixar" (Downloads), Google Drive abre no navegador.
- Enviar arquivos pelo clipe, arrastando ou colando imagem (até 200 MB): o arquivo sobe na hora, com barra de
  progresso real, prévia ao clicar na miniatura e "Tentar de novo".
- Gravar áudio pelo microfone (segurar ou clicar), com tempo, ondinha ao vivo, descartar, ouvir antes e enviar.
  `src-tauri/Info.plist` com a frase de permissão do microfone.
- Sem conta Workspace, a tela explica e oferece "Conectar conta da empresa"; sem permissão, "Entre de novo com a conta
  para liberar o Chat"; app de Chat não configurado no Google Cloud vira aviso próprio.
- Login do Google pede 4 permissões novas (Chat e diretório da empresa): as contas Google precisam entrar de novo.
- `quill-core`: módulos `chat` (leitura e pedidos) e `chat_client` (cache de pessoas, membros e prévias); métodos novos
  no `GoogleClient`; reqwest com o recurso `stream` (progresso do envio). 48 testes novos: **247** com `net`.
- Parte nativa: comandos `chat_spaces`, `chat_messages`, `chat_members`, `chat_send`, `chat_attachment`,
  `chat_attachment_save` e `chat_upload` (o arquivo chega sem base64; o progresso sai no evento
  `chat-upload-progress`).
- Prévia do navegador: `?screen=chat`, com `&chat=none` (sem Workspace), `&chat=rec` (gravando) e `&chat=att`
  (enviando anexos), com conversas de exemplo. Ainda não testado no Mac.


### Notificações do sistema e sons

- Avisos do macOS (plugin de notificação do Tauri, permissão `notification:default`) quando chega e-mail novo na Entrada
  ou mensagem no Chat. Com o Quill na frente, só toca o som; com o Quill atrás, aparece o aviso do sistema.
- Respeita Ajustes → Notificações: avisar e-mail, avisar Chat (novo), tocar som, "Só de pessoas" (ignora remetentes
  automáticos como no-reply e newsletter) e horário silencioso.
- Seis sons gerados para o Quill (Pop, Gota, Sino, Cristal, Marimba, Brisa), escolhidos separadamente para e-mail e
  Chat, com botão para ouvir. O Gabriel escolheu **Pop** como padrão.

### Chat: reações, editar e apagar

- **Reações:** chips com emoji e contagem embaixo da mensagem (`emojiReactionSummaries`); a sua fica azul. Ao passar o
  mouse, botão de reagir com 6 rápidas (👍 ❤️ 😂 😮 😢 🙏) e "+" com todos os emojis (a lista do Escrever foi para
  `src/lib/emojis.ts`, com nomes para leitor de tela). Clicar no seu chip tira a reação (`reactions.list` filtrado pelo
  próprio id + `reactions.delete`). Como a API não diz quem reagiu, o Quill guarda as suas em `quill.chat.reacted`.
- **Editar** (só as suas, menu ⋯): o balão vira campo no lugar, Enter salva e Esc cancela (`messages.patch` com
  `updateMask=text`); aparece "(editada)" pelo `lastUpdateTime`.
- **Apagar** (só as suas, menu ⋯): confirmação com `askConfirm`, `messages.delete` sem `force` e a mensagem sai com
  animação. Mensagem com respostas no fio: o Google recusa e aparece frase clara.
- Tudo muda na hora na tela e volta se o Google recusar. Comandos novos `chat_react`, `chat_unreact`, `chat_edit` e
  `chat_delete`; 17 testes novos (264 no total). Decisões no acréscimo do
  [ADR-023](02-decisoes-adrs/ADR-023-google-chat-pela-api-so-workspace.md).
- Conferido na prévia (claro e escuro); ainda não testado no Mac.
- Calendário: as setas voltaram a ser bolinhas separadas, sem a pílula em volta da data (‹ data ›), e o hífen de
  "Quarta-feira" não ganha mais espaço extra.

### Chat: visual do Google Chat, formatação e barra da mensagem (não commitado em 2026-11-17)

Pedido do Gabriel depois de usar o Chat com a conta real, comparando com o Google Chat.
- **Sem rolagem para o lado:** coluna de conversas com 300 px (era 344), arrastável de 240 a 420 px pela divisória
  (setas do teclado e dois cliques para voltar); mensagens, imagens, vídeo, links longos, blocos de código e anexos
  quebram a linha ou encolhem; a área das mensagens tem `overflow-x: hidden`. Conferido a 1440 e a 1100 px.
- **Balões nos outros também:** cinza-claro (claro) e cinza-escuro (escuro) à esquerda; os seus continuam azul-claro à
  direita. Mensagens seguidas da mesma pessoa ficam empilhadas, com os cantos de junção mais retos.
- **Formatação:** `formattedText` interpretado (negrito, itálico, tachado, código, bloco com três crases, links
  `<url|texto>`, URLs soltas, listas, menções, quebras de linha), emojis em fonte colorida, mensagem só de emoji maior
  e emoji próprio da empresa com a imagem. Tudo montado com elementos React (`src/chat/format.ts` +
  `chatText.tsx`), sem HTML vindo da API.
- **Citação:** cartão com barrinha, nome e começo do texto (`quotedMessageMetadata`); clicar leva até a mensagem.
  A `quill-core` passou a ler citação, menções e emoji da empresa, com o nome das pessoas pela People API.
- **Horário:** "agora", "5 min", "58 min" e depois 14:35; data e hora completas numa dica ao parar o mouse em qualquer
  mensagem; nas suas, a hora fica acima do grupo.
- **Barra da mensagem** (troca os botões antigos): 3 reações rápidas (começam com ✅ 🫡 🤣 e viram as que você mais
  usa), adicionar reação (grade de emojis), responder no fio (abre as respostas e põe o cursor na caixa) e ⋮ com
  Editar, Apagar (só as suas), Copiar texto e Abrir no Google Chat. Animação curta só de `opacity`/`transform`; pelo
  teclado, um Tab por mensagem e setas na barra. As respostas do fio ganharam a mesma barra (editar e apagar nelas).
- "Respostas sugeridas" do Google não vêm pela API: ficaram de fora.
- Testes: 4 novos na `quill-core` (citação, menções e emoji da empresa, imagem só do Google, nomes no `ChatService`)
  e 15 das telas com `npm test` (novo: `src/**/*.test.ts` rodam direto no Node, sem dependência nova). Decisões no
  acréscimo do [ADR-023](02-decisoes-adrs/ADR-023-google-chat-pela-api-so-workspace.md).
- Conferido na prévia (claro e escuro, 1440 e 1100 px); ainda não testado no Mac.

### Cofre único nas Chaves (não commitado em 2026-11-17)

- **Problema:** no Mac, o Quill pedia a senha das Chaves várias vezes a cada abertura ("Quill deseja usar as
  informações confidenciais armazenadas em app.quill.desktop.google"): havia um item por conta, e o app sem assinatura
  fixa faz o "Permitir Sempre" se perder a cada versão.
- **Agora:** todos os tokens do Google e senhas de app do iCloud/IMAP ficam num **único item** (`app.quill.desktop` /
  `cofre`, um JSON), lido uma vez por abertura e guardado na memória; só é gravado de novo quando algo muda (login,
  conta removida, token novo). Novo módulo `quill-core/src/vault.rs` (`Vault`, interface `SecretStore`; as Chaves de
  verdade só na feature `desktop`). `session.rs`, `imap_session.rs` e o `lib.rs` passam pelo cofre; ninguém mais usa
  os itens antigos.
- **Migração:** na primeira abertura, os itens antigos das contas do `accounts.json` são juntados no cofre novo e
  apagados. Nessa vez o Mac ainda pode perguntar uma vez por conta; depois, uma vez só por versão nova do app.
- Se as Chaves recusarem, o Quill não pergunta de novo até reabrir e nunca grava por cima do cofre.
- Guia rápido ganhou "Parar de pedir a senha das Chaves" (Permitir Sempre e o certificado gratuito "Apple
  Development" para assinatura fixa; o `tauri.conf.json` **não** foi mudado). Decisão no
  [ADR-024](02-decisoes-adrs/ADR-024-cofre-unico-nas-chaves.md); referência das Chaves atualizada.
- 22 testes novos (14 do cofre, 1 das Chaves "de mentira" do `keyring`, 3 da sessão do Google, 4 da do iCloud/IMAP).
  Ainda não testado no Mac.

### Repositório público e atualização automática

- O repositório `viannaanalyst/quill` ficou **público** (pedido do Gabriel), depois de conferir que o histórico não
  tem senhas nem chaves. O repositório extra `quill-releases`, criado antes, foi arquivado.
- Atualização automática (ADR-026): o Quill confere as releases do GitHub ao abrir e a cada 6 h e mostra
  "Quill X disponível · Atualizar"; Ajustes → Geral mostra a versão e "Verificar atualizações". Versão 0.2.0.
- `scripts/release-mac.sh` publica uma versão nova a partir do Mac. Falta gerar a chave de atualização no Mac
  (próxima montagem pedida pelo Gabriel).
- Caixa de entrada: o contador do topo segue a conta escolhida no filtro; a semana do cartão "Hoje" ficou sem bolinhas.
- Assinatura fixa no Mac: `bundle.macOS.signingIdentity` do `tauri.conf.json` passou a usar o certificado
  "Apple Development" do Mac, para o macOS não pedir a senha das Chaves a cada versão nova (guia rápido e ADR-024
  atualizados). Vale a partir da próxima montagem.
- Repositório público sem dados pessoais à vista: a assinatura do app usa a impressão digital do certificado (não o
  nome com e-mail) e os dados de exemplo da prévia usam e-mails fictícios (voce@gmail.com, voce@empresa.com.br…).

### Chat: Markdown, emojis animados, dicas e botão de enviar (não commitado em 2026-11-17)

Pedido do Gabriel depois de ver notas de reunião do Gemini com asteriscos e barras invertidas à vista.
- **Markdown no texto** (`src/chat/format.ts`), junto com a marcação do Google Chat: `**negrito**`, `__negrito__`,
  `~~tachado~~`, links `[texto](url)`, títulos `#`/`##`/`###` como linha em negrito, listas `1.`, `-`, `*`, `•`
  aninhadas pelo recuo, citação `> texto` e linha `---`. Escapes (`\[`, `\*`, `\_`, `\(`…) mostram só o caractere;
  marca sem par fica como texto; nada é interpretado dentro de código; URL solta não leva `.`, `,` ou `)` do fim.
  Tela nova para lista numerada, subitens, citação e separador (`chatText.tsx`).
- **Emojis animados do Google** (Noto Animated Emoji): mensagem só com 1 a 3 emojis fica grande e animada; chips de
  reação e as 3 reações rápidas da barra mostram o desenho parado e animam ao passar o mouse. Se o Google não tiver
  a animação, fica o parado; sem internet, o caractere. Novos `src/chat/noto.ts` e `src/chat/Emoji.tsx`.
- **Dicas sem corte:** botões da caixa de escrever com a dica para cima ("Anexar arquivo" e "Descartar" alinhadas
  pela esquerda; "Enviar", "Enviar áudio" e "Gravar áudio" pela direita). Na lista de mensagens, a dica escolhe o lado
  que cabe na hora. Conferido com um script que mede todas as dicas da tela com a lista rolada de cima a baixo: zero
  cortadas a 1280×800 e 1100×720 (tamanho mínimo da janela), com e sem o fio de respostas aberto, em claro e escuro.
- **Botão de enviar** do tamanho dos outros: 36 px com ícone de 17 px (era 38 px); anexar, emoji e microfone com
  ícone de 18 px; a caixa de escrever caiu de 52 para 44 px de altura. O Enviar ganhou dica.
- Dados de exemplo: notas de reunião no formato do Gemini e uma mensagem só de emoji (🎉🙌).
- Testes: `npm test` com 60 casos (40 novos de Markdown, 5 dos endereços dos emojis e os 15 de antes, um deles
  ajustado para o formato novo das listas). Decisões no acréscimo do
  [ADR-023](02-decisoes-adrs/ADR-023-google-chat-pela-api-so-workspace.md).
- Conferido na prévia (claro e escuro); ainda não testado no Mac.

### Resposta rápida do e-mail como a do Gmail (não commitado em 2026-11-17)

Pedido do Gabriel: a caixa de resposta ficava sempre aberta no pé da tela, sem formatação, e o editor completo só
tinha o X (que voltava para a caixa de entrada).
- **Fechada até clicar:** no fim do e-mail aparecem **Responder**, **Responder a todos** e **Encaminhar**. Clicando
  (ali, na barra de cima ou na seta da mensagem), a caixa abre logo abaixo da mensagem e rola junto com ela
  (`src/read/InlineReply.tsx`).
- **Formatação:** negrito, itálico, sublinhado, marcadores, link e emoji ao lado do Enviar; o botão **Aa** troca pela
  barra inteira do Escrever. A `RichToolbar` ganhou o modo `compact` e o `up` (dicas e janelinhas abrem para cima).
- **Anexos** pelo clipe (até 25 MB no total; imagem colada vira anexo), com pílula para tirar.
- **Rascunho:** salva sozinho no Gmail 3 s depois da última mudança. Saindo do e-mail, a resposta fica guardada e
  reabre como estava (`src/state/replyDrafts.ts`, com testes). ⌘↵ envia; a lixeira da caixa descarta (e apaga o
  rascunho).
- **Editor completo → "Voltar ao e-mail":** a seta no lugar do X volta para o e-mail com a resposta aberta, o texto,
  os anexos e o mesmo rascunho. Enviar ou descartar no editor também volta para o e-mail (`ComposeDraft.returnTo`).
- Ainda falta: **Responder a todos** responde só a quem mandou, porque o Quill ainda não lê os outros destinatários
  (Para e Cc) do e-mail recebido.
- Conferido na prévia (claro e escuro), com script: abrir, escrever com negrito, barra inteira, editor completo,
  voltar com o texto e descartar.

### Chat: horário, barra, citação e mensagem de voz como no Google Chat (não commitado em 2026-11-17)

Pedido do Gabriel: deixar a conversa do Chat igual ao Google Chat em quatro pontos.
- **Horário ao lado do nome** no formato do Google Chat: hoje só a hora ("11:00"), outro dia "5 de nov., 11:00" e
  outro ano "12 de dez. de 2025, 16:40" (`src/chat/time.ts`, com testes). Saiu "agora"/"5 min" e saiu a dica com data
  e hora completas que aparecia ao parar o mouse na bolha (e no horário). O leitor de tela continua ouvindo a data
  completa na barra de ações.
- **Barra de ações à esquerda:** flutua sobre a borda de cima, no começo do balão (antes ficava no canto direito). Na
  primeira mensagem do grupo ela vai para a linha do nome, logo depois do horário, para não cobrir o nome; nas suas
  mensagens fica no começo do balão (ou antes de "Você · hora", quando o balão é curto). A posição é medida quando o
  mouse ou o Tab chega na mensagem; as dicas continuam escolhendo o lado que cabe.
- **Citar na resposta:** botão novo na barra. O cartão (barrinha azul, nome em negrito pequeno, até 2 linhas do texto
  com reticências) aparece em cima da caixa de escrever, com X para cancelar, e a mensagem sai citando a outra
  (`quotedMessageMetadata` da API). Citando uma resposta de fio, a nova sai no mesmo fio (regra da API). O cartão na
  mensagem ganhou o mesmo visual; clicar nele continua rolando até a original e destacando por um instante.
  Parte nativa: `QuoteRef`/`quote_allowed` e `send_request(..., quote)` em `quill-core/src/chat.rs`, hora da última
  mudança (`updateTime`) em cada mensagem e o parâmetro `quote` no comando `chat_send` (2 testes novos em Rust).
- **Mensagem de voz:** cartão próprio com play/pausa redondo, ondinha que vai enchendo enquanto toca (clicar ou as
  setas pulam; Home/End vão ao começo e ao fim), tempo "0:21 / 0:42" com números de largura fixa e velocidade
  1x → 1,5x → 2x. Sem os controles do sistema.
- Dados de exemplo: mensagens de outro ano, de 5 de novembro e de ontem, uma citação sua e um áudio recebido.
- Testes: `npm test` com 66 casos (3 novos do horário); `cargo test --features net` no `quill-core` com 284 (rodado
  numa cópia só com estas mudanças, porque o `google.rs` estava no meio de outra mudança que ainda não compila nos
  testes).
- Conferido na prévia (claro e escuro), com prints; ainda não testado no Mac (enviar citando precisa da conta real).

### Excluir para sempre, esvaziar a Lixeira e fotos das contas (não commitado em 2026-11-17)

Pedido do Gabriel: apagar de vez o que está na Lixeira e no Spam, e cada conta mostrar a própria foto.
- **Excluir para sempre** ([ADR-027](02-decisoes-adrs/ADR-027-excluir-para-sempre-com-acesso-completo-ao-gmail.md)):
  nas pastas **Lixeira** e **Spam** as ações em massa ganham **Excluir para sempre** (vermelho); a Lixeira troca
  "Mover para a Entrada" por **Tirar da lixeira**. Lendo um e-mail da Lixeira, o botão da lixeira vira **Excluir para
  sempre** e aparece **Tirar da lixeira**. Sempre com confirmação ("não dá para desfazer nem recuperar depois"); o
  e-mail some na hora e volta se o servidor recusar; aviso com a quantidade.
- **Esvaziar lixeira** no topo da pasta Lixeira: todas as contas conectadas, ou só a escolhida nas pílulas de contas.
  Gmail: lista todos os ids com o marcador `TRASH` (500 por página) e apaga com `batchDelete` (grupos de 1000). IMAP:
  `UID SEARCH ALL` na Lixeira, `\Deleted` e `EXPUNGE`.
- **Escopo novo do Google** `https://mail.google.com/` (o único que deixa apagar de vez). Contas que entraram antes
  recebem o aviso "Para excluir para sempre, entre de novo com esta conta (o Google pede uma permissão a mais)"
  (`LoginError::Permission`, `DELETE_NEEDS_PERMISSION`); o resto continua funcionando.
- Parte nativa: `delete_message`, `batch_delete` e `trash_ids` em `quill-core/src/google.rs`
  (`check_id` e `parse_message_page` em `gmail.rs`); `delete_forever`/`empty_trash` em `session.rs` e
  `imap_session.rs`; `act(..., "delete")`, `delete_many` e `empty_trash` em `imap_client.rs` (só Lixeira e Spam
  aceitam apagar de vez); comandos `messages_delete_forever` e `trash_empty` no `src-tauri/src/lib.rs`, escolhendo
  Google ou IMAP pelo provedor da conta.
- Telas: `api.deleteForever`/`api.trashEmpty`, `deleteForever`/`emptyTrash` em `src/state/mailbox.ts`, partes sem
  React em `src/state/deleteForever.ts` (com testes). Prévia: `?screen=trash` abre a Lixeira com 3 e-mails de exemplo.
- **Fotos das contas:** a foto escolhida no Quill agora só aparece no avatar do cabeçalho e no menu da conta
  (`AccountPhoto` com `main`). Nas pílulas de contas da Caixa de entrada, na lista de contas do menu, em Ajustes →
  Contas e no menu de agendas do Calendário, cada conta mostra a foto do Google dela (sem foto: o logo do serviço nas
  pílulas e em Ajustes; as iniciais nos demais).
- Testes: `cargo test --features net` no `quill-core` com 297 (13 novos: escopo, `batchDelete` em grupos de 1000,
  nada para apagar, permissão faltando, páginas da Lixeira, ids e páginas no `gmail.rs`, e IMAP apagar, apagar vários,
  ids inválidos e esvaziar); `npm test` com 70 (4 novos).
- Conferido na prévia (claro e escuro), com prints. Falta conferir no Mac com conta real, depois de entrar de novo
  com cada conta Google.

## 2026-11-18

### Ícone preto como padrão do app
- O ícone que vem dentro do app (`src-tauri/icons`, gerado com `npx tauri icon` a partir de
  `src/assets/brand/app-icon-dark.png`) agora é o **Escuro**. Antes era o creme, então o Dock mostrava o creme com o
  Quill fechado, mesmo com o preto escolhido.
- Em Ajustes → Aparência, o Escuro passou a ser o primeiro (`default`) e o creme virou a opção `classico`. Quem tinha
  escolhido `escuro` continua com o preto (`dockIconId` trata o id antigo).
- Os outros ícones continuam valendo só com o app aberto. Para valerem fechado, seria preciso um plug-in do Dock
  (`NSDockTilePlugIn`).
- Rodapé de Ajustes mostra a versão de verdade (lida do `package.json`); antes estava fixo "Quill 0.1".
- Versão **0.2.1**.

### Links dos e-mails abrindo no Mac e aviso de login mais arrumado
- **Links e botões dentro dos e-mails não abriam no app do Mac.** O quadro do e-mail roda sem scripts
  (`sandbox` sem `allow-scripts`). No WebKit, isso também desliga o "ouvinte" de clique que a tela coloca no quadro,
  então o clique não chegava ao Quill (na prévia, no Chrome, funcionava). Agora a janela principal é criada no
  `setup` do `src-tauri/src/lib.rs` (no `tauri.conf.json` ela tem `"create": false`) com `on_new_window`: os links
  do e-mail (`target=_blank`) viram pedido de janela nova, que abre no navegador padrão (`files::open_link`, só
  http, https e mailto) e é negado dentro do app.
- Aviso "Termine o login na janela que abriu": os três botões ficam lado a lado numa linha só ("Abrir de novo" virou
  "Reabrir"); no menu da conta o aviso vira um cartãozinho.
- `scripts/release-mac.sh` monta com `CI=true`: o empacotador do .dmg não abre mais o disco "Quill" no Finder (a
  janela "arraste para Applications" que aparecia sozinha durante a publicação da 0.2.1). O .dmg fica sem a
  arrumação dos ícones, o que só importa para quem instala do zero.
- Versão **0.2.2**.

### Ícone de atualização na barra lateral
- Com versão nova disponível, aparece um ícone de download com um pontinho azul na barra lateral, logo acima de
  Ajustes (igual ao runelay). Ele abre uma janelinha com "Quill X disponível", a versão instalada, as novidades e os
  botões "Agora não" e "Atualizar". Durante a atualização, o ícone gira e a janelinha mostra a barra de progresso.
  O ícone some quando não há versão nova (`src/shell/UpdateButton.tsx`).
- Sai o aviso do canto (`UpdateBanner`).
- Prévia: `?update=1` finge uma versão nova.
- Versão **0.2.3**.

### Chat: menções com @, emojis animados no texto e barra de reação em mensagem longa
- **@ para mencionar**: digitar "@" na caixa de escrever abre a lista das pessoas da conversa (sem você e sem robôs),
  filtrando pelo começo do nome ou sobrenome, sem acento. Setas escolhem, Enter ou Tab confirmam, Esc fecha. A
  pessoa entra como "@Nome" e, ao enviar, vira `<users/id>`, que a API do Chat transforma em menção de verdade
  (`src/chat/mentions.ts`, com testes).
- Menções no formato `<chat-user data-user="users/…"></chat-user>`, que alguns aplicativos do Google mandam,
  apareciam como texto cru. Agora viram "@Nome" (`format.ts`). Os nomes das menções também vêm da lista de membros
  da conversa, e a prévia da última mensagem na lista de conversas mostra "@Nome" em vez da marcação.
- Emojis no meio do texto agora são animados, como no Google Chat (antes só a mensagem só de emoji animava).
- Mensagem comprida com o começo fora da tela: a barra de reações desce para a parte à vista (no canto direito do
  balão), em vez de ficar escondida lá em cima.
- Versão **0.2.4**.
