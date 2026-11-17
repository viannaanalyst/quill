//! Leitura das respostas da API do Gmail para o formato da caixa de entrada do Quill.

use serde::{Deserialize, Serialize};

pub const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
pub const GMAIL_UPLOAD_API: &str = "https://gmail.googleapis.com/upload/gmail/v1/users/me";

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
    /// primeiro destinatário (útil em Enviados e Rascunhos)
    pub to: Option<Sender>,
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
    let to = header("To").and_then(|v| v.split(',').map(str::trim).find(|p| !p.is_empty()).map(parse_from));
    let subject = header("Subject").filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "(sem assunto)".into());
    let internal_date = raw.internal_date.parse::<i64>().map_err(|e| e.to_string())?;
    Ok(MessageSummary {
        initials: initials(&from.name),
        from,
        to,
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
#[serde(rename_all = "camelCase")]
struct PartBody {
    #[serde(default)]
    data: Option<String>,
    #[serde(default)]
    attachment_id: Option<String>,
    #[serde(default)]
    size: u64,
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

/// Anexo recebido (o conteúdo é baixado só quando a pessoa pede).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
}

/// Texto do e-mail e os anexos dele.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MessageBody {
    pub text: String,
    /// versão formatada (HTML) do e-mail, quando ele tem uma
    pub html: Option<String>,
    pub attachments: Vec<AttachmentInfo>,
}

fn collect_attachments(part: &FullPart, out: &mut Vec<AttachmentInfo>) {
    if !part.filename.is_empty() {
        if let Some(id) = part.body.as_ref().and_then(|b| b.attachment_id.clone()) {
            out.push(AttachmentInfo {
                id,
                name: part.filename.clone(),
                mime_type: part.mime_type.clone(),
                size: part.body.as_ref().map(|b| b.size).unwrap_or(0),
            });
        }
    }
    for p in &part.parts {
        collect_attachments(p, out);
    }
}

/// Lê `messages.get?format=full`: texto e anexos.
pub fn parse_message_body(json: &str) -> Result<MessageBody, String> {
    #[derive(Deserialize)]
    struct Full {
        payload: FullPart,
    }
    let full: Full = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let mut attachments = Vec::new();
    collect_attachments(&full.payload, &mut attachments);
    let html = find_part(&full.payload, "text/html").and_then(decode_part);
    Ok(MessageBody { text: extract_body_text(json)?, html, attachments })
}

/// Conteúdo de `messages.attachments.get` (base64url, com ou sem "=").
pub fn decode_attachment(json: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    #[derive(Deserialize)]
    struct A {
        data: String,
    }
    let a: A = serde_json::from_str(json).map_err(|e| e.to_string())?;
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(a.data.trim_end_matches('='))
        .map_err(|e| e.to_string())
}

/// Parâmetros de `messages.list` para cada caixa do app.
pub fn folder_query(folder: &str) -> Option<String> {
    // busca livre (⌘K): "search:<texto>" vira o q= do Gmail, em todas as caixas
    if let Some(text) = folder.strip_prefix("search:") {
        let text = text.trim();
        if text.is_empty() {
            return None;
        }
        let q: String = url::form_urlencoded::byte_serialize(text.as_bytes()).collect();
        return Some(format!("q={q}&includeSpamTrash=true"));
    }
    Some(match folder {
        "inbox" => "labelIds=INBOX".into(),
        "starred" => "labelIds=STARRED".into(),
        "sent" => "labelIds=SENT".into(),
        "drafts" => "labelIds=DRAFT".into(),
        "spam" => "labelIds=SPAM&includeSpamTrash=true".into(),
        "trash" => "labelIds=TRASH&includeSpamTrash=true".into(),
        // "Arquivo" = tudo que saiu da Entrada (e não é enviado, rascunho, spam ou lixeira)
        "archive" => format!(
            "q={}",
            url::form_urlencoded::byte_serialize(b"-in:inbox -in:sent -in:drafts -in:spam -in:trash").collect::<String>()
        ),
        _ => return None,
    })
}

/// E-mail a enviar pelo Gmail (o app monta a partir da tela Escrever).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingMessage {
    /// e-mail da conta que envia
    pub from: String,
    /// nome que aparece para quem recebe (o nome da conta Google)
    #[serde(default)]
    pub from_name: Option<String>,
    pub to: Vec<String>,
    #[serde(default)]
    pub cc: Vec<String>,
    #[serde(default)]
    pub bcc: Vec<String>,
    pub subject: String,
    pub html: String,
    /// Message-ID do e-mail respondido (mantém a conversa junta)
    #[serde(default)]
    pub in_reply_to: Option<String>,
    #[serde(default)]
    pub attachments: Vec<OutAttachment>,
}

