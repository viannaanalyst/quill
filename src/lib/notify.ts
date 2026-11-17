import { isTauri } from "./platform";
import { getPref } from "./storage";
import pop from "../assets/sounds/pop.mp3";
import gota from "../assets/sounds/gota.mp3";
import sino from "../assets/sounds/sino.mp3";
import cristal from "../assets/sounds/cristal.mp3";
import marimba from "../assets/sounds/marimba.mp3";
import brisa from "../assets/sounds/brisa.mp3";

/**
 * Avisos do sistema (e-mail novo e mensagem no Chat) com o som escolhido em Ajustes → Notificações.
 * Com o Quill na frente, só toca o som (o sino e as bolinhas já mostram); com o Quill atrás, aparece o aviso do macOS.
 */
export const SOUNDS: { id: string; label: string; src: string }[] = [
  { id: "pop", label: "Pop", src: pop },
  { id: "gota", label: "Gota", src: gota },
  { id: "sino", label: "Sino", src: sino },
  { id: "cristal", label: "Cristal", src: cristal },
  { id: "marimba", label: "Marimba", src: marimba },
  { id: "brisa", label: "Brisa", src: brisa },
];

export type NotifyKind = "email" | "chat";

const SOUND_PREF: Record<NotifyKind, string> = { email: "notifySoundEmail", chat: "notifySoundChat" };

/** Toca um som pelo id ("pop", "gota"…); "none" não toca nada. */
export function playSound(id: string) {
  const s = SOUNDS.find((x) => x.id === id);
  if (!s) return;
  try {
    const a = new Audio(s.src);
    a.volume = 0.7;
    void a.play().catch(() => undefined);
  } catch {
    /* sem áudio disponível */
  }
}

/** Dentro do horário silencioso (ex.: 22:00 até 07:00, atravessando a meia-noite)? */
export function inQuietHours(now = new Date()) {
  if (!getPref("quietHours", false)) return false;
  const toMin = (v: string) => {
    const [h, m] = v.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const from = toMin(getPref("quietFrom", "22:00"));
  const to = toMin(getPref("quietTo", "07:00"));
  const cur = now.getHours() * 60 + now.getMinutes();
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to;
}

/** Remetente automático (propaganda, newsletter, aviso de sistema)? Usado no "Só de pessoas". */
export function isAutomatedSender(email: string | undefined) {
  return !!email && /(no-?reply|do-?not-?reply|notifica|newsletter|mailer|marketing|news@|info@|promo|bounce|alerts?@)/i.test(email);
}

let permission: boolean | null = null;
async function canNotify() {
  if (!isTauri) return false;
  if (permission !== null) return permission;
  try {
    const n = await import("@tauri-apps/plugin-notification");
    permission = (await n.isPermissionGranted()) || (await n.requestPermission()) === "granted";
  } catch {
    permission = false;
  }
  return permission;
}

/** Avisa: som (se ligado) e, com o Quill em segundo plano, o aviso do sistema. Respeita as preferências. */
export async function notify(kind: NotifyKind, title: string, body: string) {
  const enabled = kind === "email" ? getPref("notify", true) : getPref("notifyChat", true);
  if (!enabled || inQuietHours()) return;
  if (getPref("notifySound", true)) playSound(getPref(SOUND_PREF[kind], "pop"));
  if (typeof document !== "undefined" && document.hasFocus()) return;
  if (!(await canNotify())) return;
  try {
    const n = await import("@tauri-apps/plugin-notification");
    n.sendNotification({ title, body: body.slice(0, 180) });
  } catch {
    /* sem aviso do sistema: o som e o sino já avisaram */
  }
}
