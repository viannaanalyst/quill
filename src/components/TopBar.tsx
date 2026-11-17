import type { ReactNode } from "react";
import { Bell, Search } from "./icons";

/** Cabeçalho das telas: título • complemento, busca, ações e o avatar no canto direito. */
export function TopBar({
  leading,
  title,
  sub,
  searchPlaceholder = "Buscar em todas as contas",
  search,
  onSearch,
  actions,
}: {
  leading?: ReactNode;
  title: string;
  sub?: string;
  searchPlaceholder?: string;
  search?: string;
  onSearch?: (q: string) => void;
  actions?: ReactNode;
}) {
  return (
    <header className="top" data-tauri-drag-region>
      {leading}
      <span className="top-title">{title}</span>
      {sub && (
        <>
          <span className="top-dot" aria-hidden />
          <span className="top-count top-sub">{sub}</span>
        </>
      )}
      <label className="search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={search ?? ""}
          onChange={(e) => onSearch?.(e.target.value)}
          readOnly={!onSearch}
        />
        <span className="kbd" aria-hidden>⌘ K</span>
      </label>
      {actions}
      <button className="btn glass ic" aria-label="Notificações" data-tip="Notificações">
        <Bell size={17} aria-hidden />
      </button>
      <div className="me" role="img" aria-label="Gabriel Vianna">GV</div>
    </header>
  );
}
