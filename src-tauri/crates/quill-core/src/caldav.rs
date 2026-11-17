//! Agenda do iCloud (CalDAV): lê agendas e eventos (abrindo as repetições), e monta os .ics
//! para criar, editar, responder convites e apagar. Só a lógica; a rede fica em `dav_client.rs`.
//! Tudo vira os mesmos tipos da agenda do Google (`calendar.rs`), então as telas não mudam.
//!
//! Ids: a agenda é a URL dela; o evento é a URL do .ics e, numa repetição, `#` + o início
//! original da ocorrência (`20261124T130000Z`, ou `20261124` no dia inteiro).

use std::collections::{BTreeMap, HashSet};

use chrono::{DateTime, Duration, FixedOffset, NaiveDate, NaiveDateTime, SecondsFormat, TimeZone, Utc};

use crate::calendar::{Attendee, CalEvent, CalendarInfo, EventPatch, EventTime, NewEvent};
use crate::dav::DavResponse;
use crate::ical::{self, Component, Property};

// ---------- agendas ----------

/// Agendas de eventos da pasta do iCloud, na ordem do app Calendário.
/// A primeira em que dá para escrever fica como a principal.
pub fn parse_calendars(responses: &[DavResponse], base_url: &str) -> Vec<CalendarInfo> {
    let mut list: Vec<(i64, CalendarInfo)> = responses
        .iter()
        .filter(|r| r.prop("resourcetype").is_some_and(|t| t.has("calendar")))
        .filter(|r| r.prop("supported-calendar-component-set").is_none_or(|s| s.comps.is_empty() || s.comps.iter().any(|c| c == "VEVENT")))
        .filter_map(|r| {
            let id = crate::dav::resolve(base_url, &r.href).ok()?;
            let name = r
                .text("displayname")
                .map(str::to_string)
                .unwrap_or_else(|| id.trim_end_matches('/').rsplit('/').next().unwrap_or("Agenda").to_string());
            let color = r.text("calendar-color").filter(|c| c.starts_with('#') && c.len() >= 7).map(|c| c[..7].to_string());
            let can_edit = r
                .prop("current-user-privilege-set")
                .is_none_or(|p| p.has("write") || p.has("write-content") || p.has("all"));
            let order = r.text("calendar-order").and_then(|o| o.parse().ok()).unwrap_or(i64::MAX);
            Some((order, CalendarInfo { id, name, color, primary: false, can_edit, selected: true }))
        })
        .collect();
    list.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.name.cmp(&b.1.name)));
    let mut out: Vec<CalendarInfo> = list.into_iter().map(|(_, c)| c).collect();
    if let Some(first) = out.iter_mut().find(|c| c.can_edit) {
        first.primary = true;
    }
    out
}

// ---------- horários ----------

/// Fuso de um horário do .ics.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Zone {
    Utc,
    Named(chrono_tz::Tz),
    Fixed(FixedOffset),
    /// sem fuso: hora do computador
    Floating,
}

/// Um início ou fim: dia inteiro, ou um instante e o fuso para mostrar.
#[derive(Debug, Clone, Copy, PartialEq)]
enum When {
    Date(NaiveDate),
    At(DateTime<Utc>, Zone),
}

impl When {
    fn instant(&self) -> DateTime<Utc> {
        match self {
            When::Date(d) => d.and_hms_opt(0, 0, 0).expect("meia-noite").and_utc(),
            When::At(t, _) => *t,
        }
    }

    fn plus(&self, d: Duration) -> When {
        match self {
            When::Date(day) => When::Date(*day + Duration::days(d.num_days())),
            When::At(t, z) => When::At(*t + d, *z),
        }
    }

    /// Chave da ocorrência (vai no id do evento).
    fn key(&self) -> String {
        match self {
            When::Date(d) => d.format("%Y%m%d").to_string(),
            When::At(t, _) => utc_compact(t),
        }
    }

    fn to_event_time(self) -> EventTime {
        match self {
            When::Date(d) => EventTime { date_time: None, date: Some(d.format("%Y-%m-%d").to_string()) },
            When::At(t, z) => {
                let s = match z {
                    Zone::Utc => t.to_rfc3339_opts(SecondsFormat::Secs, true),
                    Zone::Named(tz) => t.with_timezone(&tz).to_rfc3339_opts(SecondsFormat::Secs, true),
                    Zone::Fixed(o) => t.with_timezone(&o).to_rfc3339_opts(SecondsFormat::Secs, true),
                    Zone::Floating => t.with_timezone(&chrono::Local).to_rfc3339_opts(SecondsFormat::Secs, true),
                };
                EventTime { date_time: Some(s), date: None }
            }
        }
    }
}

/// "2026-11-18T12:30:00-03:00" → instante em UTC.
pub fn parse_rfc3339(s: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(s.trim()).map(|d| d.with_timezone(&Utc)).map_err(|_| format!("data inválida: {s}"))
}

/// Instante no formato do CalDAV: `20261101T030000Z`.
pub fn utc_compact(t: &DateTime<Utc>) -> String {
    t.format("%Y%m%dT%H%M%SZ").to_string()
}

/// Nomes de fuso do Windows (convites do Outlook) mais comuns.
const WINDOWS_ZONES: &[(&str, &str)] = &[
    ("E. South America Standard Time", "America/Sao_Paulo"),
    ("SA Eastern Standard Time", "America/Fortaleza"),
    ("Central Brazilian Standard Time", "America/Cuiaba"),
    ("SA Western Standard Time", "America/Manaus"),
    ("Tocantins Standard Time", "America/Araguaina"),
    ("Bahia Standard Time", "America/Bahia"),
    ("Argentina Standard Time", "America/Argentina/Buenos_Aires"),
    ("SA Pacific Standard Time", "America/Bogota"),
    ("Pacific SA Standard Time", "America/Santiago"),
    ("Eastern Standard Time", "America/New_York"),
    ("Central Standard Time", "America/Chicago"),
    ("Mountain Standard Time", "America/Denver"),
    ("Pacific Standard Time", "America/Los_Angeles"),
    ("GMT Standard Time", "Europe/London"),
    ("GMT Standard Time", "Europe/Lisbon"),
    ("W. Europe Standard Time", "Europe/Berlin"),
    ("Romance Standard Time", "Europe/Paris"),
    ("Central Europe Standard Time", "Europe/Budapest"),
    ("UTC", "UTC"),
    ("Coordinated Universal Time", "UTC"),
];

/// "-0300" → deslocamento fixo.
fn parse_offset(s: &str) -> Option<FixedOffset> {
    let s = s.trim();
    let (sign, rest) = match s.as_bytes().first()? {
        b'+' => (1, &s[1..]),
        b'-' => (-1, &s[1..]),
        _ => return None,
    };
    let h: i32 = rest.get(0..2)?.parse().ok()?;
    let m: i32 = rest.get(2..4).unwrap_or("00").parse().ok()?;
    FixedOffset::east_opt(sign * (h * 3600 + m * 60))
}

/// Acha o fuso pelo TZID: nome IANA (com ou sem prefixo tipo `/mozilla.org/…/`), nome do Windows,
/// ou o deslocamento do VTIMEZONE que veio junto no arquivo.
fn resolve_zone(tzid: &str, cal: &Component) -> Zone {
    let t = tzid.trim().trim_matches('"');
    if t.eq_ignore_ascii_case("UTC") || t.eq_ignore_ascii_case("GMT") || t.eq_ignore_ascii_case("Z") {
        return Zone::Utc;
    }
    let parts: Vec<&str> = t.split('/').filter(|p| !p.is_empty()).collect();
    for i in 0..parts.len() {
        if let Ok(tz) = parts[i..].join("/").parse::<chrono_tz::Tz>() {
            return Zone::Named(tz);
        }
    }
    if let Some((_, iana)) = WINDOWS_ZONES.iter().find(|(w, _)| w.eq_ignore_ascii_case(t))
        && let Ok(tz) = iana.parse::<chrono_tz::Tz>()
    {
        return Zone::Named(tz);
    }
    let vtz = cal.children_named("VTIMEZONE").find(|z| z.text("TZID").is_some_and(|id| id.trim() == t));
    if let Some(vtz) = vtz {
        let part = vtz.children_named("STANDARD").next().or_else(|| vtz.children_named("DAYLIGHT").next());
        if let Some(o) = part.and_then(|p| p.text("TZOFFSETTO")).and_then(|o| parse_offset(&o)) {
            return Zone::Fixed(o);
        }
    }
    Zone::Floating
}

