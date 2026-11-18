//! Contatos do iCloud (CardDAV): acha os catálogos e lê os vCards (nome, e-mails e foto).
//! Só a lógica; a rede fica em `dav_client.rs`.

use crate::contacts::Contact;
use crate::dav::DavResponse;
use crate::ical::{self, Component, Property};

/// Foto em base64 até esse tamanho de texto (~40 KB de imagem), para a lista não pesar.
const MAX_PHOTO_B64: usize = 54_000;

/// Endereços (absolutos) dos catálogos de contatos da pasta do CardDAV.
pub fn parse_addressbooks(responses: &[DavResponse], base_url: &str) -> Vec<String> {
    responses
        .iter()
        .filter(|r| r.prop("resourcetype").is_some_and(|t| t.has("addressbook")))
        .filter_map(|r| crate::dav::resolve(base_url, &r.href).ok())
        .collect()
}

/// Endereços dos cartões (o que não é pasta) de uma listagem, para pedir em lote.
pub fn card_hrefs(responses: &[DavResponse]) -> Vec<String> {
    responses
        .iter()
        .filter(|r| r.status.is_none_or(|s| (200..300).contains(&s)))
        .filter(|r| !r.prop("resourcetype").is_some_and(|t| t.has("collection")))
        .map(|r| r.href.clone())
        .collect()
}

/// Contatos dos cartões que vieram junto na resposta (`address-data`).
pub fn contacts_from_responses(responses: &[DavResponse], weight: u32) -> Vec<Contact> {
    responses.iter().filter_map(|r| r.text("address-data")).flat_map(|t| parse_vcards(t, weight)).collect()
}

fn non_empty(s: String) -> Option<String> {
    let s = s.trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// Nome para mostrar: FN, ou "Nome Sobrenome" do N, ou a empresa (ORG).
fn display_name(card: &Component) -> Option<String> {
    if let Some(fn_) = card.text("FN").and_then(non_empty) {
        return Some(fn_);
    }
    if let Some(n) = card.prop("N") {
        let parts: Vec<String> = n.value.split(';').map(ical::unescape).collect();
        let given = parts.get(1).cloned().unwrap_or_default();
        let family = parts.first().cloned().unwrap_or_default();
        if let Some(full) = non_empty(format!("{} {}", given.trim(), family.trim())) {
            return Some(full);
        }
    }
    card.prop("ORG").and_then(|o| o.value.split(';').next().map(ical::unescape)).and_then(non_empty)
}

fn image_type(t: &str) -> Option<&'static str> {
    match t.trim().to_ascii_lowercase().trim_start_matches("image/") {
        "jpeg" | "jpg" => Some("jpeg"),
        "png" => Some("png"),
        "gif" => Some("gif"),
        "webp" => Some("webp"),
        "heic" => Some("heic"),
        _ => None,
    }
}

fn is_base64(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
}

/// Foto do cartão: base64 pequena vira `data:image/...;base64,...`; link https fica, menos os do
/// próprio iCloud (pedem senha). Qualquer coisa estranha fica de fora.
fn photo(p: &Property) -> Option<String> {
    let value: String = p.value.chars().filter(|c| !c.is_whitespace()).collect();
    let lower = value.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("data:") {
        let (meta, _) = rest.split_once(',')?;
        let kind = image_type(meta.split(';').next()?)?;
        let data = &value[value.find(',')? + 1..];
        return (meta.ends_with(";base64") && is_base64(data) && data.len() <= MAX_PHOTO_B64).then(|| format!("data:image/{kind};base64,{data}"));
    }
    if lower.starts_with("https://") {
        let host = url::Url::parse(&value).ok()?.host_str()?.to_ascii_lowercase();
        return (!(host == "icloud.com" || host.ends_with(".icloud.com"))).then_some(value);
    }
    let encoded = p.param("ENCODING").is_some_and(|e| e.eq_ignore_ascii_case("b") || e.eq_ignore_ascii_case("base64"));
    if !encoded || !is_base64(&value) || value.len() > MAX_PHOTO_B64 {
        return None;
    }
    let kind = match p.param("TYPE") {
        Some(t) => image_type(t)?,
        None => "jpeg",
    };
    Some(format!("data:image/{kind};base64,{value}"))
}

