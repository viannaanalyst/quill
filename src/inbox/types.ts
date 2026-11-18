import type { LogoName } from "../components/Logo";

/** Identificador de uma conta: apelido nos dados de exemplo ("pessoal"…) ou o e-mail nas contas reais. */
export type AccountId = string;

export interface Account {
  id: AccountId;
  /** apelido mostrado no app */
  name: string;
  /** serviço (Gmail, Workspace…) */
  provider: string;
  logo: LogoName;
  /** variável CSS com a cor da conta */
  color: string;
  unread: number;
}

export type Avatar =
  | { kind: "initials"; initials: string; tone: "peach" | "blue" | "neutral" }
  | { kind: "logo"; logo: LogoName };

export interface Message {
  id: string;
  account: AccountId;
  from: string;
  avatar: Avatar;
  verified?: boolean;
  subject: string;
  preview: string;
  /** texto já formatado ("09:12", "Ontem", "15 nov") */
  date: string;
  unread: boolean;
  attachment?: string;
  /** convite de agenda dentro do e-mail */
  invite?: boolean;
  /** só nos e-mails reais: e-mail da conta e data em milissegundos (para ordenar) */
  accountEmail?: string;
  internalDate?: number;
  fromEmail?: string;
  /** destinatário (Enviados e Rascunhos) */
  toName?: string;
  toEmail?: string;
  /** todos do Para e do Cc, e o Reply-To (para Responder e Responder a todos) */
  recipients?: { name: string; email: string }[];
  cc?: { name: string; email: string }[];
  replyTo?: { name: string; email: string } | null;
  threadId?: string;
  starred?: boolean;
}

export interface AgendaItem {
  id: string;
  time: string;
  title: string;
  account: AccountId;
  meta: string;
  icon: "video" | "map-pin" | "clock";
  /** ex.: "em 10 min" */
  soon?: string;
}

export type Rsvp = "accepted" | "maybe" | "declined";
