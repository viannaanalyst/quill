import * as Dialog from "@radix-ui/react-dialog";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageAvatar } from "./MessageAvatar";
import {
  Archive,
  CalendarDays,
  CornerDownLeft,
  FileText,
  Inbox,
  LoaderCircle,
  Monitor,
  Moon,
  OctagonAlert,
  RefreshCw,
  Search,
  Send,
  Settings,
  SquarePen,
  Star,
  Sun,
  Trash2,
} from "./icons";
import { closePalette, usePalette } from "./paletteState";
import { applyTheme, isTauri, type ThemePref } from "../lib/platform";
import { setPref } from "../lib/storage";
import { markReadRemote, refreshMailbox, searchAll, useMailbox } from "../state/mailbox";
import { markRead, navigate } from "../state/store";
import type { Message } from "../inbox/types";
import { useCalendar, visibleEvents, type AgendaEvent } from "../state/calendar";
import { matchesQuery, openCalendarAt } from "../calendar/shared";

interface Item {
  id: string;
  group: string;
  label: string;
  /** linha de apoio (remetente do e-mail) */
  sub?: string;
  hint?: string;
  icon?: ReactNode;
  keywords?: string;
  run: () => void;
}

const ic = (C: typeof Inbox) => <C size={16} aria-hidden />;

function setTheme(t: ThemePref) {
  setPref("theme", t);
  applyTheme(t);
}

