---
type: adr
tags: [quill, adr, calendario, google, feriados]
updated: 2026-11-17
---

# ADR-012: Convites repetidos entre contas juntados num evento só

**Status:** Aceito (2026-11-17)

**Contexto**
O Gabriel tem várias contas Google, e muitos convites chegam em mais de uma. Os feriados também apareciam dobrados
quando a agenda de feriados estava assinada em dois idiomas ou em duas contas.

**Decisão**
- Eventos com o **mesmo iCalUID e o mesmo horário de início** viram um evento só no Calendário e no cartão "Hoje"
  (`src/state/calendar.ts`).
- Agendas de feriados da mesma região em idiomas diferentes (ou em contas diferentes): fica **só uma**, preferindo a em
  português; as outras ficam escondidas.

**Consequências**
- Positivas: agenda limpa, sem duplicatas.
- Negativas: se duas contas tiverem o mesmo convite com respostas diferentes, a tela mostra uma delas.

**Alternativas consideradas**
- **Mostrar tudo:** agenda poluída.
- **Juntar por título e horário:** juntaria eventos diferentes com o mesmo nome.
