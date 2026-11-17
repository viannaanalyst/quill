//! Conversa com o iCloud por CalDAV (agenda) e CardDAV (contatos), com o e-mail e a senha de app
//! da conta (HTTP Basic, só sobre HTTPS e só para endereços do iCloud). Só existe com o recurso `net`.
//! A senha nunca aparece em erro nem em log; os redirecionamentos são seguidos à mão, só para o iCloud.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use chrono::Utc;

use crate::calendar::{CalEvent, CalendarInfo, EventPatch, NewEvent};
use crate::contacts::Contact;
use crate::dav::{self, DavResponse};
use crate::{caldav, carddav};

pub const ICLOUD_CALDAV: &str = "https://caldav.icloud.com/";
pub const ICLOUD_CARDDAV: &str = "https://contacts.icloud.com/";

/// Usuário (e-mail do Apple ID) e senha de app. O `Debug` esconde a senha.
#[derive(Clone)]
pub struct Creds {
    pub username: String,
    pub password: String,
}

impl std::fmt::Debug for Creds {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Creds").field("username", &self.username).field("password", &"***").finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DavError {
    /// senha de app recusada: conectar a conta de novo
    NeedsLogin,
    /// o evento mudou em outro aparelho desde que foi lido (ETag diferente)
    Conflict,
    NotFound,
    Network(String),
    /// o iCloud respondeu com erro
    Server(u16),
    /// pedido inválido ou endereço fora do iCloud (a frase já explica)
    Invalid(String),
}

impl std::fmt::Display for DavError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DavError::NeedsLogin => write!(f, "Essa conta precisa entrar de novo."),
            DavError::Conflict => write!(f, "O evento mudou em outro aparelho. Atualize a agenda e tente de novo."),
            DavError::NotFound => write!(f, "Esse evento não existe mais no iCloud."),
            DavError::Network(e) => write!(f, "Sem conexão com o iCloud: {e}"),
            DavError::Server(code) => write!(f, "O iCloud recusou o pedido (erro {code})."),
            DavError::Invalid(msg) => write!(f, "{msg}"),
        }
    }
}

/// Resposta de um pedido: status, ETag, endereço final (depois dos redirecionamentos) e corpo.
struct Reply {
    etag: Option<String>,
    url: String,
    body: String,
}

/// Condição do PUT: arquivo novo (não pode existir) ou troca do que foi lido (mesma ETag).
enum PutIf<'a> {
    New,
    Match(Option<&'a str>),
}

/// Cliente HTTP do CalDAV/CardDAV.
#[derive(Clone)]
pub struct DavClient {
    http: reqwest::Client,
    caldav_root: String,
    carddav_root: String,
    /// nos testes: o único endereço sem HTTPS aceito (o servidor falso)
    test_origin: Option<String>,
}

impl DavClient {
    fn build(caldav_root: &str, carddav_root: &str, test_origin: Option<String>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Quill/0.1")
            // redirecionamento à mão (ver `send`), para conferir o endereço e reenviar a senha só ao iCloud
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("cliente HTTP");
        Self { http, caldav_root: caldav_root.into(), carddav_root: carddav_root.into(), test_origin }
    }

    pub fn icloud() -> Self {
        Self::build(ICLOUD_CALDAV, ICLOUD_CARDDAV, None)
    }

    #[cfg(test)]
    fn for_tests(base: &str) -> Self {
        let root = format!("{}/", base.trim_end_matches('/'));
        Self::build(&root, &root, Some(base.trim_end_matches('/').to_string()))
    }

    /// Só endereços HTTPS do iCloud (`*.icloud.com`) recebem a senha.
    fn check_url(&self, raw: &str) -> Result<url::Url, DavError> {
        let bad = || DavError::Invalid("Endereço do iCloud inválido.".into());
        let u = url::Url::parse(raw.trim()).map_err(|_| bad())?;
        if !u.username().is_empty() || u.password().is_some() {
            return Err(bad());
        }
        if let Some(origin) = &self.test_origin
            && u.origin().ascii_serialization() == *origin
        {
            return Ok(u);
        }
        let host = u.host_str().unwrap_or_default().to_ascii_lowercase();
        if u.scheme() == "https" && (host == "icloud.com" || host.ends_with(".icloud.com")) {
            return Ok(u);
        }
        Err(bad())
    }

