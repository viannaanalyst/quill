//! WebDAV (base do CalDAV e do CardDAV): corpo dos pedidos e leitura das respostas `multistatus`.
//! Só a lógica; a rede fica em `dav_client.rs`.

use quick_xml::events::Event;

/// Uma propriedade lida de um `<prop>` (só as que vieram com status 200).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Prop {
    /// nome local, sem o namespace (`displayname`, `calendar-color`…)
    pub name: String,
    /// todo o texto de dentro, sem espaços nas pontas
    pub text: String,
    /// textos dos `<href>` de dentro
    pub hrefs: Vec<String>,
    /// nomes locais de todos os elementos de dentro (`calendar`, `write`…)
    pub elements: Vec<String>,
    /// atributos `name` dos `<comp>` (VEVENT, VTODO)
    pub comps: Vec<String>,
}

impl Prop {
    pub fn has(&self, element: &str) -> bool {
        self.elements.iter().any(|e| e == element)
    }
}

/// Um `<response>` do multistatus.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DavResponse {
    pub href: String,
    /// status direto da resposta (ex.: 404 de um item apagado)
    pub status: Option<u16>,
    pub props: Vec<Prop>,
}

impl DavResponse {
    pub fn prop(&self, name: &str) -> Option<&Prop> {
        self.props.iter().find(|p| p.name == name)
    }

    /// Texto da propriedade, se veio e não está vazio.
    pub fn text(&self, name: &str) -> Option<&str> {
        self.prop(name).map(|p| p.text.as_str()).filter(|t| !t.is_empty())
    }
}

/// "HTTP/1.1 200 OK" → 200.
fn status_code(line: &str) -> Option<u16> {
    line.split_whitespace().nth(1)?.parse().ok()
}

/// Lê uma resposta `207 Multi-Status`. Ignora namespaces (usa só o nome local).
pub fn parse_multistatus(xml: &str) -> Result<Vec<DavResponse>, String> {
    let mut reader = quick_xml::Reader::from_str(xml);
    // pilha: (nome local, texto direto)
    let mut stack: Vec<(String, String)> = Vec::new();
    let mut out = Vec::new();
    let mut resp: Option<DavResponse> = None;
    let mut propstat_props: Vec<Prop> = Vec::new();
    let mut propstat_status: Option<u16> = None;
    // propriedade aberta e a altura dela na pilha
    let mut prop: Option<(Prop, usize)> = None;
    let mut saw_root = false;

    loop {
        let event = reader.read_event().map_err(|e| format!("XML inválido: {e}"))?;
        let (start, end_now) = match &event {
            Event::Start(e) => (Some(e.clone()), false),
            Event::Empty(e) => (Some(e.clone()), true),
            _ => (None, false),
        };
        if let Some(e) = start {
            saw_root = true;
            let name = e.local_name().as_ref().to_string();
            let parent = stack.last().map(|(n, _)| n.as_str());
            if let Some((p, _)) = prop.as_mut() {
                p.elements.push(name.clone());
                if name == "comp" {
                    for a in e.attributes().flatten() {
                        if a.key.local_name().as_ref() == "name" {
                            p.comps.push(a.value.to_string());
                        }
                    }
                }
            } else if parent == Some("prop") {
                prop = Some((Prop { name: name.clone(), ..Prop::default() }, stack.len()));
            }
            match name.as_str() {
                "response" => resp = Some(DavResponse::default()),
                "propstat" => {
                    propstat_props.clear();
                    propstat_status = None;
                }
                _ => {}
            }
            stack.push((name, String::new()));
            if !end_now {
                continue;
            }
        }
        let text: Option<String> = match &event {
            Event::Text(t) => Some(t.xml10_content().into_owned()),
            Event::CData(t) => Some(t.clone().into_inner().into_owned()),
            Event::GeneralRef(r) => {
                let name = r.clone().into_inner().into_owned();
                match r.resolve_char_ref() {
                    Ok(Some(ch)) => Some(ch.to_string()),
                    _ => quick_xml::escape::resolve_predefined_entity(&name).map(str::to_string),
                }
            }
            _ => None,
        };
        if let Some(t) = text {
            if let Some((_, buf)) = stack.last_mut() {
                buf.push_str(&t);
            }
            if let Some((p, _)) = prop.as_mut() {
                p.text.push_str(&t);
            }
            continue;
        }
        let ended = matches!(event, Event::End(_)) || end_now;
        if ended {
            let Some((name, text)) = stack.pop() else { continue };
            let parent = stack.last().map(|(n, _)| n.as_str());
            if let Some((p, depth)) = prop.as_mut() {
                if name == "href" {
                    p.hrefs.push(text.trim().to_string());
                }
                if stack.len() == *depth {
                    let (mut done, _) = prop.take().expect("propriedade aberta");
                    done.text = done.text.trim().to_string();
                    propstat_props.push(done);
                }
                continue;
            }
            match (name.as_str(), parent) {
                ("href", Some("response")) => {
                    if let Some(r) = resp.as_mut() {
                        r.href = text.trim().to_string();
                    }
                }
                ("status", Some("response")) => {
                    if let Some(r) = resp.as_mut() {
                        r.status = status_code(&text);
                    }
                }
                ("status", Some("propstat")) => propstat_status = status_code(&text),
                ("propstat", _) => {
                    if propstat_status.is_none_or(|s| (200..300).contains(&s))
                        && let Some(r) = resp.as_mut()
                    {
                        r.props.append(&mut propstat_props);
                    }
                }
                ("response", _) => {
                    if let Some(r) = resp.take() {
                        out.push(r);
                    }
                }
                _ => {}
            }
            continue;
        }
        if matches!(event, Event::Eof) {
            break;
        }
    }
    if !saw_root {
        return Err("resposta vazia ou sem XML".into());
    }
    Ok(out)
}

