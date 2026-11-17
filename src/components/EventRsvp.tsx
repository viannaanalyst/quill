import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, CircleCheck } from "./icons";
import { rsvpEvent, type RsvpStatus } from "../state/calendar";
import { RSVP_CONFIRM_MS } from "../state/store";

type Answer = Exclude<RsvpStatus, "needsAction">;

const LABEL: Record<Answer, string> = {
  accepted: "Você aceitou",
  tentative: "Você respondeu talvez",
  declined: "Você recusou",
};
const LEAVE_MS = 260;

export interface EventRsvpState {
  answer: Answer | null;
  /** a confirmação acabou e o bloco está saindo (aplicar `invite-leaving`) */
  leaving: boolean;
  respond: (a: Answer) => void;
  undo: () => void;
}

/**
 * Resposta a um convite da agenda: mostra a confirmação com a barrinha de 4 s (dá para desfazer)
 * e só então envia ao Google. Se o bloco sumir antes (fechou o cartão, trocou de dia), envia na hora.
 */
export function useEventRsvp(key: string, onDone?: () => void): EventRsvpState {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [leaving, setLeaving] = useState(false);
  const pending = useRef<{ key: string; answer: Answer } | null>(null);
  const timers = useRef<number[]>([]);
  const done = useRef(onDone);
  done.current = onDone;

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  const commit = () => {
    const p = pending.current;
    pending.current = null;
    clear();
    if (!p) return;
    void rsvpEvent(p.key, p.answer);
    setAnswer(null);
    setLeaving(false);
    done.current?.();
  };
  // saiu da tela no meio da confirmação: a resposta não se perde
  useEffect(() => () => commit(), []);

  return {
    answer,
    leaving,
    respond: (a) => {
      clear();
      pending.current = { key, answer: a };
      setAnswer(a);
      setLeaving(false);
      timers.current.push(
        window.setTimeout(() => setLeaving(true), RSVP_CONFIRM_MS),
        window.setTimeout(commit, RSVP_CONFIRM_MS + LEAVE_MS),
      );
    },
    undo: () => {
      clear();
      pending.current = null;
      setAnswer(null);
      setLeaving(false);
    },
  };
}

/** Aceitar / Talvez / Recusar, ou a confirmação com a barrinha de tempo. */
export function EventRsvpButtons({ rsvp, size }: { rsvp: EventRsvpState; size?: "sm" }) {
  const sm = size === "sm" ? " sm" : "";
  if (rsvp.answer) {
    return (
      <div className="rsvp" role="status">
        <span className="rsvp-done">
          <CircleCheck size={15} aria-hidden />
          {LABEL[rsvp.answer]}
          <button onClick={rsvp.undo}>Desfazer</button>
          <span className="rsvp-timer" style={{ "--rsvp-ms": `${RSVP_CONFIRM_MS}ms` } as CSSProperties} aria-hidden />
        </span>
      </div>
    );
  }
  return (
    <div className="rsvp">
      <button className={`btn solid${sm}`} onClick={() => rsvp.respond("accepted")}>
        <Check size={sm ? 14 : 15} aria-hidden />
        Aceitar
      </button>
      <button className={`btn glass${sm}`} onClick={() => rsvp.respond("tentative")}>
        Talvez
      </button>
      <button className={`btn glass${sm}`} onClick={() => rsvp.respond("declined")}>
        Recusar
      </button>
    </div>
  );
}
