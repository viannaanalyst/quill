import { useSyncExternalStore } from "react";

/** Abre/fecha a busca geral (⌘K) de qualquer lugar, sem carregar a paleta antes da hora. */
let state = { open: false, query: "" };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openPalette(query = "") {
  state = { open: true, query };
  emit();
}
export function closePalette() {
  state = { ...state, open: false };
  emit();
}
export function togglePalette() {
  if (state.open) {
    closePalette();
  } else {
    openPalette();
  }
}
export function usePalette() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}
