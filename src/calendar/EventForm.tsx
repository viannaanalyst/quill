import { useMailbox } from "../state/mailbox";
import * as Popover from "@radix-ui/react-popover";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import "./eventForm.css";
import { Dot, Select } from "../components/Select";
import { DatePicker, TimeSelect } from "../components/DatePicker";
import { initialsOf } from "../components/MyAvatar";
import { Bell, CalendarDays, CalendarPlus, ChevronDown, Clock, FileText, MapPin, Pencil, Users, Video, X } from "../components/icons";
import { loadContacts, useContacts, type SuggestedContact } from "../state/contacts";
import {
  addDays,
  createEvent,
  editableCalendars,
  now,
  sameDay,
  startOfDay,
  updateEvent,
  useCalendar,
  type AgendaEvent,
  type EventChanges,
} from "../state/calendar";
import { meetLabel } from "./shared";

/* ---------------- datas ---------------- */

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date | number) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const hm = (h: number, m = 0) => `${pad(h)}:${pad(m)}`;
const hmOf = (t: number) => {
  const d = new Date(t);
  return hm(d.getHours(), d.getMinutes());
};
/** "2026-11-25" + "14:30" → Date local */
function toDate(date: string, time = "00:00") {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0);
}
const DAY = 86_400_000;
/** Diferença em dias entre duas datas "AAAA-MM-DD" (arredonda por causa do horário de verão). */
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);

/* ---------------- lembrete ---------------- */

const REMINDERS = [
  { value: "default", label: "Padrão da agenda" },
  { value: "none", label: "Nenhum" },
  { value: "0", label: "Na hora" },
  { value: "5", label: "5 min antes" },
  { value: "10", label: "10 min antes" },
  { value: "30", label: "30 min antes" },
  { value: "60", label: "1 hora antes" },
  { value: "1440", label: "1 dia antes" },
];
/** "default" = não mexe (padrão da agenda na criação; como está, na edição). */
const reminderValue = (v: string): number[] | undefined => (v === "default" ? undefined : v === "none" ? [] : [Number(v)]);

/* ---------------- convidados ---------------- */

export interface Guest {
  /** e-mail (nos exemplos da prévia, o nome, quando não há e-mail) */
  email: string;
  name?: string;
  photo?: string;
}

const EMAIL_RE = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$/;
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Foto do contato (quando tiver) ou iniciais. */
export function PersonAvatar({ name, email, photo, size = 20, tone = "neutral" }: { name?: string; email?: string; photo?: string | null; size?: number; tone?: string }) {
  const [broken, setBroken] = useState(false);
  const dim = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (photo && !broken) {
    return (
      <span className="av av-photo" style={dim} aria-hidden>
        <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <span className={`av ${tone}`} style={dim} aria-hidden>
      {initialsOf(email && email.includes("@") ? email : undefined, name && name !== email ? name : email)}
    </span>
  );
}

/** Fotos dos contatos por e-mail, para os avatares dos convidados. */
export function useContactPhotos() {
  const contacts = useContacts();
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts) if (c.photo) m.set(c.email.toLowerCase(), c.photo);
    return m;
  }, [contacts]);
}

