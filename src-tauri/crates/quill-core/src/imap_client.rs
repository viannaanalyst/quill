//! Conversa com servidores IMAP (ler e organizar) e SMTP (enviar), sempre com TLS (rustls).
//! Só existe com o recurso `net`. A senha chega de fora (cofre do sistema) e nunca vai para log.

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use async_imap::types::{Fetch, Flag};
use futures_util::TryStreamExt;
use serde::Serialize;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_rustls::rustls;

use crate::gmail::{DraftContent, MessageBody, MessageSummary, OutgoingMessage, build_mime};
use crate::imap::{
    Flags, FolderMap, ImapConfig, ImapError, ListEntry, SmtpSecurity, attachment_from_raw, body_from_raw,
    config_from_preset, domain_hint, draft_from_raw, email_domain, envelope_addresses, generic_guess, make_id, parse_doh_mx,
    parse_id, preset_for_domain, preset_for_mx, search_criteria, strip_bcc, summary_from_parts, validate_host,
    with_date_and_id,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const OP_TIMEOUT: Duration = Duration::from_secs(90);
/// conexão parada há mais tempo que isso é descartada (o servidor costuma fechar)
const IDLE_LIMIT: Duration = Duration::from_secs(8 * 60);
const MAX_IDLE_PER_ACCOUNT: usize = 4;
/// quanto do texto pedir para a prévia da lista
const PREVIEW_BYTES: u32 = 3000;

/// Conexão TCP comum (só nos testes) ou com TLS.
#[derive(Debug)]
pub enum Stream {
    Plain(TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
}

impl AsyncRead for Stream {
    fn poll_read(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Stream::Plain(s) => Pin::new(s).poll_read(cx, buf),
            Stream::Tls(s) => Pin::new(s.as_mut()).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for Stream {
    fn poll_write(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<std::io::Result<usize>> {
        match self.get_mut() {
            Stream::Plain(s) => Pin::new(s).poll_write(cx, buf),
            Stream::Tls(s) => Pin::new(s.as_mut()).poll_write(cx, buf),
        }
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Stream::Plain(s) => Pin::new(s).poll_flush(cx),
            Stream::Tls(s) => Pin::new(s.as_mut()).poll_flush(cx),
        }
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Stream::Plain(s) => Pin::new(s).poll_shutdown(cx),
            Stream::Tls(s) => Pin::new(s.as_mut()).poll_shutdown(cx),
        }
    }
}

type Session = async_imap::Session<Stream>;

/// Uma conexão já autenticada, com o que o servidor sabe fazer.
struct Conn {
    session: Session,
    can_move: bool,
    uidplus: bool,
    literal_plus: bool,
    last_used: Instant,
}

/// Erro dentro de uma operação: do protocolo (pode ser conexão caída) ou já explicado.
enum OpErr {
    Imap(async_imap::error::Error),
    App(ImapError),
}

impl From<async_imap::error::Error> for OpErr {
    fn from(e: async_imap::error::Error) -> Self {
        OpErr::Imap(e)
    }
}

impl From<ImapError> for OpErr {
    fn from(e: ImapError) -> Self {
        OpErr::App(e)
    }
}

impl OpErr {
    /// conexão caída: vale tentar de novo com uma conexão nova
    fn is_connection(&self) -> bool {
        matches!(self, OpErr::Imap(async_imap::error::Error::Io(_) | async_imap::error::Error::ConnectionLost))
    }

    fn into_imap(self) -> ImapError {
        use async_imap::error::Error as E;
        match self {
            OpErr::App(e) => e,
            OpErr::Imap(E::No(m) | E::Bad(m)) => ImapError::Server(clean_server_text(&m)),
            OpErr::Imap(E::Io(_) | E::ConnectionLost) => ImapError::Server("a conexão caiu. Tente de novo.".into()),
            OpErr::Imap(E::Append) => ImapError::Server("não aceitou guardar o e-mail na pasta.".into()),
            OpErr::Imap(_) => ImapError::Server("resposta inesperada do servidor.".into()),
        }
    }
}

/// Texto do servidor para mostrar (sem códigos entre colchetes e sem controle).
fn clean_server_text(m: &str) -> String {
    let t = m.trim();
    let t = match (t.starts_with('['), t.find(']')) {
        (true, Some(i)) => t[i + 1..].trim(),
        _ => t,
    };
    let t: String = t.chars().filter(|c| !c.is_control()).take(200).collect();
    if t.is_empty() { "erro desconhecido".into() } else { t }
}

/// Resultado do palpite de servidores para um e-mail.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Guess {
    pub config: Option<ImapConfig>,
    /// "known" (domínio conhecido), "mx" (achado pelo servidor do domínio) ou "generic"
    pub source: String,
    /// nome do provedor reconhecido, quando houver
    pub label: Option<String>,
    /// aviso para mostrar (ex.: Gmail tem botão próprio)
    pub hint: Option<String>,
}

pub struct ImapClient {
    tls: Option<Arc<rustls::ClientConfig>>,
    pool: Mutex<HashMap<String, Vec<Conn>>>,
    folders: Mutex<HashMap<String, FolderMap>>,
    http: reqwest::Client,
    doh_url: String,
    /// só nos testes: conversa sem TLS com os servidores falsos
    plain: bool,
}

fn tls_config() -> Result<Arc<rustls::ClientConfig>, String> {
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    // verificador do sistema (Chaves do macOS / Windows), igual ao do navegador
    let verifier = rustls_platform_verifier::Verifier::new(provider.clone()).map_err(|e| e.to_string())?;
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    Ok(Arc::new(config))
}

impl Default for ImapClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Converte as marcas do servidor.
fn flags_of(f: &Fetch) -> Flags {
    let mut out = Flags::default();
    for flag in f.flags() {
        match flag {
            Flag::Seen => out.seen = true,
            Flag::Flagged => out.flagged = true,
            Flag::Deleted => out.deleted = true,
            _ => {}
        }
    }
    out
}

fn list_entry(n: &async_imap::types::Name) -> ListEntry {
    use async_imap::imap_proto::NameAttribute as A;
    let attributes = n
        .attributes()
        .iter()
        .map(|a| match a {
            A::NoInferiors => "\\Noinferiors".to_string(),
            A::NoSelect => "\\Noselect".to_string(),
            A::Marked => "\\Marked".to_string(),
            A::Unmarked => "\\Unmarked".to_string(),
            A::All => "\\All".to_string(),
            A::Archive => "\\Archive".to_string(),
            A::Drafts => "\\Drafts".to_string(),
            A::Flagged => "\\Flagged".to_string(),
            A::Junk => "\\Junk".to_string(),
            A::Sent => "\\Sent".to_string(),
            A::Trash => "\\Trash".to_string(),
            A::Extension(s) => s.to_string(),
            #[allow(unreachable_patterns)]
            _ => String::new(),
        })
        .collect();
    ListEntry { name: n.name().to_string(), delimiter: n.delimiter().map(str::to_string), attributes }
}

/// Nome padrão ao criar uma pasta que falta.
fn default_folder_name(folder: &str) -> Option<&'static str> {
    match folder {
        "archive" => Some("Archive"),
        "trash" => Some("Trash"),
        "spam" => Some("Junk"),
        "drafts" => Some("Drafts"),
        "sent" => Some("Sent"),
        _ => None,
    }
}

/// Servidores que já guardam sozinhos o que sai pelo SMTP (não precisa APPEND em Enviados).
fn server_saves_sent(cfg: &ImapConfig) -> bool {
    ["gmail.com", "googlemail.com"].iter().any(|d| cfg.smtp_host == *d || cfg.smtp_host.ends_with(&format!(".{d}")))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn message_id_for(email: &str) -> String {
    let domain = email_domain(email).unwrap_or_else(|| "quill.local".into());
    format!("<{}@{domain}>", crate::oauth::random_token(18))
}

/// Junta uids em "3,7,9" para o UID FETCH.
fn uid_set(uids: &[u32]) -> String {
    uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",")
}

impl ImapClient {
    pub fn new() -> Self {
        Self {
            tls: tls_config().ok(),
            pool: Mutex::new(HashMap::new()),
            folders: Mutex::new(HashMap::new()),
            http: reqwest::Client::builder().timeout(Duration::from_secs(6)).build().unwrap_or_default(),
            doh_url: "https://cloudflare-dns.com/dns-query".into(),
            plain: false,
        }
    }

    #[cfg(test)]
    fn plain_for_tests() -> Self {
        Self { plain: true, ..Self::new() }
    }

    /// Resolve o nome do servidor (erro claro quando ele não existe).
    async fn resolve(host: &str, port: u16) -> Result<Vec<std::net::SocketAddr>, ImapError> {
        let lookup = tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::lookup_host((host, port)))
            .await
            .map_err(|_| ImapError::Timeout(host.to_string()))?;
        let addrs: Vec<_> = lookup.map_err(|_| ImapError::HostNotFound(host.to_string()))?.collect();
        if addrs.is_empty() {
            return Err(ImapError::HostNotFound(host.to_string()));
        }
        Ok(addrs)
    }

    async fn tcp(host: &str, port: u16) -> Result<TcpStream, ImapError> {
        let addrs = Self::resolve(host, port).await?;
        match tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(&addrs[..])).await {
            Err(_) => Err(ImapError::Timeout(host.to_string())),
            Ok(Err(_)) => Err(ImapError::Unreachable { host: host.to_string(), port }),
            Ok(Ok(s)) => Ok(s),
        }
    }

    /// Abre e autentica uma conexão IMAP nova.
    async fn open(&self, cfg: &ImapConfig, password: &str) -> Result<Conn, ImapError> {
        let host = cfg.imap_host.as_str();
        let tcp = Self::tcp(host, cfg.imap_port).await?;
        let stream = if self.plain {
            Stream::Plain(tcp)
        } else {
            let tls = self.tls.clone().ok_or_else(|| ImapError::Tls(host.to_string()))?;
            let name = rustls::pki_types::ServerName::try_from(host.to_string()).map_err(|_| ImapError::Tls(host.to_string()))?;
            let connector = tokio_rustls::TlsConnector::from(tls);
            let s = tokio::time::timeout(CONNECT_TIMEOUT, connector.connect(name, tcp))
                .await
                .map_err(|_| ImapError::Timeout(host.to_string()))?
                .map_err(|_| ImapError::Tls(host.to_string()))?;
            Stream::Tls(Box::new(s))
        };
        let mut client = async_imap::Client::new(stream);
        let greeting = tokio::time::timeout(CONNECT_TIMEOUT, client.read_response())
            .await
            .map_err(|_| ImapError::Timeout(host.to_string()))?;
        if !matches!(greeting, Ok(Some(_))) {
            return Err(ImapError::Unreachable { host: host.to_string(), port: cfg.imap_port });
        }
        let login = tokio::time::timeout(CONNECT_TIMEOUT, client.login(&cfg.username, password))
            .await
            .map_err(|_| ImapError::Timeout(host.to_string()))?;
        let mut session = match login {
            Ok(s) => s,
            Err((async_imap::error::Error::No(_), _)) => return Err(ImapError::Auth { icloud: cfg.is_icloud() }),
            Err((e, _)) => return Err(OpErr::Imap(e).into_imap()),
        };
        let caps = session.capabilities().await.map_err(|e| OpErr::Imap(e).into_imap())?;
        Ok(Conn {
            can_move: caps.has_str("MOVE"),
            uidplus: caps.has_str("UIDPLUS"),
            literal_plus: caps.has_str("LITERAL+"),
            session,
            last_used: Instant::now(),
        })
    }

    /// Pega uma conexão parada da conta ou abre uma nova. Devolve também se ela foi reaproveitada.
    async fn acquire(&self, cfg: &ImapConfig, password: &str) -> Result<(Conn, bool), ImapError> {
        loop {
            let idle = self.pool.lock().expect("trava das conexões").get_mut(&cfg.email).and_then(Vec::pop);
            match idle {
                Some(c) if c.last_used.elapsed() < IDLE_LIMIT => return Ok((c, true)),
                Some(_) => continue, // velha demais: descarta e tenta a próxima
                None => return Ok((self.open(cfg, password).await?, false)),
            }
        }
    }

    fn release(&self, cfg: &ImapConfig, mut conn: Conn) {
        conn.last_used = Instant::now();
        let mut pool = self.pool.lock().expect("trava das conexões");
        let list = pool.entry(cfg.email.clone()).or_default();
        if list.len() < MAX_IDLE_PER_ACCOUNT {
            list.push(conn);
        }
    }

    /// Esquece conexões e pastas da conta (ao remover a conta ou trocar a senha).
    pub fn forget(&self, email: &str) {
        self.pool.lock().expect("trava das conexões").remove(email);
        self.folders.lock().expect("trava das pastas").remove(email);
    }

    /// Mapa de pastas da conta (descobre com LIST na primeira vez).
    async fn folder_map(&self, email: &str, c: &mut Conn) -> Result<FolderMap, OpErr> {
        if let Some(m) = self.folders.lock().expect("trava das pastas").get(email) {
            return Ok(m.clone());
        }
        let names: Vec<_> = c.session.list(Some(""), Some("*")).await?.try_collect().await?;
        let entries: Vec<ListEntry> = names.iter().map(list_entry).collect();
        let map = FolderMap::from_list(&entries);
        self.folders.lock().expect("trava das pastas").insert(email.to_string(), map.clone());
        Ok(map)
    }

    /// Pasta do servidor para o id do app; cria a que falta quando `create` (Arquivo, Lixeira…).
    async fn mailbox_for(&self, email: &str, c: &mut Conn, folder: &str, create: bool) -> Result<Option<String>, OpErr> {
        let map = self.folder_map(email, c).await?;
        if let Some(m) = map.mailbox(folder) {
            return Ok(Some(m.to_string()));
        }
        let Some(name) = default_folder_name(folder).filter(|_| create) else { return Ok(None) };
        // alguns servidores só deixam criar dentro da Entrada (INBOX.Arquivo)
        for candidate in [name.to_string(), format!("INBOX.{name}"), format!("INBOX/{name}")] {
            if c.session.create(&candidate).await.is_ok() {
                c.session.subscribe(&candidate).await.ok();
                self.folders.lock().expect("trava das pastas").remove(email);
                return Ok(Some(candidate));
            }
        }
        Err(ImapError::Server(format!("não consegui criar a pasta {name}.")).into())
    }

    /// Roda uma operação com uma conexão da conta; se a conexão reaproveitada tiver caído, tenta de novo.
    async fn run<T, F>(&self, cfg: &ImapConfig, password: &str, mut op: F) -> Result<T, ImapError>
    where
        F: AsyncConnOp<T>,
    {
        let work = async {
            let mut retried = false;
            loop {
                let (mut conn, reused) = self.acquire(cfg, password).await?;
                match op.call(self, &mut conn).await {
                    Ok(v) => {
                        self.release(cfg, conn);
                        return Ok(v);
                    }
                    Err(e) if e.is_connection() && reused && !retried => retried = true,
                    Err(e) => {
                        // erro do servidor sem queda: a conexão continua boa
                        if !e.is_connection() {
                            self.release(cfg, conn);
                        }
                        return Err(e.into_imap());
                    }
                }
            }
        };
        tokio::time::timeout(OP_TIMEOUT, work).await.map_err(|_| ImapError::Timeout(cfg.imap_host.clone()))?
    }

    /// Testa a entrada no IMAP e no SMTP antes de salvar a conta.
    pub async fn check_login(&self, cfg: &ImapConfig, password: &str) -> Result<(), ImapError> {
        let mut conn = self.open(cfg, password).await?;
        // já aproveita para descobrir as pastas
        let _ = self.folder_map(&cfg.email, &mut conn).await;
        self.release(cfg, conn);
        self.smtp_check(cfg, password).await
    }

    fn smtp_transport(&self, cfg: &ImapConfig, password: &str) -> Result<lettre::AsyncSmtpTransport<lettre::Tokio1Executor>, ImapError> {
        use lettre::transport::smtp::authentication::Credentials;
        type T = lettre::AsyncSmtpTransport<lettre::Tokio1Executor>;
        let host = cfg.smtp_host.as_str();
        let builder = if self.plain {
            T::builder_dangerous(host)
        } else {
            match cfg.security() {
                SmtpSecurity::Tls => T::relay(host),
                SmtpSecurity::Starttls => T::starttls_relay(host),
            }
            .map_err(|_| ImapError::Tls(host.to_string()))?
        };
        Ok(builder
            .port(cfg.smtp_port)
            .credentials(Credentials::new(cfg.username.clone(), password.to_string()))
            .timeout(Some(Duration::from_secs(60)))
            .build())
    }

    fn smtp_error(cfg: &ImapConfig, e: lettre::transport::smtp::Error) -> ImapError {
        let host = cfg.smtp_host.clone();
        let code = e.status().map(|c| c.to_string());
        if e.is_timeout() {
            ImapError::Timeout(host)
        } else if e.is_tls() {
            ImapError::Tls(host)
        } else if matches!(code.as_deref(), Some("535" | "534" | "530" | "454")) {
            ImapError::Auth { icloud: cfg.is_icloud() }
        } else if e.is_permanent() || e.is_transient() {
            ImapError::Smtp(format!("o servidor respondeu {}", code.unwrap_or_default()))
        } else {
            ImapError::Unreachable { host, port: cfg.smtp_port }
        }
    }

    async fn smtp_check(&self, cfg: &ImapConfig, password: &str) -> Result<(), ImapError> {
        Self::resolve(&cfg.smtp_host, cfg.smtp_port).await?;
        let transport = self.smtp_transport(cfg, password)?;
        transport.test_connection().await.map_err(|e| Self::smtp_error(cfg, e))?;
        Ok(())
    }

    /// Últimos e-mails de uma pasta do app, de "starred" (com estrela) ou de "search:<texto>".
    pub async fn list(
        &self,
        cfg: &ImapConfig,
        password: &str,
        folder: &str,
        max: u32,
        now_ms: i64,
        tz_offset_min: i32,
    ) -> Result<Vec<MessageSummary>, ImapError> {
        let email = cfg.email.clone();
        let folder = folder.to_string();
        self.run(cfg, password, ListOp { email, folder, max, now_ms, tz_offset_min }).await
    }

    /// Não lidos da Entrada e do Spam e total de Rascunhos.
    pub async fn counts(&self, cfg: &ImapConfig, password: &str) -> Result<HashMap<String, u64>, ImapError> {
        self.run(cfg, password, CountsOp { email: cfg.email.clone() }).await
    }

    /// E-mail inteiro como veio do servidor.
    async fn raw(&self, cfg: &ImapConfig, password: &str, id: &str) -> Result<Vec<u8>, ImapError> {
        let (folder, uid) = parse_id(id)?;
        self.run(cfg, password, RawOp { email: cfg.email.clone(), folder: folder.to_string(), uid }).await
    }

    pub async fn body(&self, cfg: &ImapConfig, password: &str, id: &str) -> Result<MessageBody, ImapError> {
        Ok(body_from_raw(&self.raw(cfg, password, id).await?))
    }

    pub async fn attachment(&self, cfg: &ImapConfig, password: &str, id: &str, attachment_id: &str) -> Result<Vec<u8>, ImapError> {
        attachment_from_raw(&self.raw(cfg, password, id).await?, attachment_id).ok_or(ImapError::MessageGone)
    }

    pub async fn draft_get(&self, cfg: &ImapConfig, password: &str, id: &str) -> Result<DraftContent, ImapError> {
        Ok(draft_from_raw(&self.raw(cfg, password, id).await?, id))
    }

    /// archive, unarchive, spam, notspam, star, unstar, read, unread, trash, untrash.
    pub async fn act(&self, cfg: &ImapConfig, password: &str, id: &str, action: &str) -> Result<(), ImapError> {
        let (folder, uid) = parse_id(id)?;
        let kind = match action {
            "star" => Act::Flag("\\Flagged", true),
            "unstar" => Act::Flag("\\Flagged", false),
            "read" => Act::Flag("\\Seen", true),
            "unread" => Act::Flag("\\Seen", false),
            "archive" => Act::Move("archive"),
            "spam" => Act::Move("spam"),
            "trash" => Act::Move("trash"),
            "unarchive" | "notspam" | "untrash" => Act::Move("inbox"),
            other => return Err(ImapError::Invalid(format!("Ação desconhecida: {other}"))),
        };
        self.run(cfg, password, ActOp { email: cfg.email.clone(), folder: folder.to_string(), uid, kind }).await
    }

    /// Monta o e-mail com Date e Message-ID e o nome da conta quando a tela não mandar.
    fn compose(cfg: &ImapConfig, message: &OutgoingMessage) -> (String, String) {
        let mut m = message.clone();
        m.from = cfg.email.clone();
        if m.from_name.as_deref().map(str::trim).unwrap_or_default().is_empty() {
            m.from_name = cfg.name.clone();
        }
        let id = message_id_for(&cfg.email);
        (with_date_and_id(&build_mime(&m), &id, now_ms()), id)
    }

    /// Envia pelo SMTP e guarda uma cópia em Enviados (o iCloud e a maioria não guardam sozinhos).
    pub async fn send(&self, cfg: &ImapConfig, password: &str, message: &OutgoingMessage) -> Result<String, ImapError> {
        use lettre::AsyncTransport;
        let (mime, message_id) = Self::compose(cfg, message);
        let all: Vec<String> = message.to.iter().chain(&message.cc).chain(&message.bcc).cloned().collect();
        let recipients = envelope_addresses(&all)
            .iter()
            .map(|a| a.parse::<lettre::Address>())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ImapError::Invalid("Um dos destinatários não parece um e-mail válido.".into()))?;
        if recipients.is_empty() {
            return Err(ImapError::Invalid("Coloque pelo menos um destinatário.".into()));
        }
        let from = cfg.email.parse::<lettre::Address>().map_err(|_| ImapError::Invalid("E-mail da conta inválido.".into()))?;
        let envelope = lettre::address::Envelope::new(Some(from), recipients)
            .map_err(|_| ImapError::Invalid("Coloque pelo menos um destinatário.".into()))?;
        Self::resolve(&cfg.smtp_host, cfg.smtp_port).await?;
        let transport = self.smtp_transport(cfg, password)?;
        let smtp_copy = strip_bcc(&mime);
        tokio::time::timeout(OP_TIMEOUT, transport.send_raw(&envelope, smtp_copy.as_bytes()))
            .await
            .map_err(|_| ImapError::Timeout(cfg.smtp_host.clone()))?
            .map_err(|e| Self::smtp_error(cfg, e))?;
        if !server_saves_sent(cfg) {
            // o e-mail já saiu: se guardar a cópia falhar, não é erro para a pessoa
            let op = AppendOp { email: cfg.email.clone(), folder: "sent", flags: "(\\Seen)", content: mime.into_bytes() };
            let _ = self.run(cfg, password, op).await;
        }
        Ok(message_id)
    }

    /// Guarda o rascunho na pasta Rascunhos (troca a versão anterior) e devolve o id novo.
    pub async fn draft_save(&self, cfg: &ImapConfig, password: &str, message: &OutgoingMessage, draft_id: Option<&str>) -> Result<String, ImapError> {
        let old = match draft_id.filter(|d| !d.is_empty()) {
            Some(d) => Some(parse_id(d)?.1),
            None => None,
        };
        let (mime, message_id) = Self::compose(cfg, message);
        self.run(cfg, password, DraftSaveOp { email: cfg.email.clone(), mime: mime.into_bytes(), message_id, old }).await
    }

    pub async fn draft_delete(&self, cfg: &ImapConfig, password: &str, draft_id: &str) -> Result<(), ImapError> {
        let (folder, uid) = parse_id(draft_id)?;
        self.run(cfg, password, DeleteOp { email: cfg.email.clone(), folder: folder.to_string(), uid }).await
    }

    /// Servidores do MX do domínio pelo DNS-sobre-HTTPS (só o domínio sai do computador).
    async fn lookup_mx(&self, domain: &str) -> Vec<String> {
        let Ok(domain) = validate_host(domain) else { return Vec::new() };
        let Ok(mut url) = url::Url::parse(&self.doh_url) else { return Vec::new() };
        url.query_pairs_mut().append_pair("name", &domain).append_pair("type", "MX");
        let req = self.http.get(url).header("accept", "application/dns-json");
        match req.send().await {
            Ok(r) if r.status().is_success() => parse_doh_mx(&r.text().await.unwrap_or_default()),
            _ => Vec::new(),
        }
    }

    /// Palpite de servidores para um e-mail: domínio conhecido, depois MX, depois imap./smtp.<domínio>.
    pub async fn guess(&self, email: &str, provider: &str) -> Guess {
        let Some(domain) = email_domain(email) else {
            return Guess { config: None, source: "generic".into(), label: None, hint: None };
        };
        let hint = domain_hint(&domain).map(str::to_string);
        if provider == "icloud" {
            return Guess { config: Some(config_from_preset(email, "icloud", &crate::imap::ICLOUD)), source: "known".into(), label: Some("iCloud".into()), hint };
        }
        if let Some(p) = preset_for_domain(&domain) {
            let provider = if p == crate::imap::ICLOUD { "icloud" } else { "imap" };
            return Guess { config: Some(config_from_preset(email, provider, &p)), source: "known".into(), label: Some(p.label.into()), hint };
        }
        if let Some(p) = self.lookup_mx(&domain).await.iter().find_map(|mx| preset_for_mx(mx)) {
            let provider = if p == crate::imap::ICLOUD { "icloud" } else { "imap" };
            return Guess { config: Some(config_from_preset(email, provider, &p)), source: "mx".into(), label: Some(p.label.into()), hint };
        }
        Guess { config: generic_guess(email), source: "generic".into(), label: None, hint }
    }
}

