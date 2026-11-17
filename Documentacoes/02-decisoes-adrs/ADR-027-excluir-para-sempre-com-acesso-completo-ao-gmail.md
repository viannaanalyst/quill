# ADR-027: "Excluir para sempre" com o acesso completo ao Gmail

**Status:** Aceito (2026-11-17)

**Contexto**
O Gabriel pediu para apagar de vez o que está na Lixeira e no Spam, um por um, em massa e com um botão "Esvaziar
lixeira", como no Gmail. O acesso que o Quill pedia ao Google (`gmail.modify`) deixa mover para a Lixeira, mas não
apagar de vez: o Google só aceita `users.messages.delete` e `users.messages.batchDelete` com o escopo
`https://mail.google.com/` (acesso completo ao Gmail). Nas contas iCloud e "Outro e-mail" (IMAP) não há escopo:
apagar de vez é marcar `\Deleted` e mandar `EXPUNGE`.

**Decisão**
- Pedir também o escopo `https://mail.google.com/` no login do Google (`SCOPES` em `quill-core/src/google.rs`).
- Gmail: `batchDelete` com os ids em grupos de até 1000 (limite da API). "Esvaziar lixeira" lista todos os ids com o
  marcador `TRASH` (seguindo as páginas, 500 por vez) e apaga com `batchDelete`.
- Contas que entraram antes desta versão têm o acesso antigo, sem o escopo novo. Quando o Google responde 403 de
  "escopo insuficiente", o Quill devolve `LoginError::Permission` com o aviso "Para excluir para sempre, entre de
  novo com esta conta (o Google pede uma permissão a mais)", mostrado num aviso vermelho. O resto do app continua
  funcionando com o acesso antigo.
- IMAP: `\Deleted` + `UID EXPUNGE` (com UIDPLUS) só nos e-mails escolhidos; sem UIDPLUS, `EXPUNGE` da pasta. Só a
  Lixeira e o Spam aceitam apagar de vez (`check_deletable`), para nunca apagar a Entrada por engano.
- Na tela, toda exclusão definitiva pede confirmação com o texto "não dá para desfazer nem recuperar depois". O
  e-mail some da lista na hora e volta se o servidor recusar.

**Consequências**
- Positivas: dá para limpar a Lixeira e o Spam sem abrir o Gmail; funciona igual para Google, iCloud e IMAP.
- Negativas: o escopo `https://mail.google.com/` é "restrito" para o Google. Para publicar o app (sair de
  "Testando") ele exige uma verificação de segurança mais pesada. Cada conta Google já conectada precisa sair e
  entrar de novo uma vez para dar a permissão nova.
- Apagar de vez não tem volta, nem pelo Gmail. A confirmação é obrigatória (não depende de "Confirmar antes de
  apagar").

**Alternativas consideradas**
- Só mover para a Lixeira e deixar o Gmail apagar depois de 30 dias: não resolve o pedido.
- Pedir o escopo só quando a pessoa clicar em "Excluir para sempre" (login incremental): mais complexo e ainda exige
  sair da tela para a janela de login; pode vir depois se a verificação do Google pesar.
