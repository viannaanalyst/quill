import "./shell.css";
import iconLight from "../assets/brand/app-icon-light-128.png";
import iconDark from "../assets/brand/app-icon-dark-128.png";
import { WindowLights } from "../components/WindowLights";
import { Archive, CalendarDays, FileText, Inbox as InboxIcon, Send, Settings, SquarePen, Star, Trash2 } from "../components/icons";
import { isTauri } from "../lib/platform";
import Inbox from "../inbox/Inbox";

const NAV = [
  { icon: SquarePen, label: "Escrever" },
  { icon: InboxIcon, label: "Caixa de entrada", current: true, badge: true },
  { icon: Star, label: "Importantes" },
  { icon: Send, label: "Enviados" },
  { icon: FileText, label: "Rascunhos" },
  { icon: Archive, label: "Arquivo" },
  { icon: Trash2, label: "Lixeira" },
];

/** Estrutura da janela: barra de ícones por fora + painel com a linha fina. */
export default function AppShell({ onRestartOnboarding }: { onRestartOnboarding: () => void }) {
  return (
    <div className="app">
      <aside className={`rail${isTauri ? " native-lights" : ""}`} data-tauri-drag-region>
        <WindowLights />
        <div className="rail-logo">
          <img className="only-light" src={iconLight} alt="Quill" draggable={false} />
          <img className="only-dark" src={iconDark} alt="" draggable={false} />
        </div>
        <nav className="rail-nav" aria-label="Seções">
          {NAV.map(({ icon: Icon, label, current, badge }) => (
            <button
              key={label}
              className="rail-btn"
              title={label}
              aria-label={label}
              aria-current={current ? "page" : undefined}
            >
              <Icon size={19} aria-hidden />
              {badge && <span className="badge" aria-hidden />}
            </button>
          ))}
          <div className="rail-sep" aria-hidden />
          <button className="rail-btn" title="Calendário" aria-label="Calendário">
            <CalendarDays size={19} aria-hidden />
          </button>
        </nav>
        <div className="rail-bottom">
          {/* Enquanto a tela de Ajustes não existe, este botão serve para rever o onboarding. */}
          <button
            className="rail-btn"
            title="Ajustes (por enquanto: rever o onboarding)"
            aria-label="Ajustes"
            onClick={onRestartOnboarding}
          >
            <Settings size={19} aria-hidden />
          </button>
        </div>
      </aside>

      <main className="panel">
        <Inbox />
      </main>
    </div>
  );
}
