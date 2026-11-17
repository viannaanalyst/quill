//! Google Chat (só contas Google Workspace): lê as respostas da API do Chat e da People API
//! e monta os pedidos. Só a lógica; a rede fica em `google.rs` e o cache de pessoas em `chat_client.rs`.
//!
//! Com login de usuário, a API do Chat não traz o nome de quem enviou nem das pessoas de uma
//! conversa direta: só o id (`users/<id>`). O nome e a foto vêm da People API (`people/<id>`).

use serde::{Deserialize, Serialize};

pub const CHAT_API: &str = "https://chat.googleapis.com/v1";
/// Envio de arquivos (`attachments:upload`).
pub const CHAT_UPLOAD_API: &str = "https://chat.googleapis.com/upload/v1";

/// Mensagens por página (a API aceita até 1000).
pub const PAGE_SIZE: u32 = 50;

/// Tipo da conversa: espaço com nome, grupo sem nome ou mensagem direta.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SpaceKind {
    Space,
    Group,
    Dm,
}

/// Uma conversa como a API devolve (antes de resolver nomes).
#[derive(Debug, Clone, PartialEq)]
pub struct RawSpace {
    /// `spaces/<id>`
    pub name: String,
    pub kind: SpaceKind,
    pub display_name: String,
    /// RFC 3339
    pub last_active_time: Option<String>,
    pub last_active_ms: i64,
    /// pessoas na conversa (`membershipCount.joinedDirectHumanUserCount`)
    pub member_count: Option<u32>,
    /// link para abrir no Google Chat (`spaceUri`), só se for https do Google
    pub uri: Option<String>,
}

/// Uma pessoa (ou app) do Chat, com nome e foto quando a People API souber.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatPerson {
    /// `users/<id>`
    pub id: String,
    pub name: String,
    pub photo: Option<String>,
    pub email: Option<String>,
    pub bot: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachment {
    pub name: String,
    pub content_type: Option<String>,
    /// arquivo enviado ao Chat: o conteúdo vem por `media.download` com este nome
    pub resource_name: Option<String>,
    /// arquivo do Google Drive: abre no navegador
    pub drive_url: Option<String>,
}

/// Referência de um arquivo já enviado (`attachments:upload`), para pôr na mensagem.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment_upload_token: Option<String>,
}

/// Tamanho máximo de um arquivo enviado ao Chat (limite do Google).
pub const MAX_UPLOAD: usize = 200 * 1024 * 1024;
/// Tamanho máximo de um anexo mostrado dentro do app (miniatura, player, prévia).
pub const MAX_INLINE: u64 = 50 * 1024 * 1024;
/// Tamanho máximo de um anexo baixado para a pasta Downloads.
pub const MAX_DOWNLOAD: u64 = 200 * 1024 * 1024;

/// Reação com emoji numa mensagem: o emoji e quantas pessoas reagiram com ele.
/// A API não diz se a própria conta está entre elas; a tela guarda as reações que fez.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReaction {
    /// o emoji em unicode ou, no emoji próprio da empresa, o nome dele (`:festa:`)
    pub emoji: String,
    pub count: u32,
    /// emoji próprio da empresa: a imagem dele (link temporário do Google)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

/// Emoji próprio da empresa que aparece no texto como `:nome:`, com a imagem dele.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomEmoji {
    /// como aparece no texto, com os dois-pontos (`:festa:`)
    pub name: String,
    /// link temporário da imagem (só endereço https do Google)
    pub url: String,
}

/// Mensagem citada, como a API devolve (`quotedMessageMetadata`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawQuote {
    /// `spaces/<id>/messages/<id>`
    pub name: String,
    /// quem escreveu a citada (`quotedMessageSnapshot.sender`), quando a API manda a cópia
    pub sender_id: Option<String>,
    /// começo do texto da citada (vazio quando a API não manda a cópia)
    pub text: String,
}

/// Mensagem citada, pronta para a tela (o cartão com a barrinha, o nome e o começo do texto).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatQuote {
    pub name: String,
    pub sender: Option<ChatPerson>,
    pub text: String,
}

/// Pessoa mencionada (`<users/<id>>` no texto formatado), com o nome quando a People API souber.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMention {
    pub id: String,
    pub name: Option<String>,
}

/// Uma reação como `reactions.list` devolve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawReaction {
    /// `spaces/<id>/messages/<id>/reactions/<id>`
    pub name: String,
    pub user_id: String,
    /// `None` para emoji próprio da empresa (sem unicode)
    pub emoji: Option<String>,
}

/// Uma mensagem como a API devolve (antes de resolver quem enviou).
#[derive(Debug, Clone, PartialEq)]
pub struct RawMessage {
    /// `spaces/<id>/messages/<id>`
    pub name: String,
    pub sender_id: String,
    pub sender_bot: bool,
    /// só vem para apps (bots); para pessoas, com login de usuário, vem vazio
    pub sender_display_name: Option<String>,
    pub create_time: String,
    pub create_ms: i64,
    /// última mudança (`lastUpdateTime`, ou a criação quando nunca mudou): a API pede para citar
    pub update_time: String,
    pub text: String,
    pub formatted_text: Option<String>,
    /// `spaces/<id>/threads/<id>`
    pub thread: Option<String>,
    /// resposta dentro de uma conversa (fio)
    pub thread_reply: bool,
    pub attachments: Vec<ChatAttachment>,
    pub deleted: bool,
    pub reactions: Vec<ChatReaction>,
    /// editada depois de enviada (`lastUpdateTime`)
    pub edited: bool,
    /// mensagem citada (resposta citando outra)
    pub quoted: Option<RawQuote>,
    /// pessoas mencionadas (`users/<id>`), sem repetir
    pub mention_ids: Vec<String>,
    /// emojis próprios da empresa usados no texto
    pub custom_emojis: Vec<CustomEmoji>,
}

/// Mensagem pronta para a tela.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub name: String,
    pub text: String,
    pub formatted_text: Option<String>,
    pub sender: ChatPerson,
    /// enviada pela própria conta
    pub mine: bool,
    pub create_time: String,
    pub create_ms: i64,
    /// última mudança (para citar esta mensagem)
    pub update_time: String,
    pub thread: Option<String>,
    pub thread_reply: bool,
    pub attachments: Vec<ChatAttachment>,
    pub deleted: bool,
    pub reactions: Vec<ChatReaction>,
    pub edited: bool,
    pub quoted: Option<ChatQuote>,
    pub mentions: Vec<ChatMention>,
    pub custom_emojis: Vec<CustomEmoji>,
}

/// Uma página de mensagens, da mais antiga para a mais nova.
/// `next_page_token` busca as anteriores ("carregar anteriores").
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatPage {
    pub messages: Vec<ChatMessage>,
    pub next_page_token: Option<String>,
}

/// Prévia da última mensagem na lista de conversas.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatPreview {
    pub text: String,
    pub sender_name: Option<String>,
    pub mine: bool,
    pub create_ms: i64,
}

/// Conversa pronta para a tela.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSpace {
    pub name: String,
    pub kind: SpaceKind,
    /// nome do espaço, da outra pessoa (mensagem direta) ou das pessoas (grupo sem nome)
    pub title: String,
    /// foto da outra pessoa numa mensagem direta
    pub photo: Option<String>,
    pub email: Option<String>,
    pub last_active_time: Option<String>,
    pub last_active_ms: i64,
    pub last_message: Option<ChatPreview>,
    /// horário das últimas mensagens dos outros (até 10), para a tela contar as não lidas
    pub recent_ms: Vec<i64>,
    /// até 3 pessoas da conversa (sem a própria conta), para o ícone com fotos empilhadas:
    /// a API não tem ícone nem emoji de espaço
    pub faces: Vec<ChatPerson>,
    pub member_count: Option<u32>,
    pub uri: Option<String>,
}

