//! Contas de e-mail por IMAP/SMTP (iCloud e qualquer outro provedor), parte sem rede:
//! configuração e predefinições, mapa das pastas, ids dos e-mails e leitura das mensagens.
//! A conversa com os servidores fica em `imap_client` (recurso `net`).

use mail_parser::{MessageParser, PartKind};
use serde::{Deserialize, Serialize};

use crate::gmail::{AttachmentInfo, DraftContent, MessageBody, MessageSummary, Sender, format_list_date, initials};

/// Pastas do app que existem numa conta IMAP.
pub const FOLDER_IDS: [&str; 6] = ["inbox", "sent", "drafts", "trash", "spam", "archive"];

/// Como o SMTP protege a conexão: TLS direto (porta 465) ou STARTTLS (porta 587).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SmtpSecurity {
    Tls,
    Starttls,
}

impl SmtpSecurity {
    pub fn for_port(port: u16) -> Self {
        if port == 465 { SmtpSecurity::Tls } else { SmtpSecurity::Starttls }
    }
}

/// Servidores de uma conta IMAP. Guardado no `accounts.json` (a senha fica no cofre do sistema).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapConfig {
    pub email: String,
    /// nome que aparece para quem recebe
    #[serde(default)]
    pub name: Option<String>,
    /// "icloud" ou "imap"
    #[serde(default = "default_provider")]
    pub provider: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    /// vazio = escolhe pela porta (465 → TLS, outras → STARTTLS)
    #[serde(default)]
    pub smtp_security: Option<SmtpSecurity>,
    /// vazio = o próprio e-mail
    #[serde(default)]
    pub username: String,
}

fn default_provider() -> String {
    "imap".into()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImapError {
    /// configuração inválida (a frase já explica o que corrigir)
    Invalid(String),
    /// usuário ou senha recusados pelo servidor
    Auth { icloud: bool },
    HostNotFound(String),
    Unreachable { host: String, port: u16 },
    Tls(String),
    Timeout(String),
    /// o servidor IMAP recusou um pedido
    Server(String),
    /// o servidor SMTP recusou o envio
    Smtp(String),
    Vault(String),
    /// a senha não está mais no cofre: conectar de novo
    NeedsLogin,
    /// o e-mail não existe mais (apagado ou movido em outro aparelho)
    MessageGone,
}

impl std::fmt::Display for ImapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImapError::Invalid(msg) => write!(f, "{msg}"),
            ImapError::Auth { icloud: true } => {
                write!(f, "Senha de app incorreta. Crie uma nova em appleid.apple.com e tente de novo.")
            }
            ImapError::Auth { icloud: false } => write!(
                f,
                "E-mail ou senha incorretos. Se o seu provedor usa senha de app, use ela no lugar da senha normal."
            ),
            ImapError::HostNotFound(host) => {
                write!(f, "Não achei o servidor {host}. Confira o endereço em Configurações avançadas.")
            }
            ImapError::Unreachable { host, port } => {
                write!(f, "O servidor {host} não respondeu na porta {port}. Confira a porta ou a sua internet.")
            }
            ImapError::Tls(host) => write!(f, "Não consegui abrir uma conexão segura com {host}."),
            ImapError::Timeout(host) => write!(f, "O servidor {host} demorou demais para responder. Tente de novo."),
            ImapError::Server(msg) => write!(f, "O servidor de e-mail recusou o pedido: {msg}"),
            ImapError::Smtp(msg) => write!(f, "Não consegui enviar: {msg}"),
            ImapError::Vault(e) => write!(f, "Não consegui usar as Chaves do sistema: {e}"),
            ImapError::NeedsLogin => write!(f, "Essa conta precisa entrar de novo."),
            ImapError::MessageGone => write!(f, "Esse e-mail não existe mais no servidor."),
        }
    }
}

/// Sem quebras de linha nem caracteres de controle (texto que vai para comandos e cabeçalhos).
fn has_control(s: &str) -> bool {
    s.chars().any(char::is_control)
}

/// Lê um endereço de servidor: minúsculo, sem espaços; só letras, números, ponto e hífen.
pub fn validate_host(host: &str) -> Result<String, ImapError> {
    let bad = || {
        let shown: String = host.trim().chars().filter(|c| !c.is_control()).take(80).collect();
        ImapError::Invalid(format!("O endereço do servidor \"{shown}\" não parece certo."))
    };
    let h = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if h.is_empty() || h.len() > 253 {
        return Err(bad());
    }
    for label in h.split('.') {
        let ok_chars = label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
        if label.is_empty() || label.len() > 63 || label.starts_with('-') || label.ends_with('-') || !ok_chars {
            return Err(bad());
        }
    }
    Ok(h)
}

fn valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else { return false };
    !local.is_empty()
        && email.len() <= 254
        && !email.chars().any(|c| c.is_whitespace() || c.is_control() || c == '<' || c == '>' || c == '"')
        && domain.contains('.')
        && validate_host(domain).is_ok()
}

impl ImapConfig {
    /// Confere e arruma a configuração (e-mail minúsculo, usuário padrão, segurança pela porta).
    pub fn validated(&self) -> Result<ImapConfig, ImapError> {
        let email = self.email.trim().to_lowercase();
        if !valid_email(&email) {
            return Err(ImapError::Invalid("Esse e-mail não parece certo. Confira e tente de novo.".into()));
        }
        if self.provider != "icloud" && self.provider != "imap" {
            return Err(ImapError::Invalid("Tipo de conta desconhecido.".into()));
        }
        if self.imap_port == 0 || self.smtp_port == 0 {
            return Err(ImapError::Invalid("A porta do servidor precisa ser um número entre 1 e 65535.".into()));
        }
        let username = self.username.trim();
        if has_control(username) || username.len() > 254 {
            return Err(ImapError::Invalid("O nome de usuário não parece certo.".into()));
        }
        let name = self
            .name
            .as_deref()
            .map(|n| n.split_whitespace().collect::<Vec<_>>().join(" "))
            .map(|n| n.chars().filter(|c| !c.is_control()).take(100).collect::<String>())
            .filter(|n| !n.is_empty());
        Ok(ImapConfig {
            username: if username.is_empty() { email.clone() } else { username.to_string() },
            email,
            name,
            provider: self.provider.clone(),
            imap_host: validate_host(&self.imap_host)?,
            imap_port: self.imap_port,
            smtp_host: validate_host(&self.smtp_host)?,
            smtp_port: self.smtp_port,
            smtp_security: self.smtp_security,
        })
    }