/// Lê um ou mais vCards: um contato para cada e-mail do cartão.
pub fn parse_vcards(text: &str, weight: u32) -> Vec<Contact> {
    let mut out = Vec::new();
    for card in ical::parse(text).into_iter().filter(|c| c.name == "VCARD") {
        let name = display_name(&card);
        let photo = card.prop("PHOTO").and_then(photo);
        for e in card.props_named("EMAIL") {
            let email = e.text().trim().to_string();
            if email.contains('@') && !email.chars().any(char::is_whitespace) {
                out.push(Contact { name: name.clone(), email, photo: photo.clone(), score: weight });
            }
        }
    }
    out
}

/// Quem aparece nos enviados (primeiro destinatário de cada e-mail), 3 pontos por vez.
pub fn contacts_from_sent(sent: &[crate::gmail::MessageSummary]) -> Vec<Contact> {
    sent.iter()
        .filter_map(|m| m.to.as_ref())
        .filter(|to| to.email.contains('@'))
        .map(|to| Contact { name: non_empty(to.name.clone()), email: to.email.trim().to_string(), photo: None, score: 3 })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dav::parse_multistatus;

    #[test]
    fn acha_so_os_catalogos_de_enderecos() {
        let xml = r#"<multistatus xmlns="DAV:">
 <response><href>/123/carddavhome/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/123/carddavhome/card/</href><propstat><prop><resourcetype><collection/><addressbook xmlns="urn:ietf:params:xml:ns:carddav"/></resourcetype><displayname>Contatos</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>"#;
        let books = parse_addressbooks(&parse_multistatus(xml).unwrap(), "https://p52-contacts.icloud.com/123/carddavhome/");
        assert_eq!(books, ["https://p52-contacts.icloud.com/123/carddavhome/card/"]);
    }

    #[test]
    fn um_contato_por_email_com_nome_e_peso() {
        let text = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Souza;Ana;;;\r\nFN:Ana Souza\r\nitem1.EMAIL;type=INTERNET;type=pref:ana@x.com\r\nEMAIL;type=INTERNET;type=WORK:ana@trabalho.com\r\nEND:VCARD\r\n";
        let list = parse_vcards(text, 5);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name.as_deref(), Some("Ana Souza"));
        assert_eq!(list[0].email, "ana@x.com");
        assert_eq!(list[1].email, "ana@trabalho.com");
        assert!(list.iter().all(|c| c.score == 5 && c.photo.is_none()));
    }

    #[test]
    fn sem_fn_usa_o_n_ou_a_empresa_e_sem_email_fica_de_fora() {
        let text = "BEGIN:VCARD\nVERSION:3.0\nN:Lima;Rafael;;;\nEMAIL:rafael@x.com\nEND:VCARD\n\
BEGIN:VCARD\nVERSION:3.0\nFN:\nORG:Padaria Pão Bom;\nEMAIL:contato@padaria.com\nEND:VCARD\n\
BEGIN:VCARD\nVERSION:3.0\nFN:Sem e-mail\nTEL:+5511999999999\nEND:VCARD\n";
        let list = parse_vcards(text, 5);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name.as_deref(), Some("Rafael Lima"));
        assert_eq!(list[1].name.as_deref(), Some("Padaria Pão Bom"));
    }

    #[test]
    fn foto_pequena_em_base64_vira_data_url() {
        let text = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Bia\r\nEMAIL:bia@y.com\r\nPHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRg\r\n ABAQ==\r\nEND:VCARD\r\n";
        let c = &parse_vcards(text, 5)[0];
        assert_eq!(c.photo.as_deref(), Some("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=="));
    }

    #[test]
    fn foto_grande_ou_estranha_fica_de_fora() {
        let big = "A".repeat(60_000);
        let text = format!("BEGIN:VCARD\r\nFN:Caio\r\nEMAIL:caio@z.com\r\nPHOTO;ENCODING=b;TYPE=PNG:{big}\r\nEND:VCARD\r\n");
        assert_eq!(parse_vcards(&text, 5)[0].photo, None);
        let odd = "BEGIN:VCARD\r\nFN:D\r\nEMAIL:d@z.com\r\nPHOTO;ENCODING=b;TYPE=JPEG:abc\"><script>\r\nEND:VCARD\r\n";
        assert_eq!(parse_vcards(odd, 5)[0].photo, None);
        let svg = "BEGIN:VCARD\r\nFN:E\r\nEMAIL:e@z.com\r\nPHOTO:data:image/svg+xml;base64,PHN2Zz4=\r\nEND:VCARD\r\n";
        assert_eq!(parse_vcards(svg, 5)[0].photo, None);
    }

    #[test]
    fn foto_no_formato_do_vcard_4_e_por_link() {
        let v4 = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:F\r\nEMAIL:f@z.com\r\nPHOTO:data:image/png;base64,iVBORw0KGgo=\r\nEND:VCARD\r\n";
        assert_eq!(parse_vcards(v4, 5)[0].photo.as_deref(), Some("data:image/png;base64,iVBORw0KGgo="));
        let uri = "BEGIN:VCARD\r\nFN:G\r\nEMAIL:g@z.com\r\nPHOTO;VALUE=uri:https://exemplo.com/g.jpg\r\nEND:VCARD\r\n";
        assert_eq!(parse_vcards(uri, 5)[0].photo.as_deref(), Some("https://exemplo.com/g.jpg"));
        // as fotos guardadas no iCloud pedem senha: não adianta mostrar o link
        let icloud = "BEGIN:VCARD\r\nFN:H\r\nEMAIL:h@z.com\r\nPHOTO;VALUE=uri:https://p52-contacts.icloud.com/123/photo.jpg\r\nEND:VCARD\r\n";
        assert_eq!(parse_vcards(icloud, 5)[0].photo, None);
    }

    #[test]
    fn le_os_cartoes_da_resposta_do_relatorio() {
        let xml = "<multistatus xmlns=\"DAV:\"><response><href>/123/carddavhome/card/1.vcf</href><propstat><prop><getetag>\"e1\"</getetag>\
<address-data xmlns=\"urn:ietf:params:xml:ns:carddav\">BEGIN:VCARD&#13;\nVERSION:3.0&#13;\nFN:Ana&#13;\nEMAIL:ana@x.com&#13;\nEND:VCARD&#13;\n</address-data></prop>\
<status>HTTP/1.1 200 OK</status></propstat></response>\
<response><href>/123/carddavhome/card/2.vcf</href><propstat><prop><getetag>\"e2\"</getetag><resourcetype/></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>";
        let r = parse_multistatus(xml).unwrap();
        let list = contacts_from_responses(&r, 5);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].email, "ana@x.com");
        assert_eq!(card_hrefs(&r), ["/123/carddavhome/card/1.vcf", "/123/carddavhome/card/2.vcf"]);
    }

    #[test]
    fn enviados_viram_contatos_com_peso_3() {
        let m = |name: &str, email: &str| crate::gmail::MessageSummary {
            id: "1".into(),
            thread_id: "t".into(),
            from: crate::gmail::Sender { name: "Eu".into(), email: "eu@icloud.com".into() },
            to: Some(crate::gmail::Sender { name: name.into(), email: email.into() }),
            recipients: vec![],
            cc: vec![],
            reply_to: None,
            initials: String::new(),
            subject: String::new(),
            preview: String::new(),
            date: String::new(),
            internal_date: 0,
            unread: false,
            starred: false,
            has_attachment: false,
        };
        let list = contacts_from_sent(&[m("Ana", "ana@x.com"), m("", "bia@y.com"), m("x", "sem-arroba")]);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name.as_deref(), Some("Ana"));
        assert_eq!(list[1].name, None);
        assert!(list.iter().all(|c| c.score == 3));
    }
}
