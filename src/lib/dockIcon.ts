import { isTauri } from "./platform";
import { getPref } from "./storage";
import defaultLight from "../assets/brand/app-icon-light.png";
import defaultDark from "../assets/brand/app-icon-dark.png";

/**
 * Ícones que a pessoa pode escolher para o Dock (Ajustes → Aparência).
 * As variações ficam em `src/assets/dock/<id>.png` (512 px, já com o formato arredondado do macOS).
 */
const files = import.meta.glob<string>("../assets/dock/*.png", { eager: true, query: "?url", import: "default" });

const LABELS: Record<string, string> = {
  azul: "Azul",
  salvia: "Sálvia",
  grafite: "Grafite",
  branco: "Branco",
  noite: "Noite",
  papel: "Papel",
};

export interface DockIcon {
  id: string;
  label: string;
  src: string;
}

export const DOCK_ICONS: DockIcon[] = [
  { id: "default", label: "Clássico", src: defaultLight },
  { id: "escuro", label: "Escuro", src: defaultDark },
  ...Object.entries(files)
    .map(([path, src]) => {
      const id = path.split("/").pop()!.replace(".png", "");
      return { id, label: LABELS[id] ?? id, src };
    })
    .toSorted((a, b) => Object.keys(LABELS).indexOf(a.id) - Object.keys(LABELS).indexOf(b.id)),
];

export const DOCK_PREF = "dockIcon";

async function toBase64(url: string) {
  const blob = await (await fetch(url)).blob();
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Aplica o ícone no Dock (no app de verdade; na prévia não faz nada). */
export async function applyDockIcon(id: string = getPref(DOCK_PREF, "default")) {
  if (!isTauri) return;
  const icon = DOCK_ICONS.find((i) => i.id === id);
  const png = !icon || icon.id === "default" ? "" : await toBase64(icon.src);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_dock_icon", { pngBase64: png });
}
