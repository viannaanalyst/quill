---
type: adr
tags: [quill, adr, produto, ia, privacidade]
updated: 2026-11-17
---

# ADR-002: Sem IA dentro do app

**Status:** Aceito (2026-11-17)

**Contexto**
Quase todo app de e-mail novo traz IA: resumo, resposta sugerida, classificação automática. Isso exige mandar o
conteúdo dos e-mails para serviços externos, custa dinheiro por uso e deixa a interface mais carregada.

**Decisão**
O Quill **não tem nenhuma função de IA**: nada de resumo, resposta sugerida, escrita assistida nem classificação por
modelo. Os e-mails vão só entre o Mac e o provedor da conta.

**Consequências**
- Positivas: privacidade (o conteúdo não sai para terceiros); sem custo por uso; app mais simples e leve.
- Negativas: sem os atalhos que outros apps oferecem com IA.
- Observação: IA continua sendo usada **para construir** o app (agentes que programam, Codex que gera ilustrações,
  ver ADR-018). A regra vale para o que roda dentro do app.

**Alternativas consideradas**
- **IA opcional, desligada por padrão:** ainda exigiria contas, chaves e envio de conteúdo; deixada de fora para
  manter o produto simples.
