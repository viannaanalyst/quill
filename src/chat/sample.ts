import type { ChatAttachmentDto, ChatMessageDto, ChatPageDto, ChatPersonDto, ChatSpaceDto } from "../lib/api";

/**
 * Conversas de exemplo da prévia do navegador (iguais ao desenho do Doop, página "Chat").
 * Nomes fictícios. Só é carregado na prévia (ADR-020).
 */

const day = (h: number, m: number, d = 17) => new Date(2026, 10, d, h, m).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

const P = (id: string, name: string): ChatPersonDto => ({ id: `users/${id}`, name, photo: null, email: null, bot: false });
const MC = P("1", "Mariana Costa");
const RL = P("2", "Rafael Lima");
const BN = P("3", "Beatriz Nogueira");
const DM = P("4", "Diego Martins");
const PR = P("5", "Paula Reis");
const FA = P("6", "Fernanda Alves");
const CM = P("7", "Carla Mendes");
const ME = P("9", "Você");

let n = 0;
function msg(space: string, sender: ChatPersonDto, ms: number, text: string, extra: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    name: `${space}/messages/${++n}`,
    text,
    formattedText: null,
    sender,
    mine: sender === ME,
    createTime: iso(ms),
    createMs: ms,
    thread: `${space}/threads/${n}`,
    threadReply: false,
    attachments: [],
    deleted: false,
    reactions: [],
    edited: false,
    ...extra,
  };
}
const att = (name: string, contentType: string): ChatAttachmentDto => ({ name, contentType, resourceName: `sample:${name}`, driveUrl: null });

const FIN = "spaces/financeiro";
function financeiro(): ChatMessageDto[] {
  const root = msg(FIN, MC, day(9, 12), "Bom dia, pessoal! Os números de outubro já estão no painel: https://painel.financeiro.app/outubro. Conferem se bate com o que vocês têm?", {
    reactions: [
      { emoji: "👍", count: 3 },
      { emoji: "🙏", count: 1 },
    ],
  });
  const thread = root.thread;
  return [
    root,
    msg(FIN, RL, day(9, 31), "Aqui bateu certinho com a planilha.", { thread, threadReply: true }),
    msg(FIN, BN, day(9, 40), "Só a linha de viagens que mudou, já ajustei.", { thread, threadReply: true }),
    msg(FIN, RL, day(10, 5), "Gravei o passo a passo do fechamento e tirei foto do quadro da reunião.", {
      attachments: [att("quadro-reuniao.jpg", "image/svg+xml"), att("passo-a-passo-fechamento.mp4", "video/mp4")],
      reactions: [{ emoji: "❤️", count: 2 }],
    }),
    msg(FIN, ME, day(10, 12), "Ficou ótimo, Rafael! Vou usar o vídeo no treinamento de sexta.", { edited: true, reactions: [{ emoji: "😂", count: 1 }] }),
    msg(FIN, ME, day(10, 12), "", { attachments: [att("audio-treinamento.m4a", "audio/wav")] }),
    msg(FIN, BN, day(10, 24), "Segue o relatório final com as observações da diretoria.", { attachments: [att("Relatório de outubro.pdf", "application/pdf")] }),
  ];
}

const others = (space: string, who: ChatPersonDto, ms: number, text: string) => [
  msg(space, ME, ms - 3_600_000, "Oi! Tudo certo por aí?"),
  msg(space, who, ms, text),
];

const PAGES: Record<string, () => ChatMessageDto[]> = {
  [FIN]: financeiro,
  "spaces/mariana": () => others("spaces/mariana", MC, day(10, 2), "Perfeito, te mando a versão final até o almoço"),
  "spaces/aurora": () => others("spaces/aurora", DM, day(9, 41), "Remarquei a revisão para quinta, 15h"),
  "spaces/rafael": () => [msg("spaces/rafael", RL, day(9, 10), "Te mandei o link da reunião."), msg("spaces/rafael", ME, day(9, 15), "Combinado, valeu!")],
};

const space = (
  name: string,
  kind: ChatSpaceDto["kind"],
  title: string,
  lastActiveMs: number,
  text: string,
  senderName: string | null,
  mine = false,
  recentMs: number[] = [],
  faces: ChatPersonDto[] = [],
  memberCount: number | null = null,
): ChatSpaceDto => ({
  name,
  kind,
  title,
  photo: null,
  email: null,
  lastActiveTime: iso(lastActiveMs),
  lastActiveMs,
  lastMessage: { text, senderName, mine, createMs: lastActiveMs },
  recentMs,
  faces,
  memberCount,
  uri: null,
});

