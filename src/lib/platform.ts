/**
 * true quando o código roda dentro do app Tauri; false num navegador comum (prévia de design).
 * O endereço interno do app (`tauri://localhost` no Mac, `http://tauri.localhost` no Windows)
 * existe desde o primeiro instante; os objetos globais do Tauri podem chegar um pouco depois.
 */
export const isTauri =
  typeof window !== "undefined" &&
  (window.location.protocol === "tauri:" ||
    window.location.hostname === "tauri.localhost" ||
    "__TAURI_INTERNALS__" in window ||
    Boolean((globalThis as { isTauri?: boolean }).isTauri));

/** Parâmetros da URL, usados só na prévia: ?theme=dark, ?step=3, ?screen=inbox */
export const devParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");

export type ThemePref = "system" | "light" | "dark";

/** Aplica o tema: "system" segue o macOS; "light"/"dark" fixam. */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function applyDevTheme() {
  const theme = devParams.get("theme");
  if (theme === "dark" || theme === "light") {
    document.documentElement.dataset.theme = theme;
  }
}

/**
 * Marca a página quando roda dentro da janela nativa (ou simula com ?native=1 na prévia),
 * para ajustes que só fazem sentido com a moldura real do sistema.
 */
export function applyPlatformClass() {
  if (isTauri || devParams.get("native") === "1") {
    document.documentElement.classList.add("is-native");
  }
}
