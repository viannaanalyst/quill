---
type: adr
tags: [quill, adr, seguranca, segredos, keyring, chaves, macos, assinatura]
updated: 2026-11-17
---

# ADR-024: Cofre único nas Chaves, lido uma vez por abertura

**Status:** Aceito (2026-11-17). Muda a parte das Chaves do
[ADR-004](ADR-004-credenciais-no-infisical-e-segredos-nas-chaves.md); o resto dele continua valendo.

**Contexto**
- No Mac, toda vez que o Quill abria, o macOS pedia a senha das Chaves várias vezes ("Quill deseja usar as informações
  confidenciais armazenadas em app.quill.desktop.google").
- Havia **um item nas Chaves por conta**: serviço `app.quill.desktop.google` (token de renovação do Google) ou
  `app.quill.desktop.imap` (senha de app do iCloud/IMAP), com o e-mail como conta. Cada item pede autorização separada.
- O app é montado **sem assinatura fixa** (ad-hoc). Para o macOS, cada montagem é um app novo, e o "Permitir Sempre"
  dado à versão anterior não vale para a nova. Então, a cada versão, voltava uma pergunta por conta.

**Decisão**
- **Um só item nas Chaves** para todos os segredos: serviço `app.quill.desktop`, conta `cofre`. O valor é um JSON
  `{ "google": { "<email>": "<token>" }, "imap": { "<email>": "<senha>" } }`, com os e-mails em minúsculas.
- O item é **lido uma vez por abertura** e guardado na memória (`Vault`, em `quill-core/src/vault.rs`), com uma trava:
  pedidos ao mesmo tempo esperam a primeira leitura, para o macOS perguntar uma vez só. As sessões do Google e do
  iCloud/IMAP usam o mesmo `Vault`.
- **Grava de novo só quando muda:** login novo, conta removida, token ou senha diferente.
- **Se as Chaves recusarem** (a pessoa clicou em "Negar"), o Quill não pergunta de novo até reabrir e **nunca grava
  por cima** do item que não conseguiu ler. As contas mostram o erro das Chaves. Remover conta continua tirando a conta
  da lista.
- **Migração:** na primeira leitura, se o item único não existir, o Quill lê os itens antigos das contas que estão no
  `accounts.json`, junta no item novo, grava e apaga os antigos. Item antigo que não abrir fica onde está e a conta
  pede login de novo. Itens antigos de contas que já não estão no `accounts.json` não são tocados. Se nada for
  migrado, o item novo só é criado no primeiro login.
- O acesso às Chaves fica atrás da interface `SecretStore`: a versão de verdade (`KeyringStore`, biblioteca `keyring`)
  só existe com a feature `desktop`; os testes usam uma versão na memória.
- **Assinatura estável:** fica documentada no [guia rápido](../guia-rapido.md#parar-de-pedir-a-senha-das-chaves)
  (certificado gratuito "Apple Development" do Xcode em `bundle.macOS.signingIdentity`). O `tauri.conf.json` **não**
  foi mudado: o Gabriel decide.

**Consequências**
- Positivas:
  - uma pergunta por versão nova do app, em vez de uma por conta a cada abertura; com "Permitir Sempre", nenhuma na
    mesma versão;
  - com a assinatura estável, uma última pergunta e depois nenhuma;
  - os segredos continuam só nas Chaves e na memória: nunca em arquivo, log ou mensagem de erro (o `Debug` do cofre
    mostra só os e-mails).
- Negativas:
  - na primeira abertura depois da atualização, o macOS ainda pode perguntar uma vez por conta (itens antigos), e de
    novo para apagar se a pessoa clicar só em "Permitir";
  - quem conseguir abrir o item vê todos os segredos de uma vez (antes, um por conta). No Mac, o acesso é o mesmo:
    só o Quill autorizado;
  - no Windows, o Credential Manager aceita até 2.560 bytes por item (cerca de 1.280 caracteres no `keyring`): cabem
    umas 8 contas Google. Quando o Windows chegar, pode ser preciso dividir o cofre.

**Alternativas consideradas**
- **Continuar com um item por conta:** é o que causava as várias perguntas.
- **Arquivo cifrado com a chave nas Chaves:** também seria uma pergunta só, mas cria um arquivo com segredos no disco e
  mais código de criptografia para manter.
- **Assinar o app agora:** resolve o "volta a cada versão", mas depende de o Gabriel criar o certificado no Xcode;
  fica documentado para ele decidir.
