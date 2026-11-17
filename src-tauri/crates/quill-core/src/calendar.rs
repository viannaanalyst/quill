//! Google Agenda: leitura das agendas e eventos, resposta a convites e criação de eventos.
//! Só a lógica (montar pedidos e ler respostas); a rede fica em `google.rs`.

use serde::{Deserialize, Serialize};

pub const CALENDAR_API: &str = "https://www.googleapis.com/calendar/v3";

/// Uma agenda da conta (a principal, as compartilhadas, feriados…).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub primary: bool,
    /// a pessoa pode criar e mudar eventos nela
    pub can_edit: bool,
    /// marcada como visível no Google Agenda
    pub selected: bool,
}

/// Lê `calendarList.list`.
pub fn parse_calendar_list(json: &str) -> Result<Vec<CalendarInfo>, String> {
    #[derive(Deserialize)]
    struct List {
        #[serde(default)]
        items: Vec<Item>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Item {
        id: String,
        #[serde(default)]
        summary: String,
        summary_override: Option<String>,
        background_color: Option<String>,
        #[serde(default)]
        primary: bool,
        #[serde(default)]
        access_role: String,
        #[serde(default)]
        selected: bool,
        #[serde(default)]
        deleted: bool,
    }
    let list: List = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(list
        .items
        .into_iter()
        .filter(|i| !i.deleted)
        .map(|i| CalendarInfo {
            name: i.summary_override.filter(|s| !s.is_empty()).unwrap_or(i.summary),
            color: i.background_color,
            primary: i.primary,
            can_edit: i.access_role == "owner" || i.access_role == "writer",
            selected: i.selected || i.primary,
            id: i.id,
        })
        .collect())
}

/// Início ou fim: `date_time` (com fuso, RFC 3339) ou `date` (dia inteiro, AAAA-MM-DD).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventTime {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attendee {
    pub email: String,
    pub name: Option<String>,
    /// needsAction, accepted, declined, tentative
    pub status: String,
    pub is_self: bool,
    pub organizer: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalEvent {
    pub id: String,
    /// igual em todas as cópias do mesmo convite (serve para não repetir o evento)
    pub ical_uid: String,
    pub calendar_id: String,
    pub title: String,
    pub start: EventTime,
    pub end: EventTime,
    pub all_day: bool,
    pub location: Option<String>,
    pub description: Option<String>,
    pub meet_url: Option<String>,
    pub html_link: Option<String>,
    pub organizer_email: Option<String>,
    pub organizer_name: Option<String>,
    pub organizer_self: bool,
    pub attendees: Vec<Attendee>,
    /// minha resposta ao convite (quando sou convidado)
    pub my_status: Option<String>,
    pub recurring: bool,
}

/// Parâmetros de `events.list`: eventos do intervalo, repetições já abertas, em ordem de início.
pub fn events_query(time_min: &str, time_max: &str, page_token: Option<&str>) -> String {
    let enc = |s: &str| url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>();
    let mut q = format!(
        "timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime&maxResults=250",
        enc(time_min),
        enc(time_max)
    );
    if let Some(t) = page_token {
        q.push_str(&format!("&pageToken={}", enc(t)));
    }
    q
}

/// Caminho de uma agenda na API (o id pode ter @ e #, então vai codificado).
pub fn calendar_path(calendar_id: &str) -> String {
    format!("/calendars/{}", url::form_urlencoded::byte_serialize(calendar_id.as_bytes()).collect::<String>())
}

/// Lê `events.list`. Devolve os eventos (sem os cancelados) e o token da próxima página.
pub fn parse_events(json: &str, calendar_id: &str) -> Result<(Vec<CalEvent>, Option<String>), String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct List {
        #[serde(default)]
        items: Vec<Item>,
        next_page_token: Option<String>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Person {
        #[serde(default)]
        email: String,
        display_name: Option<String>,
        #[serde(default, rename = "self")]
        is_self: bool,
        #[serde(default)]
        organizer: bool,
        #[serde(default)]
        response_status: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EntryPoint {
        #[serde(default)]
        entry_point_type: String,
        #[serde(default)]
        uri: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Conference {
        #[serde(default)]
        entry_points: Vec<EntryPoint>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Item {
        id: String,
        #[serde(default)]
        status: String,
        #[serde(rename = "iCalUID")]
        ical_uid: Option<String>,
        summary: Option<String>,
        #[serde(default)]
        start: EventTime,
        #[serde(default)]
        end: EventTime,
        location: Option<String>,
        description: Option<String>,
        hangout_link: Option<String>,
        conference_data: Option<Conference>,
        html_link: Option<String>,
        organizer: Option<Person>,
        #[serde(default)]
        attendees: Vec<Person>,
        recurring_event_id: Option<String>,
    }
    let list: List = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let events = list
        .items
        .into_iter()
        .filter(|i| i.status != "cancelled")
        .map(|i| {
            let meet_url = i.hangout_link.clone().or_else(|| {
                i.conference_data
                    .as_ref()
                    .and_then(|c| c.entry_points.iter().find(|e| e.entry_point_type == "video").map(|e| e.uri.clone()))
            });
            let my_status = i.attendees.iter().find(|a| a.is_self).map(|a| a.response_status.clone());
            let attendees = i
                .attendees
                .into_iter()
                .map(|a| Attendee {
                    email: a.email,
                    name: a.display_name,
                    status: a.response_status,
                    is_self: a.is_self,
                    organizer: a.organizer,
                })
                .collect();
            CalEvent {
                ical_uid: i.ical_uid.unwrap_or_else(|| i.id.clone()),
                calendar_id: calendar_id.to_string(),
                title: i.summary.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "(sem título)".into()),
                all_day: i.start.date_time.is_none() && i.start.date.is_some(),
                start: i.start,
                end: i.end,
                location: i.location.filter(|s| !s.trim().is_empty()),
                description: i.description.filter(|s| !s.trim().is_empty()),
                meet_url,
                html_link: i.html_link,
                organizer_email: i.organizer.as_ref().map(|o| o.email.clone()),
                organizer_name: i.organizer.as_ref().and_then(|o| o.display_name.clone()),
                organizer_self: i.organizer.as_ref().is_some_and(|o| o.is_self),
                attendees,
                my_status,
                recurring: i.recurring_event_id.is_some(),
                id: i.id,
            }
        })
        .collect();
    Ok((events, list.next_page_token))
}

/// Corpo do PATCH para responder a um convite: a lista de convidados com a minha resposta trocada.
/// (O Google exige a lista inteira no PATCH; `event_json` é o evento como veio de `events.get`.)
pub fn rsvp_patch(event_json: &str, status: &str) -> Result<String, String> {
    if !matches!(status, "accepted" | "declined" | "tentative") {
        return Err(format!("resposta inválida: {status}"));
    }
    let mut event: serde_json::Value = serde_json::from_str(event_json).map_err(|e| e.to_string())?;
    let attendees = event
        .get_mut("attendees")
        .and_then(|a| a.as_array_mut())
        .ok_or("este evento não tem convidados")?;
    let me = attendees
        .iter_mut()
        .find(|a| a.get("self").and_then(|s| s.as_bool()).unwrap_or(false))
        .ok_or("você não está entre os convidados deste evento")?;
    me["responseStatus"] = serde_json::Value::String(status.to_string());
    Ok(serde_json::json!({ "attendees": attendees }).to_string())
}

/// Evento novo criado pelo Quill.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEvent {
    pub title: String,
    pub start: EventTime,
    pub end: EventTime,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// e-mails dos convidados
    #[serde(default)]
    pub attendees: Vec<String>,
    /// lembretes em minutos antes; None = o padrão da agenda
    #[serde(default)]
    pub reminders: Option<Vec<u32>>,
    /// criar sala do Google Meet
    #[serde(default)]
    pub meet: bool,
}

fn attendees_json(list: &[String]) -> serde_json::Value {
    serde_json::Value::Array(
        list.iter()
            .map(|e| e.trim())
            .filter(|e| e.contains('@'))
            .map(|e| serde_json::json!({ "email": e }))
            .collect(),
    )
}

fn reminders_json(mins: &[u32]) -> serde_json::Value {
    serde_json::json!({
        "useDefault": false,
        "overrides": mins.iter().map(|m| serde_json::json!({ "method": "popup", "minutes": m })).collect::<Vec<_>>(),
    })
}

/// O pedido precisa avisar convidados ou criar Meet? (muda os parâmetros da URL)
pub fn new_event_query(e: &NewEvent) -> &'static str {
    match (e.meet, e.attendees.iter().any(|a| a.contains('@'))) {
        (true, _) => "?conferenceDataVersion=1&sendUpdates=all",
        (false, true) => "?sendUpdates=all",
        _ => "",
    }
}

/// Mudanças num evento existente (só os campos com valor vão no PATCH).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub start: Option<EventTime>,
    #[serde(default)]
    pub end: Option<EventTime>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub attendees: Option<Vec<String>>,
    #[serde(default)]
    pub reminders: Option<Vec<u32>>,
}

