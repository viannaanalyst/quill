/**
 * Formatação das mensagens do Google Chat, sem React e sem HTML: o texto vira uma árvore simples
 * que a tela monta com elementos (src/chat/chatText.tsx). Nada do texto da API vira HTML.
 *
 * Marcação do Google Chat (a mesma do `formattedText` da API):
 * - `*negrito*`, `_itálico_`, `~tachado~` (um dentro do outro vale);
 * - `` `código` `` e blocos com três crases;
 * - links `<url|texto>` e `<url>`, URLs soltas, menções `<users/123>`, `<users/all>` e
 *   `<chat-user data-user="users/123"></chat-user>`;
 * - listas com "- ", "* " ou "• " no começo da linha;
 * - emoji próprio da empresa como `:nome:` (a imagem vem da API).
 *
 * Markdown (notas do Gemini, bots e integrações mandam assim), aceito junto:
 * - `**negrito**`, `__negrito__`, `~~tachado~~` e links `[texto](url)`;
 * - títulos `#` a `######` viram uma linha em negrito;
 * - listas `1.`/`1)`, `-`, `*`, `+`, `•`, aninhadas pelo recuo;
 * - citação `> texto` e linha `---`;
 * - escapes (`\[`, `\*`, `\_`…) mostram só o caractere.
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

export interface ListItem {
  c: Inline[];
  /** subitens (lista aninhada pelo recuo) */
  sub?: ListBlock;
}
export type ListBlock = { t: "ul"; items: ListItem[] } | { t: "ol"; start: number; items: ListItem[] };

export type Block = { t: "p"; c: Inline[] } | { t: "pre"; v: string } | ListBlock | { t: "quote"; c: Block[] } | { t: "hr" };

export interface CustomEmojiRef {
  /** como aparece no texto, com os dois-pontos (`:festa:`) */
  name: string;
  url: string;
}

