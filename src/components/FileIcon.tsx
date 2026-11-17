import { extOf, fileType, type FileType } from "../lib/files";

/**
 * Ícone do arquivo com a cor e a extensão reais (PDF vermelho, planilha verde, documento azul…),
 * no formato de folha com a ponta dobrada.
 */
export function FileIcon({ name, mime, size = 36 }: { name: string; mime?: string; size?: number }) {
  const type: FileType = fileType(name, mime);
  const ext = (extOf(name) || type).slice(0, 4).toUpperCase();
  return (
    <span className={`fi fi-${type}`} style={{ width: size * 0.82, height: size }} aria-hidden>
      <svg viewBox="0 0 30 36" width="100%" height="100%">
        <path className="fi-page" d="M4 1h15l10 10v21a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3z" />
        <path className="fi-corner" d="M19 1v7a3 3 0 0 0 3 3h7" />
      </svg>
      <b style={{ fontSize: Math.max(6.5, size * 0.21) }}>{ext}</b>
    </span>
  );
}
