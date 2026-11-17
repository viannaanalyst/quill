import { useSyncExternalStore } from "react";
import { isTauri } from "../lib/platform";
import { getPref, setPref } from "../lib/storage";
import { getMailbox } from "./mailbox";

/** Sugestão de destinatário (como no Gmail): contatos do Google + quem aparece nos seus enviados. */
export interface SuggestedContact {
  name?: string | null;
  email: string;
  photo?: string | null;
  score: number;
}

interface CacheEntry {
  at: number;
  list: SuggestedContact[];
}

/** Guardado neste computador por 6 h (a busca no Google leva alguns segundos). */
const TTL = 6 * 3600_000;
const KEY = "contacts.cache";

let list: SuggestedContact[] = mergeAll(getPref<Record<string, CacheEntry>>(KEY, {}));
let loading = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function mergeAll(cache: Record<string, CacheEntry>): SuggestedContact[] {
  const by = new Map<string, SuggestedContact>();
  for (const entry of Object.values(cache)) {
    for (const c of entry.list) {
      const k = c.email.toLowerCase();
      const cur = by.get(k);
      if (!cur) by.set(k, { ...c });
      else {
        cur.score += c.score;
        cur.name ??= c.name;
        cur.photo ??= c.photo;
      }
    }
  }
  return [...by.values()].toSorted((a, b) => b.score - a.score);
}

export function useContacts(): SuggestedContact[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => list,
  );
}

/** Busca as sugestões de todas as contas (só as que estão vencidas, a não ser com `force`). */
export async function loadContacts(force = false) {
  if (!isTauri || loading) return;
  const accounts = getMailbox().connected;
  if (accounts.length === 0) return;
  const cache = getPref<Record<string, CacheEntry>>(KEY, {});
  const stale = accounts.filter((a) => force || !cache[a.email] || Date.now() - cache[a.email].at > TTL);
  if (stale.length === 0) return;
  loading = true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const results = await Promise.all(
      stale.map((a) => invoke<SuggestedContact[]>("contacts_list", { email: a.email }).then((l) => [a.email, l] as const).catch(() => null)),
    );
    for (const r of results) if (r) cache[r[0]] = { at: Date.now(), list: r[1].slice(0, 2000) };
    // só as contas que ainda estão conectadas
    const kept = Object.fromEntries(Object.entries(cache).filter(([email]) => accounts.some((a) => a.email === email)));
    setPref(KEY, kept);
    list = mergeAll(kept);
    emit();
  } finally {
    loading = false;
  }
}
