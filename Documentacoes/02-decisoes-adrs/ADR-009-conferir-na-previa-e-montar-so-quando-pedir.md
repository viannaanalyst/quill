---
type: adr
tags: [quill, adr, fluxo, mac, privacidade]
updated: 2026-11-17
---

# ADR-009: Conferir na prévia e montar no Mac só quando o Gabriel pedir

**Status:** Aceito (2026-11-17)

**Contexto**
Montar o app no Mac leva tempo e gasta recursos, e a maior parte das mudanças é visual ou de lógica já testada. Além
disso, prints da tela do Mac mostram os e-mails pessoais do Gabriel.

**Decisão**
- As mudanças são conferidas na **prévia do navegador** (`npm run dev`), com prints em claro e escuro, usando os
  parâmetros `?screen=`, `?theme=`, `?native=1`, `?step=`.
- O app **só é montado no Mac quando o Gabriel pedir**, ou quando for preciso ver algo que só existe na janela nativa.
- No Mac, prints são **só da janela do Quill** (`screencapture -l <id>`), nunca da tela inteira.

**Consequências**
- Positivas: economia de tempo e de montagens; nenhum print com e-mail pessoal.
- Negativas: funções que dependem do Mac (Touch ID, Quick Look, Chaves, login real) ficam sem teste até a próxima
  montagem. Em 2026-11-17 isso inclui iCloud, Touch ID e todas as funções a partir do commit `37189cc`.

**Alternativas consideradas**
- **Montar a cada mudança:** caro e lento.
