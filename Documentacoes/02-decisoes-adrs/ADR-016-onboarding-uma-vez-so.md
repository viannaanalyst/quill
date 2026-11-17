---
type: adr
tags: [quill, adr, onboarding, login]
updated: 2026-11-17
---

# ADR-016: Onboarding uma vez só; Sair não volta para ele; login cancelável

**Status:** Aceito (2026-11-17)

**Contexto**
A primeira versão mostrava o onboarding toda vez que o app abria sem conta, inclusive depois de "Sair". E o login do
Google podia ficar girando para sempre se a pessoa fechasse a aba.

**Decisão**
- Ao chegar na tela de entrar do onboarding, o app marca `quill.onboarded` e **não mostra mais o onboarding**. Com
  conta já conectada, ele também não aparece.
- Para ver de novo: **Ajustes → Rever o onboarding**.
- **Sair** desconecta todas as contas e fica no app, sem voltar ao onboarding.
- O login pode ser **cancelado** (para de girar), aberto de novo ou ter o link copiado; tempo máximo de 4 minutos.

**Consequências**
- Positivas: o app abre direto no que interessa; login nunca trava.
- Negativas: quem quiser rever a apresentação precisa saber onde fica (Ajustes).

**Alternativas consideradas**
- **Onboarding sempre que não houver conta:** irritante depois de "Sair".
