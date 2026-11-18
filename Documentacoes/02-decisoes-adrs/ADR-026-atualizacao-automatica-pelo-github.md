# ADR-026: Atualização automática pelas releases do GitHub

**Status:** Aceito (2026-11-17)

**Contexto**
Cada versão nova do Quill era montada no Mac por um agente e copiada para /Applications. O Gabriel perguntou por que
o app não se atualiza sozinho. Para isso o app precisa baixar as versões de um lugar público, e o repositório do
Quill era privado. A primeira tentativa foi criar um repositório público só para as versões (`quill-releases`); o
Gabriel preferiu tornar o próprio repositório público (antes disso o histórico foi conferido: nenhuma senha ou chave).
O `quill-releases` ficou arquivado.

**Decisão**
- Plugin oficial `tauri-plugin-updater` (+ `tauri-plugin-process` para reabrir). O app consulta
  `https://github.com/viannaanalyst/quill/releases/latest/download/latest.json` ao abrir (10 s depois) e a cada 6 h.
- Cada versão é assinada com uma chave própria de atualização (não é a assinatura da Apple). A chave privada fica só
  no Mac (`~/.tauri/quill-updater.key`) e no Infisical; a chave pública vai no `tauri.conf.json`
  (`plugins.updater.pubkey`). O app só instala o que estiver assinado com essa chave.
- Publicar é rodar `scripts/release-mac.sh "o que mudou"` no Mac: monta, gera o `latest.json` e cria a release no
  GitHub com o pacote de atualização e o `.dmg`.
- Na tela: ícone de download com um pontinho na barra lateral, acima de Ajustes (`src/shell/UpdateButton.tsx`,
  como no runelay), que abre uma janelinha com a versão nova e "Atualizar"; e, em Ajustes → Geral, a versão
  instalada e "Verificar atualizações". A pessoa escolhe quando instalar. (Até a 0.2.2 era um aviso no canto,
  o `UpdateBanner`, trocado em 2026-11-18.)

**Consequências**
- Positivas: o Gabriel atualiza com um clique; não precisa mais de agente copiando o app.
- Negativas: o código do Quill é público. Com `createUpdaterArtifacts` ligado, toda montagem precisa da chave privada
  (sem ela, a montagem falha); por isso montar continua sendo no Mac.
- A cada versão nova, sem assinatura fixa da Apple, o macOS ainda pede a senha das Chaves uma vez (ADR-024).

**Alternativas consideradas**
- Repositório público só para versões: criado e descartado a pedido do Gabriel.
- Servidor próprio na VPS: exigiria abrir um endereço público fora do Tailscale.
