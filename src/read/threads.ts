/* Conversas de exemplo para a tela de leitura. */

export type AttachmentKind = "sheet" | "pdf" | "image" | "file";

export interface Attachment {
  name: string;
  kind: AttachmentKind;
  size: string;
  mime?: string;
  /** anexo real no Gmail (baixado só quando a pessoa pede) */
  remote?: { email: string; messageId: string; id: string };
}

export interface EarlierMessage {
  who: string;
  initials: string;
  tone: "peach" | "blue" | "neutral";
  text: string;
  date: string;
}

export interface Thread {
  email: string;
  to: string;
  date: string;
  labels: string[];
  earlier: EarlierMessage[];
  body: string[];
  attachments: Attachment[];
  senderRole: string;
  history: { subject: string; date: string }[];
  /** e-mail cita a reunião do convite pendente */
  mentionsMeeting?: boolean;
}

export const THREADS: Record<string, Thread> = {
  m1: {
    email: "mariana.costa@inchurch.com.br",
    to: "para mim · cc Rafael Lima",
    date: "Hoje, 09:12",
    labels: ["Fechamentos"],
    earlier: [
      {
        who: "Você",
        initials: "GV",
        tone: "blue",
        text: "Mariana, pode me mandar a versão final quando fechar? Quero revisar antes de quinta.",
        date: "14 nov",
      },
      {
        who: "Rafael Lima",
        initials: "RL",
        tone: "neutral",
        text: "Inclui também a igreja de Campinas no comparativo, por favor. Ela entrou no meio do mês.",
        date: "15 nov",
      },
    ],
    body: [
      "Oi Gabriel, tudo bem?",
      "Segue a planilha com os números de outubro já revisados. Ajustei as três igrejas que estavam com repasse duplicado e incluí a aba comparando com setembro, já com Campinas.",
      "Consegue dar uma olhada antes da reunião de quinta? Se estiver tudo certo, já mando o resumo para a diretoria.",
      "Obrigada!\nMariana",
    ],
    attachments: [
      { name: "fechamento-outubro-2026.xlsx", kind: "sheet", size: "284 KB" },
      { name: "resumo-diretoria.pdf", kind: "pdf", size: "1,2 MB" },
    ],
    senderRole: "Financeiro · inchurch",
    history: [
      { subject: "Fechamento de setembro", date: "14 out" },
      { subject: "Dúvida sobre repasses", date: "2 out" },
      { subject: "Planilha de metas 2027", date: "28 set" },
    ],
    mentionsMeeting: true,
  },
};