// ---- operações (cada uma pode rodar duas vezes se a conexão reaproveitada tiver caído) ----

/// Uma operação que usa uma conexão IMAP.
trait AsyncConnOp<T> {
    fn call<'a>(&'a mut self, client: &'a ImapClient, c: &'a mut Conn) -> Pin<Box<dyn Future<Output = Result<T, OpErr>> + Send + 'a>>;
}

/// Pede cabeçalho, marcas e começo do texto e monta os resumos.
async fn fetch_summaries(c: &mut Conn, folder: &str, set: &str, uid: bool, now_ms: i64, tz: i32) -> Result<Vec<MessageSummary>, OpErr> {
    let query = format!("(UID FLAGS INTERNALDATE BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.{PREVIEW_BYTES}>)");
    let fetches: Vec<Fetch> = if uid {
        c.session.uid_fetch(set, &query).await?.try_collect().await?
    } else {
        c.session.fetch(set, &query).await?.try_collect().await?
    };
    Ok(fetches
        .iter()
        .filter_map(|f| {
            let uid = f.uid?;
            let flags = flags_of(f);
            if flags.deleted {
                return None;
            }
            let internal = f.internal_date().map(|d| d.timestamp_millis());
            Some(summary_from_parts(make_id(folder, uid), flags, internal, f.header().unwrap_or_default(), f.text().unwrap_or_default(), now_ms, tz))
        })
        .collect())
}