    async fn send(&self, creds: &Creds, method: &str, url: &str, headers: &[(&str, String)], body: Option<(&str, String)>) -> Result<Reply, DavError> {
        let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| DavError::Invalid("pedido inválido".into()))?;
        let mut target = self.check_url(url)?;
        for _ in 0..5 {
            let mut req = self.http.request(method.clone(), target.clone()).basic_auth(&creds.username, Some(&creds.password));
            for (k, v) in headers {
                req = req.header(*k, v);
            }
            if let Some((ctype, b)) = &body {
                req = req.header("Content-Type", *ctype).body(b.clone());
            }
            let resp = req.send().await.map_err(|e| DavError::Network(e.without_url().to_string()))?;
            let status = resp.status().as_u16();
            if matches!(status, 301 | 302 | 303 | 307 | 308) {
                let location = resp.headers().get("location").and_then(|v| v.to_str().ok()).ok_or(DavError::Server(status))?;
                let next = target.join(location).map_err(|_| DavError::Server(status))?;
                target = self.check_url(next.as_str())?;
                continue;
            }
            let etag = resp.headers().get("etag").and_then(|v| v.to_str().ok()).map(str::to_string);
            let text = resp.text().await.map_err(|e| DavError::Network(e.without_url().to_string()))?;
            return match status {
                200..=299 => Ok(Reply { etag, url: target.to_string(), body: text }),
                401 => Err(DavError::NeedsLogin),
                404 | 410 => Err(DavError::NotFound),
                412 => Err(DavError::Conflict),
                other => Err(DavError::Server(other)),
            };
        }
        Err(DavError::Invalid("O iCloud mandou para outro endereço vezes demais.".into()))
    }

    async fn xml_request(&self, creds: &Creds, method: &str, url: &str, depth: &str, body: &str) -> Result<(Vec<DavResponse>, String), DavError> {
        let reply = self
            .send(creds, method, url, &[("Depth", depth.to_string())], Some(("application/xml; charset=utf-8", body.to_string())))
            .await?;
        let list = dav::parse_multistatus(&reply.body).map_err(|_| DavError::Invalid("O iCloud mandou uma resposta que não deu para ler.".into()))?;
        Ok((list, reply.url))
    }

    /// PROPFIND; devolve as respostas e o endereço final (para resolver os `href` relativos).
    pub async fn propfind(&self, creds: &Creds, url: &str, depth: &str, body: &str) -> Result<(Vec<DavResponse>, String), DavError> {
        self.xml_request(creds, "PROPFIND", url, depth, body).await
    }

    pub async fn report(&self, creds: &Creds, url: &str, body: &str) -> Result<(Vec<DavResponse>, String), DavError> {
        self.xml_request(creds, "REPORT", url, "1", body).await
    }

    /// Lê um arquivo (.ics) e a ETag dele.
    async fn get(&self, creds: &Creds, url: &str) -> Result<(String, Option<String>), DavError> {
        let r = self.send(creds, "GET", url, &[], None).await?;
        Ok((r.body, r.etag))
    }

    async fn put(&self, creds: &Creds, url: &str, ics: String, cond: PutIf<'_>) -> Result<(), DavError> {
        let headers = match cond {
            PutIf::New => vec![("If-None-Match", "*".to_string())],
            PutIf::Match(Some(etag)) => vec![("If-Match", etag.to_string())],
            PutIf::Match(None) => vec![],
        };
        self.send(creds, "PUT", url, &headers, Some(("text/calendar; charset=utf-8", ics))).await.map(|_| ())
    }

    async fn delete(&self, creds: &Creds, url: &str, etag: Option<&str>) -> Result<(), DavError> {
        let headers: Vec<(&str, String)> = etag.map(|e| vec![("If-Match", e.to_string())]).unwrap_or_default();
        self.send(creds, "DELETE", url, &headers, None).await.map(|_| ())
    }

    /// Endereço do "principal" (a pessoa logada) a partir da raiz do serviço.
    async fn principal(&self, creds: &Creds, root: &str) -> Result<String, DavError> {
        let (list, at) = self.propfind(creds, root, "0", dav::PROPFIND_PRINCIPAL).await?;
        let href = list
            .iter()
            .find_map(|r| r.prop("current-user-principal").and_then(|p| p.hrefs.first().cloned()))
            .ok_or_else(|| DavError::Invalid("O iCloud não informou a conta.".into()))?;
        dav::resolve(&at, &href).map_err(DavError::Invalid)
    }

    /// Onde ficam as agendas da conta e os e-mails dela.
    async fn calendar_home(&self, creds: &Creds) -> Result<CalHome, DavError> {
        let principal = self.principal(creds, &self.caldav_root.clone()).await?;
        let (list, at) = self.propfind(creds, &principal, "0", dav::PROPFIND_CALENDAR_HOME).await?;
        let r = list.first().ok_or_else(|| DavError::Invalid("O iCloud não informou as agendas.".into()))?;
        let home = r
            .prop("calendar-home-set")
            .and_then(|p| p.hrefs.first())
            .ok_or_else(|| DavError::Invalid("O iCloud não informou as agendas.".into()))?;
        let addresses = r
            .prop("calendar-user-address-set")
            .map(|p| {
                p.hrefs
                    .iter()
                    .filter_map(|h| h.get(..7).filter(|s| s.eq_ignore_ascii_case("mailto:")).map(|_| h[7..].trim().to_string()))
                    .collect()
            })
            .unwrap_or_default();
        Ok(CalHome {
            home: dav::resolve(&at, home).map_err(DavError::Invalid)?,
            addresses,
            name: r.text("displayname").map(str::to_string),
            calendars: Vec::new(),
        })
    }

    async fn list_calendars(&self, creds: &Creds, home: &str) -> Result<Vec<CalendarInfo>, DavError> {
        let (list, at) = self.propfind(creds, home, "1", dav::PROPFIND_CALENDARS).await?;
        Ok(caldav::parse_calendars(&list, &at))
    }

    /// Eventos de uma agenda no intervalo, com as repetições abertas.
    async fn calendar_events(&self, creds: &Creds, calendar_id: &str, min: chrono::DateTime<Utc>, max: chrono::DateTime<Utc>, me: &[String]) -> Result<Vec<CalEvent>, DavError> {
        let body = dav::calendar_query(&caldav::utc_compact(&min), &caldav::utc_compact(&max));
        let (list, at) = self.report(creds, calendar_id, &body).await?;
        let mut out = Vec::new();
        for r in &list {
            let (Some(data), Ok(href)) = (r.text("calendar-data"), dav::resolve(&at, &r.href)) else { continue };
            out.extend(caldav::expand_events(data, &href, calendar_id, me, min, max));
        }
        Ok(out)
    }

    /// Catálogos de contatos da conta.
    async fn addressbooks(&self, creds: &Creds) -> Result<Vec<String>, DavError> {
        let principal = self.principal(creds, &self.carddav_root.clone()).await?;
        let (list, at) = self.propfind(creds, &principal, "0", dav::PROPFIND_ADDRESSBOOK_HOME).await?;
        let home = list
            .iter()
            .find_map(|r| r.prop("addressbook-home-set").and_then(|p| p.hrefs.first().cloned()))
            .ok_or_else(|| DavError::Invalid("O iCloud não informou os contatos.".into()))?;
        let home = dav::resolve(&at, &home).map_err(DavError::Invalid)?;
        let (list, at) = self.propfind(creds, &home, "1", dav::PROPFIND_ADDRESSBOOKS).await?;
        Ok(carddav::parse_addressbooks(&list, &at))
    }

    /// Contatos de um catálogo: pela consulta (só os com e-mail) ou, se o servidor não aceitar,
    /// listando os cartões e pedindo em lotes de 200.
    async fn book_contacts(&self, creds: &Creds, book: &str) -> Result<Vec<Contact>, DavError> {
        match self.report(creds, book, dav::ADDRESSBOOK_QUERY).await {
            Ok((list, _)) => return Ok(carddav::contacts_from_responses(&list, 5)),
            Err(DavError::NeedsLogin) => return Err(DavError::NeedsLogin),
            Err(_) => {}
        }
        let (list, _) = self.propfind(creds, book, "1", dav::PROPFIND_ETAGS).await?;
        let hrefs = carddav::card_hrefs(&list);
        let mut out = Vec::new();
        for chunk in hrefs.chunks(200) {
            let (list, _) = self.report(creds, book, &dav::addressbook_multiget(chunk)).await?;
            out.extend(carddav::contacts_from_responses(&list, 5));
        }
        Ok(out)
    }
}

