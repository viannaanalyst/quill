---
type: changelog
tags: [quill]
updated: 2026-11-17
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
