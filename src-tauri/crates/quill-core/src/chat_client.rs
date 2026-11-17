//! Google Chat com cache na memória: quem é a própria conta, as pessoas (nome e foto pela People API),
//! os membros de cada conversa e a última mensagem de cada uma. A lógica de leitura fica em `chat.rs`
//! e a rede em `google.rs`. Só existe com o recurso `net`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::chat::{AttachmentRef, ChatMention, ChatMessage, ChatPage, ChatPerson, ChatPreview, ChatQuote, ChatSpace, RawMessage, SpaceKind};
use crate::google::{GoogleClient, LoginError, Progress};

/// Até quantas conversas a lista mostra (as mais recentes).
const MAX_SPACES: usize = 60;
/// Até quantas conversas ganham prévia da última mensagem.
const MAX_PREVIEWS: usize = 40;
/// Quantas fotos o ícone de um espaço ou grupo empilha.
const FACES: usize = 3;
/// Mensagens lidas por conversa para a prévia e o contador de não lidas.
const PREVIEW_PAGE: u32 = 10;
/// Quanto esperar antes de perguntar de novo por uma pessoa que a People API não achou.
const MISS_RETRY: Duration = Duration::from_secs(10 * 60);

pub struct ChatService {
    client: GoogleClient,
    /// `users/<id>` → pessoa (os ids são os mesmos em todas as contas)
    people: Mutex<HashMap<String, ChatPerson>>,
    /// pessoas que a People API não achou, e quando
    misses: Mutex<HashMap<String, Instant>>,
    /// conta → o próprio `users/<id>`
    me: Mutex<HashMap<String, String>>,
    /// conversa → pessoas
    members: Mutex<HashMap<String, Vec<String>>>,
    /// conversa → (atividade quando a prévia foi buscada, últimas mensagens, mais nova primeiro)
    previews: Mutex<HashMap<String, (i64, Vec<RawMessage>)>>,
}

/// Pessoas citadas numa mensagem: quem enviou, quem escreveu a citada e quem foi mencionado.
fn people_in(m: &RawMessage) -> Vec<String> {
    let mut ids = vec![m.sender_id.clone()];
    ids.extend(m.quoted.as_ref().and_then(|q| q.sender_id.clone()));
    ids.extend(m.mention_ids.iter().cloned());
    ids
}

fn first_name(name: &str) -> String {
    name.split_whitespace().next().unwrap_or(name).to_string()
}

impl ChatService {
    pub fn new(client: GoogleClient) -> Self {
        Self {
            client,
            people: Mutex::default(),
            misses: Mutex::default(),
            me: Mutex::default(),
            members: Mutex::default(),
            previews: Mutex::default(),
        }
    }

    /// O próprio id da conta no Chat (guardado depois da primeira vez). Sem ele, nada aparece como "minha".
    async fn me(&self, account: &str, token: &str) -> Option<String> {
        let key = account.to_lowercase();
        if let Some(id) = self.me.lock().expect("trava").get(&key) {
            return Some(id.clone());
        }
        let id = self.client.people_me(token).await.ok()?;
        self.me.lock().expect("trava").insert(key, id.clone());
        Some(id)
    }

    /// Busca na People API quem ainda não está no cache. Falha aqui não impede de mostrar as mensagens.
    async fn resolve(&self, token: &str, ids: impl IntoIterator<Item = String>) {
        let now = Instant::now();
        let mut want: Vec<String> = {
            let people = self.people.lock().expect("trava");
            let misses = self.misses.lock().expect("trava");
            ids.into_iter()
                .filter(|id| !people.contains_key(id))
                .filter(|id| misses.get(id).is_none_or(|t| now.duration_since(*t) > MISS_RETRY))
                .filter(|id| crate::chat::people_resource(id).is_some())
                .collect()
        };
        want.sort();
        want.dedup();
        if want.is_empty() {
            return;
        }
        let Ok(found) = self.client.people_batch(token, &want).await else { return };
        let mut people = self.people.lock().expect("trava");
        let mut misses = self.misses.lock().expect("trava");
        for p in found {
            misses.remove(&p.id);
            people.insert(p.id.clone(), p);
        }
        for id in want {
            if !people.contains_key(&id) {
                misses.insert(id, now);
            }
        }
    }

