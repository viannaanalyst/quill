import { useMemo, type ReactNode } from "react";
import { api } from "../lib/api";
import { isTauri } from "../lib/platform";
import { toast } from "../components/Toasts";
import { NotoEmoji } from "./Emoji";
import { parseChat, type Block, type CustomEmojiRef, type Inline, type ListBlock } from "./format";

/**
 * Texto de uma mensagem do Chat montado com elementos React a partir da árvore de `format.ts`
 * (negrito, itálico, código, links, listas, menções e emojis). Nada do texto da API vira HTML.
 */

export function openLink(url: string) {
  if (!isTauri) {
    toast(`Prévia: abriria ${url}`);
    return;
  }
  api.openLink(url).catch(() => toast("Não consegui abrir o link.", "error"));
}

export interface TextContext {
  /** nome de quem foi mencionado (`users/<id>`) */
  nameOf?: (id: string) => string | null | undefined;
  /** id da própria conta: a menção a você fica destacada */
  myId?: string | null;
  /** mensagem só de emoji: emojis grandes e animados (no meio do texto, continuam texto) */
  jumbo?: boolean;
}

function inlines(list: Inline[], ctx: TextContext, key: string): ReactNode[] {
  return list.map((n, i) => {
    const k = `${key}.${i}`;
    switch (n.t) {
      case "text":
        return n.v;
      case "br":
        return <br key={k} />;
      case "b":
        return <strong key={k}>{inlines(n.c, ctx, k)}</strong>;
      case "i":
        return <em key={k}>{inlines(n.c, ctx, k)}</em>;
      case "s":
        return <s key={k}>{inlines(n.c, ctx, k)}</s>;
      case "code":
        return <code key={k}>{n.v}</code>;
      case "emoji":
        if (ctx.jumbo) return <NotoEmoji key={k} emoji={n.v} animate="always" />;
        return (
          <span key={k} className="chat-emo">
            {n.v}
          </span>
        );
      case "custom":
        return <img key={k} className="chat-cemo" src={n.url} alt={n.name} draggable={false} referrerPolicy="no-referrer" />;
      case "mention": {
        const all = n.id === "users/all";
        const name = all ? "todos" : (ctx.nameOf?.(n.id) ?? "alguém");
        return (
          <span key={k} className={`chat-mention${all || n.id === ctx.myId ? " is-me" : ""}`}>
            @{name}
          </span>
        );
      }
      case "link": {
        const href = n.href;
        return (
          <a
            key={k}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              openLink(href);
            }}
          >
            {inlines(n.c, ctx, k)}
          </a>
        );
      }
    }
  });
}

function List({ l, ctx, k }: { l: ListBlock; ctx: TextContext; k: string }) {
  const items = l.items.map((it, j) => (
    <li key={j}>
      {inlines(it.c, ctx, `${k}.${j}`)}
      {it.sub && <List l={it.sub} ctx={ctx} k={`${k}.${j}s`} />}
    </li>
  ));
  return l.t === "ol" ? (
    <ol className="chat-ul chat-ol" start={l.start === 1 ? undefined : l.start}>
      {items}
    </ol>
  ) : (
    <ul className="chat-ul">{items}</ul>
  );
}

/** Blocos já interpretados (parágrafos, listas, citações, separadores e blocos de código). */
export function ChatBlocks({ blocks, ctx = {} }: { blocks: Block[]; ctx?: TextContext }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "pre":
            return (
              <pre key={i} className="chat-pre">
                <code>{b.v}</code>
              </pre>
            );
          case "hr":
            return <hr key={i} className="chat-hr" />;
          case "quote":
            return (
              <blockquote key={i} className="chat-bq">
                <ChatBlocks blocks={b.c} ctx={ctx} />
              </blockquote>
            );
          case "p":
            return (
              <p key={i} className="chat-p">
                {inlines(b.c, ctx, String(i))}
              </p>
            );
          default:
            return <List key={i} l={b} ctx={ctx} k={String(i)} />;
        }
      })}
    </>
  );
}

/** Texto com a marcação do Google Chat (para quando não precisa saber se é só emoji). */
export function ChatText({ text, custom, ctx }: { text: string; custom?: CustomEmojiRef[]; ctx?: TextContext }) {
  const blocks = useMemo(() => parseChat(text, custom), [text, custom]);
  return <ChatBlocks blocks={blocks} ctx={ctx} />;
}
