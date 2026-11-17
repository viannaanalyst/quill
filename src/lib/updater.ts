import { useSyncExternalStore } from "react";
import { isTauri } from "./platform";

/**
 * Atualização automática: confere no GitHub (releases do Quill) se há versão nova, assinada com a chave do app.
 * Confere ao abrir e a cada 6 h; a pessoa escolhe quando instalar (baixa, instala e reabre).
 */
export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "none" | "error";

interface UpdateState {
  phase: UpdatePhase;
  version?: string;
  notes?: string;
  /** 0–1 durante o download */
  progress?: number;
  error?: string;
}

let state: UpdateState = { phase: "idle" };
const listeners = new Set<() => void>();
const set = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useUpdate() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;
let pending: Update = null;

/** Procura versão nova. `quiet` não mostra erro (conferência automática). */
export async function checkForUpdate(quiet = true) {
  if (!isTauri || state.phase === "downloading") return;
  set({ phase: "checking", error: undefined });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    pending = await check();
    if (pending) set({ phase: "available", version: pending.version, notes: pending.body ?? undefined });
    else set({ phase: "none" });
  } catch (e) {
    set({ phase: quiet ? "idle" : "error", error: String((e as Error)?.message ?? e) });
  }
}

/** Baixa, instala e reabre o Quill. */
export async function installUpdate() {
  if (!pending) return;
  let total = 0;
  let got = 0;
  set({ phase: "downloading", progress: 0 });
  try {
    await pending.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        set({ progress: total ? Math.min(1, got / total) : undefined });
      } else if (ev.event === "Finished") set({ phase: "ready", progress: 1 });
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    set({ phase: "error", error: String((e as Error)?.message ?? e) });
  }
}

let timer: number | undefined;
/** Confere 10 s depois de abrir e depois a cada 6 horas. */
export function startUpdateChecks() {
  if (!isTauri) return;
  window.setTimeout(() => void checkForUpdate(true), 10_000);
  window.clearInterval(timer);
  timer = window.setInterval(() => void checkForUpdate(true), 6 * 3600_000);
}

/** Versão instalada (do tauri.conf.json). */
export async function appVersion(): Promise<string> {
  if (!isTauri) return "prévia";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "";
  }
}