/// Hora local de um fuso → instante. No "buraco" do horário de verão, anda uma hora.
fn local_to_utc(naive: NaiveDateTime, zone: Zone) -> Option<DateTime<Utc>> {
    fn pick<Tz: TimeZone>(tz: &Tz, naive: NaiveDateTime) -> Option<DateTime<Utc>> {
        tz.from_local_datetime(&naive)
            .earliest()
            .or_else(|| tz.from_local_datetime(&(naive + Duration::hours(1))).earliest())
            .map(|d| d.with_timezone(&Utc))
    }
    match zone {
        Zone::Utc => Some(naive.and_utc()),
        Zone::Named(tz) => pick(&tz, naive),
        Zone::Fixed(o) => pick(&o, naive),
        Zone::Floating => pick(&chrono::Local, naive),
    }
}

/// Lê um valor de data ou data-hora (`20261120`, `20261120T100000`, `20261120T100000Z`).
fn parse_value(value: &str, params_date: bool, tzid: Option<&str>, cal: &Component) -> Option<When> {
    let v = value.trim();
    if params_date || v.len() == 8 {
        return NaiveDate::parse_from_str(v, "%Y%m%d").ok().map(When::Date);
    }
    if let Some(utc) = v.strip_suffix(['Z', 'z']) {
        let naive = NaiveDateTime::parse_from_str(utc, "%Y%m%dT%H%M%S").ok()?;
        return Some(When::At(naive.and_utc(), Zone::Utc));
    }
    let naive = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
    let zone = tzid.map(|t| resolve_zone(t, cal)).unwrap_or(Zone::Floating);
    Some(When::At(local_to_utc(naive, zone)?, zone))
}

fn is_date_param(p: &Property) -> bool {
    p.param("VALUE").is_some_and(|v| v.eq_ignore_ascii_case("DATE"))
}

fn read_when(p: &Property, cal: &Component) -> Option<When> {
    parse_value(&p.value, is_date_param(p), p.param("TZID"), cal)
}

/// Lista de datas (EXDATE/RDATE podem ter várias separadas por vírgula).
fn read_when_list(p: &Property, cal: &Component) -> Vec<When> {
    p.value.split(',').filter_map(|v| parse_value(v, is_date_param(p), p.param("TZID"), cal)).collect()
}

/// Duração ISO 8601 do iCalendar: `PT45M`, `P1D`, `-PT15M`, `P1W`, `P1DT2H30M`.
fn parse_duration(s: &str) -> Option<Duration> {
    let s = s.trim();
    let (neg, s) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s.strip_prefix('+').unwrap_or(s)),
    };
    let s = s.strip_prefix('P')?;
    let (mut total, mut num, mut in_time) = (0i64, String::new(), false);
    for ch in s.chars() {
        match ch {
            'T' => in_time = true,
            '0'..='9' => num.push(ch),
            unit => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += match (unit, in_time) {
                    ('W', _) => n * 7 * 86400,
                    ('D', _) => n * 86400,
                    ('H', true) => n * 3600,
                    ('M', true) => n * 60,
                    ('S', true) => n,
                    _ => return None,
                };
            }
        }
    }
    Some(Duration::seconds(if neg { -total } else { total }))
}

/// Início, fim e duração de um VEVENT.
fn event_span(ev: &Component, cal: &Component) -> Option<(When, When)> {
    let start = read_when(ev.prop("DTSTART")?, cal)?;
    let end = ev
        .prop("DTEND")
        .and_then(|p| read_when(p, cal))
        .or_else(|| ev.prop("DURATION").and_then(|d| parse_duration(&d.value)).map(|d| start.plus(d)))
        .unwrap_or(match start {
            When::Date(_) => start.plus(Duration::days(1)),
            When::At(..) => start,
        });
    Some((start, end))
}

// ---------- repetições ----------

fn rrule_tz(start: &When) -> rrule::Tz {
    match start {
        When::Date(_) | When::At(_, Zone::Utc | Zone::Fixed(_)) => rrule::Tz::UTC,
        When::At(_, Zone::Named(tz)) => rrule::Tz::Tz(*tz),
        When::At(_, Zone::Floating) => rrule::Tz::LOCAL,
    }
}

/// UNTIL da regra → instante em UTC (a crate pede UNTIL em UTC quando o início tem fuso).
fn until_instant(value: &str, start: &When, cal: &Component) -> Option<DateTime<Utc>> {
    let v = value.trim();
    if v.len() == 8 {
        let day = NaiveDate::parse_from_str(v, "%Y%m%d").ok()?;
        return match start {
            When::Date(_) => Some(day.and_hms_opt(0, 0, 0)?.and_utc()),
            When::At(_, zone) => local_to_utc(day.and_hms_opt(23, 59, 59)?, *zone),
        };
    }
    match parse_value(v, false, None, cal)? {
        When::At(t, Zone::Utc) => Some(t),
        // UNTIL sem Z: hora local do mesmo fuso do início
        When::At(_, _) => {
            let naive = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
            let zone = match start {
                When::At(_, z) => *z,
                When::Date(_) => Zone::Utc,
            };
            local_to_utc(naive, zone)
        }
        When::Date(_) => None,
    }
}

/// Monta a regra (RRULE) para a crate `rrule`, tirando o UNTIL para tratar o fuso aqui.
fn build_rule(value: &str, start: &When, dt_start: DateTime<rrule::Tz>, cal: &Component) -> Option<rrule::RRule> {
    let mut until = None;
    let rest: Vec<&str> = value
        .split(';')
        .filter(|part| match part.split_once('=') {
            Some((k, v)) if k.trim().eq_ignore_ascii_case("UNTIL") => {
                until = until_instant(v, start, cal);
                false
            }
            _ => !part.trim().is_empty(),
        })
        .collect();
    let mut rule: rrule::RRule<rrule::Unvalidated> = rest.join(";").parse().ok()?;
    if let Some(u) = until {
        rule = rule.until(u.with_timezone(&rrule::Tz::UTC));
    }
    rule.validate(dt_start).ok()
}