const COMMANDS: Item[] = [
  { id: "compose", group: "Ações", label: "Escrever e-mail", hint: "C", icon: ic(SquarePen), keywords: "novo mensagem", run: () => navigate({ name: "compose" }) },
  { id: "refresh", group: "Ações", label: "Atualizar e-mails", hint: "⌘ R", icon: ic(RefreshCw), keywords: "sincronizar buscar", run: () => void refreshMailbox() },
  { id: "inbox", group: "Ir para", label: "Caixa de entrada", hint: "G E", icon: ic(Inbox), run: () => navigate({ name: "inbox", folder: "inbox" }) },
  { id: "starred", group: "Ir para", label: "Importantes", icon: ic(Star), keywords: "estrela", run: () => navigate({ name: "inbox", folder: "starred" }) },
  { id: "sent", group: "Ir para", label: "Enviados", icon: ic(Send), run: () => navigate({ name: "inbox", folder: "sent" }) },
  { id: "drafts", group: "Ir para", label: "Rascunhos", icon: ic(FileText), run: () => navigate({ name: "inbox", folder: "drafts" }) },
  { id: "archive", group: "Ir para", label: "Arquivo", icon: ic(Archive), run: () => navigate({ name: "inbox", folder: "archive" }) },
  { id: "spam", group: "Ir para", label: "Spam", icon: ic(OctagonAlert), run: () => navigate({ name: "inbox", folder: "spam" }) },
  { id: "trash", group: "Ir para", label: "Lixeira", icon: ic(Trash2), run: () => navigate({ name: "inbox", folder: "trash" }) },
  { id: "cal-day", group: "Ir para", label: "Calendário: dia", icon: ic(CalendarDays), keywords: "agenda hoje", run: () => navigate({ name: "calendar", mode: "day" }) },
  { id: "cal-week", group: "Ir para", label: "Calendário: semana", hint: "G C", icon: ic(CalendarDays), keywords: "agenda", run: () => navigate({ name: "calendar", mode: "week" }) },
  { id: "cal-month", group: "Ir para", label: "Calendário: mês", icon: ic(CalendarDays), keywords: "agenda", run: () => navigate({ name: "calendar", mode: "month" }) },
  { id: "settings", group: "Ir para", label: "Ajustes", hint: "⌘ ,", icon: ic(Settings), keywords: "configurações preferências contas", run: () => navigate({ name: "settings" }) },
  { id: "theme-light", group: "Aparência", label: "Tema claro", icon: ic(Sun), keywords: "modo", run: () => setTheme("light") },
  { id: "theme-dark", group: "Aparência", label: "Tema escuro", icon: ic(Moon), keywords: "modo noturno", run: () => setTheme("dark") },
  { id: "theme-system", group: "Aparência", label: "Tema do sistema", icon: ic(Monitor), keywords: "modo automático", run: () => setTheme("system") },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

function openMessage(m: Message) {
  markRead(m.id);
  markReadRemote(m.id);
  navigate({ name: "read", id: m.id });
}

function messageItem(m: Message, group: string): Item {
  return {
    id: `m-${m.id}`,
    group,
    label: m.subject || "(sem assunto)",
    sub: m.from,
    hint: m.date,
    icon: <MessageAvatar message={m} size={26} />,
    keywords: `${m.from} ${m.preview}`,
    run: () => openMessage(m),
  };
}

function eventItem(e: AgendaEvent): Item {
  const d = new Date(e.start);
  return {
    id: `e-${e.key}`,
    group: "Eventos",
    label: e.title,
    sub: e.location,
    hint: `${d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "")}${e.allDay ? "" : ` · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}`,
    icon: <CalendarDays size={16} aria-hidden style={{ color: e.color }} />,
    run: () => openCalendarAt("day", e.start),
  };
}

/** Busca geral (⌘K): e-mails, eventos, telas e ações, tudo pelo teclado. */
export default function CommandPalette() {
  const { open, query: initial } = usePalette();
  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<{ q: string; list: Message[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const folders = useMailbox((s) => s.folders);
  const events = useCalendar(visibleEvents);
  const listRef = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(query);

  // a cada abertura começa do texto que veio da caixa de busca
  useEffect(() => {
    if (open) {
      setQuery(initial);
      setActive(0);
    }
  }, [open, initial]);

  // e-mails já carregados (sem repetir o mesmo e-mail de caixas diferentes)
  const loaded = useMemo(() => {
    const seen = new Map<string, Message>();
    for (const [k, list] of Object.entries(folders)) if (k !== "search") list?.forEach((m) => seen.has(m.id) || seen.set(m.id, m));
    return [...seen.values()];
  }, [folders]);

  // busca no Gmail depois de uma pausa na digitação
  useEffect(() => {
    const q = deferred.trim();
    if (!open || !isTauri || q.length < 2) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setSearching(true);
      const list = await searchAll(q);
      if (!cancelled) {
        setRemote({ q, list });
        setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [deferred, open]);

  const items = useMemo(() => {
    const q = norm(deferred.trim());
    const cmds = q ? COMMANDS.filter((c) => norm(`${c.label} ${c.keywords ?? ""}`).includes(q)) : COMMANDS;
    if (!q) return cmds;
    const local = loaded.filter((m) => norm(`${m.subject} ${m.from} ${m.fromEmail ?? ""} ${m.preview}`).includes(q)).slice(0, 6);
    const localIds = new Set(local.map((m) => m.id));
    const fromGmail = remote && norm(remote.q) === q ? remote.list.filter((m) => !localIds.has(m.id)).slice(0, 8) : [];
    const now = Date.now();
    const evs = events
      .filter((e) => matchesQuery(e, deferred.trim().toLocaleLowerCase("pt-BR")))
      // os próximos primeiro, depois os que já passaram (mais recentes antes)
      .toSorted((a, b) => (a.end < now ? 1 : 0) - (b.end < now ? 1 : 0) || (a.end < now ? b.start - a.start : a.start - b.start))
      .slice(0, 5);
    return [...local.map((m) => messageItem(m, "E-mails")), ...evs.map(eventItem), ...fromGmail.map((m) => messageItem(m, "No Gmail")), ...cmds];
  }, [deferred, loaded, remote, events]);

  const safeActive = Math.min(active, Math.max(0, items.length - 1));

  // mantém o item escolhido à vista
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${safeActive}"]`)?.scrollIntoView({ block: "nearest" });
  }, [safeActive]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    closePalette();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items[safeActive]);
    }
  };

  let lastGroup = "";
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && closePalette()}>
      <Dialog.Portal>
        <Dialog.Overlay className="cmd-overlay" />
        <Dialog.Content className="cmd-box" aria-describedby={undefined} onKeyDown={onKeyDown}>
          <Dialog.Title className="sr-only">Busca geral</Dialog.Title>
          <div className="cmd-input">
            {searching ? <LoaderCircle size={18} className="spinning" aria-hidden /> : <Search size={18} aria-hidden />}
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Buscar e-mails, telas e ações…"
              role="combobox"
              aria-expanded
              aria-controls="cmd-list"
              aria-activedescendant={items[safeActive] ? `cmd-${items[safeActive].id}` : undefined}
              aria-label="Buscar"
            />
            <kbd className="kbd">esc</kbd>
          </div>
          <div className="cmd-list" id="cmd-list" role="listbox" ref={listRef}>
            {items.length === 0 ? (
              <p className="cmd-empty">{searching ? "Buscando no Gmail…" : `Nada encontrado para “${query.trim()}”.`}</p>
            ) : (
              items.map((item, i) => {
                const header = item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                return (
                  <div key={item.id} role="presentation">
                    {header && (
                      <div className="cmd-group" role="presentation">
                        {header}
                      </div>
                    )}
                    <div
                      id={`cmd-${item.id}`}
                      role="option"
                      aria-selected={i === safeActive}
                      data-index={i}
                      className="cmd-item"
                      onMouseMove={() => i !== safeActive && setActive(i)}
                      onClick={() => run(item)}
                    >
                      <span className="cmd-ic">{item.icon}</span>
                      <span className="cmd-label">
                        {item.label}
                        {item.sub && <small>{item.sub}</small>}
                      </span>
                      {item.hint && <span className="cmd-hint">{item.hint}</span>}
                      {i === safeActive && <CornerDownLeft size={14} className="cmd-enter" aria-hidden />}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="cmd-foot" aria-hidden>
            <span>
              <kbd className="kbd">↑</kbd>
              <kbd className="kbd">↓</kbd> navegar
            </span>
            <span>
              <kbd className="kbd">↵</kbd> abrir
            </span>
            {isTauri && <span className="cmd-foot-tip">Dica: use a busca do Gmail, como from:ana ou has:attachment</span>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
