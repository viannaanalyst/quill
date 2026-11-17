import type { Account, AgendaItem, Message } from "./types";

/* Dados de exemplo, iguais aos do desenho aprovado. Saem quando as contas de verdade entrarem. */

export const ACCOUNTS: Account[] = [
  { id: "pessoal", name: "Pessoal", provider: "Gmail", logo: "gmail", color: "var(--acc-pessoal)", unread: 21 },
  { id: "moradah", name: "Moradah", provider: "Gmail", logo: "gmail", color: "var(--acc-moradah)", unread: 9 },
  { id: "inchurch", name: "inchurch", provider: "Workspace", logo: "inchurch", color: "var(--acc-inchurch)", unread: 12 },
  { id: "outlook", name: "Outlook", provider: "Microsoft", logo: "microsoft", color: "var(--acc-outlook)", unread: 4 },
  { id: "icloud", name: "iCloud", provider: "iCloud", logo: "icloud", color: "var(--acc-icloud)", unread: 2 },
];

export const ACCOUNT_BY_ID = new Map(ACCOUNTS.map((a) => [a.id, a]));

export const MESSAGES: Message[] = [
  {
    id: "m1",
    account: "inchurch",
    from: "Mariana Costa",
    avatar: { kind: "initials", initials: "MC", tone: "peach" },
    subject: "Fechamento de outubro — números finais",
    preview:
      "Oi Gabriel, segue a planilha com os números de outubro já revisados. Ajustei as três igrejas que estavam com repasse duplicado e incluí a aba de comparação.",
    date: "09:12",
    unread: true,
    attachment: "fechamento-outubro.xlsx",
  },
  {
    id: "m2",
    account: "pessoal",
    from: "Nubank",
    avatar: { kind: "logo", logo: "nubank" },
    verified: true,
    subject: "A fatura de novembro fechou",
    preview:
      "O valor da sua fatura é R$ 2.318,40, com vencimento no dia 24. Você pode pagar pelo app ou antecipar parcelas.",
    date: "08:47",
    unread: true,
  },
  {
    id: "m3",
    account: "inchurch",
    from: "Google Agenda",
    avatar: { kind: "logo", logo: "google-calendar" },
    verified: true,
    subject: "Convite: Planejamento Q1 — qui, 19 nov, 10:00",
    preview: "Rafael Lima convidou você para um evento · Sala Paulista e Google Meet",
    date: "08:05",
    unread: true,
    invite: true,
  },
  {
    id: "m4",
    account: "moradah",
    from: "Vercel",
    avatar: { kind: "logo", logo: "vercel" },
    verified: true,
    subject: "Deploy pronto: moradah-web",
    preview:
      "Sua publicação em produção terminou em 41s. Domínio moradah.com.br, commit 8f2c1a “ajusta tela de leitura”.",
    date: "Ontem",
    unread: false,
  },
  {
    id: "m5",
    account: "icloud",
    from: "Lucas Andrade",
    avatar: { kind: "initials", initials: "LA", tone: "blue" },
    subject: "Fotos do fim de semana em Campos",
    preview: "Separei as melhores e coloquei no álbum compartilhado. As do mirante ficaram muito boas!",
    date: "Ontem",
    unread: false,
    attachment: "12 fotos",
  },
  {
    id: "m6",
    account: "moradah",
    from: "Supabase",
    avatar: { kind: "logo", logo: "supabase" },
    verified: true,
    subject: "Relatório de uso do projeto moradah-prod",
    preview: "Banco de dados em 38% do limite, 1,2 mil usuários ativos na semana e nenhum incidente.",
    date: "15 nov",
    unread: false,
  },
  {
    id: "m7",
    account: "outlook",
    from: "Microsoft",
    avatar: { kind: "logo", logo: "microsoft" },
    verified: true,
    subject: "Novo acesso à sua conta Microsoft",
    preview: "Detectamos um login a partir de um Mac em São Paulo. Se foi você, não precisa fazer nada.",
    date: "14 nov",
    unread: false,
  },
];

export const TODAY_LABEL = "Terça-feira, 17 de novembro";

export const WEEK = [
  { day: "seg", n: 16, dot: true },
  { day: "ter", n: 17, today: true },
  { day: "qua", n: 18 },
  { day: "qui", n: 19, dot: true },
  { day: "sex", n: 20 },
  { day: "sáb", n: 21 },
  { day: "dom", n: 22 },
];

export const AGENDA: AgendaItem[] = [
  { id: "e1", time: "09:30", title: "Daily do time", account: "inchurch", meta: "Meet · 30 min", icon: "video", soon: "em 10 min" },
  { id: "e2", time: "12:30", title: "Almoço com o Lucas", account: "icloud", meta: "Mercado de Pinheiros", icon: "map-pin" },
  { id: "e3", time: "15:00", title: "Gravar Reels do Moradah", account: "moradah", meta: "Estúdio · 1h30", icon: "clock" },
];

export const PENDING_INVITE = {
  title: "Planejamento Q1",
  when: "Qui, 19 nov · 10:00 – 11:30 · Sala Paulista",
  from: "De Rafael Lima · agenda inchurch",
};