/// Erros do Chat que a tela trata com aviso próprio.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatErrorKind {
    /// a conta entrou antes das permissões do Chat: precisa entrar de novo
    Permission,
    /// o app de Chat não foi configurado (ou a API não foi ligada) no Google Cloud
    NotConfigured,
    /// conta pessoal (Gmail): o Chat por API só existe no Workspace
    NotWorkspace,
    /// outro erro: frase curta para mostrar
    Other(String),
}

impl ChatErrorKind {
    /// Código que vai para a tela (`chat_permission`, `chat_not_configured`, `chat_not_workspace`) ou a frase.
    pub fn code(&self) -> String {
        match self {
            ChatErrorKind::Permission => "chat_permission".into(),
            ChatErrorKind::NotConfigured => "chat_not_configured".into(),
            ChatErrorKind::NotWorkspace => "chat_not_workspace".into(),
            ChatErrorKind::Other(m) => m.clone(),
        }
    }
}

fn rfc3339_ms(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s).map(|d| d.timestamp_millis()).unwrap_or(0)
}

fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Contas pessoais do Google (sem Workspace).
pub fn is_consumer_email(email: &str) -> bool {
    let domain = email.rsplit('@').next().unwrap_or("").to_ascii_lowercase();
    domain == "gmail.com" || domain == "googlemail.com"
}

