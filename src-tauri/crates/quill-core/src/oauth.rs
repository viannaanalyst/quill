//! Login OAuth 2.0 para apps de computador (PKCE + endereço local 127.0.0.1).

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

/// Par "verificador / desafio" do PKCE (RFC 7636): prova que quem troca o código é quem pediu o login.
#[derive(Debug, Clone)]
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Pkce {
    pub fn from_verifier(verifier: &str) -> Self {
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Self { verifier: verifier.to_owned(), challenge }
    }

    /// Verificador aleatório de 64 caracteres (48 bytes em base64url).
    pub fn generate() -> Self {
        Self::from_verifier(&random_token(48))
    }
}

pub const GOOGLE_AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";

/// Dados para montar o endereço de login.
#[derive(Debug, Clone)]
pub struct AuthRequest {
    pub client_id: String,
    pub redirect_uri: String,
    pub scopes: Vec<String>,
    pub challenge: String,
    pub state: String,
    /// e-mail sugerido (ao reconectar uma conta)
    pub login_hint: Option<String>,
}

/// Endereço da página oficial de login do Google.
/// `access_type=offline` + `prompt=consent` garantem o refresh token (o app continua conectado).
pub fn google_auth_url(req: &AuthRequest) -> String {
    let mut url = url::Url::parse(GOOGLE_AUTH_ENDPOINT).expect("endereço fixo válido");
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("client_id", &req.client_id)
            .append_pair("redirect_uri", &req.redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", &req.scopes.join(" "))
            .append_pair("code_challenge", &req.challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &req.state)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
        if let Some(hint) = &req.login_hint {
            q.append_pair("login_hint", hint);
        }
    }
    url.into()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    /// a pessoa cancelou ou negou o acesso
    Denied,
    /// a resposta não é do pedido que fizemos (proteção contra falsificação)
    StateMismatch,
    /// pedido que não é o retorno do login (ex.: favicon)
    InvalidRedirect,
}

/// Lê a primeira linha do pedido HTTP que o navegador faz ao voltar para o app
/// (ex.: `GET /?state=…&code=… HTTP/1.1`) e devolve o código de autorização.
pub fn parse_redirect(request_line: &str, expected_state: &str) -> Result<String, AuthError> {
    let target = request_line.split_whitespace().nth(1).ok_or(AuthError::InvalidRedirect)?;
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| AuthError::InvalidRedirect)?;
    let params: std::collections::HashMap<String, String> = url.query_pairs().into_owned().collect();

    if params.contains_key("error") {
        if params.get("state").map(String::as_str) != Some(expected_state) {
            return Err(AuthError::StateMismatch);
        }
        return Err(AuthError::Denied);
    }
    let code = params.get("code").ok_or(AuthError::InvalidRedirect)?;
    if params.get("state").map(String::as_str) != Some(expected_state) {
        return Err(AuthError::StateMismatch);
    }
    Ok(code.clone())
}

fn form(pairs: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs).finish()
}

/// Corpo do pedido que troca o código de autorização pelos tokens.
pub fn code_exchange_form(client_id: &str, client_secret: &str, code: &str, verifier: &str, redirect_uri: &str) -> String {
    form(&[
        ("grant_type", "authorization_code"),
        ("code", code),
        ("code_verifier", verifier),
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("redirect_uri", redirect_uri),
    ])
}

/// Corpo do pedido que renova o token de acesso (ele vale ~1 hora).
pub fn refresh_form(client_id: &str, client_secret: &str, refresh_token: &str) -> String {
    form(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", client_id),
        ("client_secret", client_secret),
    ])
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    /// segundos até expirar
    pub expires_in: u64,
    /// só vem no primeiro login (ou com prompt=consent)
    pub refresh_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenError {
    pub code: String,
    pub description: String,
}

impl TokenError {
    /// O acesso foi revogado ou expirou: a conta precisa entrar de novo.
    pub fn needs_new_login(&self) -> bool {
        self.code == "invalid_grant"
    }
}

impl std::fmt::Display for TokenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.description)
    }
}

/// Lê a resposta do servidor de tokens (sucesso ou erro com o motivo do Google).
pub fn parse_token_response(body: &str) -> Result<TokenResponse, TokenError> {
    #[derive(serde::Deserialize)]
    struct ErrorBody {
        error: String,
        #[serde(default)]
        error_description: String,
    }
    if let Ok(err) = serde_json::from_str::<ErrorBody>(body) {
        return Err(TokenError { code: err.error, description: err.error_description });
    }
    serde_json::from_str::<TokenResponse>(body)
        .map_err(|e| TokenError { code: "invalid_response".into(), description: e.to_string() })
}

