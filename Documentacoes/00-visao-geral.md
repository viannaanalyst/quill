---
type: visao-geral
tags: [quill, email, calendario, mac]
updated: 2026-11-17
---

# Visão geral

## Ficha do projeto

**Propósito:** juntar num app leve, bonito e sem IA os e-mails e as agendas de várias contas (Google, iCloud e outros
provedores), para o Gabriel parar de alternar entre Gmail, Calendário e apps diferentes.

**Para quem:** começou como uso pessoal do Gabriel; a ideia é que outras pessoas possam usar depois.

**Plataforma:** macOS primeiro (13 Ventura ou mais novo). Windows depois.

**Gatilho de uso:** o Gabriel abre o app no Mac (com Touch ID, se ligado). Os e-mails atualizam sozinhos a cada
3 minutos enquanto a janela está à vista, e na hora com ⌘R.

**Início do projeto:** 2026-11-17. Todo o histórico até aqui é desse dia (ver [changelog](06-changelog.md)).

**Regras do produto**
- Sem IA dentro do app ([ADR-002](02-decisoes-adrs/ADR-002-sem-ia-dentro-do-app.md)).
- Não existe conta Quill: o login é sempre na página oficial de cada serviço
  ([ADR-003](02-decisoes-adrs/ADR-003-login-pela-pagina-oficial-de-cada-servico.md)).
- Tokens e senhas só nas Chaves do sistema
  ([ADR-004](02-decisoes-adrs/ADR-004-credenciais-no-infisical-e-segredos-nas-chaves.md)).
- Cada tela igual ao desenho aprovado no canvas do Doop, em claro e escuro
  ([ADR-006](02-decisoes-adrs/ADR-006-visual-pelo-canvas-do-doop.md)).

**KPIs:** nenhum definido nem medido. Os únicos números verificados são os da seção "Como foi verificado" em
[01-arquitetura-tecnica.md](01-arquitetura-tecnica.md).

**Dependências críticas**
- APIs do Google (Gmail, Agenda, People) e o app OAuth do Google, hoje em modo "Testando".
- Servidores do iCloud (IMAP, SMTP, CalDAV, CardDAV) e senha de app válida.
- Chaves do macOS para guardar tokens e senhas.
- Infisical (projeto `quill`) para montar o app com as credenciais do Google.
- O MacBook do Gabriel para montar e testar o app (a VPS não monta o app inteiro).

## SIPOC

| Fornece | Entra | Processo | Sai | Recebe |
|---|---|---|---|---|
| Google (Gmail, Agenda, Contatos) | E-mails, pastas, eventos, convites, contatos e foto do perfil | 1. Abre o app (Touch ID, se ligado) | Caixa de entrada unificada com contadores | Gabriel |
| Apple iCloud | E-mails (IMAP/SMTP), agendas (CalDAV), contatos (CardDAV) | 2. Conecta as contas na página oficial (Google) ou com senha de app (iCloud, outros) | E-mails enviados, respondidos e encaminhados | Destinatários dos e-mails |
| Outros provedores IMAP | E-mails | 3. Lê, organiza e busca (⌘K) os e-mails de todas as contas | Rascunhos salvos no próprio servidor | Gabriel, em qualquer outro app de e-mail |
| Chaves do macOS | Tokens do Google e senhas de app | 4. Escreve e envia, com tempo para desfazer | Convites respondidos e eventos criados ou editados | Quem convidou ou foi convidado |
| Gravatar e ícones de sites (Google, DuckDuckGo) | Fotos e logos dos remetentes | 5. Consulta, cria e responde compromissos no Calendário | Anexos salvos em Downloads | Gabriel |
| Gabriel | Preferências, assinaturas, foto do avatar, imagem da saudação | 6. Ajusta aparência, notificações e privacidade | — | — |

## O que já funciona (em 2026-11-17)

Legenda da última coluna:
- **Mac:** o histórico do git mostra que isso rodou no app montado no Mac (commits feitos no Mac ou correções da janela
  nativa e do login logo depois).
