import { useRef, type ReactNode } from "react";
import "./bannerScenes.css";
import { Check, Clock, ImageUp, Trash2 } from "../components/icons";
import { toast } from "../components/Toasts";
import { usePref } from "../lib/usePref";
import { getPref } from "../lib/storage";

/**
 * Imagens do cartão de saudação: cenas desenhadas aqui mesmo (SVG), cada uma com versão
 * clara e escura (as cores ficam em bannerScenes.css e trocam com o tema), mais a foto do usuário.
 */

export type SceneId = "original" | "sky" | "mountains" | "sea" | "city" | "aurora" | "field";
export type BannerChoice = "auto" | SceneId | "photo" | "none";

export const SCENES: { id: SceneId; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "sky", label: "Céu" },
  { id: "mountains", label: "Montanhas" },
  { id: "sea", label: "Mar" },
  { id: "city", label: "Cidade" },
  { id: "aurora", label: "Aurora" },
  { id: "field", label: "Campo" },
];

/** Automático: céu de manhã (5h–12h), campo à tarde (12h–18h), cidade à noite. */
export function autoScene(t: number): SceneId {
  const h = new Date(t).getHours();
  if (h >= 5 && h < 12) return "sky";
  if (h >= 12 && h < 18) return "field";
  return "city";
}

export function greeting(t: number): string {
  const h = new Date(t).getHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

/** Preferências da imagem, compartilhadas entre o cartão e os Ajustes (a troca aparece na hora). */
export function useBannerPrefs() {
  const [scene, setScene] = usePref<BannerChoice>("bannerScene", "auto");
  const [photo, setPhoto] = usePref<string>("bannerPhoto", "");
  return { scene, setScene, photo, setPhoto };
}

/** Reduz a foto para no máximo 1600 px de largura (e 1200 de altura) em JPEG, como data URL. */
export function resizeBannerPhoto(file: File, maxW = 1600, maxH = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Não consegui abrir essa imagem."));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não consegui abrir essa imagem."));
    };
    img.src = url;
  });
}

/* ---------------- desenhos ---------------- */

/* Ilustrações das cenas (geradas pelo Codex, em WebP leve). Cada uma tem versão clara e escura. */
import skyLight from "../assets/banners/sky-light.webp";
import skyDark from "../assets/banners/sky-dark.webp";
import mountainsLight from "../assets/banners/mountains-light.webp";
import mountainsDark from "../assets/banners/mountains-dark.webp";
import seaLight from "../assets/banners/sea-light.webp";
import seaDark from "../assets/banners/sea-dark.webp";
import cityLight from "../assets/banners/city-light.webp";
import cityDark from "../assets/banners/city-dark.webp";
import auroraLight from "../assets/banners/aurora-light.webp";
import auroraDark from "../assets/banners/aurora-dark.webp";
import fieldLight from "../assets/banners/field-light.webp";
import fieldDark from "../assets/banners/field-dark.webp";

/** Imagem clara/escura de cada cena e a altura (em %) que fica à mostra na faixa baixa do cartão. */
/** A primeira ilustração do Quill (desenho em SVG): céu, nuvens, sol/lua e envelopes numa trilha. */
function Envelope({ x, y, w, rotate }: { x: number; y: number; w: number; rotate: number }) {
  const h = w * 0.66;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={w * 0.09} fill="var(--env)" stroke="var(--envline)" strokeWidth="1.2" />
      <path d={`M${-w / 2 + 2} ${-h / 2 + 2} L0 ${h * 0.08} L${w / 2 - 2} ${-h / 2 + 2}`} fill="none" stroke="var(--envline)" strokeWidth="1.2" strokeLinejoin="round" />
    </g>
  );
}

