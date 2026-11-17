import type { CSSProperties, ReactNode } from "react";
import { Check, CircleCheck } from "./icons";
import { RSVP_CONFIRM_MS, respondInvite, undoInvite, useStore } from "../state/store";
import type { Rsvp } from "../inbox/types";

const LABEL: Record<Rsvp, string> = {
  accepted: "Você aceitou",
  maybe: "Você respondeu talvez",
  declined: "Você recusou",
};

/** Botões do convite. Depois de responder, mostra a confirmação com a barrinha de tempo e some. */
export function RsvpButtons({ size }: { size?: "sm" }) {
  const rsvp = useStore((s) => s.rsvp);
  const sm = size === "sm" ? " sm" : "";

  if (rsvp.phase === "done") return null;
  if (rsvp.value) {
    return (
      <div className="rsvp" role="status">
        <span className="rsvp-done">
          <CircleCheck size={15} aria-hidden />
          {LABEL[rsvp.value]}
          <button onClick={undoInvite}>Desfazer</button>
          <span className="rsvp-timer" style={{ "--rsvp-ms": `${RSVP_CONFIRM_MS}ms` } as CSSProperties} aria-hidden />
        </span>
      </div>
    );
  }
  return (
    <div className="rsvp">
      <button className={`btn solid${sm}`} onClick={() => respondInvite("accepted")}>
        <Check size={sm ? 14 : 15} aria-hidden />
        Aceitar
      </button>
      <button className={`btn glass${sm}`} onClick={() => respondInvite("maybe")}>Talvez</button>
      <button className={`btn glass${sm}`} onClick={() => respondInvite("declined")}>Recusar</button>
    </div>
  );
}

/** Envolve um bloco que deve sumir depois da resposta ao convite (cartão "Convite pendente" etc.). */
export function InviteGate({ children, className = "" }: { children: ReactNode; className?: string }) {
  const phase = useStore((s) => s.rsvp.phase);
  if (phase === "done") return null;
  return <div className={`${className}${phase === "leaving" ? " invite-leaving" : ""}`}>{children}</div>;
}
