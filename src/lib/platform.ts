/** true quando o código roda dentro do app Tauri; false num navegador comum (prévia de desenvolvimento). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Parâmetros da URL, usados só na prévia: ?theme=dark, ?step=3, ?screen=inbox */
export const devParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");

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
