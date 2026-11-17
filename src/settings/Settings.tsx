import { useState, type CSSProperties } from "react";
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
import { isTauri } from "../lib/platform";
import { friendlyError } from "../lib/api";
import { accountName, disconnect, signInWithGoogle, useMailbox } from "../state/mailbox";
import { ConnectGoogleButton } from "../components/ConnectGoogle";
import { Select } from "../components/Select";
import { SliderGroup } from "../components/SliderGroup";
import { ConfirmDialog, Toggle } from "./parts";
import { usePref } from "./usePref";
import {
  AppearanceSection,
  GeneralSection,
  LabelsSection,
  NotificationsSection,
  PrivacySection,
  ShortcutsSection,
  SignaturesSection,
  type SigAccount,
} from "./sections";

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

const REAL_COLORS = ["#5A8CB7", "#7C9A74", "#C8925A", "#7A8CA8", "#A592B8"];

const FETCH_OPTIONS = ["Na hora", "A cada 15 min", "A cada hora", "Só quando eu pedir"].map((v) => ({ value: v, label: v }));
const SIGNATURE_OPTIONS = ["inchurch", "Pessoal", "Nenhuma"].map((v) => ({ value: v, label: v }));

const logoOf = (email: string) => (email.includes("inchurch") ? ("inchurch" as const) : ("gmail" as const));

/** Linha de uma conta de verdade: apelido e cor salvos por e-mail. */
function RealAccountRow({ email, index, selected, onSelect, onDisconnect }: { email: string; index: number; selected: boolean; onSelect: () => void; onDisconnect: () => void }) {
  const [nickname] = usePref(`account:${email}:nickname`, accountName(email));
  const [color] = usePref(`account:${email}:color`, REAL_COLORS[index % REAL_COLORS.length]);
  return (
    <li className="st-account" data-selected={selected}>
      <button className="st-hit" aria-label={`Ver detalhes de ${nickname}`} aria-current={selected ? "true" : undefined} onClick={onSelect} />
      <span className="st-logo">
        <Logo name={logoOf(email)} size={21} />
        <i style={{ background: color }} />
      </span>
      <div className="st-account-body">
        <div className="st-account-name">
          {nickname}
          <span className="chip">{email.endsWith("@gmail.com") ? "Gmail" : "Google Workspace"}</span>
        </div>
        <div className="st-account-mail">{email}</div>
        <div className="st-status">
          <CircleCheck size={13} aria-hidden />
          Conectada · Gmail API
        </div>
      </div>
      <button className="btn glass sm danger" style={{ position: "relative", zIndex: 2 }} onClick={onDisconnect}>
        <LogOut size={14} aria-hidden />
        Desconectar
      </button>
      <ChevronRight size={17} className="st-chev" aria-hidden />
    </li>
  );
}

