---
type: adr
tags: [quill, adr, privacidade, avatar, caixa-de-entrada]
updated: 2026-11-17
---

# ADR-011: Fotos e logos dos remetentes via Gravatar e ícones de sites

**Status:** Aceito (2026-11-17)

**Contexto**
Na caixa de entrada, só as iniciais dos remetentes deixavam a lista difícil de ler. O desenho aprovado mostra logos
das empresas.

**Decisão**
- O avatar tenta, em ordem: **Gravatar** (foto da pessoa ou da marca), **ícone do site pelo Google** (domínio
  principal e completo) e **ícone da DuckDuckGo**. Para Gmail, Hotmail e afins, só o Gravatar.
- Sem resultado, ficam as iniciais.
- **Desligável** em Ajustes → Privacidade → Fotos e logos dos remetentes (`quill.senderLogos`), com o aviso de que o
  Quill consulta esses serviços.

**Consequências**
- Positivas: lista mais fácil de ler, igual ao desenho.
- Negativas: Gravatar, Google e DuckDuckGo ficam sabendo de quais domínios e e-mails (em hash MD5, no Gravatar) você
  recebe mensagens. Por isso a opção existe.

**Alternativas consideradas**
- **Só iniciais:** pior de ler.
- **Banco de logos dentro do app:** pesado e sempre desatualizado.
