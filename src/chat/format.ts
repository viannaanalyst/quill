/**
 * Formatação das mensagens do Google Chat, sem React e sem HTML: o texto vira uma árvore simples
 * que a tela monta com elementos (src/chat/chatText.tsx). Nada do texto da API vira HTML.
 *
 * Marcação do Google Chat (a mesma do `formattedText` da API):
 * - `*negrito*`, `_itálico_`, `~tachado~` (um dentro do outro vale);
 * - `` `código` `` e blocos com três crases;
 * - links `<url|texto>` e `<url>`, URLs soltas, menções `<users/123>` e `<users/all>`;
 * - listas com "- ", "* " ou "• " no começo da linha;
 * - emoji próprio da empresa como `:nome:` (a imagem vem da API).
 *
 * Arquivo sem dependências (os testes rodam direto no Node: npm test).
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "b" | "i" | "s"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "mention"; id: string }
  | { t: "emoji"; v: string }
  | { t: "custom"; name: string; url: string };

export type Block = { t: "p"; c: Inline[] } | { t: "pre"; v: string } | { t: "ul"; items: Inline[][] };

export interface CustomEmojiRef {
  /** como aparece no texto, com os dois-pontos (`:festa:`) */
  name: string;
  url: string;
}

const MARKS: Record<string, "b" | "i" | "s"> = { "*": "b", _: "i", "~": "s" };
const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);
const isSpace = (c: string | undefined) => !c || /\s/.test(c);

