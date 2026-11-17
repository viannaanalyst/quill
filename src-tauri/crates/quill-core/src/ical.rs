//! Leitura e escrita do formato de texto do iCalendar (RFC 5545) e do vCard (RFC 6350), que usam
//! as mesmas "linhas de conteúdo": `NOME;PARAM=valor:conteúdo`, dobradas em 75 bytes.
//! Guarda tudo (até o que o Quill não entende) para editar um evento sem perder nada.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Property {
    /// nome em maiúsculas, sem o grupo do vCard ("item1.EMAIL" vira "EMAIL")
    pub name: String,
    /// parâmetros na ordem em que vieram (nome em maiúsculas, valor sem aspas)
    pub params: Vec<(String, String)>,
    /// valor cru (com os escapes do formato)
    pub value: String,
}

impl Property {
    pub fn new(name: &str, value: &str) -> Self {
        Self { name: name.to_ascii_uppercase(), params: Vec::new(), value: value.to_string() }
    }

    pub fn with_param(mut self, name: &str, value: &str) -> Self {
        self.set_param(name, value);
        self
    }

    pub fn param(&self, name: &str) -> Option<&str> {
        self.params.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    pub fn set_param(&mut self, name: &str, value: &str) {
        match self.params.iter_mut().find(|(n, _)| n.eq_ignore_ascii_case(name)) {
            Some(p) => p.1 = value.to_string(),
            None => self.params.push((name.to_ascii_uppercase(), value.to_string())),
        }
    }

    pub fn remove_param(&mut self, name: &str) {
        self.params.retain(|(n, _)| !n.eq_ignore_ascii_case(name));
    }

    /// Valor de texto sem os escapes (`\n`, `\,`, `\;`, `\\`).
    pub fn text(&self) -> String {
        unescape(&self.value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Component {
    /// VCALENDAR, VEVENT, VALARM, VTIMEZONE, VCARD…
    pub name: String,
    pub props: Vec<Property>,
    pub children: Vec<Component>,
}

impl Component {
    pub fn new(name: &str) -> Self {
        Self { name: name.to_ascii_uppercase(), props: Vec::new(), children: Vec::new() }
    }

    pub fn prop(&self, name: &str) -> Option<&Property> {
        self.props.iter().find(|p| p.name.eq_ignore_ascii_case(name))
    }

    pub fn prop_mut(&mut self, name: &str) -> Option<&mut Property> {
        self.props.iter_mut().find(|p| p.name.eq_ignore_ascii_case(name))
    }

    pub fn props_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Property> + 'a {
        self.props.iter().filter(move |p| p.name.eq_ignore_ascii_case(name))
    }

    /// Texto (sem escapes) da primeira propriedade com esse nome.
    pub fn text(&self, name: &str) -> Option<String> {
        self.prop(name).map(Property::text)
    }

    /// Troca (ou cria) a propriedade, mantendo a posição da antiga.
    pub fn set(&mut self, prop: Property) {
        match self.props.iter().position(|p| p.name == prop.name) {
            Some(i) => {
                self.props[i] = prop;
                let name = self.props[i].name.clone();
                let mut seen = false;
                self.props.retain(|p| {
                    if p.name != name {
                        return true;
                    }
                    let keep = !seen;
                    seen = true;
                    keep
                });
            }
            None => self.props.push(prop),
        }
    }

    /// Texto simples com escape (SUMMARY, LOCATION, DESCRIPTION…).
    pub fn set_text(&mut self, name: &str, value: &str) {
        self.set(Property::new(name, &escape(value)));
    }

    pub fn remove(&mut self, name: &str) {
        self.props.retain(|p| !p.name.eq_ignore_ascii_case(name));
    }

    pub fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Component> + 'a {
        self.children.iter().filter(move |c| c.name.eq_ignore_ascii_case(name))
    }

    /// Texto do componente, com as linhas dobradas em 75 bytes e fim de linha CRLF.
    pub fn to_ics(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        push_folded(out, &format!("BEGIN:{}", self.name));
        for p in &self.props {
            push_folded(out, &property_line(p));
        }
        for c in &self.children {
            c.write(out);
        }
        push_folded(out, &format!("END:{}", self.name));
    }
}

fn property_line(p: &Property) -> String {
    let mut line = p.name.clone();
    for (n, v) in &p.params {
        line.push(';');
        line.push_str(n);
        line.push('=');
        if v.contains([':', ';', ',']) {
            line.push('"');
            line.push_str(&v.replace('"', "'"));
            line.push('"');
        } else {
            line.push_str(v);
        }
    }
    line.push(':');
    line.push_str(&p.value);
    line
}

/// Dobra em 75 bytes sem cortar um caractere UTF-8 no meio.
fn push_folded(out: &mut String, line: &str) {
    let mut width = 0;
    for ch in line.chars() {
        let len = ch.len_utf8();
        if width + len > 75 {
            out.push_str("\r\n ");
            width = 1;
        }
        out.push(ch);
        width += len;
    }
    out.push_str("\r\n");
}

pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            c => out.push(c),
        }
    }
    out
}