/// Inícios das ocorrências de uma série que podem encostar em [from, to].
fn occurrences(master: &Component, start: When, cal: &Component, from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<When> {
    let tz = rrule_tz(&start);
    let dt_start = start.instant().with_timezone(&tz);
    let rules: Vec<rrule::RRule> = master.props_named("RRULE").filter_map(|p| build_rule(&p.value, &start, dt_start, cal)).collect();
    let excluded: HashSet<DateTime<Utc>> = master.props_named("EXDATE").flat_map(|p| read_when_list(p, cal)).map(|w| w.instant()).collect();
    let mut found: BTreeMap<DateTime<Utc>, ()> = BTreeMap::new();
    // o próprio início sempre conta como a primeira ocorrência
    found.insert(start.instant(), ());
    for p in master.props_named("RDATE") {
        for w in read_when_list(p, cal) {
            found.insert(w.instant(), ());
        }
    }
    if !rules.is_empty() {
        let set = rules
            .into_iter()
            .fold(rrule::RRuleSet::new(dt_start), rrule::RRuleSet::rrule)
            .after(from.with_timezone(&tz))
            .before(to.with_timezone(&tz));
        for d in set.all(2000).dates {
            found.insert(d.with_timezone(&Utc), ());
        }
    }
    found
        .into_keys()
        .filter(|t| !excluded.contains(t) && *t >= from && *t <= to)
        .map(|t| match start {
            When::Date(_) => When::Date(t.date_naive()),
            When::At(_, z) => When::At(t, z),
        })
        .collect()
}

fn is_recurring(ev: &Component) -> bool {
    ev.prop("RRULE").is_some() || ev.prop("RDATE").is_some()
}

fn is_cancelled(ev: &Component) -> bool {
    ev.text("STATUS").is_some_and(|s| s.trim().eq_ignore_ascii_case("CANCELLED"))
}

fn overlaps(start: &When, end: &When, min: DateTime<Utc>, max: DateTime<Utc>) -> bool {
    let (s, e) = (start.instant(), end.instant());
    if e <= s {
        return s >= min && s < max;
    }
    s < max && e > min
}

// ---------- pessoas ----------

const APPLE_DOMAINS: [&str; 3] = ["icloud.com", "me.com", "mac.com"];

fn bare_email(addr: &str) -> String {
    let a = addr.trim();
    let a = if a.len() >= 7 && a[..7].eq_ignore_ascii_case("mailto:") { &a[7..] } else { a };
    a.trim().to_lowercase()
}

/// O endereço é da própria conta? (no iCloud, nome@icloud.com, @me.com e @mac.com são a mesma pessoa)
pub fn is_me(addr: &str, me: &[String]) -> bool {
    let a = bare_email(addr);
    if a.is_empty() {
        return false;
    }
    me.iter().map(|m| bare_email(m)).any(|m| {
        if m == a {
            return true;
        }
        match (a.split_once('@'), m.split_once('@')) {
            (Some((al, ad)), Some((ml, md))) => al == ml && APPLE_DOMAINS.contains(&ad) && APPLE_DOMAINS.contains(&md),
            _ => false,
        }
    })
}

/// E-mail de um ATTENDEE/ORGANIZER: o parâmetro EMAIL (o iCloud às vezes usa `urn:uuid:` no valor) ou o `mailto:`.
fn person_email(p: &Property) -> String {
    match p.param("EMAIL") {
        Some(e) if e.contains('@') => e.trim().to_string(),
        _ => {
            let v = p.value.trim();
            let v = if v.len() >= 7 && v[..7].eq_ignore_ascii_case("mailto:") { &v[7..] } else { v };
            v.trim().to_string()
        }
    }
}

fn partstat(p: &Property) -> String {
    match p.param("PARTSTAT").map(str::to_ascii_uppercase).as_deref() {
        Some("ACCEPTED") => "accepted",
        Some("DECLINED") => "declined",
        Some("TENTATIVE") => "tentative",
        _ => "needsAction",
    }
    .into()
}

/// Link de reunião (Meet, FaceTime, Teams, Zoom, Webex…) num texto.
fn find_meeting_link(text: &str) -> Option<String> {
    const HOSTS: [&str; 8] = ["meet.google.com", "facetime.apple.com", "teams.microsoft.com", "teams.live.com", "zoom.us", "webex.com", "whereby.com", "meet.jit.si"];
    text.split(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '(' | ')' | '[' | ']'))
        .map(|t| t.trim_end_matches(['.', ',', ';', ':']))
        .filter(|t| t.starts_with("https://"))
        .find(|t| {
            url::Url::parse(t).ok().and_then(|u| u.host_str().map(str::to_string)).is_some_and(|h| {
                HOSTS.iter().any(|known| h == *known || h.ends_with(&format!(".{known}")))
            })
        })
        .map(str::to_string)
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn build_event(ev: &Component, start: When, end: When, id: String, calendar_id: &str, recurring: bool, me: &[String]) -> CalEvent {
    let organizer = ev.prop("ORGANIZER");
    let organizer_email = organizer.map(person_email).filter(|e| !e.is_empty());
    let attendees: Vec<Attendee> = ev
        .props_named("ATTENDEE")
        .map(|p| {
            let email = person_email(p);
            Attendee {
                is_self: is_me(&email, me),
                organizer: organizer_email.as_deref().is_some_and(|o| o.eq_ignore_ascii_case(&email)),
                name: non_empty(p.param("CN").map(str::to_string)),
                status: partstat(p),
                email,
            }
        })
        .collect();
    let my_status = attendees.iter().find(|a| a.is_self).map(|a| a.status.clone());
    let location = non_empty(ev.text("LOCATION"));
    let description = non_empty(ev.text("DESCRIPTION"));
    let meet_url = ["X-GOOGLE-CONFERENCE", "URL", "LOCATION", "DESCRIPTION", "X-MICROSOFT-SKYPETEAMSMEETINGURL"]
        .iter()
        .filter_map(|n| ev.text(n))
        .find_map(|t| find_meeting_link(&t));
    CalEvent {
        id,
        ical_uid: ev.text("UID").map(|u| u.trim().to_string()).unwrap_or_default(),
        calendar_id: calendar_id.to_string(),
        title: non_empty(ev.text("SUMMARY")).unwrap_or_else(|| "(sem título)".into()),
        all_day: matches!(start, When::Date(_)),
        start: start.to_event_time(),
        end: end.to_event_time(),
        location,
        description,
        meet_url,
        html_link: None,
        organizer_self: organizer_email.as_deref().is_none_or(|o| is_me(o, me)),
        organizer_name: organizer.and_then(|o| non_empty(o.param("CN").map(str::to_string))),
        organizer_email,
        attendees,
        my_status,
        recurring,
    }
}

/// Junta a URL do .ics e a ocorrência no id do evento.
pub fn event_id(href: &str, occurrence: Option<&str>) -> String {
    match occurrence {
        Some(k) => format!("{href}#{k}"),
        None => href.to_string(),
    }
}

fn is_occurrence_key(k: &str) -> bool {
    let b = k.as_bytes();
    (b.len() == 8 && b.iter().all(u8::is_ascii_digit))
        || (b.len() == 16 && b[..8].iter().all(u8::is_ascii_digit) && b[8] == b'T' && b[9..15].iter().all(u8::is_ascii_digit) && b[15] == b'Z')
}

/// Separa o id em (URL do .ics, ocorrência).
pub fn split_event_id(id: &str) -> (&str, Option<&str>) {
    match id.rsplit_once('#') {
        Some((href, k)) if is_occurrence_key(k) => (href, Some(k)),
        _ => (id, None),
    }
}

fn calendar_of(ics: &str) -> Option<Component> {
    ical::parse(ics).into_iter().find(|c| c.name == "VCALENDAR")
}

/// Eventos de um .ics que encostam em [min, max), com as repetições abertas (como o `singleEvents` do Google).
pub fn expand_events(ics: &str, href: &str, calendar_id: &str, me: &[String], min: DateTime<Utc>, max: DateTime<Utc>) -> Vec<CalEvent> {
    let Some(cal) = calendar_of(ics) else { return Vec::new() };
    let vevents: Vec<&Component> = cal.children_named("VEVENT").collect();
    let mut out = Vec::new();
    // exceções (RECURRENCE-ID) por UID → chaves das ocorrências que elas substituem
    let mut overridden: HashSet<(String, String)> = HashSet::new();
    for ev in vevents.iter().filter(|e| e.prop("RECURRENCE-ID").is_some()) {
        let Some(rid) = ev.prop("RECURRENCE-ID").and_then(|p| read_when(p, &cal)) else { continue };
        let uid = ev.text("UID").unwrap_or_default();
        overridden.insert((uid, rid.key()));
        if is_cancelled(ev) {
            continue;
        }
        let Some((start, end)) = event_span(ev, &cal) else { continue };
        if overlaps(&start, &end, min, max) {
            out.push(build_event(ev, start, end, event_id(href, Some(&rid.key())), calendar_id, true, me));
        }
    }
    for ev in vevents.iter().filter(|e| e.prop("RECURRENCE-ID").is_none() && !is_cancelled(e)) {
        let Some((start, end)) = event_span(ev, &cal) else { continue };
        if !is_recurring(ev) {
            if overlaps(&start, &end, min, max) {
                out.push(build_event(ev, start, end, href.to_string(), calendar_id, false, me));
            }
            continue;
        }
        let uid = ev.text("UID").unwrap_or_default();
        let dur = end.instant() - start.instant();
        for occ in occurrences(ev, start, &cal, min - dur - Duration::seconds(1), max) {
            let key = occ.key();
            if overridden.contains(&(uid.clone(), key.clone())) {
                continue;
            }
            let occ_end = occ.plus(dur);
            if overlaps(&occ, &occ_end, min, max) {
                out.push(build_event(ev, occ, occ_end, event_id(href, Some(&key)), calendar_id, true, me));
            }
        }
    }
    out.sort_by_key(|e| e.start.date_time.clone().or_else(|| e.start.date.clone()).map(|s| sort_key(&s)));
    out
}

/// O evento com esse id dentro do .ics (para devolver à tela depois de criar ou editar).
pub fn find_event(ics: &str, href: &str, calendar_id: &str, me: &[String], occurrence: Option<&str>) -> Option<CalEvent> {
    let cal = calendar_of(ics)?;
    let wanted = event_id(href, occurrence);
    // procura em volta de onde o evento está: a exceção (se houver), a ocorrência e o início da série
    let mut spots: Vec<DateTime<Utc>> = Vec::new();
    if let Some(key) = occurrence {
        spots.extend(key_when(key).map(|w| w.instant()));
        if let Some(i) = override_index(&cal, key) {
            spots.extend(event_span(&cal.children[i], &cal).map(|(s, _)| s.instant()));
        }
    } else if let Some(i) = master_index(&cal) {
        spots.extend(event_span(&cal.children[i], &cal).map(|(s, _)| s.instant()));
    }
    spots.into_iter().find_map(|at| {
        expand_events(ics, href, calendar_id, me, at - Duration::days(2), at + Duration::days(2)).into_iter().find(|e| e.id == wanted)
    })
}

fn sort_key(s: &str) -> i64 {
    parse_rfc3339(s)
        .map(|d| d.timestamp())
        .or_else(|_| NaiveDate::parse_from_str(s, "%Y-%m-%d").map(|d| d.and_hms_opt(0, 0, 0).expect("meia-noite").and_utc().timestamp()))
        .unwrap_or(0)
}

// ---------- escrita ----------

/// Horário vindo da tela → `When`.
fn from_event_time(t: &EventTime) -> Result<When, String> {
    if let Some(dt) = t.date_time.as_deref().filter(|s| !s.trim().is_empty()) {
        return Ok(When::At(parse_rfc3339(dt)?, Zone::Utc));
    }
    if let Some(d) = t.date.as_deref().filter(|s| !s.trim().is_empty()) {
        return NaiveDate::parse_from_str(d.trim(), "%Y-%m-%d").map(When::Date).map_err(|_| format!("data inválida: {d}"));
    }
    Err("o evento precisa de horário de início e de fim".into())
}

/// Propriedade de horário. Com `like`, segue o formato dela (mesmo TZID, ou sem fuso);
/// sem, grava em UTC.
fn time_prop(name: &str, w: When, like: Option<&Property>, cal: &Component) -> Property {
    match w {
        When::Date(d) => Property::new(name, &d.format("%Y%m%d").to_string()).with_param("VALUE", "DATE"),
        When::At(t, _) => {
            if let Some(like) = like.filter(|l| !is_date_param(l) && l.value.trim().len() > 8) {
                if let Some(tzid) = like.param("TZID") {
                    let zone = resolve_zone(tzid, cal);
                    let local = match zone {
                        Zone::Named(tz) => Some(t.with_timezone(&tz).naive_local()),
                        Zone::Fixed(o) => Some(t.with_timezone(&o).naive_local()),
                        Zone::Floating => Some(t.with_timezone(&chrono::Local).naive_local()),
                        Zone::Utc => None,
                    };
                    if let Some(local) = local {
                        return Property::new(name, &local.format("%Y%m%dT%H%M%S").to_string()).with_param("TZID", tzid);
                    }
                } else if !like.value.trim().ends_with(['Z', 'z']) {
                    return Property::new(name, &t.with_timezone(&chrono::Local).naive_local().format("%Y%m%dT%H%M%S").to_string());
                }
            }
            Property::new(name, &utc_compact(&t))
        }
    }
}

fn alarm(minutes: u32) -> Component {
    let mut a = Component::new("VALARM");
    a.set(Property::new("ACTION", "DISPLAY"));
    a.set_text("DESCRIPTION", "Lembrete");
    a.set(Property::new("TRIGGER", &format!("-PT{minutes}M")));
    a
}

fn attendee_prop(email: &str) -> Property {
    Property::new("ATTENDEE", &format!("mailto:{email}"))
        .with_param("PARTSTAT", "NEEDS-ACTION")
        .with_param("ROLE", "REQ-PARTICIPANT")
        .with_param("RSVP", "TRUE")
}

fn organizer_prop(email: &str, name: Option<&str>) -> Property {
    let mut p = Property::new("ORGANIZER", &format!("mailto:{email}"));
    if let Some(n) = name.map(str::trim).filter(|n| !n.is_empty()) {
        p.set_param("CN", n);
    }
    p
}

fn clean_emails(list: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    list.iter()
        .map(|e| e.trim().to_string())
        .filter(|e| e.contains('@') && !e.chars().any(char::is_control) && seen.insert(e.to_lowercase()))
        .collect()
}

fn title_or_default(t: &str) -> String {
    let t = t.trim();
    if t.is_empty() { "(sem título)".into() } else { t.to_string() }
}

fn stamp(ev: &mut Component, now: DateTime<Utc>) {
    ev.set(Property::new("DTSTAMP", &utc_compact(&now)));
}

/// .ics de um evento novo. Lembretes viram VALARM; convidados viram ATTENDEE com a conta como
/// ORGANIZER (o iCloud manda os convites sozinho). `meet` não existe no iCloud e é ignorado.
pub fn new_event_ics(e: &NewEvent, uid: &str, organizer: Option<(&str, Option<&str>)>, now: DateTime<Utc>) -> Result<String, String> {
    let start = from_event_time(&e.start)?;
    let end = from_event_time(&e.end)?;
    let empty = Component::new("VCALENDAR");
    let mut ev = Component::new("VEVENT");
    ev.set(Property::new("UID", uid));
    stamp(&mut ev, now);
    ev.set(Property::new("CREATED", &utc_compact(&now)));
    ev.set(Property::new("SEQUENCE", "0"));
    ev.set_text("SUMMARY", &title_or_default(&e.title));
    ev.set(time_prop("DTSTART", start, None, &empty));
    ev.set(time_prop("DTEND", end, None, &empty));
    if let Some(l) = e.location.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        ev.set_text("LOCATION", l);
    }
    if let Some(d) = e.description.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        ev.set_text("DESCRIPTION", d);
    }
    let guests = clean_emails(&e.attendees);
    if !guests.is_empty() {
        let (email, name) = organizer.ok_or("não sei o e-mail da conta para mandar os convites")?;
        ev.set(organizer_prop(email, name));
        for g in &guests {
            ev.props.push(attendee_prop(g));
        }
    }
    for m in e.reminders.iter().flatten() {
        ev.children.push(alarm(*m));
    }
    let mut cal = Component::new("VCALENDAR");
    cal.set(Property::new("VERSION", "2.0"));
    cal.set(Property::new("PRODID", "-//Quill//Quill 0.1//PT-BR"));
    cal.set(Property::new("CALSCALE", "GREGORIAN"));
    cal.children.push(ev);
    Ok(cal.to_ics())
}

