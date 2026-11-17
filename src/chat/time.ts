/**
 * Horário ao lado do nome de quem escreveu, como o Google Chat mostra:
 * hoje só a hora ("11:00"); outro dia "5 de nov., 11:00"; outro ano "5 de nov. de 2025, 11:00".
 * Montado à mão (sem Intl) para sair igual em qualquer sistema.
 */
const MONTHS = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

const two = (n: number) => String(n).padStart(2, "0");

export function stampLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const t = new Date(now);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (d.toDateString() === t.toDateString()) return time;
  const day = `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === t.getFullYear() ? `${day}, ${time}` : `${day} de ${d.getFullYear()}, ${time}`;
}
