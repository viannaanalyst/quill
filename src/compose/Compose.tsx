import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import "./compose.css";
import { TopBar } from "../components/TopBar";
import { Logo } from "../components/Logo";
import { CircleCheck, Clock, LoaderCircle, Paperclip, Pencil, SendHorizontal, Trash2, TriangleAlert, Users, X } from "../components/icons";
import { ACCOUNTS, ACCOUNT_BY_ID } from "../inbox/sampleData";
import type { Message } from "../inbox/types";
import { backToFolder, navigate, type ComposeDraft } from "../state/store";
import { CONTACTS, SENDER_EMAILS, SIGNATURES, type Contact } from "./contacts";
import { Select } from "../components/Select";
import { SliderGroup } from "../components/SliderGroup";
import { toast } from "../components/Toasts";
import { isTauri } from "../lib/platform";
import { usePref } from "../lib/usePref";
import { useMailbox } from "../state/mailbox";
import { queueSend } from "../state/outbox";
import { loadContacts, useContacts } from "../state/contacts";
import { MessageAvatar } from "../components/MessageAvatar";
import { signatureHtml } from "../lib/signature";
import { FileIcon } from "../components/FileIcon";
import { previewAttachment } from "../components/AttachmentPreview";
import { FILE_LABEL, fileSize, fileType, mimeFor } from "../lib/files";
import { api, friendlyError, type OutgoingMessage } from "../lib/api";
import { RichToolbar } from "./RichToolbar";

const EMAIL_RE = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$/;
const TONES = ["peach", "blue", "neutral"] as const;

function initialsFrom(name: string) {
  const parts = name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "")).toUpperCase() || "?";
}

/** Pessoa a partir de um nome e e-mail (digitado ou vindo de um e-mail recebido). */
function contactOf(name: string, email: string, account = "", recent?: string, photo?: string | null): Contact {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  const shown = name.trim() || email;
  return { id: email.toLowerCase(), name: shown, email, initials: initialsFrom(shown), tone: TONES[Math.abs(h) % 3], account, recent, photo };
}

/** Contatos = quem aparece nos e-mails já carregados (remetentes e destinatários), mais recentes primeiro. */
function contactsFromMail(lists: (Message[] | undefined)[]): Contact[] {
  const seen = new Map<string, Contact>();
  const all = lists.flatMap((l) => l ?? []).toSorted((a, b) => (b.internalDate ?? 0) - (a.internalDate ?? 0));
  for (const m of all) {
    const pairs: [string | undefined, string | undefined][] = [
      [m.from, m.fromEmail],
      [m.toName, m.toEmail],
    ];
    for (const [name, email] of pairs) {
      if (!email || email === m.accountEmail || /no-?reply|mailer-daemon|notifica/i.test(email)) continue;
      const key = email.toLowerCase();
      if (!seen.has(key)) seen.set(key, contactOf(name ?? "", email, m.accountEmail, m.date));
    }
  }
  return [...seen.values()];
}

const SCHEDULE = [
  { id: "tomorrow", title: "Amanhã de manhã", sub: "Qua, 18 nov · 08:00" },
  { id: "monday", title: "Segunda-feira cedo", sub: "Seg, 23 nov · 08:00" },
  { id: "custom", title: "Escolher data e hora", sub: "Abre o calendário" },
] as const;

const INITIAL_BODY = `<p>Oi, pessoal,</p><p>Segue o resumo do fechamento de outubro, já revisado com a Mariana:</p><ul><li>Receita consolidada de <strong>R$ 1,42 milhão</strong>, 6% acima de setembro.</li><li>Repasse duplicado em três igrejas corrigido.</li><li>Campinas entrou no comparativo a partir deste mês.</li></ul><p>A planilha completa está em anexo. Na quinta, no Planejamento Q1, passo pelos números com calma.</p><p>Abraço,</p>`;