    pub fn security(&self) -> SmtpSecurity {
        self.smtp_security.unwrap_or_else(|| SmtpSecurity::for_port(self.smtp_port))
    }

    pub fn is_icloud(&self) -> bool {
        self.provider == "icloud"
    }
}

/// Servidores conhecidos de um provedor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Preset {
    pub label: &'static str,
    pub imap_host: &'static str,
    pub imap_port: u16,
    pub smtp_host: &'static str,
    pub smtp_port: u16,
}

const fn preset(label: &'static str, imap_host: &'static str, smtp_host: &'static str, smtp_port: u16) -> Preset {
    Preset { label, imap_host, imap_port: 993, smtp_host, smtp_port }
}

pub const ICLOUD: Preset = preset("iCloud", "imap.mail.me.com", "smtp.mail.me.com", 587);
const YAHOO: Preset = preset("Yahoo", "imap.mail.yahoo.com", "smtp.mail.yahoo.com", 465);
const ZOHO: Preset = preset("Zoho", "imap.zoho.com", "smtp.zoho.com", 465);
const FASTMAIL: Preset = preset("Fastmail", "imap.fastmail.com", "smtp.fastmail.com", 465);
const UOL: Preset = preset("UOL", "imap.uol.com.br", "smtps.uol.com.br", 587);
const BOL: Preset = preset("BOL", "imap.bol.com.br", "smtps.bol.com.br", 587);
const TERRA: Preset = preset("Terra", "imap.terra.com.br", "smtp.terra.com.br", 587);
const LOCAWEB: Preset = preset("Locaweb", "email-ssl.com.br", "email-ssl.com.br", 465);
const HOSTINGER: Preset = preset("Hostinger", "imap.hostinger.com", "smtp.hostinger.com", 465);
const KINGHOST: Preset = preset("KingHost", "imap.kinghost.net", "smtpi.kinghost.net", 465);
const GODADDY: Preset = preset("GoDaddy", "imap.secureserver.net", "smtpout.secureserver.net", 465);

/// Domínio do e-mail (depois do @), minúsculo.
pub fn email_domain(email: &str) -> Option<String> {
    email.trim().rsplit_once('@').map(|(_, d)| d.trim_end_matches('.').to_lowercase()).filter(|d| !d.is_empty())
}

/// Predefinição pelo domínio do e-mail (iCloud, Yahoo, Zoho, Fastmail, UOL, BOL, Terra).
pub fn preset_for_domain(domain: &str) -> Option<Preset> {
    Some(match domain.trim().trim_end_matches('.').to_lowercase().as_str() {
        "icloud.com" | "me.com" | "mac.com" => ICLOUD,
        "yahoo.com" | "yahoo.com.br" | "ymail.com" | "rocketmail.com" => YAHOO,
        "zoho.com" | "zohomail.com" => ZOHO,
        "fastmail.com" | "fastmail.fm" => FASTMAIL,
        "uol.com.br" => UOL,
        "bol.com.br" => BOL,
        "terra.com.br" => TERRA,
        _ => return None,
    })
}

fn is_under(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// Predefinição pelo servidor de recebimento (MX) do domínio: pega domínios próprios hospedados
/// na Locaweb, Hostinger, KingHost, GoDaddy, Zoho, Fastmail, iCloud e Yahoo.
pub fn preset_for_mx(mx: &str) -> Option<Preset> {
    let h = mx.trim().trim_end_matches('.').to_lowercase();
    let table: [(&str, Preset); 9] = [
        ("locaweb.com.br", LOCAWEB),
        ("hostinger.com", HOSTINGER),
        ("hostinger.com.br", HOSTINGER),
        ("kinghost.net", KINGHOST),
        ("secureserver.net", GODADDY),
        ("zoho.com", ZOHO),
        ("messagingengine.com", FASTMAIL),
        ("mail.icloud.com", ICLOUD),
        ("yahoodns.net", YAHOO),
    ];
    table.iter().find(|(d, _)| is_under(&h, d)).map(|(_, p)| *p)
}

/// Aviso para domínios que não entram por senha (Gmail e Outlook têm botão próprio).
pub fn domain_hint(domain: &str) -> Option<&'static str> {
    match domain.trim().to_lowercase().as_str() {
        "gmail.com" | "googlemail.com" => Some("Contas do Gmail entram mais fácil pelo botão Google."),
        "outlook.com" | "outlook.com.br" | "hotmail.com" | "hotmail.com.br" | "live.com" | "live.com.br" | "msn.com" => {
            Some("Contas Outlook e Hotmail vão entrar pelo login da Microsoft, que ainda está chegando ao Quill.")
        }
        _ => None,
    }
}

/// Configuração a partir de uma predefinição.
pub fn config_from_preset(email: &str, provider: &str, p: &Preset) -> ImapConfig {
    let email = email.trim().to_lowercase();
    ImapConfig {
        username: email.clone(),
        email,
        name: None,
        provider: provider.to_string(),
        imap_host: p.imap_host.into(),
        imap_port: p.imap_port,
        smtp_host: p.smtp_host.into(),
        smtp_port: p.smtp_port,
        smtp_security: None,
    }
}

/// Palpite genérico quando o provedor é desconhecido: imap.<domínio> e smtp.<domínio>.
pub fn generic_guess(email: &str) -> Option<ImapConfig> {
    let domain = email_domain(email)?;
    let imap = format!("imap.{domain}");
    let smtp = format!("smtp.{domain}");
    let p = Preset { label: "", imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 587 };
    Some(ImapConfig { imap_host: imap, smtp_host: smtp, ..config_from_preset(email, "imap", &p) })
}