    /// Pessoa do cache ou um nome de reserva (apps usam o nome que a API manda).
    fn person(&self, id: &str, display_name: Option<&str>, bot: bool) -> ChatPerson {
        if let Some(p) = self.people.lock().expect("trava").get(id) {
            return p.clone();
        }
        ChatPerson {
            id: id.to_string(),
            name: display_name.map(str::to_string).unwrap_or_else(|| if bot { "App".into() } else { "Sem nome".into() }),
            photo: None,
            email: None,
            bot,
        }
    }

    fn message(&self, m: RawMessage, me: Option<&str>) -> ChatMessage {
        let sender = self.person(&m.sender_id, m.sender_display_name.as_deref(), m.sender_bot);
        let quoted = m.quoted.map(|q| ChatQuote {
            sender: q.sender_id.as_deref().map(|id| self.person(id, None, false)),
            name: q.name,
            text: q.text,
        });
        let mentions = {
            let people = self.people.lock().expect("trava");
            m.mention_ids.into_iter().map(|id| ChatMention { name: people.get(&id).map(|p| p.name.clone()), id }).collect()
        };
        ChatMessage {
            quoted,
            mentions,
            custom_emojis: m.custom_emojis,
            mine: me.is_some_and(|me| me == m.sender_id),
            sender,
            name: m.name,
            text: m.text,
            formatted_text: m.formatted_text,
            create_time: m.create_time,
            create_ms: m.create_ms,
            update_time: m.update_time,
            thread: m.thread,
            thread_reply: m.thread_reply,
            attachments: m.attachments,
            deleted: m.deleted,
            reactions: m.reactions,
            edited: m.edited,
        }
    }

