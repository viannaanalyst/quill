import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Grupo de abas/botões com um destaque que desliza até o item ativo
 * (o item ativo tem aria-current="page", aria-pressed="true" ou aria-checked="true").
 * Mede só quando o item ativo ou o tamanho mudam e anima com transform.
 */
export function SliderGroup({
  children,
  activeKey,
  className = "",
  role,
  label,
  style,
}: {
  children: ReactNode;
  /** muda quando o item ativo muda (para medir de novo) */
  activeKey: string;
  className?: string;
  role?: string;
  label?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    const ind = indicator.current;
    if (!el || !ind) return;
    const place = () => {
      const active = el.querySelector<HTMLElement>('[aria-current="page"], [aria-pressed="true"], [aria-checked="true"]');
      if (!active) {
        ind.style.opacity = "0";
        return;
      }
      if (first.current) ind.style.transition = "none";
      ind.style.opacity = "1";
      ind.style.width = `${active.offsetWidth}px`;
      ind.style.height = `${active.offsetHeight}px`;
      ind.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      if (first.current) {
        void ind.offsetWidth; // aplica a posição inicial sem animar
        ind.style.transition = "";
        first.current = false;
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeKey]);

  return (
    <div ref={ref} className={`slider-group ${className}`} role={role} aria-label={label} style={style}>
      <span ref={indicator} className="slider-indicator" aria-hidden />
      {children}
    </div>
  );
}
