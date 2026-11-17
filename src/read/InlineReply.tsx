import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RichToolbar } from "../compose/RichToolbar";
import { FileIcon } from "../components/FileIcon";
import { MessageAvatar } from "../components/MessageAvatar";
import { toast } from "../components/Toasts";
import { ALargeSmall, LoaderCircle, Maximize2, Paperclip, Reply, ReplyAll, SendHorizontal, Trash2, X } from "../components/icons";
import type { Message } from "../inbox/types";
import { api, friendlyError, type OutgoingMessage } from "../lib/api";
import { fileSize, mimeFor, readAsBase64 } from "../lib/files";
import { isTauri } from "../lib/platform";
import { signatureHtml } from "../lib/signature";
import { getMailbox } from "../state/mailbox";
import { queueSend } from "../state/outbox";
import { clearReplyDraft, getReplyDraft, hasText, setReplyDraft, type ReplyFile } from "../state/replyDrafts";
import { navigate } from "../state/store";

export const withPrefix = (prefix: string, subject: string) => (subject.toLowerCase().startsWith(prefix.toLowerCase()) ? subject : `${prefix} ${subject}`);

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const DRAFT_DELAY = 3000;
/** limite do Gmail para anexos num e-mail */
const MAX_BYTES = 25 * 1024 * 1024;

export type ReplyMode = "reply" | "replyAll";

/**
 * Resposta rápida dentro do e-mail (como no Gmail): abre logo abaixo da mensagem, rola junto com ela,
 * tem a formatação básica (e a barra inteira no "Aa"), anexos e o rascunho salvo sozinho no Gmail.
 * O "Editor completo" leva tudo para a tela Escrever, que tem o "Voltar ao e-mail".
 */