const MARKS: Record<string, "b" | "i" | "s"> = { "*": "b", _: "i", "~": "s" };
const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);
const isSpace = (c: string | undefined) => !c || /\s/.test(c);
/** Pontuação ASCII: depois de "\" vale o caractere literal (como no Markdown). */
const isEscapable = (c: string | undefined) => !!c && /^[!-/:-@[-`{-~]$/.test(c);
const SAFE_URL = /^(?:https?:\/\/|mailto:)\S+$/;

const LINK_RE = /^<((?:https?:\/\/|mailto:)[^|>\s]+)(?:\|([^>\n]+))?>/;
const MENTION_RE = /^<(users\/(?:all|[A-Za-z0-9_-]+))>/;
/** Menção no formato que alguns aplicativos do Google mandam: `<chat-user data-user="users/123"></chat-user>`. */
const CHAT_USER_RE = /^<chat-user\s+data-user=["'](users\/(?:all|[A-Za-z0-9_-]+))["']\s*>[^<]{0,200}<\/chat-user>/;
const URL_RE = /^https?:\/\/[^\s<>"']+/;
const UL_RE = /^([ \t]*)[-*+•][ \t]+(.*)$/;
const OL_RE = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/;
const HEADING_RE = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const QUOTE_RE = /^ {0,3}>[ \t]?(.*)$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

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

/** Fim de um link do Markdown `[texto](url)` que começa em `i`, ou null. */
function mdLink(s: string, i: number): { text: string; href: string; end: number } | null {
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    if (s[j] === "\\" && isEscapable(s[j + 1])) j++;
    else if (s[j] === "[") depth++;
    else if (s[j] === "]" && --depth === 0) break;
  }
  if (j >= s.length || s[j + 1] !== "(") return null;
  let k = j + 2;
  depth = 1;
  for (; k < s.length; k++) {
    if (s[k] === "(") depth++;
    else if (s[k] === ")" && --depth === 0) break;
    else if (/\s/.test(s[k])) return null;
  }
  if (k >= s.length) return null;
  const href = s.slice(j + 2, k);
  if (!SAFE_URL.test(href)) return null;
  return { text: s.slice(i + 1, j), href, end: k + 1 };
}

/** Uma linha (ou o texto de um link) com a marcação de dentro. */
function inline(s: string, custom: CustomEmojiRef[], links = true): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) splitEmoji(buf, custom, out);
    buf = "";
  };
  // a partir de onde já se sabe que não há fechamento para cada marca (evita varrer a linha de novo)
  const noClose: Record<string, number> = {};
  /** Fechamento da marca `c` (simples ou dupla) depois de `from`, pulando escapes e código. */
  const closing = (c: string, double: boolean, from: number) => {
    const key = c + (double ? "2" : "1");
    if (noClose[key] != null && from >= noClose[key]) return -1;
    for (let j = from; j < s.length; j++) {
      const ch = s[j];
      if (ch === "\\" && isEscapable(s[j + 1])) {
        j++;
        continue;
      }
      if (ch === "`") {
        const e = s.indexOf("`", j + 1);
        if (e > j + 1) {
          j = e;
          continue;
        }
      }
      if (ch !== c || isSpace(s[j - 1])) continue;
      if (double) {
        if (s[j + 1] !== c) continue;
        let k = j;
        while (s[k] === c) k++;
        if (c === "_" && isWord(s[k])) continue;
        return k - 2;
      }
      if (s[j + 1] === c || isWord(s[j + 1])) continue;
      return j;
    }
    noClose[key] = from;
    return -1;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && isEscapable(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const j = s.indexOf("`", i + 1);
      if (j > i + 1) {
        flush();
        out.push({ t: "code", v: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (c === "[" && links) {
      const md = mdLink(s, i);
      if (md) {
        flush();
        out.push({ t: "link", href: md.href, c: inline(md.text, custom, false) });
        i = md.end;
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
      const mention = MENTION_RE.exec(rest) ?? CHAT_USER_RE.exec(rest);
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
        // pontuação e marcação no fim ficam fora do link (o ")" só sai se não houver "(" no link)
        while (/[.,;:!?'"\]}*~]$/.test(url) || (url.endsWith(")") && !url.includes("("))) url = url.slice(0, -1);
        flush();
        out.push({ t: "link", href: url, c: [{ t: "text", v: shortUrl(url) }] });
        i += url.length;
        continue;
      }
    }
    const kind = MARKS[c];
    if (kind && s[i + 1] === c) {
      // marca dupla do Markdown: **negrito**, __negrito__, ~~tachado~~
      if (!isSpace(s[i + 2]) && !(c === "_" && isWord(s[i - 1]))) {
        const j = closing(c, true, i + 2);
        if (j > i + 2) {
          flush();
          out.push({ t: c === "~" ? "s" : "b", c: inline(s.slice(i + 2, j), custom, links) });
          i = j + 2;
          continue;
        }
      }
      // sem par: as duas ficam como texto (não sobra uma delas virando marca)
      buf += c + c;
      i += 2;
      continue;
    }
    if (kind && !isWord(s[i - 1]) && !isSpace(s[i + 1])) {
      const j = closing(c, false, i + 2);
      if (j > i + 1) {
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

/** Recuo da linha (tab vale 4 espaços). */
const indentOf = (ws: string) => [...ws].reduce((n, ch) => n + (ch === "\t" ? 4 : 1), 0);

type ListLine = { indent: number; ordered: boolean; start: number; text: string };
function listLine(line: string): ListLine | null {
  const ol = OL_RE.exec(line);
  if (ol) return { indent: indentOf(ol[1]), ordered: true, start: Number(ol[2]), text: ol[3] };
  const ul = UL_RE.exec(line);
  if (ul) return { indent: indentOf(ul[1]), ordered: false, start: 1, text: ul[2] };
  return null;
}
const newList = (l: ListLine): ListBlock => (l.ordered ? { t: "ol", start: l.start, items: [] } : { t: "ul", items: [] });

/** Texto sem blocos de código: parágrafos (linhas com quebra), listas, citações e separadores. */
function lines(seg: string, custom: CustomEmojiRef[], out: Block[]) {
  if (!seg) return;
  const all = seg.split("\n");
  let para: Inline[] | null = null;
  /** listas abertas, da mais de fora para a mais de dentro */
  let stack: { indent: number; list: ListBlock }[] = [];
  /** começa um bloco que não é parágrafo: a quebra no fim do parágrafo não desenha nada */
  const endPara = () => {
    while (para?.at(-1)?.t === "br") para.pop();
    para = null;
  };
  for (let n = 0; n < all.length; n++) {
    const line = all[n];
    if (!line.trim()) {
      // linha em branco: dentro da lista, segue se o próximo item vier logo depois
      if (stack.length) {
        const next = all.slice(n + 1).find((l) => l.trim());
        if (next != null && listLine(next)) continue;
        stack = [];
        continue;
      }
      if (para) para.push({ t: "br" });
      continue;
    }
    if (HR_RE.test(line)) {
      endPara();
      stack = [];
      out.push({ t: "hr" });
      continue;
    }
    const li = listLine(line);
    if (li) {
      endPara();
      while (stack.length > 1 && li.indent < stack.at(-1)!.indent - 1) stack.pop();
      const top = stack.at(-1);
      if (!top) {
        const list = newList(li);
        out.push(list);
        stack = [{ indent: li.indent, list }];
      } else if (li.indent > top.indent + 1) {
        const parent = top.list.items.at(-1)!;
        if (!parent.sub) parent.sub = newList(li);
        stack.push({ indent: li.indent, list: parent.sub });
      } else if (stack.length === 1 && top.list.t !== (li.ordered ? "ol" : "ul")) {
        // trocou de numerada para marcador (ou o contrário) no nível de fora: outra lista
        const list = newList(li);
        out.push(list);
        stack = [{ indent: li.indent, list }];
      }
      stack.at(-1)!.list.items.push({ c: inline(li.text, custom) });
      continue;
    }
    stack = [];
    const q = QUOTE_RE.exec(line);
    if (q) {
      endPara();
      const inner = [q[1]];
      while (n + 1 < all.length && QUOTE_RE.test(all[n + 1])) inner.push(QUOTE_RE.exec(all[++n])![1]);
      const c: Block[] = [];
      lines(inner.join("\n"), custom, c);
      out.push({ t: "quote", c });
      continue;
    }
    const h = HEADING_RE.exec(line);
    const content: Inline[] = h ? [{ t: "b", c: inline(h[1], custom) }] : inline(line, custom);
    if (para) para.push({ t: "br" });
    else out.push({ t: "p", c: (para = []) });
    para.push(...content);
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

function listText(l: ListBlock, nameOf?: (id: string) => string | null | undefined): string {
  return l.items.map((it) => flat(it.c, nameOf) + (it.sub ? `\n${listText(it.sub, nameOf)}` : "")).join("\n");
}
function blocksText(blocks: Block[], nameOf?: (id: string) => string | null | undefined): string {
  return blocks
    .map((b) => {
      switch (b.t) {
        case "pre":
          return b.v;
        case "hr":
          return "";
        case "quote":
          return blocksText(b.c, nameOf);
        case "p":
          return flat(b.c, nameOf);
        default:
          return listText(b, nameOf);
      }
    })
    .join("\n");
}

/** Texto sem marcação (para a citação, a prévia da resposta e o "Copiar texto"). */
export function plainChat(text: string, nameOf?: (id: string) => string | null | undefined): string {
  return blocksText(parseChat(text), nameOf);
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