/// Lê a resposta JSON do DNS-sobre-HTTPS (tipo MX): servidores do mais prioritário ao menos.
pub fn parse_doh_mx(json: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else { return Vec::new() };
    let mut out: Vec<(u32, String)> = v
        .get("Answer")
        .and_then(|a| a.as_array())
        .into_iter()
        .flatten()
        .filter(|a| a.get("type").and_then(|t| t.as_u64()) == Some(15))
        .filter_map(|a| {
            let data = a.get("data")?.as_str()?;
            let mut it = data.split_whitespace();
            let prio = it.next()?.parse().ok()?;
            let host = it.next()?.trim_end_matches('.').to_lowercase();
            (!host.is_empty()).then_some((prio, host))
        })
        .collect();
    out.sort();
    out.into_iter().map(|(_, h)| h).collect()
}

/// Nome de pasta IMAP em UTF-7 modificado (RFC 3501) para texto normal: "Itens Exclu&AO0-dos".
pub fn decode_mutf7(name: &str) -> String {
    use base64::Engine;
    let mut out = String::with_capacity(name.len());
    let mut rest = name;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        let Some(end) = after.find('-') else {
            out.push_str(&rest[i..]);
            return out;
        };
        let chunk = &after[..end];
        if chunk.is_empty() {
            out.push('&');
        } else {
            let decoded = base64::engine::general_purpose::STANDARD_NO_PAD
                .decode(chunk.replace(',', "/"))
                .ok()
                .filter(|b| b.len() % 2 == 0)
                .map(|b| String::from_utf16_lossy(&b.chunks(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect::<Vec<_>>()));
            match decoded {
                Some(s) => out.push_str(&s),
                None => out.push_str(&rest[i..i + 1 + end + 1]),
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

/// Uma linha da resposta do LIST.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListEntry {
    pub name: String,
    pub delimiter: Option<String>,
    /// atributos como vêm do servidor: "\\Sent", "\\Noselect"…
    pub attributes: Vec<String>,
}

impl ListEntry {
    fn has(&self, attr: &str) -> bool {
        self.attributes.iter().any(|a| a.eq_ignore_ascii_case(attr))
    }

    /// Último pedaço do nome ("INBOX.Itens Enviados" → "Itens Enviados"), já decodificado.
    fn leaf(&self) -> String {
        let delim = self.delimiter.as_deref().and_then(|d| d.chars().next());
        let leaf = self.name.rsplit(|c| c == '/' || c == '.' || Some(c) == delim).next().unwrap_or(&self.name);
        decode_mutf7(leaf)
    }
}

/// Onde fica cada pasta do app no servidor.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FolderMap {
    pub inbox: String,
    pub sent: Option<String>,
    pub drafts: Option<String>,
    pub trash: Option<String>,
    pub spam: Option<String>,
    pub archive: Option<String>,
}

const SENT_NAMES: &[&str] =
    &["Sent", "Sent Messages", "Sent Items", "Sent Mail", "Enviados", "Itens Enviados", "Mensagens Enviadas", "Enviadas", "Enviado"];
const DRAFT_NAMES: &[&str] = &["Drafts", "Draft", "Rascunhos", "Rascunho"];
const TRASH_NAMES: &[&str] = &[
    "Trash",
    "Deleted Messages",
    "Deleted Items",
    "Deleted",
    "Lixeira",
    "Lixo",
    "Itens Excluídos",
    "Itens Excluidos",
    "Excluídos",
    "Excluidos",
    "Bin",
];
const SPAM_NAMES: &[&str] =
    &["Junk", "Spam", "Junk E-mail", "Junk Email", "Lixo Eletrônico", "Lixo Eletronico", "Bulk Mail", "Bulk"];
const ARCHIVE_NAMES: &[&str] = &["Archive", "Archives", "Arquivo", "Arquivos", "Arquivados", "Arquivadas"];

impl FolderMap {
    /// Descobre as pastas pelos atributos SPECIAL-USE e, na falta deles, pelos nomes comuns.
    pub fn from_list(entries: &[ListEntry]) -> Self {
        let usable: Vec<&ListEntry> =
            entries.iter().filter(|e| !e.has("\\Noselect") && !e.has("\\NonExistent")).collect();
        let find = |attr: &str, names: &[&str]| -> Option<String> {
            if let Some(e) = usable.iter().find(|e| e.has(attr)) {
                return Some(e.name.clone());
            }
            names.iter().find_map(|n| {
                usable
                    .iter()
                    .filter(|e| !e.name.eq_ignore_ascii_case("INBOX") && e.leaf().eq_ignore_ascii_case(n))
                    .min_by_key(|e| e.name.len())
                    .map(|e| e.name.clone())
            })
        };
        FolderMap {
            inbox: usable
                .iter()
                .find(|e| e.name.eq_ignore_ascii_case("INBOX"))
                .map(|e| e.name.clone())
                .unwrap_or_else(|| "INBOX".into()),
            sent: find("\\Sent", SENT_NAMES),
            drafts: find("\\Drafts", DRAFT_NAMES),
            trash: find("\\Trash", TRASH_NAMES),
            spam: find("\\Junk", SPAM_NAMES),
            archive: find("\\Archive", ARCHIVE_NAMES),
        }
    }

    /// Pasta do servidor para um id do app ("inbox", "sent"…).
    pub fn mailbox(&self, id: &str) -> Option<&str> {
        match id {
            "inbox" => Some(&self.inbox),
            "sent" => self.sent.as_deref(),
            "drafts" => self.drafts.as_deref(),
            "trash" => self.trash.as_deref(),
            "spam" => self.spam.as_deref(),
            "archive" => self.archive.as_deref(),
            _ => None,
        }
    }
}

/// Id de um e-mail no app: `<pasta do app>:<uid>`.
pub fn make_id(folder: &str, uid: u32) -> String {
    format!("{folder}:{uid}")
}

/// Lê um id `<pasta>:<uid>` (a pasta precisa ser uma das do app).
pub fn parse_id(id: &str) -> Result<(&str, u32), ImapError> {
    let bad = || ImapError::Invalid("Não reconheci esse e-mail. Atualize a lista e tente de novo.".into());
    let (folder, uid) = id.rsplit_once(':').ok_or_else(bad)?;
    let folder = FOLDER_IDS.iter().find(|f| **f == folder).ok_or_else(bad)?;
    let uid: u32 = uid.parse().map_err(|_| bad())?;
    if uid == 0 {
        return Err(bad());
    }
    Ok((folder, uid))
}

/// Marcas de um e-mail no servidor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Flags {
    pub seen: bool,
    pub flagged: bool,
    pub deleted: bool,
}

fn first_sender(list: Option<mail_parser::AddressList<'_>>) -> Option<Sender> {
    let m = list?.first()?;
    let email = m.address().unwrap_or_default().trim().to_string();
    let name = m.name().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string).unwrap_or_else(|| email.clone());
    (!email.is_empty() || !name.is_empty()).then_some(Sender { name, email })
}