/// Instante da chave de ocorrência.
fn key_when(key: &str) -> Option<When> {
    if key.len() == 8 {
        return NaiveDate::parse_from_str(key, "%Y%m%d").ok().map(When::Date);
    }
    let naive = NaiveDateTime::parse_from_str(key.strip_suffix('Z')?, "%Y%m%dT%H%M%S").ok()?;
    Some(When::At(naive.and_utc(), Zone::Utc))
}

fn master_index(cal: &Component) -> Option<usize> {
    cal.children.iter().position(|c| c.name == "VEVENT" && c.prop("RECURRENCE-ID").is_none())
}

fn override_index(cal: &Component, key: &str) -> Option<usize> {
    cal.children.iter().position(|c| {
        c.name == "VEVENT" && c.prop("RECURRENCE-ID").and_then(|p| read_when(p, cal)).is_some_and(|w| w.key() == key)
    })
}

/// Índice do VEVENT a mudar: a série (sem ocorrência), a exceção que já existe, ou uma exceção nova
/// criada a partir da série para aquela ocorrência.
fn target_index(cal: &mut Component, occurrence: Option<&str>) -> Result<usize, String> {
    let Some(key) = occurrence else {
        return master_index(cal).or_else(|| cal.children.iter().position(|c| c.name == "VEVENT")).ok_or_else(|| "evento não encontrado".into());
    };
    if let Some(i) = override_index(cal, key) {
        return Ok(i);
    }
    let mi = master_index(cal).ok_or("evento não encontrado")?;
    let master = cal.children[mi].clone();
    let (start, end) = event_span(&master, cal).ok_or("evento sem horário")?;
    let when = key_when(key).ok_or("ocorrência inválida")?;
    let at = when.instant();
    let found = occurrences(&master, start, cal, at - Duration::seconds(1), at + Duration::seconds(1))
        .into_iter()
        .find(|w| w.key() == key)
        .ok_or("essa repetição do evento não existe mais")?;
    let dur = end.instant() - start.instant();
    let mut ov = master.clone();
    for n in ["RRULE", "RDATE", "EXDATE", "EXRULE", "DURATION"] {
        ov.remove(n);
    }
    ov.set(time_prop("RECURRENCE-ID", found, master.prop("DTSTART"), cal));
    ov.set(time_prop("DTSTART", found, master.prop("DTSTART"), cal));
    ov.set(time_prop("DTEND", found.plus(dur), master.prop("DTEND").or(master.prop("DTSTART")), cal));
    cal.children.push(ov);
    Ok(cal.children.len() - 1)
}

