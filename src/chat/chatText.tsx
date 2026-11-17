import type { ReactNode } from "react";
import { api } from "../lib/api";
import { isTauri } from "../lib/platform";
import { toast } from "../components/Toasts";

/**
 * Texto de uma mensagem do Chat: links clicáveis (abrem no navegador) e a marcação do Google Chat
 * (*negrito*, _itálico_, ~riscado~, `código`). O texto vem cru da API; nada vira HTML.
 */

export function openLink(url: string) {
  if (!isTauri) {
    toast(`Prévia: abriria ${url}`);
    return;
  }
  api.openLink(url).catch(() => toast("Não consegui abrir o link.", "error"));
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/g;
const MARK_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g;

function marks(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK_RE)) {
    const i = m.index ?? 0;
    // só vale como marcação no começo de palavra (evita pegar snake_case e afins)
    if (i > 0 && /\w/.test(text[i - 1])) continue;
    if (i > last) out.push(text.slice(last, i));
    const inner = m[0].slice(1, -1);
    const k = `${keyBase}-${i}`;
    const c = m[0][0];
    out.push(c === "*" ? <strong key={k}>{inner}</strong> : c === "_" ? <em key={k}>{inner}</em> : c === "~" ? <s key={k}>{inner}</s> : <code key={k}>{inner}</code>);
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Mostra o link sem o "https://" (como no desenho). */
const shortUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

export function ChatText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(...marks(text.slice(last, i), `t${last}`));
    const url = m[0];
    out.push(
      <a
        key={`u${i}`}
        href={url}
        onClick={(e) => {
          e.preventDefault();
          openLink(url);
        }}
      >
        {shortUrl(url)}
      </a>,
    );
    last = i + url.length;
  }
  if (last < text.length) out.push(...marks(text.slice(last), `t${last}`));
  return <>{out}</>;
}
