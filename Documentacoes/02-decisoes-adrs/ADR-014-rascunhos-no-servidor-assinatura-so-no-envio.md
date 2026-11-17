---
type: adr
tags: [quill, adr, escrever, rascunhos, assinatura]
updated: 2026-11-17
---

# ADR-014: Rascunhos salvos no próprio servidor; assinatura só no envio

**Status:** Aceito (2026-11-17)

**Contexto**
Um rascunho guardado só no Mac some se o app fechar e não aparece no Gmail do celular. Ao mesmo tempo, salvar o
rascunho com a assinatura fazia ela duplicar quando o rascunho era reaberto e enviado.

**Decisão**
- Os rascunhos são **salvos sozinhos no próprio Gmail ou na pasta Rascunhos do IMAP** enquanto a pessoa escreve
  (cerca de 3 s depois da última mudança).
- O rascunho é salvo **sem a assinatura**. A assinatura da conta (Ajustes → Assinaturas, ou "Nenhuma" no detalhe da
  conta) entra **só na hora do envio**.
- Ao enviar ou descartar, o rascunho é apagado do servidor.

**Consequências**
- Positivas: rascunho aparece em qualquer aparelho; nada se perde se o app fechar; assinatura nunca duplica.
- Negativas: quem abre o rascunho no site do Gmail não vê a assinatura.

**Alternativas consideradas**
- **Rascunho só local:** perde-se fora do Mac.
- **Salvar com assinatura e tentar tirar ao reabrir:** frágil.
