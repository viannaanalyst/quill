---
type: adr
tags: [quill, adr, anexos, seguranca, quick-look]
updated: 2026-11-17
---

# ADR-021: Anexos: envio pelo Gmail, download só em Downloads e prévia sem baixar

**Status:** Aceito (2026-11-17)

**Contexto**
O desenho pedia anexos com ícone real do tipo de arquivo, prévia sem baixar (como o Quick Look) e barra de progresso.
Gravar arquivos em qualquer pasta, a pedido das telas, seria um risco.

**Decisão**
- Envio pelo upload do Gmail, **até 25 MB** no total (o limite do Gmail), com arrastar e soltar.
- Download **só para a pasta Downloads**, com nome de arquivo limpo e sem sobrescrever arquivos existentes.
- "Ver sem baixar": **Quick Look** no Mac (pasta temporária do Quill) ou **prévia dentro do app** para imagens, PDF,
  texto e vídeo.
- Mostrar no Finder só aceita caminhos dentro de Downloads.
- Ícone real do tipo de arquivo com o componente `FileIcon`.

**Consequências**
- Positivas: a tela não consegue gravar fora de Downloads; prévia rápida.
- Negativas: não dá para escolher outra pasta ao baixar.

**Alternativas consideradas**
- **Diálogo "Salvar como" do sistema:** exigiria o plugin de diálogo e permissões a mais no Tauri.
