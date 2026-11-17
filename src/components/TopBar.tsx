import type { ReactNode } from "react";
import { Search } from "./icons";
import { AccountMenu } from "./AccountMenu";
import { Notifications } from "./Notifications";
import { openPalette } from "./paletteState";

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
          onFocus={(e) => {
            // sem busca própria nesta tela: a caixa abre a busca geral (⌘K)
            if (!onSearch) {
              e.currentTarget.blur();
              openPalette();
            }
          }}
        />
        <button type="button" className="kbd search-kbd" onClick={() => openPalette(search)} aria-label="Abrir busca geral (⌘K)">
          ⌘ K
        </button>
      </label>
      {actions}
      <Notifications />
      <AccountMenu />
    </header>
  );
}
