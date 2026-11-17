---
type: guia-rapido
tags: [quill, mac, contas, atalhos]
updated: 2026-11-17
---

# Guia rápido

Para o Gabriel: o essencial para instalar, conectar as contas e resolver os problemas mais comuns. O passo a passo do
dia a dia (ler, responder, agenda) está no [tutorial de uso](04-tutorial-uso.md).

> **Situação em 2026-11-17:** onboarding, login com Google e a caixa de entrada com os e-mails reais já rodaram no
> app do Mac. O resto (pastas, envio, Google Agenda, iCloud, "Outro e-mail", Touch ID, editor, rascunhos, desfazer
> envio) foi conferido na prévia do navegador e nos testes, e **ainda não foi testado no app do Mac**. Detalhes em
> [00-visao-geral.md](00-visao-geral.md).

## Instalar e abrir

O app é montado no MacBook, a partir da cópia em `/Users/gabrielvianna/Projetos/quill`.

1. Depois da montagem, o app fica em `src-tauri/target/release/bundle/macos/Quill.app` (e o instalador `.dmg` em
   `src-tauri/target/release/bundle/dmg/`).
2. Arraste o `Quill.app` para a pasta **Aplicativos** (ou abra o `.dmg` e arraste de lá).
3. Abra pelo Launchpad, pelo Spotlight (⌘ espaço, "Quill") ou pela pasta Aplicativos.
4. Se o macOS disser que não pode verificar o desenvolvedor (o app ainda não é assinado nem autenticado pela Apple):
   clique com o botão direito no Quill → **Abrir** → **Abrir**. Só é preciso na primeira vez.

Precisa de macOS 13 (Ventura) ou mais novo.

Na primeira abertura aparece a apresentação (onboarding). Ela só aparece uma vez; para rever, use
**Ajustes → Rever o onboarding**.

## Conectar contas

Não existe conta Quill. Você entra direto em cada serviço, na página oficial dele. Dá para conectar pelo onboarding,
por **Ajustes → Contas → Adicionar conta** ou pelo menu do avatar (canto superior direito) → conectar outra conta.

### Google (Gmail ou Google Workspace)

1. Escolha **Continuar com Google**.
2. Abre uma janela de login do macOS com a página do Google (fora do Mac, ou se ela não abrir, o navegador). Escolha
   a conta e aceite as permissões (ler e organizar e-mail, enviar, agenda
   e contatos).
3. Como o app do Google ainda está em modo de teste, pode aparecer o aviso "O Google não verificou este app". Clique em
   **Continuar**: só as contas do Gabriel estão liberadas como testadoras.
4. A janela fecha sozinha. A conta aparece e os e-mails começam a chegar.

Enquanto espera, a tela de login tem três botões:
- **Abrir de novo:** reabre a página do Google.
- **Copiar link:** para colar em outro navegador.
- **Cancelar:** desiste do login (fechar a janela de login faz o mesmo).

O login espera até 4 minutos. Começar um login novo encerra o anterior.

### iCloud (com senha de app)

A Apple não deixa apps de terceiros usarem a senha do Apple ID. É preciso criar uma **senha de app** só para o Quill:

1. Escolha **Continuar com iCloud**. O formulário tem um link para o site da Apple.
2. Em [appleid.apple.com](https://appleid.apple.com), entre e vá em **Entrar e segurança → Senhas de app** (em
   versões antigas do site: "Senhas específicas de app").
3. Crie uma senha com um nome como "Quill" e copie (formato `xxxx-xxxx-xxxx-xxxx`).
4. No Quill, preencha o e-mail do iCloud e cole a senha de app.
5. O Quill testa a entrada (recebimento e envio) e só então guarda a senha nas Chaves do Mac.

A mesma senha de app serve para os e-mails, a agenda e os contatos do iCloud.

### Outro e-mail (qualquer provedor com IMAP)

1. Escolha **Outro e-mail**.
2. Digite o e-mail e a senha. Se o provedor usa verificação em duas etapas, gere uma senha de app no site dele.
3. O Quill tenta adivinhar os servidores de entrada (IMAP) e saída (SMTP) enquanto você digita o e-mail. Se o
   provedor informar outros, ajuste em **Configurações avançadas**.
4. O Quill testa os dois e guarda a senha nas Chaves do Mac.

Contas "Outro e-mail" não têm agenda no Quill por enquanto.

### Microsoft (Outlook, Hotmail, Microsoft 365)

