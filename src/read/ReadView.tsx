import { useEffect, useState } from "react";
import "./read.css";
import { TopBar } from "../components/TopBar";
import { InviteGate, RsvpButtons } from "../components/Rsvp";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Download,
  Ellipsis,
  Folder,
  Forward,
  Mail,
  MailOpen,
  MailPlus,
  OctagonAlert,
  Paperclip,
  Reply,
  ReplyAll,
  Search,
  Star,
  Tag,
  Trash2,
  User,
} from "../components/icons";
import { MessageAvatar } from "../components/MessageAvatar";
import type { Account, Message } from "../inbox/types";
import { deleteForever, listContaining, loadBody, markReadRemote, messageAction, useMailbox } from "../state/mailbox";
import { backToFolder, getStore, markRead, markUnread, navigate } from "../state/store";
import { getPref } from "../lib/storage";
import { isTauri } from "../lib/platform";
import { escapeHtml, textToHtml } from "../lib/signature";
import { api, friendlyError, type AttachmentInfo } from "../lib/api";
import { toast } from "../components/Toasts";
import { THREADS, type Attachment, type Thread } from "./threads";
import { FileIcon } from "../components/FileIcon";
import { previewAttachment } from "../components/AttachmentPreview";
import { askConfirm } from "../components/ConfirmHost";
import { EmailFrame } from "./EmailFrame";
import { FILE_LABEL, fileSize, fileType } from "../lib/files";
import { InlineReply, withPrefix, type ReplyMode } from "./InlineReply";
import { getReplyDraft } from "../state/replyDrafts";
import { deleteForeverConfirm } from "../state/deleteForever";

/** Conversa de um e-mail: a de exemplo completa ou uma versão simples montada a partir da prévia. */
function threadFor(m: Message, account: Account | undefined, body: string | undefined, atts: AttachmentInfo[] | undefined, html: string | null | undefined): Thread {
  if (THREADS[m.id]) return THREADS[m.id];
  // imagens embutidas no texto não entram na lista de anexos (aparecem no próprio e-mail)
  const shownAtts = (atts ?? []).filter((a) => !(a.contentId && html && html.includes(`cid:${a.contentId}`)));
  const realAtts: Attachment[] = shownAtts.map((a) => ({
    name: a.name,
    kind: (({ pdf: "pdf", sheet: "sheet", image: "image" }) as Record<string, Attachment["kind"]>)[fileType(a.name, a.mimeType)] ?? "file",
    size: fileSize(a.size),
    mime: a.mimeType,
    remote: { email: m.accountEmail!, messageId: m.id, id: a.id },
  }));
  const text = m.accountEmail ? (body ?? "Carregando o e-mail…") : m.preview;
  return {
    email: m.fromEmail ?? `${m.from.toLowerCase().replace(/[^a-z]/g, "")}@exemplo.com`,
    to: toLine(m),
    date: m.date,
    labels: [],
    earlier: [],
    body: text.split(/\n{2,}/),
    html: html ?? undefined,
    attachments: m.accountEmail ? realAtts : m.attachment ? [{ name: m.attachment, kind: "file", size: "—" }] : [],
    senderRole: account?.name ?? "",
    history: [],
  };
}

/** "para Ana, Pedro · cc Carla", com "mim" no lugar do endereço da conta (como no Gmail). */
function toLine(m: Message) {
  if (!m.accountEmail) return "para mim";
  const me = m.accountEmail.toLowerCase();
  const names = (list: { name: string; email: string }[]) =>
    list.map((p) => (p.email.toLowerCase() === me ? "mim" : p.name || p.email)).join(", ");
  const to = m.recipients?.length ? names(m.recipients) : m.accountEmail;
  return m.cc?.length ? `para ${to} · cc ${names(m.cc)}` : `para ${to}`;
}

/** Texto simples com links clicáveis (e-mails sem versão formatada). Links longos viram "domínio…". */
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return parts.map((part, i) => {
    if (!/^https?:\/\//.test(part)) return part;
    let label = part;
    try {
      const u = new URL(part);
      label = part.length > 60 ? `${u.hostname}${u.pathname.length > 1 ? "/…" : ""}` : part;
    } catch {
      /* fica o texto */
    }
    return (
      <a
        key={i}
        href={part}
        className="rd-link"
        onClick={(e) => {
          e.preventDefault();
          if (isTauri) void api.openLink(part).catch(() => undefined);
          else window.open(part, "_blank", "noopener");
        }}
      >
        {label}
      </a>
    );
  });
}