fn address_strings(list: Option<mail_parser::AddressList<'_>>) -> Vec<String> {
    list.map(|l| {
        l.mailboxes()
            .filter_map(|m| {
                let email = m.address()?.trim().to_string();
                Some(match m.name().map(str::trim).filter(|n| !n.is_empty()) {
                    Some(n) => format!("{n} <{email}>"),
                    None => email,
                })
            })
            .collect()
    })
    .unwrap_or_default()
}

const PREVIEW_CHARS: usize = 200;

fn clean_preview(text: &str) -> String {
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.chars().count() <= PREVIEW_CHARS {
        return joined;
    }
    let cut: String = joined.chars().take(PREVIEW_CHARS).collect();
    format!("{}…", cut.trim_end())
}

/// Resumo para a lista a partir do cabeçalho e do começo do texto (BODY.PEEK[HEADER] e [TEXT]<0.N>).
pub fn summary_from_parts(
    id: String,
    flags: Flags,
    internal_date_ms: Option<i64>,
    header: &[u8],
    text_head: &[u8],
    now_ms: i64,
    tz_offset_min: i32,
) -> MessageSummary {
    let mut raw = Vec::with_capacity(header.len() + text_head.len() + 4);
    raw.extend_from_slice(header);
    // o cabeçalho termina com uma linha em branco; garante isso mesmo se o servidor cortar
    if !(header.ends_with(b"\r\n\r\n") || header.ends_with(b"\n\n")) {
        raw.extend_from_slice(if header.ends_with(b"\n") { b"\r\n" } else { b"\r\n\r\n" });
    }
    raw.extend_from_slice(text_head);
    let parsed = MessageParser::default().parse(&raw);

    let from = parsed.as_ref().and_then(|m| first_sender(m.from())).unwrap_or(Sender { name: String::new(), email: String::new() });
    let to = parsed.as_ref().and_then(|m| first_sender(m.to()));
    let subject = parsed
        .as_ref()
        .and_then(|m| m.subject())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "(sem assunto)".into());
    let preview = parsed.as_ref().and_then(|m| m.body_preview(PREVIEW_CHARS * 3)).map(|p| clean_preview(&p)).unwrap_or_default();
    let internal_date = internal_date_ms
        .or_else(|| parsed.as_ref().and_then(|m| m.date()).map(|d| d.to_timestamp() * 1000))
        .unwrap_or(0);
    let has_attachment = parsed
        .as_ref()
        .map(|m| m.is_content_type("multipart", "mixed") || m.has_attachments())
        .unwrap_or(false);
    MessageSummary {
        thread_id: id.clone(),
        id,
        initials: initials(&from.name),
        from,
        to,
        subject,
        preview,
        date: format_list_date(internal_date, now_ms, tz_offset_min),
        internal_date,
        unread: !flags.seen,
        starred: flags.flagged,
        has_attachment,
    }
}

fn real_html(m: &mail_parser::Message<'_>) -> Option<String> {
    m.html_body().find(|p| matches!(p.kind(), PartKind::Html)).and_then(|p| p.text()).map(|t| t.into_owned())
}

fn plain_text(m: &mail_parser::Message<'_>) -> String {
    m.body_text(0).map(|t| t.replace("\r\n", "\n").trim().to_string()).unwrap_or_default()
}

/// Texto, HTML e anexos de um e-mail inteiro (BODY.PEEK[]).
pub fn body_from_raw(raw: &[u8]) -> MessageBody {
    let Some(m) = MessageParser::default().parse(raw) else {
        return MessageBody { text: String::from_utf8_lossy(raw).into_owned(), html: None, attachments: Vec::new() };
    };
    let attachments = m
        .attachments()
        .enumerate()
        .map(|(i, part)| {
            let mime_type = part
                .content_type()
                .map(|ct| format!("{}/{}", ct.ctype(), ct.subtype().unwrap_or("octet-stream")).to_lowercase())
                .unwrap_or_else(|| "application/octet-stream".into());
            let name = part
                .attachment_name()
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .map(str::to_string)
                .or_else(|| part.nested().and_then(|n| n.subject().map(|s| format!("{}.eml", s.trim()))))
                .unwrap_or_else(|| if mime_type == "message/rfc822" { "mensagem.eml".into() } else { "anexo".into() });
            let content_id = part
                .content_id()
                .map(|c| c.trim().trim_start_matches('<').trim_end_matches('>').to_string())
                .filter(|c| !c.is_empty());
            AttachmentInfo { id: i.to_string(), name, mime_type, size: part.decoded_len() as u64, content_id }
        })
        .collect();
    MessageBody { text: plain_text(&m), html: real_html(&m), attachments }
}

/// Conteúdo de um anexo (o id é a posição dele em `body_from_raw`).
pub fn attachment_from_raw(raw: &[u8], attachment_id: &str) -> Option<Vec<u8>> {
    let index: usize = attachment_id.parse().ok()?;
    let m = MessageParser::default().parse(raw)?;
    let part = m.attachments().nth(index)?;
    Some(part.decoded().into_owned())
}