/// Procura em algumas pastas e junta os mais novos.
#[allow(clippy::too_many_arguments)]
async fn search_folders(client: &ImapClient, email: &str, c: &mut Conn, folders: &[&str], criteria: &str, max: u32, now_ms: i64, tz: i32) -> Result<Vec<MessageSummary>, OpErr> {
    let mut all = Vec::new();
    for folder in folders {
        let Some(mailbox) = client.mailbox_for(email, c, folder, false).await? else { continue };
        c.session.select(&mailbox).await?;
        let found = c.session.uid_search(format!("{criteria} NOT DELETED")).await?;
        let mut uids: Vec<u32> = found.into_iter().collect();
        uids.sort_unstable_by(|a, b| b.cmp(a));
        uids.truncate(max as usize);
        if !uids.is_empty() {
            all.extend(fetch_summaries(c, folder, &uid_set(&uids), true, now_ms, tz).await?);
        }
    }
    all.sort_by_key(|m| std::cmp::Reverse(m.internal_date));
    all.truncate(max as usize);
    Ok(all)
}

struct ListOp {
    email: String,
    folder: String,
    max: u32,
    now_ms: i64,
    tz_offset_min: i32,
}

impl AsyncConnOp<Vec<MessageSummary>> for ListOp {
    fn call<'a>(&'a mut self, client: &'a ImapClient, c: &'a mut Conn) -> Pin<Box<dyn Future<Output = Result<Vec<MessageSummary>, OpErr>> + Send + 'a>> {
        Box::pin(async move {
            let (max, now, tz) = (self.max, self.now_ms, self.tz_offset_min);
            if self.folder == "starred" {
                return search_folders(client, &self.email, c, &["inbox", "archive", "sent"], "FLAGGED", max, now, tz).await;
            }
            if let Some(q) = self.folder.strip_prefix("search:") {
                let q = q.trim();
                if q.is_empty() {
                    return Ok(Vec::new());
                }
                let criteria = search_criteria(q, c.literal_plus);
                return search_folders(client, &self.email, c, &["inbox", "sent", "archive"], &criteria, max, now, tz).await;
            }
            if !crate::imap::FOLDER_IDS.contains(&self.folder.as_str()) {
                return Err(ImapError::Invalid(format!("Pasta desconhecida: {}", self.folder)).into());
            }
            let Some(mailbox) = client.mailbox_for(&self.email, c, &self.folder, false).await? else { return Ok(Vec::new()) };
            let exists = c.session.select(&mailbox).await?.exists;
            if exists == 0 {
                return Ok(Vec::new());
            }
            let first = exists.saturating_sub(max.saturating_sub(1)).max(1);
            let mut list = fetch_summaries(c, &self.folder, &format!("{first}:{exists}"), false, now, tz).await?;
            list.sort_by_key(|m| std::cmp::Reverse(m.internal_date));
            Ok(list)
        })
    }
}

