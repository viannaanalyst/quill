import * as Popover from "@radix-ui/react-popover";
import { useRef, useState } from "react";
import { LoginWaiting } from "./LoginWaiting";
import { AccountPhoto, AVATAR_PREF, resizePhoto } from "./MyAvatar";
import { SliderGroup } from "./SliderGroup";
import { toast } from "./Toasts";
import { Camera, LogOut, Monitor, Moon, Plus, Settings, Sun, Trash2 } from "./icons";
import { applyTheme, isTauri, type ThemePref } from "../lib/platform";
import { usePref } from "../lib/usePref";
import { friendlyError } from "../lib/api";
import { signInWithGoogle, signOutAll, useMailbox } from "../state/mailbox";
import { navigate } from "../state/store";

const THEMES: { id: ThemePref; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "Sistema", icon: Monitor },
  { id: "light", label: "Claro", icon: Sun },
  { id: "dark", label: "Escuro", icon: Moon },
];

/** Avatar do cabeçalho: abre o menu com a foto, as contas, a aparência e o botão de sair. */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const byPointer = useRef(false);
  const [theme, setTheme] = usePref<ThemePref>("theme", "system");
  const [photo, setPhoto] = usePref<string | null>(AVATAR_PREF, null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const connected = useMailbox((s) => s.connected);
  const profiles = useMailbox((s) => s.profiles);
  const fileRef = useRef<HTMLInputElement>(null);
  const first = connected[0]?.email;
  const name = first ? profiles[first]?.name : null;

  const chooseTheme = (t: ThemePref) => {
    setTheme(t);
    applyTheme(t);
  };

  const addGoogle = async () => {
    setStatus(null);
    setSigning(true);
    try {
      const a = await signInWithGoogle();
      toast(`${a.email} conectada`);
    } catch (e) {
      setStatus(friendlyError(e));
    } finally {
      setSigning(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPhoto(await resizePhoto(file));
      toast("Foto atualizada");
    } catch (e) {
      setStatus(friendlyError(e));
    }
  };

  /** Sai das contas e fica no app (a tela pede para conectar uma conta). O onboarding só volta por Ajustes. */
  const exit = async () => {
    await signOutAll();
    setOpen(false);
    setConfirmExit(false);
    navigate({ name: "inbox", folder: "inbox" });
    toast("Você saiu das contas neste computador");
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setConfirmExit(false);
          setStatus(null);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button className="me acm-me" onPointerDown={() => (byPointer.current = true)} aria-label="Sua conta" data-tip="Sua conta">
          <AccountPhoto email={first} main size={34} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="qp-content acm-pop" onOpenAutoFocus={(e) => {
            // aberto com o mouse: não acende o foco no primeiro botão; com o teclado, foca normalmente
            if (byPointer.current) e.preventDefault();
            byPointer.current = false;
          }} align="end" sideOffset={10} collisionPadding={12} aria-label="Sua conta">
          <div className="acm-head">
            <button className="acm-photo" onClick={() => fileRef.current?.click()} aria-label="Escolher foto" data-tip="Escolher foto">
              <AccountPhoto email={first} main size={52} />
              <span className="acm-photo-cam" aria-hidden>
                <Camera size={13} />
              </span>
            </button>
            <div className="acm-who">
              <strong>{name || (first ? first.split("@")[0] : "Quill")}</strong>
              <span>{first ?? (isTauri ? "Nenhuma conta conectada" : "Prévia de design")}</span>
              <div className="acm-photo-actions">
                <button onClick={() => fileRef.current?.click()}>Escolher foto</button>
                {photo && (
                  <button
                    onClick={() => {
                      setPhoto(null);
                      toast("Foto removida");
                    }}
                  >
                    <Trash2 size={12} aria-hidden />
                    Remover
                  </button>
                )}
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic"
              hidden
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <div className="acm-section">
            <div className="section-label">Contas</div>
            {connected.length > 0 && (
              <ul className="acm-accounts">
                {connected.map((a) => (
                  <li key={a.email}>
                    <AccountPhoto email={a.email} size={26} />
                    <span className="acm-mail">{a.email}</span>
                  </li>
                ))}
              </ul>
            )}
            {connected.length === 0 && !isTauri && <p className="acm-empty">Prévia de design (sem contas).</p>}
            {isTauri && (
              <button className="acm-item" onClick={() => void addGoogle()} disabled={signing}>
                <Plus size={15} aria-hidden />
                Conectar conta Google
              </button>
            )}
            {signing && <LoginWaiting className="acm-status" />}
            {status && !signing && (
              <p className="acm-status" role="status">
                {status}
              </p>
            )}
          </div>

          <div className="acm-section">
            <div className="section-label">Aparência</div>
            <SliderGroup activeKey={theme} className="segmented acm-theme" role="radiogroup" label="Aparência">
              {THEMES.map((t) => (
                <button key={t.id} role="radio" aria-checked={theme === t.id} onClick={() => chooseTheme(t.id)}>
                  <t.icon size={14} aria-hidden />
                  {t.label}
                </button>
              ))}
            </SliderGroup>
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
              <span className="kbd acm-kbd" aria-hidden>
                ⌘ ,
              </span>
            </button>
            {confirmExit ? (
              <div className="acm-confirm" role="alert">
                <span>Sair desconecta as contas deste computador. Nada é apagado no Google.</span>
                <div>
                  <button className="btn glass sm" onClick={() => setConfirmExit(false)}>
                    Cancelar
                  </button>
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