/// Arquivo anexado na tela Escrever (conteúdo em base64 comum).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutAttachment {
    pub name: String,
    pub mime_type: String,
    pub data: String,
}

/// Assunto com acento vira "encoded-word" (RFC 2047); só ASCII fica como está.
fn encode_header(text: &str) -> String {
    use base64::Engine;
    if text.is_ascii() {
        return text.to_string();
    }
    format!("=?UTF-8?B?{}?=", base64::engine::general_purpose::STANDARD.encode(text.as_bytes()))
}

/// Tira quebras de linha de um cabeçalho (evita injetar cabeçalhos extras).
fn one_line(text: &str) -> String {
    text.replace(['\r', '\n'], " ")
}

/// Monta o e-mail no formato RFC 2822 (com anexos, vira multipart/mixed).
pub fn build_mime(m: &OutgoingMessage) -> String {
    use base64::Engine;
    let list = |v: &[String]| v.iter().map(|a| one_line(a.trim())).collect::<Vec<_>>().join(", ");
    let mut out = String::new();
    match m.from_name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        Some(name) => {
            let name = one_line(name).replace('"', "");
            let shown = if name.is_ascii() { format!("\"{name}\"") } else { encode_header(&name) };
            out.push_str(&format!("From: {shown} <{}>\r\n", one_line(&m.from)));
        }
        None => out.push_str(&format!("From: {}\r\n", one_line(&m.from))),
    }
    out.push_str(&format!("To: {}\r\n", list(&m.to)));
    if !m.cc.is_empty() {
        out.push_str(&format!("Cc: {}\r\n", list(&m.cc)));
    }
    if !m.bcc.is_empty() {
        out.push_str(&format!("Bcc: {}\r\n", list(&m.bcc)));
    }
    out.push_str(&format!("Subject: {}\r\n", encode_header(&one_line(&m.subject))));
    if let Some(id) = &m.in_reply_to {
        let id = one_line(id);
        out.push_str(&format!("In-Reply-To: {id}\r\nReferences: {id}\r\n"));
    }
    out.push_str("MIME-Version: 1.0\r\n");
    let html_part = format!(
        "Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{}",
        wrap76(&base64::engine::general_purpose::STANDARD.encode(m.html.as_bytes()))
    );
    if m.attachments.is_empty() {
        out.push_str(&html_part);
        return out;
    }
    let boundary = format!("quill-{}", crate::oauth::random_token(18));
    out.push_str(&format!("Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n"));
    out.push_str(&format!("--{boundary}\r\n{html_part}"));
    for a in &m.attachments {
        let ascii: String = one_line(&a.name).chars().filter(|c| c.is_ascii() && *c != '"' && *c != '\\').collect();
        let ascii = if ascii.trim().is_empty() { "anexo".to_string() } else { ascii };
        let encoded: String = url::form_urlencoded::byte_serialize(a.name.as_bytes()).collect::<String>().replace('+', "%20");
        let data: String = a.data.chars().filter(|c| !c.is_whitespace()).collect();
        out.push_str(&format!("--{boundary}\r\n"));
        out.push_str(&format!("Content-Type: {}; name=\"{ascii}\"\r\n", one_line(&a.mime_type)));
        out.push_str(&format!("Content-Disposition: attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}\r\n"));
        out.push_str("Content-Transfer-Encoding: base64\r\n\r\n");
        out.push_str(&wrap76(&data));
    }
    out.push_str(&format!("--{boundary}--\r\n"));
    out
}

