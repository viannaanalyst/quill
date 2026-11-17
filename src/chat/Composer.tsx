import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { chatUpload, friendlyError, type ChatAttachmentRef, type ChatMessageDto } from "../lib/api";
import { devParams, isTauri } from "../lib/platform";
import { fileSize, mimeFor } from "../lib/files";
import { FileIcon } from "../components/FileIcon";
import { previewAttachment } from "../components/AttachmentPreview";
import { toast } from "../components/Toasts";
import { Check, LoaderCircle, Mic, Paperclip, Pause, Play, RotateCcw, SendHorizontal, Smile, Trash2, X } from "../components/icons";
import { pendingFile, sendChat, type PendingFile } from "../state/chat";
import { AudioPlayer } from "./Messages";
import { blobToBase64, clock, kindOf } from "./media";
import { plainChat } from "./format";

const MAX_FILE = 200 * 1024 * 1024;
const EMOJIS = ["😀", "😂", "😊", "😍", "🤔", "😅", "😢", "😮", "👍", "👎", "👏", "🙏", "🙌", "💪", "🎉", "🔥", "✅", "❌", "⚠️", "❤️", "💙", "💚", "⭐", "☕", "🚀", "📌", "📎", "📅", "⏰", "👀", "🤝", "💡"];

/** Arquivo na caixa de escrever: sobe para o Chat assim que entra (como no desenho). */
interface Staged extends PendingFile {
  status: "uploading" | "ready" | "error";
  error?: string;
}

/** Prévia: ?chat=att mostra dois anexos subindo, como no desenho. */
function previewStaged(): Staged[] {
  if (isTauri || devParams.get("chat") !== "att") return [];
  const svg = (fill: string) => new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 52"><rect width="68" height="52" fill="${fill}"/><rect x="8" y="8" width="52" height="36" rx="3" fill="#fff"/><path d="M14 16h20M14 22h12" stroke="#4F86B5" stroke-width="2"/><path d="M40 36l6-6 5 3 6-9" fill="none" stroke="#6F9068" stroke-width="2"/></svg>`], { type: "image/svg+xml" });
  return [
    { ...pendingFile(svg("#E3EAF1"), "quadro-reuniao.jpg", "image/svg+xml"), size: 1_887_437, progress: 1, status: "ready", ref: { attachmentUploadToken: "p" } },
    { ...pendingFile(svg("#26333F"), "passo-a-passo-fechamento.mp4", "image/svg+xml"), size: 20_237_516, progress: 0.64, status: "uploading" },
  ];
}

function previewStagedFile(f: Staged) {
  previewAttachment({ name: f.name, mime: f.type, size: f.size, load: () => blobToBase64(f.file) });
}

function StagedCard({ f, onRemove, onRetry }: { f: Staged; onRemove: () => void; onRetry: () => void }) {
  const k = kindOf({ name: f.name, contentType: f.type });
  return (
    <div className="chat-at">
      <button type="button" className="chat-th" onClick={() => previewStagedFile(f)} aria-label={`Ver ${f.name}`}>
        {f.thumb && k === "image" ? (
          <img src={f.thumb} alt="" />
        ) : f.thumb && k === "video" && !f.type.startsWith("image/") ? (
          <video src={f.thumb} muted preload="metadata" />
        ) : (
          <FileIcon name={f.name} mime={f.type} size={34} />
        )}
        {(k === "video" || f.name.endsWith(".mp4")) && (
          <span className="chat-mp" aria-hidden>
            <Play size={11} />
          </span>
        )}
      </button>
      <div className="chat-file-info">
        <div className="chat-fn">{f.name}</div>
        {f.status === "ready" && (
          <div className="chat-am">
            {fileSize(f.size)} · <Check size={13} className="chat-ok" aria-hidden />
            Pronto
          </div>
        )}
        {f.status === "uploading" && (
          <>
            <div className="chat-am">
              Enviando… {fileSize(Math.round(f.progress * f.size)) || "0 B"} de {fileSize(f.size)}
              <b className="chat-pct">{Math.round(f.progress * 100)}%</b>
            </div>
            <div className="chat-prog" role="progressbar" aria-label={`Enviando ${f.name}`} aria-valuenow={Math.round(f.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ transform: `scaleX(${f.progress})` }} />
            </div>
          </>
        )}
        {f.status === "error" && (
          <div className="chat-am chat-err" role="alert">
            Não subiu.
            <button type="button" className="chat-link" onClick={onRetry}>
              <RotateCcw size={12} aria-hidden />
              Tentar de novo
            </button>
          </div>
        )}
      </div>
      <button type="button" className="chat-ax" onClick={onRemove} aria-label={`Tirar ${f.name}`}>
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}

/* ---------- gravação de áudio ---------- */
type Rec =
  | { phase: "idle" }
  | { phase: "recording"; started: number; elapsed: number; levels: number[] }
  | { phase: "review"; blob: Blob; url: string; seconds: number; type: string };

/** Tipo de áudio que o WebView sabe gravar (o Safari/WKWebView grava mp4; os outros, webm). */
function recordType(): { mime: string; ext: string } {
  const can = (t: string) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t);
  if (can("audio/mp4")) return { mime: "audio/mp4", ext: "m4a" };
  if (can("audio/webm;codecs=opus")) return { mime: "audio/webm;codecs=opus", ext: "webm" };
  return { mime: "audio/webm", ext: "webm" };
}