function OriginalArt({ thumb }: { thumb?: boolean }) {
  return (
    <svg className="banner-original" viewBox={thumb ? "560 -10 440 150" : "0 0 1000 112"} preserveAspectRatio="xMaxYMid slice" aria-hidden focusable="false">
      <defs>
        <linearGradient id="quill-sky-o" x1="0" x2="1" y1="0" y2=".5">
          <stop offset=".25" stopColor="var(--o-sky1)" />
          <stop offset="1" stopColor="var(--o-sky2)" />
        </linearGradient>
        <radialGradient id="quill-glow-o">
          <stop offset="0" stopColor="var(--o-sun)" stopOpacity=".9" />
          <stop offset="1" stopColor="var(--o-sun)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="-200" width="1400" height="160" fill="url(#quill-sky-o)" />
      <g fill="var(--o-star)">
        <circle cx="560" cy="18" r="1.2" />
        <circle cx="640" cy="40" r="1" />
        <circle cx="720" cy="14" r="1.4" />
        <circle cx="790" cy="52" r="1" />
        <circle cx="960" cy="22" r="1.2" />
        <circle cx="600" cy="70" r=".9" />
      </g>
      <circle cx="905" cy="32" r="44" fill="url(#quill-glow-o)" />
      <circle cx="905" cy="32" r="15" fill="var(--o-sun)" />
      <g fill="var(--o-cloud2)">
        <circle cx="700" cy="122" r="40" />
        <circle cx="760" cy="104" r="38" />
        <circle cx="830" cy="114" r="44" />
        <circle cx="900" cy="98" r="36" />
        <circle cx="970" cy="108" r="42" />
      </g>
      <g fill="var(--o-cloud)">
        <circle cx="760" cy="132" r="34" />
        <circle cx="815" cy="120" r="30" />
        <circle cx="870" cy="134" r="36" />
        <circle cx="940" cy="124" r="30" />
        <circle cx="1000" cy="130" r="34" />
      </g>
      <path d="M470 82 C540 56 590 88 650 62 S770 28 860 46" fill="none" stroke="#8FAA87" strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round" />
      <Envelope x={470} y={82} w={24} rotate={-10} />
      <Envelope x={600} y={58} w={30} rotate={8} />
      <Envelope x={745} y={36} w={38} rotate={-6} />
    </svg>
  );
}

const ART: Record<Exclude<SceneId, "original">, { light: string; dark: string; y: string }> = {
  sky: { light: skyLight, dark: skyDark, y: "38%" },
  mountains: { light: mountainsLight, dark: mountainsDark, y: "62%" },
  sea: { light: seaLight, dark: seaDark, y: "58%" },
  city: { light: cityLight, dark: cityDark, y: "78%" },
  aurora: { light: auroraLight, dark: auroraDark, y: "48%" },
  field: { light: fieldLight, dark: fieldDark, y: "80%" },
};

/** Ilustração de uma cena. Os detalhes ficam à direita, então ela se corta pela esquerda (onde vai o texto). */
export function SceneArt({ scene, className, thumb = false }: { scene: SceneId; className?: string; thumb?: boolean }) {
  if (scene === "original") {
    return (
      <span className={`banner-art banner-img${className ? ` ${className}` : ""}`} data-scene={scene} aria-hidden>
        <OriginalArt thumb={thumb} />
      </span>
    );
  }
  const art = ART[scene] ?? ART.sky;
  const style = { objectPosition: thumb ? "85% 70%" : `right ${art.y}` };
  return (
    <span className={`banner-art banner-img${className ? ` ${className}` : ""}`} data-scene={scene} aria-hidden>
      <img className="only-light" src={art.light} alt="" decoding="async" draggable={false} style={style} />
      <img className="only-dark" src={art.dark} alt="" decoding="async" draggable={false} style={style} />
    </span>
  );
}

/* ---------------- escolha da imagem (Ajustes e popover do cartão) ---------------- */

/** Grade de miniaturas + botões para escolher/remover a foto. */
export function BannerPicker({ now, compact = false }: { now: number; compact?: boolean }) {
  const { scene, setScene, photo, setPhoto } = useBannerPrefs();
  const input = useRef<HTMLInputElement>(null);

  const pick = () => input.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = await resizeBannerPhoto(file);
      setPhoto(data);
      // o armazenamento local tem limite; se não coube, avisa em vez de fingir que salvou
      if (getPref("bannerPhoto", "") !== data) {
        toast("Essa imagem é grande demais para guardar. Tente outra.", "error");
        setPhoto("");
        return;
      }
      setScene("photo");
    } catch {
      toast("Não consegui abrir essa imagem.", "error");
    }
  };

  const remove = () => {
    setPhoto("");
    if (scene === "photo") setScene("auto");
  };

  const auto = autoScene(now);
  const items: { id: BannerChoice; label: string; thumb: ReactNode }[] = [
    {
      id: "auto",
      label: "Automático",
      thumb: (
        <>
          <SceneArt scene={auto} thumb />
          <span className="banner-thumb-badge">
            <Clock size={11} aria-hidden />
            Auto
          </span>
        </>
      ),
    },
    ...SCENES.map((s) => ({ id: s.id as BannerChoice, label: s.label, thumb: <SceneArt scene={s.id} thumb /> })),
    {
      id: "photo",
      label: "Minha imagem",
      thumb: photo ? (
        <img src={photo} alt="" />
      ) : (
        <span className="banner-thumb-add">
          <ImageUp size={16} aria-hidden />
        </span>
      ),
    },
    {
      id: "none",
      label: "Sem imagem",
      thumb: (
        <span className="banner-thumb-none">
          <i />
          <i />
        </span>
      ),
    },
  ];

  return (
    <div className={`banner-picker${compact ? " banner-picker-compact" : ""}`}>
      <div className="banner-grid" role="group" aria-label="Imagem da saudação">
        {items.map((it) => {
          const on = scene === it.id;
          const empty = it.id === "photo" && !photo;
          return (
            <button
              key={it.id}
              type="button"
              className="banner-thumb"
              aria-pressed={on}
              aria-label={empty ? "Minha imagem: escolher do computador" : it.id === "auto" ? "Automático (muda com a hora)" : it.label}
              onClick={() => (empty ? pick() : setScene(it.id))}
            >
              <span className={`banner-thumb-img${empty ? " is-empty" : ""}`}>
                {it.thumb}
                {on && (
                  <span className="banner-thumb-check" aria-hidden>
                    <Check size={11} strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className="banner-thumb-label">{it.label}</span>
            </button>
          );
        })}
      </div>
      <div className="banner-picker-actions">
        <button type="button" className="btn glass sm" onClick={pick}>
          <ImageUp size={14} aria-hidden />
          Escolher do computador
        </button>
        {photo && (
          <button type="button" className="btn glass sm" onClick={remove}>
            <Trash2 size={14} aria-hidden />
            Remover
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
