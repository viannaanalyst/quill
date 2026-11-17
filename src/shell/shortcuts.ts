import { useEffect } from "react";
import { openPalette, togglePalette } from "../components/paletteState";
import { refreshMailbox } from "../state/mailbox";
import { navigate } from "../state/store";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

/**
 * Atalhos do app inteiro:
 * ⌘K busca geral · ⌘, Ajustes · ⌘N escrever · ⌘R atualizar
 * e, fora de campos de texto: C escrever · / buscar · G depois E (Entrada) ou C (Calendário).
 */
export function useShortcuts() {
  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && !e.shiftKey && !e.altKey) {
        if (k === "k") {
          e.preventDefault();
          togglePalette();
        } else if (k === ",") {
          e.preventDefault();
          navigate({ name: "settings" });
        } else if (k === "n") {
          e.preventDefault();
          navigate({ name: "compose" });
        } else if (k === "r") {
          e.preventDefault();
          void refreshMailbox();
        }
        return;
      }
      if (mod || e.altKey || isTyping(e.target) || document.querySelector("[role=dialog]")) return;
      if (Date.now() - gAt < 900) {
        gAt = 0;
        if (k === "e") navigate({ name: "inbox", folder: "inbox" });
        else if (k === "c") navigate({ name: "calendar", mode: "week" });
        return;
      }
      if (k === "g") gAt = Date.now();
      else if (k === "c") navigate({ name: "compose" });
      else if (k === "/") {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
