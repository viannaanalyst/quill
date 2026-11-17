import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, useSyncExternalStore } from "react";
import { FileIcon } from "./FileIcon";
import { Download, ExternalLink, LoaderCircle, X } from "./icons";
import { FILE_LABEL, fileSize, fileType } from "../lib/files";

/** O que a prévia precisa: nome, tipo, como pegar o conteúdo (base64) e, se houver, baixar/abrir. */
export interface PreviewRequest {
  name: string;
  mime?: string;
  size?: number;
  load: () => Promise<string>;
  onDownload?: () => void;
  onOpen?: () => void;
}

let current: PreviewRequest | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Abre a prévia de um anexo dentro do Quill (imagem, PDF, texto, vídeo e áudio). */
export function previewAttachment(req: PreviewRequest) {
  current = req;
  emit();
}

function mimeFor(name: string, mime?: string) {
  if (mime && mime !== "application/octet-stream") return mime;
  const t = fileType(name);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (t === "pdf") return "application/pdf";
  if (t === "image") return ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
  if (t === "text" || t === "code") return "text/plain";
  if (t === "video") return `video/${ext === "mov" ? "quicktime" : ext}`;
  if (t === "audio") return `audio/${ext === "m4a" ? "mp4" : ext}`;
  return "application/octet-stream";
}

export function AttachmentPreview() {
  const req = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
  const [state, setState] = useState<{ url?: string; text?: string; error?: string; loading: boolean }>({ loading: false });

  useEffect(() => {
    if (!req) return;
    let url: string | undefined;
    let alive = true;
    setState({ loading: true });
    req
      .load()
      .then((b64) => {
        if (!alive) return;
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const mime = mimeFor(req.name, req.mime);
        if (mime.startsWith("text/")) {
          setState({ loading: false, text: new TextDecoder().decode(bytes).slice(0, 200_000) });
          return;
        }
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setState({ loading: false, url });
      })
      .catch((e) => alive && setState({ loading: false, error: String(e?.message ?? e) }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [req]);

  const close = () => {
    current = null;
    emit();
  };
  const type = req ? fileType(req.name, req.mime) : "file";
  const canShow = ["image", "pdf", "text", "code", "video", "audio"].includes(type);

  return (
    <Dialog.Root open={!!req} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="cmd-overlay" />
        <Dialog.Content className="pv-box" aria-describedby={undefined}>
          {req && (
            <>
              <div className="pv-head">
                <FileIcon name={req.name} mime={req.mime} size={30} />
                <div className="pv-title">
                  <Dialog.Title className="pv-name">{req.name}</Dialog.Title>
                  <span>
                    {FILE_LABEL[type]}
                    {req.size ? ` · ${fileSize(req.size)}` : ""}
                  </span>
                </div>
                {req.onOpen && (
                  <button className="btn glass sm" onClick={req.onOpen}>
                    <ExternalLink size={14} aria-hidden />
                    Abrir no app
                  </button>
                )}
                {req.onDownload && (
                  <button className="btn glass sm" onClick={req.onDownload}>
                    <Download size={14} aria-hidden />
                    Baixar
                  </button>
                )}
                <Dialog.Close className="crop-x" aria-label="Fechar prévia">
                  <X size={16} aria-hidden />
                </Dialog.Close>
              </div>
              <div className="pv-body">
                {state.loading ? (
                  <p className="pv-msg">
                    <LoaderCircle size={16} className="spinning" aria-hidden />
                    Carregando…
                  </p>
                ) : state.error ? (
                  <p className="pv-msg">Não consegui abrir: {state.error}</p>
                ) : !canShow ? (
                  <div className="pv-msg pv-none">
                    <FileIcon name={req.name} mime={req.mime} size={64} />
                    <p>Esse tipo de arquivo não tem prévia aqui.</p>
                    <span>Use “Abrir no app” ou “Baixar”.</span>
                  </div>
                ) : state.text !== undefined ? (
                  <pre className="pv-text">{state.text}</pre>
                ) : type === "image" ? (
                  <img className="pv-img" src={state.url} alt={req.name} />
                ) : type === "pdf" ? (
                  <iframe className="pv-pdf" src={state.url} title={req.name} />
                ) : type === "video" ? (
                  <video className="pv-img" src={state.url} controls />
                ) : type === "audio" ? (
                  <audio src={state.url} controls />
                ) : null}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