    /// Conversas mais recentes, com o nome (e a foto, nas diretas) e a prévia da última mensagem.
    /// Membros e prévias só são buscados de novo quando a conversa teve atividade nova.
    pub async fn spaces(&self, account: &str, token: &str) -> Result<Vec<ChatSpace>, LoginError> {
        let mut raw = self.client.chat_spaces(token).await?;
        raw.truncate(MAX_SPACES);
        let me = self.me(account, token).await;

        let need_members: Vec<String> = {
            let members = self.members.lock().expect("trava");
            // todas as conversas: as diretas e os grupos sem nome precisam do nome, e os espaços das fotos
            raw.iter()
                .filter(|s| !members.contains_key(&s.name))
                .map(|s| s.name.clone())
                .collect()
        };
        let need_preview: Vec<(String, i64)> = {
            let previews = self.previews.lock().expect("trava");
            raw.iter()
                .take(MAX_PREVIEWS)
                .filter(|s| previews.get(&s.name).is_none_or(|(at, _)| *at != s.last_active_ms))
                .map(|s| (s.name.clone(), s.last_active_ms))
                .collect()
        };

        // membros e prévias em paralelo, 10 pedidos por vez
        for chunk in need_members.chunks(10) {
            let mut set = tokio::task::JoinSet::new();
            for space in chunk {
                let (c, t, space) = (self.client.clone(), token.to_string(), space.clone());
                set.spawn(async move { (space.clone(), c.chat_members(&t, &space).await) });
            }
            while let Some(Ok((space, got))) = set.join_next().await {
                if let Ok(list) = got {
                    self.members.lock().expect("trava").insert(space, list);
                }
            }
        }
        for chunk in need_preview.chunks(10) {
            let mut set = tokio::task::JoinSet::new();
            for (space, at) in chunk {
                let (c, t, space, at) = (self.client.clone(), token.to_string(), space.clone(), *at);
                set.spawn(async move { (space.clone(), at, c.chat_messages(&t, &space, None, PREVIEW_PAGE).await) });
            }
            while let Some(Ok((space, at, got))) = set.join_next().await {
                if let Ok((list, _)) = got {
                    self.previews.lock().expect("trava").insert(space, (at, list));
                }
            }
        }

        let ids: Vec<String> = {
            let members = self.members.lock().expect("trava");
            let previews = self.previews.lock().expect("trava");
            raw.iter()
                .flat_map(|s| {
                    // só as primeiras pessoas de cada conversa (nome do grupo e fotos empilhadas)
                    let mut v: Vec<String> = members.get(&s.name).map(|l| l.iter().take(FACES + 2).cloned().collect()).unwrap_or_default();
                    if let Some(m) = previews.get(&s.name).and_then(|(_, l)| l.first()) {
                        v.push(m.sender_id.clone());
                    }
                    v
                })
                .collect()
        };
        self.resolve(token, ids).await;

        let members = self.members.lock().expect("trava").clone();
        let previews = self.previews.lock().expect("trava").clone();
        Ok(raw
            .into_iter()
            .map(|s| {
                let others: Vec<ChatPerson> = members
                    .get(&s.name)
                    .map(|list| {
                        list.iter().take(FACES + 2).filter(|id| me.as_deref() != Some(id.as_str())).map(|id| self.person(id, None, false)).collect()
                    })
                    .unwrap_or_default();
                let (title, photo, email) = match s.kind {
                    SpaceKind::Dm => match others.first() {
                        Some(p) => (p.name.clone(), p.photo.clone(), p.email.clone()),
                        None => ("Conversa direta".to_string(), None, None),
                    },
                    _ if !s.display_name.trim().is_empty() => (s.display_name.clone(), None, None),
                    SpaceKind::Group => {
                        let total = members.get(&s.name).map(|l| l.iter().filter(|id| me.as_deref() != Some(id.as_str())).count()).unwrap_or(0);
                        (crate::chat::group_title_of(&others.iter().map(|p| p.name.clone()).collect::<Vec<_>>(), total), None, None)
                    }
                    SpaceKind::Space => ("Espaço sem nome".to_string(), None, None),
                };
                let recent = previews.get(&s.name).map(|(_, l)| l.as_slice()).unwrap_or_default();
                let recent_ms =
                    recent.iter().filter(|m| !m.deleted && me.as_deref() != Some(m.sender_id.as_str())).map(|m| m.create_ms).collect();
                let last_message = recent.first().map(|m| {
                    let mine = me.as_deref() == Some(m.sender_id.as_str());
                    ChatPreview {
                        text: crate::chat::preview_text(m),
                        sender_name: (!mine && s.kind != SpaceKind::Dm)
                            .then(|| first_name(&self.person(&m.sender_id, m.sender_display_name.as_deref(), m.sender_bot).name)),
                        mine,
                        create_ms: m.create_ms,
                    }
                });
                ChatSpace {
                    name: s.name,
                    kind: s.kind,
                    title,
                    photo,
                    email,
                    last_active_time: s.last_active_time,
                    last_active_ms: s.last_active_ms,
                    last_message,
                    recent_ms,
                    faces: others.iter().take(FACES).cloned().collect(),
                    member_count: s.member_count,
                    uri: s.uri,
                }
            })
            .collect())
    }

    /// Pessoas de uma conversa (com nome e foto); a própria conta vem por último, como "Você".
    pub async fn members(&self, account: &str, token: &str, space: &str) -> Result<Vec<ChatPerson>, LoginError> {
        let cached = self.members.lock().expect("trava").get(space).cloned();
        let ids = match cached {
            Some(ids) => ids,
            None => {
                let ids = self.client.chat_members(token, space).await?;
                self.members.lock().expect("trava").insert(space.to_string(), ids.clone());
                ids
            }
        };
        let me = self.me(account, token).await;
        self.resolve(token, ids.iter().filter(|id| me.as_deref() != Some(id.as_str())).cloned()).await;
        let (mine, others): (Vec<&String>, Vec<&String>) = ids.iter().partition(|id| me.as_deref() == Some(id.as_str()));
        let mut out: Vec<ChatPerson> = others.into_iter().map(|id| self.person(id, None, false)).collect();
        out.extend(mine.into_iter().map(|id| ChatPerson { id: id.clone(), name: "Você".into(), photo: None, email: Some(account.to_string()), bot: false }));
        Ok(out)
    }

