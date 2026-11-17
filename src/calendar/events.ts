import type { AccountId } from "../inbox/types";

/* Eventos de exemplo de novembro de 2026 (mesmos dos desenhos). */

export type CalendarId = AccountId | "feriado";

export interface CalEvent {
  id: string;
  /** dia de novembro (1–30) */
  day: number;
  /** último dia, para eventos de vários dias */
  endDay?: number;
  start?: number;
  end?: number;
  allDay?: boolean;
  title: string;
  calendar: CalendarId;
  place?: string;
  meet?: string;
  /** convite ainda sem resposta (Planejamento Q1) */
  invite?: boolean;
  description?: string;
  people?: { initials: string; name: string; tone: "peach" | "blue" | "neutral"; status: string; ok?: boolean }[];
}

export const TODAY = 17;
/** 09:20 */
export const NOW = 9 + 20 / 60;

export const CALENDARS: { id: CalendarId; name: string; provider: string }[] = [
  { id: "pessoal", name: "Pessoal", provider: "Gmail" },
  { id: "moradah", name: "Moradah", provider: "Gmail" },
  { id: "inchurch", name: "inchurch", provider: "Workspace" },
  { id: "outlook", name: "Outlook", provider: "Microsoft" },
  { id: "icloud", name: "Família", provider: "iCloud" },
  { id: "feriado", name: "Feriados no Brasil", provider: "" },
];

export const CAL_COLOR: Record<CalendarId, string> = {
  pessoal: "var(--acc-pessoal)",
  moradah: "var(--acc-moradah)",
  inchurch: "var(--acc-inchurch)",
  outlook: "var(--acc-outlook)",
  icloud: "var(--acc-icloud)",
  feriado: "#9a9aa0",
};

export const CAL_NAME: Record<CalendarId, string> = Object.fromEntries(CALENDARS.map((c) => [c.id, c.name])) as Record<
  CalendarId,
  string
>;

const HOLIDAYS = new Set([2, 15, 20]);
/** 1º de novembro de 2026 é domingo; semana começa na segunda. */
export const weekdayOf = (day: number) => (day + 5) % 7; // 0 = seg … 6 = dom

const DAILY_PEOPLE: CalEvent["people"] = [
  { initials: "RL", name: "Rafael Lima", tone: "neutral", status: "Organizador" },
  { initials: "MC", name: "Mariana Costa", tone: "peach", status: "Confirmou", ok: true },
  { initials: "GV", name: "Você", tone: "blue", status: "Confirmou", ok: true },
  { initials: "TS", name: "Thiago Santos", tone: "neutral", status: "Talvez" },
  { initials: "JP", name: "Júlia Pires", tone: "peach", status: "Confirmou", ok: true },
];

function dailies(): CalEvent[] {
  const out: CalEvent[] = [];
  for (let d = 1; d <= 30; d++) {
    if (weekdayOf(d) < 5 && !HOLIDAYS.has(d)) {
      out.push({
        id: `daily-${d}`,
        day: d,
        start: 9.5,
        end: 10,
        title: "Daily do time",
        calendar: "inchurch",
        meet: "meet.google.com/qwe-rtyu-iop",
        place: "Google Meet",
        description: "Pauta rápida: o que cada um fez ontem, o que faz hoje e se tem algo travando.",
        people: DAILY_PEOPLE,
      });
    }
  }
  return out;
}

function sundays(): CalEvent[] {
  return [1, 8, 15, 22, 29].map((d) => ({
    id: `culto-${d}`,
    day: d,
    start: 10,
    end: 11.5,
    title: "Culto de domingo",
    calendar: "pessoal" as const,
    place: "Igreja",
  }));
}

