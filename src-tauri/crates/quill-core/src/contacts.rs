//! Sugestões de destinatário como no Gmail: contatos do Google (inclusive "Outros contatos",
//! que o Gmail cria sozinho para quem você já escreveu) somados a quem aparece nos seus enviados.

use serde::{Deserialize, Serialize};

pub const PEOPLE_API: &str = "https://people.googleapis.com/v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub name: Option<String>,
    pub email: String,
    pub photo: Option<String>,
    /// quanto maior, mais cedo aparece na sugestão
    pub score: u32,
}

/// Lê uma página de `people.connections.list` ou `otherContacts.list`.
/// Devolve (contatos, próxima página). Fotos genéricas (a letra colorida do Google) ficam de fora.
pub fn parse_people(json: &str, weight: u32) -> Result<(Vec<Contact>, Option<String>), String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Page {
        #[serde(default)]
        connections: Vec<Person>,
        #[serde(default)]
        other_contacts: Vec<Person>,
        next_page_token: Option<String>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Person {
        #[serde(default)]
        names: Vec<Name>,
        #[serde(default)]
        email_addresses: Vec<Email>,
        #[serde(default)]
        photos: Vec<Photo>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Name {
        display_name: Option<String>,
    }
    #[derive(Deserialize)]
    struct Email {
        value: Option<String>,
    }
    #[derive(Deserialize)]
    struct Photo {
        url: Option<String>,
        #[serde(default)]
        default: bool,
    }
    let page: Page = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for p in page.connections.into_iter().chain(page.other_contacts) {
        let name = p.names.into_iter().find_map(|n| n.display_name).filter(|n| !n.trim().is_empty());
        let photo = p.photos.into_iter().find(|f| !f.default).and_then(|f| f.url);
        for e in p.email_addresses.into_iter().filter_map(|e| e.value) {
            if e.contains('@') {
                out.push(Contact { name: name.clone(), email: e.trim().to_string(), photo: photo.clone(), score: weight });
            }
        }
    }
    Ok((out, page.next_page_token))
}

/// Separa um cabeçalho To/Cc com vários endereços: `"Silva, Ana" <ana@x.com>, bia@y.com`.
pub fn parse_address_list(header: &str) -> Vec<(Option<String>, String)> {
    let mut parts = Vec::new();
    let (mut cur, mut quoted, mut angle) = (String::new(), false, false);
    for ch in header.chars() {
        match ch {
            '"' => {
                quoted = !quoted;
                cur.push(ch);
            }
            '<' if !quoted => {
                angle = true;
                cur.push(ch);
            }
            '>' if !quoted => {
                angle = false;
                cur.push(ch);
            }
            ',' | ';' if !quoted && !angle => parts.push(std::mem::take(&mut cur)),
            _ => cur.push(ch),
        }
    }
    parts.push(cur);
    parts
        .into_iter()
        .filter_map(|p| {
            let p = p.trim();
            if p.is_empty() {
                return None;
            }
            if let (Some(a), Some(b)) = (p.rfind('<'), p.rfind('>')) {
                let email = p[a + 1..b].trim().to_string();
                let name = p[..a].trim().trim_matches('"').trim().to_string();
                return email.contains('@').then(|| (if name.is_empty() { None } else { Some(name) }, email));
            }
            p.contains('@').then(|| (None, p.trim_matches('"').to_string()))
        })
        .collect()
}

/// Junta as fontes sem repetir (pelo e-mail), somando a pontuação; guarda o melhor nome e a foto.
/// Sai em ordem: mais pontos primeiro, depois por nome.
pub fn merge_contacts(lists: Vec<Vec<Contact>>, own_emails: &[String]) -> Vec<Contact> {
    let own: Vec<String> = own_emails.iter().map(|e| e.to_lowercase()).collect();
    let mut by: std::collections::HashMap<String, Contact> = std::collections::HashMap::new();
    for c in lists.into_iter().flatten() {
        let key = c.email.to_lowercase();
        if own.contains(&key) || ["noreply", "no-reply", "notreply", "not-reply", "mailer-daemon"].iter().any(|n| key.contains(n)) {
            continue;
        }
        by.entry(key)
            .and_modify(|e| {
                e.score += c.score;
                if e.name.is_none() {
                    e.name = c.name.clone();
                }
                if e.photo.is_none() {
                    e.photo = c.photo.clone();
                }
            })
            .or_insert(c);
    }
    let mut out: Vec<Contact> = by.into_values().collect();
    out.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.clone().unwrap_or_default().cmp(&b.name.clone().unwrap_or_default())));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_contatos_e_outros_contatos_sem_foto_generica() {
        let json = r#"{"otherContacts":[
            {"names":[{"displayName":"Atendimento - Magazine Luiza"}],"emailAddresses":[{"value":"atendimento@magalu.com"}],"photos":[{"url":"https://lh3/letra","default":true}]},
            {"emailAddresses":[{"value":"maq_adv@hotmail.com"}]},
            {"names":[{"displayName":"Sem e-mail"}]}
        ],"nextPageToken":"p2"}"#;
        let (list, next) = parse_people(json, 1).unwrap();
        assert_eq!(next.as_deref(), Some("p2"));
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name.as_deref(), Some("Atendimento - Magazine Luiza"));
        assert_eq!(list[0].photo, None);
        assert_eq!(list[1].name, None);
        let (conn, _) = parse_people(
            r#"{"connections":[{"names":[{"displayName":"Davi"}],"emailAddresses":[{"value":"davi@inchurch.com.br"}],"photos":[{"url":"https://lh3/davi"}]}]}"#,
            5,
        )
        .unwrap();
        assert_eq!(conn[0].photo.as_deref(), Some("https://lh3/davi"));
        assert_eq!(conn[0].score, 5);
    }

    #[test]
    fn separa_lista_de_enderecos_com_virgula_no_nome() {
        let got = parse_address_list(r#""Silva, Ana" <ana@x.com>, bia@y.com; Carlos <carlos@z.com>, nada"#);
        assert_eq!(
            got,
            vec![
                (Some("Silva, Ana".into()), "ana@x.com".into()),
                (None, "bia@y.com".into()),
                (Some("Carlos".into()), "carlos@z.com".into()),
            ]
        );
    }

    #[test]
    fn junta_fontes_somando_pontos_e_tira_o_proprio_e_noreply() {
        let c = |name: Option<&str>, email: &str, photo: Option<&str>, score| Contact {
            name: name.map(String::from),
            email: email.into(),
            photo: photo.map(String::from),
            score,
        };
        let merged = merge_contacts(
            vec![
                vec![c(None, "Ana@x.com", None, 10), c(None, "eu@gmail.com", None, 10)],
                vec![c(Some("Ana Souza"), "ana@x.com", Some("https://f"), 1), c(Some("Bia"), "bia@y.com", None, 1)],
                vec![c(None, "donotreply@match.indeed.com", None, 30)],
            ],
            &["EU@gmail.com".into()],
        );
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].email, "Ana@x.com");
        assert_eq!(merged[0].name.as_deref(), Some("Ana Souza"));
        assert_eq!(merged[0].photo.as_deref(), Some("https://f"));
        assert_eq!(merged[0].score, 11);
        assert_eq!(merged[1].email, "bia@y.com");
    }
}