/// Base64 em linhas de 76 caracteres (limite do formato de e-mail).
fn wrap76(data: &str) -> String {
    let mut out = String::with_capacity(data.len() + data.len() / 38 + 2);
    for chunk in data.as_bytes().chunks(76) {
        out.push_str(std::str::from_utf8(chunk).unwrap_or_default());
        out.push_str("\r\n");
    }
    out
}

/// O e-mail em base64url, como `messages.send` pede no campo `raw`.
pub fn build_raw_message(m: &OutgoingMessage) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(build_mime(m).as_bytes())
}

/// Corpo do envio por upload (`uploadType=multipart`): dados da conversa + o e-mail inteiro.
/// Aceita e-mails de até 35 MB (o envio comum para em ~5 MB).
pub fn upload_body(mime: &str, thread_id: Option<&str>, boundary: &str) -> String {
    let meta = match thread_id {
        Some(t) => serde_json::json!({ "threadId": t }).to_string(),
        None => "{}".to_string(),
    };
    format!(
        "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{boundary}\r\nContent-Type: message/rfc822\r\n\r\n{mime}\r\n--{boundary}--\r\n"
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct LabelCounts {
    pub total: u64,
    pub unread: u64,
}

/// Lê `labels.get` (totais e não lidos de uma caixa).
pub fn parse_label_counts(json: &str) -> Result<LabelCounts, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct L {
        #[serde(default)]
        messages_total: u64,
        #[serde(default)]
        messages_unread: u64,
    }
    let l: L = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(LabelCounts { total: l.messages_total, unread: l.messages_unread })
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UserInfo {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub picture: Option<String>,
}

/// Lê `oauth2/v2/userinfo` (nome e foto da conta Google).
pub fn parse_userinfo(json: &str) -> Result<UserInfo, String> {
    serde_json::from_str(json).map_err(|e| e.to_string())
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
    fn folder_queries_map_to_gmail_labels() {
        assert_eq!(folder_query("inbox").unwrap(), "labelIds=INBOX");
        assert_eq!(folder_query("starred").unwrap(), "labelIds=STARRED");
        assert_eq!(folder_query("sent").unwrap(), "labelIds=SENT");
        assert_eq!(folder_query("drafts").unwrap(), "labelIds=DRAFT");
        assert_eq!(folder_query("spam").unwrap(), "labelIds=SPAM&includeSpamTrash=true");
        assert_eq!(folder_query("trash").unwrap(), "labelIds=TRASH&includeSpamTrash=true");
        assert_eq!(folder_query("archive").unwrap(), "q=-in%3Ainbox+-in%3Asent+-in%3Adrafts+-in%3Aspam+-in%3Atrash");
        assert!(folder_query("nada").is_none());
    }

    #[test]
    fn busca_vira_q_do_gmail_incluindo_spam_e_lixeira() {
        assert_eq!(folder_query("search:nota fiscal").unwrap(), "q=nota+fiscal&includeSpamTrash=true");
        assert_eq!(folder_query("search:from:ana@x.com").unwrap(), "q=from%3Aana%40x.com&includeSpamTrash=true");
        assert!(folder_query("search:   ").is_none());
    }

    #[test]
    fn sent_messages_show_the_recipient() {
        let json = r#"{"id":"1","threadId":"1","labelIds":["SENT"],"snippet":"","internalDate":"1794917520000",
          "payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"Eu <eu@x.com>"},{"name":"To","value":"Mariana Costa <m@x.com>, b@x.com"},{"name":"Subject","value":"Oi"}]}}"#;
        let m = parse_message_metadata(json, NOW, SP).unwrap();
        assert_eq!(m.to.as_ref().map(|t| t.name.as_str()), Some("Mariana Costa"));
        assert_eq!(m.from.name, "Eu");
    }

    #[test]
    fn label_counts_are_read() {
        let c = parse_label_counts(r#"{"id":"INBOX","messagesTotal":120,"messagesUnread":3,"threadsTotal":90}"#).unwrap();
        assert_eq!(c, LabelCounts { total: 120, unread: 3 });
    }

    #[test]
    fn userinfo_gives_name_and_photo() {
        let u = parse_userinfo(r#"{"id":"1","email":"g@x.com","name":"Gabriel Vianna","picture":"https://lh3.googleusercontent.com/a/abc=s96-c"}"#).unwrap();
        assert_eq!(u.name.as_deref(), Some("Gabriel Vianna"));
        assert_eq!(u.picture.as_deref(), Some("https://lh3.googleusercontent.com/a/abc=s96-c"));
    }

    #[test]
    fn list_response_returns_ids() {
        let ids = parse_message_list(r#"{"messages":[{"id":"a","threadId":"t"},{"id":"b","threadId":"t"}],"resultSizeEstimate":2}"#).unwrap();
        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]);
        assert!(parse_message_list(r#"{"resultSizeEstimate":0}"#).unwrap().is_empty());
    }

    #[test]
    fn monta_email_para_envio_com_acentos_e_copias() {
        use base64::Engine;
        let raw = build_raw_message(&OutgoingMessage {
            from: "eu@gmail.com".into(),
            from_name: None,
            to: vec!["ana@x.com".into(), "bia@y.com".into()],
            cc: vec!["cc@z.com".into()],
            bcc: vec![],
            subject: "Reunião amanhã".into(),
            html: "<p>Olá</p>".into(),
            in_reply_to: None,
            attachments: vec![],
        });
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(raw).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("From: eu@gmail.com\r\n"));
        assert!(text.contains("To: ana@x.com, bia@y.com\r\n"));
        assert!(text.contains("Cc: cc@z.com\r\n"));
        assert!(!text.contains("Bcc:"));
        assert!(text.contains("Subject: =?UTF-8?B?UmV1bmnDo28gYW1hbmjDow==?=\r\n"));
        assert!(text.contains("Content-Type: text/html; charset=UTF-8\r\n"));
        assert!(text.contains("Content-Transfer-Encoding: base64\r\n"));
        assert!(text.ends_with("\r\n\r\nPHA+T2zDoTwvcD4=\r\n"));
    }

    #[test]
    fn assunto_simples_fica_sem_codificar_e_resposta_leva_referencia() {
        let raw = build_raw_message(&OutgoingMessage {
            from: "eu@gmail.com".into(),
            from_name: Some("Gabriel Viánna".into()),
            to: vec!["ana@x.com".into()],
            cc: vec![],
            bcc: vec!["oculto@x.com".into()],
            subject: "Re: Oi".into(),
            html: "oi".into(),
            in_reply_to: Some("<abc@mail.gmail.com>".into()),
            attachments: vec![],
        });
        use base64::Engine;
        let text = String::from_utf8(base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(raw).unwrap()).unwrap();
        assert!(text.contains("Subject: Re: Oi\r\n"));
        assert!(text.contains("From: =?UTF-8?B?R2FicmllbCBWacOhbm5h?= <eu@gmail.com>\r\n"));
        assert!(text.contains("Bcc: oculto@x.com\r\n"));
        assert!(text.contains("In-Reply-To: <abc@mail.gmail.com>\r\n"));
        assert!(text.contains("References: <abc@mail.gmail.com>\r\n"));
    }

    #[test]
    fn corpo_traz_texto_e_lista_de_anexos() {
        let json = r#"{"id":"m","payload":{"mimeType":"multipart/mixed","parts":[
            {"mimeType":"text/plain","filename":"","body":{"data":"T2zDoQ","size":4}},
            {"mimeType":"application/pdf","filename":"resumo.pdf","body":{"attachmentId":"ANX1","size":1258291}},
            {"mimeType":"multipart/related","filename":"","parts":[
                {"mimeType":"image/png","filename":"logo.png","body":{"attachmentId":"ANX2","size":2048}}]}
        ]}}"#;
        let body = parse_message_body(json).unwrap();
        assert_eq!(body.text, "Olá");
        assert_eq!(body.html, None);
        assert_eq!(body.attachments.len(), 2);
        assert_eq!(body.attachments[0], AttachmentInfo { id: "ANX1".into(), name: "resumo.pdf".into(), mime_type: "application/pdf".into(), size: 1258291 });
        assert_eq!(body.attachments[1].name, "logo.png");
    }

    #[test]
    fn baixa_anexo_em_base64url() {
        assert_eq!(decode_attachment(r#"{"size":3,"data":"T2zh"}"#).unwrap(), b"Ol\xe1".to_vec());
        assert_eq!(decode_attachment(r#"{"size":4,"data":"_-8="}"#).unwrap(), vec![0xff, 0xef]);
    }

    #[test]
    fn email_com_anexo_vira_multipart_mixed() {
        let mime = build_mime(&OutgoingMessage {
            from: "eu@gmail.com".into(),
            from_name: None,
            to: vec!["ana@x.com".into()],
            cc: vec![],
            bcc: vec![],
            subject: "Planilha".into(),
            html: "<p>Segue</p>".into(),
            in_reply_to: None,
            attachments: vec![OutAttachment { name: "relatório.xlsx".into(), mime_type: "application/vnd.ms-excel".into(), data: "AAEC".into() }],
        });
        assert!(mime.contains("Content-Type: multipart/mixed; boundary=\"quill-"));
        let boundary = mime.split("boundary=\"").nth(1).unwrap().split('"').next().unwrap().to_string();
        assert!(mime.contains(&format!("--{boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n")));
        assert!(mime.contains("Content-Type: application/vnd.ms-excel; name=\"relatrio.xlsx\"\r\n"));
        assert!(mime.contains("Content-Disposition: attachment; filename=\"relatrio.xlsx\"; filename*=UTF-8''relat%C3%B3rio.xlsx\r\n"));
        assert!(mime.contains("\r\n\r\nAAEC\r\n"));
        assert!(mime.trim_end().ends_with(&format!("--{boundary}--")));
    }

    #[test]
    fn envio_por_upload_leva_conversa_e_email() {
        let body = upload_body("From: eu\r\n\r\noi", Some("t1"), "B1");
        assert_eq!(
            body,
            "--B1\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{\"threadId\":\"t1\"}\r\n--B1\r\nContent-Type: message/rfc822\r\n\r\nFrom: eu\r\n\r\noi\r\n--B1--\r\n"
        );
        assert!(upload_body("x", None, "B").contains("\r\n\r\n{}\r\n"));
    }

    #[test]
    fn corpo_traz_o_html_quando_existe() {
        // <p>Oi <b>Ana</b></p> em base64url
        let json = r#"{"payload":{"mimeType":"multipart/alternative","parts":[
            {"mimeType":"text/plain","filename":"","body":{"data":"T2kgQW5h"}},
            {"mimeType":"text/html","filename":"","body":{"data":"PHA-T2kgPGI-QW5hPC9iPjwvcD4"}}]}}"#;
        let body = parse_message_body(json).unwrap();
        assert_eq!(body.text, "Oi Ana");
        assert_eq!(body.html.as_deref(), Some("<p>Oi <b>Ana</b></p>"));
    }
}
