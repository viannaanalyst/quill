---
type: adr
tags: [quill, adr, previa, dados, tauri]
updated: 2026-11-17
---

# ADR-020: Dados de exemplo só na prévia; o app sem conta mostra só o botão de conectar

**Status:** Aceito (2026-11-17)

**Contexto**
As telas nasceram com dados de exemplo para ficarem iguais aos desenhos. No primeiro teste no Mac, o app se achava
"prévia" (os objetos do Tauri chegavam um pouco depois) e mostrava exemplos e um botão do Google que só pulava de tela.

**Decisão**
- O app se reconhece pelo **endereço interno** (`tauri://localhost` no Mac, `http://tauri.localhost` no Windows), que
  existe desde o primeiro instante (`src/lib/platform.ts`).
- **Na prévia do navegador:** dados de exemplo (contas, e-mails e eventos de novembro de 2026), para conferir o visual.
- **No app sem conta:** nada de exemplo; caixa de entrada, Calendário e Ajustes mostram o botão para conectar.

**Consequências**
- Positivas: o Gabriel nunca confunde exemplo com e-mail real; a prévia continua igual ao desenho.
- Negativas: dois caminhos de dados para manter em `mailbox.ts` e `calendar.ts`.

**Alternativas consideradas**
- **Exemplos também no app:** confuso e perigoso (responder a um e-mail que não existe).
