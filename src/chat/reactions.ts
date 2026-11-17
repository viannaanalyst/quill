/** Reações rápidas da barra da mensagem (arquivo sem dependências: os testes rodam no Node). */

/** Reações rápidas no começo (até você usar outras mais vezes). */
export const DEFAULT_QUICK = ["✅", "🫡", "🤣"];

/** As 3 reações que você mais usa; empate fica na ordem das iniciais (e depois na ordem do primeiro uso). */
export function quickReactions(use: Record<string, number>): string[] {
  const all = [...new Set([...DEFAULT_QUICK, ...Object.keys(use)])];
  const rank = (e: string) => (DEFAULT_QUICK.includes(e) ? DEFAULT_QUICK.indexOf(e) : DEFAULT_QUICK.length);
  return all.toSorted((a, b) => (use[b] ?? 0) - (use[a] ?? 0) || rank(a) - rank(b)).slice(0, 3);
}
