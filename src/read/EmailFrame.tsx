import { useEffect, useMemo, useRef, useState } from "react";
import { ImageIcon } from "../components/icons";
import { api } from "../lib/api";
import { isTauri } from "../lib/platform";
import { usePref } from "../lib/usePref";

/** Tira o que não deve rodar nem carregar sozinho (scripts, formulários, eventos) antes de mostrar. */
function sanitize(html: string): { html: string; hasRemote: boolean } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, frame, object, embed, form, meta[http-equiv], base, link[rel=import]").forEach((el) => el.remove());
  let hasRemote = false;
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if ((name === "href" || name === "src" || name === "action" || name === "xlink:href") && value.startsWith("javascript:")) el.removeAttribute(attr.name);
    }
    if (el.tagName === "IMG" && /^https?:/i.test(el.getAttribute("src") ?? "")) hasRemote = true;
    if (el.tagName === "A") el.setAttribute("target", "_blank");
  });
  if (/url\(\s*['"]?https?:/i.test(doc.documentElement.innerHTML)) hasRemote = true;
  return { html: doc.body.innerHTML, hasRemote };
}

/**
 * E-mail formatado (HTML) num quadro isolado: sem scripts, com as imagens externas
 * só quando a pessoa permite (Ajustes → Privacidade), e links abrindo no navegador.
 * O papel é branco mesmo no modo escuro, porque os e-mails são desenhados para fundo claro.
 */
export function EmailFrame({ html, inline }: { html: string; inline?: Record<string, () => Promise<string>> }) {
  const [blockImages] = usePref("blockRemoteImages", false);
  const [showOnce, setShowOnce] = useState(false);
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  // imagens embutidas (cid:): baixa cada uma e troca pelo conteúdo real
  const [cids, setCids] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!inline) return;
    const wanted = [...html.matchAll(/cid:([^"'\s)>]+)/gi)].map((m) => decodeURIComponent(m[1]));
    let alive = true;
    for (const cid of new Set(wanted)) {
      const load = inline[cid];
      if (!load) continue;
      load()
        .then((dataUrl) => alive && setCids((c) => ({ ...c, [cid]: dataUrl })))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [html, inline]);
  const withCids = useMemo(
    () => html.replace(/cid:([^"'\s)>]+)/gi, (all, id: string) => cids[decodeURIComponent(id)] ?? all),
    [html, cids],
  );
  const clean = useMemo(() => sanitize(withCids), [withCids]);
  const allowRemote = !blockImages || showOnce;

  const srcDoc = useMemo(() => {
    const imgs = allowRemote ? "img-src data: blob: https: http:;" : "img-src data: blob:;";
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imgs} style-src 'unsafe-inline'; font-src data: https:;">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#1b1c1e}
  body{padding:22px 24px;font:14.5px/1.6 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;overflow-wrap:anywhere;word-break:break-word}
  img{max-width:100%;height:auto}
  table{max-width:100%}
  a{color:#2f6fd1}
  pre{white-space:pre-wrap}
  blockquote{margin:0 0 0 10px;padding-left:12px;border-left:2px solid #d9d9de;color:#56585d}
</style></head><body>${clean.html}</body></html>`;
  }, [clean.html, allowRemote]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | undefined;
    const onLoad = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      const measure = () => setHeight(Math.max(60, doc.documentElement.scrollHeight));
      measure();
      ro?.disconnect();
      ro = new ResizeObserver(measure);
      ro.observe(doc.body);
      // links: abrem no navegador (no app) ou numa aba nova (prévia)
      if ((doc as Document & { __quill?: boolean }).__quill) return;
      (doc as Document & { __quill?: boolean }).__quill = true;
      doc.addEventListener("click", (e) => {
        const a = (e.target as Element | null)?.closest?.("a");
        const href = a?.getAttribute("href");
        if (!a || !href) return;
        e.preventDefault();
        if (href.startsWith("#")) return;
        if (isTauri) void api.openLink(href).catch(() => undefined);
        else window.open(href, "_blank", "noopener");
      });
    };
    frame.addEventListener("load", onLoad);
    // o quadro pode ter carregado antes deste efeito rodar: aí liga os cliques e a altura agora
    if (frame.contentDocument?.readyState === "complete" && frame.contentDocument.body?.childElementCount) onLoad();
    return () => {
      frame.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [srcDoc]);

  return (
    <div className="rd-html">
      {clean.hasRemote && !allowRemote && (
        <div className="rd-html-bar">
          <ImageIcon size={14} aria-hidden />
          Imagens externas bloqueadas para proteger sua privacidade.
          <button onClick={() => setShowOnce(true)}>Mostrar imagens</button>
        </div>
      )}
      <iframe
        ref={ref}
        className="rd-html-frame"
        title="Conteúdo do e-mail"
        // sem allow-scripts: nada roda dentro do e-mail; same-origin só para medir a altura e pegar os cliques
        sandbox="allow-same-origin allow-popups"
        srcDoc={srcDoc}
        style={{ height }}
      />
    </div>
  );
}