    /// Uma página de mensagens, da mais antiga para a mais nova, com nome e foto de quem enviou.
    pub async fn messages(&self, account: &str, token: &str, space: &str, page_token: Option<&str>) -> Result<ChatPage, LoginError> {
        let (mut raw, next) = self.client.chat_messages(token, space, page_token, crate::chat::PAGE_SIZE).await?;
        raw.reverse();
        let me = self.me(account, token).await;
        self.resolve(token, raw.iter().flat_map(people_in)).await;
        Ok(ChatPage { messages: raw.into_iter().map(|m| self.message(m, me.as_deref())).collect(), next_page_token: next })
    }

    /// Envia (texto e/ou anexos já enviados) e devolve a mensagem como ficou no Chat.
    pub async fn send(
        &self,
        account: &str,
        token: &str,
        space: &str,
        text: &str,
        thread: Option<&str>,
        attachments: &[AttachmentRef],
        quote: Option<&crate::chat::QuoteRef>,
    ) -> Result<ChatMessage, LoginError> {
        let raw = self.client.chat_send(token, space, text, thread, attachments, quote).await?;
        let me = self.me(account, token).await;
        self.resolve(token, people_in(&raw)).await;
        let mut m = self.message(raw, me.as_deref());
        // a mensagem acabou de sair desta conta, mesmo que o próprio id não tenha vindo
        m.mine = true;
        Ok(m)
    }

    /// A prévia da conversa desta mensagem será buscada de novo na próxima lista (a mensagem mudou ou sumiu).
    fn forget_preview(&self, message: &str) {
        if let Some(space) = crate::chat::space_of_message(message) {
            self.previews.lock().expect("trava").remove(&space);
        }
    }

    /// Reage com um emoji. `false` quando a conta já tinha reagido com ele.
    pub async fn react(&self, token: &str, message: &str, emoji: &str) -> Result<bool, LoginError> {
        self.client.chat_react(token, message, emoji).await
    }

    /// Tira a reação da própria conta com aquele emoji (procura o nome dela com `reactions.list`).
    /// Se não houver reação, não faz nada.
    pub async fn unreact(&self, account: &str, token: &str, message: &str, emoji: &str) -> Result<(), LoginError> {
        let me = self.me(account, token).await.ok_or_else(|| LoginError::Google("não consegui saber qual é a sua conta no Chat".into()))?;
        let found = self.client.chat_reactions(token, message, &me, emoji).await?;
        // o filtro já vem do Google, mas a conferência aqui garante que nunca sai a reação de outra pessoa
        for r in found.iter().filter(|r| r.user_id == me && r.emoji.as_deref() == Some(emoji) && r.name.starts_with(&format!("{message}/reactions/"))) {
            self.client.chat_delete_reaction(token, &r.name).await?;
        }
        Ok(())
    }

    /// Troca o texto de uma mensagem da própria conta e devolve como ficou.
    pub async fn edit(&self, account: &str, token: &str, message: &str, text: &str) -> Result<ChatMessage, LoginError> {
        let raw = self.client.chat_edit(token, message, text).await?;
        self.forget_preview(message);
        let me = self.me(account, token).await;
        self.resolve(token, people_in(&raw)).await;
        let mut m = self.message(raw, me.as_deref());
        m.mine = true;
        Ok(m)
    }

    /// Apaga uma mensagem da própria conta.
    pub async fn delete(&self, token: &str, message: &str) -> Result<(), LoginError> {
        self.client.chat_delete(token, message).await?;
        self.forget_preview(message);
        Ok(())
    }

    /// Conteúdo de um anexo, até `max` bytes.
    pub async fn media(&self, token: &str, resource: &str, max: u64) -> Result<Vec<u8>, LoginError> {
        self.client.chat_media(token, resource, max).await
    }

