import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Minus, Plus, X } from "./icons";

const VIEW = 260; // tamanho do círculo de recorte na tela
const OUT = 256; // tamanho da foto salva

/**
 * Recorte da foto do avatar: arrastar para posicionar e zoom (botões, barra ou roda do mouse).
 * Devolve um JPEG quadrado pequeno em data URL.
 */
export function PhotoCropper({ file, onCancel, onDone }: { file: File | null; onCancel: () => void; onDone: (dataUrl: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    setZoom(1);
    setPos({ x: 0, y: 0 });
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // escala base: a imagem cobre o círculo inteiro
  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const w = (img?.naturalWidth ?? 0) * base * zoom;
  const h = (img?.naturalHeight ?? 0) * base * zoom;
  // não deixa sobrar espaço vazio dentro do círculo
  const clamp = (p: { x: number; y: number }, z = zoom) => {
    const ww = (img?.naturalWidth ?? 0) * base * z;
    const hh = (img?.naturalHeight ?? 0) * base * z;
    const mx = Math.max(0, (ww - VIEW) / 2);
    const my = Math.max(0, (hh - VIEW) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };
  const setZoomSafe = (z: number) => {
    const nz = Math.min(4, Math.max(1, z));
    setZoom(nz);
    setPos((p) => clamp(p, nz));
  };

  const down = (e: RPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
  };

  const save = () => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    const scale = OUT / VIEW;
    ctx.drawImage(img, (VIEW / 2 + pos.x - w / 2) * scale, (VIEW / 2 + pos.y - h / 2) * scale, w * scale, h * scale);
    onDone(canvas.toDataURL("image/jpeg", 0.88));
  };

  return (
    <Dialog.Root open={!!file} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="cmd-overlay" />
        <Dialog.Content className="crop-box" aria-describedby={undefined}>
          <div className="crop-head">
            <Dialog.Title className="crop-title">Ajustar foto</Dialog.Title>
            <Dialog.Close className="crop-x" aria-label="Fechar">
              <X size={16} aria-hidden />
            </Dialog.Close>
          </div>
          <div
            className="crop-stage"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            onWheel={(e) => setZoomSafe(zoom - e.deltaY * 0.002)}
            role="img"
            aria-label="Arraste para posicionar a foto"
          >
            {url && img && (
              <img
                src={url}
                alt=""
                draggable={false}
                style={{ width: w, height: h, transform: `translate(${pos.x}px, ${pos.y}px)` }}
              />
            )}
            <span className="crop-mask" aria-hidden />
          </div>
          <div className="crop-zoom">
            <button aria-label="Diminuir zoom" onClick={() => setZoomSafe(zoom - 0.25)}>
              <Minus size={15} aria-hidden />
            </button>
            <input
              type="range"
              className="crop-range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              aria-label="Zoom"
              onChange={(e) => setZoomSafe(Number(e.target.value))}
              style={{ "--p": `${((zoom - 1) / 3) * 100}%` } as React.CSSProperties}
            />
            <button aria-label="Aumentar zoom" onClick={() => setZoomSafe(zoom + 0.25)}>
              <Plus size={15} aria-hidden />
            </button>
          </div>
          <p className="crop-hint">Arraste para posicionar. Use a roda do mouse ou a barra para dar zoom.</p>
          <div className="crop-actions">
            <button className="btn glass" onClick={onCancel}>
              Cancelar
            </button>
            <button className="btn solid" onClick={save} disabled={!img}>
              Usar foto
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
