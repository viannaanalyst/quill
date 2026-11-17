import type { LogoName } from "../components/Logo";

/** Identificador de uma conta conectada. */
export type AccountId = "pessoal" | "moradah" | "inchurch" | "outlook" | "icloud";

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