export function sampleSpaces(): ChatSpaceDto[] {
  return [
    space(FIN, "space", "Time Financeiro", day(10, 24), "Segue o relatório final com as observações da diretoria.", "Beatriz", false, [day(10, 24), day(10, 5), day(9, 40), day(9, 31), day(9, 12)], [MC, RL, BN], 8),
    space("spaces/mariana", "dm", "Mariana Costa", day(10, 2), "Perfeito, te mando a versão final até o almoço", null, false, [day(10, 2)], [MC]),
    space("spaces/aurora", "space", "Projeto Aurora", day(9, 41), "Remarquei a revisão para quinta, 15h", "Diego", false, [day(9, 41), day(9, 30)], [DM, FA], 5),
    space("spaces/rafael", "dm", "Rafael Lima", day(9, 15), "Combinado, valeu!", null, true, [day(9, 10)], [RL]),
    space("spaces/beatriz", "dm", "Beatriz Nogueira", day(18, 20, 16), "Anexo: audio.m4a", null, false, [], [BN]),
    space("spaces/comunicacao", "group", "Comunicação Interna", day(16, 5, 16), "A arte do evento foi aprovada", "Paula", false, [], [PR, CM, MC], 4),
    space("spaces/diego", "dm", "Diego Martins", day(11, 0, 16), "Anexo: foto.jpg", null, false, [], [DM]),
    space("spaces/suporte", "space", "Suporte Onboarding", day(15, 0, 14), "Obrigada pelo retorno rápido!", "Fernanda", false, [], [], 12),
    space("spaces/carla", "dm", "Carla Mendes", day(17, 30, 13), "Te envio o contrato amanhã", null, true, [], [CM]),
  ].toSorted((a, b) => b.lastActiveMs - a.lastActiveMs);
}

/** Visto até: deixa Time Financeiro com 3, Mariana com 1 e Projeto Aurora com 2 não lidas (como no desenho). */
export function sampleSeen(account: string): Record<string, number> {
  const seen: Record<string, number> = {};
  for (const s of sampleSpaces()) seen[`${account}|${s.name}`] = s.lastActiveMs;
  seen[`${account}|${FIN}`] = day(9, 35);
  seen[`${account}|spaces/mariana`] = day(9, 0);
  seen[`${account}|spaces/aurora`] = day(9, 0);
  return seen;
}

export const samplePinned = (account: string) => [`${account}|${FIN}`, `${account}|spaces/mariana`];

/** Páginas guardadas: os nomes das mensagens ficam iguais e editar/apagar/reagir na prévia não se perde ao atualizar. */
const cache = new Map<string, ChatMessageDto[]>();
const pageOf = (space: string) => {
  if (!cache.has(space)) cache.set(space, PAGES[space]?.() ?? []);
  return cache.get(space)!;
};

export function samplePage(space: string): ChatPageDto {
  return { messages: pageOf(space), nextPageToken: null };
}

/** Reações que "você" já fez nas mensagens de exemplo (o 👍 da Mariana conta você). */
export function sampleReacted(account: string): Record<string, string[]> {
  const root = pageOf(FIN)[0];
  return { [`${account}|${root.name}`]: ["👍"] };
}

const change = (space: string, name: string, f: (m: ChatMessageDto) => ChatMessageDto | null) =>
  cache.set(space, pageOf(space).flatMap((m) => (m.name === name ? (f(m) ?? []) : [m])));

/** Prévia: edita, apaga ou reage numa mensagem de exemplo. */
export function sampleEdit(space: string, name: string, text: string): ChatMessageDto {
  let out: ChatMessageDto | null = null;
  change(space, name, (m) => (out = { ...m, text, edited: true }));
  return out!;
}
export const sampleDelete = (space: string, name: string) => change(space, name, () => null);
export function sampleReact(space: string, name: string, emoji: string, add: boolean) {
  change(space, name, (m) => {
    const has = m.reactions.find((r) => r.emoji === emoji);
    const reactions = add
      ? has
        ? m.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1 } : r))
        : [...m.reactions, { emoji, count: 1 }]
      : m.reactions.flatMap((r) => (r.emoji !== emoji ? [r] : r.count > 1 ? [{ ...r, count: r.count - 1 }] : []));
    return { ...m, reactions };
  });
}

export function sampleMembers(space: string): ChatPersonDto[] {
  if (space !== FIN) return [];
  return [MC, RL, BN, DM, PR, FA, CM, { ...ME, name: "Você", email: "voce@empresa.com.br" }];
}

/** Mensagem "enviada" na prévia. */
export function sampleSent(space: string, text: string, thread: string | null, attachments: ChatAttachmentDto[]): ChatMessageDto {
  const m = msg(space, ME, Date.now(), text, { attachments, thread: thread ?? undefined, threadReply: !!thread });
  cache.set(space, [...pageOf(space), m]);
  return m;
}

