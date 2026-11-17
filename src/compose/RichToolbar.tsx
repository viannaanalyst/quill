import * as Popover from "@radix-ui/react-popover";
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode, type RefObject } from "react";
import "./richToolbar.css";
import { Select } from "../components/Select";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Ban,
  Baseline,
  Bold,
  Code,
  Ellipsis,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  SeparatorHorizontal,
  Smile,
  Strikethrough,
  TextQuote,
  Underline,
  Undo2,
  Unlink,
} from "../components/icons";
import { escapeHtml, normalizeUrl, sanitizeHtml } from "./richText";
import { EMOJIS } from "../lib/emojis";

type Align = "left" | "center" | "right" | "full";

/** Barra no pé da caixa (resposta rápida): dicas e janelinhas abrem para cima. */
const BarPlace = createContext<{ up: boolean }>({ up: false });
type Icon = ComponentType<{ size?: number; "aria-hidden"?: boolean }>;

interface FmtState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  ol: boolean;
  ul: boolean;
  align: Align;
  font: string;
  size: string;
  link: boolean;
  quote: boolean;
  code: boolean;
}

const EMPTY: FmtState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  ol: false,
  ul: false,
  align: "left",
  font: "sans",
  size: "3",
  link: false,
  quote: false,
  code: false,
};

const FONTS = [
  { value: "sans", label: "Sans Serif", css: "sans-serif" },
  { value: "serif", label: "Serif", css: "'times new roman', serif" },
  { value: "mono", label: "Largura fixa", css: "monospace" },
  { value: "arial", label: "Arial", css: "arial, sans-serif" },
  { value: "georgia", label: "Georgia", css: "georgia, serif" },
  { value: "verdana", label: "Verdana", css: "verdana, sans-serif" },
  { value: "trebuchet", label: "Trebuchet", css: "'trebuchet ms', sans-serif" },
];

/** tamanhos do <font size> (o mesmo que o Gmail usa); 3 é o normal */
const SIZES = [
  { value: "2", label: "Pequeno" },
  { value: "3", label: "Normal" },
  { value: "4", label: "Grande" },
  { value: "6", label: "Enorme" },
];

const COLORS: [string, string][] = [
  ["#000000", "Preto"], ["#434343", "Grafite"], ["#666666", "Cinza-escuro"], ["#999999", "Cinza"],
  ["#b7b7b7", "Cinza-médio"], ["#cccccc", "Prata"], ["#efefef", "Gelo"], ["#ffffff", "Branco"],
  ["#d93025", "Vermelho"], ["#e8710a", "Laranja"], ["#f9ab00", "Amarelo"], ["#188038", "Verde"],
  ["#12b5cb", "Ciano"], ["#1a73e8", "Azul"], ["#9334e6", "Roxo"], ["#d01884", "Rosa"],
  ["#f6c7c3", "Vermelho-claro"], ["#fde2c4", "Laranja-claro"], ["#fff1a8", "Amarelo-claro"], ["#ccebd3", "Verde-claro"],
  ["#c4eef4", "Ciano-claro"], ["#cfe0fc", "Azul-claro"], ["#e6d6fa", "Lilás"], ["#f9cfe5", "Rosa-claro"],
];

