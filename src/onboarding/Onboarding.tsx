import { useEffect, useRef, useState, type ReactNode } from "react";
import "./onboarding.css";
import { Scene } from "./Scenes";
import { Logo, type LogoName } from "../components/Logo";
import { WindowLights } from "../components/WindowLights";
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CircleCheck,
  Eye,
  Fingerprint,
  Inbox,
  KeyRound,
  Layers,
  LoaderCircle,
  Lock,
  Mail,
  Plus,
  Reply,
  Search,
  Server,
  ShieldCheck,
  User,
} from "../components/icons";
import { devParams, isTauri } from "../lib/platform";
import { friendlyError } from "../lib/api";
import { signInWithGoogle, useMailbox } from "../state/mailbox";
import { getPref, setPref } from "../lib/storage";

const STAGE_W = 717;
const STAGE_H = 858;
const LAST_STEP = 6;

/** Escala o palco da ilustração para caber no espaço disponível. */
function useFitScale<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      el.style.setProperty("--fit", String(Math.min(width / STAGE_W, height / STAGE_H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

/** Pausa as animações quando a janela fica escondida, para poupar bateria. */
function usePageHidden() {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return hidden;
}

function initialStep() {
  const n = Number(devParams.get("step"));
  return n >= 1 && n <= LAST_STEP ? n : 1;
}

function Feature({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="feat">
      <span className="feat-ic">{icon}</span>
      {children}
    </li>
  );
}

const PROVIDERS: { id: string; logo: LogoName | null; name: string; sub: string }[] = [
  { id: "google", logo: "gmail", name: "Continuar com Google", sub: "Gmail ou Google Workspace" },
  { id: "microsoft", logo: "microsoft", name: "Continuar com Microsoft", sub: "Outlook, Hotmail ou Microsoft 365" },
  { id: "icloud", logo: "icloud", name: "Continuar com iCloud", sub: "Com uma senha de app da Apple" },
  { id: "imap", logo: null, name: "Outro e-mail", sub: "Qualquer provedor com IMAP" },
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(initialStep);
  const [touchId, setTouchId] = useState(() => getPref("touchId", true));
  // Demonstração: a conta da inchurch "termina de conectar" alguns segundos depois de chegar ao passo 6.
  const [waiting, setWaiting] = useState(true);
  // login real (app no Mac): qual serviço está esperando o navegador e o erro, se houver
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const connected = useMailbox((s) => s.connected);
  const artRef = useFitScale<HTMLDivElement>();
  const hidden = usePageHidden();

  const next = () => setStep((s) => Math.min(s + 1, LAST_STEP));
  const back = () => setStep((s) => Math.max(s - 1, 1));
  const goTo = (s: number) => setStep(s);

  /** Escolha do serviço no passo "Entrar". Na prévia do navegador só avança; no app abre o login de verdade. */
  const choose = async (provider: string) => {
    if (!isTauri) return goTo(6);
    setLoginError(null);
    if (provider !== "google") {
      setLoginError("Por enquanto só o Google está disponível. Microsoft, iCloud e IMAP vêm em seguida.");
      return;
    }
    setSigningIn("google");
    try {
      await signInWithGoogle();
      goTo(6);
    } catch (e) {
      setLoginError(friendlyError(e));
    } finally {
      setSigningIn(null);
    }
  };

  useEffect(() => {
    if (step !== LAST_STEP || isTauri) return;
    setWaiting(true);
    const t = window.setTimeout(() => setWaiting(false), 3500);
    return () => window.clearTimeout(t);
  }, [step]);

  // Teclado: → ou Enter avança (passos 1–4), ← volta.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "BUTTON" && e.key === "Enter") return; // o próprio botão já trata o Enter
      if ((e.key === "ArrowRight" || e.key === "Enter") && step <= 4) next();
      if (e.key === "ArrowLeft" && step > 1) back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const toggleTouchId = () => {
    setTouchId((v) => {
      setPref("touchId", !v);
      return !v;
    });
  };

  const finish = () => {
    setPref("onboarded", true);
    onDone();
  };

  const dots = (
    <div className="dots" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => {
        const current = Math.min(step, 5);
        return <i key={i} className={i === current ? "on" : i < current ? "done" : ""} />;
      })}
    </div>
  );

  let content: ReactNode;
  let footer: ReactNode;

  switch (step) {
    case 1:
      content = (
        <>
          <span className="eyebrow"><Mail size={14} />Bem-vindo ao Quill</span>
          <h1 className="ob-title">Seu e-mail e sua agenda, num lugar só.</h1>
          <p className="ob-lead">
            Todas as suas contas numa caixa de entrada calma, com cara de Mac. Sem anúncios, sem IA e sem distração.
          </p>
          <p className="ob-hint">Leva menos de 2 minutos.</p>
        </>
      );
      footer = (
        <button className="btn solid lg" onClick={next}>
          Começar<ArrowRight size={17} />
        </button>
      );
      break;
    case 2:
      content = (
        <>
          <span className="eyebrow"><Inbox size={14} />Contas</span>
          <h1 className="ob-title">Todas as caixas, uma entrada só.</h1>
          <p className="ob-lead">
            Gmail, Google Workspace, Outlook e iCloud lado a lado. Cada conta ganha uma cor, para você saber de relance de
            onde veio cada e-mail.
          </p>
          <ul className="feats">
            <Feature icon={<Reply size={17} />}>Responde sempre pela conta certa</Feature>
            <Feature icon={<Search size={17} />}>Busca em todas as contas de uma vez</Feature>
            <Feature icon={<Layers size={17} />}>Ou veja uma conta de cada vez, quando quiser</Feature>
          </ul>
        </>
      );
      footer = (
        <>
          <button className="btn glass lg" onClick={back}>Voltar</button>
          <button className="btn solid lg" onClick={next}>Continuar<ArrowRight size={17} /></button>
        </>
      );
      break;
    case 3:
      content = (
        <>
          <span className="eyebrow"><CalendarDays size={14} />Agenda</span>
          <h1 className="ob-title">Sua agenda mora ao lado do e-mail.</h1>
          <p className="ob-lead">
            Convites viram um clique: aceitar, talvez ou recusar. O Quill usa as agendas que o seu Mac já conhece, em
            Ajustes → Contas de Internet.
          </p>
          <div className="note">
            <ShieldCheck size={16} />
            <span>
              O macOS vai pedir sua permissão para o Quill ver e editar a agenda. Dá para mudar isso depois em Ajustes do
              Sistema.
            </span>
          </div>
        </>
      );
      // A permissão real (EventKit) entra junto com a agenda; por enquanto os dois botões só avançam.
      footer = (
        <>
          <button className="btn glass lg" onClick={next}>Agora não</button>
          <button className="btn solid lg" onClick={next}><CalendarCheck size={17} />Permitir acesso à agenda</button>
        </>
      );
      break;
    case 4:
      content = (
        <>
          <span className="eyebrow"><Lock size={14} />Privacidade</span>
          <h1 className="ob-title">O que é seu fica no seu Mac.</h1>
          <p className="ob-lead">Sem servidor no meio do caminho e nenhuma IA lendo suas mensagens.</p>
          <ul className="feats">
            <Feature icon={<KeyRound size={17} />}>Senhas e acessos guardados nas Chaves do macOS</Feature>
            <Feature icon={<ShieldCheck size={17} />}>Nada passa por servidores do Quill</Feature>
            <Feature icon={<Eye size={17} />}>Sem rastrear quem abriu e sem anúncios</Feature>
          </ul>
          <button className="switch-card" role="switch" aria-checked={touchId} onClick={toggleTouchId}>
            <span className="feat-ic"><Fingerprint size={18} /></span>
            <span>
              <span className="switch-title" style={{ display: "block" }}>Abrir o Quill com Touch ID</span>
              <span className="switch-sub" style={{ display: "block" }}>Pede sua digital ao abrir o app</span>
            </span>
            <span className="toggle" role="presentation" aria-checked={touchId} />
          </button>
        </>
      );
      footer = (
        <>
          <button className="btn glass lg" onClick={back}>Voltar</button>
          <button className="btn solid lg" onClick={next}>Continuar<ArrowRight size={17} /></button>
        </>
      );
      break;
    case 5:
      content = (
        <>
          <span className="eyebrow"><User size={14} />Entrar</span>
          <h1 className="ob-title">Conecte sua primeira conta.</h1>
          <p className="ob-lead">
            Você entra pela página oficial de cada serviço. O Quill nunca vê nem guarda sua senha principal.
          </p>
          <div className="providers">
            {PROVIDERS.map((p, i) => (
              <button
                key={p.id}
                className={`provider${i === 0 ? " primary" : ""}`}
                onClick={() => choose(p.id)}
                disabled={signingIn !== null}
                aria-busy={signingIn === p.id}
              >
                <span className="provider-logo">{p.logo ? <Logo name={p.logo} size={21} /> : <Server size={20} />}</span>
                <span>
                  <span className="provider-name" style={{ display: "block" }}>{p.name}</span>
                  <span className="provider-sub" style={{ display: "block" }}>{p.sub}</span>
                </span>
                <span className="provider-arrow">
                  {signingIn === p.id ? <span className="spinner"><LoaderCircle size={18} /></span> : <ArrowRight size={18} />}
                </span>
              </button>
            ))}
          </div>
          {signingIn === "google" ? (
            <p className="small-note" role="status">
              <LoaderCircle size={14} />
              Termine o login na janela do navegador que abriu. Depois, volte para cá.
            </p>
          ) : loginError ? (
            <p className="small-note" role="alert" style={{ color: "var(--danger, #c2453d)" }}>{loginError}</p>
          ) : (
            <p className="small-note"><Lock size={14} />As outras contas você adiciona depois, quando quiser.</p>
          )}
        </>
      );
      footer = <button className="btn glass lg" onClick={back}>Voltar</button>;
      break;
    default:
      content = (
        <>
          <span className="eyebrow"><CircleCheck size={14} />Quase lá</span>
          <h1 className="ob-title">{isTauri ? "Conta conectada." : waiting ? "Suas contas estão chegando." : "Tudo pronto."}</h1>
          <p className="ob-lead">Os e-mails mais recentes já aparecem. O resto vai baixando em segundo plano.</p>
          <ul className="conn-list">
            {isTauri ? (
              connected.map((a) => (
                <ConnRow
                  key={a.email}
                  logo={a.email.includes("inchurch") ? "inchurch" : "gmail"}
                  name={a.email.endsWith("@gmail.com") ? a.email.split("@")[0] : a.email.split("@")[1].split(".")[0]}
                  mail={a.email}
                  ok
                />
              ))
            ) : (
              <>
                <ConnRow logo="gmail" name="Pessoal" mail="voce@gmail.com" ok />
                <ConnRow logo="gmail" name="Moradah" mail="projeto@gmail.com" ok />
                <ConnRow logo="inchurch" name="inchurch" mail="voce@empresa.com.br" ok={!waiting} />
              </>
            )}
          </ul>
        </>
      );
      footer = (
        <>
          <button className="btn glass lg" onClick={() => goTo(5)}><Plus size={16} />Adicionar outra conta</button>
          <button className="btn solid lg" onClick={finish}>Abrir caixa de entrada<ArrowRight size={17} /></button>
        </>
      );
  }

  return (
    <div className={`ob${hidden ? " paused" : ""}`}>
      <div className="ob-panel">
        <WindowLights />
        <div className="ob-art" ref={artRef} data-tauri-drag-region>
          <div className="ob-stage">
            <Scene step={step} waiting={waiting} />
          </div>
        </div>
        <section className="ob-text" aria-live="polite">
          <div className="ob-top" data-tauri-drag-region>
            <span>Passo {Math.min(step, 5)} de 5</span>
            {step >= 2 && step <= 4 && (
              <button className="btn glass sm" onClick={() => goTo(5)}>Pular</button>
            )}
          </div>
          <div className="ob-mid" key={step}>
            {content}
          </div>
          <div className="ob-foot">
            {dots}
            {footer}
          </div>
        </section>
      </div>
    </div>
  );
}

function ConnRow({ logo, name, mail, ok }: { logo: LogoName; name: string; mail: string; ok: boolean }) {
  return (
    <li className="conn">
      <span className="provider-logo"><Logo name={logo} size={21} /></span>
      <span>
        <span className="conn-name" style={{ display: "block" }}>{name}</span>
        <span className="conn-mail" style={{ display: "block" }}>{mail}</span>
      </span>
      {ok ? (
        <span className="conn-state ok"><CircleCheck size={15} />Conectada</span>
      ) : (
        <span className="conn-state wait">
          <span className="spinner"><LoaderCircle size={15} /></span>
          Aguardando o Google…
        </span>
      )}
    </li>
  );
}