/* ---------- conteúdo dos anexos de exemplo ---------- */
const BOARD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140"><defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9EEF3"/><stop offset="1" stop-color="#D3DCE5"/></linearGradient></defs><rect width="240" height="140" fill="url(#w)"/><rect x="20" y="12" width="200" height="106" rx="4" fill="#FFF" stroke="#B7C0CA" stroke-width="3"/><path d="M34 28h52M34 36h34" stroke="#3E6E99" stroke-width="2.4" stroke-linecap="round"/><g transform="rotate(-4 56 66)"><rect x="38" y="48" width="34" height="32" rx="2" fill="#F6DD7A"/><path d="M43 57h22M43 63h16" stroke="#9C8432" stroke-width="1.6" stroke-linecap="round"/></g><g transform="rotate(3 96 66)"><rect x="80" y="50" width="34" height="32" rx="2" fill="#F4BCC6"/><path d="M85 59h22M85 65h14" stroke="#A35E6B" stroke-width="1.6" stroke-linecap="round"/></g><g transform="rotate(-2 60 100)"><rect x="44" y="86" width="32" height="26" rx="2" fill="#BCD6EE"/><path d="M49 94h20M49 100h12" stroke="#4F7499" stroke-width="1.6" stroke-linecap="round"/></g><g transform="rotate(5 100 100)"><rect x="86" y="88" width="30" height="24" rx="2" fill="#CFE3C4"/><path d="M91 96h18" stroke="#5F7F57" stroke-width="1.6" stroke-linecap="round"/></g><path d="M134 100V40M134 100h72" stroke="#7D8794" stroke-width="2" stroke-linecap="round"/><path d="M140 92l16-14 14 8 22-30" fill="none" stroke="#6F9068" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="192" cy="56" r="3.2" fill="#C2453D"/><path d="M150 34h40" stroke="#C2453D" stroke-width="2.2" stroke-linecap="round"/><rect x="70" y="118" width="100" height="6" rx="2" fill="#A9B3BE"/><rect x="82" y="114" width="20" height="5" rx="2" fill="#3E6E99"/><rect x="108" y="114" width="20" height="5" rx="2" fill="#C2453D"/></svg>`;
const SCREEN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140"><defs><linearGradient id="v" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#33465A"/><stop offset="1" stop-color="#18212B"/></linearGradient></defs><rect width="240" height="140" fill="url(#v)"/><rect x="26" y="16" width="188" height="110" rx="7" fill="#F6F7F9"/><rect x="26" y="16" width="188" height="14" rx="7" fill="#E4E7EB"/><rect x="26" y="24" width="188" height="6" fill="#E4E7EB"/><circle cx="35" cy="23" r="2" fill="#FF5F57"/><circle cx="42" cy="23" r="2" fill="#FEBC2E"/><circle cx="49" cy="23" r="2" fill="#28C840"/><rect x="34" y="38" width="38" height="80" rx="4" fill="#E9EDF2"/><path d="M40 47h24M40 55h18M40 63h22M40 71h16" stroke="#B4BDC8" stroke-width="2.4" stroke-linecap="round"/><rect x="80" y="38" width="58" height="26" rx="4" fill="#FFF" stroke="#E1E5EA"/><rect x="146" y="38" width="60" height="26" rx="4" fill="#FFF" stroke="#E1E5EA"/><path d="M86 47h20" stroke="#B4BDC8" stroke-width="2" stroke-linecap="round"/><path d="M86 56h32" stroke="#4F86B5" stroke-width="3" stroke-linecap="round"/><path d="M152 47h20" stroke="#B4BDC8" stroke-width="2" stroke-linecap="round"/><path d="M152 56h28" stroke="#6F9068" stroke-width="3" stroke-linecap="round"/><rect x="80" y="70" width="126" height="48" rx="4" fill="#FFF" stroke="#E1E5EA"/><g fill="#8FB3D3"><rect x="90" y="96" width="9" height="16" rx="1.5"/><rect x="104" y="88" width="9" height="24" rx="1.5"/><rect x="118" y="92" width="9" height="20" rx="1.5"/><rect x="132" y="82" width="9" height="30" rx="1.5"/><rect x="146" y="86" width="9" height="26" rx="1.5"/></g><g fill="#4F86B5"><rect x="160" y="78" width="9" height="34" rx="1.5"/><rect x="174" y="84" width="9" height="28" rx="1.5"/><rect x="188" y="76" width="9" height="36" rx="1.5"/></g></svg>`;

/** Áudio de exemplo: 42 s de um tom baixo (WAV, 8 kHz). */
function sampleWav(seconds = 42): Blob {
  const rate = 8000;
  const len = rate * seconds;
  const buf = new ArrayBuffer(44 + len);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + len, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, "data");
  v.setUint32(40, len, true);
  for (let i = 0; i < len; i++) v.setUint8(44 + i, 128 + Math.round(10 * Math.sin((i / rate) * 2 * Math.PI * 220) * (0.5 + 0.5 * Math.sin(i / 4000))));
  return new Blob([buf], { type: "audio/wav" });
}

/** PDF mínimo de uma página com o título. */
function samplePdf(title: string): Blob {
  const content = `BT /F1 20 Tf 60 760 Td (${title}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

export function sampleBlob(resource: string, type: string): Blob {
  if (resource.endsWith(".jpg")) return new Blob([BOARD], { type: "image/svg+xml" });
  // a prévia não tem vídeo de verdade: mostra a imagem da tela gravada e a duração do desenho
  if (resource.endsWith(".mp4")) return new Blob([SCREEN], { type: "image/svg+xml" });
  if (resource.endsWith(".m4a")) return sampleWav();
  if (resource.endsWith(".pdf")) return samplePdf("Relatorio de outubro");
  return new Blob([""], { type });
}

/** Duração do vídeo de exemplo (a prévia não tem o vídeo de verdade). */
export const SAMPLE_VIDEO_SECONDS = 84;
