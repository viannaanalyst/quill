import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import "./imapConnect.css";
import { Logo } from "./Logo";
import { SliderGroup } from "./SliderGroup";
import { toast } from "./Toasts";
import { ChevronDown, CircleCheck, ExternalLink, Eye, EyeOff, LoaderCircle, Lock, TriangleAlert, X } from "./icons";
import { api, friendlyError, type AccountInfo, type ImapConfig } from "../lib/api";
import { connectImap } from "../state/mailbox";

export type ImapProvider = "icloud" | "imap";

const APPLE_ID_URL = "https://appleid.apple.com";
const ICLOUD_SERVERS = { imapHost: "imap.mail.me.com", imapPort: 993, smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecurity: "starttls" } as const;

type Security = "tls" | "starttls";
interface Servers {
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
  security: Security;
  username: string;
}

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const securityFor = (port: string): Security => (port.trim() === "465" ? "tls" : "starttls");

/** Palpite local (prévia do navegador ou sem resposta): imap.<domínio> e smtp.<domínio>. */
function localGuess(email: string): Servers {
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  return { imapHost: domain ? `imap.${domain}` : "", imapPort: "993", smtpHost: domain ? `smtp.${domain}` : "", smtpPort: "587", security: "starttls", username: "" };
}

/**
 * Conectar uma conta iCloud (senha de app da Apple) ou de outro provedor (IMAP/SMTP).
 * O app testa a entrada nos dois servidores antes de salvar; a senha vai para as Chaves do sistema.
 */