pub fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n' | 'N') => out.push('\n'),
            Some(c) => out.push(c),
            None => out.push('\\'),
        }
    }
    out
}

/// Junta as linhas dobradas (as que começam com espaço ou tab continuam a anterior).
fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(rest) = raw.strip_prefix([' ', '\t'])
            && let Some(last) = lines.last_mut()
        {
            last.push_str(rest);
            continue;
        }
        if !raw.trim().is_empty() {
            lines.push(raw.to_string());
        }
    }
    lines
}

/// Separa `NOME;P=v;Q="a:b":valor`. Linhas sem ":" são ignoradas.
fn parse_line(line: &str) -> Option<Property> {
    let mut quoted = false;
    let mut colon = None;
    for (i, ch) in line.char_indices() {
        match ch {
            '"' => quoted = !quoted,
            ':' if !quoted => {
                colon = Some(i);
                break;
            }
            _ => {}
        }
    }
    let colon = colon?;
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let mut parts = Vec::new();
    let (mut cur, mut quoted) = (String::new(), false);
    for ch in head.chars() {
        match ch {
            '"' => quoted = !quoted,
            ';' if !quoted => parts.push(std::mem::take(&mut cur)),
            c => cur.push(c),
        }
    }
    parts.push(cur);
    let mut parts = parts.into_iter();
    let name = parts.next()?;
    // grupo do vCard: "item1.EMAIL" → "EMAIL"
    let name = name.rsplit('.').next().unwrap_or(&name).trim().to_ascii_uppercase();
    if name.is_empty() {
        return None;
    }
    let params = parts
        .filter_map(|p| {
            let (n, v) = p.split_once('=').unwrap_or((&p, ""));
            let n = n.trim();
            (!n.is_empty()).then(|| (n.to_ascii_uppercase(), v.to_string()))
        })
        .collect();
    Some(Property { name, params, value: value.to_string() })
}