/// Rascunho guardado na pasta Rascunhos, para continuar escrevendo.
pub fn draft_from_raw(raw: &[u8], draft_id: &str) -> DraftContent {
    let parsed = MessageParser::default().parse(raw);
    DraftContent {
        draft_id: draft_id.to_string(),
        to: parsed.as_ref().map(|m| address_strings(m.to())).unwrap_or_default(),
        cc: parsed.as_ref().map(|m| address_strings(m.cc())).unwrap_or_default(),
        bcc: parsed.as_ref().map(|m| address_strings(m.bcc())).unwrap_or_default(),
        subject: parsed.as_ref().and_then(|m| m.subject()).unwrap_or_default().trim().to_string(),
        html: parsed.as_ref().and_then(real_html),
        text: parsed.as_ref().map(plain_text).unwrap_or_default(),
    }
}

/// Dia civil (ano, mês, dia) a partir de dias desde 1970-01-01 (algoritmo de Howard Hinnant).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Data no formato dos cabeçalhos de e-mail (RFC 2822), em UTC.
pub fn rfc2822_date(ms: i64) -> String {
    const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{}, {d:02} {} {y} {:02}:{:02}:{:02} +0000",
        DAYS[(days + 4).rem_euclid(7) as usize],
        MONTHS[m as usize - 1],
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
    )
}

/// Põe Date e Message-ID no começo do e-mail montado por `build_mime` (o Gmail punha sozinho).
pub fn with_date_and_id(mime: &str, message_id: &str, now_ms: i64) -> String {
    let id = message_id.replace(['\r', '\n'], "");
    format!("Date: {}\r\nMessage-ID: {id}\r\n{mime}", rfc2822_date(now_ms))
}

/// Tira o cabeçalho Bcc antes de entregar ao SMTP (quem recebe não pode ver as cópias ocultas).
pub fn strip_bcc(mime: &str) -> String {
    let (head, body) = match mime.find("\r\n\r\n") {
        Some(i) => (&mime[..i], &mime[i..]),
        None => (mime, ""),
    };
    let mut out: Vec<&str> = Vec::new();
    let mut skipping = false;
    for line in head.split("\r\n") {
        let continuation = line.starts_with(' ') || line.starts_with('\t');
        if continuation && skipping {
            continue;
        }
        skipping = !continuation && line.len() >= 4 && line[..4].eq_ignore_ascii_case("bcc:");
        if !skipping {
            out.push(line);
        }
    }
    format!("{}{body}", out.join("\r\n"))
}

/// Endereços (só o e-mail) de uma lista "Nome <email>, email".
pub fn envelope_addresses(list: &[String]) -> Vec<String> {
    list.iter()
        .flat_map(|s| crate::contacts::parse_address_list(s))
        .map(|(_, e)| e.trim().to_string())
        .filter(|e| e.contains('@'))
        .collect()
}

