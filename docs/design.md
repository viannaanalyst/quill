# Quill: guia de estilo

Cópia do guia do canvas "Quill" no Doop (`quill-estilo`), aprovado pelo Gabriel em 17/11/2026. As imagens das telas estão em [`../design/telas/`](../design/telas/).

## Direção

- Visual inspirado no print de [`../referencias/inspiracao-inbox.png`](../referencias/inspiracao-inbox.png): claro e limpo, barra de ícones finos à esquerda, botão principal escuro em pílula, abas em pílula, cartões bem arredondados.
- **Branco suave, nunca creme.** Neutros sem tom quente. As cores do logo entram só como destaque.
- Toda tela existe em **modo claro e escuro**.
- Sem nada de IA.

## Cores

| Papel | Claro | Escuro |
|---|---|---|
| Fundo da janela / barra de ícones | #F1F1F2 | #0B0B0D |
| Painel principal | #FCFCFC | #131416 |
| Cartão | #FFFFFF | #1A1B1E |
| Pílula ativa / hover | #F2F2F3 | #232428 |
| Borda / separador de linhas | #E7E7E9 / #EEEEF0 | #2A2B2F / #222327 |
| Texto principal / secundário / apagado | #1B1C1E / #56585D / #8F9196 | #F1F1F2 / #B3B5BA / #7A7C82 |
| Azul do envelope (não lido, selo, avisos) | #4F86B5 | #7FB0D8 |
| Sálvia (sincronizado, detalhes) | #6F9068 | #9BB893 |
| Linha selecionada | #F5F8FB | #181C21 |
| Avatar pêssego (fundo / texto) | #F6DEC6 / #6B4A2E | #3A2C20 / #E7C6A6 |
| Aviso (fundo / texto) | #FBF1E2 / #A0621A | #2B2318 / #E2B866 |
| Ação perigosa (Desconectar) | #C2453D | #EE8A82 |

Cor de cada conta (bolinha no canto do logo, etiquetas e eventos): Pessoal #5A8CB7 · Moradah #7C9A74 · inchurch #C8925A · Outlook #7A8CA8 · iCloud/Família #A592B8 · Feriados #9A9AA0.

## Estrutura da janela

- **Barra de ícones de 64px** do lado de fora, sem borda: botões do macOS, logo (38px), ícones de 40px. O ativo fica num quadradinho branco com contorno fino. Ajustes ficam embaixo.
- **Painel principal com uma linha fina contornando tudo**: margem de 10px, borda de 1px, cantos de 22px.
- **Cabeçalho** de 64px: título • contagem, busca em pílula, notificações e o **avatar do usuário no canto direito** (nunca na barra lateral).
- Abaixo: botão principal + abas em pílula; conteúdo em duas colunas, com uma coluna de apoio de 290 a 320px à direita.

## Tipografia

Só **Inter** (é a fonte do print). No app nativo, a fonte do sistema (SF Pro) é uma alternativa equivalente. Nada de serifada.

Escala: título do cabeçalho 20/400 · saudação 24/600 · título de cartão 20/600 · remetente 15.5/600 · assunto 14/500 · prévia 13.5/400 · rótulos 11.5–12.

## Botões

- Formato **pílula** (cantos totalmente arredondados), como o "Continue" do print.
- Acabamento do runelay: degradê de cima para baixo, brilho de 1px no topo e sombra suave.
- Altura 36px (grande 40, pequeno 30). Botões só de ícone são círculos de 36px.
- **Principal** (Escrever, Responder, Enviar, Novo evento, Aceitar): preto no claro, branco no escuro.
  - Claro: degradê #404145 → #17181A, borda #0D0D0F, brilho rgba(255,255,255,.24), texto #FCFCFC.
  - Escuro: degradê #FFFFFF → #D1D2D5, borda rgba(255,255,255,.55), brilho rgba(255,255,255,.95), texto #141517.
- **Secundário** (Talvez, Recusar, Encaminhar, botões de ícone): fundo quase transparente com contorno fino.
  - Claro: preenchimento rgba(27,28,30,.045), contorno rgba(27,28,30,.10).
  - Escuro: preenchimento rgba(255,255,255,.05), contorno rgba(255,255,255,.09).
- **Nunca botão verde.**

## Eventos e agenda

- **Sem barrinha lateral colorida** nos eventos. O bloco do evento usa só um fundo suave na cor da agenda.
- Nas listas de compromissos, a cor da agenda aparece como uma bolinha de 8px ao lado do horário.
- Convite sem resposta: listrado, com contorno na cor da agenda.

## Cartões

Cantos de 20px, borda de 1px, sombra 0 1px 2px rgba(0,0,0,.04).

## Ícones

Lucide com traço 1,75 e logos reais dos serviços (Gmail, Microsoft, iCloud, Google Meet…) dentro de um círculo ou quadradinho claro. Nunca emoji.

## Telas

1. **Caixa de entrada**
   - cartão com as contas e o número de não lidos de cada uma;
   - banner ilustrado com "Bom dia, Gabriel" e o resumo do dia;
   - lista com avatar, selo de verificado, etiqueta da conta, data e prévia;
   - convites com Aceitar/Talvez/Recusar direto na lista;
   - coluna "Hoje" com a semana, os compromissos e o convite pendente.
2. **Leitura**
   - voltar + assunto no cabeçalho;
   - Responder, Responder a todos e Encaminhar;
   - arquivar, lixeira, spam, não lida, importante, marcador e mover;
   - conversa com as mensagens anteriores recolhidas, anexos e resposta rápida;
   - coluna com o remetente, os anexos e a reunião citada no e-mail.
3. **Escrever**
   - conta de envio ("De"), destinatários em pílula, sugestões enquanto digita, Cc/Cco;
   - barra de formatação, assinatura e anexos com progresso;
   - agendar envio, escolher assinatura e contatos recentes.
4. **Calendário (dia, semana e mês)**
   - eventos na cor da agenda; convite sem resposta listrado; linha azul do horário atual;
   - **dia:** detalhe do próximo evento (entrar no Meet, participantes, sua resposta);
   - **semana:** cartão do convite com resposta, editar e apagar;
   - **mês:** criação rápida de evento.
5. **Configurações de contas**
   - menu de ajustes;
   - lista das contas com o estado da sincronização, chaves E-mail/Agenda e avisos com "Corrigir";
   - adicionar conta (Google, Microsoft, iCloud, outro IMAP);
   - detalhes da conta escolhida.

## Para quando formos programar

- Anexos com o **ícone real do tipo de arquivo** (PDF, planilha, Word, imagem, zip…).
- **Prévia dos anexos** sem baixar (como o Quick Look do Mac), nos recebidos e nos enviados.
- Barra de progresso do envio de anexo **animada**.
