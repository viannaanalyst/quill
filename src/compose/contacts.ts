import type { AccountId } from "../inbox/types";

export interface Contact {
  id: string;
  name: string;
  email: string;
  initials: string;
  tone: "peach" | "blue" | "neutral";
  account: AccountId;
  /** grupo de pessoas (ex.: Diretoria) */
  group?: number;
  recent?: string;
  /** foto do contato no Google */
  photo?: string | null;
}

export const CONTACTS: Contact[] = [
  { id: "c1", name: "Diretoria inchurch", email: "diretoria@inchurch.com.br", initials: "", tone: "blue", account: "inchurch", group: 4 },
  { id: "c2", name: "Mariana Costa", email: "mariana.costa@inchurch.com.br", initials: "MC", tone: "peach", account: "inchurch" },
  { id: "c3", name: "Rafael Lima", email: "rafael.lima@inchurch.com.br", initials: "RL", tone: "neutral", account: "inchurch", recent: "ontem" },
  { id: "c4", name: "Rafaela Prado", email: "rafaela.prado@gmail.com", initials: "RP", tone: "blue", account: "pessoal" },
  { id: "c5", name: "Lucas Andrade", email: "lucas.andrade@icloud.com", initials: "LA", tone: "blue", account: "icloud", recent: "ontem" },
  { id: "c6", name: "Ana Beatriz Souza", email: "ana.souza@moradah.com.br", initials: "AB", tone: "peach", account: "moradah", recent: "15 nov" },
  { id: "c7", name: "Júlia Pires", email: "julia.pires@inchurch.com.br", initials: "JP", tone: "peach", account: "inchurch" },
  { id: "c8", name: "Thiago Santos", email: "thiago.santos@outlook.com", initials: "TS", tone: "neutral", account: "outlook" },
];

export const SENDER_EMAILS: Record<AccountId, string> = {
  pessoal: "voce@gmail.com",
  moradah: "projeto@gmail.com",
  inchurch: "voce@empresa.com.br",
  outlook: "voce@outlook.com",
  icloud: "voce@icloud.com",
};

export const SIGNATURES = {
  inchurch: "Gabriel Vianna\ninchurch",
  pessoal: "Gabriel Vianna",
  none: "",
} as const;
