/**
 * Utilitários do editor de texto do Escrever: limpar HTML colado ou vindo de um rascunho,
 * completar endereços de link e converter texto simples em HTML.
 */

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto simples → parágrafos HTML (linhas em branco separam parágrafos). */
export function textToHtml(text: string): string {
  const paras = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  return paras.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

const EMAIL_RE = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$/;

/**
 * Completa o endereço digitado no link: e-mail vira mailto:, sem protocolo ganha https://.
 * Devolve null quando não parece um endereço válido (ou usa um protocolo perigoso).
 */
export function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (EMAIL_RE.test(v)) return `mailto:${v}`;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme === "mailto") return EMAIL_RE.test(v.slice(7).split("?")[0]) ? v : null;
    if (scheme === "tel") return v;
    if (scheme === "http" || scheme === "https") return /^https?:\/\/[^\s/]+\.[^\s]+/i.test(v) || /^https?:\/\/localhost/i.test(v) ? v : null;
    // "site.com:8080" não é protocolo
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+:\d/i.test(v)) return null;
  }
  if (/\s/.test(v) || !/^[^/]+\.[a-z]{2,}/i.test(v.replace(/^\/\//, ""))) return null;
  return `https://${v.replace(/^\/\//, "")}`;
}

/** Endereço seguro para manter num link colado. */
function safeHref(href: string | null): string | null {
  if (!href) return null;
  const v = href.trim();
  return /^(https?:|mailto:|tel:)/i.test(v) ? v : null;
}

const DROP = new Set([
  "SCRIPT", "STYLE", "META", "LINK", "TITLE", "HEAD", "IFRAME", "FRAME", "OBJECT", "EMBED", "SVG", "MATH",
  "TEMPLATE", "NOSCRIPT", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "VIDEO", "AUDIO", "CANVAS", "BASE",
]);
const KEEP = new Set([
  "P", "DIV", "BR", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "HR", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH",
  "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "A", "CODE", "SUB", "SUP", "IMG", "SPAN", "FONT",
  "H1", "H2", "H3", "H4", "H5", "H6",
]);
const HEADINGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
/** estilos mantidos num rascunho salvo (ao colar, só negrito/itálico/sublinhado/tachado viram tags) */
const DRAFT_STYLES = [
  "color", "background-color", "font-family", "font-size", "font-weight", "font-style", "text-decoration",
  "text-align", "margin-left", "padding-left", "border-left",
];

/**
 * Limpa um HTML antes de pôr no editor.
 * - "paste": mantém negrito, itálico, sublinhado, tachado, links, listas, citações e tabelas; tira fontes,
 *   tamanhos, cores e fundos (o texto fica com a cara do resto do e-mail).
 * - "draft": rascunho já salvo: mantém também os estilos de texto seguros (cor, fonte, tamanho, alinhamento).
 * Em ambos sai tudo que roda código (scripts, on*, javascript:).
 */
export function sanitizeHtml(html: string, mode: "paste" | "draft"): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = document.createElement("div");
  const walk = (from: Node, to: Node) => {
    for (const node of [...from.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) {
        to.appendChild(document.createTextNode(node.textContent ?? ""));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as HTMLElement;
      const tag = el.tagName.toUpperCase();
      if (DROP.has(tag)) continue;
      if (!KEEP.has(tag)) {
        walk(el, to);
        continue;
      }
      // estilos de texto que viram tags (negrito do Google Docs vem como <span style="font-weight:700">)
      const st = el.style;
      const weight = st.fontWeight;
      const bold = weight === "bold" || weight === "bolder" || Number(weight) >= 600;
      const notBold = weight === "normal" || (weight !== "" && Number(weight) > 0 && Number(weight) < 600);
      const italic = st.fontStyle === "italic";
      const deco = `${st.textDecoration} ${st.textDecorationLine}`;
      const wrappers: string[] = [];
      if (mode === "paste") {
        if (bold && tag !== "B" && tag !== "STRONG") wrappers.push("b");
        if (italic && tag !== "I" && tag !== "EM") wrappers.push("i");
        if (deco.includes("underline") && tag !== "U") wrappers.push("u");
        if (deco.includes("line-through") && tag !== "S") wrappers.push("s");
      }

      let target: Node = to;
      for (const w of wrappers) {
        const wrap = document.createElement(w);
        target.appendChild(wrap);
        target = wrap;
      }

      // ao colar: <span>/<font> somem; <b style="font-weight:normal"> (Google Docs) também; títulos viram negrito
      if (mode === "paste" && (tag === "SPAN" || tag === "FONT" || ((tag === "B" || tag === "STRONG") && notBold))) {
        walk(el, target);
        continue;
      }
      const name = tag === "STRIKE" || tag === "DEL" ? "S" : tag;
      if (mode === "paste" && HEADINGS.has(tag)) {
        const p = document.createElement("p");
        const b = document.createElement("b");
        p.appendChild(b);
        target.appendChild(p);
        walk(el, b);
        continue;
      }
      if (name === "IMG") {
        const src = el.getAttribute("src") ?? "";
        // só imagens da internet: as coladas como data: não aparecem no Gmail (essas viram anexo)
        if (!/^https?:\/\//i.test(src)) continue;
      }
      const copy = document.createElement(name.toLowerCase());
      if (name === "A") {
        const href = safeHref(el.getAttribute("href"));
        if (!href) {
          walk(el, target);
          continue;
        }
        copy.setAttribute("href", href);
      } else if (name === "IMG") {
        copy.setAttribute("src", el.getAttribute("src")!);
        copy.setAttribute("alt", el.getAttribute("alt") ?? "");
        for (const a of ["width", "height"]) {
          const v = el.getAttribute(a);
          if (v && /^\d+%?$/.test(v)) copy.setAttribute(a, v);
        }
      } else if (name === "TD" || name === "TH") {
        for (const a of ["colspan", "rowspan"]) {
          const v = el.getAttribute(a);
          if (v && /^\d+$/.test(v)) copy.setAttribute(a, v);
        }
      } else if (name === "OL") {
        const start = el.getAttribute("start");
        if (start && /^\d+$/.test(start)) copy.setAttribute("start", start);
      } else if (name === "FONT" && mode === "draft") {
        for (const a of ["color", "face", "size"]) {
          const v = el.getAttribute(a);
          if (v && /^[#\w\s,.'-]+$/.test(v)) copy.setAttribute(a, v);
        }
      }
      if (mode === "draft") {
        const keep = DRAFT_STYLES.map((p) => [p, st.getPropertyValue(p)] as const).filter(([, v]) => v && !/url\(|expression/i.test(v));
        if (keep.length) copy.setAttribute("style", keep.map(([p, v]) => `${p}:${v}`).join(";"));
      } else if ((name === "P" || name === "DIV") && /^(center|right|justify)$/.test(st.textAlign)) {
        copy.setAttribute("style", `text-align:${st.textAlign}`);
      }
      target.appendChild(copy);
      if (name !== "BR" && name !== "HR" && name !== "IMG") walk(el, copy);
    }
  };
  walk(doc.body, out);
  return out.innerHTML;
}