/// Critério do UID SEARCH para um texto. Texto com acento vai como literal (`{n+}`) quando o
/// servidor aceita LITERAL+; senão, entre aspas em UTF-8 (a maioria aceita com CHARSET UTF-8).
pub fn search_criteria(text: &str, literal_plus: bool) -> String {
    let clean = text.replace(['\r', '\n'], " ");
    let quoted = || format!("\"{}\"", clean.replace('\\', "\\\\").replace('"', "\\\""));
    if clean.is_ascii() {
        format!("TEXT {}", quoted())
    } else if literal_plus {
        format!("CHARSET UTF-8 TEXT {{{}+}}\r\n{clean}", clean.len())
    } else {
        format!("CHARSET UTF-8 TEXT {}", quoted())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(email: &str) -> ImapConfig {
        ImapConfig {
            email: email.into(),
            name: Some("Gabriel".into()),
            provider: "imap".into(),
            imap_host: "imap.exemplo.com".into(),
            imap_port: 993,
            smtp_host: "smtp.exemplo.com".into(),
            smtp_port: 587,
            smtp_security: None,
            username: String::new(),
        }
    }

    // ---- configuração ----

    #[test]
    fn smtp_security_follows_the_port() {
        assert_eq!(SmtpSecurity::for_port(465), SmtpSecurity::Tls);
        assert_eq!(SmtpSecurity::for_port(587), SmtpSecurity::Starttls);
        assert_eq!(SmtpSecurity::for_port(25), SmtpSecurity::Starttls);
    }

    #[test]
    fn host_is_lowercased_and_trimmed() {
        assert_eq!(validate_host("  IMAP.Mail.Me.com. ").unwrap(), "imap.mail.me.com");
    }

    #[test]
    fn host_with_strange_characters_is_rejected() {
        for bad in ["", "imap mail.com", "imap.com/x", "imap.com:993", "-imap.com", "imap..com", "a\r\nb.com", "ímap.com"] {
            assert!(validate_host(bad).is_err(), "{bad:?} deveria ser recusado");
        }
        assert!(validate_host(&format!("{}.com", "a".repeat(64))).is_err());
    }

    #[test]
    fn validated_config_fills_username_and_lowercases_email() {
        let c = ImapConfig { email: " Gabriel@Exemplo.COM ".into(), ..cfg("x") }.validated().unwrap();
        assert_eq!(c.email, "gabriel@exemplo.com");
        assert_eq!(c.username, "gabriel@exemplo.com");
    }

    #[test]
    fn validated_config_keeps_custom_username() {
        let c = ImapConfig { username: "gabriel".into(), ..cfg("g@exemplo.com") }.validated().unwrap();
        assert_eq!(c.username, "gabriel");
    }

    #[test]
    fn validated_config_rejects_bad_email_port_and_provider() {
        assert!(cfg("sem-arroba").validated().is_err());
        assert!(cfg("a@semponto").validated().is_err());
        assert!(cfg("a b@x.com").validated().is_err());
        assert!(ImapConfig { imap_port: 0, ..cfg("a@x.com") }.validated().is_err());
        assert!(ImapConfig { provider: "google".into(), ..cfg("a@x.com") }.validated().is_err());
        assert!(ImapConfig { username: "a\r\nb".into(), ..cfg("a@x.com") }.validated().is_err());
    }

    #[test]
    fn validated_config_cleans_the_name() {
        let c = ImapConfig { name: Some("  Gabriel\r\nVianna ".into()), ..cfg("a@x.com") }.validated().unwrap();
        assert_eq!(c.name.as_deref(), Some("Gabriel Vianna"));
        let empty = ImapConfig { name: Some("   ".into()), ..cfg("a@x.com") }.validated().unwrap();
        assert_eq!(empty.name, None);
    }

    #[test]
    fn config_reads_old_json_without_optional_fields() {
        let c: ImapConfig = serde_json::from_str(
            r#"{"email":"a@x.com","imapHost":"imap.x.com","imapPort":993,"smtpHost":"smtp.x.com","smtpPort":465}"#,
        )
        .unwrap();
        assert_eq!(c.provider, "imap");
        assert_eq!(c.security(), SmtpSecurity::Tls);
    }

    // ---- predefinições ----

    #[test]
    fn email_domain_is_lowercased() {
        assert_eq!(email_domain("Gabriel@ICloud.com").as_deref(), Some("icloud.com"));
        assert_eq!(email_domain("sem-arroba"), None);
    }

    #[test]
    fn icloud_domains_use_apple_servers() {
        for d in ["icloud.com", "me.com", "mac.com"] {
            let p = preset_for_domain(d).unwrap();
            assert_eq!((p.imap_host, p.imap_port, p.smtp_host, p.smtp_port), ("imap.mail.me.com", 993, "smtp.mail.me.com", 587));
        }
    }

    #[test]
    fn common_providers_have_presets() {
        assert_eq!(preset_for_domain("yahoo.com.br").unwrap().imap_host, "imap.mail.yahoo.com");
        assert_eq!(preset_for_domain("zohomail.com").unwrap().smtp_host, "smtp.zoho.com");
        assert_eq!(preset_for_domain("fastmail.com").unwrap().imap_host, "imap.fastmail.com");
        assert_eq!(preset_for_domain("uol.com.br").unwrap().smtp_host, "smtps.uol.com.br");
        assert_eq!(preset_for_domain("bol.com.br").unwrap().imap_host, "imap.bol.com.br");
        assert_eq!(preset_for_domain("terra.com.br").unwrap().imap_host, "imap.terra.com.br");
        assert_eq!(preset_for_domain("minhaempresa.com.br"), None);
    }

    #[test]
    fn hosting_companies_are_found_by_mx() {
        assert_eq!(preset_for_mx("mx.core.locaweb.com.br.").unwrap().imap_host, "email-ssl.com.br");
        assert_eq!(preset_for_mx("mx1.hostinger.com").unwrap().imap_host, "imap.hostinger.com");
        assert_eq!(preset_for_mx("mx.kinghost.net").unwrap().smtp_host, "smtpi.kinghost.net");
        assert_eq!(preset_for_mx("mailstore1.secureserver.net").unwrap().smtp_host, "smtpout.secureserver.net");
        assert_eq!(preset_for_mx("MX.ZOHO.COM").unwrap().imap_host, "imap.zoho.com");
        assert_eq!(preset_for_mx("in1-smtp.messagingengine.com").unwrap().imap_host, "imap.fastmail.com");
        assert_eq!(preset_for_mx("mx01.mail.icloud.com").unwrap().imap_host, "imap.mail.me.com");
        assert_eq!(preset_for_mx("mail.exemplo.com"), None);
    }

    #[test]
    fn gmail_and_outlook_get_a_hint() {
        assert!(domain_hint("gmail.com").unwrap().contains("Google"));
        assert!(domain_hint("hotmail.com").unwrap().contains("Microsoft"));
        assert_eq!(domain_hint("icloud.com"), None);
    }

    #[test]
    fn config_from_preset_uses_email_as_username() {
        let p = preset_for_domain("icloud.com").unwrap();
        let c = config_from_preset("Ana@iCloud.com", "icloud", &p);
        assert_eq!(c.email, "ana@icloud.com");
        assert_eq!(c.username, "ana@icloud.com");
        assert_eq!(c.provider, "icloud");
        assert_eq!(c.security(), SmtpSecurity::Starttls);
    }

    #[test]
    fn generic_guess_uses_domain() {
        let c = generic_guess("ana@minhaempresa.com.br").unwrap();
        assert_eq!((c.imap_host.as_str(), c.imap_port), ("imap.minhaempresa.com.br", 993));
        assert_eq!((c.smtp_host.as_str(), c.smtp_port), ("smtp.minhaempresa.com.br", 587));
    }

    #[test]
    fn doh_mx_answer_is_sorted_by_priority() {
        let json = r#"{"Status":0,"Answer":[
            {"name":"x.com.","type":15,"TTL":300,"data":"20 mx2.locaweb.com.br."},
            {"name":"x.com.","type":15,"TTL":300,"data":"10 mx.core.locaweb.com.br."},
            {"name":"x.com.","type":5,"TTL":300,"data":"alias.x.com."}]}"#;
        assert_eq!(parse_doh_mx(json), vec!["mx.core.locaweb.com.br", "mx2.locaweb.com.br"]);
        assert!(parse_doh_mx(r#"{"Status":3}"#).is_empty());
        assert!(parse_doh_mx("lixo").is_empty());
    }

    // ---- pastas ----

    #[test]
    fn mutf7_names_are_decoded() {
        assert_eq!(decode_mutf7("Itens Exclu&AO0-dos"), "Itens Excluídos");
        assert_eq!(decode_mutf7("Lixo Eletr&APQ-nico"), "Lixo Eletrônico");
        assert_eq!(decode_mutf7("A &- B"), "A & B");
        assert_eq!(decode_mutf7("Sent"), "Sent");
    }

    fn entry(name: &str, attrs: &[&str]) -> ListEntry {
        ListEntry { name: name.into(), delimiter: Some("/".into()), attributes: attrs.iter().map(|a| a.to_string()).collect() }
    }

    #[test]
    fn special_use_attributes_win() {
        let map = FolderMap::from_list(&[
            entry("INBOX", &[]),
            entry("Sent", &[]),
            entry("Enviadas pelo app", &["\\Sent"]),
            entry("Drafts", &["\\Drafts"]),
            entry("Deleted Messages", &["\\Trash"]),
            entry("Junk", &["\\Junk"]),
            entry("Archive", &["\\Archive"]),
        ]);
        assert_eq!(map.inbox, "INBOX");
        assert_eq!(map.sent.as_deref(), Some("Enviadas pelo app"));
        assert_eq!(map.drafts.as_deref(), Some("Drafts"));
        assert_eq!(map.trash.as_deref(), Some("Deleted Messages"));
        assert_eq!(map.spam.as_deref(), Some("Junk"));
        assert_eq!(map.archive.as_deref(), Some("Archive"));
    }

    #[test]
    fn common_names_are_used_without_special_use() {
        let map = FolderMap::from_list(&[
            entry("Inbox", &[]),
            entry("INBOX.Itens Enviados", &[]),
            entry("INBOX.Rascunhos", &[]),
            entry("INBOX.Lixo Eletr&APQ-nico", &[]),
            entry("INBOX.Itens Exclu&AO0-dos", &[]),
            entry("INBOX.Arquivo", &[]),
        ]);
        assert_eq!(map.inbox, "Inbox");
        assert_eq!(map.sent.as_deref(), Some("INBOX.Itens Enviados"));
        assert_eq!(map.drafts.as_deref(), Some("INBOX.Rascunhos"));
        assert_eq!(map.spam.as_deref(), Some("INBOX.Lixo Eletr&APQ-nico"));
        assert_eq!(map.trash.as_deref(), Some("INBOX.Itens Exclu&AO0-dos"));
        assert_eq!(map.archive.as_deref(), Some("INBOX.Arquivo"));
    }

    #[test]
    fn icloud_style_names_are_found() {
        let map = FolderMap::from_list(&[
            entry("INBOX", &[]),
            entry("Sent Messages", &[]),
            entry("Deleted Messages", &[]),
            entry("Junk", &[]),
            entry("Drafts", &[]),
        ]);
        assert_eq!(map.sent.as_deref(), Some("Sent Messages"));
        assert_eq!(map.trash.as_deref(), Some("Deleted Messages"));
        assert_eq!(map.archive, None);
        assert_eq!(map.mailbox("sent"), Some("Sent Messages"));
        assert_eq!(map.mailbox("inbox"), Some("INBOX"));
        assert_eq!(map.mailbox("archive"), None);
        assert_eq!(map.mailbox("starred"), None);
    }

    #[test]
    fn noselect_folders_are_ignored() {
        let map = FolderMap::from_list(&[entry("INBOX", &[]), entry("Sent", &["\\Noselect"])]);
        assert_eq!(map.sent, None);
    }

    #[test]
    fn missing_inbox_defaults_to_inbox_name() {
        assert_eq!(FolderMap::from_list(&[]).inbox, "INBOX");
    }

    // ---- ids ----

    #[test]
    fn ids_round_trip() {
        assert_eq!(make_id("inbox", 42), "inbox:42");
        assert_eq!(parse_id("trash:7").unwrap(), ("trash", 7));
    }

    #[test]
    fn bad_ids_are_rejected() {
        for bad in ["", "inbox", "inbox:", "inbox:x", "starred:1", "INBOX:1", "inbox:0", "../etc:1"] {
            assert!(parse_id(bad).is_err(), "{bad:?}");
        }
    }

    // ---- leitura ----

    const NOW: i64 = 1_763_380_800_000; // 17/11/2025 12:00 UTC

    #[test]
    fn summary_reads_encoded_headers_and_preview() {
        let header = b"From: =?UTF-8?Q?Jo=C3=A3o_Silva?= <joao@exemplo.com>\r\nTo: Ana <ana@icloud.com>, b@x.com\r\nSubject: =?UTF-8?B?UmV1bmnDo28=?=\r\nDate: Mon, 17 Nov 2025 09:00:00 -0300\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n";
        let s = summary_from_parts(
            "inbox:5".into(),
            Flags { seen: false, flagged: true, deleted: false },
            Some(NOW - 3_600_000),
            header,
            b"Ol\xc3\xa1,\r\n\r\n  vamos   marcar?\r\n",
            NOW,
            -180,
        );
        assert_eq!(s.id, "inbox:5");
        assert_eq!(s.thread_id, "inbox:5");
        assert_eq!(s.from, Sender { name: "João Silva".into(), email: "joao@exemplo.com".into() });
        assert_eq!(s.to, Some(Sender { name: "Ana".into(), email: "ana@icloud.com".into() }));
        assert_eq!(s.initials, "JS");
        assert_eq!(s.subject, "Reunião");
        assert_eq!(s.preview, "Olá, vamos marcar?");
        assert_eq!(s.date, "08:00");
        assert_eq!(s.internal_date, NOW - 3_600_000);
        assert!(s.unread);
        assert!(s.starred);
        assert!(!s.has_attachment);
    }

    #[test]
    fn summary_without_subject_or_internal_date() {
        let header = b"From: alguem@x.com\r\nDate: Sun, 16 Nov 2025 10:00:00 +0000\r\n\r\n";
        let s = summary_from_parts("sent:1".into(), Flags { seen: true, ..Default::default() }, None, header, b"", NOW, 0);
        assert_eq!(s.subject, "(sem assunto)");
        assert_eq!(s.from.name, "alguem@x.com");
        assert_eq!(s.internal_date, 1_763_287_200_000);
        assert_eq!(s.date, "Ontem");
        assert!(!s.unread);
    }

    #[test]
    fn summary_of_html_multipart_with_attachment() {
        let header = b"From: Loja <loja@x.com>\r\nSubject: Pedido\r\nContent-Type: multipart/mixed; boundary=\"b1\"\r\n\r\n";
        let text = b"--b1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><style>p{color:red}</style><p>Seu <b>pedido</b> chegou</p></html>\r\n--b1\r\nContent-Type: application/pdf; name=\"nota.pdf\"\r\nContent-Disposition: attachment; filename=\"nota.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0x";
        let s = summary_from_parts("inbox:9".into(), Flags::default(), Some(NOW), header, text, NOW, 0);
        assert!(s.has_attachment);
        assert_eq!(s.preview, "Seu pedido chegou");
    }

    #[test]
    fn long_preview_is_cut() {
        let header = b"From: a@x.com\r\nSubject: x\r\n\r\n";
        let text = "palavra ".repeat(100);
        let s = summary_from_parts("inbox:1".into(), Flags::default(), Some(NOW), header, text.as_bytes(), NOW, 0);
        assert!(s.preview.chars().count() <= 201, "{}", s.preview.len());
        assert!(s.preview.ends_with('…'));
    }

    const FULL: &[u8] = b"From: Ana <ana@x.com>\r\nTo: g@icloud.com\r\nCc: \"Bia\" <bia@x.com>\r\nBcc: c@x.com\r\nSubject: Fotos\r\nMessage-ID: <abc@x.com>\r\nContent-Type: multipart/mixed; boundary=\"m\"\r\n\r\n--m\r\nContent-Type: multipart/related; boundary=\"r\"\r\n\r\n--r\r\nContent-Type: multipart/alternative; boundary=\"a\"\r\n\r\n--a\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nVeja as fotos\r\n--a\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Veja as fotos <img src=\"cid:logo@x\"></p>\r\n--a--\r\n--r\r\nContent-Type: image/png\r\nContent-ID: <logo@x>\r\nContent-Disposition: inline; filename=\"logo.png\"\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--r--\r\n--m\r\nContent-Type: application/pdf; name=\"Relat=?UTF-8?Q?=C3=B3?=rio.pdf\"\r\nContent-Disposition: attachment; filename*=UTF-8''Relat%C3%B3rio.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQ=\r\n--m--\r\n";

    #[test]
    fn body_has_text_html_and_attachments() {
        let b = body_from_raw(FULL);
        assert_eq!(b.text, "Veja as fotos");
        assert!(b.html.as_deref().unwrap().contains("cid:logo@x"));
        assert_eq!(b.attachments.len(), 2);
        assert_eq!(
            b.attachments[0],
            AttachmentInfo { id: "0".into(), name: "logo.png".into(), mime_type: "image/png".into(), size: 5, content_id: Some("logo@x".into()) }
        );
        assert_eq!(b.attachments[1].name, "Relatório.pdf");
        assert_eq!(b.attachments[1].mime_type, "application/pdf");
        assert_eq!(b.attachments[1].content_id, None);
    }

    #[test]
    fn plain_message_has_no_html() {
        let b = body_from_raw(b"From: a@x.com\r\nSubject: oi\r\n\r\nLinha 1\r\nLinha 2\r\n");
        assert_eq!(b.text, "Linha 1\nLinha 2");
        assert_eq!(b.html, None);
        assert!(b.attachments.is_empty());
    }

    #[test]
    fn html_only_message_gets_text_version() {
        let b = body_from_raw(b"From: a@x.com\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Oi <b>Ana</b></p>");
        assert_eq!(b.text, "Oi Ana");
        assert!(b.html.unwrap().contains("<b>Ana</b>"));
    }

    #[test]
    fn attachment_bytes_by_position() {
        assert_eq!(attachment_from_raw(FULL, "0").unwrap(), b"hello");
        assert_eq!(attachment_from_raw(FULL, "1").unwrap(), b"%PDF-1.4");
        assert_eq!(attachment_from_raw(FULL, "2"), None);
        assert_eq!(attachment_from_raw(FULL, "x"), None);
    }

    #[test]
    fn draft_is_read_back() {
        let d = draft_from_raw(FULL, "drafts:3");
        assert_eq!(d.draft_id, "drafts:3");
        assert_eq!(d.to, vec!["g@icloud.com"]);
        assert_eq!(d.cc, vec!["Bia <bia@x.com>"]);
        assert_eq!(d.bcc, vec!["c@x.com"]);
        assert_eq!(d.subject, "Fotos");
        assert_eq!(d.text, "Veja as fotos");
        assert!(d.html.is_some());
    }

    // ---- envio ----

    #[test]
    fn rfc2822_date_in_utc() {
        assert_eq!(rfc2822_date(NOW), "Mon, 17 Nov 2025 12:00:00 +0000");
        assert_eq!(rfc2822_date(0), "Thu, 01 Jan 1970 00:00:00 +0000");
    }

    #[test]
    fn date_and_message_id_go_first() {
        let out = with_date_and_id("From: a@x.com\r\nTo: b@x.com\r\n\r\nOi", "<id1@x.com>", NOW);
        assert!(out.starts_with("Date: Mon, 17 Nov 2025 12:00:00 +0000\r\nMessage-ID: <id1@x.com>\r\nFrom: a@x.com\r\n"));
    }

    #[test]
    fn bcc_header_is_removed_but_body_kept() {
        let mime = "From: a@x.com\r\nTo: b@x.com\r\nBcc: c@x.com,\r\n d@x.com\r\nSubject: s\r\n\r\nBcc: no corpo fica\r\n";
        let out = strip_bcc(mime);
        assert_eq!(out, "From: a@x.com\r\nTo: b@x.com\r\nSubject: s\r\n\r\nBcc: no corpo fica\r\n");
    }

    #[test]
    fn envelope_takes_only_addresses() {
        let list = vec!["Ana <ana@x.com>".to_string(), " b@x.com ".to_string(), "".to_string()];
        assert_eq!(envelope_addresses(&list), vec!["ana@x.com", "b@x.com"]);
    }

    #[test]
    fn search_criteria_quotes_and_escapes() {
        assert_eq!(search_criteria("nota fiscal", true), "TEXT \"nota fiscal\"");
        assert_eq!(search_criteria("a\"b\\c", false), "TEXT \"a\\\"b\\\\c\"");
        assert_eq!(search_criteria("reunião", true), "CHARSET UTF-8 TEXT {8+}\r\nreunião");
        assert_eq!(search_criteria("reunião", false), "CHARSET UTF-8 TEXT \"reunião\"");
        assert_eq!(search_criteria("a\r\nb", false), "TEXT \"a  b\"");
    }
}
