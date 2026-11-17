import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./settings.css";
import { TopBar } from "../components/TopBar";
import { Logo } from "../components/Logo";
import {
  AtSign,
  Bell,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Cloud,
  Eye,
  Keyboard,
  LogOut,
  OctagonAlert,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Tag,
} from "../components/icons";
import { ACCOUNTS } from "../inbox/sampleData";
import type { AccountId } from "../inbox/types";
import { SENDER_EMAILS } from "../compose/contacts";

type Vars = CSSProperties & Record<`--${string}`, string>;

const SECTIONS = [
  { id: "accounts", label: "Contas", icon: AtSign },
  { id: "general", label: "Geral", icon: SettingsIcon },
  { id: "appearance", label: "Aparência", icon: Eye },
  { id: "notifications", label: "Notificações", icon: Bell },
  { id: "signatures", label: "Assinaturas", icon: Pencil },
  { id: "labels", label: "Marcadores e pastas", icon: Tag },
  { id: "shortcuts", label: "Atalhos de teclado", icon: Keyboard },
  { id: "privacy", label: "Privacidade", icon: ShieldCheck },
] as const;

const PROVIDER_LABEL: Record<AccountId, string> = {
  pessoal: "Gmail",
  moradah: "Gmail",
  inchurch: "Google Workspace",
  outlook: "Microsoft",
  icloud: "iCloud",
};

const STATUS: Record<AccountId, string> = {
  pessoal: "Sincronizada há 1 min · Gmail API",
  moradah: "Sincronizada há 1 min · Gmail API",
  inchurch: "Sincronizada agora · Gmail API",
  outlook: "Sincronizada há 3 min · Microsoft Graph",
  icloud: "",
};

const SWATCHES = ["#5A8CB7", "#7C9A74", "#C8925A", "#7A8CA8", "#A592B8", "#C77B8B", "#8E8E93"];

interface AccountPrefs {
  mail: boolean;
  calendar: boolean;
  nickname: string;
  color: string;
  unified: boolean;
  notify: boolean;
  autoDownload: boolean;
  fetch: string;
  signature: string;
}