const ALIGNS: { value: Align; label: string; icon: Icon; cmd: string }[] = [
  { value: "left", label: "Alinhar à esquerda", icon: AlignLeft, cmd: "justifyLeft" },
  { value: "center", label: "Centralizar", icon: AlignCenter, cmd: "justifyCenter" },
  { value: "right", label: "Alinhar à direita", icon: AlignRight, cmd: "justifyRight" },
  { value: "full", label: "Justificar", icon: AlignJustify, cmd: "justifyFull" },
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";
const SHIFT = isMac ? "⇧" : "Shift+";

function fontOf(v: string): string {
  const f = v.toLowerCase().replace(/["']/g, "");
  if (f.includes("georgia")) return "georgia";
  if (f.includes("verdana")) return "verdana";
  if (f.includes("trebuchet")) return "trebuchet";
  if (/^arial|,\s*arial/.test(f)) return "arial";
  if (/monospace|courier|menlo|monaco/.test(f)) return "mono";
  if (f.startsWith("times") || f === "serif") return "serif";
  return "sans";
}

function sizeOf(v: string): string {
  const n = Number(v);
  if (!n) return "3";
  if (n <= 2) return "2";
  if (n === 3) return "3";
  if (n <= 5) return "4";
  return "6";
}

const same = (a: FmtState, b: FmtState) => (Object.keys(a) as (keyof FmtState)[]).every((k) => a[k] === b[k]);

const query = (cmd: string) => {
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
};
const queryValue = (cmd: string) => {
  try {
    return String(document.queryCommandValue(cmd) ?? "");
  } catch {
    return "";
  }
};

const elementOf = (n: Node | null | undefined) => (n ? (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement) : null);

/** Nome melhor para uma imagem colada ("image.png" vira "imagem-colada-14-32-05.png"). */
function pastedName(f: File, i: number): File {
  if (f.name && !/^image\.\w+$/i.test(f.name)) return f;
  const ext = ({ "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic" } as Record<string, string>)[f.type] ?? "png";
  const t = new Date();
  const stamp = [t.getHours(), t.getMinutes(), t.getSeconds()].map((n) => String(n).padStart(2, "0")).join("-");
  return new File([f], `imagem-colada-${stamp}${i ? `-${i + 1}` : ""}.${ext}`, { type: f.type || "image/png" });
}

/** Desembrulha um elemento (os filhos ficam no lugar dele). */
function unwrap(el: Element) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function ToolButton({
  label,
  tip,
  icon: I,
  pressed,
  onClick,
}: {
  label: string;
  tip?: string;
  icon: Icon;
  pressed?: boolean;
  onClick: () => void;
}) {
  const { up } = useContext(BarPlace);
  return (
    <button
      type="button"
      className="btn ic cp-tb"
      aria-label={label}
      data-tip={tip ?? label}
      data-tip-pos={up ? "top" : undefined}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <I size={16} aria-hidden />
    </button>
  );
}

/** Botão da barra que abre uma janelinha (Radix Popover). Aberto com o mouse, o foco fica no texto. */
function ToolPopover({
  label,
  tip,
  icon: I,
  open,
  onOpenChange,
  pressed,
  className,
  children,
  onClosed,
  onOpened,
  align = "start",
}: {
  label: string;
  tip?: string;
  icon: Icon;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pressed?: boolean;
  className?: string;
  children: ReactNode;
  onClosed: () => void;
  onOpened?: (byPointer: boolean, e: Event) => void;
  align?: "start" | "center" | "end";
}) {
  const byPointer = useRef(false);
  const { up } = useContext(BarPlace);
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="btn ic cp-tb"
          aria-label={label}
          data-tip={tip ?? label}
          data-tip-pos={up ? "top" : undefined}
          data-active={pressed ? "" : undefined}
          onPointerDown={() => (byPointer.current = true)}
          onKeyDown={() => (byPointer.current = false)}
          onMouseDown={(e) => e.preventDefault()}
        >
          <I size={16} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`qp-content cp-pop ${className ?? ""}`}
          side={up ? "top" : "bottom"}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          aria-label={label}
          onOpenAutoFocus={(e) => {
            if (onOpened) onOpened(byPointer.current, e);
            // com o mouse o foco (e a seleção) continuam no texto; com o teclado, entra na janelinha
            else if (byPointer.current) e.preventDefault();
            byPointer.current = false;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onClosed();
          }}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MenuItem({ icon: I, label, hint, pressed, onClick }: { icon: Icon; label: string; hint?: string; pressed?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="cp-menu-item" aria-pressed={pressed} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <I size={16} aria-hidden />
      <span>{label}</span>
      {hint && <kbd className="cp-menu-hint">{hint}</kbd>}
    </button>
  );
}

function Palette({ title, current, onPick }: { title: string; current?: string; onPick: (c: string | null) => void }) {
  return (
    <div className="cp-palette" role="group" aria-label={title}>
      <div className="cp-pop-head">
        <span className="cp-pop-title">{title}</span>
        <button type="button" className="cp-nocolor" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(null)}>
          <Ban size={13} aria-hidden />
          Sem cor
        </button>
      </div>
      <div className="cp-swatches">
        {COLORS.map(([c, name]) => (
          <button
            key={c}
            type="button"
            className="cp-swatch"
            style={{ background: c }}
            aria-label={name}
            aria-pressed={current === c}
            data-tip={name}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
          />
        ))}
      </div>
    </div>
  );
}

/** "#rrggbb" a partir do "rgb(r, g, b)" que o navegador devolve. */
function hexOf(v: string): string | undefined {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(v);
  if (!m || m[4] === "0") return undefined;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Barra de formatação do Escrever (como a do Gmail): desfazer, fonte, tamanho, estilos, cores,
 * alinhamento, listas, recuo, link, emoji e "mais". Também cuida dos atalhos, do colar
 * (limpa estilos estranhos; imagem vira anexo) e mostra o estado da seleção.
 */
export function RichToolbar({
  editorRef,
  onImages,
  onEdited,
  compact = false,
  up = false,
}: {
  editorRef: RefObject<HTMLDivElement | null>;
  /** só o básico (negrito, itálico, sublinhado, listas, link e emoji), para a resposta rápida */
  compact?: boolean;
  /** dicas e janelinhas abrem para cima (barra perto do pé da janela) */
  up?: boolean;
  /** imagens coladas no texto (viram anexo) */
  onImages: (files: File[]) => void;
  /** mudança feita fora do evento input (ex.: tirar a cor) */
  onEdited: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const lastRange = useRef<Range | null>(null);
  const [fmt, setFmt] = useState<FmtState>(EMPTY);
  const [colors, setColors] = useState<{ fore?: string; back?: string }>({});
  const [pop, setPop] = useState<null | "color" | "align" | "more" | "link" | "emoji">(null);
  const [narrow, setNarrow] = useState(0);
  const selectFocus = useRef(0);

  // link
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const linkAnchor = useRef<HTMLAnchorElement | null>(null);
  const linkOriginal = useRef("");
  const textInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const ids = useId();

  const cb = useRef({ onImages, onEdited });
  useLayoutEffect(() => {
    cb.current = { onImages, onEdited };
  });

  const inEditor = (n: Node | null | undefined) => !!n && !!editorRef.current?.contains(n);

  /** Guarda a seleção atual quando ela está no texto do e-mail. */
  const remember = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (inEditor(r.commonAncestorContainer)) lastRange.current = r.cloneRange();
  };

  /** Volta o foco para o texto, com a seleção guardada. */
  const restore = () => {
    const ed = editorRef.current;
    const sel = window.getSelection();
    if (!ed || !sel) return false;
    const live = sel.rangeCount > 0 && inEditor(sel.getRangeAt(0).commonAncestorContainer);
    if (document.activeElement === ed && live) {
      remember();
      return true;
    }
    ed.focus({ preventScroll: true });
    const r = lastRange.current;
    sel.removeAllRanges();
    if (r && inEditor(r.commonAncestorContainer)) sel.addRange(r);
    else {
      const end = document.createRange();
      end.selectNodeContents(ed);
      end.collapse(false);
      sel.addRange(end);
    }
    return true;
  };

  const refresh = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const el = elementOf(lastRange.current?.startContainer);
    const within = (sel: string) => {
      const found = el?.closest(sel);
      return !!found && ed.contains(found) && found !== ed;
    };
    const next: FmtState = {
      bold: query("bold"),
      italic: query("italic"),
      underline: query("underline"),
      strike: query("strikeThrough"),
      ol: query("insertOrderedList"),
      ul: query("insertUnorderedList"),
      align: query("justifyCenter") ? "center" : query("justifyRight") ? "right" : query("justifyFull") ? "full" : "left",
      font: fontOf(queryValue("fontName")),
      size: sizeOf(queryValue("fontSize")),
      link: within("a"),
      quote: within("blockquote"),
      code: within("pre, code"),
    };
    setFmt((prev) => (same(prev, next) ? prev : next));
  };

  /** Roda um comando de edição no texto (execCommand é o caminho simples no WebView). */
  const exec = (cmd: string, value?: string) => {
    if (!restore()) return;
    document.execCommand(cmd, false, value);
    remember();
    refresh();
  };

  const withCss = (cmd: string, value: string) => {
    if (!restore()) return;
    document.execCommand("styleWithCSS", false, "true");
    const ok = document.execCommand(cmd, false, value);
    if (!ok && cmd === "hiliteColor") document.execCommand("backColor", false, value);
    document.execCommand("styleWithCSS", false, "false");
    remember();
    refresh();
  };

  /** "Sem cor": tira a cor (ou o destaque) do trecho selecionado. */
  const clearColor = (prop: "color" | "background-color") => {
    if (!restore()) return;
    const ed = editorRef.current!;
    const r = lastRange.current;
    if (!r) return;
    const found = new Set<HTMLElement>();
    for (let el = elementOf(r.commonAncestorContainer) as HTMLElement | null; el && el !== ed; el = el.parentElement) found.add(el);
    ed.querySelectorAll<HTMLElement>("[style], font[color]").forEach((x) => {
      if (r.intersectsNode(x)) found.add(x);
    });
    for (const x of found) {
      x.style.removeProperty(prop);
      if (prop === "background-color") x.style.removeProperty("background");
      if (prop === "color" && x.tagName === "FONT") x.removeAttribute("color");
      if (x.getAttribute("style") === "") x.removeAttribute("style");
    }
    cb.current.onEdited();
    refresh();
  };

  const pickColor = (kind: "fore" | "back", c: string | null) => {
    setPop(null);
    if (c === null) clearColor(kind === "fore" ? "color" : "background-color");
    else withCss(kind === "fore" ? "foreColor" : "hiliteColor", c);
  };

  const toggleQuote = () => {
    setPop(null);
    if (!restore()) return;
    const ed = editorRef.current!;
    const quote = elementOf(lastRange.current?.startContainer)?.closest("blockquote");
    if (quote && ed.contains(quote)) {
      document.execCommand("outdent");
      if (quote.isConnected && ed.contains(quote)) {
        unwrap(quote);
        cb.current.onEdited();
      }
    } else {
      document.execCommand("formatBlock", false, "blockquote");
      remember();
      const made = elementOf(lastRange.current?.startContainer)?.closest("blockquote") as HTMLElement | null;
      // estilo de citação que aparece igual no Gmail de quem recebe
      if (made && ed.contains(made)) made.setAttribute("style", "margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex");
    }
    remember();
    refresh();
  };

  const toggleCode = () => {
    setPop(null);
    if (!restore()) return;
    const ed = editorRef.current!;
    const el = elementOf(lastRange.current?.startContainer);
    const pre = el?.closest("pre");
    const code = el?.closest("code");
    const sel = window.getSelection();
    const text = sel?.toString() ?? "";
    if (pre && ed.contains(pre)) document.execCommand("formatBlock", false, "p");
    else if (code && ed.contains(code)) {
      unwrap(code);
      cb.current.onEdited();
    } else if (text && !text.includes("\n") && sel && sel.rangeCount) {
      // direto no texto: o insertHTML do Chrome troca o <code> por um <span> com o fundo do editor embutido
      const r = sel.getRangeAt(0);
      const el = document.createElement("code");
      el.style.fontFamily = "monospace";
      el.textContent = text;
      r.deleteContents();
      r.insertNode(el);
      r.setStartAfter(el);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      cb.current.onEdited();
    } else {
      document.execCommand("formatBlock", false, "pre");
      remember();
      const made = elementOf(lastRange.current?.startContainer)?.closest("pre") as HTMLElement | null;
      if (made && ed.contains(made)) made.setAttribute("style", "font-family:monospace;white-space:pre-wrap");
    }
    remember();
    refresh();
  };

  const clearFormatting = () => {
    setPop(null);
    exec("removeFormat");
    clearColor("background-color");
    clearColor("color");
  };

  // ---------- link ----------
  const openLink = () => {
    remember();
    const ed = editorRef.current;
    const r = lastRange.current;
    let a: HTMLAnchorElement | null = null;
    if (r && ed) {
      a = elementOf(r.startContainer)?.closest("a") ?? null;
      if (!a && !r.collapsed) a = (r.cloneContents().querySelector("a") && [...ed.querySelectorAll("a")].find((x) => r.intersectsNode(x))) || null;
      if (a && !ed.contains(a)) a = null;
    }
    linkAnchor.current = a;
    const selected = r?.toString() ?? "";
    const text = a ? (a.textContent ?? "") : selected;
    linkOriginal.current = text;
    setLinkText(text);
    const href = a?.getAttribute("href") ?? "";
    setLinkUrl(a ? href.replace(/^mailto:/i, "") : normalizeUrl(selected) && !/\s/.test(selected.trim()) ? selected.trim() : "");
    setLinkErr(null);
    setPop("link");
  };

  const applyLink = (e: FormEvent) => {
    e.preventDefault();
    const url = normalizeUrl(linkUrl);
    if (!url) {
      setLinkErr(linkUrl.trim() ? "Isso não parece um site nem um e-mail." : "Digite o endereço do link.");
      urlInput.current?.focus();
      return;
    }
    const text = linkText.trim() ? linkText : linkUrl.trim();
    setPop(null);
    if (!restore()) return;
    const sel = window.getSelection()!;
    const a = linkAnchor.current;
    const html = `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
    if (a && a.isConnected) {
      if (text === linkOriginal.current) {
        // só trocou o endereço: mantém a formatação de dentro do link
        a.setAttribute("href", url);
        cb.current.onEdited();
      } else {
        const r = document.createRange();
        r.selectNode(a);
        sel.removeAllRanges();
        sel.addRange(r);
        document.execCommand("insertHTML", false, html);
      }
    } else if (!sel.isCollapsed && text === linkOriginal.current) {
      document.execCommand("createLink", false, url);
    } else {
      document.execCommand("insertHTML", false, html);
    }
    remember();
    refresh();
  };

  const removeLink = () => {
    setPop(null);
    if (!restore()) return;
    const a = linkAnchor.current;
    if (a && a.isConnected) {
      unwrap(a);
      cb.current.onEdited();
    } else document.execCommand("unlink");
    remember();
    refresh();
  };

  const insertEmoji = (emoji: string) => {
    setPop(null);
    exec("insertText", emoji);
  };

  // ---------- seleção, atalhos e colar ----------
  const handlers = useRef({ remember, refresh, exec, openLink });
  useLayoutEffect(() => {
    handlers.current = { remember, refresh, exec, openLink };
  });

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const onSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !ed.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
      handlers.current.remember();
      handlers.current.refresh();
      // cor do trecho, para marcar a bolinha escolhida
      const el = elementOf(sel.getRangeAt(0).startContainer);
      if (el && ed.contains(el)) {
        let back: string | undefined;
        for (let x: HTMLElement | null = el as HTMLElement; x && x !== ed && !back; x = x.parentElement) back = hexOf(x.style.backgroundColor);
        const fore = el.closest("[style*='color'], font[color]") && el !== ed ? hexOf(getComputedStyle(el).color) : undefined;
        setColors((prev) => (prev.fore === fore && prev.back === back ? prev : { fore, back }));
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      const h = handlers.current;
      let done = true;
      if (!e.shiftKey && k === "b") h.exec("bold");
      else if (!e.shiftKey && k === "i") h.exec("italic");
      else if (!e.shiftKey && k === "u") h.exec("underline");
      else if (!e.shiftKey && k === "k") h.openLink();
      else if (k === "z") h.exec(e.shiftKey ? "redo" : "undo");
      else if (!isMac && !e.shiftKey && k === "y") h.exec("redo");
      else if (e.shiftKey && e.code === "Digit7") h.exec("insertOrderedList");
      else if (e.shiftKey && e.code === "Digit8") h.exec("insertUnorderedList");
      else if (e.shiftKey && k === "x") h.exec("strikeThrough");
      else done = false;
      if (done) {
        e.preventDefault();
        // ⌘K aqui é link, não a busca geral
        e.stopPropagation();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const plain = dt.getData("text/plain");
      const images: File[] = [...dt.files].filter((f) => f.type.startsWith("image/"));
      if (!images.length) {
        for (const it of dt.items) {
          if (it.kind === "file" && it.type.startsWith("image/")) {
            const f = it.getAsFile();
            if (f) images.push(f);
          }
        }
      }
      // Word e Excel mandam também uma imagem do texto: com texto junto, cola o texto
      if (images.length && !plain.trim()) {
        e.preventDefault();
        cb.current.onImages(images.map(pastedName));
        return;
      }
      const html = dt.getData("text/html");
      if (html) {
        e.preventDefault();
        const clean = sanitizeHtml(html, "paste");
        if (clean.replace(/<[^>]*>/g, "").trim() || /<(img|hr)/i.test(clean)) document.execCommand("insertHTML", false, clean);
        else if (plain) document.execCommand("insertText", false, plain);
      }
    };
    document.addEventListener("selectionchange", onSelection);
    ed.addEventListener("keydown", onKey);
    ed.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      ed.removeEventListener("keydown", onKey);
      ed.removeEventListener("paste", onPaste);
    };
  }, [editorRef]);

  // com pouco espaço, alguns botões vão para o "Mais"
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setNarrow(w >= 750 ? 0 : w >= 655 ? 1 : 2);
    });
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  /** Ao fechar uma janelinha, o foco volta para o texto (se não foi para outro campo). */
  const backToText = () => {
    const ae = document.activeElement;
    if (!ae || ae === document.body || barRef.current?.contains(ae)) restore();
  };

  /**
   * Fonte e tamanho usam o Select do Quill (Radix), que puxa o foco para ele. Depois de escolher,
   * aplica no texto e, quando o menu devolve o foco ao botão, leva de volta para o texto.
   */
  const fromSelect = (apply: () => void) => {
    selectFocus.current = Date.now();
    window.setTimeout(apply, 0);
  };
  const onSelectFocus = () => {
    if (Date.now() - selectFocus.current < 600) {
      selectFocus.current = 0;
      restore();
    }
  };

  const alignIcon = ALIGNS.find((a) => a.value === fmt.align)!.icon;
  const togglePop = (name: NonNullable<typeof pop>) => (v: boolean) => setPop(v ? name : null);

  const linkPop = (
      <Popover.Root open={pop === "link"} onOpenChange={(v) => (v ? openLink() : setPop(null))}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="btn ic cp-tb"
            aria-label="Link"
            data-tip={`Link ${MOD}K`}
            data-tip-pos={up ? "top" : undefined}
            data-active={fmt.link ? "" : undefined}
            onMouseDown={(e) => e.preventDefault()}
          >
            <Link size={16} aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="qp-content cp-pop cp-link-pop"
            side={up ? "top" : "bottom"}
            align="start"
            sideOffset={8}
            collisionPadding={12}
            aria-label={linkAnchor.current ? "Editar link" : "Inserir link"}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (linkText ? urlInput : textInput).current?.focus();
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              backToText();
            }}
          >
            <form onSubmit={applyLink} noValidate>
              <label className="cp-link-label" htmlFor={`${ids}-text`}>Texto</label>
              <input
                ref={textInput}
                id={`${ids}-text`}
                className="cp-link-input"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                placeholder="Texto que aparece no e-mail"
                autoComplete="off"
              />
              <label className="cp-link-label" htmlFor={`${ids}-url`}>Endereço</label>
              <input
                ref={urlInput}
                id={`${ids}-url`}
                className="cp-link-input"
                value={linkUrl}
                onChange={(e) => {
                  setLinkUrl(e.target.value);
                  setLinkErr(null);
                }}
                placeholder="site.com.br ou nome@email.com"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-invalid={linkErr ? true : undefined}
                aria-describedby={linkErr ? `${ids}-err` : undefined}
              />
              {linkErr && (
                <p className="cp-link-err" id={`${ids}-err`} role="alert">
                  {linkErr}
                </p>
              )}
              <div className="cp-link-actions">
                {linkAnchor.current && (
                  <button type="button" className="btn glass sm cp-link-remove" onClick={removeLink}>
                    <Unlink size={14} aria-hidden />
                    Remover link
                  </button>
                )}
                <button type="button" className="btn glass sm" onClick={() => setPop(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn solid sm">
                  {linkAnchor.current ? "Salvar" : "Inserir"}
                </button>
              </div>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
  );
  const emojiPop = (
      <ToolPopover label="Emoji" icon={Smile} open={pop === "emoji"} onOpenChange={togglePop("emoji")} onClosed={backToText} className="cp-emoji-pop">
        <div className="cp-emoji-grid" role="group" aria-label="Emojis">
          {EMOJIS.map(([e, name]) => (
            <button key={name} type="button" className="cp-emoji" aria-label={name} onMouseDown={(ev) => ev.preventDefault()} onClick={() => insertEmoji(e)}>
              <span aria-hidden>{e}</span>
            </button>
          ))}
        </div>
      </ToolPopover>
  );

  if (compact) {
    return (
      <BarPlace.Provider value={{ up }}>
        <div ref={barRef} className="format-bar cp-format cp-format-compact" role="toolbar" aria-label="Formatação do texto">
          <ToolButton label="Negrito" tip={`Negrito ${MOD}B`} icon={Bold} pressed={fmt.bold} onClick={() => exec("bold")} />
          <ToolButton label="Itálico" tip={`Itálico ${MOD}I`} icon={Italic} pressed={fmt.italic} onClick={() => exec("italic")} />
          <ToolButton label="Sublinhado" tip={`Sublinhado ${MOD}U`} icon={Underline} pressed={fmt.underline} onClick={() => exec("underline")} />
          <ToolButton label="Lista com marcadores" tip={`Marcadores ${SHIFT}${MOD}8`} icon={List} pressed={fmt.ul} onClick={() => exec("insertUnorderedList")} />
          {linkPop}
          {emojiPop}
        </div>
      </BarPlace.Provider>
    );
  }

  return (
    <BarPlace.Provider value={{ up }}>
    <div ref={barRef} className="format-bar cp-format" role="toolbar" aria-label="Formatação do texto" data-narrow={narrow}>
      {narrow < 2 && (
        <>
          <ToolButton label="Desfazer" tip={`Desfazer ${MOD}Z`} icon={Undo2} onClick={() => exec("undo")} />
          <ToolButton label="Refazer" tip={`Refazer ${SHIFT}${MOD}Z`} icon={Redo2} onClick={() => exec("redo")} />
          <span className="vsep" aria-hidden />
        </>
      )}
      <span className="cp-tb-select" onFocus={onSelectFocus}>
        <Select
          className="cp-font-select"
          size="sm"
          label="Fonte"
          value={fmt.font}
          onChange={(v) => fromSelect(() => exec("fontName", FONTS.find((f) => f.value === v)!.css))}
          options={FONTS.map(({ value, label }) => ({ value, label }))}
        />
      </span>
      <span className="cp-tb-select" onFocus={onSelectFocus}>
        <Select className="cp-size-select" size="sm" label="Tamanho do texto" value={fmt.size} onChange={(v) => fromSelect(() => exec("fontSize", v))} options={SIZES} />
      </span>
      <span className="vsep" aria-hidden />
      <ToolButton label="Negrito" tip={`Negrito ${MOD}B`} icon={Bold} pressed={fmt.bold} onClick={() => exec("bold")} />
      <ToolButton label="Itálico" tip={`Itálico ${MOD}I`} icon={Italic} pressed={fmt.italic} onClick={() => exec("italic")} />
      <ToolButton label="Sublinhado" tip={`Sublinhado ${MOD}U`} icon={Underline} pressed={fmt.underline} onClick={() => exec("underline")} />
      {narrow < 1 && <ToolButton label="Tachado" tip={`Tachado ${SHIFT}${MOD}X`} icon={Strikethrough} pressed={fmt.strike} onClick={() => exec("strikeThrough")} />}
      <ToolPopover label="Cor do texto e destaque" tip="Cores" icon={Baseline} open={pop === "color"} onOpenChange={togglePop("color")} onClosed={backToText} className="cp-color-pop">
        <Palette title="Cor do texto" current={colors.fore} onPick={(c) => pickColor("fore", c)} />
        <Palette title="Destaque" current={colors.back} onPick={(c) => pickColor("back", c)} />
      </ToolPopover>
      <span className="vsep" aria-hidden />
      <ToolPopover label="Alinhamento" icon={alignIcon} open={pop === "align"} onOpenChange={togglePop("align")} onClosed={backToText} className="cp-align-pop">
        <div className="cp-align-row" role="group" aria-label="Alinhamento">
          {ALIGNS.map((a) => (
            <ToolButton
              key={a.value}
              label={a.label}
              icon={a.icon}
              pressed={fmt.align === a.value}
              onClick={() => {
                setPop(null);
                exec(a.cmd);
              }}
            />
          ))}
        </div>
      </ToolPopover>
      <ToolButton label="Lista numerada" tip={`Lista numerada ${SHIFT}${MOD}7`} icon={ListOrdered} pressed={fmt.ol} onClick={() => exec("insertOrderedList")} />
      <ToolButton label="Lista com marcadores" tip={`Marcadores ${SHIFT}${MOD}8`} icon={List} pressed={fmt.ul} onClick={() => exec("insertUnorderedList")} />
      {narrow < 1 && (
        <>
          <ToolButton label="Diminuir recuo" icon={IndentDecrease} onClick={() => exec("outdent")} />
          <ToolButton label="Aumentar recuo" icon={IndentIncrease} onClick={() => exec("indent")} />
        </>
      )}
      <span className="vsep" aria-hidden />

      {linkPop}
      {emojiPop}

      <ToolPopover label="Mais opções de formatação" tip="Mais" icon={Ellipsis} open={pop === "more"} onOpenChange={togglePop("more")} onClosed={backToText} className="cp-menu" align="end">
        <MenuItem icon={TextQuote} label="Citação" pressed={fmt.quote} onClick={toggleQuote} />
        <MenuItem icon={Code} label="Código" pressed={fmt.code} onClick={toggleCode} />
        <MenuItem
          icon={SeparatorHorizontal}
          label="Linha horizontal"
          onClick={() => {
            setPop(null);
            exec("insertHorizontalRule");
          }}
        />
        {narrow >= 1 && (
          <>
            <span className="cp-menu-sep" aria-hidden />
            <MenuItem
              icon={Strikethrough}
              label="Tachado"
              hint={`${SHIFT}${MOD}X`}
              pressed={fmt.strike}
              onClick={() => {
                setPop(null);
                exec("strikeThrough");
              }}
            />
            <MenuItem
              icon={IndentDecrease}
              label="Diminuir recuo"
              onClick={() => {
                setPop(null);
                exec("outdent");
              }}
            />
            <MenuItem
              icon={IndentIncrease}
              label="Aumentar recuo"
              onClick={() => {
                setPop(null);
                exec("indent");
              }}
            />
          </>
        )}
        {narrow >= 2 && (
          <>
            <MenuItem
              icon={Undo2}
              label="Desfazer"
              hint={`${MOD}Z`}
              onClick={() => {
                setPop(null);
                exec("undo");
              }}
            />
            <MenuItem
              icon={Redo2}
              label="Refazer"
              hint={`${SHIFT}${MOD}Z`}
              onClick={() => {
                setPop(null);
                exec("redo");
              }}
            />
          </>
        )}
        <span className="cp-menu-sep" aria-hidden />
        <MenuItem icon={RemoveFormatting} label="Limpar formatação" onClick={clearFormatting} />
      </ToolPopover>
    </div>
    </BarPlace.Provider>
  );
}