/// O que a descoberta da agenda encontrou (guardado na memória para não descobrir a cada vez).
#[derive(Debug, Clone)]
struct CalHome {
    home: String,
    /// e-mails da conta no iCloud (para saber qual convidado sou eu e quem organiza)
    addresses: Vec<String>,
    name: Option<String>,
    /// última lista de agendas lida
    calendars: Vec<CalendarInfo>,
}

/// Id novo para um evento (formato de UUID, como o app Calendário).
fn new_uid() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("gerador aleatório do sistema indisponível");
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02X}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

/// Agenda e contatos das contas iCloud, com a descoberta guardada por conta.
pub struct ICloudDav {
    client: DavClient,
    homes: Mutex<HashMap<String, CalHome>>,
    books: Mutex<HashMap<String, Vec<String>>>,
}

impl Default for ICloudDav {
    fn default() -> Self {
        Self::new(DavClient::icloud())
    }
}

impl ICloudDav {
    pub fn new(client: DavClient) -> Self {
        Self { client, homes: Mutex::new(HashMap::new()), books: Mutex::new(HashMap::new()) }
    }

    /// Esquece o que foi descoberto da conta (ao remover a conta ou trocar a senha).
    pub fn forget(&self, email: &str) {
        let key = email.to_lowercase();
        self.homes.lock().expect("trava da agenda").remove(&key);
        self.books.lock().expect("trava dos contatos").remove(&key);
    }

    fn cached(&self, email: &str) -> Option<CalHome> {
        self.homes.lock().expect("trava da agenda").get(&email.to_lowercase()).cloned()
    }

    fn remember(&self, email: &str, home: CalHome) {
        self.homes.lock().expect("trava da agenda").insert(email.to_lowercase(), home);
    }

    /// Descoberta (só na primeira vez) e a lista de agendas (sempre lida de novo).
    /// Se a pasta guardada sumiu (conta migrou de servidor), descobre de novo uma vez.
    async fn home_with_calendars(&self, email: &str, creds: &Creds) -> Result<CalHome, DavError> {
        let mut home = match self.cached(email) {
            Some(h) => h,
            None => self.client.calendar_home(creds).await?,
        };
        home.calendars = match self.client.list_calendars(creds, &home.home).await {
            Err(DavError::NotFound) => {
                home = self.client.calendar_home(creds).await?;
                self.client.list_calendars(creds, &home.home).await?
            }
            other => other?,
        };
        self.remember(email, home.clone());
        Ok(home)
    }

    fn me(email: &str, creds: &Creds, home: &CalHome) -> Vec<String> {
        let mut me = vec![email.to_string(), creds.username.clone()];
        me.extend(home.addresses.iter().cloned());
        me
    }

    /// E-mail (e nome) que vai como ORGANIZER: o endereço do iCloud que é a própria conta.
    fn organizer(email: &str, home: &CalHome) -> (String, Option<String>) {
        let addr = home
            .addresses
            .iter()
            .find(|a| caldav::is_me(a, &[email.to_string()]))
            .or(home.addresses.first())
            .cloned()
            .unwrap_or_else(|| email.to_string());
        (addr, home.name.clone())
    }