    /// Envia um arquivo para a conversa; a referência devolvida vai em `send`.
    pub async fn upload(
        &self,
        token: &str,
        space: &str,
        filename: &str,
        content_type: &str,
        bytes: Vec<u8>,
        progress: Progress,
    ) -> Result<AttachmentRef, LoginError> {
        self.client.chat_upload(token, space, filename, content_type, bytes, progress).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Servidor falso que responde pelo caminho (o prefixo mais longo que casar) e anota cada pedido.
    /// Atende vários pedidos ao mesmo tempo, porque o serviço busca membros e prévias em paralelo.
    async fn fake_router(routes: Vec<(&'static str, &'static str)>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = listener.accept().await else { break };
                let routes = routes.clone();
                let log = log.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 65536];
                    let n = s.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let line = req.lines().next().unwrap_or("").to_string();
                    let path = line.split(' ').nth(1).unwrap_or("").to_string();
                    log.lock().unwrap().push(line);
                    let body = routes
                        .iter()
                        .filter(|(p, _)| path.starts_with(p))
                        .max_by_key(|(p, _)| p.len())
                        .map(|(_, b)| *b)
                        .unwrap_or(r#"{"error":{"code":404,"message":"sem rota"}}"#);
                    let status = if body.contains(r#""error""#) { "404 Not Found" } else { "200 OK" };
                    let resp = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = s.write_all(resp.as_bytes()).await;
                    let _ = s.shutdown().await;
                });
            }
        });
        (base, seen)
    }

    fn service(base: &str) -> ChatService {
        ChatService::new(GoogleClient::with_endpoints("id", "secret", &format!("{base}/token"), &format!("{base}/x")))
    }

    const SPACES: &str = r#"{"spaces":[
      {"name":"spaces/A","spaceType":"SPACE","displayName":"Produto","lastActiveTime":"2026-11-17T10:00:00Z","membershipCount":{"joinedDirectHumanUserCount":3}},
      {"name":"spaces/B","spaceType":"DIRECT_MESSAGE","lastActiveTime":"2026-11-17T12:00:00Z"},
      {"name":"spaces/C","spaceType":"GROUP_CHAT","lastActiveTime":"2026-11-17T11:00:00Z"}
    ]}"#;

    fn routes() -> Vec<(&'static str, &'static str)> {
        vec![
            ("/x/chat/spaces?", SPACES),
            ("/x/chat/spaces/B/members", r#"{"memberships":[{"member":{"name":"users/1","type":"HUMAN"}},{"member":{"name":"users/2","type":"HUMAN"}}]}"#),
            (
                "/x/chat/spaces/C/members",
                r#"{"memberships":[{"member":{"name":"users/1","type":"HUMAN"}},{"member":{"name":"users/2","type":"HUMAN"}},{"member":{"name":"users/3","type":"HUMAN"}}]}"#,
            ),
            (
                "/x/chat/spaces/A/members",
                r#"{"memberships":[{"member":{"name":"users/1","type":"HUMAN"}},{"member":{"name":"users/3","type":"HUMAN"}},{"member":{"name":"users/2","type":"HUMAN"}}]}"#,
            ),
            ("/x/chat/spaces/A/messages", r#"{"messages":[{"name":"spaces/A/messages/1","sender":{"name":"users/3"},"createTime":"2026-11-17T10:00:00Z","text":"Bom dia, time"}]}"#),
            ("/x/chat/spaces/B/messages", r#"{"messages":[{"name":"spaces/B/messages/2","sender":{"name":"users/1"},"createTime":"2026-11-17T12:00:00Z","text":"Combinado"},
               {"name":"spaces/B/messages/1","sender":{"name":"users/2"},"createTime":"2026-11-17T11:59:00Z","text":"Pode ser às 15h?","thread":{"name":"spaces/B/threads/T"}}],"nextPageToken":"older"}"#),
            ("/x/chat/spaces/D/messages", r#"{"messages":[{"name":"spaces/D/messages/2","sender":{"name":"users/1"},"createTime":"2026-11-17T12:00:00Z","text":"concordo @Bia","formattedText":"concordo <users/3>",
               "annotations":[{"type":"USER_MENTION","userMention":{"user":{"name":"users/3"}}},{"type":"USER_MENTION","userMention":{"user":{"name":"users/404"}}}],
               "quotedMessageMetadata":{"name":"spaces/D/messages/1","quotedMessageSnapshot":{"sender":"users/2","text":"Vamos fechar sexta?"}}}]}"#),
            ("/x/chat/spaces/C/messages", r#"{"messages":[{"name":"spaces/C/messages/1","sender":{"name":"users/2"},"createTime":"2026-11-17T11:00:00Z","attachment":[{"contentName":"plano.pdf"}]}]}"#),
            ("/x/people/people/me", r#"{"resourceName":"people/1"}"#),
            (
                "/x/people/people:batchGet",
                r#"{"responses":[
                  {"person":{"resourceName":"people/2","names":[{"displayName":"Ana Lima"}],"photos":[{"url":"https://lh3/ana"}],"emailAddresses":[{"value":"ana@empresa.com"}]}},
                  {"person":{"resourceName":"people/3","names":[{"displayName":"Bia Souza"}]}}
                ]}"#,
            ),
        ]
    }

    #[tokio::test]
    async fn conversas_com_nomes_fotos_e_previas() {
        let (base, _seen) = fake_router(routes()).await;
        let list = service(&base).spaces("eu@empresa.com", "ya29").await.unwrap();
        assert_eq!(list.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["spaces/B", "spaces/C", "spaces/A"]);

        let dm = &list[0];
        assert_eq!(dm.title, "Ana Lima");
        assert_eq!(dm.photo.as_deref(), Some("https://lh3/ana"));
        assert_eq!(dm.email.as_deref(), Some("ana@empresa.com"));
        let p = dm.last_message.as_ref().unwrap();
        assert!(p.mine);
        assert_eq!(p.text, "Combinado");
        // horários das últimas mensagens dos outros (para contar as não lidas)
        assert_eq!(dm.recent_ms, [1_794_916_740_000]);

        let group = &list[1];
        assert_eq!(group.title, "Ana Lima e Bia Souza");
        let p = group.last_message.as_ref().unwrap();
        assert_eq!(p.text, "Anexo: plano.pdf");
        assert_eq!(p.sender_name.as_deref(), Some("Ana"));

        let space = &list[2];
        assert_eq!(space.title, "Produto");
        assert_eq!(space.recent_ms, [1_794_909_600_000]);
        // espaços não têm ícone na API: a tela empilha as fotos das pessoas (sem a própria conta)
        assert_eq!(space.faces.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Bia Souza", "Ana Lima"]);
        assert_eq!(space.member_count, Some(3));
        assert_eq!(group.faces.len(), 2);
        assert_eq!(dm.faces.len(), 1);
        assert_eq!(space.last_message.as_ref().unwrap().sender_name.as_deref(), Some("Bia"));
    }

    #[tokio::test]
    async fn segunda_busca_usa_o_cache() {
        let (base, seen) = fake_router(routes()).await;
        let svc = service(&base);
        svc.spaces("eu@empresa.com", "ya29").await.unwrap();
        let first = seen.lock().unwrap().len();
        svc.spaces("eu@empresa.com", "ya29").await.unwrap();
        let reqs = seen.lock().unwrap();
        assert_eq!(reqs.len(), first + 1, "só a lista de conversas é pedida de novo: {:?}", &reqs[first..]);
        assert!(reqs[first].starts_with("GET /x/chat/spaces?"));
    }

    #[tokio::test]
    async fn pessoas_da_conversa_com_nome_e_a_propria_conta_por_ultimo() {
        let (base, seen) = fake_router(routes()).await;
        let svc = service(&base);
        let people = svc.members("eu@empresa.com", "ya29", "spaces/C").await.unwrap();
        assert_eq!(people.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Ana Lima", "Bia Souza", "Você"]);
        let n = seen.lock().unwrap().len();
        svc.members("eu@empresa.com", "ya29", "spaces/C").await.unwrap();
        assert_eq!(seen.lock().unwrap().len(), n, "a segunda vez vem do cache");
    }

    #[tokio::test]
    async fn mensagens_da_mais_antiga_para_a_mais_nova_com_nome_e_minhas() {
        let (base, _seen) = fake_router(routes()).await;
        let page = service(&base).messages("eu@empresa.com", "ya29", "spaces/B", None).await.unwrap();
        assert_eq!(page.next_page_token.as_deref(), Some("older"));
        assert_eq!(page.messages.len(), 2);
        assert_eq!(page.messages[0].text, "Pode ser às 15h?");
        assert_eq!(page.messages[0].sender.name, "Ana Lima");
        assert!(!page.messages[0].mine);
        assert_eq!(page.messages[0].thread.as_deref(), Some("spaces/B/threads/T"));
        assert!(page.messages[1].mine);
    }

    #[tokio::test]
    async fn citacao_e_mencoes_com_o_nome_das_pessoas() {
        let (base, _seen) = fake_router(routes()).await;
        let page = service(&base).messages("eu@empresa.com", "ya29", "spaces/D", None).await.unwrap();
        let m = &page.messages[0];
        let q = m.quoted.as_ref().expect("citação");
        assert_eq!(q.name, "spaces/D/messages/1");
        assert_eq!(q.sender.as_ref().map(|p| p.name.as_str()), Some("Ana Lima"));
        assert_eq!(q.text, "Vamos fechar sexta?");
        assert_eq!(
            m.mentions,
            [
                ChatMention { id: "users/3".into(), name: Some("Bia Souza".into()) },
                ChatMention { id: "users/404".into(), name: None },
            ]
        );
    }

    #[tokio::test]
    async fn pessoa_desconhecida_e_app_tem_nome_de_reserva() {
        let (base, _seen) = fake_router(vec![
            ("/x/chat/spaces/Z/messages", r#"{"messages":[
               {"name":"spaces/Z/messages/2","sender":{"name":"users/app","type":"BOT","displayName":"Lembretes"},"createTime":"2026-11-17T12:00:00Z","text":"oi"},
               {"name":"spaces/Z/messages/1","sender":{"name":"users/9"},"createTime":"2026-11-17T11:00:00Z","text":"olá"}]}"#),
            ("/x/people/people/me", r#"{"resourceName":"people/1"}"#),
            ("/x/people/people:batchGet", r#"{"responses":[]}"#),
        ])
        .await;
        let page = service(&base).messages("eu@empresa.com", "ya29", "spaces/Z", None).await.unwrap();
        assert_eq!(page.messages[0].sender.name, "Sem nome");
        assert_eq!(page.messages[1].sender.name, "Lembretes");
        assert!(page.messages[1].sender.bot);
    }

    #[tokio::test]
    async fn envio_volta_como_minha() {
        let (base, _seen) = fake_router(vec![
            ("/x/chat/spaces/B/messages", r#"{"name":"spaces/B/messages/9","sender":{"name":"users/1"},"createTime":"2026-11-17T12:30:00Z","text":"Fechado"}"#),
            ("/x/people/people/me", r#"{"resourceName":"people/1"}"#),
            ("/x/people/people:batchGet", r#"{"responses":[{"person":{"resourceName":"people/1","names":[{"displayName":"Gabriel"}]}}]}"#),
        ])
        .await;
        let m = service(&base).send("eu@empresa.com", "ya29", "spaces/B", "Fechado", None, &[], None).await.unwrap();
        assert!(m.mine);
        assert_eq!(m.text, "Fechado");
        assert_eq!(m.create_ms, 1_794_918_600_000);
    }

    #[tokio::test]
    async fn reagir_e_tirar_so_a_propria_reacao() {
        let (base, seen) = fake_router(vec![
            ("/x/people/people/me", r#"{"resourceName":"people/42"}"#),
            ("/x/chat/spaces/B/messages/1/reactions", r#"{"name":"spaces/B/messages/1/reactions/R7","emoji":{"unicode":"❤️"}}"#),
            (
                "/x/chat/spaces/B/messages/1/reactions?",
                r#"{"reactions":[
                  {"name":"spaces/B/messages/1/reactions/R8","user":{"name":"users/9"},"emoji":{"unicode":"❤️"}},
                  {"name":"spaces/B/messages/1/reactions/R7","user":{"name":"users/42"},"emoji":{"unicode":"❤️"}}]}"#,
            ),
            ("/x/chat/spaces/B/messages/1/reactions/", "{}"),
        ])
        .await;
        let svc = service(&base);
        assert!(svc.react("ya29", "spaces/B/messages/1", "❤️").await.unwrap());
        svc.unreact("eu@empresa.com", "ya29", "spaces/B/messages/1", "❤️").await.unwrap();
        let reqs = seen.lock().unwrap().clone();
        assert!(reqs[0].starts_with("POST /x/chat/spaces/B/messages/1/reactions "));
        assert!(reqs.iter().any(|r| r.starts_with("GET /x/chat/spaces/B/messages/1/reactions?filter=") && r.contains("users%2F42")));
        let deletes: Vec<_> = reqs.iter().filter(|r| r.starts_with("DELETE")).collect();
        assert_eq!(deletes.len(), 1, "{reqs:?}");
        assert!(deletes[0].starts_with("DELETE /x/chat/spaces/B/messages/1/reactions/R7 "), "nunca tira a reação de outra pessoa");
    }

    #[tokio::test]
    async fn editar_volta_como_minha_e_editada() {
        let (base, seen) = fake_router(vec![
            ("/x/people/people/me", r#"{"resourceName":"people/1"}"#),
            ("/x/people/people:batchGet", r#"{"responses":[]}"#),
            (
                "/x/chat/spaces/B/messages/2",
                r#"{"name":"spaces/B/messages/2","sender":{"name":"users/1"},"createTime":"2026-11-17T12:00:00Z","lastUpdateTime":"2026-11-17T12:02:00Z","text":"Combinado às 16h"}"#,
            ),
        ])
        .await;
        let m = service(&base).edit("eu@empresa.com", "ya29", "spaces/B/messages/2", "Combinado às 16h").await.unwrap();
        assert!(m.mine);
        assert!(m.edited);
        assert_eq!(m.text, "Combinado às 16h");
        assert!(seen.lock().unwrap().iter().any(|r| r.starts_with("PATCH /x/chat/spaces/B/messages/2?updateMask=text ")));
    }

    #[tokio::test]
    async fn apagar_ou_editar_refaz_a_previa_da_lista() {
        let mut r = routes();
        r.push(("/x/chat/spaces/B/messages/2", "{}"));
        let (base, seen) = fake_router(r).await;
        let svc = service(&base);
        svc.spaces("eu@empresa.com", "ya29").await.unwrap();
        svc.delete("ya29", "spaces/B/messages/2").await.unwrap();
        let n = seen.lock().unwrap().len();
        svc.spaces("eu@empresa.com", "ya29").await.unwrap();
        let reqs = seen.lock().unwrap();
        assert!(reqs[n - 1].starts_with("DELETE /x/chat/spaces/B/messages/2 "));
        assert!(reqs[n..].iter().any(|r| r.starts_with("GET /x/chat/spaces/B/messages?")), "a prévia da conversa é buscada de novo: {:?}", &reqs[n..]);
        assert!(!reqs[n..].iter().any(|r| r.starts_with("GET /x/chat/spaces/A/messages?")), "as outras continuam do cache");
    }

    /// O Tauri roda os comandos em outra linha: os pedidos do Chat precisam poder mudar de linha (Send).
    #[test]
    fn pedidos_podem_rodar_em_outra_linha() {
        fn send<T: Send>(_: &T) {}
        let svc = service("http://127.0.0.1:9");
        send(&svc.spaces("a", "t"));
        send(&svc.messages("a", "t", "spaces/B", None));
        send(&svc.members("a", "t", "spaces/B"));
        send(&svc.send("a", "t", "spaces/B", "oi", None, &[], None));
        send(&svc.media("t", "abc", 10));
        send(&svc.react("t", "spaces/B/messages/1", "👍"));
        send(&svc.unreact("a", "t", "spaces/B/messages/1", "👍"));
        send(&svc.edit("a", "t", "spaces/B/messages/1", "oi"));
        send(&svc.delete("t", "spaces/B/messages/1"));
        send(&svc.upload("t", "spaces/B", "a.txt", "text/plain", vec![1], std::sync::Arc::new(|_, _| {})));
    }
}
