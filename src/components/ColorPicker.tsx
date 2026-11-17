import * as Popover from "@radix-ui/react-popover";
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Plus } from "./icons";

const HEX = /^#([0-9a-f]{6})$/i;
const SIZE = 200; // diâmetro da roda

/** HSV (h 0–360, s e v 0–1) → "#rrggbb". */
function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** "#rrggbb" → HSV. */
function hexToHsv(hex: string): [number, number, number] {
  const m = HEX.exec(hex);
  if (!m) return [210, 0.5, 0.75];
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

const GRAYS = ["#ffffff", "#e7e7e9", "#c9cacd", "#9a9ca1", "#6f7176", "#4a4b4f", "#2a2b2e", "#000000"];

/**
 * Botão "+" ao lado das cores prontas: abre a roda de cores (todas as cores; o centro é claro e a borda é forte),
 * uma barra de brilho, cinzas e o campo do código (#RRGGBB). Sem o seletor nativo do sistema.
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
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
  const [hex, setHex] = useState(HEX.test(value) ? value : "");
  const wheel = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const custom = HEX.test(value) && ![...presets, ...GRAYS].some((c) => same(c, value));

  const apply = (next: [number, number, number]) => {
    setHsv(next);
    const c = hsvToHex(...next);
    setHex(c);
    onChange(c);
  };
  const pick = (e: RPointerEvent) => {
    const r = wheel.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const radius = r.width / 2;
    // ângulo a partir do topo, no sentido horário (igual ao conic-gradient)
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / radius);
    apply([h, s, hsv[2] || 1]);
  };

  // posição da bolinha na roda
  const rad = (hsv[0] * Math.PI) / 180;
  const knobX = SIZE / 2 + Math.sin(rad) * hsv[1] * (SIZE / 2);
  const knobY = SIZE / 2 - Math.cos(rad) * hsv[1] * (SIZE / 2);
  const current = hsvToHex(...hsv);

  return (
    <Popover.Root
      onOpenChange={(o) => {
        if (!o) return;
        setHsv(hexToHsv(value));
        setHex(HEX.test(value) ? value : "");
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" className={`cp-more${custom ? " is-custom" : ""}`} aria-label={label} data-tip={label} style={custom ? { background: value } : undefined}>
          {!custom && <Plus size={14} aria-hidden />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="qp-content colorpick" sideOffset={8} collisionPadding={12} aria-label={label}>
          <div
            ref={wheel}
            className="colorpick-wheel"
            style={{ width: SIZE, height: SIZE }}
            role="slider"
            aria-label="Roda de cores: arraste para escolher a cor"
            aria-valuetext={current}
            tabIndex={0}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = true;
              pick(e);
            }}
            onPointerMove={(e) => dragging.current && pick(e)}
            onPointerUp={() => (dragging.current = false)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 15 : 5;
              if (e.key === "ArrowRight") apply([(hsv[0] + step) % 360, hsv[1], hsv[2]]);
              else if (e.key === "ArrowLeft") apply([(hsv[0] - step + 360) % 360, hsv[1], hsv[2]]);
              else if (e.key === "ArrowUp") apply([hsv[0], Math.min(1, hsv[1] + 0.05), hsv[2]]);
              else if (e.key === "ArrowDown") apply([hsv[0], Math.max(0, hsv[1] - 0.05), hsv[2]]);
              else return;
              e.preventDefault();
            }}
          >
            <span className="colorpick-shade" style={{ opacity: 1 - hsv[2] }} aria-hidden />
            <span className="colorpick-knob" style={{ transform: `translate(${knobX}px, ${knobY}px)`, background: current }} aria-hidden />
          </div>
          <label className="colorpick-bright">
            <span>Brilho</span>
            <input
              type="range"
              className="crop-range"
              min={0.15}
              max={1}
              step={0.01}
              value={hsv[2]}
              aria-label="Brilho"
              style={{ "--p": `${((hsv[2] - 0.15) / 0.85) * 100}%` } as React.CSSProperties}
              onChange={(e) => apply([hsv[0], hsv[1], Number(e.target.value)])}
            />
          </label>
          <div className="colorpick-grays" role="radiogroup" aria-label="Cinzas">
            {GRAYS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={same(value, c)}
                aria-label={c}
                className="colorpick-dot"
                style={{ background: c }}
                onClick={() => {
                  setHsv(hexToHsv(c));
                  setHex(c);
                  onChange(c);
                }}
              />
            ))}
          </div>
          <form
            className="colorpick-hex"
            onSubmit={(e) => {
              e.preventDefault();
              const v = hex.startsWith("#") ? hex : `#${hex}`;
              if (HEX.test(v)) {
                setHsv(hexToHsv(v));
                onChange(v.toLowerCase());
              }
            }}
          >
            <span className="colorpick-preview" style={{ background: current }} aria-hidden />
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