const LINK_RE = /^<((?:https?:\/\/|mailto:)[^|>\s]+)(?:\|([^>\n]+))?>/;
const MENTION_RE = /^<(users\/(?:all|[A-Za-z0-9_-]+))>/;
const URL_RE = /^https?:\/\/[^\s<>"']+/;
const LIST_RE = /^\s*[-*•]\s+(.*)$/;

/** Emoji inteiro: bandeira, tecla (1️⃣), ou figura com tom de pele e junções (👨‍👩‍👧). */
const EMOJI_RE =
  /[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*/gu;

/** Símbolos que são texto por padrão (©, ™, ↔) só viram emoji com o seletor de cor (U+FE0F). */
function isRealEmoji(m: string) {
  if ([...m].length > 1) return true;
  return /\p{Emoji_Presentation}/u.test(m);
}

/** Mostra o link sem o "https://" (como no desenho). */
export const shortUrl = (url: string) => url.replace(/^(https?:\/\/|mailto:)/, "").replace(/\/$/, "");

function pushText(out: Inline[], v: string) {
  if (!v) return;
  const last = out.at(-1);
  if (last?.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

/** Separa emojis (unicode e os da empresa) do texto. */
function splitEmoji(v: string, custom: CustomEmojiRef[], out: Inline[]) {
  if (custom.length) {
    const byName = new Map(custom.map((c) => [c.name, c]));
    const re = new RegExp(custom.map((c) => c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
    let last = 0;
    for (const m of v.matchAll(re)) {
      const i = m.index ?? 0;
      splitEmoji(v.slice(last, i), [], out);
      const c = byName.get(m[0])!;
      out.push({ t: "custom", name: c.name, url: c.url });
      last = i + m[0].length;
    }
    if (last > 0) {
      splitEmoji(v.slice(last), [], out);
      return;
    }
  }
  let last = 0;
  for (const m of v.matchAll(EMOJI_RE)) {
    if (!isRealEmoji(m[0])) continue;
    const i = m.index ?? 0;
    pushText(out, v.slice(last, i));
    out.push({ t: "emoji", v: m[0] });
    last = i + m[0].length;
  }
  pushText(out, v.slice(last));
}

/** Uma linha (ou o texto de um link) com a marcação de dentro. */
function inline(s: string, custom: CustomEmojiRef[], links = true): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) splitEmoji(buf, custom, out);
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "`") {
      const j = s.indexOf("`", i + 1);
      if (j > i + 1) {
        flush();
        out.push({ t: "code", v: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (c === "<") {
      const rest = s.slice(i);
      const link = links ? LINK_RE.exec(rest) : null;
      if (link) {
        flush();
        const href = link[1];
        out.push({ t: "link", href, c: link[2] ? inline(link[2], custom, false) : [{ t: "text", v: shortUrl(href) }] });
        i += link[0].length;
        continue;
      }
      const mention = MENTION_RE.exec(rest);
      if (mention) {
        flush();
        out.push({ t: "mention", id: mention[1] });
        i += mention[0].length;
        continue;
      }
    }
    if (c === "h" && links && !isWord(s[i - 1])) {
      const m = URL_RE.exec(s.slice(i));
      if (m) {
        let url = m[0];
        // pontuação no fim fica fora do link (o ")" só sai se não houver "(" no link)
        while (/[.,;:!?'"\]}]$/.test(url) || (url.endsWith(")") && !url.includes("("))) url = url.slice(0, -1);
        flush();
        out.push({ t: "link", href: url, c: [{ t: "text", v: shortUrl(url) }] });
        i += url.length;
        continue;
      }
    }
    const kind = MARKS[c];
    if (kind && !isWord(s[i - 1]) && !isSpace(s[i + 1]) && s[i + 1] !== c) {
      let j = i + 2;
      while (j < s.length && !(s[j] === c && !isSpace(s[j - 1]) && !isWord(s[j + 1]))) j++;
      if (j < s.length) {
        flush();
        out.push({ t: kind, c: inline(s.slice(i + 1, j), custom, links) });
        i = j + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** Texto sem blocos de código: parágrafos (linhas com quebra) e listas. */
function lines(seg: string, custom: CustomEmojiRef[], out: Block[]) {
  if (!seg) return;
  let para: Inline[] | null = null;
  let list: Inline[][] | null = null;
  for (const line of seg.split("\n")) {
    const item = LIST_RE.exec(line);
    if (item) {
      para = null;
      if (!list) out.push({ t: "ul", items: (list = []) });
      list.push(inline(item[1], custom));
      continue;
    }
    list = null;
    if (para) para.push({ t: "br" });
    else out.push({ t: "p", c: (para = []) });
    para.push(...inline(line, custom));
  }
}

/** Texto da mensagem (o `formattedText` ou o `text`) em blocos prontos para a tela. */
export function parseChat(text: string, custom: CustomEmojiRef[] = []): Block[] {
  const out: Block[] = [];
  let last = 0;
  for (const m of text.matchAll(/```([\s\S]*?)```/g)) {
    const i = m.index ?? 0;
    lines(text.slice(last, i).replace(/\n$/, ""), custom, out);
    out.push({ t: "pre", v: m[1].replace(/^\n/, "").replace(/\n$/, "") });
    last = i + m[0].length;
    if (text[last] === "\n") last++;
  }
  lines(text.slice(last), custom, out);
  return out;
}

function flat(list: Inline[], nameOf?: (id: string) => string | null | undefined): string {
  return list
    .map((n) => {
      switch (n.t) {
        case "text":
        case "code":
        case "emoji":
          return n.v;
        case "br":
          return "\n";
        case "custom":
          return n.name;
        case "mention":
          return `@${n.id === "users/all" ? "todos" : (nameOf?.(n.id) ?? "alguém")}`;
        default:
          return flat(n.c, nameOf);
      }
    })
    .join("");
}

/** Texto sem marcação (para a citação, a prévia da resposta e o "Copiar texto"). */
export function plainChat(text: string, nameOf?: (id: string) => string | null | undefined): string {
  return parseChat(text)
    .map((b) => (b.t === "pre" ? b.v : b.t === "ul" ? b.items.map((it) => flat(it, nameOf)).join("\n") : flat(b.c, nameOf)))
    .join("\n");
}

/** Mensagem só com 1 a 3 emojis (aparece maior, como no Google Chat). */
export function emojiOnly(blocks: Block[]): boolean {
  if (blocks.length !== 1 || blocks[0].t !== "p") return false;
  let n = 0;
  for (const node of blocks[0].c) {
    if (node.t === "emoji" || node.t === "custom") n++;
    else if (!(node.t === "text" && !node.v.trim())) return false;
  }
  return n >= 1 && n <= 3;
}
