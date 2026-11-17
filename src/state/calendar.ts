import { useSyncExternalStore } from "react";
import { isTauri } from "../lib/platform";
import { getPref, setPref } from "../lib/storage";
import { friendlyError } from "../lib/api";
import { toast } from "../components/Toasts";
import { getMailbox, onMailboxLoaded } from "./mailbox";
import { CAL_COLOR, CALENDARS as SAMPLE_CALENDARS, EVENTS as SAMPLE_EVENTS, type CalEvent as SampleEvent } from "../calendar/events";

/**
 * Agenda das telas (Calendário e cartão "Hoje"): eventos do Google Agenda de todas as contas,
 * juntando cópias do mesmo convite (mesmo iCalUID + mesmo início) num evento só.
 * Na prévia do navegador usa os eventos de exemplo de novembro de 2026.
 */

export type RsvpStatus = "accepted" | "declined" | "tentative" | "needsAction";

/* ---------- formato que vem da parte nativa (quill-core::calendar) ---------- */
interface EventTimeDto {
  dateTime?: string;
  date?: string;
}
interface CalendarInfoDto {
  id: string;
  name: string;
  color?: string | null;
  primary: boolean;
  canEdit: boolean;
  selected: boolean;
}
interface AttendeeDto {
  email: string;
  name?: string | null;
  status: string;
  isSelf: boolean;
  organizer: boolean;
}
interface CalEventDto {
  id: string;
  icalUid: string;
  calendarId: string;
  title: string;
  start: EventTimeDto;
  end: EventTimeDto;
  allDay: boolean;
  location?: string | null;
  description?: string | null;
  meetUrl?: string | null;
  htmlLink?: string | null;
  organizerEmail?: string | null;
  organizerName?: string | null;
  organizerSelf: boolean;
  attendees: AttendeeDto[];
  myStatus?: string | null;
  recurring: boolean;
}
interface AgendaDto {
  calendars: CalendarInfoDto[];
  events: CalEventDto[];
}

/* ---------- formato usado pelas telas ---------- */
export interface AgendaCalendar {
  /** `${conta}|${id da agenda}` */
  key: string;
  account: string;
  id: string;
  name: string;
  color: string;
  primary: boolean;
  canEdit: boolean;
}

export interface EventCopy {
  account: string;
  calendarId: string;
  calendarKey: string;
  eventId: string;
  /** minha resposta nesta cópia (quando sou convidado por esta conta) */
  myStatus?: RsvpStatus;
}

export interface Attendee {
  name: string;
  email: string;
  status: RsvpStatus;
  isSelf: boolean;
  organizer: boolean;
}

export interface AgendaEvent {
  key: string;
  title: string;
  /** início e fim em milissegundos; dia inteiro = meia-noite local, fim exclusivo */
  start: number;
  end: number;
  allDay: boolean;
  /** onde o evento aparece (uma cópia por conta/agenda); a primeira define a cor */
  copies: EventCopy[];
  color: string;
  location?: string;
  description?: string;
  meetUrl?: string;
  htmlLink?: string;
  organizer?: { name?: string; email?: string; self: boolean };
  attendees: Attendee[];
  /** minha resposta (se sou convidado em alguma das contas) */
  myStatus?: RsvpStatus;
  recurring: boolean;
}

export interface NewEventInput {
  calendarKey: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
}

type Status = "idle" | "loading" | "ready" | "error";

interface CalendarState {
  calendars: AgendaCalendar[];
  events: AgendaEvent[];
  /** intervalo já carregado (ms) */
  loaded: { start: number; end: number } | null;
  status: Status;
  error: string | null;
  /** agendas escondidas pela pessoa (chaves), lembradas entre aberturas */
  hidden: ReadonlySet<string>;
}

/* ---------- relógio: na prévia, "agora" é ter 17/11/2026 09:20 (como nos desenhos) ---------- */
const PREVIEW_NOW = new Date(2026, 10, 17, 9, 20).getTime();
export const now = () => (isTauri ? Date.now() : PREVIEW_NOW);