/// Aplica a edição (só os campos com valor) e devolve o .ics novo. Numa ocorrência de repetição,
/// muda só ela (cria uma exceção com RECURRENCE-ID).
pub fn apply_patch(ics: &str, occurrence: Option<&str>, p: &EventPatch, organizer: (&str, Option<&str>), now: DateTime<Utc>) -> Result<String, String> {
    let mut cal = calendar_of(ics).ok_or("evento ilegível")?;
    let i = target_index(&mut cal, occurrence)?;
    let snapshot = cal.clone();
    let ev = &mut cal.children[i];
    if let Some(t) = &p.title {
        ev.set_text("SUMMARY", &title_or_default(t));
    }
    if let Some(s) = &p.start {
        let w = from_event_time(s)?;
        let like = ev.prop("DTSTART").cloned();
        ev.set(time_prop("DTSTART", w, like.as_ref(), &snapshot));
    }
    if let Some(e) = &p.end {
        let w = from_event_time(e)?;
        let like = ev.prop("DTEND").or(ev.prop("DTSTART")).cloned();
        ev.remove("DURATION");
        ev.set(time_prop("DTEND", w, like.as_ref(), &snapshot));
    }
    for (field, name) in [(&p.location, "LOCATION"), (&p.description, "DESCRIPTION")] {
        if let Some(v) = field {
            match v.trim() {
                "" => ev.remove(name),
                v => ev.set_text(name, v),
            }
        }
    }
    if let Some(list) = &p.attendees {
        let wanted = clean_emails(list);
        let organizer_email = ev.prop("ORGANIZER").map(person_email);
        let mut kept: Vec<Property> = Vec::new();
        for a in ev.props_named("ATTENDEE") {
            let email = person_email(a);
            let is_org = organizer_email.as_deref().is_some_and(|o| o.eq_ignore_ascii_case(&email));
            if is_org || wanted.iter().any(|w| w.eq_ignore_ascii_case(&email)) {
                kept.push(a.clone());
            }
        }
        for w in &wanted {
            if !kept.iter().any(|k| person_email(k).eq_ignore_ascii_case(w)) {
                kept.push(attendee_prop(w));
            }
        }
        ev.remove("ATTENDEE");
        if wanted.is_empty() {
            ev.remove("ORGANIZER");
        } else {
            if ev.prop("ORGANIZER").is_none() {
                ev.set(organizer_prop(organizer.0, organizer.1));
            }
            ev.props.extend(kept);
        }
    }
    if let Some(mins) = &p.reminders {
        ev.children.retain(|c| c.name != "VALARM");
        ev.children.extend(mins.iter().map(|m| alarm(*m)));
    }
    let seq: i64 = ev.text("SEQUENCE").and_then(|s| s.trim().parse().ok()).unwrap_or(0);
    ev.set(Property::new("SEQUENCE", &(seq + 1).to_string()));
    ev.set(Property::new("LAST-MODIFIED", &utc_compact(&now)));
    stamp(ev, now);
    Ok(cal.to_ics())
}

/// Muda a minha resposta (PARTSTAT) ao convite. Sem ocorrência, vale para a série e as exceções;
/// com ocorrência, só para ela. O iCloud avisa o organizador.
pub fn apply_rsvp(ics: &str, occurrence: Option<&str>, me: &[String], status: &str, now: DateTime<Utc>) -> Result<String, String> {
    let value = match status {
        "accepted" => "ACCEPTED",
        "declined" => "DECLINED",
        "tentative" => "TENTATIVE",
        other => return Err(format!("resposta inválida: {other}")),
    };
    let mut cal = calendar_of(ics).ok_or("evento ilegível")?;
    let targets: Vec<usize> = match occurrence {
        Some(_) => vec![target_index(&mut cal, occurrence)?],
        None => cal.children.iter().enumerate().filter(|(_, c)| c.name == "VEVENT").map(|(i, _)| i).collect(),
    };
    let mut changed = false;
    for i in targets {
        let ev = &mut cal.children[i];
        let mut mine = false;
        for a in ev.props.iter_mut().filter(|p| p.name == "ATTENDEE") {
            if is_me(&person_email(a), me) {
                a.set_param("PARTSTAT", value);
                a.remove_param("SCHEDULE-STATUS");
                mine = true;
            }
        }
        if mine {
            stamp(ev, now);
            changed = true;
        }
    }
    if !changed {
        return Err("você não está entre os convidados deste evento".into());
    }
    Ok(cal.to_ics())
}