fn simple_id(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Confere um nome de conversa vindo da tela (`spaces/<id>`), para não montar caminho estranho na API.
pub fn valid_space_name(name: &str) -> bool {
    name.strip_prefix("spaces/").is_some_and(simple_id)
}

/// Pedaço do fim de um nome (`messages/<id>`, `reactions/<id>`): letras, números, `-`, `_` e `.`.
fn name_segment(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

/// Confere um nome de mensagem vindo da tela (`spaces/<id>/messages/<id>`; o id pode ter ponto).
pub fn valid_message_name(name: &str) -> bool {
    let mut parts = name.split('/');
    matches!(
        (parts.next(), parts.next(), parts.next(), parts.next(), parts.next()),
        (Some("spaces"), Some(space), Some("messages"), Some(msg), None) if simple_id(space) && name_segment(msg)
    )
}

/// Confere um nome de reação (`spaces/<id>/messages/<id>/reactions/<id>`).
pub fn valid_reaction_name(name: &str) -> bool {
    match name.rsplit_once("/reactions/") {
        Some((msg, id)) => valid_message_name(msg) && name_segment(id),
        None => false,
    }
}

/// `spaces/<id>/messages/<id>` → `spaces/<id>`.
pub fn space_of_message(name: &str) -> Option<String> {
    valid_message_name(name).then(|| name.splitn(3, '/').take(2).collect::<Vec<_>>().join("/"))
}

/// `users/<id>` → `people/<id>` (o id é o mesmo nas duas APIs).
pub fn people_resource(user_id: &str) -> Option<String> {
    let id = user_id.strip_prefix("users/")?;
    (simple_id(id) && id.chars().all(|c| c.is_ascii_digit())).then(|| format!("people/{id}"))
}

/// Lê `spaces.list`: conversas (sem as que não são de pessoas) e o token da próxima página.
pub fn parse_spaces(json: &str) -> Result<(Vec<RawSpace>, Option<String>), String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct List {
        #[serde(default)]
        spaces: Vec<Item>,
        next_page_token: Option<String>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Item {
        name: String,
        #[serde(default)]
        space_type: String,
        /// campo antigo: ROOM ou DM
        #[serde(default, rename = "type")]
        legacy_type: String,
        #[serde(default)]
        display_name: String,
        last_active_time: Option<String>,
        #[serde(default)]
        single_user_bot_dm: bool,
        membership_count: Option<Count>,
        space_uri: Option<String>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Count {
        joined_direct_human_user_count: Option<u32>,
    }
    let list: List = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let spaces = list
        .spaces
        .into_iter()
        .filter(|i| !i.single_user_bot_dm)
        .map(|i| {
            let kind = match (i.space_type.as_str(), i.legacy_type.as_str()) {
                ("DIRECT_MESSAGE", _) | ("", "DM") => SpaceKind::Dm,
                ("GROUP_CHAT", _) => SpaceKind::Group,
                _ => SpaceKind::Space,
            };
            RawSpace {
                last_active_ms: i.last_active_time.as_deref().map(rfc3339_ms).unwrap_or(0),
                name: i.name,
                kind,
                display_name: i.display_name,
                last_active_time: i.last_active_time,
                member_count: i.membership_count.and_then(|c| c.joined_direct_human_user_count),
                uri: i.space_uri.filter(|u| google_link(u)),
            }
        })
        .collect();
    Ok((spaces, list.next_page_token))
}

/// Link https de um site do Google (o único tipo de `spaceUri` que a tela abre).
fn google_link(u: &str) -> bool {
    url::Url::parse(u).is_ok_and(|p| {
        p.scheme() == "https" && p.host_str().is_some_and(|h| h == "google.com" || h.ends_with(".google.com"))
    })
}

/// Imagem https de um endereço do Google (emoji próprio da empresa). Outros endereços não carregam.
pub fn google_image(u: &str) -> bool {
    const HOSTS: [&str; 4] = ["googleusercontent.com", "google.com", "gstatic.com", "ggpht.com"];
    url::Url::parse(u).is_ok_and(|p| {
        p.scheme() == "https" && p.host_str().is_some_and(|h| HOSTS.iter().any(|g| h == *g || h.ends_with(&format!(".{g}"))))
    })
}

/// Conversas da mais recente para a mais antiga.
pub fn sort_spaces(spaces: &mut [RawSpace]) {
    spaces.sort_by_key(|s| std::cmp::Reverse(s.last_active_ms));
}

/// Lê `spaces.members.list`: ids (`users/<id>`) das pessoas da conversa.
pub fn parse_members(json: &str) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct List {
        #[serde(default)]
        memberships: Vec<Membership>,
    }
    #[derive(Deserialize)]
    struct Membership {
        #[serde(default)]
        state: String,
        member: Option<Member>,
    }
    #[derive(Deserialize)]
    struct Member {
        name: String,
        #[serde(default, rename = "type")]
        kind: String,
    }
    let list: List = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(list
        .memberships
        .into_iter()
        .filter(|m| m.state.is_empty() || m.state == "JOINED")
        .filter_map(|m| m.member)
        .filter(|m| m.kind != "BOT")
        .map(|m| m.name)
        .collect())
}

/// Parâmetros de `spaces.messages.list`: mais novas primeiro.
pub fn messages_query(page_token: Option<&str>, page_size: u32) -> String {
    let mut q = format!("orderBy=createTime%20desc&pageSize={page_size}");
    if let Some(t) = page_token {
        q.push_str(&format!("&pageToken={}", enc(t)));
    }
    q
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MsgJson {
    name: String,
    sender: Option<SenderJson>,
    #[serde(default)]
    create_time: String,
    #[serde(default)]
    text: String,
    formatted_text: Option<String>,
    thread: Option<ThreadJson>,
    #[serde(default)]
    thread_reply: bool,
    #[serde(default)]
    attachment: Vec<AttachmentJson>,
    deletion_metadata: Option<serde_json::Value>,
    last_update_time: Option<String>,
    #[serde(default)]
    emoji_reaction_summaries: Vec<ReactionSummaryJson>,
    quoted_message_metadata: Option<QuoteJson>,
    #[serde(default)]
    annotations: Vec<AnnotationJson>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuoteJson {
    #[serde(default)]
    name: String,
    quoted_message_snapshot: Option<QuoteSnapshotJson>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuoteSnapshotJson {
    sender: Option<String>,
    #[serde(default)]
    text: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnnotationJson {
    #[serde(default, rename = "type")]
    kind: String,
    user_mention: Option<UserMentionJson>,
    custom_emoji_metadata: Option<CustomEmojiMetaJson>,
}
#[derive(Deserialize)]
struct UserMentionJson {
    user: Option<UserJson>,
}
#[derive(Deserialize)]
struct UserJson {
    #[serde(default)]
    name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomEmojiMetaJson {
    custom_emoji: Option<CustomEmojiJson>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomEmojiJson {
    emoji_name: Option<String>,
    temporary_image_uri: Option<String>,
}

/// Emoji da empresa com nome (`:nome:`) e imagem do Google; sem isso, não dá para mostrar.
fn custom_emoji(e: CustomEmojiJson) -> Option<CustomEmoji> {
    let name = e.emoji_name.filter(|n| n.len() > 2 && n.len() <= 80 && n.starts_with(':') && n.ends_with(':') && !n.contains(char::is_whitespace))?;
    let url = e.temporary_image_uri.filter(|u| google_image(u))?;
    Some(CustomEmoji { name, url })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReactionSummaryJson {
    emoji: Option<EmojiJson>,
    reaction_count: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmojiJson {
    unicode: Option<String>,
    custom_emoji: Option<CustomEmojiJson>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SenderJson {
    #[serde(default)]
    name: String,
    #[serde(default, rename = "type")]
    kind: String,
    display_name: Option<String>,
}
#[derive(Deserialize)]
struct ThreadJson {
    name: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentJson {
    #[serde(default)]
    content_name: String,
    content_type: Option<String>,
    attachment_data_ref: Option<AttachmentRef>,
    drive_data_ref: Option<DriveRef>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveRef {
    drive_file_id: Option<String>,
}

fn raw_message(m: MsgJson) -> RawMessage {
    let sender = m.sender.unwrap_or(SenderJson { name: String::new(), kind: String::new(), display_name: None });
    let deleted = m.deletion_metadata.is_some();
    let create_ms = rfc3339_ms(&m.create_time);
    let edited = !deleted && m.last_update_time.as_deref().is_some_and(|t| rfc3339_ms(t) > create_ms);
    let reactions = if deleted {
        Vec::new()
    } else {
        m.emoji_reaction_summaries
            .into_iter()
            .filter_map(|r| {
                let count = r.reaction_count.unwrap_or(1).max(1);
                let e = r.emoji?;
                if let Some(emoji) = e.unicode.filter(|u| !u.is_empty()) {
                    return Some(ChatReaction { emoji, count, image: None });
                }
                let c = custom_emoji(e.custom_emoji?)?;
                Some(ChatReaction { emoji: c.name, count, image: Some(c.url) })
            })
            .collect()
    };
    let quoted = if deleted {
        None
    } else {
        m.quoted_message_metadata.filter(|q| valid_message_name(&q.name)).map(|q| {
            let snap = q.quoted_message_snapshot;
            RawQuote {
                name: q.name,
                sender_id: snap.as_ref().and_then(|s| s.sender.clone()).filter(|s| s.starts_with("users/")),
                text: snap.map(|s| s.text).unwrap_or_default(),
            }
        })
    };
    let mut mention_ids: Vec<String> = Vec::new();
    let mut custom_emojis: Vec<CustomEmoji> = Vec::new();
    if !deleted {
        for a in m.annotations {
            match a.kind.as_str() {
                "USER_MENTION" => {
                    if let Some(id) = a.user_mention.and_then(|u| u.user).map(|u| u.name).filter(|n| n.starts_with("users/")) {
                        if !mention_ids.contains(&id) {
                            mention_ids.push(id);
                        }
                    }
                }
                "CUSTOM_EMOJI" => {
                    if let Some(c) = a.custom_emoji_metadata.and_then(|c| c.custom_emoji).and_then(custom_emoji) {
                        if !custom_emojis.iter().any(|x| x.name == c.name) {
                            custom_emojis.push(c);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    RawMessage {
        name: m.name,
        sender_bot: sender.kind == "BOT",
        sender_display_name: sender.display_name.filter(|n| !n.trim().is_empty()),
        sender_id: sender.name,
        create_ms,
        update_time: m.last_update_time.clone().filter(|t| !t.is_empty()).unwrap_or_else(|| m.create_time.clone()),
        create_time: m.create_time,
        text: if deleted { String::new() } else { m.text },
        formatted_text: if deleted { None } else { m.formatted_text.filter(|t| !t.is_empty()) },
        thread: m.thread.and_then(|t| t.name),
        thread_reply: m.thread_reply,
        attachments: m
            .attachment
            .into_iter()
            .map(|a| ChatAttachment {
                name: if a.content_name.is_empty() { "arquivo".into() } else { a.content_name },
                content_type: a.content_type.filter(|t| !t.is_empty()),
                resource_name: a.attachment_data_ref.and_then(|r| r.resource_name).filter(|r| valid_media_resource(r)),
                drive_url: a
                    .drive_data_ref
                    .and_then(|d| d.drive_file_id)
                    .filter(|id| simple_id(id))
                    .map(|id| format!("https://drive.google.com/open?id={id}")),
            })
            .collect(),
        deleted,
        reactions,
        edited,
        quoted,
        mention_ids,
        custom_emojis,
    }
}

/// Lê `spaces.messages.list`: mensagens (na ordem da API) e o token da página seguinte.
pub fn parse_messages(json: &str) -> Result<(Vec<RawMessage>, Option<String>), String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct List {
        #[serde(default)]
        messages: Vec<MsgJson>,
        next_page_token: Option<String>,
    }
    let list: List = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok((list.messages.into_iter().map(raw_message).collect(), list.next_page_token.filter(|t| !t.is_empty())))
}

/// Lê uma mensagem só (resposta de `spaces.messages.create`).
pub fn parse_message(json: &str) -> Result<RawMessage, String> {
    serde_json::from_str::<MsgJson>(json).map(raw_message).map_err(|e| e.to_string())
}

/// Mensagem que a nova vai citar (`quotedMessageMetadata`): o nome e a hora da última mudança dela.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteRef {
    pub name: String,
    pub last_update_time: String,
}

/// Só dá para citar uma mensagem da mesma conversa (a API recusa as outras).
pub fn quote_allowed(space: &str, q: &QuoteRef) -> Result<(), String> {
    if valid_message_name(&q.name) && q.name.starts_with(&format!("{space}/messages/")) && !q.last_update_time.trim().is_empty() {
        Ok(())
    } else {
        Err("mensagem citada inválida".into())
    }
}

/// Corpo e parâmetros de `spaces.messages.create`. Com `thread`, responde naquela conversa
/// (ou abre uma nova se ela não existir mais). Anexos já enviados vão em `attachment`;
/// com `quote`, a mensagem sai citando outra (o cartão com a barrinha no Google Chat).
pub fn send_request(text: &str, thread: Option<&str>, attachments: &[AttachmentRef], quote: Option<&QuoteRef>) -> (String, String) {
    let mut body = serde_json::Map::new();
    if !text.is_empty() || attachments.is_empty() {
        body.insert("text".into(), text.into());
    }
    if let Some(q) = quote {
        body.insert("quotedMessageMetadata".into(), serde_json::json!({ "name": q.name, "lastUpdateTime": q.last_update_time }));
    }
    if let Some(t) = thread {
        body.insert("thread".into(), serde_json::json!({ "name": t }));
    }
    if !attachments.is_empty() {
        let list: Vec<_> = attachments.iter().map(|a| serde_json::json!({ "attachmentDataRef": a })).collect();
        body.insert("attachment".into(), list.into());
    }
    let query = if thread.is_some() { "messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD".to_string() } else { String::new() };
    (serde_json::Value::Object(body).to_string(), query)
}

/// Corpo de `reactions.create`. Só emoji (nada de letras ou números), até 8 caracteres.
pub fn reaction_body(emoji: &str) -> Result<String, String> {
    let ok = !emoji.is_empty()
        && emoji.chars().count() <= 8
        && !emoji.chars().any(|c| c.is_ascii_alphanumeric() || c.is_control() || c.is_whitespace());
    if !ok {
        return Err("emoji inválido".into());
    }
    Ok(serde_json::json!({ "emoji": { "unicode": emoji } }).to_string())
}

/// Parâmetros de `reactions.list` para achar a reação da própria conta com aquele emoji.
pub fn my_reactions_query(user_id: &str, emoji: &str) -> String {
    let filter = format!(r#"emoji.unicode = "{emoji}" AND user.name = "{user_id}""#);
    format!("filter={}", enc(&filter))
}

/// Lê `reactions.list` (nomes estranhos ficam de fora).
pub fn parse_reactions(json: &str) -> Result<Vec<RawReaction>, String> {
    #[derive(Deserialize)]
    struct List {
        #[serde(default)]
        reactions: Vec<Item>,
    }
    #[derive(Deserialize)]
    struct Item {
        #[serde(default)]
        name: String,
        user: Option<User>,
        emoji: Option<EmojiJson>,
    }
    #[derive(Deserialize)]
    struct User {
        #[serde(default)]
        name: String,
    }
    let list: List = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(list
        .reactions
        .into_iter()
        .filter(|r| valid_reaction_name(&r.name))
        .map(|r| RawReaction {
            name: r.name,
            user_id: r.user.map(|u| u.name).unwrap_or_default(),
            emoji: r.emoji.and_then(|e| e.unicode).filter(|u| !u.is_empty()),
        })
        .collect())
}

/// Corpo e parâmetros de `messages.patch` (troca só o texto).
pub fn edit_request(text: &str) -> (String, String) {
    (serde_json::json!({ "text": text }).to_string(), "updateMask=text".to_string())
}

/// Confere o nome de um conteúdo (`attachmentDataRef.resourceName`) antes de pôr no caminho do download.
pub fn valid_media_resource(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 2048
        && !name.starts_with('/')
        && !name.split('/').any(|seg| seg == ".." || seg == ".")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_./+=~".contains(c))
}

/// Corpo `multipart/related` do upload: os dados do arquivo (nome) e o conteúdo.
pub fn upload_body(filename: &str, content_type: &str, bytes: &[u8], boundary: &str) -> Vec<u8> {
    let ct = if content_type.trim().is_empty() { "application/octet-stream" } else { content_type.trim() };
    let meta = serde_json::json!({ "filename": filename }).to_string();
    let mut out = Vec::with_capacity(bytes.len() + meta.len() + 256);
    out.extend_from_slice(format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n").as_bytes());
    out.extend_from_slice(format!("--{boundary}\r\nContent-Type: {ct}\r\n\r\n").as_bytes());
    out.extend_from_slice(bytes);
    out.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    out
}

/// Desfaz o `encodeURIComponent` da tela (nome de arquivo com acento chega assim no cabeçalho do envio).
pub fn decode_component(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16);
        if b[i] == b'%'
            && i + 2 < b.len()
            && let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2]))
        {
            out.push((h * 16 + l) as u8);
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Lê a resposta de `attachments:upload`.
pub fn parse_upload(json: &str) -> Result<AttachmentRef, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Resp {
        attachment_data_ref: Option<AttachmentRef>,
    }
    let r: Resp = serde_json::from_str(json).map_err(|e| e.to_string())?;
    r.attachment_data_ref
        .filter(|a| a.resource_name.is_some() || a.attachment_upload_token.is_some())
        .ok_or_else(|| "o Google não devolveu o arquivo enviado".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersonJson {
    resource_name: Option<String>,
    #[serde(default)]
    names: Vec<NameJson>,
    #[serde(default)]
    photos: Vec<PhotoJson>,
    #[serde(default)]
    email_addresses: Vec<EmailJson>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NameJson {
    display_name: Option<String>,
}
#[derive(Deserialize)]
struct PhotoJson {
    url: Option<String>,
    #[serde(default)]
    default: bool,
}
#[derive(Deserialize)]
struct EmailJson {
    value: Option<String>,
}

fn chat_person(p: PersonJson) -> Option<ChatPerson> {
    let id = p.resource_name?.strip_prefix("people/")?.to_string();
    let email = p.email_addresses.into_iter().find_map(|e| e.value).filter(|e| e.contains('@'));
    let name = p
        .names
        .into_iter()
        .find_map(|n| n.display_name)
        .filter(|n| !n.trim().is_empty())
        .or_else(|| email.clone())
        .unwrap_or_else(|| "Sem nome".into());
    Some(ChatPerson {
        id: format!("users/{id}"),
        name,
        photo: p.photos.into_iter().find(|f| !f.default).and_then(|f| f.url),
        email,
        bot: false,
    })
}

/// Lê `people:batchGet`: pessoas encontradas, já com o id do Chat (`users/<id>`).
/// Fotos genéricas (a letra colorida) ficam de fora.
pub fn parse_people_batch(json: &str) -> Result<Vec<ChatPerson>, String> {
    #[derive(Deserialize)]
    struct Batch {
        #[serde(default)]
        responses: Vec<Resp>,
    }
    #[derive(Deserialize)]
    struct Resp {
        person: Option<PersonJson>,
    }
    let b: Batch = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(b.responses.into_iter().filter_map(|r| r.person).filter_map(chat_person).collect())
}

/// Lê `people/me`: o id do Chat (`users/<id>`) da própria conta.
pub fn parse_me(json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Me {
        resource_name: Option<String>,
    }
    let me: Me = serde_json::from_str(json).map_err(|e| e.to_string())?;
    me.resource_name
        .as_deref()
        .and_then(|r| r.strip_prefix("people/"))
        .filter(|id| !id.is_empty())
        .map(|id| format!("users/{id}"))
        .ok_or_else(|| "o Google não devolveu o id da conta".into())
}

/// Nome de um grupo sem nome a partir das pessoas: "Ana", "Ana e Bia", "Ana, Bia e Caio", "Ana, Bia e mais 3".
pub fn group_title(names: &[String]) -> String {
    match names {
        [] => "Grupo".into(),
        [a] => a.clone(),
        [a, b] => format!("{a} e {b}"),
        [a, b, c] => format!("{a}, {b} e {c}"),
        [a, b, rest @ ..] => format!("{a}, {b} e mais {}", rest.len()),
    }
}

/// Nome de um grupo sem nome quando só parte das pessoas foi buscada: `total` conta todas (menos a própria conta).
pub fn group_title_of(names: &[String], total: usize) -> String {
    if total <= names.len() {
        return group_title(names);
    }
    match names {
        [] => "Grupo".into(),
        [a] => format!("{a} e mais {}", total - 1),
        [a, b, ..] => format!("{a}, {b} e mais {}", total - 2),
    }
}

/// Texto da prévia: o texto da mensagem ou, sem texto, o anexo.
pub fn preview_text(m: &RawMessage) -> String {
    if m.deleted {
        return "Mensagem apagada".into();
    }
    let text = m.text.split_whitespace().collect::<Vec<_>>().join(" ");
    if !text.is_empty() {
        return text.chars().take(160).collect();
    }
    m.attachments.first().map(|a| format!("Anexo: {}", a.name)).unwrap_or_default()
}

/// Apagar mensagem que tem respostas: o Google só deixa apagando as respostas junto (`force`), e o Quill não faz isso.
pub const HAS_REPLIES: &str = "Essa mensagem tem respostas. O Google Chat só deixa apagar junto com as respostas; apague pelo Google Chat se quiser.";

/// Classifica um erro do Google (texto "403 Forbidden: {json}") num aviso para a tela.
pub fn classify_error(msg: &str) -> ChatErrorKind {
    #[derive(Deserialize)]
    struct Body {
        error: Err,
    }
    #[derive(Deserialize)]
    struct Err {
        #[serde(default)]
        message: String,
    }
    let lower = msg.to_ascii_lowercase();
    if lower.contains("access_token_scope_insufficient") || lower.contains("insufficient authentication scopes") {
        return ChatErrorKind::Permission;
    }
    if lower.contains("chat app not found") || lower.contains("service_disabled") || lower.contains("has not been used in project") {
        return ChatErrorKind::NotConfigured;
    }
    if lower.contains("consumer") || lower.contains("google workspace account") {
        return ChatErrorKind::NotWorkspace;
    }
    if lower.contains("repl") && (lower.contains("force") || lower.contains("thread")) && lower.contains("delet") {
        return ChatErrorKind::Other(HAS_REPLIES.into());
    }
    let short = match msg.find('{').and_then(|i| serde_json::from_str::<Body>(&msg[i..]).ok()) {
        Some(b) if !b.error.message.is_empty() => format!("O Google Chat recusou o pedido: {}", b.error.message),
        _ => msg.to_string(),
    };
    let mut out: String = short.chars().take(200).collect();
    if out.len() < short.len() {
        out.pop();
        out.push('…');
    }
    ChatErrorKind::Other(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconhece_contas_pessoais() {
        assert!(is_consumer_email("ana@gmail.com"));
        assert!(is_consumer_email("Ana@GoogleMail.com"));
        assert!(!is_consumer_email("gabriel@inchurch.com.br"));
    }

    #[test]
    fn so_aceita_nome_de_espaco_simples() {
        assert!(valid_space_name("spaces/AAAAbc_12-x"));
        assert!(!valid_space_name("spaces/"));
        assert!(!valid_space_name("spaces/../users"));
        assert!(!valid_space_name("spaces/a/messages"));
        assert!(!valid_space_name("users/1"));
        assert!(!valid_space_name("spaces/a?x=1"));
    }

    #[test]
    fn id_do_chat_vira_id_da_people_api() {
        assert_eq!(people_resource("users/1234").as_deref(), Some("people/1234"));
        assert_eq!(people_resource("users/app"), None);
        assert_eq!(people_resource("users/"), None);
        assert_eq!(people_resource("spaces/x"), None);
    }

    #[test]
    fn le_espacos_grupos_e_mensagens_diretas() {
        let json = r#"{"spaces":[
          {"name":"spaces/A","spaceType":"SPACE","displayName":"Produto","lastActiveTime":"2026-11-17T12:00:00.123456Z",
           "membershipCount":{"joinedDirectHumanUserCount":8,"joinedGroupCount":1},"spaceUri":"https://chat.google.com/room/A?cls=11"},
          {"name":"spaces/B","spaceType":"DIRECT_MESSAGE","lastActiveTime":"2026-11-17T13:00:00Z"},
          {"name":"spaces/C","spaceType":"GROUP_CHAT","displayName":""},
          {"name":"spaces/D","type":"DM","singleUserBotDm":true}
        ],"nextPageToken":"p2"}"#;
        let (list, next) = parse_spaces(json).unwrap();
        assert_eq!(next.as_deref(), Some("p2"));
        assert_eq!(list.len(), 3, "a conversa só com um app fica de fora");
        assert_eq!(list[0].kind, SpaceKind::Space);
        assert_eq!(list[0].display_name, "Produto");
        assert_eq!(list[0].last_active_ms, 1_794_916_800_123);
        assert_eq!(list[0].member_count, Some(8));
        assert_eq!(list[0].uri.as_deref(), Some("https://chat.google.com/room/A?cls=11"));
        assert_eq!(list[1].member_count, None);
        assert_eq!(list[1].kind, SpaceKind::Dm);
        assert_eq!(list[2].kind, SpaceKind::Group);
        assert_eq!(list[2].last_active_ms, 0);
    }

    #[test]
    fn le_lista_vazia_de_espacos() {
        let (list, next) = parse_spaces("{}").unwrap();
        assert!(list.is_empty());
        assert!(next.is_none());
    }

    #[test]
    fn link_do_espaco_so_se_for_do_google() {
        let json = r#"{"spaces":[{"name":"spaces/X","spaceType":"SPACE","displayName":"X","spaceUri":"javascript:alert(1)"}]}"#;
        assert_eq!(parse_spaces(json).unwrap().0[0].uri, None);
    }

    #[test]
    fn tipos_antigos_viram_os_novos() {
        let json = r#"{"spaces":[{"name":"spaces/R","type":"ROOM","displayName":"Sala"},{"name":"spaces/M","type":"DM"}]}"#;
        let (list, _) = parse_spaces(json).unwrap();
        assert_eq!(list[0].kind, SpaceKind::Space);
        assert_eq!(list[1].kind, SpaceKind::Dm);
    }

    #[test]
    fn ordena_pela_atividade_mais_recente() {
        let json = r#"{"spaces":[
          {"name":"spaces/A","spaceType":"SPACE","displayName":"A","lastActiveTime":"2026-11-17T12:00:00.5Z"},
          {"name":"spaces/B","spaceType":"SPACE","displayName":"B","lastActiveTime":"2026-11-17T12:00:00.123456Z"},
          {"name":"spaces/C","spaceType":"SPACE","displayName":"C"},
          {"name":"spaces/D","spaceType":"SPACE","displayName":"D","lastActiveTime":"2026-11-18T09:00:00Z"}
        ]}"#;
        let (mut list, _) = parse_spaces(json).unwrap();
        sort_spaces(&mut list);
        let names: Vec<_> = list.iter().map(|s| s.display_name.as_str()).collect();
        assert_eq!(names, ["D", "A", "B", "C"]);
    }

    #[test]
    fn le_membros_humanos() {
        let json = r#"{"memberships":[
          {"name":"spaces/B/members/1","state":"JOINED","member":{"name":"users/111","type":"HUMAN"}},
          {"name":"spaces/B/members/2","state":"JOINED","member":{"name":"users/222","type":"HUMAN"}},
          {"name":"spaces/B/members/3","state":"JOINED","member":{"name":"users/app","type":"BOT"}},
          {"name":"spaces/B/members/4","state":"INVITED","member":{"name":"users/333","type":"HUMAN"}},
          {"name":"spaces/B/members/5","groupMember":{"name":"groups/x"}}
        ]}"#;
        assert_eq!(parse_members(json).unwrap(), ["users/111", "users/222"]);
        assert!(parse_members("{}").unwrap().is_empty());
    }

    #[test]
    fn pede_mensagens_mais_novas_primeiro() {
        assert_eq!(messages_query(None, 50), "orderBy=createTime%20desc&pageSize=50");
        assert_eq!(messages_query(Some("a/b+c"), 50), "orderBy=createTime%20desc&pageSize=50&pageToken=a%2Fb%2Bc");
    }

    #[test]
    fn le_mensagens_com_resposta_e_anexo() {
        let json = r#"{"messages":[
          {"name":"spaces/A/messages/2","sender":{"name":"users/222","type":"HUMAN"},
           "createTime":"2026-11-17T12:01:00Z","text":"veja o link https://exemplo.com",
           "formattedText":"veja o link <https://exemplo.com|https://exemplo.com>",
           "thread":{"name":"spaces/A/threads/T1"},"threadReply":true,
           "attachment":[{"name":"spaces/A/messages/2/attachments/X","contentName":"relatorio.pdf","contentType":"application/pdf"}]},
          {"name":"spaces/A/messages/1","sender":{"name":"users/app","type":"BOT","displayName":"Lembretes"},
           "createTime":"2026-11-17T12:00:00Z","text":"Bom dia","thread":{"name":"spaces/A/threads/T1"}},
          {"name":"spaces/A/messages/0","sender":{"name":"users/111","type":"HUMAN"},"createTime":"2026-11-17T11:00:00Z",
           "deletionMetadata":{"deletionType":"CREATOR"}}
        ],"nextPageToken":"older"}"#;
        let (list, next) = parse_messages(json).unwrap();
        assert_eq!(next.as_deref(), Some("older"));
        assert_eq!(list.len(), 3);
        let m = &list[0];
        assert_eq!(m.sender_id, "users/222");
        assert!(!m.sender_bot);
        assert_eq!(m.create_ms, 1_794_916_860_000);
        assert_eq!(m.thread.as_deref(), Some("spaces/A/threads/T1"));
        assert!(m.thread_reply);
        assert_eq!(m.attachments[0].name, "relatorio.pdf");
        assert_eq!(m.attachments[0].content_type.as_deref(), Some("application/pdf"));
        assert!(m.formatted_text.as_deref().unwrap().contains("<https://exemplo.com|"));
        let bot = &list[1];
        assert!(bot.sender_bot);
        assert_eq!(bot.sender_display_name.as_deref(), Some("Lembretes"));
        assert!(!bot.thread_reply);
        assert!(list[2].deleted);
        assert_eq!(list[2].text, "");
    }

    #[test]
    fn le_mensagem_criada() {
        let m = parse_message(r#"{"name":"spaces/A/messages/9","sender":{"name":"users/1","type":"HUMAN"},"createTime":"2026-11-17T12:00:00Z","text":"oi"}"#).unwrap();
        assert_eq!(m.name, "spaces/A/messages/9");
        assert_eq!(m.text, "oi");
        assert!(parse_message("nada").is_err());
    }

    #[test]
    fn monta_envio_simples_e_resposta_na_conversa() {
        let (body, query) = send_request("oi \"você\"", None, &[], None);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&body).unwrap(), serde_json::json!({"text":"oi \"você\""}));
        assert_eq!(query, "");
        let (body, query) = send_request("ok", Some("spaces/A/threads/T1"), &[], None);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({"text":"ok","thread":{"name":"spaces/A/threads/T1"}})
        );
        assert_eq!(query, "messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
    }

    #[test]
    fn le_pessoas_da_people_api() {
        let json = r#"{"responses":[
          {"requestedResourceName":"people/111","person":{"resourceName":"people/111",
            "names":[{"displayName":"Ana Lima"}],"photos":[{"url":"https://lh3/a","default":false}],
            "emailAddresses":[{"value":"ana@empresa.com"}]}},
          {"requestedResourceName":"people/222","person":{"resourceName":"people/222",
            "names":[{"displayName":"Bruno"}],"photos":[{"url":"https://lh3/generica","default":true}]}},
          {"requestedResourceName":"people/333","status":{"code":404}}
        ]}"#;
        let list = parse_people_batch(json).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(
            list[0],
            ChatPerson { id: "users/111".into(), name: "Ana Lima".into(), photo: Some("https://lh3/a".into()), email: Some("ana@empresa.com".into()), bot: false }
        );
        assert_eq!(list[1].photo, None);
        assert_eq!(list[1].email, None);
    }

    #[test]
    fn pessoa_sem_nome_usa_o_email() {
        let json = r#"{"responses":[{"person":{"resourceName":"people/9","emailAddresses":[{"value":"caio@empresa.com"}]}}]}"#;
        assert_eq!(parse_people_batch(json).unwrap()[0].name, "caio@empresa.com");
    }

    #[test]
    fn le_o_proprio_id() {
        assert_eq!(parse_me(r#"{"resourceName":"people/1234","names":[]}"#).unwrap(), "users/1234");
        assert!(parse_me(r#"{"names":[]}"#).is_err());
    }

    #[test]
    fn nome_de_grupo_sem_nome() {
        let n = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(group_title(&n(&[])), "Grupo");
        assert_eq!(group_title(&n(&["Ana"])), "Ana");
        assert_eq!(group_title(&n(&["Ana", "Bia"])), "Ana e Bia");
        assert_eq!(group_title(&n(&["Ana", "Bia", "Caio"])), "Ana, Bia e Caio");
        assert_eq!(group_title(&n(&["Ana", "Bia", "Caio", "Davi", "Eva"])), "Ana, Bia e mais 3");
    }

    #[test]
    fn nome_de_grupo_grande_conta_todas_as_pessoas() {
        let n = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(group_title_of(&n(&["Ana", "Bia", "Caio"]), 9), "Ana, Bia e mais 7");
        assert_eq!(group_title_of(&n(&["Ana", "Bia"]), 2), "Ana e Bia");
        assert_eq!(group_title_of(&n(&["Ana"]), 3), "Ana e mais 2");
    }

    #[test]
    fn previa_usa_texto_ou_anexo() {
        let (list, _) = parse_messages(
            r#"{"messages":[
              {"name":"m1","sender":{"name":"users/1"},"createTime":"2026-11-17T12:00:00Z","text":"  linha 1\nlinha 2  "},
              {"name":"m2","sender":{"name":"users/1"},"createTime":"2026-11-17T12:00:00Z","attachment":[{"contentName":"foto.png"}]},
              {"name":"m3","sender":{"name":"users/1"},"createTime":"2026-11-17T12:00:00Z","deletionMetadata":{}},
              {"name":"m4","sender":{"name":"users/1"},"createTime":"2026-11-17T12:00:00Z"}
            ]}"#,
        )
        .unwrap();
        assert_eq!(preview_text(&list[0]), "linha 1 linha 2");
        assert_eq!(preview_text(&list[1]), "Anexo: foto.png");
        assert_eq!(preview_text(&list[2]), "Mensagem apagada");
        assert_eq!(preview_text(&list[3]), "");
    }

    #[test]
    fn falta_de_permissao_pede_novo_login() {
        let msg = r#"403 Forbidden: {"error":{"code":403,"message":"Request had insufficient authentication scopes.","status":"PERMISSION_DENIED",
          "details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}"#;
        assert_eq!(classify_error(msg), ChatErrorKind::Permission);
        assert_eq!(classify_error(msg).code(), "chat_permission");
    }

    #[test]
    fn app_de_chat_nao_configurado() {
        let msg = r#"404 Not Found: {"error":{"code":404,"message":"Google Chat app not found. To create a Chat app, you must turn on the Chat API and configure the app in the Google Cloud console.","status":"NOT_FOUND"}}"#;
        assert_eq!(classify_error(msg), ChatErrorKind::NotConfigured);
        let disabled = r#"403 Forbidden: {"error":{"code":403,"message":"Google Chat API has not been used in project 123 before or it is disabled.","status":"PERMISSION_DENIED","details":[{"reason":"SERVICE_DISABLED"}]}}"#;
        assert_eq!(classify_error(disabled), ChatErrorKind::NotConfigured);
        assert_eq!(classify_error(disabled).code(), "chat_not_configured");
    }

    #[test]
    fn conta_sem_workspace() {
        let msg = r#"403 Forbidden: {"error":{"code":403,"message":"This API is not available for consumer (gmail.com) accounts. Use a Google Workspace account.","status":"PERMISSION_DENIED"}}"#;
        assert_eq!(classify_error(msg), ChatErrorKind::NotWorkspace);
        assert_eq!(classify_error(msg).code(), "chat_not_workspace");
    }

    #[test]
    fn outro_erro_vira_frase_curta_sem_o_json() {
        let msg = r#"400 Bad Request: {"error":{"code":400,"message":"Invalid page token.","status":"INVALID_ARGUMENT"}}"#;
        assert_eq!(classify_error(msg), ChatErrorKind::Other("O Google Chat recusou o pedido: Invalid page token.".into()));
        assert_eq!(classify_error("Sem conexão com o Google: timeout"), ChatErrorKind::Other("Sem conexão com o Google: timeout".into()));
        let long = format!("500 Internal: {}", "x".repeat(500));
        assert!(classify_error(&long).code().chars().count() <= 200);
    }

    #[test]
    fn le_anexo_enviado_e_anexo_do_drive() {
        let json = r#"{"messages":[{"name":"spaces/A/messages/3","sender":{"name":"users/1"},"createTime":"2026-11-17T12:00:00Z",
          "attachment":[
            {"name":"spaces/A/messages/3/attachments/a","contentName":"foto.png","contentType":"image/png",
             "attachmentDataRef":{"resourceName":"ClxDaGF0QXR0YWNo/bWVudA==","attachmentUploadToken":"tok"},
             "thumbnailUri":"https://chat.google.com/x","source":"UPLOADED_CONTENT"},
            {"name":"spaces/A/messages/3/attachments/b","contentName":"Planilha","contentType":"application/vnd.google-apps.spreadsheet",
             "driveDataRef":{"driveFileId":"1AbC-d_E"},"source":"DRIVE_FILE"}
          ]}]}"#;
        let (list, _) = parse_messages(json).unwrap();
        let a = &list[0].attachments;
        assert_eq!(a[0].resource_name.as_deref(), Some("ClxDaGF0QXR0YWNo/bWVudA=="));
        assert_eq!(a[0].drive_url, None);
        assert_eq!(a[1].resource_name, None);
        assert_eq!(a[1].drive_url.as_deref(), Some("https://drive.google.com/open?id=1AbC-d_E"));
    }

    #[test]
    fn so_aceita_nome_de_conteudo_seguro() {
        assert!(valid_media_resource("ClxDaGF0QXR0YWNo/bWVudA=="));
        assert!(valid_media_resource("spaces/A/attachments/a-b_c.d+e~f"));
        assert!(!valid_media_resource(""));
        assert!(!valid_media_resource("/abs"));
        assert!(!valid_media_resource("a/../b"));
        assert!(!valid_media_resource("a?alt=json"));
        assert!(!valid_media_resource("a#b"));
        assert!(!valid_media_resource("a%2e"));
        assert!(!valid_media_resource("a b"));
    }

    #[test]
    fn envio_com_anexo_ja_enviado() {
        let r = AttachmentRef { resource_name: None, attachment_upload_token: Some("tok1".into()) };
        let (body, _) = send_request("", None, &[r], None);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({"attachment":[{"attachmentDataRef":{"attachmentUploadToken":"tok1"}}]})
        );
        let r = AttachmentRef { resource_name: Some("res".into()), attachment_upload_token: Some("tok".into()) };
        let (body, _) = send_request("veja", None, &[r], None);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({"text":"veja","attachment":[{"attachmentDataRef":{"resourceName":"res","attachmentUploadToken":"tok"}}]})
        );
    }

    #[test]
    fn monta_upload_multipart() {
        let body = upload_body("relatório \"final\".pdf", "application/pdf", b"%PDF-1", "BND");
        let text = String::from_utf8_lossy(&body);
        assert!(text.starts_with("--BND\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"));
        assert!(text.contains(r#"{"filename":"relatório \"final\".pdf"}"#));
        assert!(text.contains("\r\n--BND\r\nContent-Type: application/pdf\r\n\r\n%PDF-1\r\n--BND--"));
        // conteúdo binário vai intacto
        let bin = upload_body("a.bin", "", &[0, 255, 13, 10], "B");
        assert!(bin.windows(4).any(|w| w == [0, 255, 13, 10]));
        assert!(String::from_utf8_lossy(&bin).contains("Content-Type: application/octet-stream"));
    }

    #[test]
    fn le_resposta_do_upload() {
        let r = parse_upload(r#"{"attachmentDataRef":{"resourceName":"res1","attachmentUploadToken":"tok1"}}"#).unwrap();
        assert_eq!(r.resource_name.as_deref(), Some("res1"));
        assert_eq!(r.attachment_upload_token.as_deref(), Some("tok1"));
        assert!(parse_upload("{}").is_err());
    }

    #[test]
    fn desfaz_encode_uri_component() {
        assert_eq!(decode_component("relat%C3%B3rio%20final%2B1.pdf"), "relatório final+1.pdf");
        assert_eq!(decode_component("a+b"), "a+b");
        assert_eq!(decode_component("100%"), "100%");
    }

    #[test]
    fn le_reacoes_e_edicao_das_mensagens() {
        let json = r#"{"messages":[
          {"name":"spaces/A/messages/X1.Y1","sender":{"name":"users/2"},"createTime":"2026-11-17T12:00:00Z",
           "lastUpdateTime":"2026-11-17T12:05:00Z","text":"corrigido",
           "emojiReactionSummaries":[
             {"emoji":{"unicode":"👍"},"reactionCount":3},
             {"emoji":{"unicode":"❤️"}},
             {"emoji":{"customEmoji":{"uid":"abc"}},"reactionCount":2}
           ]},
          {"name":"spaces/A/messages/2","sender":{"name":"users/2"},"createTime":"2026-11-17T12:00:00Z","text":"sem nada"}
        ]}"#;
        let (list, _) = parse_messages(json).unwrap();
        let m = &list[0];
        assert_eq!(
            m.reactions,
            [ChatReaction { emoji: "👍".into(), count: 3, image: None }, ChatReaction { emoji: "❤️".into(), count: 1, image: None }],
            "emoji próprio da empresa (sem unicode) fica de fora; sem contagem conta 1"
        );
        assert!(m.edited);
        assert!(list[1].reactions.is_empty());
        assert!(!list[1].edited);
    }

    #[test]
    fn guarda_a_hora_da_ultima_mudanca_para_citar() {
        let json = r#"{"messages":[
          {"name":"spaces/A/messages/1","sender":{"name":"users/2"},"createTime":"2026-11-17T12:00:00Z",
           "lastUpdateTime":"2026-11-17T12:05:00Z","text":"corrigido"},
          {"name":"spaces/A/messages/2","sender":{"name":"users/2"},"createTime":"2026-11-17T12:01:00Z","text":"sem edição"}
        ]}"#;
        let (list, _) = parse_messages(json).unwrap();
        assert_eq!(list[0].update_time, "2026-11-17T12:05:00Z");
        assert_eq!(list[1].update_time, "2026-11-17T12:01:00Z", "sem edição usa a hora em que foi criada");
    }

    #[test]
    fn monta_envio_citando_outra_mensagem() {
        let q = QuoteRef { name: "spaces/A/messages/2".into(), last_update_time: "2026-11-17T12:05:00Z".into() };
        let (body, query) = send_request("concordo", None, &[], Some(&q));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({"text":"concordo","quotedMessageMetadata":{"name":"spaces/A/messages/2","lastUpdateTime":"2026-11-17T12:05:00Z"}})
        );
        assert_eq!(query, "");
        let bad = QuoteRef { name: "spaces/B/messages/2".into(), last_update_time: "x".into() };
        assert!(quote_allowed("spaces/A", &bad).is_err(), "só cita mensagem da mesma conversa");
        assert!(quote_allowed("spaces/A", &q).is_ok());
    }

    #[test]
    fn mensagem_apagada_nao_mostra_reacoes() {
        let m = parse_message(
            r#"{"name":"spaces/A/messages/1","createTime":"2026-11-17T12:00:00Z","deletionMetadata":{"deletionType":"CREATOR"},
               "lastUpdateTime":"2026-11-17T12:09:00Z","emojiReactionSummaries":[{"emoji":{"unicode":"👍"},"reactionCount":1}]}"#,
        )
        .unwrap();
        assert!(m.deleted);
        assert!(m.reactions.is_empty());
        assert!(!m.edited, "apagar não é editar");
    }

    #[test]
    fn so_aceita_nome_de_mensagem_e_de_reacao_simples() {
        assert!(valid_message_name("spaces/AAAA/messages/UBHHVc_AAAA.UBHHVc_AAAA"));
        assert!(valid_message_name("spaces/A/messages/client-abc"));
        assert!(!valid_message_name("spaces/A/messages/"));
        assert!(!valid_message_name("spaces/A/messages/.."));
        assert!(!valid_message_name("spaces/A/messages/1/reactions/2"));
        assert!(!valid_message_name("spaces/A/messages/1?x=1"));
        assert!(!valid_message_name("spaces/../messages/1"));
        assert!(!valid_message_name("users/1"));
        assert!(valid_reaction_name("spaces/A/messages/1.1/reactions/R-1_x"));
        assert!(!valid_reaction_name("spaces/A/messages/1/reactions/"));
        assert!(!valid_reaction_name("spaces/A/messages/1/reactions/a/b"));
        assert!(!valid_reaction_name("spaces/A/messages/1"));
        assert_eq!(space_of_message("spaces/A/messages/1.2").as_deref(), Some("spaces/A"));
        assert_eq!(space_of_message("spaces/A"), None);
    }

    #[test]
    fn monta_pedido_de_reacao() {
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&reaction_body("👍").unwrap()).unwrap(),
            serde_json::json!({"emoji":{"unicode":"👍"}})
        );
        assert!(reaction_body("").is_err());
        assert!(reaction_body("abc").is_err(), "só emoji, não texto");
        assert!(reaction_body(&"😀".repeat(20)).is_err());
    }

    #[test]
    fn filtro_das_proprias_reacoes() {
        let q = my_reactions_query("users/123", "👍");
        let decoded: Vec<(String, String)> = url::form_urlencoded::parse(q.as_bytes()).into_owned().collect();
        assert_eq!(decoded, [("filter".to_string(), r#"emoji.unicode = "👍" AND user.name = "users/123""#.to_string())]);
    }

    #[test]
    fn le_lista_de_reacoes() {
        let json = r#"{"reactions":[
          {"name":"spaces/A/messages/1/reactions/R1","user":{"name":"users/123","type":"HUMAN"},"emoji":{"unicode":"👍"}},
          {"name":"spaces/A/messages/1/reactions/R2","user":{"name":"users/9"},"emoji":{"customEmoji":{"uid":"x"}}},
          {"name":"../x","user":{"name":"users/123"},"emoji":{"unicode":"👍"}}
        ]}"#;
        let list = parse_reactions(json).unwrap();
        assert_eq!(
            list,
            [RawReaction { name: "spaces/A/messages/1/reactions/R1".into(), user_id: "users/123".into(), emoji: Some("👍".into()) },
             RawReaction { name: "spaces/A/messages/1/reactions/R2".into(), user_id: "users/9".into(), emoji: None }],
            "nome estranho fica de fora"
        );
        assert!(parse_reactions("{}").unwrap().is_empty());
    }

    #[test]
    fn monta_pedido_de_edicao() {
        let (body, query) = edit_request("novo \"texto\"");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&body).unwrap(), serde_json::json!({"text":"novo \"texto\""}));
        assert_eq!(query, "updateMask=text");
    }

    #[test]
    fn apagar_mensagem_com_respostas_vira_frase_clara() {
        let msg = r#"400 Bad Request: {"error":{"code":400,"message":"Message has thread replies. Set force=true to delete the message and its replies.","status":"FAILED_PRECONDITION"}}"#;
        assert_eq!(classify_error(msg), ChatErrorKind::Other(HAS_REPLIES.into()));
    }

    #[test]
    fn le_mensagem_citada_com_a_copia_do_texto() {
        let json = r#"{"messages":[{"name":"spaces/A/messages/5","sender":{"name":"users/1"},"createTime":"2026-11-17T12:00:00Z","text":"concordo",
          "quotedMessageMetadata":{"name":"spaces/A/messages/2","lastUpdateTime":"2026-11-17T11:00:00Z","quoteType":"REPLY",
            "quotedMessageSnapshot":{"sender":"users/7","text":"Vamos fechar sexta?","formattedText":"Vamos fechar *sexta*?"}}},
          {"name":"spaces/A/messages/6","sender":{"name":"users/1"},"createTime":"2026-11-17T12:01:00Z","text":"sem cópia",
          "quotedMessageMetadata":{"name":"spaces/A/messages/3"}},
          {"name":"spaces/A/messages/7","sender":{"name":"users/1"},"createTime":"2026-11-17T12:02:00Z","text":"nome estranho",
          "quotedMessageMetadata":{"name":"../x"}}
        ]}"#;
        let (list, _) = parse_messages(json).unwrap();
        assert_eq!(
            list[0].quoted,
            Some(RawQuote { name: "spaces/A/messages/2".into(), sender_id: Some("users/7".into()), text: "Vamos fechar sexta?".into() })
        );
        assert_eq!(list[1].quoted, Some(RawQuote { name: "spaces/A/messages/3".into(), sender_id: None, text: String::new() }));
        assert_eq!(list[2].quoted, None, "nome que não é de mensagem fica de fora");
    }

    #[test]
    fn le_mencoes_e_emoji_proprio_da_empresa() {
        let json = r#"{"messages":[{"name":"spaces/A/messages/5","sender":{"name":"users/1"},"createTime":"2026-11-17T12:00:00Z",
          "text":"@Ana olha isso :festa:","formattedText":"<users/22> olha isso :festa:",
          "annotations":[
            {"type":"USER_MENTION","startIndex":0,"length":4,"userMention":{"user":{"name":"users/22","type":"HUMAN"},"type":"MENTION"}},
            {"type":"USER_MENTION","userMention":{"user":{"name":"users/22"}}},
            {"type":"CUSTOM_EMOJI","customEmojiMetadata":{"customEmoji":{"uid":"u1","emojiName":":festa:","temporaryImageUri":"https://lh3.googleusercontent.com/festa"}}},
            {"type":"CUSTOM_EMOJI","customEmojiMetadata":{"customEmoji":{"uid":"u2","emojiName":":mal:","temporaryImageUri":"https://exemplo.com/x.png"}}},
            {"type":"RICH_LINK","richLinkMetadata":{"uri":"https://exemplo.com"}}
          ],
          "emojiReactionSummaries":[
            {"emoji":{"unicode":"👍"},"reactionCount":2},
            {"emoji":{"customEmoji":{"uid":"u1","emojiName":":festa:","temporaryImageUri":"https://lh3.googleusercontent.com/festa"}},"reactionCount":3},
            {"emoji":{"customEmoji":{"uid":"u3"}},"reactionCount":1}
          ]}]}"#;
        let (list, _) = parse_messages(json).unwrap();
        let m = &list[0];
        assert_eq!(m.mention_ids, ["users/22"], "sem repetir");
        assert_eq!(m.custom_emojis, [CustomEmoji { name: ":festa:".into(), url: "https://lh3.googleusercontent.com/festa".into() }], "só imagem do Google");
        assert_eq!(
            m.reactions,
            [
                ChatReaction { emoji: "👍".into(), count: 2, image: None },
                ChatReaction { emoji: ":festa:".into(), count: 3, image: Some("https://lh3.googleusercontent.com/festa".into()) },
            ],
            "emoji da empresa sem imagem fica de fora"
        );
    }

    #[test]
    fn imagem_so_de_endereco_do_google() {
        assert!(google_image("https://lh3.googleusercontent.com/a"));
        assert!(google_image("https://fonts.gstatic.com/x.png"));
        assert!(google_image("https://chat.google.com/api/get_attachment"));
        assert!(!google_image("http://lh3.googleusercontent.com/a"));
        assert!(!google_image("https://googleusercontent.com.mal.com/a"));
        assert!(!google_image("https://mal.com/?x=googleusercontent.com"));
        assert!(!google_image("javascript:alert(1)"));
    }
}