function micError(e: unknown): string {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "O Quill não tem permissão para usar o microfone. Libere em Ajustes do Sistema → Privacidade e Segurança → Microfone.";
  if (name === "NotFoundError") return "Nenhum microfone encontrado neste computador.";
  if (name === "NotReadableError") return "O microfone está sendo usado por outro app.";
  return "Não consegui usar o microfone.";
}

function useRecorder(onError: (msg: string) => void) {
  const [rec, setRec] = useState<Rec>(() =>
    !isTauri && devParams.get("chat") === "rec"
      ? { phase: "recording", started: Date.now() - 7000, elapsed: 7, levels: Array.from({ length: 52 }, (_, i) => 5 + ((i * 37) % 19)) }
      : { phase: "idle" },
  );
  const parts = useRef<{ stream?: MediaStream; recorder?: MediaRecorder; ctx?: AudioContext; timer?: number; started?: number; chunks: Blob[]; type: string; ext: string }>({ chunks: [], type: "", ext: "" });

  const cleanup = () => {
    const p = parts.current;
    window.clearInterval(p.timer);
    p.stream?.getTracks().forEach((t) => t.stop());
    void p.ctx?.close().catch(() => undefined);
    parts.current = { chunks: [], type: "", ext: "" };
  };
  useEffect(() => cleanup, []);

  async function start() {
    if (rec.phase === "recording") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("Este computador não deixou o Quill gravar áudio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { mime, ext } = recordType();
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.start(250);
      const started = Date.now();
      const timer = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += (v - 128) ** 2;
        const level = Math.min(26, 4 + Math.sqrt(sum / data.length) * 1.4);
        setRec((r) => (r.phase === "recording" ? { ...r, elapsed: (Date.now() - started) / 1000, levels: [...r.levels.slice(-79), level] } : r));
      }, 110);
      parts.current = { stream, recorder, ctx, timer, started, chunks, type: mime.split(";")[0], ext };
      setRec({ phase: "recording", started, elapsed: 0, levels: [] });
    } catch (e) {
      cleanup();
      onError(micError(e));
    }
  }

  /** Para a gravação e devolve o áudio. */
  function stop(): Promise<{ blob: Blob; seconds: number; type: string; ext: string } | null> {
    const p = parts.current;
    if (!p.recorder || p.recorder.state === "inactive") return Promise.resolve(null);
    const seconds = (Date.now() - (p.started ?? Date.now())) / 1000;
    return new Promise((resolve) => {
      p.recorder!.onstop = () => {
        const out = { blob: new Blob(p.chunks, { type: p.type }), seconds, type: p.type, ext: p.ext };
        cleanup();
        resolve(out.blob.size ? out : null);
      };
      p.recorder!.stop();
    });
  }

  async function review() {
    const got = await stop();
    if (!got) return setRec({ phase: "idle" });
    setRec({ phase: "review", blob: got.blob, url: URL.createObjectURL(got.blob), seconds: got.seconds, type: got.type });
  }

  function cancel() {
    if (rec.phase === "review") URL.revokeObjectURL(rec.url);
    if (parts.current.recorder?.state === "recording") parts.current.recorder.stop();
    cleanup();
    setRec({ phase: "idle" });
  }

  /** Há quanto tempo o gravador está gravando (0 = ainda não começou, ex.: esperando a permissão). */
  const runningFor = () => (parts.current.recorder?.state === "recording" ? Date.now() - (parts.current.started ?? Date.now()) : 0);

  return { rec, start, stop, review, cancel, runningFor, ext: () => parts.current.ext || recordType().ext };
}

const audioName = (ext: string) => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `Áudio ${p(d.getDate())}-${p(d.getMonth() + 1)} ${p(d.getHours())}h${p(d.getMinutes())}.${ext}`;
};

