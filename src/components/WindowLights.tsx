import { isTauri } from "../lib/platform";

/**
 * Botões vermelho/amarelo/verde do macOS. No app de verdade quem desenha é o próprio sistema
 * (janela com barra de título transparente); aqui só aparecem na prévia pelo navegador.
 */
export function WindowLights({ className = "" }: { className?: string }) {
  if (isTauri) return null;
  return (
    <div className={`window-lights ${className}`} aria-hidden>
      <span style={{ background: "#FF5F57" }} />
      <span style={{ background: "#FEBC2E" }} />
      <span style={{ background: "#28C840" }} />
    </div>
  );
}