/// Texto aleatório seguro em base64url (usado no verificador e no `state`).
pub fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("gerador aleatório do sistema indisponível");
    URL_SAFE_NO_PAD.encode(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        let pkce = Pkce::from_verifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
        assert_eq!(pkce.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn generated_verifier_is_long_and_url_safe() {
        let pkce = Pkce::generate();
        assert!(pkce.verifier.len() >= 43 && pkce.verifier.len() <= 128);
        assert!(pkce.verifier.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(Pkce::generate().verifier, pkce.verifier);
    }

    fn query(url: &str) -> std::collections::HashMap<String, String> {
        url::Url::parse(url).unwrap().query_pairs().into_owned().collect()
    }

    #[test]
    fn google_auth_url_asks_for_offline_access_with_pkce() {
        let req = AuthRequest {
            client_id: "abc.apps.googleusercontent.com".into(),
            redirect_uri: "http://127.0.0.1:53682".into(),
            scopes: vec!["https://www.googleapis.com/auth/gmail.modify".into(), "openid".into()],
            challenge: "CHAL".into(),
            state: "STATE".into(),
            login_hint: None,
        };
        let url = google_auth_url(&req);
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        let q = query(&url);
        assert_eq!(q["client_id"], "abc.apps.googleusercontent.com");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:53682");
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["scope"], "https://www.googleapis.com/auth/gmail.modify openid");
        assert_eq!(q["code_challenge"], "CHAL");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["state"], "STATE");
        assert_eq!(q["access_type"], "offline");
        assert_eq!(q["prompt"], "consent");
        assert!(!q.contains_key("login_hint"));
    }

    #[test]
    fn redirect_with_code_and_matching_state_returns_code() {
        let got = parse_redirect("GET /?state=S1&code=4%2F0Abc&scope=x HTTP/1.1", "S1");
        assert_eq!(got, Ok("4/0Abc".to_string()));
    }

    #[test]
    fn redirect_with_other_state_is_rejected() {
        assert_eq!(parse_redirect("GET /?state=EVIL&code=x HTTP/1.1", "S1"), Err(AuthError::StateMismatch));
    }

    #[test]
    fn redirect_when_user_cancels_is_reported() {
        assert_eq!(parse_redirect("GET /?error=access_denied&state=S1 HTTP/1.1", "S1"), Err(AuthError::Denied));
    }

    #[test]
    fn code_exchange_form_sends_verifier_and_secret() {
        let form = code_exchange_form("id", "secret", "CODE", "VERIFIER", "http://127.0.0.1:1");
        let q: std::collections::HashMap<_, _> = url::form_urlencoded::parse(form.as_bytes()).into_owned().collect();
        assert_eq!(q["grant_type"], "authorization_code");
        assert_eq!(q["code"], "CODE");
        assert_eq!(q["code_verifier"], "VERIFIER");
        assert_eq!(q["client_id"], "id");
        assert_eq!(q["client_secret"], "secret");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:1");
    }

    #[test]
    fn refresh_form_uses_refresh_token() {
        let form = refresh_form("id", "secret", "1//RT");
        let q: std::collections::HashMap<_, _> = url::form_urlencoded::parse(form.as_bytes()).into_owned().collect();
        assert_eq!(q["grant_type"], "refresh_token");
        assert_eq!(q["refresh_token"], "1//RT");
    }

    #[test]
    fn token_response_is_parsed() {
        let t = parse_token_response(r#"{"access_token":"ya29.x","expires_in":3599,"refresh_token":"1//r","scope":"a b","token_type":"Bearer"}"#).unwrap();
        assert_eq!(t.access_token, "ya29.x");
        assert_eq!(t.expires_in, 3599);
        assert_eq!(t.refresh_token.as_deref(), Some("1//r"));
    }

    #[test]
    fn token_error_keeps_google_reason() {
        let e = parse_token_response(r#"{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"#).unwrap_err();
        assert_eq!(e, TokenError { code: "invalid_grant".into(), description: "Token has been expired or revoked.".into() });
        assert!(e.needs_new_login());
    }

    #[test]
    fn redirect_without_code_is_invalid() {
        assert_eq!(parse_redirect("GET /favicon.ico HTTP/1.1", "S1"), Err(AuthError::InvalidRedirect));
    }
}