/** Campo de convidados: pílulas, sugestões dos contatos enquanto digita, Enter/vírgula para um e-mail digitado. */
function GuestField({ value, onChange }: { value: Guest[]; onChange: (v: Guest[]) => void }) {
  const contacts = useContacts();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState(false);
  const listId = useId();
  const errId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const q = norm(text.trim());

  const suggestions = useMemo(() => {
    if (!q) return [];
    const taken = new Set(value.map((v) => v.email.toLowerCase()));
    const hits: [SuggestedContact, number][] = [];
    // a lista já vem na ordem de quem você mais escreve; começo de palavra vem antes
    for (const c of contacts) {
      if (taken.has(c.email.toLowerCase())) continue;
      const name = norm(c.name ?? "");
      const email = norm(c.email);
      if (name.split(/[\s.\-_]+/).some((w) => w.startsWith(q)) || email.split(/[@.\-_+]/).some((w) => w.startsWith(q))) hits.push([c, 2]);
      else if (name.includes(q) || email.includes(q)) hits.push([c, 1]);
      if (hits.length >= 40) break;
    }
    return hits
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([c]) => c);
  }, [q, value, contacts]);
  const open = focused && suggestions.length > 0;

  const add = (g: Guest) => {
    if (!value.some((v) => same(v.email, g.email))) onChange([...value, g]);
    setText("");
    setActive(0);
    setError(false);
  };
  /** e-mail digitado direto; devolve false quando não é um e-mail */
  const addTyped = () => {
    const raw = text.trim().replace(/[,;]$/, "");
    if (!raw) return true;
    if (!EMAIL_RE.test(raw)) return false;
    add({ email: raw });
    return true;
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open && e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (open && e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (open && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      const c = suggestions[active];
      add({ email: c.email, name: c.name ?? undefined, photo: c.photo ?? undefined });
    } else if (e.key === "Enter" || e.key === "," || e.key === ";") {
      // nunca salva o evento por aqui: Enter só adiciona o convidado
      e.preventDefault();
      if (!addTyped()) setError(true);
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="cal-guests-wrap">
      <Popover.Root open={open}>
        <Popover.Anchor asChild>
          <div className="cal-guests" data-invalid={error || undefined} onClick={() => inputRef.current?.focus()}>
            {value.map((g) => (
              <span key={g.email} className="cal-guest">
                <PersonAvatar name={g.name} email={g.email} photo={g.photo} size={18} />
                <span className="cal-guest-name">{g.name || g.email}</span>
                <button type="button" aria-label={`Remover ${g.name || g.email}`} onClick={() => onChange(value.filter((v) => v.email !== g.email))}>
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              className="cal-guests-input"
              role="combobox"
              aria-label="Convidar pessoas"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={open ? `${listId}-${active}` : undefined}
              aria-invalid={error || undefined}
              aria-describedby={error ? errId : undefined}
              value={text}
              placeholder={value.length ? "Mais alguém…" : "Convidar pessoas"}
              onChange={(e) => {
                setText(e.target.value);
                setActive(0);
                setError(false);
              }}
              onKeyDown={onKey}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                if (!addTyped()) setError(true);
              }}
              onPaste={(e) => {
                // colar vários e-mails de uma vez
                const found = e.clipboardData.getData("text").match(/[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+/g);
                if (found && found.length > 1) {
                  e.preventDefault();
                  const known = new Set(value.map((v) => v.email.toLowerCase()));
                  const fresh = [...new Set(found.map((f) => f.toLowerCase()))].filter((f) => !known.has(f));
                  onChange([...value, ...fresh.map((email) => ({ email }))]);
                }
              }}
            />
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            className="qp-content cal-suggest"
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={() => setText("")}
          >
            <ul id={listId} role="listbox" aria-label="Sugestões de contatos">
              {suggestions.map((c, i) => (
                <li
                  key={c.email}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    // mantém o foco no campo
                    e.preventDefault();
                    add({ email: c.email, name: c.name ?? undefined, photo: c.photo ?? undefined });
                  }}
                >
                  <PersonAvatar name={c.name ?? undefined} email={c.email} photo={c.photo} size={28} />
                  <span className="cal-suggest-text">
                    <span className="cal-suggest-name">{c.name || c.email}</span>
                    {c.name && <span className="cal-suggest-mail">{c.email}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && (
        <span id={errId} className="cal-pop-err cal-guests-err" role="alert">
          Digite um e-mail válido
        </span>
      )}
    </div>
  );
}

/* ---------------- formulário (criar e editar) ---------------- */

type FormProps =
  | { mode: "create"; day: number; initialTitle?: string; onClose: () => void }
  | { mode: "edit"; event: AgendaEvent; onClose: () => void };

/** Valores iniciais do formulário. */
function initialValues(p: FormProps) {
  if (p.mode === "edit") {
    const e = p.event;
    // dia inteiro: o fim é exclusivo; no formulário, mostra o último dia
    const lastDay = e.allDay ? Math.max(e.start, e.end - DAY) : e.end;
    return {
      title: e.title,
      date: ymd(e.start),
      endDate: ymd(lastDay),
      startT: e.allDay ? "09:00" : hmOf(e.start),
      endT: e.allDay ? "10:00" : hmOf(e.end),
      allDay: e.allDay,
      location: e.location ?? "",
      description: e.description ?? "",
      guests: e.attendees.filter((a) => !a.isSelf).map((a): Guest => ({ email: a.email || a.name, name: a.name && a.name !== a.email ? a.name : undefined })),
    };
  }
  const date = ymd(p.day);
  // hoje: a próxima hora cheia; outros dias: 14h
  let startT = "14:00";
  let endT = "15:00";
  if (sameDay(p.day, now())) {
    const h = Math.min(new Date(now()).getHours() + 1, 23);
    startT = hm(h);
    endT = h === 23 ? "23:45" : hm(h + 1);
  }
  return { title: p.initialTitle ?? "", date, endDate: date, startT, endT, allDay: false, location: "", description: "", guests: [] as Guest[] };
}

const guestKey = (list: Guest[]) =>
  list
    .map((g) => g.email.toLowerCase())
    .toSorted()
    .join(",");

/**
 * Corpo do formulário de evento, usado no cartão de criação rápida e no lugar dos detalhes ao editar.
 * Quem chama decide onde ele fica (cartão flutuante ou painel do dia).
 */
export function EventForm(props: FormProps) {
  const { onClose } = props;
  const editing = props.mode === "edit" ? props.event : null;
  const calState = useCalendar((s) => s);
  const editable = useMemo(() => editableCalendars(calState), [calState.calendars]);
  const photos = useContactPhotos();
  const [init] = useState(() => initialValues(props));
  const [title, setTitle] = useState(init.title);
  const [date, setDate] = useState(init.date);
  const [endDate, setEndDate] = useState(init.endDate);
  const [startT, setStartT] = useState(init.startT);
  const [endT, setEndT] = useState(init.endT);
  const [allDay, setAllDay] = useState(init.allDay);
  const [location, setLocation] = useState(init.location);
  const [description, setDescription] = useState(init.description);
  const [guests, setGuests] = useState<Guest[]>(init.guests);
  const [meet, setMeet] = useState(false);
  const [reminder, setReminder] = useState("default");
  const [calendarKey, setCalendarKey] = useState("");
  const [more, setMore] = useState(() => !!(init.location || init.description));
  const [saving, setSaving] = useState(false);
  const moreId = useId();
  const titleId = useId();

  useEffect(() => void loadContacts(), []);

  // editando dentro da grade (semana) ou do painel do dia: rola até o formulário caber à vista
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = formRef.current;
    if (editing && el) (el.closest<HTMLElement>(".cal-pop") ?? el).scrollIntoView({ block: "nearest" });
  }, [editing, more]);

  // na criação, Esc fecha mesmo com o foco fora do cartão (ex.: logo depois de clicar no dia do mês)
  useEffect(() => {
    if (editing) return;
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.defaultPrevented) return;
      ev.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onClose]);

  const key = editable.some((c) => c.key === calendarKey) ? calendarKey : (editable[0]?.key ?? "");
  // Google Meet só existe nas agendas do Google (no iCloud o pedido seria ignorado)
  const connected = useMailbox((s) => s.connected);
  const isGoogleKey = (k: string) => {
    const account = editable.find((c) => c.key === k)?.account;
    const p = connected.find((a) => a.email === account)?.provider;
    return !p || p === "google";
  };
  const start = toDate(date, allDay ? "00:00" : startT);
  const end = toDate(endDate, allDay ? "00:00" : endT);
  const badTime = allDay ? end < start : end <= start;
  const canSave = !!title.trim() && (!!editing || !!key) && !badTime && !saving;

  const changeDate = (v: string) => {
    // eventos de vários dias andam juntos: o fim acompanha o início
    setEndDate(ymd(addDays(toDate(endDate), daysBetween(date, v))));
    setDate(v);
  };
  const changeStart = (v: string) => {
    // mantém a duração ao mudar o início
    const dur = end.getTime() - start.getTime();
    setStartT(v);
    const nextEnd = new Date(toDate(date, v).getTime() + Math.max(dur, 30 * 60_000));
    setEndDate(ymd(nextEnd));
    setEndT(hmOf(nextEnd.getTime()));
  };

  /** Fim que a agenda espera: no dia inteiro, o dia seguinte ao último (a não ser num dia só). */
  const endForSave = () => (allDay ? (endDate === date ? toDate(date) : addDays(toDate(endDate), 1)) : end);

  const save = async () => {
    if (!canSave) return;
    const reminders = reminderValue(reminder);
    if (!editing) {
      setSaving(true);
      const created = await createEvent({
        calendarKey: key,
        title: title.trim(),
        start,
        end: endForSave(),
        allDay,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        attendees: guests.length ? guests.map((g) => g.email) : undefined,
        reminders,
        meet: (meet && isGoogleKey(key)) || undefined,
      });
      setSaving(false);
      if (created) onClose();
      return;
    }
    // só manda o que mudou
    const ch: EventChanges = {};
    if (title.trim() !== editing.title) ch.title = title.trim();
    const newStart = allDay ? startOfDay(start).getTime() : start.getTime();
    const newEnd = allDay ? addDays(toDate(endDate), 1).getTime() : end.getTime();
    if (allDay !== editing.allDay || newStart !== editing.start || newEnd !== editing.end) {
      ch.allDay = allDay;
      ch.start = start;
      ch.end = endForSave();
    }
    if (location.trim() !== (editing.location ?? "").trim()) ch.location = location.trim();
    if (description.trim() !== (editing.description ?? "").trim()) ch.description = description.trim();
    if (guestKey(guests) !== guestKey(init.guests)) {
      // eu continuo na lista (senão saio do meu próprio evento)
      const mine = editing.attendees.filter((a) => a.isSelf && a.email).map((a) => a.email);
      ch.attendees = [...mine, ...guests.map((g) => g.email)];
    }
    if (reminders) ch.reminders = reminders;
    if (Object.keys(ch).length === 0) return onClose();
    setSaving(true);
    const ok = await updateEvent(editing.key, ch);
    setSaving(false);
    if (ok) onClose();
  };

  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div
      ref={formRef}
      className="cal-form"
      role="group"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        // Esc fecha o formulário; quando um menu aberto já tratou o Esc, ele vem com defaultPrevented
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="cal-pop-head">
        {editing ? <Pencil size={14} aria-hidden /> : <CalendarPlus size={14} aria-hidden />}
        <span id={titleId}>{editing ? "Editar evento" : "Novo evento"}</span>
        <span className="cal-pop-actions">
          <button type="button" className="btn ic" aria-label={editing ? "Cancelar edição" : "Fechar"} data-tip={editing ? "Cancelar" : "Fechar"} onClick={onClose}>
            <X size={15} aria-hidden />
          </button>
        </span>
      </div>
      <input
        className="cal-pop-input"
        autoFocus
        value={title}
        placeholder="Título do evento"
        aria-label="Título do evento"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onEnter}
      />
      <div className="cal-pop-row">
        <Clock size={15} aria-hidden />
        <DatePicker label="Data" value={date} onChange={changeDate} />
        <label className="cal-pop-allday">
          Dia todo
          <button type="button" className="toggle" role="switch" aria-checked={allDay} aria-label="Dia todo" onClick={() => setAllDay((v) => !v)} />
        </label>
      </div>
      {!allDay && (
        <div className="cal-pop-row cal-pop-times">
          <TimeSelect label="Começa às" value={startT} onChange={changeStart} />
          <span aria-hidden>–</span>
          <TimeSelect label="Termina às" value={endT} onChange={setEndT} invalid={badTime} />
          {endDate !== date && !badTime && <span className="cal-form-next">{daysBetween(date, endDate) === 1 ? "dia seguinte" : `+${daysBetween(date, endDate)} dias`}</span>}
          {badTime && (
            <span className="cal-pop-err" role="alert">
              Termina antes de começar
            </span>
          )}
        </div>
      )}
      {allDay && endDate !== date && (
        <div className="cal-pop-row cal-pop-times">
          <span className="cal-form-next">Até {toDate(endDate).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" })}</span>
        </div>
      )}
      {!editing && (
        <div className="cal-pop-row">
          <CalendarDays size={15} aria-hidden />
          {editable.length > 0 ? (
            <Select
              size="sm"
              label="Agenda"
              value={key}
              onChange={setCalendarKey}
              options={editable.map((c) => ({ value: c.key, label: c.name, leading: <Dot color={c.color} /> }))}
            />
          ) : (
            <span className="muted">Conecte uma conta em Ajustes</span>
          )}
        </div>
      )}
      <div className="cal-pop-row cal-form-top">
        <Users size={15} aria-hidden />
        <GuestField value={guests.map((g) => (g.photo ? g : { ...g, photo: photos.get(g.email.toLowerCase()) }))} onChange={setGuests} />
      </div>
      {editing ? (
        editing.meetUrl && (
          <div className="cal-pop-row">
            <Video size={15} aria-hidden />
            <a className="cal-pop-link" href={editing.meetUrl} target="_blank" rel="noreferrer">
              {meetLabel(editing.meetUrl)}
            </a>
          </div>
        )
      ) : (
        isGoogleKey(key) && <div className="cal-pop-row">
          <Video size={15} aria-hidden />
          <label className="cal-form-switch">
            <span>Adicionar Google Meet</span>
            <button type="button" className="toggle" role="switch" aria-checked={meet} aria-label="Adicionar Google Meet" onClick={() => setMeet((v) => !v)} />
          </label>
        </div>
      )}
      {more && (
        <div id={moreId} className="cal-form-more">
          <div className="cal-pop-row">
            <MapPin size={15} aria-hidden />
            <input
              className="cal-pop-field cal-pop-place"
              value={location}
              placeholder="Adicionar local"
              aria-label="Local"
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={onEnter}
            />
          </div>
          <div className="cal-pop-row cal-form-top">
            <FileText size={15} aria-hidden />
            <textarea
              className="cal-form-desc"
              value={description}
              rows={2}
              placeholder="Adicionar descrição"
              aria-label="Descrição"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="cal-pop-row">
            <Bell size={15} aria-hidden />
            <Select
              size="sm"
              label="Lembrete"
              value={reminder}
              onChange={setReminder}
              options={editing ? REMINDERS.map((r) => (r.value === "default" ? { ...r, label: "Lembrete como está" } : r)) : REMINDERS}
            />
          </div>
        </div>
      )}
      <div className="cal-pop-foot">
        <button type="button" className="btn glass sm cal-form-moreBtn" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((v) => !v)}>
          {more ? "Menos opções" : "Mais opções"}
          <ChevronDown size={14} aria-hidden />
        </button>
        <button type="button" className="btn solid sm" onClick={() => void save()} disabled={!canSave} aria-busy={saving || undefined}>
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

/**
 * Mantém o cartão flutuante dentro da área que o contém (ex.: ao abrir "Mais opções" perto da borda).
 * Usa a propriedade `translate` (não mexe no layout nem na animação de entrada, que usa `transform`).
 */
export function useKeepInside(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    let current = 0;
    const fit = () => {
      const p = parent.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const top = r.top - current;
      const bottom = r.bottom - current;
      let dy = 0;
      if (bottom > p.bottom - 8) dy = p.bottom - 8 - bottom;
      if (top + dy < p.top + 8) dy = p.top + 8 - top;
      if (dy !== current) {
        current = dy;
        el.style.translate = dy ? `0 ${Math.round(dy)}px` : "";
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}

/** Criação rápida: o formulário num cartão flutuante. */
export function QuickCreate({
  day,
  initialTitle,
  style,
  className = "",
  onClose,
}: {
  day: number;
  initialTitle?: string;
  style: CSSProperties;
  className?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useKeepInside(ref);
  return (
    <div ref={ref} className={`cal-pop ${className}`} role="dialog" aria-label="Novo evento" style={style} onClick={(e) => e.stopPropagation()}>
      <EventForm mode="create" day={day} initialTitle={initialTitle} onClose={onClose} />
    </div>
  );
}