- **Prévia:** conferido na prévia do navegador (telas) e, quando há lógica nativa, nos testes da `quill-core`. **Sem
  confirmação no app do Mac.**

Montar o app no Mac não gera commit. Em 2026-11-17 o app foi montado no Mac nos commits `37189cc`, `4f906d6` e
`910403d`, e o Gabriel usou de verdade: login, pastas (Spam, Enviados), leitura de e-mails reais, foto do Google no
avatar, notificações, anexos e o calendário com as agendas do Google. O que entrou depois de `910403d` ainda não foi
montado (próxima montagem: a do commit da documentação).

| Área | O que faz | Conferido |
|---|---|---|
| Onboarding | Apresentação em 6 passos, animada, claro e escuro | Mac |
| Login Google | Página oficial no navegador, várias contas, tokens nas Chaves | Mac |
| Login Google na janela do macOS | Página do Google na janela de login do sistema (ASWebAuthenticationSession), com o navegador de reserva | Mac (parcial: abrir, fechar e cancelar; login completo falta) |
| Caixa de entrada e leitura (texto) | E-mails reais das contas Google; marcar como lido | Mac |
| Menu do avatar | Contas, conectar conta Google, Aparência, Sair | Mac |
| Login (melhorias) | Cancelar, Abrir de novo e Copiar link; onboarding uma vez só; Sair sem voltar ao onboarding | Mac (parcial: cancelar o login foi pedido depois do teste) |
| Pastas e ações | Pastas do Gmail (Entrada, Importantes, Enviados, Rascunhos, Arquivo, Spam, Lixeira), contadores, arquivar, lixeira, tirar da lixeira, spam, estrela, lido/não lido, uma a uma ou em massa | Mac (pastas e ações uma a uma); em massa só na prévia |
| Leitura formatada | E-mail em HTML num quadro isolado, imagens externas sob pedido | Mac |
| Escrever | Enviar, responder, responder a todos, encaminhar, Cc/Cco, sugestões de destinatário, anexos até 25 MB | Prévia |
| Editor | Barra como a do Gmail: fontes, cores, alinhamento, listas, link, emoji, imagens embutidas | Prévia |
| Rascunhos | Salvos sozinhos no Gmail enquanto escreve | Prévia |
| Desfazer envio | O e-mail espera 5, 10, 20 ou 30 s antes de sair | Prévia |
| Anexos | Baixar para Downloads, abrir, Quick Look e prévia dentro do app; ícone real do tipo | Prévia |
| Google Agenda | Dia, semana e mês; agendas de todas as contas sem repetir convites; responder convite; criar evento | Mac (visualização); criar e responder só na prévia |
| Eventos completos | Editar, apagar, convidados, lembretes, Google Meet e descrição | Prévia |
| iCloud | E-mail (IMAP/SMTP), agenda (CalDAV) e contatos (CardDAV) com senha de app | Prévia + testes |
| Outro e-mail | IMAP/SMTP com palpite dos servidores | Prévia + testes |
| Busca ⌘K | E-mails (inclusive busca no Gmail), eventos, telas e comandos | Prévia |
| Ajustes | Contas (apelido, cor, assinatura padrão, desconectar), Geral, Aparência, Notificações, Assinaturas, Marcadores e pastas, Atalhos, Privacidade | Prévia |
| Avatar | Foto do Google ou foto própria, com recorte e zoom | Mac (foto do Google); recorte só na prévia |
| Saudação | "Bom dia/Boa tarde/Boa noite" com ilustração automática pelo horário, escolhida ou foto própria | Prévia |
| Fotos dos remetentes | Gravatar e ícones de sites, desligável | Mac (logos); Gravatar só na prévia |
| Touch ID | Pede a digital (ou a senha do Mac) ao abrir | Prévia (não dá para testar Touch ID fora do Mac) |
| Ícone do Dock | 8 opções em Ajustes → Aparência (Clássico, Escuro e 6 variações do Codex); vale com o app aberto | Prévia |

## Fora do escopo por enquanto

