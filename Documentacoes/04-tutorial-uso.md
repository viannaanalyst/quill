---
type: tutorial
tags: [quill, uso, diataxis, email, calendario]
updated: 2026-11-18
---

# Como usar o Quill

Documento no formato Diataxis: primeiro um **tutorial** (aprender fazendo, do começo ao fim), depois **como fazer**
cada tarefa do dia a dia. Instalar, conectar contas e resolver o "Google desconectou" estão no
[guia rápido](guia-rapido.md). O porquê de cada escolha está nos [ADRs](02-decisoes-adrs/).

> Em 2026-11-17 a maior parte destas funções foi conferida só na prévia do navegador. O que já rodou no app do Mac está
> listado em [00-visao-geral.md](00-visao-geral.md).

---

## Tutorial: primeiro dia com o Quill

### O que você vai aprender
- [ ] Conectar uma conta e achar seus e-mails
- [ ] Ler, responder e arquivar
- [ ] Ver o dia no Calendário e responder um convite
- [ ] Deixar o app do seu jeito

### Pré-requisitos
- O Quill instalado no Mac (ver [guia rápido](guia-rapido.md#instalar-e-abrir)).
- Uma conta Google ou iCloud.

### Passo 1 — Conectar a conta
1. Abra o Quill. Passe pela apresentação (botão de avançar ou as setas do teclado).
2. Na tela de entrar, escolha **Continuar com Google** (ou iCloud).
3. Entre na página oficial que abre na janela de login do macOS. Ela fecha sozinha no fim.

O que acontece: a caixa de entrada aparece com os e-mails da conta. O cartão de contas, no alto, mostra quantos não
lidos cada conta tem.

### Passo 2 — Conhecer a janela
- **Barra de ícones (esquerda):** Caixa de entrada, pastas, Calendário e, embaixo, Ajustes.
- **Cabeçalho:** título com a contagem, busca, sino de avisos e o seu avatar no canto direito.
- **Coluna "Hoje" (direita):** a semana, seus compromissos do dia e o convite pendente.
- **Saudação:** "Bom dia, …" com o resumo do dia e uma ilustração que muda com o horário.

### Passo 3 — Ler e responder
1. Clique num e-mail. Ele abre formatado e fica marcado como lido.
2. Se aparecer "Mostrar imagens", clique para ver as imagens externas (elas vêm bloqueadas por privacidade).
3. Clique em **Responder**, escreva e clique em **Enviar**. Para incluir todo mundo do Para e do Cc, use
   **Responder a todos**. Num e-mail que você mesmo mandou, a resposta vai para quem o recebeu (como no Gmail).
4. No topo aparece "Enviando em … s · Desfazer". Se perceber um erro, clique em **Desfazer**: o e-mail volta para a
   tela de escrever com tudo preenchido.

### Passo 4 — Arquivar
1. Volte para a caixa de entrada (seta de voltar ou G e depois E).
2. Abra um e-mail que já resolveu e use o ícone de arquivar no cabeçalho da leitura.

O e-mail sai da Entrada e vai para o Arquivo (continua no Gmail, em "Todos os e-mails").

### Passo 5 — Ver o dia e responder um convite
1. Clique no Calendário na barra de ícones (ou G e depois C).
2. Troque entre **Dia**, **Semana** e **Mês**; use as setas e **Hoje** para navegar.
3. Clique num convite sem resposta (aparece listrado) e escolha **Aceitar**, **Talvez** ou **Recusar**.
4. Uma barrinha de 4 segundos permite desfazer; depois a resposta vai para o organizador.

### Passo 6 — Deixar do seu jeito
1. Aperte ⌘, para abrir os Ajustes.
2. Em **Aparência**, escolha o tema (Sistema, Claro, Escuro) e a imagem da saudação.
3. Em **Assinaturas**, escreva a assinatura de cada conta.
4. Em **Privacidade**, ligue o Touch ID se quiser.

Pronto: você já usa o essencial.

---

## Como fazer

### Ler e navegar entre e-mails
**Quando usar:** no dia a dia.
1. Clique num e-mail para abrir. Mensagens anteriores da conversa ficam recolhidas; clique para abrir.
2. Use **E-mail anterior** e **Próximo e-mail** no cabeçalho para passar de um a outro.
3. A coluna da direita mostra o remetente, os anexos e a reunião citada no e-mail, quando houver.

Limitações: e-mails formatados aparecem sempre em fundo branco, mesmo no modo escuro (são desenhados assim).

### Filtrar e trocar de pasta
- **Todas / Não lidas:** abas acima da lista.
- **Por conta:** clique numa conta no cartão de contas (o filtro some quando há uma conta só).
- **Pastas:** Entrada, Importantes, Enviados, Rascunhos, Arquivo, Spam e Lixeira na barra lateral. Escolha quais
  aparecem em **Ajustes → Marcadores e pastas** (a Entrada sempre aparece).

### Responder, responder a todos e encaminhar
1. Abra o e-mail.
2. Clique em **Responder**, **Responder a todos** ou **Encaminhar** (no fim do e-mail ou na barra de cima).
3. A caixa de resposta abre logo abaixo da mensagem. Ao lado do **Enviar** ficam negrito, itálico, sublinhado,
   marcadores, link e emoji; o botão **Aa** mostra a barra inteira (fonte, tamanho, cores, alinhamento). O clipe anexa
   arquivos. ⌘↵ também envia.
4. Precisa de Cc ou de mais espaço? Clique em **Editor completo**. A seta **Voltar ao e-mail**, no canto de cima,
   volta para o e-mail com a resposta como estava.
5. Saiu do e-mail sem enviar? A resposta fica guardada (e salva em Rascunhos) e reabre quando você voltar. A lixeira
   da caixa descarta.
6. A resposta fica na mesma conversa.

### Escrever um e-mail novo
1. Clique em **Escrever** (ou ⌘N, ou C).
2. Em **De**, escolha a conta de envio.
3. Em **Para**, digite: aparecem sugestões dos seus contatos e de quem você já escreveu. Enter, vírgula ou Tab transformam o endereço numa pílula.
   **Cc** e **Cco** abrem ao lado.
4. Formate pela barra: fonte, tamanho, negrito, cores, alinhamento, listas, link, emoji e imagens.
5. Clique em **Enviar**.

O que acontece: o rascunho é salvo sozinho no servidor enquanto você escreve; a assinatura da conta entra só no envio.

Limitações: **Agendar envio** aparece no menu de opções de envio, mas ainda não agenda de verdade (pendência).

### Desfazer um envio
**Quando usar:** logo depois de clicar em Enviar.
1. Na barrinha "Enviando em … s", clique em **Desfazer** (volta ao Escrever) ou **Enviar agora** (não espera).
2. Para mudar o tempo: **Ajustes → Geral → Tempo para desfazer o envio** (5, 10, 20 ou 30 s; padrão 10 s).

Limitações: se o app for fechado durante a espera, o e-mail não sai.

### Continuar um rascunho
1. Abra a pasta **Rascunhos**.
2. Clique no rascunho: ele abre no Escrever, de onde parou.
3. Os rascunhos também aparecem no Gmail (ou na pasta Rascunhos do iCloud/IMAP) em qualquer aparelho.

### Ações em massa
**Quando usar:** limpar vários e-mails de uma vez.
1. Passe o mouse no avatar de um e-mail e marque a caixinha que aparece ao lado. Marque outros.
2. A barra de ações em massa aparece com o que faz sentido na pasta: arquivar, lixeira, spam, não é spam, tirar da
   lixeira, excluir para sempre, marcar como lido ou não lido.
3. **Limpar seleção** desmarca tudo.

Se **Ajustes → Geral → Confirmar antes de apagar** estiver ligado, o Quill pergunta antes de mandar para a Lixeira.

### Tirar da Lixeira ou do Spam
1. Abra a pasta **Lixeira** (ou **Spam**).
2. Selecione o e-mail e use **Tirar da lixeira** (ou **Não é spam**). Ele volta para a Entrada.
3. Lendo um e-mail da Lixeira, o botão **Tirar da lixeira** fica na barra de cima.

### Excluir para sempre e esvaziar a Lixeira
**Quando usar:** apagar de vez o que está na Lixeira ou no Spam. **Não tem volta**, nem pelo Gmail.
1. Na pasta **Lixeira** ou **Spam**, selecione os e-mails e clique em **Excluir para sempre** (vermelho).
2. Lendo um e-mail da Lixeira, o botão da lixeira vira **Excluir para sempre**.
3. Para apagar tudo, use **Esvaziar lixeira** no topo da pasta Lixeira. Com **Todas** escolhido nas contas, esvazia a
   Lixeira de todas as contas conectadas; com uma conta escolhida, só a dela. Entra também o que ainda não apareceu na
   lista.
4. O Quill sempre pede confirmação e, no fim, avisa quantos e-mails saíram.

**Problemas comuns:**
- "Para excluir para sempre, entre de novo com esta conta": a conta Google entrou antes desta função existir e o
  Google pede uma permissão a mais. Em **Ajustes → Contas**, clique em **Desconectar** e conecte a conta de novo
  (aceite todas as permissões). Só precisa fazer isso uma vez por conta.

### Anexos
- **Enviar:** no Escrever, clique em **Anexar** ou arraste arquivos para a janela. Limite de 25 MB no total (limite do
  Gmail). Uma barra mostra o progresso.
- **Ver sem baixar:** no e-mail, **Ver sem baixar** abre a prévia (Quick Look no Mac ou prévia dentro do app para
  imagens, PDF, texto e vídeo).
- **Baixar:** **Baixar** salva na pasta Downloads, sem sobrescrever arquivos com o mesmo nome. Dá para mostrar o arquivo
  no Finder.

### Buscar (⌘K)
1. Aperte ⌘K (ou /, ou clique na busca do topo).
2. Digite: aparecem e-mails (inclusive uma busca no Gmail), eventos, telas e comandos (escrever, atualizar, mudar o
   tema).
3. Use as setas e Enter para abrir.

### Criar um evento
1. No Calendário, clique em **Novo evento** (ou no botão + do cartão "Hoje"). Na visão de mês dá para criar rápido
   clicando no dia.
2. Preencha título, data, **Começa às** e **Termina às** (ou **Dia todo**), local e descrição.
3. Escolha a **Agenda** (conta) e o **Lembrete**.
4. Para reunião online, ligue **Adicionar Google Meet** (só em agendas do Google).
5. Em **Convidar pessoas**, digite os convidados (com sugestões de contatos).
6. Salve.

O que acontece: o evento é criado na agenda escolhida e os convidados recebem o convite pelo serviço da conta.

### Editar ou apagar um evento
1. Clique no evento.
2. Use **Editar** para mudar data, horário, convidados, lembrete, Meet ou descrição; **Apagar** para remover.

Limitações: eventos de agendas só de leitura (como feriados) não podem ser editados.

### Responder um convite
- No Calendário, na coluna "Hoje" ou direto na lista de e-mails: **Aceitar**, **Talvez** ou **Recusar**.
- A confirmação mostra uma barrinha de 4 segundos com **Desfazer**; depois o convite some da lista de pendentes.
- Convites repetidos em várias contas aparecem uma vez só.

### Escolher quais agendas aparecem
No Calendário, abra **Calendários** e ligue ou desligue cada agenda. As agendas ficam agrupadas por conta. A escolha
fica salva neste Mac.

### Usar o Google Chat
Só funciona com conta **Google Workspace** (da empresa); contas Gmail pessoais não têm Chat pela API
([ADR-023](02-decisoes-adrs/ADR-023-google-chat-pela-api-so-workspace.md)).

1. Clique no ícone de balão na barra lateral (depois do Calendário). A bolinha azul avisa que há conversas não lidas.
2. Se aparecer **"Entre de novo com a conta para liberar o Chat"**, clique em **Entrar de novo**: o Chat pede
   permissões que o login antigo não tinha.
3. Na coluna da esquerda, escolha a conversa. Use a busca, as abas **Todas / Não lidas / Espaços** e o seletor de conta
   (quando há mais de uma conta da empresa). O número azul é quantas mensagens chegaram desde que você abriu a conversa.
   A coluna pode ficar mais larga ou mais estreita: arraste a divisória entre ela e a conversa (dois cliques voltam ao
   tamanho normal; pelo teclado, Tab até a divisória e as setas).
4. Escreva embaixo: **Enter** envia, **⇧Enter** quebra a linha. A mensagem aparece na hora com "Enviando…"; se falhar,
   aparece **Tentar de novo**.
5. Para responder dentro de uma conversa (fio), passe o mouse na mensagem e clique em **Responder no fio** na barra
   (abre as respostas e o cursor já vai para a caixa), ou abra "N respostas" e clique em **Responder na conversa**.

Como as mensagens aparecem:
- As dos outros ficam em balões cinza à esquerda; as suas, em azul-claro à direita. Mensagens seguidas da mesma pessoa
  ficam empilhadas.
- Negrito, itálico, tachado, código, links, listas, menções (@nome), emojis coloridos e os emojis próprios da empresa
  aparecem como no Google Chat. Mensagens em Markdown (como as notas de reunião do Gemini, com `**negrito**`, títulos
  `#`, listas numeradas e com recuo, citação `>` e linha `---`) também aparecem formatadas, sem asteriscos nem barras
  invertidas sobrando.
- Mensagem só com 1 a 3 emojis aparece grande e **animada**, com os emojis do Google. Nos chips de reação e nas 3
  reações rápidas, o emoji fica parado e anima quando o mouse passa por cima. Sem internet (ou com "Reduzir
  movimento" ligado no Mac), aparecem o emoji normal ou o desenho parado.
- Quando alguém cita outra mensagem, aparece o cartão com a barrinha azul, o nome em negrito e o começo do texto (até
  2 linhas); clicar nele leva até a mensagem citada e a destaca por um instante (se ela já estiver carregada).
- O horário ao lado do nome segue o Google Chat: hoje só a hora (11:00), outro dia com a data (5 de nov., 11:00) e,
  se for de outro ano, com o ano (12 de dez. de 2025, 16:40). Nas suas, o horário fica acima do grupo.

Anexos e áudio:
- **Enviar arquivo:** clipe, arrastar para a conversa ou colar uma imagem (até 200 MB por arquivo). O arquivo começa a
  subir na hora, com barra de progresso; dá para escrever uma mensagem junto e clicar na miniatura para ver antes.
- **Gravar áudio:** clique no microfone (ou segure e solte). Aparecem o tempo e a ondinha; a lixeira descarta, o botão
  de pausa para e deixa ouvir antes, e o avião envia. Na primeira vez o Mac pede permissão do microfone.
- **Receber:** imagem abre grande ao clicar; vídeo toca no lugar (o botão do canto amplia); mensagem de voz toca no
  próprio cartão (play/pausa, a ondinha vai enchendo e clicar nela pula para aquele ponto; o botão **1x** troca a
  velocidade para 1,5x e 2x); PDF e outros arquivos têm **Ver** e **Baixar** (vai para Downloads); arquivo do Google Drive abre no
  navegador.

Barra da mensagem (reações, responder, editar e apagar):
- Passe o mouse em qualquer mensagem: aparece uma barrinha no começo do balão, em cima, como no Google Chat (na
  primeira mensagem de cada pessoa ela fica ao lado do nome e do horário, sem cobrir o nome). Nela:
  - **3 reações rápidas:** no começo ✅ 🫡 🤣; com o tempo, viram as 3 que você mais usa (guardado neste computador);
  - **Adicionar reação** (carinha com +): abre a grade com todos os emojis;
  - **Responder no fio:** abre as respostas e põe o cursor na caixa para responder naquele fio;
  - **Citar na resposta:** o cartão da mensagem aparece em cima da caixa de escrever (o **X** cancela) e a sua
    mensagem sai citando a outra;
  - **⋮**: **Editar** e **Apagar** (só nas suas), **Copiar texto** e **Abrir no Google Chat**.
- As reações aparecem embaixo da mensagem com a contagem (😀 3); a sua fica em azul. Clicar num chip reage com o
  mesmo emoji; clicar no seu (azul) tira a sua reação. Emoji próprio da empresa aparece com a imagem, mas só dá para
  reagir com ele pelo Google Chat.
- **Editar** (só as suas): **⋮ → Editar**. O balão vira um campo: **Enter** salva, **⇧Enter** quebra a linha, **Esc**
  cancela. Depois aparece "(editada)". Vale também para as respostas dentro do fio.
- **Apagar** (só as suas): **⋮ → Apagar** e confirme. A mensagem some para todos. Se ela tiver respostas no fio, o
  Google Chat não deixa apagar pelo Quill (só junto com as respostas, no Google Chat).
- Pelo teclado: **Tab** chega na barra de cada mensagem (um Tab por mensagem); as **setas ← →** andam entre os botões
  e **Enter** escolhe.
- As "respostas sugeridas" do Google Chat ("Show", "De nada"…) não aparecem no Quill: o Google não as entrega pela
  API.

Outros botões: **fixar** a conversa (fica em "Fixadas", só neste Mac), **buscar** nas mensagens carregadas, **ligar**
e **nova conversa** (abrem o Google Chat no navegador). As mensagens novas chegam a cada 8 segundos com a tela aberta.

### Mudar a aparência
- **Tema:** menu do avatar → Aparência, ou **Ajustes → Aparência**, ou ⌘K → "Tema claro/escuro/do sistema".
- **Densidade da lista:** Confortável ou Compacta.
- **Prévia do texto:** liga ou desliga a primeira linha embaixo do assunto.
- **Apelido e cor de cada conta:** **Ajustes → Contas →** escolha a conta.

### Trocar a foto do avatar
1. Clique no seu avatar (canto superior direito) → **Escolher foto**.
2. Escolha uma imagem no Mac, ajuste o recorte e o zoom e confirme.

Sem foto própria, o Quill usa a foto da conta Google.

### Mudar a saudação
- **Ajustes → Aparência → Mostrar a saudação:** liga ou desliga o cartão "Bom dia".
- **Imagem da saudação:** Automático (céu de manhã, campo à tarde, cidade à noite), uma das seis ilustrações (Céu,
  Montanhas, Mar, Cidade, Aurora, Campo), uma foto sua ou nenhuma. Também dá para trocar pelo próprio cartão.

### Ligar o Touch ID
1. **Ajustes → Privacidade → Abrir o app com Touch ID**.
2. O Quill confere se o Mac tem Touch ID (ou senha) e pede uma vez para confirmar.
3. Da próxima vez que abrir, o app pede a digital (ou a senha do Mac).

Limitação: só no Mac. Ainda não testado no Mac em 2026-11-17.

### Privacidade
Em **Ajustes → Privacidade**:
- **Bloquear imagens externas** (ligado por padrão): remetentes não sabem que você abriu o e-mail.
- **Fotos e logos dos remetentes** (ligado por padrão): para mostrar, o Quill consulta o Gravatar e os ícones de sites
  do Google e da DuckDuckGo. Desligue para não consultar.
- **Apagar dados deste Mac:** limpa as preferências do Quill e recomeça. E-mails e contas continuam nos servidores.

### Notificações
Em **Ajustes → Notificações** dá para escolher aviso, som, "só de pessoas" e horário silencioso. **Atenção:** em
2026-11-17 essas escolhas ficam salvas, mas o aviso do sistema ainda não é disparado; os e-mails novos aparecem no sino
do cabeçalho.

---

## Erros comuns e como resolver

| Sintoma | Causa provável | Solução |
|---|---|---|
| Aviso "precisa entrar de novo" | Google em modo "Testando" (7 dias) ou senha de app revogada | Ajustes → Contas → entrar de novo ([guia rápido](guia-rapido.md#o-google-desconectou)) |
| E-mail novo não apareceu | A atualização automática é a cada 3 minutos, com a janela à vista | ⌘R ou o botão Atualizar |
| Anexo não vai | Passou de 25 MB no total | Mandar em mais de um e-mail ou por link |
| Não consigo editar um evento | Agenda só de leitura (feriados, agenda de outra pessoa) | Editar no dono da agenda |
| Sem Google Meet no evento | Agenda do iCloud | Meet só existe em agendas do Google |
| Chat: "O Google Chat funciona com contas do Google Workspace" | A conta é pessoal (Gmail) ou iCloud/IMAP | Conectar a conta da empresa |
| Chat: "Entre de novo com a conta para liberar o Chat" | A conta entrou antes das permissões do Chat | Clicar em **Entrar de novo** |
| Chat: "ainda não foi liberado para o Quill no Google Cloud" | Falta configurar o app de Chat no projeto do Google Cloud | Google Cloud → Google Chat API → Configuração |
| Chat: não grava áudio | Microfone negado ao Quill | Ajustes do Sistema → Privacidade e Segurança → Microfone → ligar o Quill |
| Chat: reação sua não fica azul | Você reagiu pelo celular ou navegador: a API só informa a contagem, não quem reagiu | Clicar no chip reage de novo; o Quill percebe que já era sua e passa a destacar |
| Chat: "Essa mensagem tem respostas" ao apagar | O Google só apaga junto com as respostas do fio | Apagar pelo Google Chat, se quiser apagar tudo |
| Chat: mensagem nova demora | A tela busca a cada 8 s, só com a janela à vista | Esperar alguns segundos ou trocar de conversa e voltar |
| Agendei o envio e não saiu | Agendar envio ainda não funciona | Enviar na hora |
