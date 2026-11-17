---
type: adr
tags: [quill, adr, login, oauth, pkce, seguranca]
updated: 2026-11-17
---

# ADR-003: Login sempre pela página oficial de cada serviço

**Status:** Aceito (2026-11-17)

**Contexto**
O Quill precisa acessar Gmail, Agenda e contatos. Pedir a senha da conta Google dentro do app seria inseguro, e o
Google nem permite. Também não faz sentido criar uma "conta Quill" com servidor próprio só para guardar contas.

**Decisão**
- **Não existe conta Quill.** Cada conta entra direto no serviço dela.
- Google: **OAuth 2.0 para apps de computador com PKCE** e volta para um endereço local (`127.0.0.1`, porta livre
  escolhida pelo sistema). A página oficial do Google abre no navegador (no Mac, na janela de login do sistema, ver
  ADR-022); o Quill nunca vê a senha.
- O login pode ser cancelado, reaberto ou ter o link copiado; espera no máximo 4 minutos; um login novo encerra o
  anterior.
- iCloud e outros provedores que não têm OAuth para apps de terceiros usam **senha de app** (ver ADR-015).
- Microsoft vai pelo mesmo caminho do Google quando o app for registrado no portal da Microsoft.

**Consequências**
- Positivas: o Quill nunca recebe a senha do Google; dá para revogar o acesso na conta Google a qualquer momento;
  nenhum servidor próprio para manter.
- Negativas: enquanto o app do Google estiver em "Testando", o Google pede login de novo a cada 7 dias; para outras
  pessoas usarem, o app precisa ser publicado (página inicial e política de privacidade).
- Atenção: o segredo do cliente OAuth fica dentro do programa; em app de computador ele não é secreto de verdade. A
  proteção real é o PKCE e a volta só para `127.0.0.1`.

**Alternativas consideradas**
- **Conta Quill com servidor próprio:** custo, responsabilidade de guardar dados de terceiros e nenhum ganho para
  uso pessoal.
- **Senha do Google dentro do app (IMAP do Gmail):** o Google bloqueia ou exige senha de app; pior experiência e menos
  seguro.
- **Navegador embutido no app para o login:** o Google bloqueia login em navegadores embutidos.