struct CountsOp {
    email: String,
}

impl AsyncConnOp<HashMap<String, u64>> for CountsOp {
    fn call<'a>(&'a mut self, client: &'a ImapClient, c: &'a mut Conn) -> Pin<Box<dyn Future<Output = Result<HashMap<String, u64>, OpErr>> + Send + 'a>> {
        Box::pin(async move {
            let mut out = HashMap::new();
            for (folder, what) in [("inbox", "UNSEEN"), ("spam", "UNSEEN"), ("drafts", "MESSAGES")] {
                let n = match client.mailbox_for(&self.email, c, folder, false).await? {
                    Some(m) => {
                        let st = c.session.status(&m, format!("({what})")).await?;
                        if what == "UNSEEN" { st.unseen.unwrap_or(0) } else { st.exists }
                    }
                    None => 0,
                };
                out.insert(folder.to_string(), n as u64);
            }
            Ok(out)
        })
    }
}

/// Seleciona a pasta do e-mail (erro claro se ela não existir mais).
async fn select_folder(client: &ImapClient, email: &str, c: &mut Conn, folder: &str) -> Result<String, OpErr> {
    let mailbox = client.mailbox_for(email, c, folder, false).await?.ok_or(OpErr::App(ImapError::MessageGone))?;
    c.session.select(&mailbox).await?;
    Ok(mailbox)
}

