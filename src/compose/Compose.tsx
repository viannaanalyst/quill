import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import "./compose.css";
import { TopBar } from "../components/TopBar";
import { Logo } from "../components/Logo";
import {
  AtSign,
  Bold,
  ChevronDown,
  CircleCheck,
  Clock,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  Paperclip,
  Pencil,
  Plus,
  SendHorizontal,
  Smile,
  Trash2,
  Type,
  Underline,
  Users,
  X,
} from "../components/icons";
import { ACCOUNTS, ACCOUNT_BY_ID } from "../inbox/sampleData";
import type { AccountId } from "../inbox/types";
import { navigate } from "../state/store";
import { CONTACTS, SENDER_EMAILS, SIGNATURES, type Contact } from "./contacts";

const SCHEDULE = [
  { id: "tomorrow", title: "Amanhã de manhã", sub: "Qua, 18 nov · 08:00" },
  { id: "monday", title: "Segunda-feira cedo", sub: "Seg, 23 nov · 08:00" },
  { id: "custom", title: "Escolher data e hora", sub: "Abre o calendário" },
] as const;

const INITIAL_BODY = `<p>Oi, pessoal,</p><p>Segue o resumo do fechamento de outubro, já revisado com a Mariana:</p><ul><li>Receita consolidada de <strong>R$ 1,42 milhão</strong>, 6% acima de setembro.</li><li>Repasse duplicado em três igrejas corrigido.</li><li>Campinas entrou no comparativo a partir deste mês.</li></ul><p>A planilha completa está em anexo. Na quinta, no Planejamento Q1, passo pelos números com calma.</p><p>Abraço,</p>`;

interface Draft {
  name: string;
  size?: string;
  kind: "pdf" | "sheet";
  uploading?: boolean;
}

function ContactAvatar({ c, size = 20 }: { c: Contact; size?: number }) {
  if (c.group) {
    return (
      <span className="av" style={{ width: size, height: size }}>
        <Users size={size * 0.55} aria-hidden />
      </span>
    );
  }
  return (
    <span className={`av ${c.tone}`} style={{ width: size, height: size, fontSize: Math.max(8, size * 0.36) }} aria-hidden>
      {c.initials}
    </span>
  );
}

