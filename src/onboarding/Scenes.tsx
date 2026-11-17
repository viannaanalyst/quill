import type { CSSProperties, ReactNode } from "react";
import iconLight from "../assets/brand/app-icon-light.png";
import iconDark from "../assets/brand/app-icon-dark.png";
import { Logo, type LogoName } from "../components/Logo";
import { CalendarDays, Check, Eye, Fingerprint, Inbox, KeyRound, LoaderCircle, Lock, Server, ShieldCheck } from "../components/icons";

/* As cenas são desenhadas num "palco" fixo de 717×858 que a tela escala para caber (ver Onboarding.tsx). */

const ACC = {
  pessoal: "var(--acc-pessoal)",
  moradah: "var(--acc-moradah)",
  inchurch: "var(--acc-inchurch)",
  outlook: "var(--acc-outlook)",
  icloud: "var(--acc-icloud)",
};

type Vars = CSSProperties & Record<`--${string}`, string>;

function AppIcon({ small, style }: { small?: boolean; style?: CSSProperties }) {
  return (
    <div className={`app-icon${small ? " sm" : ""}`} style={style}>
      <img className="only-light" src={iconLight} alt="" draggable={false} />
      <img className="only-dark" src={iconDark} alt="" draggable={false} />
    </div>
  );
}

function Clouds() {
  return (
    <>
      <div className="cloud" style={{ left: -40, bottom: 60, width: 260, height: 80 }} />
      <div className="cloud" style={{ right: -30, bottom: 130, width: 220, height: 64, animationDuration: "22s" }} />
      <div className="cloud" style={{ left: 120, top: 70, width: 160, height: 46, animationDuration: "26s", opacity: 0.7 }} />
    </>
  );
}

function Envelope({ size, style }: { size: number; style: Vars }) {
  return (
    <div className="env" style={style}>
      <svg width={size} height={Math.round(size * 0.7)} viewBox="0 0 40 28" aria-hidden>
        <rect x="1" y="1" width="38" height="26" rx="4" />
        <path d="M3 3 L20 15 L37 3" />
      </svg>
    </div>
  );
}

function Welcome() {
  return (
    <>
      <Clouds />
      <div className="glow" />
      <svg className="trail" viewBox="0 0 717 858" preserveAspectRatio="none" aria-hidden>
        <path d="M60 700 C 180 600, 250 760, 350 620 S 560 380, 650 170" />
      </svg>
      <Envelope size={54} style={{ left: 90, top: 610, "--r": "-12deg", "--dx": "26px", "--dy": "-18px" }} />
      <Envelope size={44} style={{ left: 520, top: 250, "--r": "10deg", "--dx": "-22px", "--dy": "16px", animationDuration: "11s" }} />
      <Envelope size={36} style={{ left: 470, top: 640, "--r": "6deg", "--dx": "18px", "--dy": "-24px", animationDuration: "10s" }} />
      <Envelope size={30} style={{ left: 150, top: 190, "--r": "-6deg", "--dx": "20px", "--dy": "22px", animationDuration: "12s" }} />
      <AppIcon />
    </>
  );
}

const BUBBLES: [number, number, LogoName, string, number][] = [
  [130, 200, "gmail", ACC.pessoal, 0],
  [245, 128, "gmail", ACC.moradah, 0.6],
  [358, 104, "inchurch", ACC.inchurch, 1.2],
  [471, 128, "microsoft", ACC.outlook, 1.8],
  [586, 200, "icloud", ACC.icloud, 2.4],
];