/// Endereço absoluto de um `href` (relativo ou não) a partir de onde ele veio.
/// A porta padrão (`:443`) some, para os endereços serem sempre iguais.
pub fn resolve(base: &str, href: &str) -> Result<String, String> {
    let base = url::Url::parse(base).map_err(|e| e.to_string())?;
    let joined = base.join(href.trim()).map_err(|e| e.to_string())?;
    Ok(joined.to_string())
}

fn xml_escape(s: &str) -> String {
    quick_xml::escape::escape(s).into_owned()
}

/// PROPFIND Depth 0 em qualquer endereço: quem é a pessoa logada.
pub const PROPFIND_PRINCIPAL: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>"#;

/// PROPFIND Depth 0 no "principal": onde ficam as agendas e os endereços de e-mail da conta.
pub const PROPFIND_CALENDAR_HOME: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:prop><c:calendar-home-set/><c:calendar-user-address-set/><d:displayname/></d:prop></d:propfind>"#;

/// PROPFIND Depth 1 na pasta das agendas: nome, cor, ordem, tipo e permissão de cada uma.
pub const PROPFIND_CALENDARS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
<d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><a:calendar-order/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>"#;

/// PROPFIND Depth 0 no "principal" do CardDAV: onde ficam os contatos.
pub const PROPFIND_ADDRESSBOOK_HOME: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><card:addressbook-home-set/></d:prop></d:propfind>"#;

/// PROPFIND Depth 1 na pasta dos contatos: quais são catálogos de endereços.
pub const PROPFIND_ADDRESSBOOKS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>"#;

/// PROPFIND Depth 1 num catálogo: só os endereços dos cartões (para o multiget, se a consulta falhar).
pub const PROPFIND_ETAGS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>"#;

/// REPORT de eventos (VEVENT) que encostam no intervalo; datas em UTC (`AAAAMMDDTHHMMSSZ`).
pub fn calendar_query(start_utc: &str, end_utc: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:prop><d:getetag/><c:calendar-data/></d:prop>
<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="{}" end="{}"/></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>"#,
        xml_escape(start_utc),
        xml_escape(end_utc)
    )
}

/// REPORT dos cartões que têm e-mail.
pub const ADDRESSBOOK_QUERY: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
<d:prop><d:getetag/><card:address-data/></d:prop>
<card:filter><card:prop-filter name="EMAIL"/></card:filter>
</card:addressbook-query>"#;

