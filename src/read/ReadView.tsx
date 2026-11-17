import { useEffect, useRef, useState } from "react";
import "./read.css";
import { TopBar } from "../components/TopBar";
import { InviteGate, RsvpButtons } from "../components/Rsvp";
import {
  Archive,
  ArrowLeft,
  Bold,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Download,
  Ellipsis,
  FileSpreadsheet,
  FileText,
  Folder,
  Forward,
  ImageIcon,
  Italic,
  Link,
  List,
  Mail,
  MailOpen,
  MailPlus,
  OctagonAlert,
  Paperclip,
  Reply,
  ReplyAll,
  Search,
  SendHorizontal,
  Smile,
  Star,
  Tag,
  Trash2,
  Underline,
  User,
  X,
} from "../components/icons";
import { MessageAvatar } from "../components/MessageAvatar";
import type { Account, Message } from "../inbox/types";
import { loadBody, markReadRemote, useMailbox } from "../state/mailbox";
import { markRead, markUnread, navigate } from "../state/store";
import { THREADS, type Attachment, type Thread } from "./threads";

/** Conversa de um e-mail: a de exemplo completa ou uma versão simples montada a partir da prévia. */
function threadFor(m: Message, account: Account | undefined, body: string | undefined): Thread {
  if (THREADS[m.id]) return THREADS[m.id];
  const text = m.accountEmail ? (body ?? "Carregando o e-mail…") : m.preview;
  return {
    email: m.fromEmail ?? `${m.from.toLowerCase().replace(/[^a-z]/g, "")}@exemplo.com`,
    to: m.accountEmail ? `para ${m.accountEmail}` : "para mim",
    date: m.date,
    labels: [],
    earlier: [],
    body: text.split(/\n{2,}/),
    attachments: m.attachment && !m.accountEmail ? [{ name: m.attachment, kind: "file", size: "—" }] : [],
    senderRole: account?.name ?? "",
    history: [],
  };
}

function AttachmentIcon({ kind, size }: { kind: Attachment["kind"]; size: number }) {
  return (
    <span className={`icon-tile ${kind === "sheet" ? "sage" : "blue"}`}>
      {kind === "sheet" ? <FileSpreadsheet size={size} aria-hidden /> : <FileText size={size} aria-hidden />}
    </span>
  );
}

export default function ReadView({ id }: { id: string }) {
  const messages = useMailbox((s) => s.messages);
  const accounts = useMailbox((s) => s.accounts);
  const body = useMailbox((s) => s.bodies[id]);
  const index = messages.findIndex((x) => x.id === id);

  // e-mail real: busca o texto completo na primeira abertura
  useEffect(() => {
    void loadBody(id);
  }, [id]);

  if (index < 0) {
    return (
      <div className="list-empty" style={{ margin: "auto" }}>
        Esse e-mail não está mais na caixa de entrada.{" "}
        <button className="btn glass sm" onClick={() => navigate({ name: "inbox", folder: "inbox" })}>Voltar</button>
      </div>
    );
  }
  const m = messages[index];
  const account = accounts.find((a) => a.id === m.account);
  return <ReadMessage key={id} m={m} t={threadFor(m, account, body)} account={account} index={index} messages={messages} />;
}

