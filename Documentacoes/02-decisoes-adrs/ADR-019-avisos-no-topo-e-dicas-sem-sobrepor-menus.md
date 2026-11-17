---
type: adr
tags: [quill, adr, interface, toasts, tooltips]
updated: 2026-11-17
---

# ADR-019: Avisos (toasts) no topo e no centro; dicas somem com o menu aberto

**Status:** Aceito (2026-11-17)

**Contexto**
Os avisos rápidos (confirmações e erros) precisavam de um lugar fixo e fácil de ver. E as dicas dos botões só com
ícone apareciam por cima do menu que o próprio botão abria.

**Decisão**
- Avisos com `toast("texto")` ou `toast("texto", "error")` aparecem **no topo, no centro da janela**, em pílula.
- Botões só com ícone têm `aria-label` e dica `data-tip`; a dica **some enquanto o menu do botão está aberto**
  (`[data-tip][data-state="open"]`).

**Consequências**
- Positivas: avisos visíveis; menus sem dica por cima.
- Negativas: nenhuma relevante.

**Alternativas consideradas**
- **Avisos num canto da janela:** mais fáceis de passar despercebidos numa janela grande.