/// Apaga uma ocorrência de uma repetição: tira a exceção (se houver) e acrescenta um EXDATE na série.
/// Devolve `None` quando não sobra evento nenhum no arquivo (aí é para apagar o .ics inteiro).
pub fn remove_occurrence(ics: &str, key: &str) -> Result<Option<String>, String> {
    let mut cal = calendar_of(ics).ok_or("evento ilegível")?;
    let when = key_when(key).ok_or("ocorrência inválida")?;
    let mut touched = false;
    if let Some(i) = override_index(&cal, key) {
        cal.children.remove(i);
        touched = true;
    }
    if let Some(mi) = master_index(&cal) {
        let like = cal.children[mi].prop("DTSTART").cloned();
        let ex = time_prop("EXDATE", when, like.as_ref(), &cal);
        let master = &mut cal.children[mi];
        if is_recurring(master) {
            master.props.push(ex);
            touched = true;
        }
    }
    if !touched {
        return Err("essa repetição do evento não existe mais".into());
    }
    if !cal.children.iter().any(|c| c.name == "VEVENT") {
        return Ok(None);
    }
    Ok(Some(cal.to_ics()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::{EventPatch, EventTime, NewEvent};
    use crate::dav::parse_multistatus;
    use chrono::TimeZone;

    const CAL: &str = "https://p52-caldav.icloud.com/123/calendars/home/";
    const HREF: &str = "https://p52-caldav.icloud.com/123/calendars/home/E1.ics";

    fn me() -> Vec<String> {
        vec!["ana@icloud.com".into()]
    }

    fn utc(y: i32, m: u32, d: u32) -> chrono::DateTime<chrono::Utc> {
        chrono::Utc.with_ymd_and_hms(y, m, d, 0, 0, 0).unwrap()
    }

    fn expand(ics: &str) -> Vec<crate::calendar::CalEvent> {
        expand_events(ics, HREF, CAL, &me(), utc(2026, 11, 1), utc(2027, 1, 1))
    }

    fn wrap(body: &str) -> String {
        format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple Inc.//iCloud 2.0//EN\r\n{body}END:VCALENDAR\r\n")
    }

    // ---------- agendas ----------

    const CALENDARS_XML: &str = r##"<multistatus xmlns="DAV:">
 <response><href>/123/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/123/calendars/home/</href><propstat><prop>
   <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Casa</displayname>
   <calendar-color xmlns="http://apple.com/ns/ical/">#1BADF8FF</calendar-color><calendar-order xmlns="http://apple.com/ns/ical/">2</calendar-order>
   <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VEVENT"/></supported-calendar-component-set>
   <current-user-privilege-set><privilege><read/></privilege><privilege><write/></privilege></current-user-privilege-set>
 </prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/123/calendars/tasks/</href><propstat><prop>
   <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Lembretes</displayname>
   <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VTODO"/></supported-calendar-component-set>
 </prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/123/calendars/work/</href><propstat><prop>
   <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Trabalho</displayname>
   <calendar-order xmlns="http://apple.com/ns/ical/">1</calendar-order>
   <current-user-privilege-set><privilege><read/></privilege><privilege><write-content/></privilege></current-user-privilege-set>
 </prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/123/calendars/shared/</href><propstat><prop>
   <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Família</displayname>
   <calendar-order xmlns="http://apple.com/ns/ical/">3</calendar-order>
   <current-user-privilege-set><privilege><read/></privilege></current-user-privilege-set>
 </prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/123/calendars/inbox/</href><propstat><prop><resourcetype><collection/><schedule-inbox xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>"##;

    #[test]
    fn agendas_so_de_eventos_em_ordem_com_cor_e_permissao() {
        let list = parse_calendars(&parse_multistatus(CALENDARS_XML).unwrap(), "https://p52-caldav.icloud.com/123/calendars/");
        let names: Vec<_> = list.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["Trabalho", "Casa", "Família"]);
        assert_eq!(list[0].id, "https://p52-caldav.icloud.com/123/calendars/work/");
        assert!(list[0].primary, "a primeira em que dá para escrever é a principal");
        assert!(!list[1].primary && !list[2].primary);
        assert_eq!(list[1].color.as_deref(), Some("#1BADF8"));
        assert!(list[0].can_edit && list[1].can_edit && !list[2].can_edit);
        assert!(list.iter().all(|c| c.selected));
    }

    // ---------- leitura de eventos ----------

    #[test]
    fn evento_com_fuso_convite_e_facetime() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:abc@google.com\r\nDTSTAMP:20261110T120000Z\r\nDTSTART;TZID=America/Sao_Paulo:20261119T100000\r\n\
DTEND;TZID=America/Sao_Paulo:20261119T113000\r\nSUMMARY:Planejamento Q1\r\nLOCATION:Sala Paulista\r\n\
URL:https://facetime.apple.com/join#v=1&p=abc\r\nDESCRIPTION:Pauta\\: metas\r\n\
ORGANIZER;CN=Rafael Lima:mailto:rafael@inchurch.com.br\r\n\
ATTENDEE;CN=Rafael Lima;PARTSTAT=ACCEPTED;ROLE=CHAIR:mailto:rafael@inchurch.com.br\r\n\
ATTENDEE;CN=Ana;EMAIL=ana@icloud.com;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:urn:uuid:1111-2222\r\nEND:VEVENT\r\n",
        );
        let list = expand(&ics);
        assert_eq!(list.len(), 1);
        let e = &list[0];
        assert_eq!(e.id, HREF);
        assert_eq!(e.ical_uid, "abc@google.com");
        assert_eq!(e.calendar_id, CAL);
        assert_eq!(e.title, "Planejamento Q1");
        assert_eq!(e.start.date_time.as_deref(), Some("2026-11-19T10:00:00-03:00"));
        assert_eq!(e.end.date_time.as_deref(), Some("2026-11-19T11:30:00-03:00"));
        assert!(!e.all_day && !e.recurring);
        assert_eq!(e.location.as_deref(), Some("Sala Paulista"));
        assert_eq!(e.description.as_deref(), Some("Pauta: metas"));
        assert_eq!(e.meet_url.as_deref(), Some("https://facetime.apple.com/join#v=1&p=abc"));
        assert_eq!(e.organizer_email.as_deref(), Some("rafael@inchurch.com.br"));
        assert_eq!(e.organizer_name.as_deref(), Some("Rafael Lima"));
        assert!(!e.organizer_self);
        assert_eq!(e.my_status.as_deref(), Some("needsAction"));
        assert_eq!(e.attendees.len(), 2);
        assert!(e.attendees[0].organizer && e.attendees[0].status == "accepted");
        assert!(e.attendees[1].is_self);
        assert_eq!(e.attendees[1].email, "ana@icloud.com");
    }

    #[test]
    fn link_de_reuniao_tambem_vem_da_descricao_ou_do_local() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:m1\r\nDTSTART:20261118T150000Z\r\nDTEND:20261118T160000Z\r\nSUMMARY:Call\r\n\
DESCRIPTION:Entre pelo link: https://teams.microsoft.com/l/meetup-join/19%3ameeting_x (Teams)\\nOu ligue\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:m2\r\nDTSTART:20261118T170000Z\r\nDTEND:20261118T180000Z\r\nLOCATION:https://meet.google.com/xpa-mnqr-tuv\r\nEND:VEVENT\r\n",
        );
        let list = expand(&ics);
        assert_eq!(list[0].meet_url.as_deref(), Some("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x"));
        assert_eq!(list[1].meet_url.as_deref(), Some("https://meet.google.com/xpa-mnqr-tuv"));
        assert_eq!(list[1].title, "(sem título)");
    }

    #[test]
    fn evento_de_dia_inteiro_e_meu_quando_nao_tem_organizador() {
        let ics = wrap("BEGIN:VEVENT\r\nUID:d1\r\nDTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121\r\nSUMMARY:Feriado\r\nEND:VEVENT\r\n");
        let e = &expand(&ics)[0];
        assert!(e.all_day);
        assert_eq!(e.start, EventTime { date_time: None, date: Some("2026-11-20".into()) });
        assert_eq!(e.end.date.as_deref(), Some("2026-11-21"));
        assert!(e.organizer_self);
        assert_eq!(e.my_status, None);
    }

    #[test]
    fn utc_com_duracao_e_dia_inteiro_sem_fim() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:u1\r\nDTSTART:20261118T150000Z\r\nDURATION:PT45M\r\nSUMMARY:Curta\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:u2\r\nDTSTART;VALUE=DATE:20261125\r\nSUMMARY:Sem fim\r\nEND:VEVENT\r\n",
        );
        let list = expand(&ics);
        assert_eq!(list[0].start.date_time.as_deref(), Some("2026-11-18T15:00:00Z"));
        assert_eq!(list[0].end.date_time.as_deref(), Some("2026-11-18T15:45:00Z"));
        assert_eq!(list[1].end.date.as_deref(), Some("2026-11-26"));
    }

    #[test]
    fn fuso_com_nome_do_windows_e_cancelados_ficam_de_fora() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:w1\r\nDTSTART;TZID=E. South America Standard Time:20261119T100000\r\n\
