---
type: adr
tags: [quill, adr, escrever, envio, outbox]
updated: 2026-11-17
---

# ADR-013: Desfazer envio: o e-mail espera alguns segundos antes de sair

**Status:** Aceito (2026-11-17)

**Contexto**
Depois de clicar em Enviar, é comum perceber um erro (destinatário, anexo esquecido). O Gmail resolve isso segurando
o e-mail por alguns segundos.

**Decisão**
- Ao enviar, o e-mail vai para uma **caixa de saída local** (`src/state/outbox.ts`) e espera **N segundos** antes de
  ir para o servidor. Uma barra mostra a contagem com **Desfazer**.
- N vem de Ajustes → Geral → Tempo para desfazer o envio: 5, 10 (padrão), 20 ou 30 s (`quill.undoSeconds`).
- Desfazendo, volta para o Escrever com tudo preenchido.

**Consequências**
- Positivas: dá para corrigir o erro antes de sair.
- Negativas: o e-mail demora N segundos a mais para sair; se o app fechar durante a espera, o e-mail não é enviado
  (se o rascunho já tinha sido salvo, ele continua no servidor).

**Alternativas consideradas**
- **"Desfazer" do próprio Gmail:** não existe na API; só no site do Gmail.