/* ---------- caixa de escrever ---------- */
export function Composer({
  account,
  space,
  replyTo,
  onClearReply,
  dropped,
}: {
  account: string;
  space: string;
  replyTo: ChatMessageDto | null;
  onClearReply: () => void;
  /** arquivos soltos sobre a conversa (o Chat passa para cá) */
  dropped: { files: File[]; seq: number } | null;
}) {
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<Staged[]>(previewStaged);
  const [waiting, setWaiting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { rec, start, stop, review, cancel, runningFor, ext } = useRecorder((msg) => {
    setNote(msg);
    toast(msg, "error");
  });

  // "Responder no fio": o cursor vai para a caixa
  useEffect(() => {
    if (replyTo) area.current?.focus({ preventScroll: true });
  }, [replyTo]);

  // trocou de conversa: começa vazio (não na primeira vez)
  const lastSpace = useRef(space);
  useEffect(() => {
    if (lastSpace.current === space) return;
    lastSpace.current = space;
    setText("");
    setStaged((list) => {
      list.forEach((f) => f.thumb && URL.revokeObjectURL(f.thumb));
      return previewStaged();
    });
    setNote(null);
  }, [space]);

  const patch = (id: string, p: Partial<Staged>) => setStaged((list) => list.map((f) => (f.id === id ? { ...f, ...p } : f)));

  function upload(f: Staged) {
    patch(f.id, { status: "uploading", progress: 0, error: undefined });
    const done = (ref: ChatAttachmentRef) => patch(f.id, { status: "ready", ref, progress: 1 });
    const fail = (e: unknown) => patch(f.id, { status: "error", error: friendlyError(e) });
    if (!isTauri) {
      let p = 0;
      const t = window.setInterval(() => {
        p = Math.min(1, p + 0.1);
        patch(f.id, { progress: p });
        if (p >= 1) {
          window.clearInterval(t);
          done({ attachmentUploadToken: "previa" });
        }
      }, 160);
      return;
    }
    chatUpload(account, space, f.file, f.name, f.type, (p) => patch(f.id, { progress: p })).then(done, fail);
  }

  function addFiles(files: File[] | FileList) {
    const list = [...files];
    const big = list.filter((f) => f.size > MAX_FILE);
    if (big.length) toast(`${big.map((f) => f.name).join(", ")}: o Google Chat aceita arquivos de até 200 MB.`, "error");
    const ok = list.filter((f) => f.size <= MAX_FILE && f.size > 0);
    const items: Staged[] = ok.map((f) => ({ ...pendingFile(f, f.name || "imagem.png", mimeFor(f)), status: "uploading" }));
    setStaged((s) => [...s, ...items]);
    items.forEach(upload);
    area.current?.focus();
  }

  // arquivos soltos sobre a conversa
  const lastDrop = useRef(0);
  useEffect(() => {
    if (dropped && dropped.seq !== lastDrop.current) {
      lastDrop.current = dropped.seq;
      addFiles(dropped.files);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropped]);

  // envia quando os anexos terminarem de subir
  useEffect(() => {
    if (!waiting) return;
    if (staged.some((f) => f.status === "error")) {
      setWaiting(false);
      return;
    }
    if (staged.every((f) => f.status === "ready")) {
      setWaiting(false);
      doSend();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, staged]);

  function doSend() {
    // os arquivos já subiram: a mensagem só referencia
    // a miniatura vai junto (a mensagem que está saindo mostra e libera no fim)
    sendChat(space, text, staged, replyTo?.thread);
    setText("");
    setStaged([]);
    onClearReply();
    if (area.current) area.current.style.height = "";
  }

  function send() {
    if (!text.trim() && staged.length === 0) return;
    if (staged.some((f) => f.status === "uploading")) {
      setWaiting(true);
      return;
    }
    if (staged.some((f) => f.status === "error")) {
      toast("Um arquivo não subiu. Tente de novo ou tire o arquivo.", "error");
      return;
    }
    doSend();
  }

  async function sendAudio(blob: Blob, type: string) {
    const f = pendingFile(blob, audioName(ext()), type);
    sendChat(space, "", [f], replyTo?.thread);
    onClearReply();
  }

  const insert = (s: string) => {
    const el = area.current;
    if (!el) return setText((t) => t + s);
    const a = el.selectionStart ?? text.length;
    const b = el.selectionEnd ?? text.length;
    const next = text.slice(0, a) + s + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + s.length, a + s.length);
    });
  };

  const fileButton = (
    <button type="button" className="btn ic chat-plain" data-tip="Anexar arquivo" aria-label="Anexar arquivo" onClick={() => fileInput.current?.click()}>
      <Paperclip size={19} aria-hidden />
    </button>
  );
  const emojiButton = (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="btn ic chat-plain" data-tip="Emoji" aria-label="Inserir emoji">
          <Smile size={19} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="qp-content chat-emoji" side="top" align="end" sideOffset={10}>
          {EMOJIS.map((e) => (
            <Popover.Close key={e} asChild>
              <button type="button" onClick={() => insert(e)} aria-label={`Inserir ${e}`}>
                {e}
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
  const sendButton = (
    <button type="button" className="btn solid ic chat-send" aria-label={waiting ? "Enviando quando os arquivos terminarem" : "Enviar"} onClick={send} disabled={waiting}>
      {waiting ? <LoaderCircle size={17} className="spinning" aria-hidden /> : <SendHorizontal size={17} aria-hidden />}
    </button>
  );

  return (
    <div className="chat-cmp">
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {note && (
        <div className="chat-note" role="alert">
          {note}
          <button type="button" className="chat-link" onClick={() => setNote(null)} aria-label="Fechar aviso">
            <X size={13} aria-hidden />
          </button>
        </div>
      )}
      {replyTo && (
        <div className="chat-replying">
          <span>
            Respondendo na conversa de <b>{replyTo.mine ? "você" : replyTo.sender.name}</b>: {plainChat(replyTo.formattedText || replyTo.text).slice(0, 80) || "anexo"}
          </span>
          <button type="button" className="chat-link" onClick={onClearReply} aria-label="Cancelar resposta">
            <X size={13} aria-hidden />
          </button>
        </div>
      )}

      {rec.phase === "recording" ? (
        <div className="chat-box is-rec">
          <button type="button" className="btn ic chat-plain" data-tip="Descartar" aria-label="Descartar gravação" onClick={cancel}>
            <Trash2 size={19} aria-hidden />
          </button>
          <span className="chat-recdot" aria-hidden />
          <span className="chat-rtime" role="timer" aria-label={`Gravando: ${clock(rec.elapsed)}`}>
            {clock(rec.elapsed)}
          </span>
          <div className="chat-live" aria-hidden>
            {rec.levels.slice(-64).map((h, i, arr) => (
              <i key={i} className={i >= arr.length - 12 ? "is-lv" : undefined} style={{ height: h, animationDelay: `${(i % 6) * 0.12}s` }} />
            ))}
            <span className="chat-rest" />
          </div>
          <span className="chat-rlbl">Gravando</span>
          <button type="button" className="btn glass ic" data-tip="Parar e ouvir" aria-label="Parar e ouvir antes de enviar" onClick={() => void review()}>
            <Pause size={17} aria-hidden />
          </button>
          <button
            type="button"
            className="btn solid ic chat-send"
            aria-label="Enviar áudio"
            onClick={async () => {
              const got = await stop();
              if (got) void sendAudio(got.blob, got.type);
              cancel();
            }}
          >
            <SendHorizontal size={17} aria-hidden />
          </button>
        </div>
      ) : rec.phase === "review" ? (
        <div className="chat-box is-review">
          <button type="button" className="btn ic chat-plain" data-tip="Descartar" aria-label="Descartar áudio" onClick={cancel}>
            <Trash2 size={19} aria-hidden />
          </button>
          <div className="chat-review">
            <AudioPlayer src={rec.url} seed={rec.url} />
          </div>
          <button
            type="button"
            className="btn solid ic chat-send"
            aria-label="Enviar áudio"
            onClick={() => {
              void sendAudio(rec.blob, rec.type);
              cancel();
            }}
          >
            <SendHorizontal size={17} aria-hidden />
          </button>
        </div>
      ) : (
        <div className={`chat-box${staged.length ? " is-att" : ""}`}>
          {staged.length > 0 && (
            <div className="chat-atts">
              {staged.map((f) => (
                <StagedCard
                  key={f.id}
                  f={f}
                  onRetry={() => upload(f)}
                  onRemove={() => {
                    if (f.thumb) URL.revokeObjectURL(f.thumb);
                    setStaged((s) => s.filter((x) => x.id !== f.id));
                  }}
                />
              ))}
            </div>
          )}
          <div className="chat-arow">
            {fileButton}
            <textarea
              ref={area}
              className="chat-input"
              rows={1}
              value={text}
              aria-label="Mensagem"
              placeholder={staged.length ? "Adicione uma mensagem (opcional)" : "Escreva uma mensagem"}
              onChange={(e) => {
                setText(e.target.value);
                const el = e.currentTarget;
                el.style.height = "";
                el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              onPaste={(e) => {
                const files = [...e.clipboardData.files];
                if (files.length) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
            />
            {emojiButton}
            {staged.length === 0 && !text && (
              <button
                type="button"
                className="btn ic chat-plain"
                data-tip="Gravar áudio (segure ou clique)"
                aria-label="Gravar áudio"
                onPointerDown={() => {
                  void start();
                  // o botão some quando a gravação começa: o "soltar" é ouvido na janela.
                  // Segurou com o gravador já ligado: soltar para e mostra para ouvir; clique curto continua gravando.
                  window.addEventListener("pointerup", () => runningFor() > 500 && void review(), { once: true });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void start();
                  }
                }}
              >
                <Mic size={19} aria-hidden />
              </button>
            )}
            {sendButton}
          </div>
        </div>
      )}
    </div>
  );
}