- Conta Quill, servidor próprio, sincronização entre aparelhos.
- IA de qualquer tipo (resumo, resposta sugerida, classificação).
- Celular.

## Pendências

| Pendência | Onde resolver |
|---|---|
| Testar no Mac tudo o que está como "Prévia" acima, principalmente iCloud, Outro e-mail, Touch ID, envio, rascunhos, desfazer envio e agenda | Montar o app no Mac quando o Gabriel pedir ([ADR-009](02-decisoes-adrs/ADR-009-conferir-na-previa-e-montar-so-quando-pedir.md)) |
| Login Microsoft (Outlook/Hotmail/365) | Registrar o app no portal da Microsoft (Azure); depois Graph para e-mail e agenda |
| Publicar o app do Google (sair de "Testando" e do login a cada 7 dias) | Google Cloud → aba Branding: página inicial e política de privacidade |
| Cache local dos e-mails em SQLite (previsto no `AGENTS.md`) | Ainda não existe: hoje os e-mails vêm do servidor a cada abertura e atualização |
| Agendar envio | Só existe a tela no Escrever; ainda não agenda de verdade |
| Avisos do sistema quando chega e-mail | Ajustes → Notificações guarda as escolhas, mas o aviso do sistema ainda não é disparado; hoje só o sino do cabeçalho mostra os novos |
| Chaves "E-mail" e "Agenda" por conta e "buscar e-mails a cada…" | Existem só na prévia (dados de exemplo); nas contas reais ainda não |
| Atalhos R (responder), E (arquivar) e # (lixeira) | Aparecem em Ajustes → Atalhos, mas ainda não estão ligados em `src/shell/shortcuts.ts` |
| Ícone do Dock escolhido pelo usuário | Em andamento em 2026-11-17 (fora do último commit) |
| Assinar e autenticar o app pela Apple | Para abrir sem o aviso do macOS e para distribuir a outras pessoas |
| Versão para Windows (e Windows Hello) | Depois do Mac; agenda pelas APIs do Google/Microsoft |
| Agenda do Mac pelo EventKit (previsto no `AGENTS.md`) | Ainda não existe; hoje a agenda vem do Google e do iCloud direto |
| `README.md` da raiz desatualizado ("ainda não há código") | Atualizar apontando para `Documentacoes/` |

## Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Google desconecta a cada 7 dias (app em "Testando") | Alta (certa) | Médio | Entrar de novo em Ajustes → Contas; publicar o app do Google |
| Google recusar a publicação ou exigir verificação de segurança por causa dos escopos do Gmail | Média | Alto | Manter só os escopos necessários; preparar política de privacidade; seguir em "Testando" para uso pessoal |
| Senha de app do iCloud revogada ou trocada | Baixa | Médio | O app pede para conectar de novo (`needs_login`) |
| Funções novas falharem no Mac (testadas só na prévia) | Média | Médio | Próxima montagem no Mac com roteiro de teste das pendências acima |
| E-mail malicioso (scripts, rastreadores) | Média | Alto | Quadro isolado sem scripts, imagens externas bloqueadas, links só http/https/mailto ([ADR-010](02-decisoes-adrs/ADR-010-email-formatado-em-quadro-isolado.md)) |
| Vazamento de dado pessoal em prints | Baixa | Alto | Prints no Mac só da janela do Quill; prévia usa dados de exemplo |
| Mudanças de API do Gmail, do iCloud ou do Tauri | Baixa | Médio | Lógica isolada e testada na `quill-core` (199 testes) |
| Microsoft continuar sem login | Alta | Médio | Usar Google, iCloud ou IMAP; tentar o portal de novo |

## Histórico de versões

| Versão | Data | Autor | O que mudou |
|---|---|---|---|
| 0.1.0 | 2026-11-17 | Gabriel Vianna (com agentes de IA) | Desenho aprovado, app em Tauri, login Google, e-mails e agenda reais, iCloud/IMAP, Touch ID |
| Doc 1.0 | 2026-11-17 | Agente de IA, para o Gabriel | Criação desta documentação |