/// Corpo do PATCH de `events.patch`.
pub fn event_patch_body(p: &EventPatch) -> String {
    let mut body = serde_json::Map::new();
    if let Some(t) = &p.title {
        body.insert("summary".into(), (if t.trim().is_empty() { "(sem título)" } else { t.trim() }).into());
    }
    if let Some(v) = &p.start {
        body.insert("start".into(), serde_json::to_value(v).unwrap_or_default());
    }
    if let Some(v) = &p.end {
        body.insert("end".into(), serde_json::to_value(v).unwrap_or_default());
    }
    if let Some(v) = &p.location {
        body.insert("location".into(), v.trim().into());
    }
    if let Some(v) = &p.description {
        body.insert("description".into(), v.trim().into());
    }
    if let Some(v) = &p.attendees {
        body.insert("attendees".into(), attendees_json(v));
    }
    if let Some(v) = &p.reminders {
        body.insert("reminders".into(), reminders_json(v));
    }
    serde_json::Value::Object(body).to_string()
}

/// Corpo do POST de `events.insert`.
pub fn new_event_body(e: &NewEvent) -> String {
    let mut body = serde_json::json!({
        "summary": if e.title.trim().is_empty() { "(sem título)" } else { e.title.trim() },
        "start": e.start,
        "end": e.end,
    });
    if let Some(l) = e.location.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        body["location"] = l.into();
    }
    if let Some(d) = e.description.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        body["description"] = d.into();
    }
    let att = attendees_json(&e.attendees);
    if att.as_array().is_some_and(|a| !a.is_empty()) {
        body["attendees"] = att;
    }
    if let Some(r) = &e.reminders {
        body["reminders"] = reminders_json(r);
    }
    if e.meet {
        body["conferenceData"] = serde_json::json!({
            "createRequest": { "requestId": crate::oauth::random_token(12), "conferenceSolutionKey": { "type": "hangoutsMeet" } }
        });
    }
    body.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_agendas_com_nome_proprio_e_permissao() {
        let json = r##"{"items":[
            {"id":"eu@gmail.com","summary":"eu@gmail.com","summaryOverride":"Pessoal","backgroundColor":"#9fc6e7","primary":true,"accessRole":"owner"},
            {"id":"pt.brazilian#holiday@group.v.calendar.google.com","summary":"Feriados no Brasil","accessRole":"reader","selected":true},
            {"id":"velha","summary":"Apagada","deleted":true,"accessRole":"owner"}
        ]}"##;
        let list = parse_calendar_list(json).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "Pessoal");
        assert_eq!(list[0].color.as_deref(), Some("#9fc6e7"));
        assert!(list[0].primary && list[0].can_edit && list[0].selected);
        assert_eq!(list[1].name, "Feriados no Brasil");
        assert!(!list[1].can_edit);
    }

    #[test]
    fn le_eventos_com_meet_convidados_e_dia_inteiro() {
        let json = r#"{"items":[
            {"id":"e1","status":"confirmed","iCalUID":"abc@google.com","summary":"Planejamento Q1",
             "start":{"dateTime":"2026-11-19T10:00:00-03:00"},"end":{"dateTime":"2026-11-19T11:30:00-03:00"},
             "location":"Sala Paulista","hangoutLink":"https://meet.google.com/xpa-mnqr-tuv",
             "organizer":{"email":"rafael@inchurch.com.br","displayName":"Rafael Lima"},
             "attendees":[{"email":"rafael@inchurch.com.br","organizer":true,"responseStatus":"accepted"},
                          {"email":"eu@inchurch.com.br","self":true,"responseStatus":"needsAction"}]},
            {"id":"e2","status":"cancelled","start":{"date":"2026-11-20"},"end":{"date":"2026-11-21"}},
            {"id":"e3","status":"confirmed","start":{"date":"2026-11-20"},"end":{"date":"2026-11-21"},"recurringEventId":"r"}
        ],"nextPageToken":"pg2"}"#;
        let (events, next) = parse_events(json, "eu@inchurch.com.br").unwrap();
        assert_eq!(next.as_deref(), Some("pg2"));
        assert_eq!(events.len(), 2);
        let e = &events[0];
        assert_eq!(e.ical_uid, "abc@google.com");
        assert_eq!(e.calendar_id, "eu@inchurch.com.br");
        assert_eq!(e.start.date_time.as_deref(), Some("2026-11-19T10:00:00-03:00"));
        assert!(!e.all_day);
        assert_eq!(e.meet_url.as_deref(), Some("https://meet.google.com/xpa-mnqr-tuv"));
        assert_eq!(e.organizer_name.as_deref(), Some("Rafael Lima"));
        assert_eq!(e.my_status.as_deref(), Some("needsAction"));
        assert_eq!(e.attendees.len(), 2);
        assert_eq!(events[1].title, "(sem título)");
        assert!(events[1].all_day && events[1].recurring);
        assert_eq!(events[1].ical_uid, "e3");
    }

    #[test]
    fn meet_tambem_vem_do_conference_data() {
        let json = r#"{"items":[{"id":"e","start":{"dateTime":"2026-11-19T10:00:00Z"},"end":{"dateTime":"2026-11-19T11:00:00Z"},
            "conferenceData":{"entryPoints":[{"entryPointType":"phone","uri":"tel:+55"},{"entryPointType":"video","uri":"https://teams.microsoft.com/l/x"}]}}]}"#;
        let (events, _) = parse_events(json, "c").unwrap();
        assert_eq!(events[0].meet_url.as_deref(), Some("https://teams.microsoft.com/l/x"));
    }

    #[test]
    fn consulta_de_eventos_codifica_datas_e_pagina() {
        let q = events_query("2026-11-16T00:00:00-03:00", "2026-11-23T00:00:00-03:00", Some("pg2"));
        assert_eq!(
            q,
            "timeMin=2026-11-16T00%3A00%3A00-03%3A00&timeMax=2026-11-23T00%3A00%3A00-03%3A00&singleEvents=true&orderBy=startTime&maxResults=250&pageToken=pg2"
        );
        assert_eq!(calendar_path("pt.brazilian#holiday@group.v.calendar.google.com"), "/calendars/pt.brazilian%23holiday%40group.v.calendar.google.com");
    }

    #[test]
    fn resposta_ao_convite_troca_so_a_minha() {
        let ev = r#"{"id":"e1","attendees":[{"email":"a@x.com","responseStatus":"accepted"},{"email":"eu@x.com","self":true,"responseStatus":"needsAction"}]}"#;
        let body: serde_json::Value = serde_json::from_str(&rsvp_patch(ev, "tentative").unwrap()).unwrap();
        assert_eq!(body["attendees"][0]["responseStatus"], "accepted");
        assert_eq!(body["attendees"][1]["responseStatus"], "tentative");
        assert!(body.get("id").is_none());
        assert!(rsvp_patch(ev, "talvez").is_err());
        assert!(rsvp_patch(r#"{"id":"e"}"#, "accepted").is_err());
    }

    #[test]
    fn evento_novo_com_horario_ou_dia_inteiro() {
        let body: serde_json::Value = serde_json::from_str(&new_event_body(&NewEvent {
            title: "  Almoço ".into(),
            start: EventTime { date_time: Some("2026-11-18T12:30:00-03:00".into()), date: None },
            end: EventTime { date_time: Some("2026-11-18T13:30:00-03:00".into()), date: None },
            location: Some(" ".into()),
            description: None,
            attendees: vec![],
            reminders: None,
            meet: false,
        }))
        .unwrap();
        assert_eq!(body["summary"], "Almoço");
        assert_eq!(body["start"]["dateTime"], "2026-11-18T12:30:00-03:00");
        assert!(body["start"].get("date").is_none());
        assert!(body.get("location").is_none());

        let all_day: serde_json::Value = serde_json::from_str(&new_event_body(&NewEvent {
            title: "".into(),
            start: EventTime { date_time: None, date: Some("2026-11-20".into()) },
            end: EventTime { date_time: None, date: Some("2026-11-21".into()) },
            location: Some("Casa".into()),
            description: None,
            attendees: vec![],
            reminders: None,
            meet: false,
        }))
        .unwrap();
        assert_eq!(all_day["summary"], "(sem título)");
        assert_eq!(all_day["start"]["date"], "2026-11-20");
        assert_eq!(all_day["location"], "Casa");
    }

    #[test]
    fn evento_novo_com_convidados_lembrete_e_meet() {
        let body: serde_json::Value = serde_json::from_str(&new_event_body(&NewEvent {
            title: "Reunião".into(),
            start: EventTime { date_time: Some("2026-11-18T10:00:00-03:00".into()), date: None },
            end: EventTime { date_time: Some("2026-11-18T11:00:00-03:00".into()), date: None },
            location: None,
            description: None,
            attendees: vec!["ana@x.com".into(), " bia@y.com ".into(), "".into()],
            reminders: Some(vec![10, 60]),
            meet: true,
        }))
        .unwrap();
        assert_eq!(body["attendees"][0]["email"], "ana@x.com");
        assert_eq!(body["attendees"][1]["email"], "bia@y.com");
        assert_eq!(body["attendees"].as_array().unwrap().len(), 2);
        assert_eq!(body["reminders"]["useDefault"], false);
        assert_eq!(body["reminders"]["overrides"][1]["minutes"], 60);
        assert_eq!(body["conferenceData"]["createRequest"]["conferenceSolutionKey"]["type"], "hangoutsMeet");
        assert!(body["conferenceData"]["createRequest"]["requestId"].as_str().unwrap().len() >= 8);
    }

    #[test]
    fn edicao_manda_so_o_que_mudou() {
        let body: serde_json::Value = serde_json::from_str(&event_patch_body(&EventPatch {
            title: Some("Novo título".into()),
            start: None,
            end: None,
            location: Some("".into()),
            description: None,
            attendees: Some(vec!["ana@x.com".into()]),
            reminders: Some(vec![]),
        }))
        .unwrap();
        assert_eq!(body["summary"], "Novo título");
        assert_eq!(body["location"], "");
        assert!(body.get("start").is_none());
        assert!(body.get("description").is_none());
        assert_eq!(body["attendees"][0]["email"], "ana@x.com");
        // lista vazia = sem lembrete
        assert_eq!(body["reminders"]["useDefault"], false);
        assert_eq!(body["reminders"]["overrides"].as_array().unwrap().len(), 0);
    }
}
