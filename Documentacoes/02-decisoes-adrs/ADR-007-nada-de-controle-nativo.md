---
type: adr
tags: [quill, adr, design, componentes, radix, animacao]
updated: 2026-11-17
---

# ADR-007: Nada de controle nativo: selects, datas, horas e cores do Quill

**Status:** Aceito (2026-11-17)

**Contexto**
Os controles nativos do navegador (`<select>`, `<input type="date">`, `type="time"`, `type="color"`) mudam de cara
em cada sistema, não seguem o tema escuro do Quill e quebram o visual aprovado.

**Decisão**
- Todo controle é do Quill: `Select` (`src/components/Select.tsx`), `DatePicker`, escolha de hora e de cor, com
  **Radix UI** (só os pacotes usados: Dialog, Popover, Select) e CSS próprio.
- Janelinhas flutuantes com Radix Popover e a classe `qp-content`; abas e botões segmentados com `SliderGroup`.
- Animações **só com `transform` e `opacity`**; telas entram com `.screen-enter` e listas com `.stagger`.

**Consequências**
- Positivas: mesmo visual em claro, escuro, Mac e Windows; animações leves.
- Negativas: mais código para manter, e cuidado com acessibilidade (teclado, leitor de tela), que o Radix ajuda a
  cobrir.

**Alternativas consideradas**
- **Controles nativos:** visual inconsistente.
- **Biblioteca com visual pronto:** ver ADR-006.