/** Detalhes da conta de verdade selecionada (cartão do lado direito). */
function RealDetails({ email, index, onDisconnect }: { email: string; index: number; onDisconnect: () => void }) {
  const [nickname, setNickname] = usePref(`account:${email}:nickname`, accountName(email));
  const [color, setColor] = usePref(`account:${email}:color`, REAL_COLORS[index % REAL_COLORS.length]);
  const [sig, setSig] = usePref(`account:${email}:signature`, "account");
  return (
    <aside className="st-side screen-enter" aria-label={`Detalhes de ${nickname}`}>
      <section className="card st-card">
        <div className="st-detail-head">
          <span className="st-logo">
            <Logo name={logoOf(email)} size={22} />
            <i style={{ background: color }} />
          </span>
          <div>
            <div className="st-detail-name">{nickname}</div>
            <div className="st-detail-mail">{email}</div>
          </div>
        </div>
        <div className="st-field">
          <label className="st-field-label" htmlFor="st-nick">Apelido no Quill</label>
          <input id="st-nick" className="st-input" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </div>
        <div className="st-field">
          <span className="st-field-label" id="st-color">Cor da conta</span>
          <div className="st-swatches" role="radiogroup" aria-labelledby="st-color">
            {SWATCHES.map((c) => (
              <button key={c} className="st-swatch" role="radio" aria-checked={color === c} aria-label={`Cor ${c}`} style={{ "--c": c } as Vars} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="st-field">
          <span className="st-field-label" id="st-sig-label">Assinatura padrão</span>
          <Select
            label="Assinatura padrão"
            value={sig}
            onChange={setSig}
            className="st-select-full"
            options={[
              { value: "account", label: "A assinatura desta conta" },
              { value: "none", label: "Nenhuma" },
            ]}
          />
        </div>
      </section>
      <section className="card st-card">
        <div className="section-label">
          <RefreshCw size={14} aria-hidden />
          Conta
        </div>
        <div className="st-cal">
          <Cloud size={15} aria-hidden />
          <span>Entrou pela página oficial do Google. O Quill nunca vê sua senha.</span>
        </div>
        <div className="st-actions">
          <button className="btn glass sm danger" onClick={onDisconnect}>
            <LogOut size={14} aria-hidden />
            Desconectar
          </button>
        </div>
      </section>
    </aside>
  );
}

export default function Settings({ onRestartOnboarding }: { onRestartOnboarding: () => void }) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("accounts");
  const [selected, setSelected] = useState<AccountId>("inchurch");
  const [prefs, setPrefs] = useState(INITIAL);
  const [confirming, setConfirming] = useState(false);
  const [icloudFixed, setIcloudFixed] = useState(false);
  const connected = useMailbox((s) => s.connected);
  const live = isTauri && connected.length > 0;
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const selEmail = connected.some((c) => c.email === selectedEmail) ? selectedEmail : (connected[0]?.email ?? null);
  const selIndex = Math.max(0, connected.findIndex((c) => c.email === selEmail));

  const sigAccounts: SigAccount[] = isTauri
    ? connected.map((c) => ({ id: c.email, name: accountName(c.email), email: c.email, logo: logoOf(c.email) }))
    : ACCOUNTS.map((a) => ({ id: a.id, name: a.name, email: SENDER_EMAILS[a.id], logo: a.logo }));
  const sectionLabel = SECTIONS.find((x) => x.id === section)!.label;

  /** Adicionar conta: Google abre o login de verdade (no app); os outros serviços ainda não. */
  const addAccount = async (provider: string) => {
    if (!isTauri) return;
    if (provider !== "Google") {
      setAddStatus("Por enquanto só o Google está disponível. Microsoft, iCloud e IMAP vêm em seguida.");
      return;
    }
    setAddStatus("Termine o login na janela do navegador que abriu…");
    try {
      const a = await signInWithGoogle();
      setAddStatus(`${a.email} conectada.`);
    } catch (e) {
      setAddStatus(friendlyError(e));
    }
  };

  const update = (id: AccountId, patch: Partial<AccountPrefs>) => setPrefs((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const account = ACCOUNTS.find((a) => a.id === selected)!;
  const sel = prefs[selected];

  return (
    <>
      <TopBar title="Ajustes" sub={sectionLabel} searchPlaceholder="Buscar nos ajustes" />
      <div className="st">
        <nav className="card st-nav" aria-label="Seções dos ajustes">
          <SliderGroup className="st-nav-group" activeKey={section}>
            {SECTIONS.map((s) => (
              <button key={s.id} className="st-nav-item" aria-current={section === s.id ? "page" : undefined} onClick={() => setSection(s.id)}>
                <s.icon size={17} aria-hidden />
                {s.label}
              </button>
            ))}
          </SliderGroup>
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
            {section === "general" && <GeneralSection key={section} />}
            {section === "appearance" && <AppearanceSection key={section} />}
            {section === "notifications" && <NotificationsSection key={section} />}
            {section === "signatures" && <SignaturesSection key={section} accounts={sigAccounts} />}
            {section === "labels" && <LabelsSection key={section} />}
            {section === "shortcuts" && <ShortcutsSection key={section} />}
            {section === "privacy" && <PrivacySection key={section} />}
          </div>
        ) : (
          <>
            <div className="st-main">
              <section className="card st-list screen-enter" aria-label="Suas contas">
                <div className="st-list-head">
                  <div>
                    <h2 className="st-title">Suas contas</h2>
                    <div className="st-sub">
                      {isTauri ? connected.length : ACCOUNTS.length} {(isTauri ? connected.length : ACCOUNTS.length) === 1 ? "conta" : "contas"} · arraste para mudar a ordem na caixa de entrada
                    </div>
                  </div>
                  <button className="btn solid" onClick={() => void addAccount("Google")}>
                    <Plus size={16} aria-hidden />
                    Adicionar conta
                  </button>
                </div>
                {live ? (
                  <ul className="st-accounts">
                    {connected.map((acc, i) => (
                      <RealAccountRow key={acc.email} email={acc.email} index={i} selected={acc.email === selEmail} onSelect={() => setSelectedEmail(acc.email)} onDisconnect={() => setConfirmEmail(acc.email)} />
                    ))}
                  </ul>
                ) : isTauri ? (
                  <div style={{ padding: "22px" }}>
                    <p className="st-sub" style={{ marginBottom: 14 }}>Nenhuma conta conectada ainda.</p>
                    <ConnectGoogleButton size="md" />
                  </div>
                ) : (
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
                )}
                <div className="st-add">
                  <div className="st-add-title">Adicionar outra conta</div>
                  <div className="st-add-sub" role="status">
                    {addStatus ?? "Você entra pela página oficial do serviço; o Quill nunca vê sua senha principal."}
                  </div>
                  <div className="st-providers">
                    {[
                      { logo: "gmail" as const, name: "Google", sub: "Gmail ou Google Workspace" },
                      { logo: "microsoft" as const, name: "Microsoft", sub: "Outlook, Hotmail ou Microsoft 365" },
                      { logo: "icloud" as const, name: "iCloud", sub: "Com senha de app da Apple" },
                      { logo: null, name: "Outro", sub: "Qualquer e-mail com IMAP" },
                    ].map((p) => (
                      <button key={p.name} className="st-provider" onClick={() => void addAccount(p.name)}>
                        <span className="st-logo">{p.logo ? <Logo name={p.logo} size={17} /> : <Server size={17} aria-hidden />}</span>
                        <span className="st-provider-name">{p.name}</span>
                        <span className="st-provider-sub">{p.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            {isTauri && live && selEmail && <RealDetails key={selEmail} email={selEmail} index={selIndex} onDisconnect={() => setConfirmEmail(selEmail)} />}
            {!isTauri && (
            <aside className="st-side screen-enter" key={selected} aria-label={`Detalhes de ${sel.nickname}`}>
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
                  <span className="st-field-label">Assinatura padrão</span>
                  <Select label="Assinatura padrão" className="st-select-full" value={sel.signature} onChange={(v) => update(selected, { signature: v })} options={SIGNATURE_OPTIONS} />
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
                    <span>Buscar novos e-mails</span>
                    <Select label="Buscar novos e-mails" size="sm" value={sel.fetch} onChange={(v) => update(selected, { fetch: v })} options={FETCH_OPTIONS} />
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
            )}
          </>
        )}
      </div>
      {confirmEmail && (
        <ConfirmDialog
          title={`Desconectar ${confirmEmail}?`}
          text="Os e-mails dessa conta saem do Quill neste Mac. Nada é apagado no servidor, e você pode conectar de novo quando quiser."
          confirmLabel="Desconectar"
          icon={<LogOut size={15} aria-hidden />}
          onCancel={() => setConfirmEmail(null)}
          onConfirm={() => {
            const email = confirmEmail;
            setConfirmEmail(null);
            void disconnect(email).catch((e) => setAddStatus(friendlyError(e)));
          }}
        />
      )}
      {confirming && (
        <ConfirmDialog
          title={`Desconectar ${sel.nickname}?`}
          text="Os e-mails dessa conta saem do Quill neste Mac. Nada é apagado no servidor, e você pode conectar de novo quando quiser."
          confirmLabel="Desconectar"
          icon={<LogOut size={15} aria-hidden />}
          onCancel={() => setConfirming(false)}
          onConfirm={() => setConfirming(false)}
        />
      )}
    </>
  );
}
