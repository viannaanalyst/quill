import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { LogOut, Plus, Settings } from "./icons";
import { applyTheme, isTauri, type ThemePref } from "../lib/platform";
import { getPref, setPref } from "../lib/storage";
import { friendlyError } from "../lib/api";
import { signInWithGoogle, signOutAll, useMailbox } from "../state/mailbox";
import { navigate } from "../state/store";

const THEMES: { id: ThemePref; label: string }[] = [
  { id: "system", label: "Sistema" },
  { id: "light", label: "Claro" },
  { id: "dark", label: "Escuro" },
];

function initialsOf(email: string | undefined) {
  if (!email) return isTauri ? "?" : "GV";
  const local = email.split("@")[0].replace(/[^a-zA-Z]/g, "");
  return (local.slice(0, 2) || "?").toUpperCase();
}

/** Avatar do cabeçalho: abre o menu com as contas, a aparência e o botão de sair. */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(() => getPref<ThemePref>("theme", "system"));
  const [confirmExit, setConfirmExit] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const connected = useMailbox((s) => s.connected);
  const wrapRef = useRef<HTMLDivElement>(null);
  const first = connected[0]?.email;

  // fecha ao clicar fora ou com Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrapRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chooseTheme = (t: ThemePref) => {
    setTheme(t);
    setPref("theme", t);
    applyTheme(t);
  };

  const addGoogle = async () => {
    setStatus("Termine o login na janela do navegador que abriu…");
    try {
      const a = await signInWithGoogle();
      setStatus(`${a.email} conectada.`);
    } catch (e) {
      setStatus(friendlyError(e));
    }
  };

  const exit = async () => {
    await signOutAll();
    setPref("onboarded", false);
    window.location.reload();
  };

  return (
    <div className="acm" ref={wrapRef}>
      <button
        className="me"
        aria-label="Sua conta"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setConfirmExit(false);
          setStatus(null);
        }}
      >
        {initialsOf(first)}
      </button>
      {open && (
        <div className="acm-pop" role="dialog" aria-label="Sua conta">
          <div className="acm-section">
            <div className="section-label">Contas</div>
            {connected.length === 0 ? (
              <p className="acm-empty">{isTauri ? "Nenhuma conta conectada." : "Prévia de design (sem contas)."}</p>
            ) : (
              <ul className="acm-accounts">
                {connected.map((a) => (
                  <li key={a.email}>
                    <span className="acm-logo">
                      <Logo name={a.email.includes("inchurch") ? "inchurch" : "gmail"} size={15} />
                    </span>
                    <span className="acm-mail">{a.email}</span>
                  </li>
                ))}
              </ul>
            )}
            {isTauri && (
              <button className="acm-item" onClick={() => void addGoogle()}>
                <Plus size={15} aria-hidden />
                Conectar conta Google
              </button>
            )}
            {status && (
              <p className="acm-status" role="status">
                {status}
              </p>
            )}
          </div>

          <div className="acm-section">
            <div className="section-label">Aparência</div>
            <div className="segmented acm-theme" role="radiogroup" aria-label="Aparência">
              {THEMES.map((t) => (
                <button key={t.id} role="radio" aria-checked={theme === t.id} aria-pressed={theme === t.id} onClick={() => chooseTheme(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="acm-section">
            <button
              className="acm-item"
              onClick={() => {
                setOpen(false);
                navigate({ name: "settings" });
              }}
            >
              <Settings size={15} aria-hidden />
              Ajustes
            </button>
            {confirmExit ? (
              <div className="acm-confirm" role="alert">
                <span>Sair desconecta as contas deste Mac. Nada é apagado no Google.</span>
                <div>
                  <button className="btn glass sm" onClick={() => setConfirmExit(false)}>Cancelar</button>
                  <button className="btn solid sm danger-solid" onClick={() => void exit()}>
                    <LogOut size={14} aria-hidden />
                    Sair
                  </button>
                </div>
              </div>
            ) : (
              <button className="acm-item danger" onClick={() => setConfirmExit(true)}>
                <LogOut size={15} aria-hidden />
                Sair
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
