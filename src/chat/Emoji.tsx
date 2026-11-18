import { useReducer, useState, useSyncExternalStore } from "react";
import { notoCode, notoUrl } from "./noto";

/**
 * Emoji do Google (Noto Animated Emoji), como no Google Chat:
 * - `always`: emojis das mensagens, animados (grandes na mensagem só de emoji, do tamanho da letra no texto);
 * - `hover`: chips de reação e reações rápidas, parado e animando só com o mouse em cima (`playing`).
 * O desenho parado fica embaixo enquanto o animado carrega. Se o Google não tiver a animação, fica o
 * parado; se nem ele abrir (sem internet), volta o caractere. Com "reduzir movimento", nunca anima.
 */

/** Emojis cujo arquivo não abriu (não pede de novo a cada passada do mouse). */
const noAnim = new Set<string>();
const noStill = new Set<string>();

const reduceQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      reduceQuery?.addEventListener("change", cb);
      return () => reduceQuery?.removeEventListener("change", cb);
    },
    () => !!reduceQuery?.matches,
  );
}

/** Liga a animação enquanto o mouse está em cima do botão. */
export function useHoverPlay() {
  const [playing, setPlaying] = useState(false);
  return [playing, { onPointerEnter: () => setPlaying(true), onPointerLeave: () => setPlaying(false) }] as const;
}

export function NotoEmoji({ emoji, animate, playing = false }: { emoji: string; animate: "always" | "hover"; playing?: boolean }) {
  const reduce = useReducedMotion();
  const [, retry] = useReducer((n: number) => n + 1, 0);
  const [ready, setReady] = useState(false);
  const code = notoCode(emoji);
  const wantAnim = !reduce && (animate === "always" || playing) && !noAnim.has(code);
  const still = !noStill.has(code);
  if (!wantAnim && ready) setReady(false);
  if (!still && !wantAnim) return <span className="chat-emo">{emoji}</span>;
  const big = animate === "always";
  return (
    <span className={`chat-nemo${ready ? " is-anim" : ""}`} role={big ? "img" : undefined} aria-label={big ? emoji : undefined} aria-hidden={big ? undefined : true}>
      {still && (
        <img
          className="chat-nemo-still"
          src={notoUrl(emoji, "still")}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => {
            noStill.add(code);
            retry();
          }}
        />
      )}
      {wantAnim && (
        <img
          className="chat-nemo-anim"
          src={notoUrl(emoji, "anim")}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => setReady(true)}
          onError={() => {
            noAnim.add(code);
            retry();
          }}
        />
      )}
    </span>
  );
}