struct RawOp {
    email: String,
    folder: String,
    uid: u32,
}

impl AsyncConnOp<Vec<u8>> for RawOp {
    fn call<'a>(&'a mut self, client: &'a ImapClient, c: &'a mut Conn) -> Pin<Box<dyn Future<Output = Result<Vec<u8>, OpErr>> + Send + 'a>> {
        Box::pin(async move {
            select_folder(client, &self.email, c, &self.folder).await?;
            let fetches: Vec<Fetch> = c.session.uid_fetch(self.uid.to_string(), "(UID BODY.PEEK[])").await?.try_collect().await?;
            fetches
                .iter()
                .find(|f| f.uid == Some(self.uid))
                .and_then(|f| f.body())
                .map(<[u8]>::to_vec)
                .ok_or(OpErr::App(ImapError::MessageGone))
        })
    }
}

enum Act {
    Flag(&'static str, bool),
    Move(&'static str),
}

/// Apaga de vez um e-mail da pasta selecionada (só o uid dado, se o servidor tiver UIDPLUS).
async fn expunge_uid(c: &mut Conn, uid: u32) -> Result<(), OpErr> {
    let _: Vec<_> = c.session.uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)").await?.try_collect().await?;
    if c.uidplus {
        let _: Vec<_> = c.session.uid_expunge(uid.to_string()).await?.try_collect().await?;
    } else {
        let _: Vec<_> = c.session.expunge().await?.try_collect().await?;
    }
    Ok(())
}

struct ActOp {
    email: String,
    folder: String,
    uid: u32,
    kind: Act,
}

impl AsyncConnOp<()> for ActOp {
    fn call<'a>(&'a mut self, client: &'a ImapClient, c: &'a mut Conn) -> Pin<Box<dyn Future<Output = Result<(), OpErr>> + Send + 'a>> {
        Box::pin(async move {
            match self.kind {
                Act::Flag(flag, add) => {
                    select_folder(client, &self.email, c, &self.folder).await?;
                    let sign = if add { '+' } else { '-' };
                    let _: Vec<_> = c.session.uid_store(self.uid.to_string(), format!("{sign}FLAGS.SILENT ({flag})")).await?.try_collect().await?;
                }
                Act::Move(target) => {
                    if target == self.folder {
                        return Ok(());
                    }
                    let dest = client
                        .mailbox_for(&self.email, c, target, true)
                        .await?
                        .ok_or(OpErr::App(ImapError::Server("pasta de destino não encontrada.".into())))?;
                    select_folder(client, &self.email, c, &self.folder).await?;
                    if c.can_move {
                        c.session.uid_mv(self.uid.to_string(), &dest).await?;
                    } else {
                        c.session.uid_copy(self.uid.to_string(), &dest).await?;
                        expunge_uid(c, self.uid).await?;
                    }
                }
            }
            Ok(())
        })
    }
}

struct AppendOp {
    email: String,
    folder: &'static str,
    flags: &'static str,
    content: Vec<u8>,
}

impl AsyncConnOp<()> for AppendOp {
    fn call<'a>(&'a mut self, client: &'a ImapClient, c: &'a mut Conn) -> Pin<Box<dyn Future<Output = Result<(), OpErr>> + Send + 'a>> {
        Box::pin(async move {
            let mailbox = client
                .mailbox_for(&self.email, c, self.folder, true)
                .await?
                .ok_or(OpErr::App(ImapError::Server("pasta não encontrada.".into())))?;
            c.session.append(&mailbox, Some(self.flags), None, &self.content).await?;
            Ok(())
        })
    }
}

struct DraftSaveOp {
    email: String,
    mime: Vec<u8>,
    message_id: String,
    old: Option<u32>,
}

