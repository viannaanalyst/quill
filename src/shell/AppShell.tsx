import "./shell.css";
import iconLight from "../assets/brand/app-icon-light-128.png";
import iconDark from "../assets/brand/app-icon-dark-128.png";
import { WindowLights } from "../components/WindowLights";
import {
  Archive,
  Bell,
  CalendarDays,
  FileText,
  Inbox,
  RotateCcw,
  Send,
  Settings,
  SquarePen,
  Star,
  Trash2,
} from "../components/icons";
import { isTauri } from "../lib/platform";

const NAV = [
  { icon: SquarePen, label: "Escrever" },
  { icon: Inbox, label: "Caixa de entrada", current: true, badge: true },
  { icon: Star, label: "Importantes" },
  { icon: Send, label: "Enviados" },
  { icon: FileText, label: "Rascunhos" },
  { icon: Archive, label: "Arquivo" },
  { icon: Trash2, label: "Lixeira" },
];

/** Estrutura da janela (barra de ícones + painel). A caixa de entrada de verdade entra na próxima etapa. */
export default function AppShell({ onRestartOnboarding }: { onRestartOnboarding: () => void }) {
  return (
    <div className="app">
      <aside className={`rail${isTauri ? " native-lights" : ""}`} data-tauri-drag-region>
        <WindowLights />
        <div className="rail-logo">
          <img className="only-light" src={iconLight} alt="Quill" draggable={false} />
          <img className="only-dark" src={iconDark} alt="Quill" draggable={false} />
        </div>
        <nav className="rail-nav" aria-label="Seções">
          {NAV.map(({ icon: Icon, label, current, badge }) => (
            <button key={label} className="rail-btn" title={label} aria-label={label} aria-current={current ? "page" : undefined}>
              <Icon size={19} />
              {badge && <span className="badge" />}
            </button>
          ))}
          <div className="rail-sep" />
          <button className="rail-btn" title="Calendário" aria-label="Calendário">
            <CalendarDays size={19} />
          </button>
        </nav>
        <div className="rail-bottom">
          <button className="rail-btn" title="Ajustes" aria-label="Ajustes">
            <Settings size={19} />
          </button>
        </div>
      </aside>

      <main className="panel">
        <header className="top" data-tauri-drag-region>
          <span className="top-title">Caixa de entrada</span>
          <span className="top-dot" />
          <span className="top-count">em construção</span>
          <div className="top-actions">
            <button className="btn glass ic" aria-label="Notificações">
              <Bell size={17} />
            </button>
            <div className="me" aria-label="Gabriel Vianna">GV</div>
          </div>
        </header>
        <div className="empty">
          <div className="empty-card">
            <div className="empty-ic">
              <Inbox size={28} />
            </div>
            <h2>A caixa de entrada chega na próxima etapa</h2>
            <p>
              O onboarding e a tela de entrar já estão prontos. A seguir vem a caixa de entrada igual ao desenho aprovado,
              primeiro com dados de exemplo e depois com as suas contas de verdade.
            </p>
            <button className="btn glass" onClick={onRestartOnboarding}>
              <RotateCcw size={15} />
              Ver o onboarding de novo
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