function Accounts() {
  const rows: { av: ReactNode; name: string; tag: string; color: string; sub: string }[] = [
    { av: <div className="av peach">MC</div>, name: "Mariana Costa", tag: "inchurch", color: ACC.inchurch, sub: "Fechamento de outubro — números finais" },
    { av: <div className="av logo"><Logo name="nubank" size={18} /></div>, name: "Nubank", tag: "Pessoal", color: ACC.pessoal, sub: "A fatura de novembro fechou" },
    { av: <div className="av logo"><Logo name="vercel" size={18} /></div>, name: "Vercel", tag: "Moradah", color: ACC.moradah, sub: "Deploy pronto: moradah-web" },
    { av: <div className="av blue">LA</div>, name: "Lucas Andrade", tag: "iCloud", color: ACC.icloud, sub: "Fotos do fim de semana em Campos" },
    { av: <div className="av logo"><Logo name="microsoft" size={18} /></div>, name: "Microsoft", tag: "Outlook", color: ACC.outlook, sub: "Novo acesso à sua conta" },
  ];
  return (
    <>
      <Clouds />
      <svg className="links" viewBox="0 0 717 858" aria-hidden>
        {BUBBLES.map(([x, y]) => (
          <path key={x} d={`M${x} ${y + 30} Q ${(x + 358) / 2} ${y + 120} 358 318`} />
        ))}
      </svg>
      {BUBBLES.map(([x, y, logo, color, delay]) => (
        <div key={x} className="bubble" style={{ left: x, top: y, animationDelay: `-${delay}s` }}>
          <Logo name={logo} size={27} />
          <i style={{ background: color }} />
        </div>
      ))}
      <div className="mock" style={{ left: 148, top: 318, width: 420 }}>
        <div className="mock-head">
          <Inbox size={15} />
          Entrada · todas as contas
          <span className="chip">48 novos</span>
        </div>
        {rows.map((r) => (
          <div className="mock-row" key={r.name}>
            {r.av}
            <div className="mock-body">
              <div className="mock-name">
                {r.name}
                <span className="acct">
                  <i style={{ background: r.color }} />
                  {r.tag}
                </span>
              </div>
              <div className="mock-sub">{r.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

const EVENTS: [number, number, number, string, string, boolean?][] = [
  [0, 1.5, 1, "Daily", ACC.inchurch],
  [0, 4, 1, "1:1 Mariana", ACC.inchurch],
  [1, 0.5, 1, "Treino", ACC.pessoal],
  [1, 3, 1.3, "Almoço · Lucas", ACC.icloud],
  [2, 2, 1, "Anúncios", ACC.moradah],
  [2, 5, 1, "Dentista", ACC.pessoal],
  [3, 1, 1.6, "Planejamento Q1", ACC.inchurch, true],
  [3, 4.4, 1, "Fornecedor", ACC.outlook],
  [4, 2.6, 1.4, "Brunch", ACC.icloud],
];

function Calendar() {
  return (
    <>
      <Clouds />
      <div className="mock" style={{ left: 95, top: 150, width: 520 }}>
        <div className="mock-head">
          <CalendarDays size={15} />
          16 – 20 de novembro
          <span className="chip">5 agendas</span>
        </div>
        <div className="cal-head">
          {[["seg", 16], ["ter", 17], ["qua", 18], ["qui", 19], ["sex", 20]].map(([d, n]) => (
            <div key={d} className={n === 17 ? "cal-today" : ""}>
              {d}
              <b>{n}</b>
            </div>
          ))}
        </div>
        <div className="cal-body">
          {[0, 1, 2, 3, 4].map((col) => (
            <div key={col}>
              {EVENTS.filter((e) => e[0] === col).map(([, top, h, title, color, pending]) => (
                <div
                  key={title}
                  className={`cal-ev${pending ? " pending" : ""}`}
                  style={{ "--c": color, top: top * 48 + 2, height: h * 48 - 5 } as Vars}
                >
                  {title}
                </div>
              ))}
              {col === 1 && <div className="now-line" style={{ top: 1.2 * 48 }} />}
            </div>
          ))}
        </div>
      </div>
      <div className="ob-invite" style={{ left: 330, top: 560 }}>
        <div className="ob-invite-h">
          <i style={{ background: ACC.inchurch }} />
          Convite · inchurch
        </div>
        <div className="ob-invite-t">Planejamento Q1</div>
        <div className="ob-invite-m">Qui, 19 nov · 10:00 – 11:30</div>
        <div className="ob-rsvp" aria-hidden>
          <span className="btn solid sm">
            <Check size={14} />
            Aceitar
          </span>
          <span className="btn glass sm">Talvez</span>
          <span className="btn glass sm">Recusar</span>
        </div>
      </div>
    </>
  );
}

function Privacy() {
  return (
    <>
      <Clouds />
      <div className="ring" />
      <div className="ring" style={{ animationDelay: "1.5s" }} />
      <div className="ring" style={{ animationDelay: "3s" }} />
      <div className="vault">
        <Lock size={58} />
      </div>
      <div className="badge-float" style={{ left: 92, top: 240 }}>
        <Eye size={16} />
        Sem IA lendo seus e-mails
      </div>
      <div className="badge-float" style={{ left: 420, top: 300, animationDelay: "-1.4s" }}>
        <KeyRound size={16} />
        Chaves do Mac
      </div>
      <div className="badge-float" style={{ left: 110, top: 570, animationDelay: "-2.6s" }}>
        <ShieldCheck size={16} />
        Nada passa por servidor
      </div>
      <div className="badge-float" style={{ left: 440, top: 600, animationDelay: "-3.6s" }}>
        <Fingerprint size={16} />
        Touch ID
      </div>
    </>
  );
}

function SignIn() {
  return (
    <>
      <Clouds />
      <div className="glow" />
      <div className="orbit-inner" />
      <div className="orbit">
        <div className="orbit-item" style={{ left: "50%", top: 0 }}>
          <Logo name="gmail" size={28} />
        </div>
        <div className="orbit-item" style={{ left: "100%", top: "50%" }}>
          <Logo name="microsoft" size={28} />
        </div>
        <div className="orbit-item" style={{ left: "50%", top: "100%" }}>
          <Logo name="icloud" size={28} />
        </div>
        <div className="orbit-item" style={{ left: 0, top: "50%" }}>
          <Server size={24} />
        </div>
      </div>
      <AppIcon small />
    </>
  );
}

function Connecting({ waiting }: { waiting: boolean }) {
  return (
    <>
      <Clouds />
      <AppIcon small style={{ top: 230 }} />
      <div className="check-pop" style={{ left: "calc(50% + 66px)", top: 146 }}>
        <Check size={16} />
      </div>
      <div className="stack" style={{ top: 400 }}>
        <div className="stack-card">
          <div className="av logo"><Logo name="gmail" size={17} /></div>
          <div className="mock-body">
            <div className="mock-name">Pessoal</div>
            <div className="mock-sub">voce@gmail.com</div>
          </div>
          <span className="chip">21 novos</span>
        </div>
        <div className="stack-card">
          <div className="av logo"><Logo name="gmail" size={17} /></div>
          <div className="mock-body">
            <div className="mock-name">Moradah</div>
            <div className="mock-sub">projeto@gmail.com</div>
          </div>
          <span className="chip">9 novos</span>
        </div>
        <div className={`stack-card${waiting ? " syncing" : ""}`}>
          <div className="av logo"><Logo name="inchurch" size={17} /></div>
          <div className="mock-body">
            <div className="mock-name">inchurch</div>
            <div className="mock-sub">{waiting ? "Importando e-mails…" : "voce@empresa.com.br"}</div>
          </div>
          {waiting ? (
            <span className="conn-state wait">
              <span className="spinner"><LoaderCircle size={15} /></span>
            </span>
          ) : (
            <span className="chip">12 novos</span>
          )}
        </div>
      </div>
    </>
  );
}

export function Scene({ step, waiting }: { step: number; waiting: boolean }) {
  return (
    <div className="ob-scene" key={step}>
      {step === 1 && <Welcome />}
      {step === 2 && <Accounts />}
      {step === 3 && <Calendar />}
      {step === 4 && <Privacy />}
      {step === 5 && <SignIn />}
      {step === 6 && <Connecting waiting={waiting} />}
    </div>
  );
}