DTEND;TZID=E. South America Standard Time:20261119T110000\r\nSUMMARY:Do Outlook\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:c1\r\nSTATUS:CANCELLED\r\nDTSTART:20261119T100000Z\r\nDTEND:20261119T110000Z\r\nEND:VEVENT\r\n",
        );
        let list = expand(&ics);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].start.date_time.as_deref(), Some("2026-11-19T10:00:00-03:00"));
    }

    #[test]
    fn fora_do_intervalo_some_e_o_que_atravessa_o_inicio_aparece() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:o1\r\nDTSTART:20261015T100000Z\r\nDTEND:20261015T110000Z\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:o2\r\nDTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261103\r\nSUMMARY:Viagem\r\nEND:VEVENT\r\n",
        );
        let list = expand(&ics);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Viagem");
    }

    /// Semanal em Nova York, atravessando o fim do horário de verão (1º/11/2026),
    /// com uma data pulada (EXDATE) e uma ocorrência mudada (RECURRENCE-ID).
    fn weekly() -> String {
        wrap(
            "BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\nEND:VTIMEZONE\r\n\
BEGIN:VEVENT\r\nUID:rep-1\r\nDTSTART;TZID=America/New_York:20261026T090000\r\nDTEND;TZID=America/New_York:20261026T100000\r\n\
RRULE:FREQ=WEEKLY;COUNT=6\r\nEXDATE;TZID=America/New_York:20261109T090000\r\nSUMMARY:Daily\r\nSEQUENCE:0\r\nX-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:rep-1\r\nRECURRENCE-ID;TZID=America/New_York:20261116T090000\r\nDTSTART;TZID=America/New_York:20261116T140000\r\n\
DTEND;TZID=America/New_York:20261116T150000\r\nSUMMARY:Movida\r\nEND:VEVENT\r\n",
        )
    }

    #[test]
    fn repeticao_semanal_abre_cada_ocorrencia_com_excecoes() {
        let list = expand(&weekly());
        let got: Vec<_> = list.iter().map(|e| (e.id.as_str(), e.title.as_str(), e.start.date_time.clone().unwrap())).collect();
        assert_eq!(
            got,
            [
                (&*format!("{HREF}#20261102T140000Z"), "Daily", "2026-11-02T09:00:00-05:00".to_string()),
                (&*format!("{HREF}#20261116T140000Z"), "Movida", "2026-11-16T14:00:00-05:00".to_string()),
                (&*format!("{HREF}#20261123T140000Z"), "Daily", "2026-11-23T09:00:00-05:00".to_string()),
                (&*format!("{HREF}#20261130T140000Z"), "Daily", "2026-11-30T09:00:00-05:00".to_string()),
            ]
        );
        assert!(list.iter().all(|e| e.recurring && e.ical_uid == "rep-1"));
        assert_eq!(list[0].end.date_time.as_deref(), Some("2026-11-02T10:00:00-05:00"));
    }

    #[test]
    fn repeticao_de_dia_inteiro_com_until_em_data() {
        let ics = wrap("BEGIN:VEVENT\r\nUID:r2\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102\r\nRRULE:FREQ=DAILY;UNTIL=20261103\r\nSUMMARY:Retiro\r\nEND:VEVENT\r\n");
        let list = expand(&ics);
        let dates: Vec<_> = list.iter().map(|e| e.start.date.clone().unwrap()).collect();
        assert_eq!(dates, ["2026-11-01", "2026-11-02", "2026-11-03"]);
        assert_eq!(list[2].id, format!("{HREF}#20261103"));
        assert_eq!(list[2].end.date.as_deref(), Some("2026-11-04"));
    }

    #[test]
    fn repeticao_com_fuso_e_until_em_utc() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:r3\r\nDTSTART;TZID=America/Sao_Paulo:20261110T080000\r\nDTEND;TZID=America/Sao_Paulo:20261110T083000\r\n\
RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261114T235959Z\r\nEND:VEVENT\r\n",
        );
        let starts: Vec<_> = expand(&ics).iter().map(|e| e.start.date_time.clone().unwrap()).collect();
        assert_eq!(starts, ["2026-11-10T08:00:00-03:00", "2026-11-12T08:00:00-03:00", "2026-11-14T08:00:00-03:00"]);
    }

    #[test]
    fn so_a_excecao_sem_a_serie_tambem_aparece() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:only\r\nRECURRENCE-ID:20261120T130000Z\r\nDTSTART:20261120T130000Z\r\nDTEND:20261120T140000Z\r\nSUMMARY:Convite de uma vez\r\nEND:VEVENT\r\n",
        );
        let list = expand(&ics);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, format!("{HREF}#20261120T130000Z"));
        assert!(list[0].recurring);
    }

    #[test]
    fn reconhece_meus_enderecos_do_icloud() {
        let me = vec!["ana@icloud.com".to_string()];
        assert!(is_me("mailto:ANA@icloud.com", &me));
        assert!(is_me("ana@me.com", &me));
        assert!(is_me("ana@mac.com", &me));
        assert!(!is_me("ana@gmail.com", &me));
        assert!(!is_me("bia@icloud.com", &me));
    }

    #[test]
    fn id_do_evento_separa_ocorrencia() {
        assert_eq!(split_event_id(HREF), (HREF, None));
        assert_eq!(split_event_id(&format!("{HREF}#20261103")), (HREF, Some("20261103")));
    }

    // ---------- escrita ----------

    fn timed(start: &str, end: &str) -> (EventTime, EventTime) {
        (EventTime { date_time: Some(start.into()), date: None }, EventTime { date_time: Some(end.into()), date: None })
    }

    fn now() -> chrono::DateTime<chrono::Utc> {
        chrono::Utc.with_ymd_and_hms(2026, 11, 17, 12, 0, 0).unwrap()
    }

    #[test]
    fn evento_novo_com_convidados_e_lembretes() {
        let (start, end) = timed("2026-11-18T12:30:00-03:00", "2026-11-18T13:30:00-03:00");
        let e = NewEvent {
            title: "  Almoço, com time ".into(),
            start,
            end,
            location: Some(" Rua A; 10 ".into()),
            description: Some("".into()),
            attendees: vec!["bia@y.com".into(), " ".into()],
            reminders: Some(vec![10, 60]),
            meet: true,
        };
        let ics = new_event_ics(&e, "UID-1", Some(("ana@icloud.com", Some("Ana"))), now()).unwrap();
        assert!(ics.lines().all(|l| l.len() <= 76));
        let ics = ics.replace("\r\n ", "");
        assert!(ics.contains("UID:UID-1\r\n"));
        assert!(ics.contains("DTSTAMP:20261117T120000Z\r\n"));
        assert!(ics.contains("DTSTART:20261118T153000Z\r\n"));
        assert!(ics.contains("DTEND:20261118T163000Z\r\n"));
        assert!(ics.contains("SUMMARY:Almoço\\, com time\r\n"));
        assert!(ics.contains("LOCATION:Rua A\\; 10\r\n"));
        assert_eq!(ics.matches("DESCRIPTION:").count(), 2, "só a dos lembretes");
        assert!(ics.contains("ORGANIZER;CN=Ana:mailto:ana@icloud.com\r\n"));
        assert!(ics.contains("ATTENDEE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:bia@y.com\r\n"));
        assert_eq!(ics.matches("BEGIN:VALARM").count(), 2);
        assert!(ics.contains("TRIGGER:-PT10M\r\n") && ics.contains("TRIGGER:-PT60M\r\n"));
        // lê de volta igual
        let back = expand(&ics);
        assert_eq!(back[0].start.date_time.as_deref(), Some("2026-11-18T15:30:00Z"));
        assert_eq!(back[0].title, "Almoço, com time");
        assert!(back[0].organizer_self);
        assert_eq!(back[0].attendees.len(), 1);
    }

    #[test]
    fn evento_novo_de_dia_inteiro_sem_convidados_nao_tem_organizador() {
        let e = NewEvent {
            title: "".into(),
            start: EventTime { date_time: None, date: Some("2026-11-20".into()) },
            end: EventTime { date_time: None, date: Some("2026-11-21".into()) },
            location: None,
            description: None,
            attendees: vec![],
            reminders: None,
            meet: false,
        };
        let ics = new_event_ics(&e, "UID-2", Some(("ana@icloud.com", None)), now()).unwrap();
        assert!(ics.contains("DTSTART;VALUE=DATE:20261120\r\n"));
        assert!(ics.contains("DTEND;VALUE=DATE:20261121\r\n"));
        assert!(ics.contains("SUMMARY:(sem título)\r\n"));
        assert!(!ics.contains("ORGANIZER") && !ics.contains("VALARM"));
        assert!(new_event_ics(&NewEvent { start: EventTime::default(), ..e }, "x", None, now()).is_err());
    }

    const SIMPLE: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:s1\r\nDTSTART:20261118T150000Z\r\nDTEND:20261118T160000Z\r\n\