/** Prévia dentro do Quill (imagem, PDF, texto, vídeo), com Baixar e Abrir no app. */
function showPreview(a: Attachment) {
  if (!a.remote) {
    toast("Prévia de design: nada para mostrar");
    return;
  }
  const r = a.remote;
  previewAttachment({
    name: a.name,
    mime: a.mime,
    load: () => api.attachmentData(r.email, r.messageId, r.id),
    onDownload: () => void attachmentAction(a, "save"),
    onOpen: () => void attachmentAction(a, "open"),
  });
}

/** Abre no app padrão ou guarda em Downloads. */
async function attachmentAction(a: Attachment, action: "save" | "open" | "preview") {
  if (!a.remote) {
    toast("Prévia de design: nada para baixar");
    return;
  }
  try {
    const path = await api.attachment(a.remote.email, a.remote.messageId, a.remote.id, a.name, action);
    if (action === "save") toast(`${path.split(/[\\/]/).pop()} salvo em Downloads`);
  } catch (e) {
    toast(`Não consegui baixar: ${friendlyError(e)}`, "error");
  }
}

export default function ReadView({ id }: { id: string }) {
  const messages = useMailbox((s) => listContaining(s, id));
  const accounts = useMailbox((s) => s.accounts);
  const body = useMailbox((s) => s.bodies[id]);
  const atts = useMailbox((s) => s.attachments[id]);
  const html = useMailbox((s) => s.htmlBodies[id]);
  const index = messages.findIndex((x) => x.id === id);

  // e-mail real: busca o texto completo na primeira abertura
  useEffect(() => {
    void loadBody(id);
  }, [id]);

  if (index < 0) {
    return (
      <div className="list-empty" style={{ margin: "auto" }}>
        Esse e-mail não está mais nesta caixa.{" "}
        <button className="btn glass sm" onClick={backToFolder}>Voltar</button>
      </div>
    );
  }
  const m = messages[index];
  const account = accounts.find((a) => a.id === m.account);
  return <ReadMessage key={id} m={m} t={threadFor(m, account, body, atts, html)} inlineLoaders={inlineFor(m, atts)} account={account} index={index} messages={messages} />;
}



/** Carregadores das imagens embutidas (cid → data URL) de um e-mail real. */
const inlineCache = new Map<string, Record<string, () => Promise<string>>>();
function inlineFor(m: Message, atts: AttachmentInfo[] | undefined) {
  if (!m.accountEmail || !atts?.some((a) => a.contentId)) return undefined;
  const key = `${m.id}:${atts.length}`;
  let map = inlineCache.get(key);
  if (!map) {
    map = {};
    for (const a of atts) {
      if (!a.contentId) continue;
      const email = m.accountEmail;
      map[a.contentId] = () => api.attachmentData(email, m.id, a.id).then((b64) => `data:${a.mimeType || "image/png"};base64,${b64}`);
    }
    inlineCache.set(key, map);
  }
  return map;
}