    /// Agendas e eventos da conta no intervalo (RFC 3339). Uma agenda com erro não derruba as outras.
    pub async fn agenda(&self, email: &str, creds: &Creds, time_min: &str, time_max: &str) -> Result<(Vec<CalendarInfo>, Vec<CalEvent>), DavError> {
        let min = caldav::parse_rfc3339(time_min).map_err(DavError::Invalid)?;
        let max = caldav::parse_rfc3339(time_max).map_err(DavError::Invalid)?;
        let home = self.home_with_calendars(email, creds).await?;
        let me = Self::me(email, creds, &home);
        let mut set = tokio::task::JoinSet::new();
        for c in &home.calendars {
            let (client, creds, id, me) = (self.client.clone(), creds.clone(), c.id.clone(), me.clone());
            set.spawn(async move { client.calendar_events(&creds, &id, min, max, &me).await });
        }
        let mut events = Vec::new();
        while let Some(res) = set.join_next().await {
            match res {
                Ok(Ok(list)) => events.extend(list),
                Ok(Err(DavError::NeedsLogin)) => return Err(DavError::NeedsLogin),
                _ => {}
            }
        }
        Ok((home.calendars, events))
    }

    /// Confere que a agenda é da conta e que o evento está dentro dela; devolve (descoberta, URL do .ics, ocorrência).
    async fn locate<'a>(&self, email: &str, creds: &Creds, calendar_id: &str, event_id: Option<&'a str>) -> Result<(CalHome, String, Option<&'a str>), DavError> {
        let known = |h: &CalHome| h.calendars.iter().any(|c| c.id == calendar_id);
        let home = match self.cached(email).filter(|h| known(h)) {
            Some(h) => h,
            None => {
                let cached_home = self.cached(email).map(|h| h.home);
                // agenda fora da pasta da conta: nem pergunta ao servidor
                if cached_home.is_some_and(|h| !calendar_id.starts_with(&h)) {
                    return Err(DavError::Invalid("Essa agenda não é desta conta.".into()));
                }
                self.home_with_calendars(email, creds).await?
            }
        };
        if !known(&home) {
            return Err(DavError::Invalid("Essa agenda não é desta conta.".into()));
        }
        let Some(event_id) = event_id else { return Ok((home, String::new(), None)) };
        let (href, occurrence) = caldav::split_event_id(event_id);
        // o .ics tem que estar direto dentro da agenda (nada de "..", nem barra, nem barra codificada)
        let inside = href.strip_prefix(calendar_id).is_some_and(|rest| {
            let low = rest.to_ascii_lowercase();
            !rest.is_empty() && !rest.contains(['/', '\\', '?', '#']) && !low.contains("..") && !low.contains("%2f") && !low.contains("%5c") && !low.contains("%2e%2e")
        });
        if !inside {
            return Err(DavError::Invalid("Esse evento não é desta agenda.".into()));
        }
        Ok((home, href.to_string(), occurrence))
    }

    /// Cria o evento (PUT de um .ics novo). Convidados recebem o convite pelo próprio iCloud.
    pub async fn create(&self, email: &str, creds: &Creds, calendar_id: &str, e: &NewEvent) -> Result<CalEvent, DavError> {
        let (home, _, _) = self.locate(email, creds, calendar_id, None).await?;
        let uid = new_uid();
        let url = format!("{calendar_id}{uid}.ics");
        let (org_email, org_name) = Self::organizer(email, &home);
        let ics = caldav::new_event_ics(e, &uid, Some((&org_email, org_name.as_deref())), Utc::now()).map_err(DavError::Invalid)?;
        self.client.put(creds, &url, ics.clone(), PutIf::New).await?;
        caldav::find_event(&ics, &url, calendar_id, &Self::me(email, creds, &home), None).ok_or_else(|| DavError::Invalid("O evento foi criado, mas não deu para ler de volta.".into()))
    }

    /// Edita (lê com a ETag, aplica e grava com If-Match). Numa ocorrência, muda só ela.
    pub async fn update(&self, email: &str, creds: &Creds, calendar_id: &str, event_id: &str, p: &EventPatch) -> Result<CalEvent, DavError> {
        let (home, href, occurrence) = self.locate(email, creds, calendar_id, Some(event_id)).await?;
        let (ics, etag) = self.client.get(creds, &href).await?;
        let (org_email, org_name) = Self::organizer(email, &home);
        let new = caldav::apply_patch(&ics, occurrence, p, (&org_email, org_name.as_deref()), Utc::now()).map_err(DavError::Invalid)?;
        self.client.put(creds, &href, new.clone(), PutIf::Match(etag.as_deref())).await?;
        caldav::find_event(&new, &href, calendar_id, &Self::me(email, creds, &home), occurrence).ok_or_else(|| DavError::Invalid("O evento foi salvo, mas não deu para ler de volta.".into()))
    }

    /// Responde ao convite (accepted, declined, tentative); o iCloud avisa o organizador.
    pub async fn rsvp(&self, email: &str, creds: &Creds, calendar_id: &str, event_id: &str, status: &str) -> Result<(), DavError> {
        let (home, href, occurrence) = self.locate(email, creds, calendar_id, Some(event_id)).await?;
        let (ics, etag) = self.client.get(creds, &href).await?;
        let new = caldav::apply_rsvp(&ics, occurrence, &Self::me(email, creds, &home), status, Utc::now()).map_err(DavError::Invalid)?;
        self.client.put(creds, &href, new, PutIf::Match(etag.as_deref())).await
    }

    /// Apaga o evento; numa ocorrência de repetição, só ela (EXDATE na série).
    pub async fn delete(&self, email: &str, creds: &Creds, calendar_id: &str, event_id: &str) -> Result<(), DavError> {
        let (_, href, occurrence) = self.locate(email, creds, calendar_id, Some(event_id)).await?;
        let (ics, etag) = self.client.get(creds, &href).await?;
        match occurrence {
            Some(key) => match caldav::remove_occurrence(&ics, key).map_err(DavError::Invalid)? {
                Some(new) => self.client.put(creds, &href, new, PutIf::Match(etag.as_deref())).await,
                None => self.client.delete(creds, &href, etag.as_deref()).await,
            },
            None => self.client.delete(creds, &href, etag.as_deref()).await,
        }
    }

    /// Sugestões de destinatário: contatos do iCloud (peso 5) + quem aparece nos enviados (`sent`, peso 3),
    /// buscados ao mesmo tempo e juntos sem repetir. Se uma fonte falhar, fica a outra.
    pub async fn suggestions<F>(&self, email: &str, creds: &Creds, sent: F, own_emails: &[String]) -> Vec<Contact>
    where
        F: std::future::Future<Output = Vec<Contact>>,
    {
        let (cards, sent) = tokio::join!(self.contacts(email, creds), sent);
        crate::contacts::merge_contacts(vec![cards.unwrap_or_default(), sent], own_emails)
    }

    /// Contatos do iCloud (peso 5). Os catálogos são descobertos uma vez por conta.
    pub async fn contacts(&self, email: &str, creds: &Creds) -> Result<Vec<Contact>, DavError> {
        let key = email.to_lowercase();
        let cached = self.books.lock().expect("trava dos contatos").get(&key).cloned();
        let books = match cached {
            Some(b) => b,
            None => {
                let b = self.client.addressbooks(creds).await?;
                self.books.lock().expect("trava dos contatos").insert(key.clone(), b.clone());
                b
            }
        };
        let mut out = Vec::new();
        for book in &books {
            match self.client.book_contacts(creds, book).await {
                Ok(list) => out.extend(list),
                Err(DavError::NotFound) => {
                    // catálogo mudou de lugar: descobre de novo na próxima vez
                    self.books.lock().expect("trava dos contatos").remove(&key);
                }
                Err(e) => return Err(e),
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Servidor falso: responde cada pedido com o próximo (status, cabeçalhos, corpo) e guarda
    /// o pedido inteiro (cabeçalhos e corpo) que recebeu.
    async fn fake_dav(replies: Vec<(u16, &'static str, String)>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let handle = tokio::spawn(async move {
            let mut seen = Vec::new();
            for (status, headers, body) in replies {
                let (mut s, _) = listener.accept().await.unwrap();
                let mut buf = Vec::new();
                let mut chunk = vec![0u8; 8192];
                loop {
                    let n = s.read(&mut chunk).await.unwrap();
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let len = text[..end]
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                            .unwrap_or(0);
                        if buf.len() >= end + 4 + len {
                            break;
                        }
                    }
                }
                seen.push(String::from_utf8_lossy(&buf).into_owned());
                let resp = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/xml; charset=utf-8\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                s.write_all(resp.as_bytes()).await.unwrap();
                s.shutdown().await.ok();
            }
            seen
        });
        (base, handle)
    }

    fn creds() -> Creds {
        Creds { username: "ana@icloud.com".into(), password: "abcd-efgh-ijkl-mnop".into() }
    }

    fn ms(inner: &str) -> String {
        format!(r#"<?xml version="1.0" encoding="UTF-8"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/" xmlns:R="urn:ietf:params:xml:ns:carddav">{inner}</multistatus>"#)
    }

    fn ok(href: &str, props: &str) -> String {
        format!("<response><href>{href}</href><propstat><prop>{props}</prop><status>HTTP/1.1 200 OK</status></propstat></response>")
    }

    /// As três respostas da descoberta da agenda (principal, pasta das agendas, lista).
    fn discovery() -> Vec<(u16, &'static str, String)> {
        vec![
            (207, "", ms(&ok("/", "<current-user-principal><href>/123/principal/</href></current-user-principal>"))),
            (
                207,
                "",
                ms(&ok(
                    "/123/principal/",
                    "<C:calendar-home-set><href>/123/calendars/</href></C:calendar-home-set>\
                     <C:calendar-user-address-set><href>mailto:ana@icloud.com</href><href>/123/principal/</href></C:calendar-user-address-set>\
                     <displayname>Ana Souza</displayname>",
                )),
            ),
            calendars_reply(),
        ]
    }

    fn calendars_reply() -> (u16, &'static str, String) {
        (
            207,
            "",
            ms(&format!(
                "{}{}",
                ok("/123/calendars/", "<resourcetype><collection/></resourcetype>"),
                ok(
                    "/123/calendars/home/",
                    "<resourcetype><collection/><C:calendar/></resourcetype><displayname>Casa</displayname>\
                     <A:calendar-color>#FF2968FF</A:calendar-color>\
                     <C:supported-calendar-component-set><C:comp name=\"VEVENT\"/></C:supported-calendar-component-set>\
                     <current-user-privilege-set><privilege><write/></privilege></current-user-privilege-set>"
                )
            )),
        )
    }

    const EVENT: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ev-1\r\nDTSTART:20261119T130000Z\r\nDTEND:20261119T140000Z\r\n\
SUMMARY:Culto\r\nORGANIZER:mailto:rafael@x.com\r\nATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:ana@me.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    const WEEKLY: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:rep\r\nDTSTART:20261102T130000Z\r\nDTEND:20261102T140000Z\r\n\
RRULE:FREQ=WEEKLY;COUNT=4\r\nSUMMARY:Daily\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    fn events_reply(ics: &str) -> (u16, &'static str, String) {
        let ics = ics.replace('&', "&amp;").replace('<', "&lt;");
        (207, "", ms(&ok("/123/calendars/home/ev-1.ics", &format!("<getetag>\"e1\"</getetag><C:calendar-data>{ics}</C:calendar-data>"))))
    }

    fn header<'a>(req: &'a str, name: &str) -> Option<&'a str> {
        let head = &req[..req.find("\r\n\r\n").unwrap_or(req.len())];
        head.lines().find_map(|l| {
            let (n, v) = l.split_once(':')?;
            n.trim().eq_ignore_ascii_case(name).then(|| v.trim())
        })
    }

    #[test]
    fn so_aceita_https_do_icloud() {
        let c = DavClient::icloud();
        assert!(c.check_url("https://caldav.icloud.com/").is_ok());
        assert!(c.check_url("https://p52-caldav.icloud.com:443/123/calendars/").is_ok());
        assert!(c.check_url("http://p52-caldav.icloud.com/").is_err(), "sem HTTPS, nunca");
        assert!(c.check_url("https://icloud.com.golpe.com/").is_err());
        assert!(c.check_url("https://golpe.com/?icloud.com").is_err());
        assert!(c.check_url("https://ana:senha@p52-caldav.icloud.com/").is_err());
    }

    #[test]
    fn credenciais_nao_aparecem_no_debug() {
        let text = format!("{:?}", creds());
        assert!(!text.contains("abcd-efgh"));
    }

    #[tokio::test]
    async fn descobre_uma_vez_e_le_agendas_e_eventos() {
        let mut replies = discovery();
        replies.push(events_reply(EVENT));
        replies.push(calendars_reply());
        replies.push(events_reply(EVENT));
        let (base, srv) = fake_dav(replies).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let (cals, events) = dav.agenda("ana@icloud.com", &creds(), "2026-11-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z").await.unwrap();
        assert_eq!(cals.len(), 1);
        assert_eq!(cals[0].id, format!("{base}/123/calendars/home/"));
        assert_eq!(cals[0].color.as_deref(), Some("#FF2968"));
        assert!(cals[0].primary);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, format!("{base}/123/calendars/home/ev-1.ics"));
        assert_eq!(events[0].my_status.as_deref(), Some("needsAction"), "ana@me.com é a mesma conta");
        // segunda vez: não descobre de novo, só lista as agendas e os eventos
        dav.agenda("ana@icloud.com", &creds(), "2026-11-01T00:00:00Z", "2027-01-01T00:00:00Z").await.unwrap();
        let reqs = srv.await.unwrap();
        assert_eq!(reqs.len(), 6);
        assert!(reqs[0].starts_with("PROPFIND / HTTP/1.1"));
        assert_eq!(header(&reqs[0], "depth"), Some("0"));
        use base64::Engine;
        let basic = format!("Basic {}", base64::engine::general_purpose::STANDARD.encode("ana@icloud.com:abcd-efgh-ijkl-mnop"));
        assert_eq!(header(&reqs[0], "authorization"), Some(basic.as_str()));
        assert!(reqs[0].contains("current-user-principal"));
        assert!(reqs[1].starts_with("PROPFIND /123/principal/ "));
        assert!(reqs[2].starts_with("PROPFIND /123/calendars/ "));
        assert_eq!(header(&reqs[2], "depth"), Some("1"));
        assert!(reqs[3].starts_with("REPORT /123/calendars/home/ "));
        assert!(reqs[3].contains(r#"start="20261101T000000Z" end="20270101T000000Z""#));
        assert!(reqs[4].starts_with("PROPFIND /123/calendars/ "));
        assert!(reqs[5].starts_with("REPORT /123/calendars/home/ "));
    }

    #[tokio::test]
    async fn senha_recusada_vira_entrar_de_novo() {
        let (base, _srv) = fake_dav(vec![(401, "WWW-Authenticate: Basic realm=\"x\"\r\n", String::new())]).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let err = dav.agenda("ana@icloud.com", &creds(), "2026-11-01T00:00:00Z", "2027-01-01T00:00:00Z").await.unwrap_err();
        assert_eq!(err, DavError::NeedsLogin);
    }

    #[tokio::test]
    async fn segue_redirecionamento_do_mesmo_servidor_e_recusa_os_outros() {
        let (base, srv) = fake_dav(vec![
            (301, "Location: /novo/\r\n", String::new()),
            (207, "", ms(&ok("/novo/", "<current-user-principal><href>/123/principal/</href></current-user-principal>"))),
        ])
        .await;
        let client = DavClient::for_tests(&base);
        let (list, url) = client.propfind(&creds(), &format!("{base}/"), "0", crate::dav::PROPFIND_PRINCIPAL).await.unwrap();
        assert_eq!(url, format!("{base}/novo/"));
        assert_eq!(list[0].prop("current-user-principal").unwrap().hrefs, ["/123/principal/"]);
        let reqs = srv.await.unwrap();
        assert!(reqs[1].starts_with("PROPFIND /novo/ "));
        assert!(header(&reqs[1], "authorization").is_some());

        let (base, srv) = fake_dav(vec![(302, "Location: https://golpe.com/roubar\r\n", String::new())]).await;
        let err = DavClient::for_tests(&base).propfind(&creds(), &format!("{base}/"), "0", crate::dav::PROPFIND_PRINCIPAL).await.unwrap_err();
        assert!(matches!(err, DavError::Invalid(_)), "{err:?}");
        assert_eq!(srv.await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn cria_evento_com_put_novo() {
        let mut replies = discovery();
        replies.push((201, "ETag: \"novo\"\r\n", String::new()));
        let (base, srv) = fake_dav(replies).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let cal = format!("{base}/123/calendars/home/");
        let e = crate::calendar::NewEvent {
            title: "Almoço".into(),
            start: crate::calendar::EventTime { date_time: Some("2026-11-18T12:30:00-03:00".into()), date: None },
            end: crate::calendar::EventTime { date_time: Some("2026-11-18T13:30:00-03:00".into()), date: None },
            location: None,
            description: None,
            attendees: vec!["bia@y.com".into()],
            reminders: Some(vec![10]),
            meet: true,
        };
        let created = dav.create("ana@icloud.com", &creds(), &cal, &e).await.unwrap();
        assert!(created.id.starts_with(&cal) && created.id.ends_with(".ics"));
        assert_eq!(created.calendar_id, cal);
        assert_eq!(created.title, "Almoço");
        assert_eq!(created.start.date_time.as_deref(), Some("2026-11-18T15:30:00Z"));
        let reqs = srv.await.unwrap();
        let put = &reqs[3];
        assert!(put.starts_with("PUT /123/calendars/home/"));
        assert_eq!(header(put, "if-none-match"), Some("*"));
        assert!(header(put, "content-type").unwrap().starts_with("text/calendar"));
        assert!(put.contains("SUMMARY:Almoço"));
        assert!(put.contains("ORGANIZER;CN=Ana Souza:mailto:ana@icloud.com"));
    }

    #[tokio::test]
    async fn edita_uma_ocorrencia_com_if_match() {
        let mut replies = discovery();
        replies.push((200, "ETag: \"e1\"\r\nContent-Type: text/calendar\r\n", WEEKLY.to_string()));
        replies.push((204, "ETag: \"e2\"\r\n", String::new()));
        let (base, srv) = fake_dav(replies).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let cal = format!("{base}/123/calendars/home/");
        let id = format!("{cal}rep.ics#20261109T130000Z");
        let p = crate::calendar::EventPatch { title: Some("Só hoje".into()), ..Default::default() };
        let ev = dav.update("ana@icloud.com", &creds(), &cal, &id, &p).await.unwrap();
        assert_eq!(ev.id, id);
        assert_eq!(ev.title, "Só hoje");
        let reqs = srv.await.unwrap();
        assert!(reqs[3].starts_with("GET /123/calendars/home/rep.ics "));
        assert!(reqs[4].starts_with("PUT /123/calendars/home/rep.ics "));
        assert_eq!(header(&reqs[4], "if-match"), Some("\"e1\""));
        assert!(reqs[4].contains("RECURRENCE-ID:20261109T130000Z"));
    }

    #[tokio::test]
    async fn evento_mudado_em_outro_aparelho_avisa() {
        let mut replies = discovery();
        replies.push((200, "ETag: \"e1\"\r\n", EVENT.to_string()));
        replies.push((412, "", String::new()));
        let (base, _srv) = fake_dav(replies).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let cal = format!("{base}/123/calendars/home/");
        let err = dav.rsvp("ana@icloud.com", &creds(), &cal, &format!("{cal}ev-1.ics"), "accepted").await.unwrap_err();
        assert_eq!(err, DavError::Conflict);
        assert!(err.to_string().contains("outro aparelho"));
    }

    #[tokio::test]
    async fn responde_convite_gravando_o_partstat() {
        let mut replies = discovery();
        replies.push((200, "ETag: \"e1\"\r\n", EVENT.to_string()));
        replies.push((204, "", String::new()));
        let (base, srv) = fake_dav(replies).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let cal = format!("{base}/123/calendars/home/");
        dav.rsvp("ana@icloud.com", &creds(), &cal, &format!("{cal}ev-1.ics"), "accepted").await.unwrap();
        let reqs = srv.await.unwrap();
        assert!(reqs[4].contains("ATTENDEE;PARTSTAT=ACCEPTED:mailto:ana@me.com"));
        assert_eq!(header(&reqs[4], "if-match"), Some("\"e1\""));
    }

    #[tokio::test]
    async fn apaga_evento_inteiro_ou_so_a_ocorrencia() {
        let mut replies = discovery();
        replies.push((200, "ETag: \"e1\"\r\n", EVENT.to_string()));
        replies.push((204, "", String::new()));
        replies.push((200, "ETag: \"w1\"\r\n", WEEKLY.to_string()));
        replies.push((204, "", String::new()));
        let (base, srv) = fake_dav(replies).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let cal = format!("{base}/123/calendars/home/");
        dav.delete("ana@icloud.com", &creds(), &cal, &format!("{cal}ev-1.ics")).await.unwrap();
        dav.delete("ana@icloud.com", &creds(), &cal, &format!("{cal}rep.ics#20261116T130000Z")).await.unwrap();
        let reqs = srv.await.unwrap();
        assert!(reqs[4].starts_with("DELETE /123/calendars/home/ev-1.ics "));
        assert_eq!(header(&reqs[4], "if-match"), Some("\"e1\""));
        assert!(reqs[6].starts_with("PUT /123/calendars/home/rep.ics "));
        assert_eq!(header(&reqs[6], "if-match"), Some("\"w1\""));
        assert!(reqs[6].contains("EXDATE:20261116T130000Z"));
    }

    #[tokio::test]
    async fn recusa_evento_fora_da_agenda_da_conta() {
        let (base, srv) = fake_dav(discovery()).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let cal = format!("{base}/123/calendars/home/");
        let err = dav.delete("ana@icloud.com", &creds(), &cal, &format!("{base}/999/calendars/outra/x.ics")).await.unwrap_err();
        assert!(matches!(err, DavError::Invalid(_)));
        let err = dav.delete("ana@icloud.com", &creds(), &format!("{base}/999/calendars/outra/"), &format!("{base}/999/calendars/outra/x.ics")).await.unwrap_err();
        assert!(matches!(err, DavError::Invalid(_)));
        let err = dav.delete("ana@icloud.com", &creds(), &cal, &format!("{cal}%2E%2E%2Fwork%2Fx.ics")).await.unwrap_err();
        assert!(matches!(err, DavError::Invalid(_)), "caminho codificado para sair da agenda");
        assert_eq!(srv.await.unwrap().len(), 3, "nenhum pedido além da descoberta");
    }

    fn contacts_discovery() -> Vec<(u16, &'static str, String)> {
        vec![
            (207, "", ms(&ok("/", "<current-user-principal><href>/123/principal/</href></current-user-principal>"))),
            (207, "", ms(&ok("/123/principal/", "<R:addressbook-home-set><href>/123/carddavhome/</href></R:addressbook-home-set>"))),
            (
                207,
                "",
                ms(&format!(
                    "{}{}",
                    ok("/123/carddavhome/", "<resourcetype><collection/></resourcetype>"),
                    ok("/123/carddavhome/card/", "<resourcetype><collection/><R:addressbook/></resourcetype>")
                )),
            ),
        ]
    }

    const CARD: &str = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Bia Lima\r\nEMAIL:bia@y.com\r\nEND:VCARD\r\n";

    #[tokio::test]
    async fn le_contatos_pela_consulta() {
        let mut replies = contacts_discovery();
        replies.push((207, "", ms(&ok("/123/carddavhome/card/1.vcf", &format!("<getetag>\"c1\"</getetag><R:address-data>{CARD}</R:address-data>")))));
        let (base, srv) = fake_dav(replies).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let list = dav.contacts("ana@icloud.com", &creds()).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name.as_deref(), Some("Bia Lima"));
        assert_eq!(list[0].score, 5);
        let reqs = srv.await.unwrap();
        assert!(reqs[3].starts_with("REPORT /123/carddavhome/card/ "));
        assert!(reqs[3].contains("addressbook-query"));
    }

    #[tokio::test]
    async fn sugestoes_juntam_icloud_e_enviados_sem_repetir() {
        let mut replies = contacts_discovery();
        replies.push((207, "", ms(&ok("/123/carddavhome/card/1.vcf", &format!("<R:address-data>{CARD}</R:address-data>")))));
        let (base, _srv) = fake_dav(replies).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let sent = async {
            vec![
                Contact { name: None, email: "BIA@y.com".into(), photo: None, score: 3 },
                Contact { name: Some("Caio".into()), email: "caio@z.com".into(), photo: None, score: 3 },
                Contact { name: None, email: "ana@icloud.com".into(), photo: None, score: 3 },
            ]
        };
        let list = dav.suggestions("ana@icloud.com", &creds(), sent, &["ana@icloud.com".into()]).await;
        let got: Vec<_> = list.iter().map(|c| (c.email.to_lowercase(), c.score)).collect();
        assert_eq!(got, [("bia@y.com".to_string(), 8), ("caio@z.com".to_string(), 3)]);
        assert_eq!(list[0].name.as_deref(), Some("Bia Lima"));

        // iCloud fora do ar: ficam só os enviados
        let (base, _srv) = fake_dav(vec![(500, "", String::new())]).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let sent = async { vec![Contact { name: None, email: "caio@z.com".into(), photo: None, score: 3 }] };
        assert_eq!(dav.suggestions("ana@icloud.com", &creds(), sent, &[]).await.len(), 1);
    }

    #[tokio::test]
    async fn sem_consulta_lista_e_pede_em_lote() {
        let mut replies = contacts_discovery();
        replies.push((403, "", String::new()));
        replies.push((
            207,
            "",
            ms(&format!(
                "{}{}",
                ok("/123/carddavhome/card/", "<resourcetype><collection/><R:addressbook/></resourcetype>"),
                ok("/123/carddavhome/card/1.vcf", "<getetag>\"c1\"</getetag><resourcetype/>")
            )),
        ));
        replies.push((207, "", ms(&ok("/123/carddavhome/card/1.vcf", &format!("<R:address-data>{CARD}</R:address-data>")))));
        let (base, srv) = fake_dav(replies).await;
        let dav = ICloudDav::new(DavClient::for_tests(&base));
        let list = dav.contacts("ana@icloud.com", &creds()).await.unwrap();
        assert_eq!(list.len(), 1);
        let reqs = srv.await.unwrap();
        assert!(reqs[4].starts_with("PROPFIND /123/carddavhome/card/ "));
        assert!(reqs[5].contains("addressbook-multiget") && reqs[5].contains("<d:href>/123/carddavhome/card/1.vcf</d:href>"));
    }
}