/** Campo de destinatários: pílulas + sugestões enquanto digita (setas, Enter e Backspace). */
function RecipientField({
  label,
  value,
  onChange,
  trailing,
  placeholder,
}: {
  label: string;
  value: Contact[];
  onChange: (v: Contact[]) => void;
  trailing?: ReactNode;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const q = text.trim().toLocaleLowerCase("pt-BR");
  const suggestions = useMemo(
    () =>
      q
        ? CONTACTS.filter(
            (c) => !value.some((v) => v.id === c.id) && `${c.name} ${c.email}`.toLocaleLowerCase("pt-BR").includes(q),
          ).slice(0, 5)
        : [],
    [q, value],
  );
  const open = suggestions.length > 0;

  const add = (c: Contact) => {
    onChange([...value, c]);
    setText("");
    setActive(0);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
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
        />
      </div>
      {trailing}
      {open && (
        <ul className="cp-suggest" id={listId} role="listbox">
          {suggestions.map((c, i) => {
            const acc = ACCOUNT_BY_ID.get(c.account)!;
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
                <span className="acct">
                  <i style={{ background: acc.color }} />
                  {acc.name}
                </span>
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

export default function Compose() {
  const [from, setFrom] = useState<AccountId>("inchurch");
  const [to, setTo] = useState<Contact[]>(() => [CONTACTS[0]]);
  const [cc, setCc] = useState<Contact[]>(() => [CONTACTS[1]]);
  const [showBcc, setShowBcc] = useState(false);
  const [bcc, setBcc] = useState<Contact[]>([]);
  const [subject, setSubject] = useState("Resumo do fechamento de outubro");
  const [schedule, setSchedule] = useState<(typeof SCHEDULE)[number]["id"]>("tomorrow");
  const [signature, setSignature] = useState<keyof typeof SIGNATURES>("inchurch");
  const [files, setFiles] = useState<Draft[]>([
    { name: "resumo-diretoria.pdf", size: "1,2 MB", kind: "pdf" },
    { name: "fechamento-outubro-2026.xlsx", kind: "sheet", uploading: true },
  ]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sender = ACCOUNT_BY_ID.get(from)!;
  const done = () => navigate({ name: "inbox", folder: "inbox" });

  const format = (cmd: string) => {
    bodyRef.current?.focus();
    // execCommand ainda é o caminho mais simples para editar texto rico no WebView.
    document.execCommand(cmd);
  };
  const recent = CONTACTS.filter((c) => c.recent);
  const chosen = SCHEDULE.find((s) => s.id === schedule)!;

  return (
    <>
      <TopBar
        leading={
          <button className="btn glass ic" aria-label="Fechar" data-tip="Fechar" onClick={done} style={{ marginRight: 6 }}>
            <X size={17} aria-hidden />
          </button>
        }
        title="Nova mensagem"
        sub={subject || "Sem assunto"}
      />
      <div className="cp">
        <div className="toolbar">
          <button className="btn solid lg" onClick={done}>
            <SendHorizontal size={17} aria-hidden />
            Enviar
          </button>
          <button className="btn glass lg" onClick={done}>
            <Clock size={17} aria-hidden />
            Agendar
          </button>
          <button
            className="btn glass ic"
            aria-label="Anexar arquivo"
            data-tip="Anexar"
            onClick={() => setFiles((f) => [...f, { name: `anexo-${f.length + 1}.pdf`, kind: "pdf", uploading: true }])}
          >
            <Paperclip size={17} aria-hidden />
          </button>
          <span className="saved-note" role="status" style={{ marginLeft: "auto" }}>
            <CircleCheck size={13} aria-hidden />
            Rascunho salvo há 5 s
          </span>
          <button className="btn glass" onClick={done}>
            <Trash2 size={16} aria-hidden />
            Descartar
          </button>
        </div>

        <div className="cp-content">
          <section className="card cp-card" aria-label="Nova mensagem">
            <div className="cp-field">
              <span className="cp-label">De</span>
              <span className="cp-from">
                <span className="cp-from-logo">
                  <Logo name={sender.logo} size={14} />
                  <i style={{ background: sender.color }} />
                </span>
                Gabriel Vianna <span className="cp-from-mail">{SENDER_EMAILS[from]}</span>
                <ChevronDown size={14} aria-hidden style={{ color: "var(--ink3)" }} />
                <select aria-label="Enviar pela conta" value={from} onChange={(e) => setFrom(e.target.value as AccountId)}>
                  {ACCOUNTS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {SENDER_EMAILS[a.id]}
                    </option>
                  ))}
                </select>
              </span>
              <span className="cp-hint">Conta escolhida pela conversa</span>
            </div>
            <RecipientField
              label="Para"
              value={to}
              onChange={setTo}
              placeholder="Digite um nome ou e-mail"
              trailing={
                !showBcc && (
                  <button className="cp-toggle-cc" onClick={() => setShowBcc(true)}>
                    Cco
                  </button>
                )
              }
            />
            <RecipientField label="Cc" value={cc} onChange={setCc} placeholder="Com cópia para…" />
            {showBcc && <RecipientField label="Cco" value={bcc} onChange={setBcc} placeholder="Cópia oculta para…" />}
            <div className="cp-field">
              <label className="cp-label" htmlFor="cp-subject">Assunto</label>
              <input id="cp-subject" className="cp-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Sem assunto" />
            </div>

            <div className="format-bar cp-format">
              <span className="cp-style">
                <Type size={14} aria-hidden />
                Texto normal
                <ChevronDown size={13} aria-hidden />
              </span>
              {[
                { icon: Bold, label: "Negrito", cmd: "bold" },
                { icon: Italic, label: "Itálico", cmd: "italic" },
                { icon: Underline, label: "Sublinhado", cmd: "underline" },
              ].map((b) => (
                <button key={b.label} className="btn ic" aria-label={b.label} data-tip={b.label} onMouseDown={(e) => e.preventDefault()} onClick={() => format(b.cmd)}>
                  <b.icon size={16} aria-hidden />
                </button>
              ))}
              <span className="vsep" aria-hidden />
              <button className="btn ic" aria-label="Lista" data-tip="Lista" onMouseDown={(e) => e.preventDefault()} onClick={() => format("insertUnorderedList")}>
                <List size={16} aria-hidden />
              </button>
              <button className="btn ic" aria-label="Lista numerada" data-tip="Lista numerada" onMouseDown={(e) => e.preventDefault()} onClick={() => format("insertOrderedList")}>
                <ListOrdered size={16} aria-hidden />
              </button>
              <span className="vsep" aria-hidden />
              <button className="btn ic" aria-label="Link" data-tip="Link">
                <Link size={16} aria-hidden />
              </button>
              <button className="btn ic" aria-label="Imagem" data-tip="Imagem">
                <ImageIcon size={16} aria-hidden />
              </button>
              <button className="btn ic" aria-label="Emoji" data-tip="Emoji">
                <Smile size={16} aria-hidden />
              </button>
              <button className="btn ic" aria-label="Mencionar" data-tip="Mencionar">
                <AtSign size={16} aria-hidden />
              </button>
            </div>

            <div
              ref={bodyRef}
              className="cp-body"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Texto do e-mail"
              dangerouslySetInnerHTML={{ __html: INITIAL_BODY }}
            />
            {SIGNATURES[signature] && <div className="cp-signature">{SIGNATURES[signature]}</div>}

            {files.length > 0 && (
              <ul className="cp-attachments" aria-label="Anexos">
                {files.map((f, i) => (
                  <li key={f.name} className="cp-attachment">
                    <span className={`icon-tile ${f.kind === "sheet" ? "sage" : "blue"}`}>
                      {f.kind === "sheet" ? <FileSpreadsheet size={20} aria-hidden /> : <FileText size={20} aria-hidden />}
                    </span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                      {f.uploading ? (
                        <div className="cp-progress" role="progressbar" aria-label={`Enviando ${f.name}`}>
                          <i />
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 2 }}>PDF · {f.size}</div>
                      )}
                    </div>
                    <button aria-label={`Remover ${f.name}`} onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}>
                      <X size={15} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="cp-side" aria-label="Opções de envio">
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

            <section className="card cp-side-card">
              <div className="section-label">
                <Pencil size={14} aria-hidden />
                Assinatura
              </div>
              <div className="segmented" role="group" aria-label="Assinatura">
                <button aria-pressed={signature === "inchurch"} onClick={() => setSignature("inchurch")}>inchurch</button>
                <button aria-pressed={signature === "pessoal"} onClick={() => setSignature("pessoal")}>Pessoal</button>
                <button aria-pressed={signature === "none"} onClick={() => setSignature("none")}>Nenhuma</button>
              </div>
              <div className="cp-sig-preview">{SIGNATURES[signature] || "Sem assinatura"}</div>
            </section>

            <section className="card cp-side-card">
              <div className="section-label">
                <Users size={14} aria-hidden />
                Contatos recentes
              </div>
              <ul className="cp-contacts">
                {recent.map((c) => {
                  const added = to.some((t) => t.id === c.id);
                  return (
                    <li key={c.id} className="cp-contact">
                      <ContactAvatar c={c} size={32} />
                      <div>
                        <div className="cp-contact-name">{c.name}</div>
                        <div className="cp-contact-meta">
                          {ACCOUNT_BY_ID.get(c.account)!.name} · {c.recent}
                        </div>
                      </div>
                      <button
                        className="btn glass ic"
                        aria-label={added ? `${c.name} já está em Para` : `Adicionar ${c.name} em Para`}
                        data-tip={added ? "Já adicionado" : "Adicionar"}
                        onClick={() => !added && setTo((v) => [...v, c])}
                        disabled={added}
                      >
                        {added ? <CircleCheck size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}
