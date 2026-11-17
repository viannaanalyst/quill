import { lazy, Suspense } from "react";
import "./shell.css";
import iconLight from "../assets/brand/app-icon-light-128.png";
import iconDark from "../assets/brand/app-icon-dark-128.png";
import { WindowLights } from "../components/WindowLights";
import { Archive, CalendarDays, FileText, Inbox as InboxIcon, Send, Settings as SettingsIcon, SquarePen, Star, Trash2 } from "../components/icons";
import { isTauri } from "../lib/platform";
import { navigate, useStore, type View } from "../state/store";
import Inbox from "../inbox/Inbox";

// Telas abertas com menos frequência carregam só quando usadas.
const ReadView = lazy(() => import("../read/ReadView"));
const Compose = lazy(() => import("../compose/Compose"));
const Calendar = lazy(() => import("../calendar/Calendar"));
const Settings = lazy(() => import("../settings/Settings"));

type NavItem = { icon: typeof InboxIcon; label: string; to: View; active: (v: View) => boolean; badge?: boolean };

const NAV: NavItem[] = [
  { icon: SquarePen, label: "Escrever", to: { name: "compose" }, active: (v) => v.name === "compose" },
  {
    icon: InboxIcon,
    label: "Caixa de entrada",
    to: { name: "inbox", folder: "inbox" },
    active: (v) => (v.name === "inbox" && v.folder === "inbox") || v.name === "read",
    badge: true,
  },
  { icon: Star, label: "Importantes", to: { name: "inbox", folder: "starred" }, active: (v) => v.name === "inbox" && v.folder === "starred" },
  { icon: Send, label: "Enviados", to: { name: "inbox", folder: "sent" }, active: (v) => v.name === "inbox" && v.folder === "sent" },
  { icon: FileText, label: "Rascunhos", to: { name: "inbox", folder: "drafts" }, active: (v) => v.name === "inbox" && v.folder === "drafts" },
  { icon: Archive, label: "Arquivo", to: { name: "inbox", folder: "archive" }, active: (v) => v.name === "inbox" && v.folder === "archive" },
  { icon: Trash2, label: "Lixeira", to: { name: "inbox", folder: "trash" }, active: (v) => v.name === "inbox" && v.folder === "trash" },
];

function RailButton({ item, view }: { item: NavItem; view: View }) {
  const active = item.active(view);
  return (
    <button
      className="rail-btn"
      data-tip={item.label}
      data-tip-pos="right"
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      onClick={() => navigate(item.to)}
    >
      <item.icon size={19} aria-hidden />
      {item.badge && <span className="badge" aria-hidden />}
    </button>
  );
}

function Screen({ view, onRestartOnboarding }: { view: View; onRestartOnboarding: () => void }) {
  switch (view.name) {
    case "inbox":
      return <Inbox folder={view.folder} />;
    case "read":
      return <ReadView id={view.id} />;
    case "compose":
      return <Compose />;
    case "calendar":
      return <Calendar mode={view.mode} />;
    case "settings":
      return <Settings onRestartOnboarding={onRestartOnboarding} />;
  }
}

/** Estrutura da janela: barra de ícones por fora + painel com a linha fina. */
export default function AppShell({ onRestartOnboarding }: { onRestartOnboarding: () => void }) {
  const view = useStore((s) => s.view);
  const calendarItem: NavItem = { icon: CalendarDays, label: "Calendário", to: { name: "calendar", mode: "week" }, active: (v) => v.name === "calendar" };
  const settingsItem: NavItem = { icon: SettingsIcon, label: "Ajustes", to: { name: "settings" }, active: (v) => v.name === "settings" };

  return (
    <div className="app">
      <aside className={`rail${isTauri ? " native-lights" : ""}`} data-tauri-drag-region>
        <WindowLights />
        <div className="rail-logo">
          <img className="only-light" src={iconLight} alt="Quill" draggable={false} />
          <img className="only-dark" src={iconDark} alt="" draggable={false} />
        </div>
        <nav className="rail-nav" aria-label="Seções">
          {NAV.map((item) => (
            <RailButton key={item.label} item={item} view={view} />
          ))}
          <div className="rail-sep" aria-hidden />
          <RailButton item={calendarItem} view={view} />
        </nav>
        <div className="rail-bottom">
          <RailButton item={settingsItem} view={view} />
        </div>
      </aside>

      <main className="panel">
        <Suspense fallback={null}>
          <Screen view={view} onRestartOnboarding={onRestartOnboarding} />
        </Suspense>
      </main>
    </div>
  );
}