/// REPORT de vários cartões pelo endereço.
pub fn addressbook_multiget(hrefs: &[String]) -> String {
    let list: String = hrefs.iter().map(|h| format!("<d:href>{}</d:href>", xml_escape(h))).collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<card:addressbook-multiget xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
<d:prop><d:getetag/><card:address-data/></d:prop>{list}</card:addressbook-multiget>"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Resposta real (encurtada) do iCloud ao PROPFIND da agenda: Depth 1 na pasta das agendas.
    const ICLOUD_CALENDARS: &str = r##"<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:">
 <response>
  <href>/123456789/calendars/</href>
  <propstat><prop><resourcetype><collection/></resourcetype><displayname>Agendas</displayname></prop><status>HTTP/1.1 200 OK</status></propstat>
  <propstat><prop><calendar-color xmlns="http://apple.com/ns/ical/"/><supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"/></prop><status>HTTP/1.1 404 Not Found</status></propstat>
 </response>
 <response>
  <href>/123456789/calendars/home/</href>
  <propstat><prop>
   <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
   <displayname>Casa</displayname>
   <calendar-color xmlns="http://apple.com/ns/ical/" symbolic-color="blue">#1BADF8FF</calendar-color>
   <calendar-order xmlns="http://apple.com/ns/ical/">2</calendar-order>
   <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VEVENT"/></supported-calendar-component-set>
   <current-user-privilege-set><privilege><read/></privilege><privilege><write/></privilege></current-user-privilege-set>
  </prop><status>HTTP/1.1 200 OK</status></propstat>
 </response>
 <response>
  <href>/123456789/calendars/tasks/</href>
  <propstat><prop>
   <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
   <displayname>Lembretes</displayname>
   <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VTODO"/></supported-calendar-component-set>
  </prop><status>HTTP/1.1 200 OK</status></propstat>
 </response>
 <response>
  <href>/123456789/calendars/work/</href>
  <propstat><prop>
   <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
   <displayname>Trabalho &amp; Igreja</displayname>
   <calendar-order xmlns="http://apple.com/ns/ical/">1</calendar-order>
   <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VEVENT"/><comp name="VTODO"/></supported-calendar-component-set>
   <current-user-privilege-set><privilege><read/></privilege><privilege><write-content/></privilege></current-user-privilege-set>
  </prop><status>HTTP/1.1 200 OK</status></propstat>
 </response>
 <response>
  <href>/123456789/calendars/inbox/</href>
  <propstat><prop><resourcetype><collection/><schedule-inbox xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat>
 </response>
</multistatus>"##;

    #[test]
    fn le_respostas_so_com_propriedades_que_deram_certo() {
        let list = parse_multistatus(ICLOUD_CALENDARS).unwrap();
        assert_eq!(list.len(), 5);
        assert_eq!(list[0].href, "/123456789/calendars/");
        assert!(list[0].prop("calendar-color").is_none(), "404 não conta");
        let home = &list[1];
        assert_eq!(home.prop("displayname").unwrap().text, "Casa");
        assert_eq!(home.prop("calendar-color").unwrap().text, "#1BADF8FF");
        assert!(home.prop("resourcetype").unwrap().has("calendar"));
        assert_eq!(home.prop("supported-calendar-component-set").unwrap().comps, ["VEVENT"]);
        assert!(home.prop("current-user-privilege-set").unwrap().has("write"));
        assert_eq!(list[3].prop("displayname").unwrap().text, "Trabalho & Igreja");
        assert!(list[4].prop("resourcetype").unwrap().has("schedule-inbox"));
    }

    #[test]
    fn le_hrefs_dentro_das_propriedades_com_prefixo() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
 <d:response><d:href>/123456789/principal/</d:href>
  <d:propstat><d:prop>
   <cal:calendar-home-set><d:href>https://p52-caldav.icloud.com:443/123456789/calendars/</d:href></cal:calendar-home-set>
   <cal:calendar-user-address-set><d:href>mailto:ana@icloud.com</d:href><d:href>/123456789/principal/</d:href><d:href>mailto:ana@me.com</d:href></cal:calendar-user-address-set>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
</d:multistatus>"#;
        let list = parse_multistatus(xml).unwrap();
        let r = &list[0];
        assert_eq!(r.prop("calendar-home-set").unwrap().hrefs, ["https://p52-caldav.icloud.com:443/123456789/calendars/"]);
        assert_eq!(r.prop("calendar-user-address-set").unwrap().hrefs.len(), 3);
    }

    #[test]
    fn le_dados_da_agenda_com_cdata_e_entidades() {
        let xml = "<multistatus xmlns=\"DAV:\"><response><href>/c/home/e1.ics</href><propstat><prop><getetag>\"C=12@U=34\"</getetag>\
<calendar-data xmlns=\"urn:ietf:params:xml:ns:caldav\"><![CDATA[BEGIN:VCALENDAR\r\nSUMMARY:A & B\r\nEND:VCALENDAR\r\n]]></calendar-data></prop>\
<status>HTTP/1.1 200 OK</status></propstat></response>\
<response><href>/c/home/e2.ics</href><propstat><prop><getetag>&quot;x&quot;</getetag><calendar-data xmlns=\"urn:ietf:params:xml:ns:caldav\">BEGIN:VCALENDAR&#13;\nSUMMARY:C &amp; D&#13;\nEND:VCALENDAR&#13;\n</calendar-data></prop>\
<status>HTTP/1.1 200 OK</status></propstat></response>\
<response><href>/c/home/gone.ics</href><status>HTTP/1.1 404 Not Found</status></response></multistatus>";
        let list = parse_multistatus(xml).unwrap();
        assert_eq!(list[0].prop("getetag").unwrap().text, "\"C=12@U=34\"");
        assert!(list[0].prop("calendar-data").unwrap().text.contains("SUMMARY:A & B\r\n"));
        assert_eq!(list[1].prop("getetag").unwrap().text, "\"x\"");
        assert!(list[1].prop("calendar-data").unwrap().text.contains("SUMMARY:C & D\r\n"));
        assert_eq!(list[2].status, Some(404));
    }

    #[test]
    fn xml_quebrado_vira_erro() {
        assert!(parse_multistatus("<multistatus><response>").is_err() || parse_multistatus("<multistatus><response>").unwrap().is_empty());
        assert!(parse_multistatus("isso não é xml <<<").is_err());
    }

    #[test]
    fn resolve_endereco_relativo_ao_servidor() {
        assert_eq!(resolve("https://caldav.icloud.com/", "/123/principal/").unwrap(), "https://caldav.icloud.com/123/principal/");
        assert_eq!(
            resolve("https://caldav.icloud.com/123/principal/", "https://p52-caldav.icloud.com:443/123/calendars/").unwrap(),
            "https://p52-caldav.icloud.com/123/calendars/"
        );
        assert_eq!(resolve("https://p52-caldav.icloud.com/123/calendars/", "home/").unwrap(), "https://p52-caldav.icloud.com/123/calendars/home/");
    }

    #[test]
    fn consulta_de_eventos_leva_o_intervalo_em_utc() {
        let body = calendar_query("20261101T000000Z", "20270101T000000Z");
        assert!(body.contains(r#"<c:time-range start="20261101T000000Z" end="20270101T000000Z"/>"#));
        assert!(body.contains(r#"<c:comp-filter name="VEVENT">"#));
        assert!(body.contains("<c:calendar-data/>"));
        assert!(body.contains("<d:getetag/>"));
    }

    #[test]
    fn pedido_de_varios_cartoes_lista_os_enderecos() {
        let body = addressbook_multiget(&["/a/card/1.vcf".into(), "/a/card/2&3.vcf".into()]);
        assert!(body.contains("<d:href>/a/card/1.vcf</d:href>"));
        assert!(body.contains("<d:href>/a/card/2&amp;3.vcf</d:href>"));
        assert!(body.contains("<card:address-data/>"));
    }
}