const INITIAL: Record<AccountId, AccountPrefs> = {
  pessoal: { mail: true, calendar: true, nickname: "Pessoal", color: "#5A8CB7", unified: true, notify: true, autoDownload: false, fetch: "Na hora", signature: "Pessoal" },
  moradah: { mail: true, calendar: true, nickname: "Moradah", color: "#7C9A74", unified: true, notify: true, autoDownload: false, fetch: "Na hora", signature: "Pessoal" },
  inchurch: { mail: true, calendar: true, nickname: "inchurch", color: "#C8925A", unified: true, notify: true, autoDownload: false, fetch: "Na hora", signature: "inchurch" },
  outlook: { mail: true, calendar: false, nickname: "Outlook", color: "#7A8CA8", unified: true, notify: false, autoDownload: false, fetch: "A cada 15 min", signature: "Pessoal" },
  icloud: { mail: true, calendar: true, nickname: "Família", color: "#A592B8", unified: true, notify: true, autoDownload: false, fetch: "Na hora", signature: "Pessoal" },
};

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="toggle" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export default function Settings({ onRestartOnboarding }: { onRestartOnboarding: () => void }) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("accounts");
  const [selected, setSelected] = useState<AccountId>("inchurch");
  const [prefs, setPrefs] = useState(INITIAL);
  const [confirming, setConfirming] = useState(false);
  const [icloudFixed, setIcloudFixed] = useState(false);

  const update = (id: AccountId, patch: Partial<AccountPrefs>) => setPrefs((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const account = ACCOUNTS.find((a) => a.id === selected)!;
  const sel = prefs[selected];

  return (
    <>
      <TopBar title="Ajustes" sub="Contas" searchPlaceholder="Buscar nos ajustes" />
      <div className="st">
        <nav className="card st-nav" aria-label="Seções dos ajustes">
          {SECTIONS.map((s) => (
            <button key={s.id} className="st-nav-item" aria-current={section === s.id ? "page" : undefined} onClick={() => setSection(s.id)}>
              <s.icon size={17} aria-hidden />
              {s.label}
            </button>
          ))}
          <div className="st-nav-foot">
            Quill 0.1 · uso pessoal
            <br />
            Nada sai do seu Mac além das contas que você conectar.
            <br />
            <button onClick={onRestartOnboarding}>
              <RotateCcw size={13} aria-hidden />
              Rever o onboarding
            </button>
          </div>
        </nav>

        {section !== "accounts" ? (
          <div className="st-main">
            <section className="card st-soon">
              <h2>{SECTIONS.find((s) => s.id === section)!.label}</h2>
              <p>Essa parte dos ajustes vem nas próximas etapas.</p>
            </section>
          </div>
        ) : (
          <>
            <div className="st-main">
              <section className="card st-list" aria-label="Suas contas">
                <div className="st-list-head">
                  <div>
                    <h2 className="st-title">Suas contas</h2>
                    <div className="st-sub">{ACCOUNTS.length} contas · arraste para mudar a ordem na caixa de entrada</div>
                  </div>
                  <button className="btn solid">
                    <Plus size={16} aria-hidden />
                    Adicionar conta
                  </button>
                </div>
                <ul className="st-accounts">
                  {ACCOUNTS.map((a) => {
                    const p = prefs[a.id];
                    const broken = a.id === "icloud" && !icloudFixed;
                    return (
                      <li key={a.id} className="st-account" data-selected={a.id === selected}>
                        <button className="st-hit" aria-label={`Ver detalhes de ${p.nickname}`} aria-current={a.id === selected ? "true" : undefined} onClick={() => setSelected(a.id)} />
                        <span className="st-logo">
                          <Logo name={a.logo} size={21} />
                          <i style={{ background: p.color }} />
                        </span>
                        <div className="st-account-body">
                          <div className="st-account-name">
                            {p.nickname}
                            <span className="chip">{PROVIDER_LABEL[a.id]}</span>
                          </div>
                          <div className="st-account-mail">{SENDER_EMAILS[a.id]}</div>
                          {broken ? (
                            <div className="st-warn" role="alert">
                              <OctagonAlert size={14} aria-hidden />
                              A Apple recusou a senha de app. Gere uma nova para continuar.
                              <button className="btn solid sm" onClick={() => setIcloudFixed(true)}>Corrigir</button>
                            </div>
                          ) : (
                            <div className="st-status">
                              <CircleCheck size={13} aria-hidden />
                              {STATUS[a.id] || "Sincronizada agora · IMAP"}
                            </div>
                          )}
                        </div>
                        <div className="st-switches">
                          <span className="st-switch">
                            <Toggle on={p.mail} onChange={(v) => update(a.id, { mail: v })} label={`E-mail de ${p.nickname}`} />
                            E-mail
                          </span>
                          <span className="st-switch">
                            <Toggle on={p.calendar} onChange={(v) => update(a.id, { calendar: v })} label={`Agenda de ${p.nickname}`} />
                            Agenda
                          </span>
                        </div>
                        <ChevronRight size={17} className="st-chev" aria-hidden />
                      </li>
                    );
                  })}
                </ul>
                <div className="st-add">
                  <div className="st-add-title">Adicionar outra conta</div>
                  <div className="st-add-sub">Você entra pela página oficial do serviço; o Quill nunca vê sua senha principal.</div>
                  <div className="st-providers">
                    {[
                      { logo: "gmail" as const, name: "Google", sub: "Gmail ou Google Workspace" },
                      { logo: "microsoft" as const, name: "Microsoft", sub: "Outlook, Hotmail ou Microsoft 365" },
                      { logo: "icloud" as const, name: "iCloud", sub: "Com senha de app da Apple" },
                      { logo: null, name: "Outro", sub: "Qualquer e-mail com IMAP" },
                    ].map((p) => (
                      <button key={p.name} className="st-provider">
                        <span className="st-logo">{p.logo ? <Logo name={p.logo} size={17} /> : <Server size={17} aria-hidden />}</span>
                        <span className="st-provider-name">{p.name}</span>
                        <span className="st-provider-sub">{p.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            <aside className="st-side" aria-label={`Detalhes de ${sel.nickname}`}>
              <section className="card st-card">
                <div className="st-detail-head">
                  <span className="st-logo">
                    <Logo name={account.logo} size={22} />
                    <i style={{ background: sel.color }} />
                  </span>
                  <div>
                    <div className="st-detail-name">{sel.nickname}</div>
                    <div className="st-detail-mail">{SENDER_EMAILS[selected]}</div>
                  </div>
                </div>
                <div className="st-fields2">
                  <div className="st-field">
                    <label className="st-field-label" htmlFor="st-name">Seu nome nos e-mails</label>
                    <input id="st-name" className="st-input" defaultValue="Gabriel Vianna" key={`n-${selected}`} />
                  </div>
                  <div className="st-field">
                    <label className="st-field-label" htmlFor="st-nick">Apelido no Quill</label>
                    <input id="st-nick" className="st-input" value={sel.nickname} onChange={(e) => update(selected, { nickname: e.target.value })} />
                  </div>
                </div>
                <div className="st-field">
                  <span className="st-field-label" id="st-color">Cor da conta</span>
                  <div className="st-swatches" role="radiogroup" aria-labelledby="st-color">
                    {SWATCHES.map((c) => (
                      <button
                        key={c}
                        className="st-swatch"
                        role="radio"
                        aria-checked={sel.color === c}
                        aria-label={`Cor ${c}`}
                        style={{ "--c": c } as Vars}
                        onClick={() => update(selected, { color: c })}
                      />
                    ))}
                  </div>
                </div>
                <div className="st-field">
                  <label className="st-field-label" htmlFor="st-sig">Assinatura padrão</label>
                  <select id="st-sig" className="st-input" value={sel.signature} onChange={(e) => update(selected, { signature: e.target.value })}>
                    <option>inchurch</option>
                    <option>Pessoal</option>
                    <option>Nenhuma</option>
                  </select>
                </div>
              </section>

              <section className="card st-card">
                <div className="section-label">
                  <RefreshCw size={14} aria-hidden />
                  Sincronização
                </div>
                <div style={{ marginTop: 6 }}>
                  <div className="st-row">
                    <span>Mostrar na caixa unificada</span>
                    <Toggle on={sel.unified} onChange={(v) => update(selected, { unified: v })} label="Mostrar na caixa unificada" />
                  </div>
                  <div className="st-row">
                    <span>
                      Avisar quando chegar e-mail
                      <span className="st-row-sub" style={{ display: "block" }}>Só de pessoas, sem propaganda</span>
                    </span>
                    <Toggle on={sel.notify} onChange={(v) => update(selected, { notify: v })} label="Avisar quando chegar e-mail" />
                  </div>
                  <div className="st-row">
                    <span>Baixar anexos sozinho</span>
                    <Toggle on={sel.autoDownload} onChange={(v) => update(selected, { autoDownload: v })} label="Baixar anexos sozinho" />
                  </div>
                  <div className="st-row">
                    <label htmlFor="st-fetch">Buscar novos e-mails</label>
                    <select id="st-fetch" className="st-input" value={sel.fetch} onChange={(e) => update(selected, { fetch: e.target.value })}>
                      <option>Na hora</option>
                      <option>A cada 15 min</option>
                      <option>A cada hora</option>
                      <option>Só quando eu pedir</option>
                    </select>
                  </div>
                </div>
                <div className="st-storage">
                  <span>Espaço usado</span>
                  <span>4,2 GB de 30 GB</span>
                </div>
                <div className="st-bar" role="progressbar" aria-valuenow={14} aria-valuemin={0} aria-valuemax={100} aria-label="Espaço usado">
                  <i style={{ transform: "scaleX(0.14)" }} />
                </div>
              </section>

              <section className="card st-card">
                <div className="section-label">
                  <CalendarDays size={14} aria-hidden />
                  Agenda
                </div>
                <div className="st-cal">
                  <Cloud size={15} aria-hidden />
                  <span>Vem das contas do Mac · 3 agendas</span>
                  <button className="btn glass sm">Abrir no Mac</button>
                </div>
                <div className="st-actions">
                  <button className="btn glass sm">
                    <RefreshCw size={14} aria-hidden />
                    Sincronizar agora
                  </button>
                  <button className="btn glass sm danger" onClick={() => setConfirming(true)}>
                    <LogOut size={14} aria-hidden />
                    Desconectar
                  </button>
                </div>
              </section>
            </aside>
          </>
        )}
      </div>
      {confirming && <ConfirmDisconnect name={sel.nickname} onCancel={() => setConfirming(false)} onConfirm={() => setConfirming(false)} />}
    </>
  );
}

/** Confirmação antes de uma ação difícil de desfazer (Esc ou Cancelar fecham). */
function ConfirmDisconnect({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="st-overlay" onClick={onCancel}>
      <div className="st-dialog" role="alertdialog" aria-modal="true" aria-labelledby="st-dlg-title" aria-describedby="st-dlg-desc" onClick={(e) => e.stopPropagation()}>
        <h2 id="st-dlg-title">Desconectar {name}?</h2>
        <p id="st-dlg-desc">
          Os e-mails dessa conta saem do Quill neste Mac. Nada é apagado no servidor, e você pode conectar de novo quando quiser.
        </p>
        <div className="st-dialog-actions">
          <button ref={cancelRef} className="btn glass" onClick={onCancel}>Cancelar</button>
          <button className="btn solid danger-solid" onClick={onConfirm}>
            <LogOut size={15} aria-hidden />
            Desconectar
          </button>
        </div>
      </div>
    </div>
  );
}
