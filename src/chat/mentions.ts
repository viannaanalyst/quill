/**
 * Menções (@) na caixa de escrever do Chat, como no Google Chat: digitar "@" abre a lista das pessoas da
 * conversa; a escolhida entra como "@Nome" no texto e, ao enviar, vira `<users/id>` (o formato que a API
 * do Chat transforma em menção de verdade).
 * Arquivo sem dependências (os testes rodam direto no Node: npm test).
 */

export interface Mentionable {
  id: string;
  name: string;
}

/** "@" sendo digitado logo antes do cursor: onde começa e o que já foi escrito depois dele. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@<>]{0,40})$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Pessoas cujo nome ou sobrenome começa com o que foi digitado (sem acento e sem maiúscula). */
export function filterPeople<T extends Mentionable>(people: T[], query: string): T[] {
  const q = fold(query);
  if (!q) return people;
  return people.filter((p) => fold(p.name).split(/\s+/).some((w) => w.startsWith(q)) || fold(p.name).startsWith(q));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Troca cada "@Nome" escolhido por `<users/id>`; o nome mais longo primeiro, e só o nome inteiro. */
export function applyMentions(text: string, picked: Mentionable[]): string {
  let out = text;
  for (const p of [...picked].sort((a, b) => b.name.length - a.name.length)) {
    out = out.replace(new RegExp(`@${escapeRe(p.name)}(?![\\p{L}\\p{N}_])`, "gu"), `<${p.id}>`);
  }
  return out;
}
