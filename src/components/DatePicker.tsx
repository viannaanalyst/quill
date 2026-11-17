import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import { Select } from "./Select";
import { CalendarDays, ChevronLeft, ChevronRight } from "./icons";

const pad = (n: number) => String(n).padStart(2, "0");
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const DOW = ["S", "T", "Q", "Q", "S", "S", "D"];
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Campo de data no estilo do Quill (valor "AAAA-MM-DD"), com um mês para escolher o dia. */
export function DatePicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const current = fromYmd(value);
  const [month, setMonth] = useState(() => new Date(current.getFullYear(), current.getMonth(), 1));
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // semana começa na segunda
  const cells = Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - lead + i));
  const today = toYmd(new Date());
  const shown = current.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setMonth(new Date(current.getFullYear(), current.getMonth(), 1));
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" className="qs-trigger qs-sm dp-trigger" aria-label={`${label}: ${shown}`}>
          <CalendarDays size={14} aria-hidden />
          {shown}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="qp-content dp-pop" sideOffset={6} collisionPadding={12} align="start" aria-label={label}>
          <div className="dp-head">
            <button type="button" className="dp-nav" aria-label="Mês anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              <ChevronLeft size={15} aria-hidden />
            </button>
            <strong>{cap(month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))}</strong>
            <button type="button" className="dp-nav" aria-label="Próximo mês" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              <ChevronRight size={15} aria-hidden />
            </button>
          </div>
          <div className="dp-grid" role="grid">
            {DOW.map((d, i) => (
              <span key={i} className="dp-dow" aria-hidden>
                {d}
              </span>
            ))}
            {cells.map((d) => {
              const ymd = toYmd(d);
              return (
                <button
                  type="button"
                  key={ymd}
                  className="dp-day"
                  data-out={d.getMonth() !== month.getMonth() || undefined}
                  data-today={ymd === today || undefined}
                  aria-pressed={ymd === value}
                  aria-label={d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                  onClick={() => {
                    onChange(ymd);
                    setOpen(false);
                  }}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Hora em passos de 15 min (valor "HH:MM"), no menu do Quill. */
export function TimeSelect({ value, onChange, label, invalid }: { value: string; onChange: (v: string) => void; label: string; invalid?: boolean }) {
  const slots: string[] = [];
  for (let m = 0; m < 24 * 60; m += 15) slots.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  if (value && !slots.includes(value)) slots.push(value);
  slots.sort();
  return (
    <Select
      size="sm"
      label={label}
      value={value}
      onChange={onChange}
      className={invalid ? "qs-invalid" : ""}
      options={slots.map((s) => ({ value: s, label: s }))}
    />
  );
}
