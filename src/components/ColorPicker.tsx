import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import { Check, Plus } from "./icons";

/** Paleta ampla: 10 tons × 5 intensidades, do mais claro ao mais forte, mais cinzas. */
const HUES = [210, 225, 250, 275, 300, 330, 355, 20, 40, 95, 140, 170];
const SHADES: [number, number][] = [
  [55, 80],
  [55, 68],
  [50, 56],
  [45, 45],
  [40, 34],
];
const hsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${l}%)`;
const GRID = HUES.flatMap((h) => SHADES.map(([s, l]) => hsl(h, s, l)));
const GRAYS = ["#e7e7e9", "#c9cacd", "#9a9ca1", "#6f7176", "#4a4b4f", "#2a2b2e"];

const HEX = /^#([0-9a-f]{6})$/i;

/**
 * Botão "+" ao lado das cores prontas: abre uma paleta com muitas cores e um campo para o código (#RRGGBB).
 * Sem o seletor de cor nativo do sistema.
 */
export function MoreColors({
  value,
  onChange,
  presets = [],
  label = "Mais cores",
}: {
  value: string;
  onChange: (c: string) => void;
  /** cores que já aparecem ao lado (não contam como "cor própria") */
  presets?: string[];
  label?: string;
}) {
  const [hex, setHex] = useState("");
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const custom = ![...GRID, ...GRAYS, ...presets].some((c) => same(c, value)) && !value.startsWith("var(");
  return (
    <Popover.Root onOpenChange={(o) => o && setHex(HEX.test(value) ? value : "")}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`cp-more${custom ? " is-custom" : ""}`}
          aria-label={label}
          data-tip={label}
          style={custom ? { background: value } : undefined}
        >
          {!custom && <Plus size={14} aria-hidden />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="qp-content colorpick" sideOffset={8} collisionPadding={12} aria-label={label}>
          <div className="colorpick-grid" role="radiogroup" aria-label="Cores">
            {GRID.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} className="colorpick-dot" style={{ background: c }} onClick={() => onChange(c)}>
                {value === c && <Check size={12} aria-hidden />}
              </button>
            ))}
          </div>
          <div className="colorpick-grays" role="radiogroup" aria-label="Cinzas">
            {GRAYS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} className="colorpick-dot" style={{ background: c }} onClick={() => onChange(c)}>
                {value === c && <Check size={12} aria-hidden />}
              </button>
            ))}
          </div>
          <form
            className="colorpick-hex"
            onSubmit={(e) => {
              e.preventDefault();
              const v = hex.startsWith("#") ? hex : `#${hex}`;
              if (HEX.test(v)) onChange(v.toLowerCase());
            }}
          >
            <span className="colorpick-preview" style={{ background: HEX.test(hex.startsWith("#") ? hex : `#${hex}`) ? (hex.startsWith("#") ? hex : `#${hex}`) : "transparent" }} aria-hidden />
            <input value={hex} onChange={(e) => setHex(e.target.value.trim())} placeholder="#5A8CB7" aria-label="Código da cor" maxLength={7} spellCheck={false} />
            <button type="submit" className="btn glass sm">
              Usar
            </button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