SUMMARY:Antes\r\nLOCATION:Sala\r\nSEQUENCE:2\r\nX-APPLE-STRUCTURED-LOCATION;VALUE=URI:geo:1,2\r\n\
ATTENDEE;PARTSTAT=ACCEPTED:mailto:bia@y.com\r\nORGANIZER:mailto:ana@icloud.com\r\nBEGIN:VALARM\r\nTRIGGER:-PT5M\r\nACTION:DISPLAY\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[test]
    fn edicao_muda_so_o_pedido_e_guarda_o_resto() {
        let (start, end) = timed("2026-11-18T14:00:00-03:00", "2026-11-18T15:00:00-03:00");
        let p = EventPatch {
            title: Some("Depois".into()),
            start: Some(start),
            end: Some(end),
            location: Some("".into()),
            description: Some("Nova pauta".into()),
            attendees: Some(vec!["bia@y.com".into(), "caio@z.com".into()]),
            reminders: Some(vec![30]),
        };
        let out = apply_patch(SIMPLE, None, &p, ("ana@icloud.com", None), now()).unwrap().replace("\r\n ", "");
        assert!(out.contains("SUMMARY:Depois\r\n"));
        assert!(out.contains("DTSTART:20261118T170000Z\r\n"));
        assert!(!out.contains("LOCATION:"));
        assert!(out.contains("DESCRIPTION:Nova pauta\r\n"));
        assert!(out.contains("SEQUENCE:3\r\n"));
        assert!(out.contains("X-APPLE-STRUCTURED-LOCATION;VALUE=URI:geo:1,2\r\n"));
        // quem já tinha respondido continua com a resposta; o novo recebe convite
        assert!(out.contains("ATTENDEE;PARTSTAT=ACCEPTED:mailto:bia@y.com\r\n"));
        assert!(out.contains("RSVP=TRUE:mailto:caio@z.com\r\n"));
        assert!(out.contains("TRIGGER:-PT30M\r\n") && !out.contains("TRIGGER:-PT5M"));
        // patch vazio não muda os horários nem os convidados
        let same = apply_patch(SIMPLE, None, &EventPatch::default(), ("ana@icloud.com", None), now()).unwrap();
        assert!(same.contains("DTSTART:20261118T150000Z\r\n") && same.contains("mailto:bia@y.com"));
        assert!(same.contains("TRIGGER:-PT5M"));
    }

    #[test]
    fn edicao_da_serie_mantem_o_fuso_da_serie() {
        let (start, end) = timed("2026-11-02T10:00:00-05:00", "2026-11-02T11:00:00-05:00");
        let p = EventPatch { start: Some(start), end: Some(end), ..EventPatch::default() };
        let out = apply_patch(&weekly(), None, &p, ("ana@icloud.com", None), now()).unwrap();
        assert!(out.contains("DTSTART;TZID=America/New_York:20261102T100000\r\n"), "{out}");
        assert!(out.contains("RRULE:FREQ=WEEKLY;COUNT=6\r\n"));
    }

    #[test]
    fn edicao_de_uma_ocorrencia_cria_excecao() {
        let p = EventPatch { title: Some("Só nesse dia".into()), ..EventPatch::default() };
        let out = apply_patch(&weekly(), Some("20261123T140000Z"), &p, ("ana@icloud.com", None), now()).unwrap();
        let list = expand(&out);
        let titles: Vec<_> = list.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(titles, ["Daily", "Movida", "Só nesse dia", "Daily"]);
        assert_eq!(list[2].id, format!("{HREF}#20261123T140000Z"));
        assert!(out.contains("RECURRENCE-ID;TZID=America/New_York:20261123T090000\r\n"));
        assert_eq!(out.matches("RRULE").count(), 1, "a exceção não leva a regra");
        // editar uma exceção que já existe muda ela, sem criar outra
        let again = apply_patch(&out, Some("20261116T140000Z"), &p, ("ana@icloud.com", None), now()).unwrap();
        assert_eq!(again.matches("BEGIN:VEVENT").count(), 3);
        assert!(apply_patch(&weekly(), Some("20261124T140000Z"), &p, ("ana@icloud.com", None), now()).is_err(), "não existe essa ocorrência");
    }

    #[test]
    fn resposta_ao_convite_muda_so_a_minha() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:i1\r\nDTSTART:20261119T130000Z\r\nDTEND:20261119T140000Z\r\nORGANIZER:mailto:rafael@x.com\r\nSEQUENCE:4\r\n\
ATTENDEE;PARTSTAT=ACCEPTED:mailto:rafael@x.com\r\nATTENDEE;CN=Ana;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ana@me.com\r\nEND:VEVENT\r\n",
        );
        let out = apply_rsvp(&ics, None, &me(), "tentative", now()).unwrap();
        assert!(out.contains("ATTENDEE;CN=Ana;PARTSTAT=TENTATIVE;RSVP=TRUE:mailto:ana@me.com\r\n"));
        assert!(out.contains("ATTENDEE;PARTSTAT=ACCEPTED:mailto:rafael@x.com\r\n"));
        assert!(out.contains("SEQUENCE:4\r\n"), "convidado não muda a versão do evento");
        assert_eq!(expand(&out)[0].my_status.as_deref(), Some("tentative"));
        assert!(apply_rsvp(&ics, None, &me(), "talvez", now()).is_err());
        assert!(apply_rsvp(&ics, None, &["outra@x.com".to_string()], "accepted", now()).is_err());
    }

    #[test]
    fn resposta_a_uma_ocorrencia_cria_excecao_so_dela() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:i2\r\nDTSTART:20261102T130000Z\r\nDTEND:20261102T140000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nORGANIZER:mailto:rafael@x.com\r\n\
ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:ana@icloud.com\r\nEND:VEVENT\r\n",
        );
        let out = apply_rsvp(&ics, Some("20261109T130000Z"), &me(), "declined", now()).unwrap();
        let st: Vec<_> = expand(&out).iter().map(|e| e.my_status.clone().unwrap()).collect();
        assert_eq!(st, ["needsAction", "declined", "needsAction"]);
    }

    #[test]
    fn apagar_uma_ocorrencia_acrescenta_exdate_e_tira_a_excecao() {
        let out = remove_occurrence(&weekly(), "20261116T140000Z").unwrap().unwrap();
        assert!(out.contains("EXDATE;TZID=America/New_York:20261116T090000\r\n"));
        assert!(!out.contains("Movida"));
        let titles: Vec<_> = expand(&out).iter().map(|e| e.start.date_time.clone().unwrap()).collect();
        assert_eq!(titles, ["2026-11-02T09:00:00-05:00", "2026-11-23T09:00:00-05:00", "2026-11-30T09:00:00-05:00"]);

        let all_day = wrap("BEGIN:VEVENT\r\nUID:r2\r\nDTSTART;VALUE=DATE:20261101\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT\r\n");
        let out = remove_occurrence(&all_day, "20261102").unwrap().unwrap();
        assert!(out.contains("EXDATE;VALUE=DATE:20261102\r\n"));
        assert_eq!(expand(&out).len(), 2);

        let only = wrap("BEGIN:VEVENT\r\nUID:o\r\nRECURRENCE-ID:20261120T130000Z\r\nDTSTART:20261120T130000Z\r\nEND:VEVENT\r\n");
        assert_eq!(remove_occurrence(&only, "20261120T130000Z").unwrap(), None, "não sobrou nada: apaga o arquivo");
    }

    #[test]
    fn acha_o_evento_pelo_id_mesmo_longe_do_intervalo() {
        let simple = find_event(SIMPLE, HREF, CAL, &me(), None).unwrap();
        assert_eq!(simple.id, HREF);
        assert_eq!(simple.title, "Antes");
        let p = EventPatch {
            start: Some(EventTime { date_time: Some("2026-12-10T09:00:00-05:00".into()), date: None }),
            end: Some(EventTime { date_time: Some("2026-12-10T10:00:00-05:00".into()), date: None }),
            ..EventPatch::default()
        };
        // a ocorrência de 23/11 foi movida para 10/12: o id continua o mesmo
        let moved = apply_patch(&weekly(), Some("20261123T140000Z"), &p, ("ana@icloud.com", None), now()).unwrap();
        let ev = find_event(&moved, HREF, CAL, &me(), Some("20261123T140000Z")).unwrap();
        assert_eq!(ev.start.date_time.as_deref(), Some("2026-12-10T09:00:00-05:00"));
        assert_eq!(find_event(&weekly(), HREF, CAL, &me(), Some("20261102T140000Z")).unwrap().title, "Daily");
        assert!(find_event(&weekly(), HREF, CAL, &me(), Some("20261103T140000Z")).is_none());
    }

    #[test]
    fn intervalo_rfc3339_vira_utc_compacto() {
        let d = parse_rfc3339("2026-11-01T00:00:00.000Z").unwrap();
        assert_eq!(utc_compact(&d), "20261101T000000Z");
        assert_eq!(utc_compact(&parse_rfc3339("2026-11-01T00:00:00-03:00").unwrap()), "20261101T030000Z");
        assert!(parse_rfc3339("ontem").is_err());
    }
}