/// Lê um texto iCalendar ou vCard. Devolve os componentes do nível de cima
/// (normalmente um VCALENDAR, ou vários VCARD).
pub fn parse(text: &str) -> Vec<Component> {
    let mut stack: Vec<Component> = Vec::new();
    let mut top = Vec::new();
    for line in unfold(text) {
        let Some(p) = parse_line(&line) else { continue };
        match p.name.as_str() {
            "BEGIN" => stack.push(Component::new(p.value.trim())),
            "END" => {
                let Some(done) = stack.pop() else { continue };
                match stack.last_mut() {
                    Some(parent) => parent.children.push(done),
                    None => top.push(done),
                }
            }
            _ => {
                if let Some(cur) = stack.last_mut() {
                    cur.props.push(p);
                }
            }
        }
    }
    // texto cortado no meio: aproveita o que deu para ler
    while let Some(done) = stack.pop() {
        match stack.last_mut() {
            Some(parent) => parent.children.push(done),
            None => top.push(done),
        }
    }
    top
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple Inc.//iCloud 2.0//EN\r\nBEGIN:VEVENT\r\nUID:abc-1\r\nSUMMARY:Reunião\\, com café\\; e mais\r\nDESCRIPTION:Linha 1\\nLinha 2 com um texto bem comprido que passa de setenta e\r\n  cinco bytes por linha\r\nATTENDEE;CN=\"Silva, Ana\";PARTSTAT=ACCEPTED:mailto:ana@x.com\r\nX-QUALQUER;FOO=bar:mantido\r\nBEGIN:VALARM\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[test]
    fn le_componentes_propriedades_e_parametros() {
        let top = parse(SAMPLE);
        assert_eq!(top.len(), 1);
        let cal = &top[0];
        assert_eq!(cal.name, "VCALENDAR");
        let ev = &cal.children[0];
        assert_eq!(ev.name, "VEVENT");
        assert_eq!(ev.text("SUMMARY").unwrap(), "Reunião, com café; e mais");
        assert_eq!(ev.text("DESCRIPTION").unwrap(), "Linha 1\nLinha 2 com um texto bem comprido que passa de setenta e cinco bytes por linha");
        let att = ev.prop("ATTENDEE").unwrap();
        assert_eq!(att.param("cn"), Some("Silva, Ana"));
        assert_eq!(att.param("PARTSTAT"), Some("ACCEPTED"));
        assert_eq!(att.value, "mailto:ana@x.com");
        assert_eq!(ev.children[0].name, "VALARM");
    }

    #[test]
    fn escreve_de_volta_sem_perder_nada_e_dobra_linhas_longas() {
        let top = parse(SAMPLE);
        let out = top[0].to_ics();
        assert!(out.lines().all(|l| l.len() <= 76), "linha passou de 75 bytes: {out}");
        assert!(out.contains("X-QUALQUER;FOO=bar:mantido\r\n"));
        assert!(out.contains("ATTENDEE;CN=\"Silva, Ana\";PARTSTAT=ACCEPTED:mailto:ana@x.com\r\n"));
        assert_eq!(parse(&out), top);
    }

    #[test]
    fn dobra_sem_cortar_acento_no_meio() {
        let mut ev = Component::new("VEVENT");
        ev.set_text("SUMMARY", &"ção".repeat(40));
        let out = ev.to_ics();
        assert!(out.lines().all(|l| l.len() <= 76));
        assert_eq!(parse(&out)[0].text("SUMMARY").unwrap(), "ção".repeat(40));
    }

    #[test]
    fn escape_e_set_trocam_no_lugar() {
        let mut ev = Component::new("VEVENT");
        ev.set_text("SUMMARY", "a");
        ev.set_text("LOCATION", "Rua 1, sala 2; fundos\nSP");
        ev.set_text("SUMMARY", "b");
        assert_eq!(ev.props[0].name, "SUMMARY");
        assert_eq!(ev.props[0].value, "b");
        assert_eq!(ev.prop("LOCATION").unwrap().value, "Rua 1\\, sala 2\\; fundos\\nSP");
        ev.remove("location");
        assert!(ev.prop("LOCATION").is_none());
    }

    #[test]
    fn vcard_com_grupo_e_linhas_lf() {
        let text = "BEGIN:VCARD\nVERSION:3.0\nFN:Ana Souza\nitem1.EMAIL;type=INTERNET;type=pref:ana@x.com\nEND:VCARD\nBEGIN:VCARD\nFN:Bia\nEND:VCARD\n";
        let cards = parse(text);
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].prop("EMAIL").unwrap().value, "ana@x.com");
        assert_eq!(cards[1].text("FN").unwrap(), "Bia");
    }
}