function ReadMessage({
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
}) {
  const firstName = m.from.split(" ")[0];

  const [openEarlier, setOpenEarlier] = useState<Set<number>>(() => new Set());
  const [starred, setStarred] = useState(false);
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const back = () => navigate({ name: "inbox", folder: "inbox" });
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
  const focusReply = () => replyRef.current?.focus();
  const send = () => {
    if (!reply.trim()) return;
    setReply("");
    setSent(true);
  };

  const actions: { icon: typeof Archive; label: string; onClick?: () => void }[] = [
    { icon: Archive, label: "Arquivar", onClick: back },
    { icon: Trash2, label: "Lixeira", onClick: back },
    { icon: OctagonAlert, label: "Spam", onClick: back },
    {
      icon: MailOpen,
      label: "Marcar como não lida",
      onClick: () => {
        markUnread(m.id);
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
          <button className="btn solid lg" onClick={focusReply}>
            <Reply size={17} aria-hidden />
            Responder
          </button>
          <button className="btn glass lg" onClick={focusReply}>
            <ReplyAll size={17} aria-hidden />
            Responder a todos
          </button>
          <button className="btn glass lg" onClick={() => navigate({ name: "compose" })}>
            <Forward size={17} aria-hidden />
            Encaminhar
          </button>
          <span className="vsep" aria-hidden />
          {actions.map((a) => (
            <button key={a.label} className="btn glass ic" aria-label={a.label} data-tip={a.label} onClick={a.onClick}>
              <a.icon size={17} aria-hidden />
            </button>
          ))}
          <button
            className="btn glass ic"
            aria-label="Importante"
            data-tip={starred ? "Tirar de importantes" : "Importante"}
            aria-pressed={starred}
            onClick={() => setStarred((v) => !v)}
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
                      <button className="btn ic" aria-label="Responder" data-tip="Responder" onClick={focusReply}>
                        <Reply size={17} aria-hidden />
                      </button>
                      <button className="btn ic" aria-label="Mais ações" data-tip="Mais ações">
                        <Ellipsis size={17} aria-hidden />
                      </button>
                    </div>
                  </div>
                  <div className="rd-body">
                    {t.body.map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                  {t.attachments.length > 0 && (
                    <div className="rd-atts">
                      {t.attachments.map((a) => (
                        <div key={a.name} className="rd-att">
                          <AttachmentIcon kind={a.kind} size={20} />
                          <div>
                            <div className="rd-att-name">{a.name}</div>
                            <div className="rd-att-size">{a.kind === "sheet" ? "Planilha" : a.kind === "pdf" ? "PDF" : "Arquivo"} · {a.size}</div>
                          </div>
                          <button className="btn glass ic" aria-label={`Baixar ${a.name}`} data-tip="Baixar">
                            <Download size={15} aria-hidden />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rd-reply">
                <div className="rd-reply-to">
                  Para
                  <span className="person-chip">
                    <MessageAvatar message={m} size={20} />
                    {m.from}
                    <button aria-label={`Remover ${m.from}`}>
                      <X size={12} aria-hidden />
                    </button>
                  </span>
                  <span className="rd-reply-mode">
                    <Reply size={14} aria-hidden />
                    Responder
                  </span>
                </div>
                <textarea
                  ref={replyRef}
                  rows={2}
                  placeholder={`Responder para ${firstName}…`}
                  value={reply}
                  onChange={(e) => {
                    setReply(e.target.value);
                    setSent(false);
                  }}
                  aria-label={`Responder para ${m.from}`}
                />
                <div className="format-bar">
                  {[
                    { icon: Bold, label: "Negrito" },
                    { icon: Italic, label: "Itálico" },
                    { icon: Underline, label: "Sublinhado" },
                    { icon: Link, label: "Link" },
                    { icon: List, label: "Lista" },
                  ].map((b) => (
                    <button key={b.label} className="btn ic" aria-label={b.label} data-tip={b.label}>
                      <b.icon size={16} aria-hidden />
                    </button>
                  ))}
                  <span className="vsep" aria-hidden />
                  <button className="btn ic" aria-label="Anexar" data-tip="Anexar">
                    <Paperclip size={16} aria-hidden />
                  </button>
                  <button className="btn ic" aria-label="Imagem" data-tip="Imagem">
                    <ImageIcon size={16} aria-hidden />
                  </button>
                  <button className="btn ic" aria-label="Emoji" data-tip="Emoji">
                    <Smile size={16} aria-hidden />
                  </button>
                  <span className="saved-note" role="status">
                    {sent ? (
                      <>
                        <CircleCheck size={13} aria-hidden />
                        Resposta enviada (exemplo)
                      </>
                    ) : reply ? (
                      <>
                        <CircleCheck size={13} aria-hidden />
                        Rascunho salvo
                      </>
                    ) : null}
                  </span>
                  <button className="btn solid" onClick={send} disabled={!reply.trim()} style={!reply.trim() ? { opacity: 0.5 } : undefined}>
                    <SendHorizontal size={15} aria-hidden />
                    Enviar
                  </button>
                </div>
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
                <button className="btn glass sm" onClick={() => navigate({ name: "compose" })}>
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
                      <AttachmentIcon kind={a.kind} size={16} />
                      <div>
                        <div className="rd-att-name">{a.name}</div>
                        <div className="rd-att-size">{a.size}</div>
                      </div>
                      <button className="btn glass ic" aria-label={`Baixar ${a.name}`} data-tip="Baixar">
                        <Download size={14} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
                {t.attachments.length > 1 && (
                  <button className="btn glass">
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