interface Draft {
  key: string;
  name: string;
  /** bytes (0 nos exemplos) */
  bytes: number;
  /** texto pronto dos exemplos */
  size?: string;
  mime: string;
  /** conteúdo em base64 (quando terminou de ler) */
  data?: string;
  /** 0–1 enquanto lê o arquivo; undefined quando pronto */
  progress?: number;
}

/** Limite do Gmail para um e-mail com anexos. */
const MAX_TOTAL = 25 * 1024 * 1024;

function ContactAvatar({ c, size = 20 }: { c: Contact; size?: number }) {
  if (c.group) {
    return (
      <span className="av" style={{ width: size, height: size }}>
        <Users size={size * 0.55} aria-hidden />
      </span>
    );
  }
  if (c.photo) {
    return <img className="av cp-photo" src={c.photo} alt="" width={size} height={size} referrerPolicy="no-referrer" style={{ width: size, height: size }} />;
  }
  return <MessageAvatar message={{ avatar: { kind: "initials", initials: c.initials, tone: c.tone }, fromEmail: c.email }} size={size} />;
}

/** Campo de destinatários: pílulas + sugestões enquanto digita (setas, Enter e Backspace). */
function RecipientField({
  label,
  value,
  onChange,
  trailing,
  placeholder,
  contacts,
}: {
  label: string;
  value: Contact[];
  onChange: (v: Contact[]) => void;
  trailing?: ReactNode;
  placeholder?: string;
  contacts: Contact[];
}) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const q = text.trim().toLocaleLowerCase("pt-BR");
  const suggestions = useMemo(
    () => {
      if (!q) return [];
      const taken = new Set(value.map((v) => v.email.toLowerCase()));
      const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
      const t = norm(q);
      const hits: [Contact, number][] = [];
      // a lista já vem na ordem de quem você mais escreve; começo de palavra (nome ou e-mail) vem antes
      for (const c of contacts) {
        if (taken.has(c.email.toLowerCase())) continue;
        const name = norm(c.name);
        const email = norm(c.email);
        if (name.split(/[\s.\-_]+/).some((w) => w.startsWith(t)) || email.split(/[@.\-_+]/).some((w) => w.startsWith(t))) hits.push([c, 2]);
        else if (name.includes(t) || email.includes(t)) hits.push([c, 1]);
        if (hits.length >= 60) break;
      }
      return hits.toSorted((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
    },
    [q, value, contacts],
  );
  const open = suggestions.length > 0;

  const add = (c: Contact) => {
    onChange([...value, c]);
    setText("");
    setActive(0);
  };
  /** e-mail digitado direto (Enter, vírgula, Tab ou ao sair do campo) */
  const addTyped = () => {
    const raw = text.trim().replace(/[,;]$/, "");
    if (!EMAIL_RE.test(raw)) return false;
    if (!value.some((v) => v.email.toLowerCase() === raw.toLowerCase())) onChange([...value, contactOf("", raw)]);
    setText("");
    return true;
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === "Tab" && text)) && !open) {
      if (addTyped()) e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      add(suggestions[active]);
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") {
      setText("");
    }
  };

  return (
    <div className="cp-field">
      <span className="cp-label" id={`${listId}-label`}>{label}</span>
      <div className="cp-recipients">
        {value.map((c) => (
          <span key={c.id} className={`person-chip${c.group ? " group" : ""}`}>
            <ContactAvatar c={c} />
            {c.group ? `${c.name} · ${c.group} pessoas` : c.name}
            <button aria-label={`Remover ${c.name}`} onClick={() => onChange(value.filter((v) => v.id !== c.id))}>
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          role="combobox"
          aria-labelledby={`${listId}-label`}
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          value={text}
          placeholder={value.length ? "" : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          onBlur={() => void addTyped()}
          onPaste={(e) => {
            // colar vários e-mails de uma vez
            const found = e.clipboardData.getData("text").match(/[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+/g);
            if (found && found.length > 1) {
              e.preventDefault();
              const known = new Set(value.map((v) => v.email.toLowerCase()));
              onChange([...value, ...found.filter((f) => !known.has(f.toLowerCase())).map((f) => contactOf("", f))]);
            }
          }}
        />
      </div>
      {trailing}
      {open && (
        <ul className="cp-suggest" id={listId} role="listbox">
          {suggestions.map((c, i) => {
            const acc = ACCOUNT_BY_ID.get(c.account);
            const hit = c.name.toLocaleLowerCase("pt-BR").indexOf(q);
            return (
              <li
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(c);
                }}
              >
                <ContactAvatar c={c} size={30} />
                <span>
                  <span className="cp-sug-name" style={{ display: "block" }}>
                    {hit >= 0 ? (
                      <>
                        {c.name.slice(0, hit)}
                        <b style={{ color: "var(--blue)" }}>{c.name.slice(hit, hit + q.length)}</b>
                        {c.name.slice(hit + q.length)}
                      </>
                    ) : (
                      c.name
                    )}
                  </span>
                  <span className="cp-sug-mail" style={{ display: "block" }}>{c.email}</span>
                </span>
                {acc && (
                  <span className="acct">
                    <i style={{ background: acc.color }} />
                    {acc.name}
                  </span>
                )}
              </li>
            );
          })}
          <li className="cp-suggest-foot" aria-hidden role="presentation">
            <span>↑↓ para escolher</span>
            <span>Enter para adicionar</span>
          </li>
        </ul>
      )}
    </div>
  );
}

interface Sender {
  id: string;
  name: string;
  email: string;
  logo: (typeof ACCOUNTS)[number]["logo"];
  color: string;
}

const PREVIEW_SENDERS: Sender[] = ACCOUNTS.map((a) => ({ id: a.id, name: a.name, email: SENDER_EMAILS[a.id], logo: a.logo, color: a.color }));

/** Espera depois da última mudança para salvar o rascunho. */
const DRAFT_DELAY = 3000;

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: number } | { kind: "error"; reason: string };

function savedAgo(at: number) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 5) return "Rascunho salvo agora";
  if (s < 60) return `Rascunho salvo há ${s} s`;
  if (s < 3600) return `Rascunho salvo há ${Math.floor(s / 60)} min`;
  return `Rascunho salvo às ${new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Aviso do rascunho ("Salvando…", "Rascunho salvo há 12 s", "Não salvou"). O tempo anda sozinho. */
function DraftStatus({ state, style }: { state: SaveState; style?: CSSProperties }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (state.kind !== "saved") return;
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [state]);
  if (state.kind === "idle") return null;
  if (state.kind === "error") {
    const reason = state.reason.length > 90 ? `${state.reason.slice(0, 88)}…` : state.reason;
    return (
      <span className="saved-note cp-save-error" role="status" tabIndex={0} data-tip={reason} style={style}>
        <TriangleAlert size={13} aria-hidden />
        Não salvou
        <span className="sr-only">: {state.reason}</span>
      </span>
    );
  }
  return (
    <span className="saved-note" role="status" style={style}>
      {state.kind === "saving" ? (
        <>
          <span className="spinning cp-saving" aria-hidden>
            <LoaderCircle size={13} />
          </span>
          Salvando…
        </>
      ) : (
        <>
          <CircleCheck size={13} aria-hidden />
          {/* o texto que anda a cada segundo não é lido de novo pelo leitor de tela */}
          <span aria-hidden>{savedAgo(state.at)}</span>
          <span className="sr-only">Rascunho salvo</span>
        </>
      )}
    </span>
  );
}

/** Tem algo escrito que valha salvar? */
function hasContent(m: OutgoingMessage) {
  const text = m.html.replace(/<(?!img|hr)[^>]*>/gi, "").replace(/&nbsp;/g, " ").trim();
  return m.to.length + m.cc.length + m.bcc.length > 0 || !!m.subject.trim() || !!text || (m.attachments?.length ?? 0) > 0;
}

export default function Compose({ draft }: { draft?: ComposeDraft }) {
  const live = isTauri;
  const accounts = useMailbox((s) => s.accounts);
  const profiles = useMailbox((s) => s.profiles);
  const folders = useMailbox((s) => s.folders);
  const senders: Sender[] = useMemo(
    () => (live ? accounts.map((a) => ({ id: a.id, name: a.name, email: a.id, logo: a.logo, color: a.color })) : PREVIEW_SENDERS),
    [live, accounts],
  );
  const suggested = useContacts();
  useEffect(() => void loadContacts(), []);
  const contacts = useMemo(() => {
    if (!live) return CONTACTS;
    // contatos do Google e dos enviados primeiro; depois quem aparece nos e-mails já carregados
    const fromGoogle = suggested.map((c) => contactOf(c.name ?? "", c.email, "", undefined, c.photo));
    const seen = new Set(fromGoogle.map((c) => c.id));
    const fromMail = contactsFromMail([folders.inbox, folders.sent, folders.starred, folders.archive]).filter((c) => !seen.has(c.id));
    return [...fromGoogle, ...fromMail];
  }, [live, suggested, folders.inbox, folders.sent, folders.starred, folders.archive]);

  const [from, setFrom] = useState<string>(() => draft?.from ?? (live ? (accounts[0]?.id ?? "") : "inchurch"));
  const [to, setTo] = useState<Contact[]>(() => (draft?.to ? draft.to.map((p) => contactOf(p.name, p.email)) : live ? [] : [CONTACTS[0]]));
  const [cc, setCc] = useState<Contact[]>(() => (draft?.cc ? draft.cc.map((p) => contactOf(p.name, p.email)) : live || draft ? [] : [CONTACTS[1]]));
  const [bcc, setBcc] = useState<Contact[]>(() => (draft?.bcc ? draft.bcc.map((p) => contactOf(p.name, p.email)) : []));
  const [showBcc, setShowBcc] = useState(() => (draft?.bcc?.length ?? 0) > 0);
  const [subject, setSubject] = useState(() => draft?.subject ?? (live ? "" : "Resumo do fechamento de outubro"));
  const [schedule, setSchedule] = useState<(typeof SCHEDULE)[number]["id"]>("tomorrow");
  const [signature, setSignature] = useState<keyof typeof SIGNATURES>("inchurch");
  const [files, setFiles] = useState<Draft[]>(() =>
    draft?.attachments
      ? draft.attachments.map((a, i) => ({ key: `d${i}-${a.name}`, name: a.name, bytes: a.size, mime: a.mimeType, data: a.data }))
      : live
      ? []
      : [
          { key: "ex1", name: "resumo-diretoria.pdf", bytes: 0, size: "1,2 MB", mime: "application/pdf", data: "" },
          { key: "ex2", name: "fechamento-outubro-2026.xlsx", bytes: 0, mime: "application/vnd.ms-excel", progress: 0.6 },
        ],
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  /** Lê os arquivos escolhidos (com a barra de progresso real da leitura). */
  const addFiles = (list: FileList | File[]) => {
    const picked = [...list];
    const total = files.reduce((n, f) => n + f.bytes, 0) + picked.reduce((n, f) => n + f.size, 0);
    if (total > MAX_TOTAL) {
      setSendError(`Os anexos passam de 25 MB (${fileSize(total)}). O Gmail não aceita e-mails tão grandes.`);
      return;
    }
    setSendError(null);
    for (const file of picked) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`;
      setFiles((all) => [...all, { key, name: file.name, bytes: file.size, mime: mimeFor(file), progress: 0 }]);
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable) setFiles((all) => all.map((f) => (f.key === key ? { ...f, progress: e.loaded / e.total } : f)));
      };
      reader.onload = () => {
        const data = String(reader.result).split(",", 2)[1] ?? "";
        setFiles((all) => all.map((f) => (f.key === key ? { ...f, data, progress: undefined } : f)));
      };
      reader.onerror = () => {
        setFiles((all) => all.filter((f) => f.key !== key));
        toast(`Não consegui ler ${file.name}`, "error");
      };
      reader.readAsDataURL(file);
    }
  };
  const sending = false;
  const [sendError, setSendError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [initialBody] = useState(() => draft?.body ?? (live ? "" : INITIAL_BODY));
  const sender = senders.find((a) => a.id === from) ?? senders[0];
  const [sigText] = usePref(`signature:${sender?.email ?? ""}`, "");
  const [sigMode] = usePref<string>(`account:${sender?.email ?? ""}:signature`, "account");
  const accountSig = sigMode === "none" ? "" : sigText;
  const signatureText = live ? accountSig : SIGNATURES[signature];
  const done = backToFolder;

  // a conta escolhida sumiu (ou ainda não tinha carregado): usa a primeira
  if (live && senders.length > 0 && !senders.some((a) => a.id === from)) setFrom(senders[0].id);

  // ---------- rascunho no Gmail: salva sozinho 3 s depois da última mudança ----------
  const [save, setSave] = useState<SaveState>(() => (live ? { kind: "idle" } : { kind: "saved", at: Date.now() - 5000 }));
  const draftId = useRef<string | null>(draft?.draftId ?? null);
  /** conta em que o rascunho está salvo (se trocar o "De", o antigo sai dessa conta) */
  const draftAccount = useRef<string | null>(draft?.draftId ? (draft.from ?? null) : null);
  const htmlRef = useRef(initialBody);
  const dirty = useRef(false);
  /** enviado ou descartado: não salva mais */
  const closed = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  const saveAgain = useRef(false);
  const latest = useRef({ to, cc, bcc, subject, files, sender, profiles });
  useLayoutEffect(() => {
    latest.current = { to, cc, bcc, subject, files, sender, profiles };
  });

  const buildMessage = (): OutgoingMessage | null => {
    const s = latest.current;
    if (!s.sender) return null;
    return {
      from: s.sender.email,
      fromName: s.profiles[s.sender.email]?.name ?? null,
      to: s.to.map((c) => c.email),
      cc: s.cc.map((c) => c.email),
      bcc: s.bcc.map((c) => c.email),
      subject: s.subject.trim(),
      // sem a assinatura: ela entra só no envio (senão duplicaria ao reabrir o rascunho)
      html: htmlRef.current,
      attachments: s.files.filter((f) => f.data).map((f) => ({ name: f.name, mimeType: f.mime, data: f.data! })),
    };
  };

  const saveDraft = (): Promise<void> => {
    window.clearTimeout(saveTimer.current);
    if (closed.current || !dirty.current) return Promise.resolve();
    if (inflight.current) {
      saveAgain.current = true;
      return inflight.current;
    }
    // anexo ainda carregando: espera ele terminar (a mudança na lista agenda de novo)
    if (live && latest.current.files.some((f) => f.progress !== undefined)) return Promise.resolve();
    const msg = buildMessage();
    if (!msg || !hasContent(msg)) return Promise.resolve();
    dirty.current = false;
    setSave({ kind: "saving" });
    const run = (async () => {
      try {
        if (!live) {
          await new Promise((r) => window.setTimeout(r, 450));
          draftId.current = "preview";
        } else {
          if (draftId.current && draftAccount.current && draftAccount.current !== msg.from) {
            const [oldAccount, oldId] = [draftAccount.current, draftId.current];
            draftId.current = null;
            void api.draftDelete(oldAccount, oldId).catch(() => undefined);
          }
          draftId.current = await api.draftSave(msg, draftId.current, draft?.threadId);
        }
        draftAccount.current = msg.from;
        setSave({ kind: "saved", at: Date.now() });
      } catch (e) {
        dirty.current = true;
        setSave({ kind: "error", reason: friendlyError(e) });
      }
    })().finally(() => {
      inflight.current = null;
      if (saveAgain.current) {
        saveAgain.current = false;
        void saveDraft();
      }
    });
    inflight.current = run;
    return run;
  };
  const saveRef = useRef(saveDraft);
  useLayoutEffect(() => {
    saveRef.current = saveDraft;
  });

  /** Algo mudou: salva daqui a 3 s (se nada mais mudar). */
  const changed = () => {
    if (closed.current) return;
    dirty.current = true;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveRef.current(), DRAFT_DELAY);
  };
  const changedRef = useRef(changed);
  useLayoutEffect(() => {
    changedRef.current = changed;
  });

  // destinatários, assunto e anexos (prontos); o texto avisa pelo onInput do editor
  const fieldsSig = JSON.stringify([
    to.map((c) => c.email),
    cc.map((c) => c.email),
    bcc.map((c) => c.email),
    subject,
    files.map((f) => `${f.key}:${f.data === undefined ? 0 : 1}`),
  ]);
  const lastSig = useRef(fieldsSig);
  useEffect(() => {
    if (fieldsSig === lastSig.current) return;
    lastSig.current = fieldsSig;
    changedRef.current();
  }, [fieldsSig]);
  // trocou a conta do "De" com rascunho já salvo: salva na conta nova
  const lastFrom = useRef(from);
  useEffect(() => {
    if (from === lastFrom.current) return;
    lastFrom.current = from;
    if (draftId.current) changedRef.current();
  }, [from]);

  // saiu da tela com mudança não salva (Fechar, outra tela): salva na hora
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      if (!closed.current && dirty.current) void saveRef.current();
    },
    [],
  );

  /** Espera um salvamento em andamento (para saber o id do rascunho). */
  const settle = async () => {
    window.clearTimeout(saveTimer.current);
    while (inflight.current) await inflight.current.catch(() => undefined);
  };

  const discard = async () => {
    closed.current = true;
    window.clearTimeout(saveTimer.current);
    const account = draftAccount.current ?? sender?.email ?? "";
    done();
    await settle();
    const id = draftId.current;
    if (!id) return;
    if (!live) return toast("Rascunho descartado");
    try {
      await api.draftDelete(draftAccount.current ?? account, id);
      toast("Rascunho descartado");
    } catch (e) {
      toast(`Não descartou o rascunho: ${friendlyError(e)}`, "error");
    }
  };

  const chosen = SCHEDULE.find((s) => s.id === schedule)!;

  const send = async () => {
    if (!live) {
      toast("Prévia: nada foi enviado");
      return done();
    }
    if (!sender) return setSendError("Conecte uma conta para enviar.");
    if (to.length + cc.length + bcc.length === 0) return setSendError("Coloque pelo menos um destinatário em Para.");
    if (files.some((f) => f.progress !== undefined)) return setSendError("Espere os anexos terminarem de carregar.");
    setSendError(null);
    const html = bodyRef.current?.innerHTML ?? "";
    // não salva mais; espera um salvamento em andamento para o rascunho sair de Rascunhos depois do envio
    closed.current = true;
    await settle();
    const ready = files.filter((f) => f.data);
    const person = (c: Contact) => ({ name: c.name, email: c.email });
    queueSend(
      {
        from: sender.email,
        fromName: profiles[sender.email]?.name ?? null,
        to: to.map((c) => c.email),
        cc: cc.map((c) => c.email),
        bcc: bcc.map((c) => c.email),
        subject: subject.trim(),
        html: `${html}${signatureHtml(sender.email)}`,
        attachments: ready.map((f) => ({ name: f.name, mimeType: f.mime, data: f.data! })),
      },
      draft?.threadId,
      {
        from: sender.email,
        to: to.map(person),
        cc: cc.map(person),
        bcc: bcc.map(person),
        subject,
        body: html,
        threadId: draft?.threadId,
        draftId: draftId.current ?? undefined,
        attachments: ready.map((f) => ({ name: f.name, mimeType: f.mime, data: f.data!, size: f.bytes })),
      },
    );
    done();
  };

  return (
    <>
      <TopBar
        leading={
          <button className="btn glass ic" aria-label="Fechar" data-tip="Fechar" onClick={done} style={{ marginRight: 6 }}>
            <X size={17} aria-hidden />
          </button>
        }
        title={draft?.threadId ? "Responder" : "Nova mensagem"}
        sub={subject || "Sem assunto"}
      />
      <div className="cp">
        <div className="toolbar">
          <button className="btn solid lg" onClick={() => void send()} disabled={sending}>
            {sending ? <LoaderCircle size={17} className="spinning" aria-hidden /> : <SendHorizontal size={17} aria-hidden />}
            {sending ? "Enviando…" : "Enviar"}
          </button>
          {!live && (
            <button className="btn glass lg" onClick={done}>
              <Clock size={17} aria-hidden />
              Agendar
            </button>
          )}
          <button
            className="btn glass ic"
            aria-label="Anexar arquivo"
            data-tip="Anexar"
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={17} aria-hidden />
          </button>
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
          {sendError ? (
            <span className="cp-error" role="alert" style={{ marginLeft: "auto" }}>
              {sendError}
            </span>
          ) : (
            <DraftStatus state={save} style={{ marginLeft: "auto" }} />
          )}
          <button className="btn glass" onClick={() => void discard()} style={save.kind === "idle" && !sendError ? { marginLeft: "auto" } : undefined}>
            <Trash2 size={16} aria-hidden />
            Descartar
          </button>
        </div>

        <div className="cp-content">
          <section
            className={`card cp-card${dragging ? " cp-dragging" : ""}`}
            aria-label="Nova mensagem"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                setDragging(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
          >
            {dragging && (
              <div className="cp-drop" aria-hidden>
                <Paperclip size={22} />
                Solte para anexar
              </div>
            )}
            <div className="cp-field">
              <span className="cp-label">De</span>
              {sender ? (
                <Select
                  className="cp-from-select"
                  label="Enviar pela conta"
                  value={sender.id}
                  onChange={setFrom}
                  options={senders.map((a) => ({
                    value: a.id,
                    label: live ? `${profiles[a.email]?.name ?? a.name} · ${a.email}` : `Gabriel Vianna · ${a.email}`,
                    leading: (
                      <span className="cp-from-logo">
                        <Logo name={a.logo} size={14} />
                        <i style={{ background: a.color }} />
                      </span>
                    ),
                  }))}
                />
              ) : (
                <span className="cp-hint">Nenhuma conta conectada</span>
              )}
              {!live && <span className="cp-hint">Conta escolhida pela conversa</span>}
            </div>
            <RecipientField
              label="Para"
              value={to}
              onChange={setTo}
              contacts={contacts}
              placeholder="Digite um nome ou e-mail"
              trailing={
                !showBcc && (
                  <button className="cp-toggle-cc" onClick={() => setShowBcc(true)}>
                    Cco
                  </button>
                )
              }
            />
            <RecipientField label="Cc" value={cc} onChange={setCc} contacts={contacts} placeholder="Com cópia para…" />
            {showBcc && <RecipientField label="Cco" value={bcc} onChange={setBcc} contacts={contacts} placeholder="Cópia oculta para…" />}
            <div className="cp-field">
              <label className="cp-label" htmlFor="cp-subject">Assunto</label>
              <input id="cp-subject" className="cp-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Sem assunto" />
            </div>

            <RichToolbar editorRef={bodyRef} onImages={addFiles} onEdited={() => {
                htmlRef.current = bodyRef.current?.innerHTML ?? "";
                changed();
              }} />

            <div
              ref={bodyRef}
              className="cp-body"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Texto do e-mail"
              data-placeholder="Escreva sua mensagem…"
              dangerouslySetInnerHTML={{ __html: initialBody }}
              onInput={(e) => {
                htmlRef.current = e.currentTarget.innerHTML;
                changed();
              }}
            />
            {signatureText && <div className="cp-signature">{signatureText}</div>}

            {files.length > 0 && (
              <ul className="cp-attachments" aria-label="Anexos">
                {files.map((f) => {
                  const busy = f.progress !== undefined || sending;
                  return (
                    <li key={f.key} className="cp-attachment">
                      <button
                        className="cp-att-open"
                        aria-label={`Ver ${f.name}`}
                        data-tip="Ver"
                        disabled={!f.data}
                        onClick={() => f.data && previewAttachment({ name: f.name, mime: f.mime, size: f.bytes, load: async () => f.data! })}
                      >
                        <FileIcon name={f.name} mime={f.mime} size={38} />
                      </button>
                      <div style={{ minWidth: 0 }}>
                        <div className="cp-att-name">{f.name}</div>
                        {busy ? (
                          <div
                            className={`cp-progress${f.progress === undefined ? " indeterminate" : ""}`}
                            role="progressbar"
                            aria-label={sending ? `Enviando ${f.name}` : `Carregando ${f.name}`}
                            aria-valuenow={f.progress === undefined ? undefined : Math.round(f.progress * 100)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <i style={f.progress === undefined ? undefined : { transform: `scaleX(${Math.max(0.04, f.progress)})` }} />
                          </div>
                        ) : (
                          <div className="cp-att-meta">
                            {FILE_LABEL[fileType(f.name, f.mime)]} · {f.size ?? fileSize(f.bytes)}
                          </div>
                        )}
                      </div>
                      <button aria-label={`Remover ${f.name}`} onClick={() => setFiles((all) => all.filter((x) => x.key !== f.key))} disabled={sending}>
                        <X size={15} aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside className="cp-side" aria-label="Opções de envio">
            {!live && (
              <section className="card cp-side-card">
                <div className="section-label">
                  <Clock size={14} aria-hidden />
                  Agendar envio
                </div>
                <div role="radiogroup" aria-label="Quando enviar">
                  {SCHEDULE.map((s) => (
                    <button key={s.id} className="cp-option" role="radio" aria-checked={schedule === s.id} onClick={() => setSchedule(s.id)}>
                      <span className="cp-radio" aria-hidden />
                      <span>
                        <span className="cp-opt-title" style={{ display: "block" }}>{s.title}</span>
                        <span className="cp-opt-sub" style={{ display: "block" }}>{s.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <button className="btn glass" onClick={done}>
                  <Clock size={15} aria-hidden />
                  {schedule === "custom" ? "Escolher data e hora" : `Agendar para ${chosen.sub.split(" · ")[0].toLowerCase()}, ${chosen.sub.split(" · ")[1]}`}
                </button>
              </section>
            )}

            <section className="card cp-side-card">
              <div className="section-label">
                <Pencil size={14} aria-hidden />
                Assinatura
              </div>
              {live ? (
                <>
                  <div className="cp-sig-preview">{accountSig || "Esta conta ainda não tem assinatura."}</div>
                  <button className="btn glass" onClick={() => navigate({ name: "settings" })}>
                    <Pencil size={15} aria-hidden />
                    {accountSig ? "Editar em Ajustes" : "Criar em Ajustes"}
                  </button>
                </>
              ) : (
                <>
                  <SliderGroup activeKey={signature} className="segmented" role="group" label="Assinatura">
                    <button aria-pressed={signature === "inchurch"} onClick={() => setSignature("inchurch")}>inchurch</button>
                    <button aria-pressed={signature === "pessoal"} onClick={() => setSignature("pessoal")}>Pessoal</button>
                    <button aria-pressed={signature === "none"} onClick={() => setSignature("none")}>Nenhuma</button>
                  </SliderGroup>
                  <div className="cp-sig-preview">{SIGNATURES[signature] || "Sem assinatura"}</div>
                </>
              )}
            </section>

          </aside>
        </div>
      </div>
    </>
  );
}
