---
type: adr
tags: [quill, adr, css, lazy, bug]
updated: 2026-11-17
---

# ADR-008: Nomes de classe CSS com prefixo por tela

**Status:** Aceito (2026-11-17)

**Contexto**
As telas carregam sob demanda (`React.lazy`). O CSS de uma tela continua ativo depois que ela fecha. Em 2026-11-17 as
classes `.invite` e `.today` do onboarding vazaram para a caixa de entrada e sobrepuseram o cartão de convite.

**Decisão**
Cada tela usa um **prefixo próprio** nos nomes de classe (`ob-` onboarding, `inbox-`, `rd-` leitura, `cal-`, `st-`
Ajustes, `cp-` Escrever, `acm-` menu do avatar, `imc-` formulário IMAP…) ou CSS Modules (`*.module.css`) nas telas novas.

**Consequências**
- Positivas: uma tela não estraga a outra.
- Negativas: nomes mais longos.
- Atenção: em 2026-11-17 a caixa de entrada ainda tem algumas classes genéricas (`.row-…`, `.list-…`); trocar
  quando mexer nela.
- Atenção: a prévia tem `?preload=onboarding` para carregar o onboarding junto e pegar vazamentos.

**Alternativas consideradas**
- **CSS-in-JS:** mais peso e foge do "CSS puro com tokens".
- **Descarregar o CSS ao fechar a tela:** o Vite não faz isso sozinho; frágil.
