import { useEffect, useState } from "react";
import { navigate, type CalendarMode } from "../state/store";
import { now, type AgendaCalendar, type AgendaEvent } from "../state/calendar";

/*
 * Peças pequenas usadas pelo Calendário e pelo cartão "Hoje" da caixa de entrada.
 * Fica fora de Calendar.tsx para a caixa de entrada não carregar a tela do calendário.
 */

/** "Agora" que se atualiza a cada virada de minuto (na prévia fica parado em 17/11/2026 09:20). */
export function useClock(): number {
  const [t, setT] = useState(now);
  useEffect(() => {
    let interval = 0;
    const first = window.setTimeout(
      () => {
        setT(now());
        interval = window.setInterval(() => setT(now()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, []);
  return t;
}

/** Primeira letra maiúscula ("terça-feira" → "Terça-feira"). */
export const cap = (s: string) => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);
const noDot = (s: string) => s.replace(/\.$/, "");

/** "09:30" */
export const fmtTime = (t: number | Date) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
/** "seg", "ter", "sáb" */
export const dowShort = (t: number | Date) => noDot(new Date(t).toLocaleDateString("pt-BR", { weekday: "short" }));
/** "Terça-feira" */
export const dowLong = (t: number | Date) => cap(new Date(t).toLocaleDateString("pt-BR", { weekday: "long" }));
/** "nov" */
export const monthShort = (t: number | Date) => noDot(new Date(t).toLocaleDateString("pt-BR", { month: "short" }));
/** "Terça-feira, 17 de novembro" */
export const dayLong = (t: number | Date) => cap(new Date(t).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }));
/** "Qui, 19 nov" */
export const dayShort = (t: number | Date) => `${cap(dowShort(t))}, ${new Date(t).getDate()} ${monthShort(t)}`;

/** Duração curta: "30 min", "1h", "1h30". */
export function fmtDuration(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** Link do Meet sem o "https://", para mostrar. */
export const meetLabel = (url: string) => url.replace(/^https?:\/\//, "");

/** Cor e nome de cada agenda pela chave (memorizado por lista de agendas). */
let mapCache: { list: AgendaCalendar[]; map: Map<string, AgendaCalendar> } | null = null;
export function calendarMap(list: AgendaCalendar[]) {
  if (mapCache?.list !== list) mapCache = { list, map: new Map(list.map((c) => [c.key, c])) };
  return mapCache.map;
}

/** Busca do calendário: título, local ou nome/e-mail de convidado. */
export function matchesQuery(e: AgendaEvent, q: string) {
  if (!q) return true;
  const hay = [e.title, e.location, e.organizer?.name, ...e.attendees.flatMap((a) => [a.name, a.email])]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("pt-BR");
  return hay.includes(q);
}

/* ---------- pedido de outra tela para o Calendário abrir num dia ---------- */
let intent: { day: number; create: boolean } | null = null;

/** Abre o Calendário já no dia pedido (e, se `create`, com o "Novo evento" aberto). */
export function openCalendarAt(mode: CalendarMode, day: number, create = false) {
  intent = { day, create };
  navigate({ name: "calendar", mode });
}
export const peekCalendarIntent = () => intent;
export const clearCalendarIntent = () => {
  intent = null;
};