function ReadMessage({
  inlineLoaders,
  m,
  t,
  account,
  index,
  messages,
}: {
  m: Message;
  t: Thread;
  account: Account | undefined;
  index: number;
  messages: Message[];
  inlineLoaders?: Record<string, () => Promise<string>>;
}) {
  const [openEarlier, setOpenEarlier] = useState<Set<number>>(() => new Set());
  const [starred, setStarred] = useState(!!m.starred);
  // resposta rápida: fechada até clicar em Responder (abre sozinha se havia uma em andamento)
  const [replyMode, setReplyMode] = useState<ReplyMode | null>(() => (getReplyDraft(m.id) ? "reply" : null));
  const [replyFocus, setReplyFocus] = useState(0);
  const inSpam = getStore().lastFolder === "spam";
  const inTrash = getStore().lastFolder === "trash";

  const back = backToFolder;
  /** depois de arquivar/apagar: abre o próximo da lista ou volta */
  const leave = () => {
    const next = messages[index + 1] ?? messages[index - 1];
    if (next && next.id !== m.id) navigate({ name: "read", id: next.id });
    else back();
  };
  const go = (delta: number) => {
    const next = messages[index + delta];
    if (!next) return;
    markRead(next.id);
    markReadRemote(next.id);
    navigate({ name: "read", id: next.id });
  };
  const toggleEarlier = (i: number) =>
    setOpenEarlier((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const openReply = (mode: ReplyMode = "reply") => {
    setReplyMode(mode);
    setReplyFocus((n) => n + 1);
  };
  const quoted = () =>
    `<br><br><div>---------- Mensagem encaminhada ----------<br>De: ${escapeHtml(m.from)} &lt;${escapeHtml(t.email)}&gt;<br>Data: ${escapeHtml(t.date)}<br>Assunto: ${escapeHtml(m.subject)}<br><br>${t.body.map(textToHtml).join("<br><br>")}</div>`;
  const forward = () => navigate({ name: "compose", draft: { from: m.accountEmail, subject: withPrefix("Fwd:", m.subject), body: quoted() } });
  const writeTo = () => navigate({ name: "compose", draft: { from: m.accountEmail, to: [{ name: m.from, email: t.email }] } });
  const trashAction = inTrash
    ? {
        icon: Trash2,
        label: "Excluir para sempre",
        danger: true,
        onClick: () => {
          void askConfirm(deleteForeverConfirm(1)).then(async (ok) => {
            if (!ok) return;
            const next = messages[index + 1] ?? messages[index - 1];
            if (await deleteForever([m.id])) {
              if (next && next.id !== m.id) navigate({ name: "read", id: next.id });
              else back();
            }
          });
        },
      }
    : {
        icon: Trash2,
        label: "Lixeira",
        onClick: () => {
          const go = () => {
            void messageAction(m.id, "trash");
            leave();
          };
          if (!getPref("confirmDelete", true)) return go();
          void askConfirm({ title: "Mover para a Lixeira?", text: "Dá para tirar de lá depois, pela pasta Lixeira.", action: "Mover para a Lixeira" }).then(
            (ok) => ok && go(),
          );
        },
      };
  const actions: { icon: typeof Archive; label: string; danger?: boolean; onClick?: () => void }[] = [
    ...(inTrash
      ? [
          {
            icon: ArchiveRestore,
            label: "Tirar da lixeira",
            onClick: () => {
              void messageAction(m.id, "untrash");
              leave();
            },
          },
        ]
      : []),
    {
      icon: Archive,
      label: "Arquivar",
      onClick: () => {
        void messageAction(m.id, "archive");
        leave();
      },
    },
    trashAction,
    {
      icon: OctagonAlert,
      label: inSpam ? "Não é spam" : "Spam",
      onClick: () => {
        void messageAction(m.id, inSpam ? "notspam" : "spam");
        leave();
      },
    },
    {
      icon: MailOpen,
      label: "Marcar como não lida",
      onClick: () => {
        markUnread(m.id);
        void messageAction(m.id, "unread");
        back();
      },
    },
  ];

  return (
    <>
      <TopBar
        leading={
          <button className="btn glass ic" aria-label="Voltar para a caixa de entrada" data-tip="Voltar" onClick={back} style={{ marginRight: 6 }}>
            <ArrowLeft size={17} aria-hidden />
          </button>
        }
        title="Caixa de entrada"
        sub={m.subject}
      />

      <div className="rd" key={m.id}>
        <div className="toolbar">
          <button className="btn solid lg" onClick={() => openReply("reply")}>
            <Reply size={17} aria-hidden />
            Responder
          </button>
          <button className="btn glass lg" onClick={() => openReply("replyAll")}>
            <ReplyAll size={17} aria-hidden />
            Responder a todos
          </button>
          <button className="btn glass lg" onClick={forward}>
            <Forward size={17} aria-hidden />
            Encaminhar
          </button>
          <span className="vsep" aria-hidden />
          {actions.map((a) => (
            <button key={a.label} className={`btn glass ic${a.danger ? " rd-danger" : ""}`} aria-label={a.label} data-tip={a.label} onClick={a.onClick}>
              <a.icon size={17} aria-hidden />
            </button>
          ))}
          <button
            className="btn glass ic"
            aria-label="Importante"
            data-tip={starred ? "Tirar de importantes" : "Importante"}
            aria-pressed={starred}
            onClick={() => {
              setStarred((v) => !v);
              void messageAction(m.id, starred ? "unstar" : "star");
            }}
            style={starred ? { color: "#e0a43a" } : undefined}
          >
            <Star size={17} aria-hidden fill={starred ? "currentColor" : "none"} />
          </button>
          <button className="btn glass ic" aria-label="Marcador" data-tip="Marcador">
            <Tag size={17} aria-hidden />
          </button>
          <button className="btn glass ic" aria-label="Mover para pasta" data-tip="Mover para pasta">
            <Folder size={17} aria-hidden />
          </button>
          <div className="rd-nav">
            {index + 1} de {messages.length}
            <button className="btn glass ic" aria-label="E-mail anterior" data-tip="Anterior" onClick={() => go(-1)} disabled={index === 0}>
              <ChevronUp size={17} aria-hidden />
            </button>
            <button className="btn glass ic" aria-label="Próximo e-mail" data-tip="Próximo" onClick={() => go(1)} disabled={index === messages.length - 1}>
              <ChevronDown size={17} aria-hidden />
            </button>
          </div>
        </div>

        <div className="rd-content">
          <div className="rd-main">
            <article className="card rd-conv">
              <header className="rd-head">
                <h1 className="rd-subject">{m.subject}</h1>
                <div className="rd-chips">
                  {account && (
                    <span className="acct">
                      <i style={{ background: account.color }} />
                      {account.name}
                    </span>
                  )}
                  {t.labels.map((l) => (
                    <span key={l} className="chip">
                      <Tag size={12} aria-hidden />
                      {l}
                    </span>
                  ))}
                  {t.earlier.length > 0 && <span className="chip">{t.earlier.length + 1} mensagens</span>}
                  {t.attachments.length > 0 && (
                    <span className="chip">
                      <Paperclip size={12} aria-hidden />
                      {t.attachments.length} {t.attachments.length === 1 ? "anexo" : "anexos"}
                    </span>
                  )}
                </div>
              </header>

              <div className="rd-thread">
                {t.earlier.map((e, i) => (
                  <div key={i}>
                    <button className="rd-earlier" onClick={() => toggleEarlier(i)} aria-expanded={openEarlier.has(i)}>
                      <span className={`av ${e.tone}`} aria-hidden>{e.initials}</span>
                      <span className="rd-earlier-who">{e.who}</span>
                      <span className="rd-earlier-text">{openEarlier.has(i) ? "" : e.text}</span>
                      <span className="rd-earlier-date">{e.date}</span>
                    </button>
                    {openEarlier.has(i) && <p className="rd-earlier-full">{e.text}</p>}
                  </div>
                ))}

                <div className="rd-msg">
                  <div className="rd-msg-head">
                    <MessageAvatar message={m} />
                    <div>
                      <div className="rd-from">
                        {m.from}
                        <span>{t.email}</span>
                      </div>
                      <div className="rd-to">{t.to}</div>
                    </div>
                    <div className="rd-msg-actions">
                      <span style={{ marginRight: 6 }}>{t.date}</span>
                      <button className="btn ic" aria-label="Responder" data-tip="Responder" onClick={() => openReply("reply")}>
                        <Reply size={17} aria-hidden />
                      </button>
                      <button className="btn ic" aria-label="Mais ações" data-tip="Mais ações">
                        <Ellipsis size={17} aria-hidden />
                      </button>
                    </div>
                  </div>
                  {t.html ? (
                    <EmailFrame html={t.html} inline={inlineLoaders} />
                  ) : (
                    <div className="rd-body">
                      {t.body.map((p, i) => (
                        <p key={i}>{linkify(p)}</p>
                      ))}
                    </div>
                  )}
                  {t.attachments.length > 0 && (
                    <div className="rd-atts">
                      {t.attachments.map((a) => (
                        <div key={a.name} className="rd-att">
                          <button className="rd-att-open" onClick={() => showPreview(a)} data-tip="Ver sem baixar" aria-label={`Ver ${a.name}`}>
                            <FileIcon name={a.name} mime={a.mime} size={34} />
                            <span>
                              <span className="rd-att-name">{a.name}</span>
                              <span className="rd-att-size">
                                {FILE_LABEL[fileType(a.name, a.mime)]}
                                {a.size ? ` · ${a.size}` : ""}
                              </span>
                            </span>
                          </button>
                          <button className="btn glass ic" aria-label={`Baixar ${a.name}`} data-tip="Baixar" onClick={() => void attachmentAction(a, "save")}>
                            <Download size={15} aria-hidden />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {replyMode ? (
                  <InlineReply key={m.id} m={m} senderEmail={t.email} mode={replyMode} focusTick={replyFocus} onClose={() => setReplyMode(null)} />
                ) : (
                  <div className="rd-replybar">
                    <button className="btn glass" onClick={() => openReply("reply")}>
                      <Reply size={16} aria-hidden />
                      Responder
                    </button>
                    <button className="btn glass" onClick={() => openReply("replyAll")}>
                      <ReplyAll size={16} aria-hidden />
                      Responder a todos
                    </button>
                    <button className="btn glass" onClick={forward}>
                      <Forward size={16} aria-hidden />
                      Encaminhar
                    </button>
                  </div>
                )}
              </div>
            </article>
          </div>

          <aside className="rd-side" aria-label="Detalhes">
            <section className="card rd-card">
              <div className="section-label">
                <User size={14} aria-hidden />
                Remetente
              </div>
              <div className="rd-who">
                <MessageAvatar message={m} size={46} />
                <div>
                  <div className="rd-who-name">{m.from}</div>
                  <div className="rd-who-role">{t.senderRole}</div>
                </div>
              </div>
              <div className="rd-mail">
                <Mail size={14} aria-hidden />
                {t.email}
              </div>
              <div className="rd-row2">
                <button className="btn glass sm" onClick={writeTo}>
                  <MailPlus size={14} aria-hidden />
                  Escrever
                </button>
                <button className="btn glass sm">
                  <Search size={14} aria-hidden />
                  Ver conversas
                </button>
              </div>
              {t.history.length > 0 && (
                <ul className="rd-history">
                  {t.history.map((h) => (
                    <li key={h.subject}>
                      <span>{h.subject}</span>
                      <span>{h.date}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {t.attachments.length > 0 && (
              <section className="card rd-card">
                <div className="section-label">
                  <Paperclip size={14} aria-hidden />
                  Anexos ({t.attachments.length})
                </div>
                <ul className="rd-files">
                  {t.attachments.map((a) => (
                    <li key={a.name} className="rd-file">
                      <button className="rd-att-open" onClick={() => showPreview(a)} data-tip="Ver sem baixar" aria-label={`Ver ${a.name}`}>
                        <FileIcon name={a.name} mime={a.mime} size={30} />
                        <span>
                          <span className="rd-att-name">{a.name}</span>
                          <span className="rd-att-size">{a.size || FILE_LABEL[fileType(a.name, a.mime)]}</span>
                        </span>
                      </button>
                      <button className="btn glass ic" aria-label={`Baixar ${a.name}`} data-tip="Baixar" onClick={() => void attachmentAction(a, "save")}>
                        <Download size={14} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
                {t.attachments.length > 1 && (
                  <button className="btn glass" onClick={() => t.attachments.forEach((a) => void attachmentAction(a, "save"))}>
                    <Download size={15} aria-hidden />
                    Baixar todos
                  </button>
                )}
              </section>
            )}

            {t.mentionsMeeting && (
              <InviteGate>
                <section className="card rd-card">
                  <div className="section-label">
                    <CalendarDays size={14} aria-hidden />
                    Reunião citada
                  </div>
                  <div className="rd-meeting">
                    <span className="rd-meeting-dot" style={{ background: "var(--acc-inchurch)" }} aria-hidden />
                    <div>
                      <div className="rd-meeting-title">Planejamento Q1</div>
                      <div className="rd-meeting-meta">Qui, 19 nov · 10:00 – 11:30</div>
                      <div className="rd-meeting-meta" style={{ color: "var(--ink3)" }}>Sala Paulista · Google Meet</div>
                    </div>
                  </div>
                  <div className="rd-meeting-note">Você ainda não respondeu o convite.</div>
                  <RsvpButtons size="sm" />
                </section>
              </InviteGate>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