export const EVENTS: CalEvent[] = [
  ...dailies(),
  ...sundays(),
  { id: "finados", day: 2, allDay: true, title: "Finados", calendar: "feriado" },
  { id: "prazo-out", day: 5, allDay: true, title: "Prazo: fechamento de outubro", calendar: "inchurch" },
  { id: "campos", day: 6, endDay: 8, allDay: true, title: "Viagem para Campos", calendar: "icloud" },
  { id: "diretoria", day: 10, start: 10, end: 11, title: "Reunião de diretoria", calendar: "inchurch", place: "Sala Paulista" },
  { id: "ana", day: 12, allDay: true, title: "Aniversário da Ana", calendar: "icloud" },
  { id: "acad-13", day: 13, start: 19, end: 20, title: "Academia", calendar: "pessoal", place: "Smart Fit" },
  { id: "republica", day: 15, allDay: true, title: "Proclamação da República", calendar: "feriado" },
  { id: "1a1", day: 16, start: 14, end: 15, title: "1:1 com a Mariana", calendar: "inchurch", place: "Sala 3" },
  { id: "acad-16", day: 16, start: 19, end: 20, title: "Academia", calendar: "pessoal", place: "Smart Fit" },
  { id: "treino", day: 17, start: 8, end: 9, title: "Treino", calendar: "pessoal", place: "Smart Fit" },
  { id: "almoco", day: 17, start: 12.5, end: 13.5, title: "Almoço com o Lucas", calendar: "icloud", place: "Mercado de Pinheiros" },
  { id: "reels", day: 17, start: 15, end: 16.5, title: "Gravar Reels do Moradah", calendar: "moradah", place: "Estúdio · roteiro da série “Salmos”" },
  { id: "ingles", day: 17, start: 18.5, end: 19.5, title: "Aula de inglês", calendar: "pessoal", place: "Online" },
  { id: "anuncios", day: 18, start: 11, end: 12, title: "Revisão dos anúncios", calendar: "moradah", place: "Meta Ads" },
  { id: "dentista", day: 18, start: 16, end: 17, title: "Dentista", calendar: "pessoal", place: "Dra. Paula" },
  {
    id: "q1",
    day: 19,
    start: 10,
    end: 11.5,
    title: "Planejamento Q1",
    calendar: "inchurch",
    place: "Sala Paulista",
    meet: "meet.google.com/xpa-mnqr-tuv",
    invite: true,
    people: [
      { initials: "RL", name: "Rafael Lima", tone: "neutral", status: "Organizador" },
      { initials: "MC", name: "Mariana Costa", tone: "peach", status: "Confirmou", ok: true },
      { initials: "JP", name: "Júlia Pires", tone: "peach", status: "Confirmou", ok: true },
    ],
  },
  { id: "fornecedor", day: 19, start: 14, end: 15, title: "Call com fornecedor", calendar: "outlook", place: "Teams" },
  { id: "consciencia", day: 20, allDay: true, title: "Dia da Consciência Negra", calendar: "feriado" },
  { id: "brunch", day: 20, start: 11, end: 12.5, title: "Brunch com amigos", calendar: "icloud", place: "Pinheiros" },
  { id: "feira", day: 21, start: 10, end: 12, title: "Feira com a família", calendar: "icloud", place: "Benedito Calixto" },
  { id: "jantar", day: 22, start: 18, end: 19.5, title: "Jantar na casa dos pais", calendar: "icloud" },
  { id: "nubank", day: 24, allDay: true, title: "Vence fatura Nubank", calendar: "pessoal" },
  { id: "estreia", day: 26, start: 10, end: 11, title: "Estreia da série de Reels", calendar: "moradah" },
  { id: "casamento", day: 28, start: 16, end: 22, title: "Casamento do Pedro", calendar: "icloud" },
  { id: "fech-nov", day: 30, allDay: true, title: "Fechamento de novembro", calendar: "inchurch" },
];

export const fmtHour = (h: number) =>
  `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? String(Math.round((h % 1) * 60)).padStart(2, "0") : "00"}`;

const DOW_SHORT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const DOW_LONG = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];
export const dowShort = (day: number) => DOW_SHORT[weekdayOf(day)];
export const dowLong = (day: number) => DOW_LONG[weekdayOf(day)];
