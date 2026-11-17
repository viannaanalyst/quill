/** Partes sem React do "Excluir para sempre" e do "Esvaziar lixeira" (testadas em deleteForever.test.ts). */

/** Junta os ids por conta (na ordem em que aparecem); e-mails de exemplo, sem conta, ficam de fora. */
export function groupByAccount(items: { id: string; accountEmail?: string }[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const m of items) {
    if (!m.accountEmail) continue;
    const list = groups.get(m.accountEmail);
    if (list) list.push(m.id);
    else groups.set(m.accountEmail, [m.id]);
  }
  return groups;
}

const n = (x: number) => x.toLocaleString("pt-BR");

export const deletedText = (count: number) => (count === 1 ? "1 e-mail excluído para sempre" : `${n(count)} e-mails excluídos para sempre`);

export const emptiedText = (count: number) =>
  count === 0 ? "A Lixeira já estava vazia" : count === 1 ? "Lixeira esvaziada: 1 e-mail excluído" : `Lixeira esvaziada: ${n(count)} e-mails excluídos`;

/** Contas cuja Lixeira será esvaziada: todas, ou só a do filtro (se ainda estiver conectada). */
export function trashAccounts(connected: string[], filter: string): string[] {
  return filter === "all" ? connected : connected.filter((e) => e === filter);
}

/** Texto da confirmação de "Excluir para sempre" (não tem volta). */
export function deleteForeverConfirm(count: number) {
  return count === 1
    ? { title: "Excluir este e-mail para sempre?", text: "Ele some de vez da sua conta. Não dá para desfazer nem recuperar depois.", action: "Excluir para sempre" }
    : { title: `Excluir ${n(count)} e-mails para sempre?`, text: "Eles somem de vez da sua conta. Não dá para desfazer nem recuperar depois.", action: "Excluir para sempre" };
}