export function InlineReply({
  m,
  senderEmail,
  mode,
  focusTick,
  onClose,
}: {
  m: Message;
  /** endereço de quem mandou (para o Para) */
  senderEmail: string;
  mode: ReplyMode;
  /** muda quando pedem para focar de novo (botão Responder com a caixa já aberta) */
  focusTick: number;
  onClose: () => void;
}) {
  const saved = useRef(getReplyDraft(m.id)).current;
  const [initialHtml] = useState(() => saved?.html ?? "");
  const [empty, setEmpty] = useState(() => !hasText(initialHtml));
  const [files, setFiles] = useState<ReplyFile[]>(() => saved?.files ?? []);
  const [full, setFull] = useState(false);
  const [reading, setReading] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const live = isTauri && !!m.accountEmail;
  const subject = withPrefix("Re:", m.subject);
  const firstName = m.from.split(" ")[0];

  // ---------- rascunho no Gmail (3 s depois da última mudança) ----------
  const htmlRef = useRef(initialHtml);
  const draftId = useRef<string | null>(saved?.draftId ?? null);
  const dirty = useRef(!!saved?.dirty);
  /** enviado, descartado ou levado para o editor completo: esta caixa não salva mais */
  const closed = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const latest = useRef({ files });
  useLayoutEffect(() => {
    latest.current = { files };
  });

  const buildMessage = (html: string): OutgoingMessage => ({
    from: m.accountEmail ?? "",
    fromName: m.accountEmail ? (getMailbox().profiles[m.accountEmail]?.name ?? null) : null,
    to: [senderEmail],
    cc: [],
    bcc: [],
    subject,
    html,
    attachments: latest.current.files.map((f) => ({ name: f.name, mimeType: f.mimeType, data: f.data })),
  });

  const saveDraft = (): Promise<void> => {
    window.clearTimeout(timer.current);
    if (!live || closed.current || !dirty.current) return Promise.resolve();
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    const html = htmlRef.current;
    const hasContent = hasText(html) || latest.current.files.length > 0;
    dirty.current = false;
    // apagou tudo: o rascunho salvo sai de Rascunhos
    if (!hasContent) {
      const id = draftId.current;
      draftId.current = null;
      if (id) void api.draftDelete(m.accountEmail!, id).catch(() => undefined);
      return Promise.resolve();
    }
    const run = api
      .draftSave(buildMessage(html), draftId.current, m.threadId)
      .then((id) => {
        draftId.current = id;
      })
      .catch(() => {
        dirty.current = true;
      })
      .finally(() => {
        inflight.current = null;
        if (again.current) {
          again.current = false;
          void saveRef.current();
        }
      });
    inflight.current = run;
    return run;
  };
  const saveRef = useRef(saveDraft);
  useLayoutEffect(() => {
    saveRef.current = saveDraft;
  });

  const changed = () => {
    if (closed.current) return;
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveRef.current(), DRAFT_DELAY);
  };

  const settle = async () => {
    window.clearTimeout(timer.current);
    while (inflight.current) await inflight.current.catch(() => undefined);
  };

  // voltou do editor completo com mudança ainda não salva: salva daqui a pouco
  useEffect(() => {
    if (dirty.current) timer.current = window.setTimeout(() => void saveRef.current(), DRAFT_DELAY);
  }, []);

  // saiu do e-mail com a caixa aberta: guarda o que foi escrito e salva no Gmail
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (closed.current) return;
      const html = htmlRef.current;
      if (hasText(html) || latest.current.files.length) {
        setReplyDraft(m.id, { html, files: latest.current.files, draftId: draftId.current ?? undefined });
        if (dirty.current) void saveRef.current();
      } else {
        clearReplyDraft(m.id);
      }
    },
    [m.id],
  );

  // ao abrir (e a cada novo "Responder"): aparece inteira e o cursor vai para o fim do texto
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const ed = bodyRef.current;
    if (!ed) return;
    ed.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (sel) {
      const r = document.createRange();
      r.selectNodeContents(ed);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }, [focusTick]);

  // ---------- anexos ----------
  const addFiles = async (list: FileList | File[]) => {
    const picked = [...list];
    if (!picked.length) return;
    const total = latest.current.files.reduce((n, f) => n + f.size, 0) + picked.reduce((n, f) => n + f.size, 0);
    if (total > MAX_BYTES) {
      toast("Os anexos passam de 25 MB, o limite do Gmail.", "error");
      return;
    }
    setReading(true);
    try {
      const read = await Promise.all(picked.map(async (f) => ({ name: f.name, mimeType: mimeFor(f), size: f.size, data: await readAsBase64(f) })));
      setFiles((prev) => [...prev, ...read]);
      changed();
    } catch (e) {
      toast(`Não consegui anexar: ${friendlyError(e)}`, "error");
    } finally {
      setReading(false);
    }
  };
  const removeFile = (i: number) => {
    setFiles((prev) => prev.filter((_, j) => j !== i));
    changed();
  };

  // ---------- ações ----------
  const send = async () => {
    const html = bodyRef.current?.innerHTML ?? "";
    if (!hasText(html) && !files.length) return;
    closed.current = true;
    clearReplyDraft(m.id);
    if (!live || !m.accountEmail) {
      toast("Prévia: nada foi enviado");
      return onClose();
    }
    onClose();
    await settle();
    queueSend(
      { ...buildMessage(`${html}${signatureHtml(m.accountEmail)}`) },
      m.threadId,
      {
        from: m.accountEmail,
        to: [{ name: m.from, email: senderEmail }],
        subject,
        body: html,
        threadId: m.threadId,
        draftId: draftId.current ?? undefined,
        attachments: files,
        returnTo: m.id,
      },
    );
  };

  const discard = async () => {
    closed.current = true;
    clearReplyDraft(m.id);
    onClose();
    await settle();
    const id = draftId.current;
    if (id && m.accountEmail) {
      try {
        await api.draftDelete(m.accountEmail, id);
        toast("Rascunho descartado");
      } catch (e) {
        toast(`Não descartou o rascunho: ${friendlyError(e)}`, "error");
      }
    }
  };

  const openFull = async () => {
    closed.current = true;
    const html = bodyRef.current?.innerHTML ?? "";
    await settle();
    clearReplyDraft(m.id);
    navigate({
      name: "compose",
      draft: {
        from: m.accountEmail,
        to: [{ name: m.from, email: senderEmail }],
        subject,
        body: hasText(html) ? html : "",
        threadId: m.threadId,
        draftId: draftId.current ?? undefined,
        attachments: files,
        returnTo: m.id,
      },
    });
  };

  const ModeIcon = mode === "replyAll" ? ReplyAll : Reply;

  return (
    <section ref={rootRef} className="rd-r" aria-label={`Responder para ${m.from}`}>
      <div className="rd-r-to">
        <ModeIcon size={15} aria-hidden className="rd-r-mode" />
        Para
        <span className="person-chip">
          <MessageAvatar message={m} size={20} />
          {m.from}
        </span>
        <button className="btn ic rd-r-x" aria-label="Descartar resposta" data-tip="Descartar" onClick={() => void discard()}>
          <Trash2 size={15} aria-hidden />
        </button>
      </div>

      <div
        ref={bodyRef}
        className="rd-r-body"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={`Resposta para ${m.from}`}
        data-placeholder={`Responder para ${firstName}…`}
        data-empty={empty ? "" : undefined}
        dangerouslySetInnerHTML={{ __html: initialHtml }}
        onInput={(e) => {
          htmlRef.current = e.currentTarget.innerHTML;
          setEmpty(!hasText(htmlRef.current));
          changed();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />

      {files.length > 0 && (
        <ul className="rd-r-files" aria-label="Anexos">
          {files.map((f, i) => (
            <li key={`${i}-${f.name}`} className="rd-r-file">
              <FileIcon name={f.name} mime={f.mimeType} size={24} />
              <span className="rd-r-file-name">{f.name}</span>
              <span className="rd-r-file-size">{fileSize(f.size)}</span>
              <button className="btn ic" aria-label={`Tirar ${f.name}`} data-tip="Tirar" data-tip-pos="top" onClick={() => removeFile(i)}>
                <X size={13} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {full && (
        <RichToolbar
          editorRef={bodyRef}
          up
          onImages={(imgs) => void addFiles(imgs)}
          onEdited={() => {
            htmlRef.current = bodyRef.current?.innerHTML ?? "";
            setEmpty(!hasText(htmlRef.current));
            changed();
          }}
        />
      )}

      <div className="rd-r-actions">
        <button className="btn solid" onClick={() => void send()} disabled={empty && !files.length} data-tip={`Enviar ${isMac ? "⌘" : "Ctrl+"}↵`} data-tip-pos="top">
          <SendHorizontal size={15} aria-hidden />
          Enviar
        </button>
        {!full && (
          <RichToolbar
            editorRef={bodyRef}
            compact
            up
            onImages={(imgs) => void addFiles(imgs)}
            onEdited={() => {
              htmlRef.current = bodyRef.current?.innerHTML ?? "";
              setEmpty(!hasText(htmlRef.current));
              changed();
            }}
          />
        )}
        <span className="vsep" aria-hidden />
        <button
          className="btn ic rd-r-tool"
          aria-label="Opções de formatação"
          aria-pressed={full}
          data-tip={full ? "Menos formatação" : "Mais formatação"}
          data-tip-pos="top"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setFull((v) => !v)}
        >
          <ALargeSmall size={17} aria-hidden />
        </button>
        <button className="btn ic rd-r-tool" aria-label="Anexar arquivo" data-tip="Anexar" data-tip-pos="top" onClick={() => fileInput.current?.click()} disabled={reading}>
          {reading ? <LoaderCircle size={16} className="spinning" aria-hidden /> : <Paperclip size={16} aria-hidden />}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button className="btn glass sm rd-r-full" onClick={() => void openFull()} data-tip="Cc, assinatura e mais opções" data-tip-pos="top">
          <Maximize2 size={14} aria-hidden />
          Editor completo
        </button>
      </div>
    </section>
  );
}