**Ainda não funciona.** O botão aparece, mas avisa que a Microsoft vem depois: falta registrar o app no portal da
Microsoft (em 2026-11-17 o Gabriel não conseguiu entrar no portal). Ver
[ADR-015](02-decisoes-adrs/ADR-015-icloud-e-imap-com-senha-de-app-microsoft-depois.md).

## Sair e entrar de novo

- **Sair de tudo:** menu do avatar → **Sair** → confirmar. Todas as contas são desconectadas deste Mac (os tokens e
  senhas saem das Chaves). Nada é apagado no Google nem no iCloud. Você continua no app, sem voltar ao onboarding.
- **Tirar só uma conta:** **Ajustes → Contas →** escolha a conta → **Desconectar**.
- **Entrar de novo:** conecte a conta como da primeira vez (menu do avatar ou **Ajustes → Contas → Adicionar conta**).
- **Recomeçar do zero:** **Ajustes → Privacidade → Apagar dados**. Limpa as preferências do Quill neste Mac (tema,
  assinaturas, foto, escolhas). As contas continuam conectadas.

## Atalhos

| Atalho | O que faz |
|---|---|
| ⌘K | Busca geral: e-mails, eventos, telas e comandos |
| ⌘, | Abre os Ajustes |
| ⌘N | Escrever um e-mail |
| ⌘R | Atualizar os e-mails |
| C | Escrever um e-mail (fora de campo de texto) |
| / | Abre a busca geral (fora de campo de texto) |
| G e depois E | Vai para a caixa de entrada |
| G e depois C | Vai para o Calendário |
| Esc | Fecha janelinhas e menus |

A busca do topo da caixa de entrada também abre a busca geral.

## O Google desconectou

**Por quê:** o app do Google do Quill está em modo **"Testando"**. Nesse modo o Google derruba o acesso a cada
**7 dias**, e é preciso entrar de novo. Isso é do Google, não um defeito do Quill.

**Como você percebe:** o sino do cabeçalho mostra a conta que precisa entrar de novo, e a caixa de entrada mostra o
aviso "… precisa entrar de novo. Abra Ajustes → Contas".

**O que fazer:**
1. Abra **Ajustes → Contas** (ou clique no aviso do sino).
2. Entre de novo com a mesma conta Google, como na primeira vez.
3. Os e-mails voltam a atualizar. Nada se perde: tudo continua no Gmail.

**Para acabar com isso de vez:** publicar o app do Google (sair do modo "Testando"). Faltam a página inicial e a
política de privacidade na aba Branding do Google Cloud. Está nas pendências da [visão geral](00-visao-geral.md).

## Pedir uma montagem nova do app

O app **não é remontado a cada mudança** (pedido do Gabriel, para economizar). As mudanças são conferidas na prévia do
navegador. Quando quiser uma versão nova no Mac, peça ao agente algo como:

> "Monte o Quill no Mac com as últimas mudanças."

O agente no Mac faz:
1. Baixa as mudanças do GitHub (`git pull` em `/Users/gabrielvianna/Projetos/quill`).
2. Instala as dependências (`npm install`).
3. Monta com as credenciais do Google vindas do Infisical:
   `infisical run --env=prod -- npm run tauri build`.
4. Avisa onde ficou o `Quill.app` para você arrastar para Aplicativos.

Prints do app no Mac são só da janela do Quill, nunca da tela inteira, porque a tela mostra seus e-mails.

## Erros comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| "O login com Google ainda não foi configurado nesta versão do Quill" | O app foi montado sem as credenciais do Google | Montar de novo com `infisical run --env=prod -- npm run tauri build` |
| Conta Google pede para entrar de novo | Modo "Testando" do Google (7 dias) | Entrar de novo em Ajustes → Contas |
| iCloud recusa a senha | Usou a senha do Apple ID, ou a senha de app foi revogada | Criar outra senha de app em appleid.apple.com |
| Imagens do e-mail não aparecem | Imagens externas bloqueadas por privacidade | Botão **Mostrar imagens** no e-mail, ou desligar em Ajustes → Privacidade |
| Fotos dos remetentes não aparecem | Opção desligada, ou o remetente não tem Gravatar nem ícone de site | Ajustes → Privacidade → Fotos e logos dos remetentes |
| Touch ID não aparece ao abrir | Opção desligada, ou o Mac não tem Touch ID nem senha configurada | Ajustes → Privacidade → Abrir o app com Touch ID |
| Calendário sem a agenda de uma conta "Outro e-mail" | Contas IMAP genéricas não têm agenda no Quill | Usar Google ou iCloud para agenda |