export default function ImapConnect({
  provider,
  onClose,
  onConnected,
}: {
  provider: ImapProvider;
  onClose: () => void;
  onConnected?: (account: AccountInfo) => void;
}) {
  const icloud = provider === "icloud";
  const ids = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [servers, setServers] = useState<Servers>(() => localGuess(""));
  // a pessoa mexeu nos servidores: o palpite não sobrescreve mais
  const [edited, setEdited] = useState(false);
  const [recognized, setRecognized] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guessSeq = useRef(0);

  // palpite dos servidores enquanto a pessoa digita o e-mail (só em "Outro e-mail")
  useEffect(() => {
    if (icloud || !looksLikeEmail(email)) {
      setRecognized(null);
      setHint(null);
      return;
    }
    const seq = ++guessSeq.current;
    const t = window.setTimeout(async () => {
      try {
        const g = await api.imapGuess(email.trim(), "imap");
        if (seq !== guessSeq.current) return;
        setHint(g.hint ?? null);
        setRecognized(g.source !== "generic" ? (g.label ?? null) : null);
        if (!edited && g.config) {
          const c = g.config;
          setServers({
            imapHost: c.imapHost,
            imapPort: String(c.imapPort),
            smtpHost: c.smtpHost,
            smtpPort: String(c.smtpPort),
            security: c.smtpSecurity ?? securityFor(String(c.smtpPort)),
            username: "",
          });
        }
        // provedor desconhecido: abre os servidores para a pessoa conferir
        if (g.source === "generic") setAdvanced(true);
      } catch {
        if (seq !== guessSeq.current) return;
        if (!edited) setServers(localGuess(email));
      }
    }, 450);
    return () => window.clearTimeout(t);
  }, [email, icloud, edited]);

  const editServer = (patch: Partial<Servers>) => {
    setEdited(true);
    setServers((s) => {
      const next = { ...s, ...patch };
      // trocar a porta do SMTP já escolhe a segurança mais comum para ela
      if (patch.smtpPort !== undefined) next.security = securityFor(patch.smtpPort);
      return next;
    });
  };

  const openAppleId = () => {
    api.openLink(APPLE_ID_URL).catch(() => window.open(APPLE_ID_URL, "_blank", "noopener"));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!looksLikeEmail(email)) return setError("Digite o e-mail completo, por exemplo voce@icloud.com.");
    if (!password.trim()) return setError(icloud ? "Cole a senha de app criada no site da Apple." : "Digite a senha.");
    const port = (v: string) => {
      const n = Number(v.trim());
      return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
    };
    let config: ImapConfig;
    if (icloud) {
      config = { email: email.trim(), name: name.trim() || null, provider: "icloud", username: "", ...ICLOUD_SERVERS };
    } else {
      const imapPort = port(servers.imapPort);
      const smtpPort = port(servers.smtpPort);
      if (!servers.imapHost.trim() || !servers.smtpHost.trim() || !imapPort || !smtpPort) {
        setAdvanced(true);
        return setError("Confira os servidores e as portas em Configurações avançadas.");
      }
      config = {
        email: email.trim(),
        name: name.trim() || null,
        provider: "imap",
        imapHost: servers.imapHost.trim(),
        imapPort,
        smtpHost: servers.smtpHost.trim(),
        smtpPort,
        smtpSecurity: servers.security,
        username: servers.username.trim(),
      };
    }
    setBusy(true);
    try {
      const account = await connectImap(config, password);
      toast(`${account.email} conectada`);
      onConnected?.(account);
      onClose();
    } catch (err) {
      const msg = friendlyError(err);
      setError(msg === "preview" ? "Na prévia do navegador não dá para conectar. Abra o app para testar." : msg);
    } finally {
      setBusy(false);
    }
  };

  const field = (suffix: string) => `${ids}-${suffix}`;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="cmd-overlay" />
        <Dialog.Content
          className="imc-box"
          aria-describedby={field("desc")}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            emailRef.current?.focus();
          }}
        >
          <form onSubmit={submit} noValidate>
            <div className="imc-head">
              <span className="imc-logo" aria-hidden>
                <Logo name={icloud ? "icloud" : "mail"} size={22} />
              </span>
              <div className="imc-titles">
                <Dialog.Title className="imc-title">{icloud ? "Conectar iCloud" : "Conectar outro e-mail"}</Dialog.Title>
                <p className="imc-sub" id={field("desc")}>
                  {icloud ? "Com uma senha de app da Apple." : "Qualquer provedor com IMAP e SMTP."}
                </p>
              </div>
              <Dialog.Close className="imc-x" aria-label="Fechar" data-tip="Fechar" type="button" disabled={busy}>
                <X size={16} aria-hidden />
              </Dialog.Close>
            </div>

            {icloud && (
              <ol className="imc-steps">
                <li>
                  <span className="imc-step-n" aria-hidden>1</span>
                  <span>
                    Abra{" "}
                    <button type="button" className="imc-link" onClick={openAppleId}>
                      appleid.apple.com
                      <ExternalLink size={12} aria-hidden />
                    </button>{" "}
                    e entre com sua conta Apple.
                  </span>
                </li>
                <li>
                  <span className="imc-step-n" aria-hidden>2</span>
                  <span>
                    Em <strong>Entrar e segurança</strong>, abra <strong>Senhas de app</strong> e crie uma (pode chamar de “Quill”).
                  </span>
                </li>
                <li>
                  <span className="imc-step-n" aria-hidden>3</span>
                  <span>Copie a senha que aparecer e cole aqui embaixo.</span>
                </li>
              </ol>
            )}

            <div className="imc-fields">
              <div className="imc-field">
                <label className="imc-label" htmlFor={field("email")}>
                  {icloud ? "E-mail do iCloud" : "E-mail"}
                </label>
                <input
                  ref={emailRef}
                  id={field("email")}
                  className="imc-input"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={icloud ? "voce@icloud.com" : "voce@empresa.com.br"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
                {!icloud && (recognized || hint) && (
                  <p className={`imc-note${hint ? " warn" : ""}`} role="status">
                    {hint ? (
                      hint
                    ) : (
                      <>
                        <CircleCheck size={13} aria-hidden />
                        Servidores da {recognized} preenchidos.
                      </>
                    )}
                  </p>
                )}
              </div>

              <div className="imc-field">
                <label className="imc-label" htmlFor={field("password")}>
                  {icloud ? "Senha de app" : "Senha"}
                </label>
                <div className="imc-password">
                  <input
                    id={field("password")}
                    className="imc-input"
                    type={showPassword ? "text" : "password"}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={icloud ? "xxxx-xxxx-xxxx-xxxx" : "Senha do e-mail ou senha de app"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="imc-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                    data-tip={showPassword ? "Esconder senha" : "Mostrar senha"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
                  </button>
                </div>
              </div>

              <div className="imc-field">
                <label className="imc-label" htmlFor={field("name")}>
                  Seu nome <span className="imc-optional">(aparece para quem recebe)</span>
                </label>
                <input
                  id={field("name")}
                  className="imc-input"
                  type="text"
                  autoComplete="off"
                  placeholder="Como você assina os e-mails"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            {!icloud && (
              <div className="imc-adv">
                <button
                  type="button"
                  className="imc-adv-toggle"
                  aria-expanded={advanced}
                  aria-controls={field("adv")}
                  onClick={() => setAdvanced((v) => !v)}
                >
                  <ChevronDown size={15} aria-hidden className="imc-chev" />
                  Configurações avançadas
                </button>
                {advanced && (
                  <div className="imc-adv-panel" id={field("adv")}>
                    <div className="imc-row">
                      <div className="imc-field grow">
                        <label className="imc-label" htmlFor={field("imap")}>Servidor de entrada (IMAP)</label>
                        <input id={field("imap")} className="imc-input" spellCheck={false} autoCapitalize="off" placeholder="imap.seudominio.com" value={servers.imapHost} onChange={(e) => editServer({ imapHost: e.target.value })} disabled={busy} />
                      </div>
                      <div className="imc-field port">
                        <label className="imc-label" htmlFor={field("imap-port")}>Porta</label>
                        <input id={field("imap-port")} className="imc-input" inputMode="numeric" value={servers.imapPort} onChange={(e) => editServer({ imapPort: e.target.value.replace(/\D/g, "") })} disabled={busy} />
                      </div>
                    </div>
                    <div className="imc-row">
                      <div className="imc-field grow">
                        <label className="imc-label" htmlFor={field("smtp")}>Servidor de saída (SMTP)</label>
                        <input id={field("smtp")} className="imc-input" spellCheck={false} autoCapitalize="off" placeholder="smtp.seudominio.com" value={servers.smtpHost} onChange={(e) => editServer({ smtpHost: e.target.value })} disabled={busy} />
                      </div>
                      <div className="imc-field port">
                        <label className="imc-label" htmlFor={field("smtp-port")}>Porta</label>
                        <input id={field("smtp-port")} className="imc-input" inputMode="numeric" value={servers.smtpPort} onChange={(e) => editServer({ smtpPort: e.target.value.replace(/\D/g, "") })} disabled={busy} />
                      </div>
                    </div>
                    <div className="imc-row">
                      <div className="imc-field">
                        <span className="imc-label" id={field("sec")}>Segurança do envio</span>
                        <SliderGroup activeKey={servers.security} className="segmented imc-seg" role="radiogroup" label="Segurança do envio">
                          {(["tls", "starttls"] as const).map((s) => (
                            <button
                              key={s}
                              type="button"
                              role="radio"
                              aria-checked={servers.security === s}
                              onClick={() => {
                                setEdited(true);
                                setServers((v) => ({ ...v, security: s }));
                              }}
                              disabled={busy}
                            >
                              {s === "tls" ? "SSL/TLS" : "STARTTLS"}
                            </button>
                          ))}
                        </SliderGroup>
                      </div>
                      <div className="imc-field grow">
                        <label className="imc-label" htmlFor={field("user")}>Usuário</label>
                        <input id={field("user")} className="imc-input" spellCheck={false} autoCapitalize="off" placeholder="O próprio e-mail" value={servers.username} onChange={(e) => editServer({ username: e.target.value })} disabled={busy} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="imc-error" role="alert">
                <TriangleAlert size={15} aria-hidden />
                <span>{error}</span>
              </p>
            )}

            <div className="imc-foot">
              <p className="imc-safe">
                <Lock size={13} aria-hidden />
                A senha fica nas Chaves do sistema, nunca em arquivo.
              </p>
              <div className="imc-actions">
                <button type="button" className="btn glass" onClick={onClose} disabled={busy}>
                  Cancelar
                </button>
                <button type="submit" className="btn solid" disabled={busy || !email.trim() || !password.trim()} aria-busy={busy}>
                  {busy && (
                    <span className="imc-spin" aria-hidden>
                      <LoaderCircle size={15} />
                    </span>
                  )}
                  {busy ? "Conectando…" : "Conectar"}
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
