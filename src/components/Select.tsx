import * as RSelect from "@radix-ui/react-select";
import type { ReactNode } from "react";
import { Check, ChevronDown } from "./icons";

export interface SelectOption {
  value: string;
  label: string;
  /** bolinha de cor ou ícone antes do texto */
  leading?: ReactNode;
}

/**
 * Menu de seleção no estilo do Quill (substitui o <select> nativo).
 * Teclado e leitor de tela vêm do Radix; o visual e a animação, do CSS (.qs-*).
 */
export function Select({
  value,
  onChange,
  options,
  label,
  size = "md",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  /** nome para leitor de tela */
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <RSelect.Root value={value} onValueChange={onChange}>
      <RSelect.Trigger className={`qs-trigger qs-${size} ${className}`} aria-label={label}>
        {current?.leading}
        <RSelect.Value>{current?.label}</RSelect.Value>
        <RSelect.Icon className="qs-chev">
          <ChevronDown size={14} aria-hidden />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content className="qs-content" position="popper" sideOffset={6} collisionPadding={12}>
          <RSelect.Viewport className="qs-viewport">
            {options.map((o) => (
              <RSelect.Item key={o.value} value={o.value} className="qs-item">
                {o.leading}
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="qs-check">
                  <Check size={14} aria-hidden />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

/** Bolinha de cor para usar como `leading`. */
export const Dot = ({ color }: { color: string }) => <i className="qs-dot" style={{ background: color }} aria-hidden />;