export const startOfDay = (t: number | Date) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
};
export const addDays = (t: number | Date, n: number) => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d;
};
/** Segunda-feira da semana (a semana do Quill começa na segunda). */
export const startOfWeek = (t: number | Date) => {
  const d = startOfDay(t);
  return addDays(d, -((d.getDay() + 6) % 7));
};
export const sameDay = (a: number | Date, b: number | Date) => startOfDay(a).getTime() === startOfDay(b).getTime();

/** Eventos que tocam um dia (inclui os de vários dias), visíveis, em ordem de início. */
export function eventsOnDay(events: AgendaEvent[], day: number | Date): AgendaEvent[] {
  const s = startOfDay(day).getTime();
  const e = addDays(s, 1).getTime();
  return events.filter((ev) => ev.start < e && ev.end > s);
}

/* ---------- estado ---------- */
let state: CalendarState = {
  calendars: [],
  events: [],
  loaded: null,
  status: "idle",
  error: null,
  hidden: new Set(getPref<string[]>("calendar.hidden", [])),
};
const listeners = new Set<() => void>();
function set(patch: Partial<CalendarState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** Lê um pedaço da agenda. O seletor deve devolver um valor estável (campo do estado ou primitivo). */
export function useCalendar<T>(selector: (s: CalendarState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
export const getCalendar = () => state;

/** Só os eventos das agendas que estão à mostra. */
let visibleCache: { events: AgendaEvent[]; hidden: ReadonlySet<string>; out: AgendaEvent[] } | null = null;
export function visibleEvents(s: CalendarState): AgendaEvent[] {
  if (visibleCache && visibleCache.events === s.events && visibleCache.hidden === s.hidden) return visibleCache.out;
  const out = s.hidden.size === 0 ? s.events : s.events.filter((e) => e.copies.some((c) => !s.hidden.has(c.calendarKey)));
  visibleCache = { events: s.events, hidden: s.hidden, out };
  return out;
}

export function toggleCalendar(key: string) {
  const hidden = new Set(state.hidden);
  if (hidden.has(key)) hidden.delete(key);
  else hidden.add(key);
  setPref("calendar.hidden", [...hidden]);
  set({ hidden });
}

/* ---------- conversão ---------- */
const STATUSES: RsvpStatus[] = ["accepted", "declined", "tentative", "needsAction"];
const asStatus = (s?: string | null): RsvpStatus | undefined => (STATUSES.includes(s as RsvpStatus) ? (s as RsvpStatus) : undefined);

/** "2026-11-20" → meia-noite local desse dia. */
function parseDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).getTime();
}
const toMs = (t: EventTimeDto) => (t.dateTime ? Date.parse(t.dateTime) : t.date ? parseDate(t.date) : NaN);

/** Cor da conta no Quill (a mesma das bolinhas da caixa de entrada), ou a da agenda no Google. */
function accountColor(email: string) {
  return getMailbox().accounts.find((a) => a.id === email)?.color;
}

/** Agendas de feriados do Google ("pt.brazilian#holiday@…", "en.brazilian#holiday@…"): mesma região em idiomas diferentes. */
const HOLIDAY_RE = /^([a-z-]+)\.([a-z_]+)#holiday@group\.v\.calendar\.google\.com$/i;

/**
 * Feriados da mesma região assinados em mais de um idioma (ou em mais de uma conta) repetem todos os dias.
 * Fica só uma agenda por região, preferindo a em português.
 */
function holidayKeep(perAccount: { account: string; agenda: AgendaDto }[]): Set<string> {
  const best = new Map<string, { key: string; score: number }>();
  for (const { account, agenda } of perAccount) {
    for (const c of agenda.calendars) {
      const m = HOLIDAY_RE.exec(c.id);
      if (!m || !c.selected) continue;
      const score = m[1].startsWith("pt") ? 2 : 1;
      const cur = best.get(m[2]);
      if (!cur || score > cur.score) best.set(m[2], { key: `${account}|${c.id}`, score });
    }
  }
  return new Set([...best.values()].map((b) => b.key));
}

function mergeAgendas(perAccount: { account: string; agenda: AgendaDto }[]) {
  const calendars: AgendaCalendar[] = [];
  const byKey = new Map<string, AgendaEvent>();
  const keepHoliday = holidayKeep(perAccount);
  const skip = (account: string, id: string) => HOLIDAY_RE.test(id) && !keepHoliday.has(`${account}|${id}`);
  for (const { account, agenda } of perAccount) {
    for (const c of agenda.calendars.filter((c) => c.selected && !skip(account, c.id))) {
      calendars.push({
        key: `${account}|${c.id}`,
        account,
        id: c.id,
        name: c.primary ? (getMailbox().accounts.find((a) => a.id === account)?.name ?? c.name) : HOLIDAY_RE.test(c.id) ? "Feriados" : c.name,
        color: c.primary ? (accountColor(account) ?? c.color ?? "var(--blue)") : (c.color ?? "var(--blue)"),
        primary: c.primary,
        canEdit: c.canEdit,
      });
    }
    for (const e of agenda.events) {
      if (skip(account, e.calendarId)) continue;
      const start = toMs(e.start);
      const end = toMs(e.end);
      if (Number.isNaN(start)) continue;
      const calendarKey = `${account}|${e.calendarId}`;
      const copy: EventCopy = { account, calendarId: e.calendarId, calendarKey, eventId: e.id, myStatus: asStatus(e.myStatus) };
      const key = `${e.icalUid}|${start}`;
      const found = byKey.get(key);
      if (found) {
        // o mesmo convite em outra conta/agenda: junta, sem repetir
        if (!found.copies.some((c) => c.calendarKey === calendarKey)) found.copies.push(copy);
        if (!found.myStatus || found.myStatus === "needsAction") found.myStatus = copy.myStatus ?? found.myStatus;
        continue;
      }
      byKey.set(key, {
        key,
        title: e.title,
        start,
        end: Number.isNaN(end) ? start + 3600_000 : end,
        allDay: e.allDay,
        copies: [copy],
        color: "",
        location: e.location ?? undefined,
        description: e.description ?? undefined,
        meetUrl: e.meetUrl ?? undefined,
        htmlLink: e.htmlLink ?? undefined,
        organizer: e.organizerEmail || e.organizerName ? { name: e.organizerName ?? undefined, email: e.organizerEmail ?? undefined, self: e.organizerSelf } : undefined,
        attendees: e.attendees.map((a) => ({
          name: a.name || a.email,
          email: a.email,
          status: asStatus(a.status) ?? "needsAction",
          isSelf: a.isSelf,
          organizer: a.organizer,
        })),
        myStatus: copy.myStatus,
        recurring: e.recurring,
      });
    }
  }
  const colorOf = new Map(calendars.map((c) => [c.key, c.color]));
  const events = [...byKey.values()]
    .map((e) => ({ ...e, color: colorOf.get(e.copies[0].calendarKey) ?? "var(--blue)" }))
    .toSorted((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
  return { calendars, events };
}

/* ---------- prévia: eventos de exemplo ---------- */
function sampleState(): Pick<CalendarState, "calendars" | "events"> {
  const calendars: AgendaCalendar[] = SAMPLE_CALENDARS.map((c) => ({
    key: `exemplo|${c.id}`,
    account: c.provider || "Feriados",
    id: c.id,
    name: c.name,
    color: CAL_COLOR[c.id],
    primary: c.id !== "feriado",
    canEdit: c.id !== "feriado",
  }));
  const at = (day: number, hour = 0) => new Date(2026, 10, day, Math.floor(hour), Math.round((hour % 1) * 60)).getTime();
  const status = (s: string): RsvpStatus => (/confirm|organiz/i.test(s) ? "accepted" : /talvez/i.test(s) ? "tentative" : /recus/i.test(s) ? "declined" : "needsAction");
  const events: AgendaEvent[] = SAMPLE_EVENTS.map((e: SampleEvent) => {
    const allDay = !!e.allDay || e.start === undefined;
    const attendees: Attendee[] = (e.people ?? []).map((p) => ({
      name: p.name,
      email: "",
      status: status(p.status),
      isSelf: p.name === "Você",
      organizer: /organiz/i.test(p.status),
    }));
    const org = attendees.find((a) => a.organizer);
    return {
      key: e.id,
      title: e.title,
      start: allDay ? at(e.day) : at(e.day, e.start),
      end: allDay ? at((e.endDay ?? e.day) + 1) : at(e.day, e.end ?? (e.start ?? 0) + 1),
      allDay,
      copies: [{ account: "exemplo", calendarId: e.calendar, calendarKey: `exemplo|${e.calendar}`, eventId: e.id, myStatus: e.invite ? ("needsAction" as const) : undefined }],
      color: CAL_COLOR[e.calendar],
      location: e.place,
      description: e.description,
      meetUrl: e.meet ? `https://${e.meet}` : undefined,
      organizer: org ? { name: org.name, self: false } : undefined,
      attendees,
      myStatus: e.invite ? "needsAction" : attendees.find((a) => a.isSelf)?.status,
      recurring: e.id.startsWith("daily"),
    };
  }).toSorted((a, b) => a.start - b.start);
  return { calendars, events };
}

if (!isTauri) state = { ...state, ...sampleState(), status: "ready", loaded: { start: -Infinity, end: Infinity } };

/* ---------- carregar, responder e criar ---------- */
async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

let inflight: Promise<void> | null = null;

/**
 * Garante os eventos do intervalo [start, end). Carrega com folga (a semana/mês em volta)
 * e só busca de novo quando sai do que já está guardado, ou com `force`.
 */
export async function loadRange(start: Date, end: Date, force = false): Promise<void> {
  if (!isTauri) return;
  const accounts = getMailbox().connected;
  if (accounts.length === 0) {
    set({ calendars: [], events: [], loaded: null, status: "ready" });
    return;
  }
  const l = state.loaded;
  if (!force && l && start.getTime() >= l.start && end.getTime() <= l.end) return;
  if (inflight && !force) return inflight;
  // folga: começa no começo do mês anterior e vai até o fim do mês seguinte
  const from = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const to = new Date(end.getFullYear(), end.getMonth() + 2, 1);
  set({ status: "loading", error: null });
  inflight = (async () => {
    try {
      const perAccount = await Promise.all(
        accounts.map(async (a) => ({
          account: a.email,
          agenda: await call<AgendaDto>("calendar_agenda", { email: a.email, timeMin: from.toISOString(), timeMax: to.toISOString() }).catch(
            () => ({ calendars: [], events: [] }) as AgendaDto,
          ),
        })),
      );
      const merged = mergeAgendas(perAccount);
      set({ ...merged, loaded: { start: from.getTime(), end: to.getTime() }, status: "ready" });
    } catch (e) {
      set({ status: "error", error: friendlyError(e) });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Busca de novo o intervalo guardado (botão Atualizar, conta nova). */
export function reloadCalendar() {
  const l = state.loaded;
  const s = l && Number.isFinite(l.start) ? new Date(l.start) : startOfWeek(now());
  const e = l && Number.isFinite(l.end) ? new Date(l.end) : addDays(startOfWeek(now()), 7);
  return loadRange(s, e, true);
}

function patchEvent(key: string, patch: (e: AgendaEvent) => AgendaEvent) {
  set({ events: state.events.map((e) => (e.key === key ? patch(e) : e)) });
}

const RSVP_TEXT: Record<Exclude<RsvpStatus, "needsAction">, string> = {
  accepted: "Presença confirmada",
  tentative: "Respondido: talvez",
  declined: "Convite recusado",
};

/** Responde ao convite (sim/talvez/não) em todas as contas em que fui convidado. Atualiza na hora. */
export async function rsvpEvent(key: string, status: Exclude<RsvpStatus, "needsAction">) {
  const ev = state.events.find((e) => e.key === key);
  if (!ev) return;
  const before = ev;
  const setMine = (e: AgendaEvent): AgendaEvent => ({
    ...e,
    myStatus: status,
    copies: e.copies.map((c) => (c.myStatus ? { ...c, myStatus: status } : c)),
    attendees: e.attendees.map((a) => (a.isSelf ? { ...a, status } : a)),
  });
  patchEvent(key, setMine);
  if (!isTauri) return toast(RSVP_TEXT[status]);
  const targets = ev.copies.filter((c) => c.myStatus);
  try {
    await Promise.all(
      (targets.length ? targets : ev.copies.slice(0, 1)).map((c) =>
        call<void>("calendar_rsvp", { email: c.account, calendarId: c.calendarId, eventId: c.eventId, status }),
      ),
    );
    toast(RSVP_TEXT[status]);
  } catch (e) {
    patchEvent(key, () => before);
    toast(`Não deu certo: ${friendlyError(e)}`, "error");
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Data e hora com o fuso local (RFC 3339), como o Google espera. */
function rfc3339Local(d: Date) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Agendas onde dá para criar evento (a principal de cada conta primeiro). */
export function editableCalendars(s: CalendarState): AgendaCalendar[] {
  return s.calendars.filter((c) => c.canEdit).toSorted((a, b) => Number(b.primary) - Number(a.primary));
}

/** Cria o evento no Google Agenda e já mostra na tela. */
export async function createEvent(input: NewEventInput): Promise<AgendaEvent | undefined> {
  const cal = state.calendars.find((c) => c.key === input.calendarKey);
  if (!cal) {
    toast("Escolha uma agenda para o evento", "error");
    return;
  }
  const start = input.allDay ? { date: ymd(startOfDay(input.start)) } : { dateTime: rfc3339Local(input.start) };
  const endDate = input.allDay ? addDays(startOfDay(input.end), sameDay(input.start, input.end) ? 1 : 0) : input.end;
  const end = input.allDay ? { date: ymd(endDate) } : { dateTime: rfc3339Local(endDate) };
  const localEvent = (id: string): AgendaEvent => ({
    key: `novo-${id}`,
    title: input.title.trim() || "(sem título)",
    start: input.allDay ? startOfDay(input.start).getTime() : input.start.getTime(),
    end: endDate.getTime(),
    allDay: input.allDay,
    copies: [{ account: cal.account, calendarId: cal.id, calendarKey: cal.key, eventId: id }],
    color: cal.color,
    location: input.location?.trim() || undefined,
    attendees: [],
    organizer: { self: true },
    recurring: false,
  });
  if (!isTauri) {
    const e = localEvent(String(Date.now()));
    set({ events: [...state.events, e].toSorted((a, b) => a.start - b.start) });
    toast("Evento criado (prévia)");
    return e;
  }
  try {
    const dto = await call<CalEventDto>("calendar_create", {
      email: cal.account,
      calendarId: cal.id,
      event: { title: input.title, start, end, location: input.location ?? null },
    });
    const e = { ...localEvent(dto.id), key: `${dto.icalUid}|${toMs(dto.start)}`, htmlLink: dto.htmlLink ?? undefined };
    set({ events: [...state.events, e].toSorted((a, b) => a.start - b.start) });
    toast("Evento criado");
    return e;
  } catch (err) {
    toast(`Não criou o evento: ${friendlyError(err)}`, "error");
    return undefined;
  }
}

/** Texto da hora: "09:30 – 10:00" ou "Dia inteiro". */
export function timeRange(e: AgendaEvent) {
  if (e.allDay) return "Dia inteiro";
  const f = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${f(e.start)} – ${f(e.end)}`;
}

// quando os e-mails são buscados de novo (abrir o app, Atualizar, a cada 3 min, conta nova), a agenda acompanha
onMailboxLoaded(() => (state.loaded || state.status === "idle" ? reloadCalendar() : undefined));
