/**
 * Quem recebe a resposta, como no Gmail:
 * - Responder: vai para quem mandou (ou para o Reply-To). Se foi você quem mandou, vai para quem estava no Para.
 * - Responder a todos: também entra todo mundo do Para e do Cc, menos você, sem repetir.
 * Arquivo sem dependências (os testes rodam direto no Node: npm test).
 */

export interface Person {
  name: string;
  email: string;
}

export interface ReplySource {
  from: Person;
  recipients: Person[];
  cc: Person[];
  replyTo?: Person | null;
}

const key = (p: Person) => p.email.trim().toLowerCase();

/** Tira repetidos e quem já está em `skip`, mantendo a ordem. */
function unique(list: Person[], skip: Set<string>): Person[] {
  const out: Person[] = [];
  for (const p of list) {
    const k = key(p);
    if (!k || skip.has(k)) continue;
    skip.add(k);
    out.push(p);
  }
  return out;
}

/** `mine`: endereços das contas do usuário (a resposta não volta para ele mesmo). */
export function replyRecipients(m: ReplySource, mine: string[], mode: "reply" | "replyAll"): { to: Person[]; cc: Person[] } {
  const me = new Set(mine.map((e) => e.trim().toLowerCase()));
  const fromMe = me.has(key(m.from));

  let to: Person[];
  if (fromMe) {
    // e-mail que você mandou: responde para quem recebeu (se mandou só para você, continua você)
    to = unique(m.recipients, new Set(me));
    if (!to.length) to = unique(m.recipients.length ? m.recipients : [m.from], new Set());
  } else {
    to = [m.replyTo ?? m.from];
  }
  if (mode === "reply") return { to, cc: [] };

  const taken = new Set([...me, ...to.map(key)]);
  if (!fromMe) to = [...to, ...unique(m.recipients, taken)];
  return { to, cc: unique(m.cc, taken) };
}
