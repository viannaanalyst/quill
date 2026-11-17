import { api, type ChatAttachmentDto } from "../lib/api";
import { isTauri } from "../lib/platform";

/**
 * Conteúdo dos anexos do Chat: baixado pela parte nativa (base64, até 50 MB), virado Blob
 * e guardado na memória (os 40 mais recentes) para a miniatura, o player e a prévia.
 */

const MAX = 40;
const cache = new Map<string, Promise<Blob>>();
/** Arquivos que acabaram de ser enviados nesta sessão (a prévia usa o próprio arquivo). */
const local = new Map<string, Blob>();

export function rememberLocal(resource: string, blob: Blob) {
  local.set(resource, blob);
}

export function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("Não consegui ler o arquivo."));
    r.readAsDataURL(blob);
  });
}

/** Tipo do anexo para o player (o Chat às vezes manda vazio). */
export function kindOf(a: Pick<ChatAttachmentDto, "name" | "contentType">): "image" | "video" | "audio" | "file" {
  const t = (a.contentType ?? "").toLowerCase();
  const ext = a.name.split(".").pop()?.toLowerCase() ?? "";
  if (t.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "image";
  if (t.startsWith("video/") || ["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (t.startsWith("audio/") || ["m4a", "mp3", "wav", "aac", "ogg", "opus"].includes(ext)) return "audio";
  return "file";
}

/** Conteúdo do anexo (uma vez por anexo; os pedidos repetidos esperam o mesmo download). */
export function loadAttachment(account: string, a: ChatAttachmentDto): Promise<Blob> {
  const res = a.resourceName;
  if (!res) return Promise.reject(new Error("Esse anexo não pode ser aberto no Quill."));
  const own = local.get(res);
  if (own) return Promise.resolve(own);
  const hit = cache.get(res);
  if (hit) {
    cache.delete(res);
    cache.set(res, hit);
    return hit;
  }
  const type = a.contentType || "application/octet-stream";
  const p = isTauri
    ? api.chatAttachment(account, res).then((b64) => base64ToBlob(b64, type))
    : import("./sample").then((s) => s.sampleBlob(res, type));
  p.catch(() => cache.delete(res));
  cache.set(res, p);
  while (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return p;
}

/** "1:24" a partir de segundos. */
export function clock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Barrinhas da ondinha de um áudio: alturas estáveis tiradas do nome (o Chat não manda a forma da onda). */
export function waveOf(seed: string, n = 38): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    out.push(5 + (Math.abs(h) % 21));
  }
  return out;
}