impl AsyncConnOp<String> for DraftSaveOp {
    fn call<'a>(&'a mut self, client: &'a ImapClient, c: &'a mut Conn) -> Pin<Box<dyn Future<Output = Result<String, OpErr>> + Send + 'a>> {
        Box::pin(async move {
            let mailbox = client
                .mailbox_for(&self.email, c, "drafts", true)
                .await?
                .ok_or(OpErr::App(ImapError::Server("pasta Rascunhos não encontrada.".into())))?;
            c.session.append(&mailbox, Some("(\\Draft \\Seen)"), None, &self.mime).await?;
            c.session.select(&mailbox).await?;
            let id = self.message_id.trim_matches(|ch| ch == '<' || ch == '>');
            let found = c.session.uid_search(format!("HEADER Message-ID \"{id}\"")).await?;
            let uid = found.into_iter().max().ok_or(OpErr::App(ImapError::Server("o rascunho não apareceu na pasta.".into())))?;
            if let Some(old) = self.old.filter(|o| *o != uid) {
                expunge_uid(c, old).await?;
            }
            Ok(make_id("drafts", uid))
        })
    }
}

struct DeleteOp {
    email: String,
    folder: String,
    uid: u32,
}

impl AsyncConnOp<()> for DeleteOp {
    fn call<'a>(&'a mut self, client: &'a ImapClient, c: &'a mut Conn) -> Pin<Box<dyn Future<Output = Result<(), OpErr>> + Send + 'a>> {
        Box::pin(async move {
            select_folder(client, &self.email, c, &self.folder).await?;
            expunge_uid(c, self.uid).await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    type Log = Arc<Mutex<Vec<String>>>;
    type Handler = Arc<dyn Fn(&str) -> (String, &'static str) + Send + Sync>;

    /// Servidor IMAP falso: responde a cada comando com o que `handler` disser (linhas + OK/NO).
    async fn fake_imap(handler: Handler) -> (u16, Log) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let log: Log = Arc::new(Mutex::new(Vec::new()));
        let log2 = log.clone();
        tokio::spawn(async move {
            loop {
                let Ok((sock, _)) = listener.accept().await else { return };
                let (handler, log) = (handler.clone(), log2.clone());
                tokio::spawn(async move {
                    let (r, mut w) = sock.into_split();
                    let mut r = BufReader::new(r);
                    w.write_all(b"* OK fake pronto\r\n").await.unwrap();
                    loop {
                        let mut line = String::new();
                        if r.read_line(&mut line).await.unwrap_or(0) == 0 {
                            return;
                        }
                        let mut cmd = line.trim_end().to_string();
                        // literal: {n} (espera o "+") ou {n+} (LITERAL+)
                        while let Some(open) = cmd.rfind('{').filter(|_| cmd.ends_with('}')) {
                            let inner = &cmd[open + 1..cmd.len() - 1];
                            let (n, plus) = match inner.strip_suffix('+') {
                                Some(n) => (n.parse::<usize>().unwrap(), true),
                                None => (inner.parse::<usize>().unwrap(), false),
                            };
                            if !plus {
                                w.write_all(b"+ manda\r\n").await.unwrap();
                            }
                            let mut buf = vec![0u8; n];
                            r.read_exact(&mut buf).await.unwrap();
                            let mut rest = String::new();
                            r.read_line(&mut rest).await.unwrap();
                            cmd = format!("{}{}{}", &cmd[..open], String::from_utf8_lossy(&buf), rest.trim_end());
                        }
                        let (tag, rest) = cmd.split_once(' ').unwrap();
                        let rest = rest.to_string();
                        log.lock().unwrap().push(rest.clone());
                        if rest.eq_ignore_ascii_case("LOGOUT") {
                            w.write_all(format!("* BYE\r\n{tag} OK tchau\r\n").as_bytes()).await.unwrap();
                            return;
                        }
                        let (untagged, status) = handler(&rest);
                        w.write_all(format!("{untagged}{tag} {status} feito\r\n").as_bytes()).await.unwrap();
                    }
                });
            }
        });
        (port, log)
    }

    fn cfg(port: u16) -> ImapConfig {
        ImapConfig {
            email: "ana@icloud.com".into(),
            name: Some("Ana".into()),
            provider: "icloud".into(),
            imap_host: "127.0.0.1".into(),
            imap_port: port,
            smtp_host: "127.0.0.1".into(),
            smtp_port: 1,
            smtp_security: None,
            username: "ana@icloud.com".into(),
        }
    }

    const LIST: &str = "* LIST (\\HasNoChildren) \"/\" \"INBOX\"\r\n* LIST (\\HasNoChildren \\Sent) \"/\" \"Sent Messages\"\r\n* LIST (\\HasNoChildren \\Trash) \"/\" \"Deleted Messages\"\r\n* LIST (\\HasNoChildren \\Junk) \"/\" \"Junk\"\r\n* LIST (\\HasNoChildren \\Drafts) \"/\" \"Drafts\"\r\n* LIST (\\HasNoChildren \\Archive) \"/\" \"Archive\"\r\n";

    fn fetch_line(seq: u32, uid: u32, flags: &str, date: &str, header: &str, text: &str) -> String {
        format!(
            "* {seq} FETCH (UID {uid} FLAGS ({flags}) INTERNALDATE \"{date}\" BODY[HEADER] {{{}}}\r\n{header} BODY[TEXT]<0> {{{}}}\r\n{text})\r\n",
            header.len(),
            text.len()
        )
    }

    /// Respostas comuns: login com a senha "certa", capacidades, LIST e SELECT.
    fn base(rest: &str, caps: &str) -> Option<(String, &'static str)> {
        if rest.starts_with("LOGIN") {
            return Some(if rest.contains("\"certa\"") { (String::new(), "OK") } else { (String::new(), "NO") });
        }
        if rest == "CAPABILITY" {
            return Some((format!("* CAPABILITY IMAP4rev1 {caps}\r\n"), "OK"));
        }
        if rest.starts_with("LIST") {
            return Some((LIST.into(), "OK"));
        }
        if rest.starts_with("SELECT") {
            return Some(("* 2 EXISTS\r\n* OK [UIDVALIDITY 1] ok\r\n".into(), "OK"));
        }
        None
    }

    fn handler(caps: &'static str, extra: impl Fn(&str) -> Option<(String, &'static str)> + Send + Sync + 'static) -> Handler {
        Arc::new(move |rest: &str| base(rest, caps).or_else(|| extra(rest)).unwrap_or((String::new(), "OK")))
    }

    fn commands(log: &Log, prefix: &str) -> Vec<String> {
        log.lock().unwrap().iter().filter(|c| c.starts_with(prefix)).cloned().collect()
    }

    #[tokio::test]
    async fn wrong_password_is_a_clear_error() {
        let (port, _) = fake_imap(handler("MOVE", |_| None)).await;
        let err = ImapClient::plain_for_tests().list(&cfg(port), "errada", "inbox", 30, 0, 0).await.unwrap_err();
        assert_eq!(err, ImapError::Auth { icloud: true });
        assert!(err.to_string().contains("Senha de app incorreta"));
    }

    #[tokio::test]
    async fn unknown_host_is_a_clear_error() {
        let c = ImapConfig { imap_host: "nao-existe.invalid".into(), ..cfg(993) };
        let err = ImapClient::plain_for_tests().list(&c, "certa", "inbox", 30, 0, 0).await.unwrap_err();
        assert_eq!(err, ImapError::HostNotFound("nao-existe.invalid".into()));
    }

    #[tokio::test]
    async fn inbox_lists_newest_first_and_reuses_the_connection() {
        let (port, log) = fake_imap(handler("MOVE", |rest| {
            rest.starts_with("FETCH 1:2").then(|| {
                let a = fetch_line(1, 40, "\\Seen", "16-Nov-2025 10:00:00 +0000", "From: Bia <bia@x.com>\r\nSubject: Antigo\r\n\r\n", "texto antigo");
                let b = fetch_line(2, 41, "\\Flagged", "17-Nov-2025 09:00:00 +0000", "From: Caio <caio@x.com>\r\nSubject: Novo\r\n\r\n", "texto novo");
                (a + &b, "OK")
            })
        }))
        .await;
        let client = ImapClient::plain_for_tests();
        let list = client.list(&cfg(port), "certa", "inbox", 30, 1_763_380_800_000, 0).await.unwrap();
        assert_eq!(list.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["inbox:41", "inbox:40"]);
        assert_eq!(list[0].subject, "Novo");
        assert_eq!(list[0].preview, "texto novo");
        assert!(list[0].unread && list[0].starred);
        assert!(!list[1].unread);
        assert_eq!(list[0].date, "09:00");

        client.list(&cfg(port), "certa", "inbox", 30, 0, 0).await.unwrap();
        assert_eq!(commands(&log, "LOGIN").len(), 1, "a segunda lista usa a mesma conexão");
        assert_eq!(commands(&log, "LIST").len(), 1, "as pastas ficam guardadas");
        assert_eq!(commands(&log, "SELECT \"INBOX\"").len(), 2);
    }

    #[tokio::test]
    async fn missing_folder_gives_empty_list() {
        let (port, _) = fake_imap(Arc::new(|rest: &str| {
            if rest.starts_with("LIST") {
                return ("* LIST () \"/\" \"INBOX\"\r\n".to_string(), "OK");
            }
            base(rest, "").unwrap_or((String::new(), "OK"))
        }))
        .await;
        let list = ImapClient::plain_for_tests().list(&cfg(port), "certa", "archive", 30, 0, 0).await.unwrap();
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn search_uses_uid_search_in_several_folders() {
        let (port, log) = fake_imap(handler("MOVE", |rest| {
            if rest.starts_with("UID SEARCH") {
                return Some(("* SEARCH 7\r\n".into(), "OK"));
            }
            rest.starts_with("UID FETCH 7").then(|| (fetch_line(1, 7, "", "17-Nov-2025 09:00:00 +0000", "From: a@x.com\r\nSubject: Nota\r\n\r\n", "x"), "OK"))
        }))
        .await;
        let list = ImapClient::plain_for_tests().list(&cfg(port), "certa", "search:nota fiscal", 30, 0, 0).await.unwrap();
        let searches = commands(&log, "UID SEARCH");
        assert_eq!(searches.len(), 3, "Entrada, Enviados e Arquivo");
        assert_eq!(searches[0], "UID SEARCH TEXT \"nota fiscal\" NOT DELETED");
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].subject, "Nota");
        let ids: Vec<_> = list.iter().map(|m| m.id.clone()).collect();
        assert!(ids.contains(&"inbox:7".to_string()) && ids.contains(&"sent:7".to_string()) && ids.contains(&"archive:7".to_string()));
    }

    #[tokio::test]
    async fn counts_come_from_status() {
        let (port, log) = fake_imap(handler("", |rest| {
            Some(match rest {
                r if r.starts_with("STATUS \"INBOX\"") => ("* STATUS \"INBOX\" (UNSEEN 3)\r\n".into(), "OK"),
                r if r.starts_with("STATUS \"Junk\"") => ("* STATUS \"Junk\" (UNSEEN 1)\r\n".into(), "OK"),
                r if r.starts_with("STATUS \"Drafts\"") => ("* STATUS \"Drafts\" (MESSAGES 2)\r\n".into(), "OK"),
                _ => return None,
            })
        }))
        .await;
        let counts = ImapClient::plain_for_tests().counts(&cfg(port), "certa").await.unwrap();
        assert_eq!(counts["inbox"], 3);
        assert_eq!(counts["spam"], 1);
        assert_eq!(counts["drafts"], 2);
        assert!(commands(&log, "STATUS \"INBOX\" (UNSEEN)").len() == 1);
    }

    #[tokio::test]
    async fn body_reads_the_whole_message() {
        let raw = "From: a@x.com\r\nSubject: Oi\r\n\r\nCorpo do e-mail\r\n";
        let (port, log) = fake_imap(handler("", move |rest| {
            rest.starts_with("UID FETCH 41").then(|| (format!("* 1 FETCH (UID 41 BODY[] {{{}}}\r\n{raw})\r\n", raw.len()), "OK"))
        }))
        .await;
        let body = ImapClient::plain_for_tests().body(&cfg(port), "certa", "trash:41").await.unwrap();
        assert_eq!(body.text, "Corpo do e-mail");
        assert_eq!(commands(&log, "SELECT").last().unwrap(), "SELECT \"Deleted Messages\"");
        assert_eq!(commands(&log, "UID FETCH"), vec!["UID FETCH 41 (UID BODY.PEEK[])"]);
    }

    #[tokio::test]
    async fn message_not_found_is_clear() {
        let (port, _) = fake_imap(handler("", |_| None)).await;
        let err = ImapClient::plain_for_tests().body(&cfg(port), "certa", "inbox:99").await.unwrap_err();
        assert_eq!(err, ImapError::MessageGone);
    }

    #[tokio::test]
    async fn star_and_read_change_flags() {
        let (port, log) = fake_imap(handler("MOVE", |_| None)).await;
        let client = ImapClient::plain_for_tests();
        client.act(&cfg(port), "certa", "inbox:41", "star").await.unwrap();
        client.act(&cfg(port), "certa", "inbox:41", "unread").await.unwrap();
        assert_eq!(commands(&log, "UID STORE"), vec!["UID STORE 41 +FLAGS.SILENT (\\Flagged)", "UID STORE 41 -FLAGS.SILENT (\\Seen)"]);
    }

    #[tokio::test]
    async fn archive_uses_move_when_available() {
        let (port, log) = fake_imap(handler("MOVE", |_| None)).await;
        ImapClient::plain_for_tests().act(&cfg(port), "certa", "inbox:41", "archive").await.unwrap();
        assert_eq!(commands(&log, "UID MOVE"), vec!["UID MOVE 41 \"Archive\""]);
    }

    #[tokio::test]
    async fn move_without_move_capability_copies_and_expunges() {
        let (port, log) = fake_imap(handler("UIDPLUS", |_| None)).await;
        ImapClient::plain_for_tests().act(&cfg(port), "certa", "inbox:41", "spam").await.unwrap();
        assert_eq!(commands(&log, "UID COPY"), vec!["UID COPY 41 \"Junk\""]);
        assert_eq!(commands(&log, "UID STORE"), vec!["UID STORE 41 +FLAGS.SILENT (\\Deleted)"]);
        assert_eq!(commands(&log, "UID EXPUNGE"), vec!["UID EXPUNGE 41"]);
    }

    #[tokio::test]
    async fn untrash_goes_back_to_inbox_and_missing_archive_is_created() {
        let (port, log) = fake_imap(Arc::new(|rest: &str| {
            if rest.starts_with("LIST") {
                return ("* LIST () \"/\" \"INBOX\"\r\n* LIST (\\Trash) \"/\" \"Deleted Messages\"\r\n".to_string(), "OK");
            }
            base(rest, "MOVE").unwrap_or((String::new(), "OK"))
        }))
        .await;
        let client = ImapClient::plain_for_tests();
        client.act(&cfg(port), "certa", "trash:5", "untrash").await.unwrap();
        client.act(&cfg(port), "certa", "inbox:6", "archive").await.unwrap();
        assert_eq!(commands(&log, "UID MOVE"), vec!["UID MOVE 5 \"INBOX\"", "UID MOVE 6 \"Archive\""]);
        assert_eq!(commands(&log, "CREATE"), vec!["CREATE \"Archive\""]);
    }

    #[tokio::test]
    async fn unknown_action_and_bad_id_are_rejected() {
        let client = ImapClient::plain_for_tests();
        assert!(client.act(&cfg(1), "certa", "inbox:1", "explodir").await.is_err());
        assert!(client.act(&cfg(1), "certa", "../x", "star").await.is_err());
    }

    /// Servidor SMTP falso: aceita tudo e guarda os comandos e o conteúdo.
    async fn fake_smtp() -> (u16, Log) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let log: Log = Arc::new(Mutex::new(Vec::new()));
        let log2 = log.clone();
        tokio::spawn(async move {
            loop {
                let Ok((sock, _)) = listener.accept().await else { return };
                let log = log2.clone();
                tokio::spawn(async move {
                    let (r, mut w) = sock.into_split();
                    let mut r = BufReader::new(r);
                    w.write_all(b"220 fake\r\n").await.unwrap();
                    loop {
                        let mut line = String::new();
                        if r.read_line(&mut line).await.unwrap_or(0) == 0 {
                            return;
                        }
                        let cmd = line.trim_end().to_string();
                        let upper = cmd.to_ascii_uppercase();
                        let reply = if upper.starts_with("EHLO") {
                            "250-fake\r\n250 AUTH PLAIN LOGIN\r\n".to_string()
                        } else if upper.starts_with("AUTH") {
                            log.lock().unwrap().push("AUTH".into());
                            "235 ok\r\n".into()
                        } else if upper == "DATA" {
                            w.write_all(b"354 manda\r\n").await.unwrap();
                            let mut data = String::new();
                            loop {
                                let mut l = String::new();
                                r.read_line(&mut l).await.unwrap();
                                if l == ".\r\n" {
                                    break;
                                }
                                data.push_str(&l);
                            }
                            log.lock().unwrap().push(format!("DATA {data}"));
                            "250 enviado\r\n".into()
                        } else if upper == "QUIT" {
                            w.write_all(b"221 tchau\r\n").await.unwrap();
                            return;
                        } else {
                            log.lock().unwrap().push(cmd.clone());
                            "250 ok\r\n".into()
                        };
                        w.write_all(reply.as_bytes()).await.unwrap();
                    }
                });
            }
        });
        (port, log)
    }

    fn outgoing() -> OutgoingMessage {
        serde_json::from_str(
            r#"{"from":"ana@icloud.com","to":["Bia <bia@x.com>"],"cc":[],"bcc":["oculto@x.com"],"subject":"Olá","html":"<p>Oi</p>"}"#,
        )
        .unwrap()
    }

    #[tokio::test]
    async fn send_goes_by_smtp_without_bcc_and_is_saved_in_sent() {
        let (smtp_port, smtp_log) = fake_smtp().await;
        let (port, log) = fake_imap(handler("MOVE", |_| None)).await;
        let c = ImapConfig { smtp_port, ..cfg(port) };
        let id = ImapClient::plain_for_tests().send(&c, "certa", &outgoing()).await.unwrap();
        assert!(id.starts_with('<') && id.ends_with("@icloud.com>"));

        let smtp = smtp_log.lock().unwrap().clone();
        assert!(smtp.iter().any(|l| l == "AUTH"));
        assert!(smtp.iter().any(|l| l == "MAIL FROM:<ana@icloud.com>"));
        assert!(smtp.iter().any(|l| l == "RCPT TO:<bia@x.com>"));
        assert!(smtp.iter().any(|l| l == "RCPT TO:<oculto@x.com>"));
        let data = smtp.iter().find(|l| l.starts_with("DATA ")).unwrap();
        assert!(!data.contains("Bcc:"), "quem recebe não vê a cópia oculta");
        assert!(data.contains("From: \"Ana\" <ana@icloud.com>"), "usa o nome da conta");
        assert!(data.contains(&format!("Message-ID: {id}")));

        let appends = commands(&log, "APPEND");
        assert_eq!(appends.len(), 1);
        assert!(appends[0].starts_with("APPEND \"Sent Messages\" (\\Seen)"));
        assert!(appends[0].contains("Bcc: oculto@x.com"), "a cópia em Enviados guarda a cópia oculta");
    }

    #[tokio::test]
    async fn check_login_tests_imap_and_smtp() {
        let (smtp_port, smtp_log) = fake_smtp().await;
        let (port, _) = fake_imap(handler("", |_| None)).await;
        let c = ImapConfig { smtp_port, ..cfg(port) };
        ImapClient::plain_for_tests().check_login(&c, "certa").await.unwrap();
        assert!(smtp_log.lock().unwrap().iter().any(|l| l == "AUTH"));
        let err = ImapClient::plain_for_tests().check_login(&c, "errada").await.unwrap_err();
        assert_eq!(err, ImapError::Auth { icloud: true });
    }

    #[tokio::test]
    async fn draft_save_appends_finds_new_uid_and_removes_old() {
        let (port, log) = fake_imap(handler("UIDPLUS LITERAL+", |rest| rest.starts_with("UID SEARCH HEADER").then(|| ("* SEARCH 12\r\n".into(), "OK")))).await;
        let id = ImapClient::plain_for_tests().draft_save(&cfg(port), "certa", &outgoing(), Some("drafts:11")).await.unwrap();
        assert_eq!(id, "drafts:12");
        assert!(commands(&log, "APPEND")[0].starts_with("APPEND \"Drafts\" (\\Draft \\Seen)"));
        assert_eq!(commands(&log, "UID STORE"), vec!["UID STORE 11 +FLAGS.SILENT (\\Deleted)"]);
        assert_eq!(commands(&log, "UID EXPUNGE"), vec!["UID EXPUNGE 11"]);
    }

    #[tokio::test]
    async fn guess_for_icloud_and_known_domains() {
        let client = ImapClient::new();
        let g = client.guess("ana@me.com", "imap").await;
        assert_eq!(g.config.unwrap().provider, "icloud");
        assert_eq!(g.source, "known");
        let g = client.guess("ana@empresa.com", "icloud").await;
        assert_eq!(g.config.unwrap().imap_host, "imap.mail.me.com");
        let g = client.guess("ana@yahoo.com.br", "imap").await;
        assert_eq!(g.label.as_deref(), Some("Yahoo"));
    }
}
