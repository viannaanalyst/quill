//! Leitura das respostas da API do Gmail para o formato da caixa de entrada do Quill.

use serde::{Deserialize, Serialize};

pub const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Sender {
    pub name: String,
    pub email: String,
}

/// Lê o cabeçalho "From" (`"Nome" <email>`, `Nome <email>` ou só `email`).
pub fn parse_from(value: &str) -> Sender {
    let value = value.trim();
    if let (Some(lt), Some(gt)) = (value.rfind('<'), value.rfind('>'))
        && lt < gt {
            let email = value[lt + 1..gt].trim().to_string();
            let name = value[..lt].trim().trim_matches('"').trim().to_string();
            let name = if name.is_empty() { email.clone() } else { name };
            return Sender { name, email };
        }
    Sender { name: value.to_string(), email: value.to_string() }
}

/// Iniciais para o avatar: primeira letra do primeiro e do último nome.
pub fn initials(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().filter(|w| w.chars().next().is_some_and(char::is_alphanumeric)).collect();
    let first = |w: &str| w.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
    match words.as_slice() {
        [] => "?".into(),
        [one] => first(one),
        [a, .., b] => format!("{}{}", first(a), first(b)),
    }
}

/// O Gmail manda a prévia com entidades HTML (`&#39;`, `&amp;`…).
pub fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest[..rest.len().min(10)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => entity
                .strip_prefix("#x")
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
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

const MONTHS: [&str; 12] = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/// Data da lista: "09:12" (hoje), "Ontem", "15 nov" (este ano) ou "13 out 2025".
/// `tz_offset_min` é o fuso local em minutos (São Paulo = -180).
pub fn format_list_date(msg_ms: i64, now_ms: i64, tz_offset_min: i32) -> String {
    let local = |ms: i64| ms.div_euclid(60_000) + tz_offset_min as i64; // minutos locais desde a época
    let (msg_min, now_min) = (local(msg_ms), local(now_ms));
    let (msg_day, now_day) = (msg_min.div_euclid(1440), now_min.div_euclid(1440));
    if msg_day == now_day {
        let m = msg_min.rem_euclid(1440);
        return format!("{:02}:{:02}", m / 60, m % 60);
    }
    if msg_day == now_day - 1 {
        return "Ontem".into();
    }
    let (y, mo, d) = civil_from_days(msg_day);
    let (ny, _, _) = civil_from_days(now_day);
    if y == ny { format!("{d} {}", MONTHS[mo as usize - 1]) } else { format!("{d} {} {y}", MONTHS[mo as usize - 1]) }
}

/// Resumo de um e-mail para a lista.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummary {
    pub id: String,
    pub thread_id: String,
    pub from: Sender,
    pub initials: String,
    pub subject: String,
    pub preview: String,
    pub date: String,
    pub internal_date: i64,
    pub unread: bool,
    pub starred: bool,
    pub has_attachment: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawMessage {
    id: String,
    thread_id: String,
    #[serde(default)]
    label_ids: Vec<String>,
    #[serde(default)]
    snippet: String,
    internal_date: String,
    payload: RawPayload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPayload {
    #[serde(default)]
    mime_type: String,
    #[serde(default)]
    headers: Vec<RawHeader>,
}

#[derive(Deserialize)]
struct RawHeader {
    name: String,
    value: String,
}

/// Lê um e-mail pedido com `format=metadata` (cabeçalhos From e Subject).
pub fn parse_message_metadata(json: &str, now_ms: i64, tz_offset_min: i32) -> Result<MessageSummary, String> {
    let raw: RawMessage = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let header = |n: &str| raw.payload.headers.iter().find(|h| h.name.eq_ignore_ascii_case(n)).map(|h| h.value.clone());
    let from = parse_from(&header("From").unwrap_or_default());
    let subject = header("Subject").filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "(sem assunto)".into());
    let internal_date = raw.internal_date.parse::<i64>().map_err(|e| e.to_string())?;
    Ok(MessageSummary {
        initials: initials(&from.name),
        from,
        subject,
        preview: decode_entities(&raw.snippet),
        date: format_list_date(internal_date, now_ms, tz_offset_min),
        internal_date,
        unread: raw.label_ids.iter().any(|l| l == "UNREAD"),
        starred: raw.label_ids.iter().any(|l| l == "STARRED"),
        // multipart/mixed é o formato usado quando há anexo
        has_attachment: raw.payload.mime_type == "multipart/mixed",
        id: raw.id,
        thread_id: raw.thread_id,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FullPart {
    #[serde(default)]
    mime_type: String,
    #[serde(default)]
    filename: String,
    #[serde(default)]
    body: Option<PartBody>,
    #[serde(default)]
    parts: Vec<FullPart>,
}

#[derive(Deserialize)]
struct PartBody {
    #[serde(default)]
    data: Option<String>,
}

fn find_part<'a>(part: &'a FullPart, mime: &str) -> Option<&'a FullPart> {
    if part.mime_type == mime && part.filename.is_empty() && part.body.as_ref().and_then(|b| b.data.as_ref()).is_some() {
        return Some(part);
    }
    part.parts.iter().find_map(|p| find_part(p, mime))
}

fn decode_part(part: &FullPart) -> Option<String> {
    use base64::Engine;
    let data = part.body.as_ref()?.data.as_ref()?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(data.trim_end_matches('='))
        .ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Texto simples a partir de HTML: tira estilos/scripts e tags, mantém parágrafos e quebras.
fn html_to_text(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut out = String::new();
    let mut i = 0;
    while i < html.len() {
        if html[i..].starts_with('<') {
            let end = html[i..].find('>').map(|e| i + e + 1).unwrap_or(html.len());
            let tag = lower[i + 1..end.saturating_sub(1).max(i + 1)].trim_start_matches('/').to_string();
            let name: String = tag.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
            if (name == "style" || name == "script") && !lower[i + 1..].starts_with('/') {
                let close = format!("</{name}");
                i = lower[end..].find(&close).map(|c| end + c).unwrap_or(html.len());
                continue;
            }
            match name.as_str() {
                "br" => out.push('\n'),
                "p" | "div" | "tr" | "li" | "h1" | "h2" | "h3" if lower[i + 1..].starts_with('/') => out.push_str("\n\n"),
                _ => {}
            }
            i = end;
        } else {
            let next = html[i..].find('<').map(|n| i + n).unwrap_or(html.len());
            out.push_str(&html[i..next]);
            i = next;
        }
    }
    let text = decode_entities(&out);
    // junta espaços e limita quebras seguidas a uma linha em branco
    let lines: Vec<String> = text.lines().map(|l| l.split_whitespace().collect::<Vec<_>>().join(" ")).collect();
    let mut result = Vec::new();
    for l in lines {
        if l.is_empty() && result.last().is_some_and(|p: &String| p.is_empty()) {
            continue;
        }
        result.push(l);
    }
    result.join("\n").trim().to_string()
}

/// Texto do e-mail (pedido com `format=full`): prefere text/plain; senão converte o HTML.
pub fn extract_body_text(json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Full {
        payload: FullPart,
    }
    let full: Full = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if let Some(text) = find_part(&full.payload, "text/plain").and_then(decode_part) {
        return Ok(text.replace("\r\n", "\n").trim().to_string());
    }
    if let Some(html) = find_part(&full.payload, "text/html").and_then(decode_part) {
        return Ok(html_to_text(&html));
    }
    Ok(String::new())
}

/// Lê a resposta de `messages.list` e devolve só os ids.
pub fn parse_message_list(json: &str) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct List {
        #[serde(default)]
        messages: Vec<Id>,
    }
    #[derive(Deserialize)]
    struct Id {
        id: String,
    }
    let list: List = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(list.messages.into_iter().map(|m| m.id).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_header_with_quoted_name() {
        assert_eq!(
            parse_from(r#""Mariana Costa" <mariana.costa@inchurch.com.br>"#),
            Sender { name: "Mariana Costa".into(), email: "mariana.costa@inchurch.com.br".into() }
        );
    }

    #[test]
    fn from_header_with_plain_name() {
        assert_eq!(parse_from("Nubank <todomundo@nubank.com.br>").name, "Nubank");
    }

    #[test]
    fn from_header_with_only_email_uses_email_as_name() {
        assert_eq!(
            parse_from("lucas@icloud.com"),
            Sender { name: "lucas@icloud.com".into(), email: "lucas@icloud.com".into() }
        );
    }

    #[test]
    fn initials_from_names() {
        assert_eq!(initials("Mariana Costa"), "MC");
        assert_eq!(initials("ana beatriz souza"), "AS");
        assert_eq!(initials("Nubank"), "N");
        assert_eq!(initials("lucas@icloud.com"), "L");
    }

    #[test]
    fn snippet_entities_are_decoded() {
        assert_eq!(decode_entities("Oi Gabriel, it&#39;s &quot;ok&quot; &amp; tal &lt;3"), r#"Oi Gabriel, it's "ok" & tal <3"#);
    }

    // 17/11/2026 12:00 em São Paulo (UTC-3) = 15:00 UTC
    const NOW: i64 = 1_794_927_600_000;
    const SP: i32 = -180;

    #[test]
    fn same_day_shows_time() {
        // 17/11/2026 09:12 em São Paulo
        assert_eq!(format_list_date(NOW - (2 * 60 + 48) * 60_000, NOW, SP), "09:12");
    }

    #[test]
    fn previous_day_shows_ontem() {
        // 16/11/2026 23:30 em São Paulo
        assert_eq!(format_list_date(NOW - (12 * 60 + 30) * 60_000, NOW, SP), "Ontem");
    }

    #[test]
    fn same_year_shows_day_and_month() {
        // 15/11/2026 10:00 em São Paulo
        assert_eq!(format_list_date(NOW - (2 * 24 * 60 + 2 * 60) * 60_000, NOW, SP), "15 nov");
    }

    #[test]
    fn other_year_shows_year() {
        // ~400 dias antes
        assert_eq!(format_list_date(NOW - 400 * 24 * 3_600_000, NOW, SP), "13 out 2025");
    }

    #[test]
    fn metadata_message_becomes_summary() {
        let json = r#"{
          "id": "18c9a",
          "threadId": "18c99",
          "labelIds": ["INBOX", "UNREAD", "CATEGORY_PERSONAL"],
          "snippet": "Segue a planilha &amp; o resumo",
          "internalDate": "1794917520000",
          "payload": {
            "mimeType": "multipart/mixed",
            "headers": [
              {"name": "From", "value": "\"Mariana Costa\" <mariana.costa@inchurch.com.br>"},
              {"name": "Subject", "value": "Fechamento de outubro"}
            ]
          }
        }"#;
        let m = parse_message_metadata(json, NOW, SP).unwrap();
        assert_eq!(m.id, "18c9a");
        assert_eq!(m.thread_id, "18c99");
        assert_eq!(m.from.name, "Mariana Costa");
        assert_eq!(m.subject, "Fechamento de outubro");
        assert_eq!(m.preview, "Segue a planilha & o resumo");
        assert!(m.unread);
        assert!(!m.starred);
        assert!(m.has_attachment);
        assert_eq!(m.date, "09:12");
    }

    #[test]
    fn message_without_subject_gets_placeholder() {
        let json = r#"{"id":"1","threadId":"1","labelIds":["INBOX"],"snippet":"","internalDate":"1794917520000",
          "payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"a@b.com"}]}}"#;
        let m = parse_message_metadata(json, NOW, SP).unwrap();
        assert_eq!(m.subject, "(sem assunto)");
        assert!(!m.unread);
        assert!(!m.has_attachment);
    }

    fn b64(s: &str) -> String {
        use base64::Engine;
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s)
    }

    #[test]
    fn body_prefers_plain_text_part() {
        let json = format!(
            r#"{{"payload":{{"mimeType":"multipart/alternative","parts":[
              {{"mimeType":"text/plain","body":{{"data":"{}"}}}},
              {{"mimeType":"text/html","body":{{"data":"{}"}}}}]}}}}"#,
            b64("Oi Gabriel,\r\n\r\nSegue a planilha."),
            b64("<p>ignorar</p>")
        );
        assert_eq!(extract_body_text(&json).unwrap(), "Oi Gabriel,\n\nSegue a planilha.");
    }

    #[test]
    fn body_falls_back_to_html_without_tags() {
        let json = format!(
            r#"{{"payload":{{"mimeType":"text/html","body":{{"data":"{}"}}}}}}"#,
            b64("<html><head><style>p{color:red}</style></head><body><p>Olá&nbsp;mundo</p><p>Linha 2<br>Linha 3</p></body></html>")
        );
        assert_eq!(extract_body_text(&json).unwrap(), "Olá mundo\n\nLinha 2\nLinha 3");
    }

    #[test]
    fn body_finds_text_inside_nested_parts() {
        let json = format!(
            r#"{{"payload":{{"mimeType":"multipart/mixed","parts":[
              {{"mimeType":"multipart/alternative","parts":[{{"mimeType":"text/plain","body":{{"data":"{}"}}}}]}},
              {{"mimeType":"application/pdf","filename":"a.pdf","body":{{"attachmentId":"x"}}}}]}}}}"#,
            b64("Corpo")
        );
        assert_eq!(extract_body_text(&json).unwrap(), "Corpo");
    }

    #[test]
    fn list_response_returns_ids() {
        let ids = parse_message_list(r#"{"messages":[{"id":"a","threadId":"t"},{"id":"b","threadId":"t"}],"resultSizeEstimate":2}"#).unwrap();
        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]);
        assert!(parse_message_list(r#"{"resultSizeEstimate":0}"#).unwrap().is_empty());
    }
}
