/**
 * Preferências simples do app. Por enquanto ficam no armazenamento local do WebView;
 * quando as contas reais entrarem, tokens e senhas vão para o cofre do sistema
 * (Chaves do macOS / Credential Manager do Windows), nunca aqui.
 */
const PREFIX = "quill.";

export function getPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function setPref<T>(key: string, value: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível: segue sem lembrar */
  }
}
