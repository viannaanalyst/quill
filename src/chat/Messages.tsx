import * as Popover from "@radix-ui/react-popover";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import SmilePlus from "lucide-react/icons/smile-plus";
import EllipsisVertical from "lucide-react/icons/ellipsis-vertical";
import Copy from "lucide-react/icons/copy";
import MessageSquareReply from "lucide-react/icons/message-square-reply";
import TextQuote from "lucide-react/icons/text-quote";
import { api, friendlyError, type ChatAttachmentDto, type ChatMessageDto, type ChatQuoteDto } from "../lib/api";
import { isTauri } from "../lib/platform";
import { FILE_LABEL, fileSize, fileType } from "../lib/files";
import { FileIcon } from "../components/FileIcon";
import { AccountPhoto } from "../components/MyAvatar";
import { previewAttachment } from "../components/AttachmentPreview";
import { toast } from "../components/Toasts";
import { askConfirm } from "../components/ConfirmHost";
import { Check, Download, ExternalLink, Eye, Hash, LoaderCircle, Maximize2, Pause, Pencil, Play, Reply, RotateCcw, Trash2, Users, Video, X } from "../components/icons";
import { EMOJIS, emojiName } from "../lib/emojis";
import { deleteMessage, discardOutgoing, editMessage, quickReactions, retryOutgoing, toggleReaction, useChat, type Outgoing, type PendingFile } from "../state/chat";
import { stampLabel } from "./time";
import type { ChatPersonDto, ChatSpaceDto } from "../lib/api";
import { ChatBlocks, ChatText, openLink } from "./chatText";
import { NotoEmoji, useHoverPlay } from "./Emoji";
import { emojiOnly, parseChat, plainChat } from "./format";
import { blobToBase64, clock, kindOf, loadAttachment, waveOf } from "./media";

/* ---------- avatar ---------- */
const TONES = ["peach", "blue", "lilac", "sage"] as const;
export function toneOf(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return TONES[Math.abs(h) % TONES.length];
}
export function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts.at(-1)![0] : (parts[0]?.[1] ?? ""))).toUpperCase();
}

export function ChatAvatar({
  name,
  photo,
  size = 40,
  square,
  icon,
  seed,
  me,
}: {
  name: string;
  photo?: string | null;
  size?: number;
  square?: boolean;
  icon?: ReactNode;
  seed?: string;
  /** e-mail da própria conta: usa a foto do Quill (a escolhida pela pessoa ou a do Google) */
  me?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (me) return <AccountPhoto email={me} size={size} className="chat-av is-me" />;
  const cls = `chat-av chat-${toneOf(seed ?? name)}${square ? " is-square" : ""}`;
  const style = { width: size, height: size, fontSize: size * 0.34 };
  if (photo && !broken) return <img className={cls} style={style} src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  return (
    <span className={cls} style={style} aria-hidden>
      {icon ?? initials(name)}
    </span>
  );
}

/** Pessoa da conversa: a própria conta usa o AccountPhoto. */
export function PersonAvatar({ p, account, size }: { p: ChatPersonDto; account: string; size: number }) {
  const mine = p.name === "Você" && p.email === account;
  return <ChatAvatar name={p.name} photo={p.photo} size={size} seed={p.id} me={mine ? account : undefined} />;
}

/** Fotos empilhadas (2 ou 3), para espaços e grupos: a API do Chat não tem ícone de espaço. */
export function FaceStack({ faces, size = 40 }: { faces: ChatPersonDto[]; size?: number }) {
  const list = faces.slice(0, 3);
  const small = Math.round(size * (list.length > 2 ? 0.6 : 0.68));
  return (
    <span className={`chat-faces n${list.length}`} style={{ width: size, height: size }} aria-hidden>
      {list.map((p) => (
        <ChatAvatar key={p.id} name={p.name} photo={p.photo} size={small} seed={p.id} />
      ))}
    </span>
  );
}

/** Ícone da conversa: foto da pessoa (direta), fotos empilhadas (espaço/grupo) ou # quando não dá para saber quem está. */
export function SpaceIcon({ s, size = 40 }: { s: ChatSpaceDto; size?: number }) {
  if (s.kind === "dm") return <ChatAvatar name={s.title} photo={s.photo ?? s.faces[0]?.photo} size={size} seed={s.faces[0]?.id ?? s.name} />;
  if (s.faces.length >= 2) return <FaceStack faces={s.faces} size={size} />;
  if (s.faces.length === 1 && s.kind === "group") return <ChatAvatar name={s.faces[0].name} photo={s.faces[0].photo} size={size} seed={s.faces[0].id} />;
  return <ChatAvatar name={s.title} size={size} square seed={s.name} icon={s.kind === "group" ? <Users size={size * 0.47} /> : <Hash size={size * 0.47} />} />;
}

/* ---------- datas ---------- */
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
export const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
/** Data e hora completas (só para o leitor de tela, na barra de ações da mensagem). */
export const fullDate = (ms: number) => new Date(ms).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
function dayLabel(ms: number, now: number) {
  if (sameDay(ms, now)) return "Hoje";
  if (sameDay(ms, now - 86_400_000)) return "Ontem";
  return new Date(ms).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}

/* ---------- anexos ---------- */
/** Carrega o anexo quando ele aparece na tela. */
function useVisibleBlob(account: string, a: ChatAttachmentDto) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      loadAttachment(account, a)
        .then((b) => alive && setBlob(b))
        .catch((e) => alive && setError(friendlyError(e)));
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [account, a]);
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return { ref, blob, url, error };
}

async function download(account: string, a: ChatAttachmentDto) {
  if (!a.resourceName) return;
  if (!isTauri) {
    toast(`Prévia: salvaria ${a.name} em Downloads`);
    return;
  }
  try {
    const path = await api.chatAttachmentSave(account, a.resourceName, a.name, "save");
    toast(`Salvo em Downloads: ${path.split("/").pop()}`);
  } catch (e) {
    toast(`Não consegui baixar: ${friendlyError(e)}`, "error");
  }
}

function openPreview(account: string, a: ChatAttachmentDto) {
  previewAttachment({
    name: a.name,
    mime: a.contentType ?? undefined,
    load: async () => blobToBase64(await loadAttachment(account, a)),
    onDownload: () => void download(account, a),
  });
}

function ImageThumb({ account, a }: { account: string; a: ChatAttachmentDto }) {
  const { ref, url, error } = useVisibleBlob(account, a);
  return (
    <div className="chat-ph" ref={ref}>
      {url ? (
        <button type="button" className="chat-ph-btn" onClick={() => openPreview(account, a)} aria-label={`Ampliar ${a.name}`}>
          <img src={url} alt={a.name} />
        </button>
      ) : (
        <span className="chat-ph-wait">{error ? "Não abriu" : <LoaderCircle size={18} className="spinning" aria-label="Carregando" />}</span>
      )}
    </div>
  );
}

function VideoTile({ account, a }: { account: string; a: ChatAttachmentDto }) {
  const { ref, blob, url, error } = useVisibleBlob(account, a);
  const [dur, setDur] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const isPoster = blob?.type.startsWith("image/"); // prévia: imagem no lugar do vídeo
  useEffect(() => {
    if (isPoster) void import("./sample").then((s) => setDur(s.SAMPLE_VIDEO_SECONDS));
  }, [isPoster]);
  const enlarge = (
    <button type="button" className="chat-enlarge" data-tip="Ampliar" aria-label={`Ampliar ${a.name}`} onClick={() => openPreview(account, a)}>
      <Maximize2 size={13} aria-hidden />
    </button>
  );
  if (playing && url && !isPoster) {
    return (
      <div className="chat-ph is-playing" ref={ref}>
        <video src={url} controls autoPlay playsInline />
        {enlarge}
      </div>
    );
  }
  return (
    <div className="chat-ph is-video" ref={ref}>
      {url && (isPoster ? <img src={url} alt="" /> : <video src={url} preload="metadata" muted playsInline onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} />)}
      {error ? (
        <span className="chat-ph-wait">
          Não abriu
          <button type="button" className="btn glass sm" onClick={() => void download(account, a)}>
            <Download size={14} aria-hidden />
            Baixar
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="chat-play"
          disabled={!url}
          aria-label={`Assistir ${a.name}`}
          onClick={() => (isPoster ? openPreview(account, a) : setPlaying(true))}
        >
          {url ? <Play size={18} aria-hidden /> : <LoaderCircle size={18} className="spinning" aria-hidden />}
        </button>
      )}
      {url && enlarge}
      {dur != null && Number.isFinite(dur) && (
        <span className="chat-dur">
          <Video size={12} aria-hidden />
          {clock(dur)}
        </span>
      )}
    </div>
  );
}

const SPEEDS = [1, 1.5, 2] as const;
const speedLabel = (r: number) => `${String(r).replace(".", ",")}x`;

/**
 * Mensagem de voz, como no Google Chat: play/pausa redondo, ondinha que vai enchendo enquanto toca
 * (clicar ou as setas pulam), tempo e velocidade 1x/1,5x/2x. O <audio> fica escondido (sem os controles do sistema).
 */
export function AudioPlayer({ src, seed, mine, onError, speed = true }: { src: string | null; seed: string; mine?: boolean; onError?: string | null; speed?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [pos, setPos] = useState(0);
  const [rate, setRate] = useState<number>(1);
  const bars = useMemo(() => waveOf(seed), [seed]);
  const frac = dur > 0 ? Math.min(1, pos / dur) : 0;
  const played = Math.floor(frac * bars.length);

  const fixDuration = (el: HTMLAudioElement) => {
    // áudio gravado em webm vem sem duração: pula para o fim uma vez para o navegador descobrir
    if (el.duration === Infinity) {
      el.currentTime = 1e9;
      el.ontimeupdate = () => {
        el.ontimeupdate = null;
        setDur(el.duration);
        el.currentTime = 0;
      };
    } else setDur(el.duration);
  };
  const seek = (frac: number) => {
    const el = audio.current;
    if (!el || !dur) return;
    el.currentTime = Math.max(0, Math.min(dur, frac * dur));
    setPos(el.currentTime);
  };
  const nextRate = () => {
    const r = SPEEDS[(SPEEDS.indexOf(rate as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
    setRate(r);
    if (audio.current) audio.current.playbackRate = r;
  };
  const started = playing || pos > 0;

  return (
    <div className={`chat-aud${mine ? " is-mine" : ""}${playing ? " is-playing" : ""}`}>
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => {
            e.currentTarget.playbackRate = rate;
            fixDuration(e.currentTarget);
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
        />
      )}
      <button
        type="button"
        className="btn solid ic chat-aud-btn"
        disabled={!src}
        aria-label={playing ? "Pausar áudio" : "Ouvir áudio"}
        data-tip={playing ? "Pausar" : "Ouvir"}
        onClick={() => {
          const el = audio.current;
          if (!el) return;
          if (el.paused) void el.play();
          else el.pause();
        }}
      >
        {!src && !onError ? <LoaderCircle size={15} className="spinning" aria-hidden /> : playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
      </button>
      <div
        className="chat-wave"
        role="slider"
        tabIndex={src ? 0 : -1}
        aria-label="Posição do áudio"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={`${clock(pos)} de ${clock(dur)}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          seek((e.clientX - r.left) / r.width);
        }}
        onKeyDown={(e) => {
          const to = e.key === "ArrowRight" ? pos + 5 : e.key === "ArrowLeft" ? pos - 5 : e.key === "Home" ? 0 : e.key === "End" ? dur : null;
          if (to == null) return;
          e.preventDefault();
          seek(to / (dur || 1));
        }}
      >
        {bars.map((h, i) => (
          <i key={i} className={i < played ? "is-p" : i === played && started ? "is-now" : undefined} style={{ height: h }} />
        ))}
      </div>
      <span className="chat-adur">
        {onError ? (
          "Não abriu"
        ) : started ? (
          <>
            {clock(pos)}
            <span className="chat-adur-of"> / {clock(dur)}</span>
          </>
        ) : (
          clock(dur)
        )}
      </span>
      {speed && !onError && (
        <button type="button" className="chat-aud-rate" disabled={!src} aria-label={`Velocidade: ${speedLabel(rate)}. Mudar`} data-tip="Velocidade" onClick={nextRate}>
          {speedLabel(rate)}
        </button>
      )}
    </div>
  );
}

function AudioAttachment({ account, a, mine }: { account: string; a: ChatAttachmentDto; mine: boolean }) {
  const { ref, url, error } = useVisibleBlob(account, a);
  return (
    <div ref={ref} className={mine ? "chat-bub is-mine chat-bub-aud" : "chat-aud-wrap"}>
      <AudioPlayer src={url} seed={a.resourceName ?? a.name} mine={mine} onError={error} />
    </div>
  );
}

const CAN_PREVIEW = new Set(["image", "pdf", "text", "code", "video", "audio"]);

function FileCard({ account, a }: { account: string; a: ChatAttachmentDto }) {
  const type = fileType(a.name, a.contentType ?? "");
  if (a.driveUrl) {
    return (
      <div className="chat-file">
        <FileIcon name={a.name} mime={a.contentType ?? undefined} size={36} />
        <div className="chat-file-info">
          <div className="chat-fn">{a.name}</div>
          <div className="chat-fm">Google Drive</div>
        </div>
        <button type="button" className="btn glass sm" onClick={() => openLink(a.driveUrl!)}>
          <ExternalLink size={14} aria-hidden />
          Abrir no Drive
        </button>
      </div>
    );
  }
  return (
    <div className="chat-file">
      <FileIcon name={a.name} mime={a.contentType ?? undefined} size={36} />
      <div className="chat-file-info">
        <div className="chat-fn">{a.name}</div>
        <div className="chat-fm">{FILE_LABEL[type]}</div>
      </div>
      {a.resourceName && CAN_PREVIEW.has(type) && (
        <button type="button" className="btn glass sm" onClick={() => openPreview(account, a)}>
          <Eye size={14} aria-hidden />
          Ver
        </button>
      )}
      {a.resourceName && (
        <button type="button" className="btn glass sm" onClick={() => void download(account, a)}>
          <Download size={14} aria-hidden />
          Baixar
        </button>
      )}
    </div>
  );
}

function Attachments({ account, list, mine }: { account: string; list: ChatAttachmentDto[]; mine: boolean }) {
  if (list.length === 0) return null;
  const media = list.filter((a) => !a.driveUrl && a.resourceName && (kindOf(a) === "image" || kindOf(a) === "video"));
  const audio = list.filter((a) => !a.driveUrl && a.resourceName && kindOf(a) === "audio");
  const files = list.filter((a) => !media.includes(a) && !audio.includes(a));
  return (
    <>
      {media.length > 0 && (
        <div className="chat-media">
          {media.map((a, i) => (kindOf(a) === "image" ? <ImageThumb key={i} account={account} a={a} /> : <VideoTile key={i} account={account} a={a} />))}
        </div>
      )}
      {audio.map((a, i) => (
        <AudioAttachment key={i} account={account} a={a} mine={mine} />
      ))}
      {files.map((a, i) => (
        <FileCard key={i} account={account} a={a} />
      ))}
    </>
  );
}

/* ---------- mensagens ---------- */
/** O que as mensagens da lista compartilham (evita passar tudo de mão em mão). */
interface ListContext {
  account: string;
  space: string;
  now: number;
  /** link da conversa no Google Chat */
  uri: string;
  /** mensagens carregadas, pelo nome (para a citação) */
  byName: Map<string, ChatMessageDto>;
  /** id → nome de quem aparece na conversa (menções sem nome) */
  people: Map<string, string>;
  /** id da própria conta no Chat (menção a você fica destacada) */
  myId: string | null;
  editing: string | null;
  onEdit: (name: string | null) => void;
  /** responder no fio: abre as respostas e foca a caixa de escrever */
  reply: (m: ChatMessageDto) => void;
  /** citar na resposta: o cartão aparece na caixa de escrever */
  quote: (m: ChatMessageDto) => void;
  openThreads: Set<string>;
  toggleThread: (thread: string) => void;
  /** rola até a mensagem citada (abre o fio se ela for uma resposta) */
  jumpTo: (name: string) => void;
}
const ListCtx = createContext<ListContext | null>(null);
const useList = () => useContext(ListCtx)!;

/** Nomes dos emojis rápidos que não estão na grade (para o leitor de tela). */
const EXTRA_NAMES: Record<string, string> = { "🫡": "Continência", "🤣": "Rolando de rir" };
const nameOfEmoji = (e: string) => EXTRA_NAMES[e] ?? emojiName(e);

/** Emojis com que você reagiu nesta mensagem (guardados no app: a API só diz a contagem). */
function useMine(m: ChatMessageDto): string[] {
  const raw = useChat((s) => s.reacted[`${s.account ?? ""}|${m.name}`]);
  return useMemo(() => (raw ?? []).filter((e) => m.reactions.some((r) => r.emoji === e)), [raw, m.reactions]);
}

/** Chips das reações (😀 3) abaixo do balão; o seu fica destacado e clicar nele tira a sua reação. */
function Reactions({ space, m }: { space: string; m: ChatMessageDto }) {
  const mine = useMine(m);
  if (m.deleted || m.reactions.length === 0) return null;
  return (
    <div className="chat-rxs" role="group" aria-label="Reações">
      {m.reactions.map((r) => {
        if (r.image) {
          // emoji próprio da empresa: a API não deixa reagir com ele pelo nome
          return (
            <span key={r.emoji} className="chat-rx is-custom" role="img" aria-label={`${r.emoji}: ${r.count} ${r.count === 1 ? "reação" : "reações"}`}>
              <img className="chat-cemo" src={r.image} alt="" referrerPolicy="no-referrer" />
              <span className="chat-rx-n" aria-hidden>
                {r.count}
              </span>
            </span>
          );
        }
        const isMine = mine.includes(r.emoji);
        return <ReactionChip key={r.emoji} space={space} m={m} emoji={r.emoji} count={r.count} isMine={isMine} />;
      })}
    </div>
  );
}

/** Chip de uma reação: emoji do Google parado, animando com o mouse em cima. */
function ReactionChip({ space, m, emoji, count, isMine }: { space: string; m: ChatMessageDto; emoji: string; count: number; isMine: boolean }) {
  const [playing, hover] = useHoverPlay();
  return (
    <button
      type="button"
      className={`chat-rx${isMine ? " is-mine" : ""}`}
      aria-pressed={isMine}
      aria-label={`${nameOfEmoji(emoji)}: ${count} ${count === 1 ? "reação" : "reações"}${isMine ? ", uma é sua" : ""}`}
      data-tip={isMine ? "Tirar sua reação" : `Reagir com ${emoji}`}
      onClick={() => void toggleReaction(space, m, emoji)}
      {...hover}
    >
      <span className="chat-rx-e" aria-hidden>
        <NotoEmoji emoji={emoji} animate="hover" playing={playing} />
      </span>
      <span className="chat-rx-n" aria-hidden>
        {count}
      </span>
    </button>
  );
}

/** Reação rápida da barra da mensagem (emoji do Google, anima com o mouse em cima). */
function QuickEmoji({ emoji, on, tabIndex, onFocus, onClick }: { emoji: string; on: boolean; tabIndex: number; onFocus: () => void; onClick: () => void }) {
  const [playing, hover] = useHoverPlay();
  return (
    <button
      type="button"
      data-bar
      tabIndex={tabIndex}
      className={`chat-bar-btn chat-bar-emo${on ? " is-mine" : ""}`}
      aria-pressed={on}
      aria-label={`${on ? "Tirar reação" : "Reagir com"} ${nameOfEmoji(emoji)}`}
      data-tip={on ? "Tirar sua reação" : nameOfEmoji(emoji)}
      onFocus={onFocus}
      onClick={onClick}
      {...hover}
    >
      <NotoEmoji emoji={emoji} animate="hover" playing={playing} />
    </button>
  );
}

/**
 * Barra que aparece ao passar o mouse (ou com Tab) no canto de cima da mensagem, como a do Google Chat:
 * 3 reações rápidas (as que você mais usa), adicionar reação, responder no fio e ⋮ (editar, copiar,
 * abrir no Google Chat, apagar). Um só ponto de Tab; as setas andam entre os botões.
 */
function MessageBar({ m }: { m: ChatMessageDto }) {
  const ctx = useList();
  const use = useChat((s) => s.reactionUse);
  const quick = useMemo(() => quickReactions(use), [use]);
  const mine = useMine(m);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [active, setActive] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const text = m.formattedText || m.text;
  const who = m.mine ? "sua mensagem" : `mensagem de ${m.sender.name}`;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const btns = [...(bar.current?.querySelectorAll<HTMLButtonElement>("[data-bar]") ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = e.key === "ArrowRight" ? (i + 1) % btns.length : e.key === "ArrowLeft" ? (i - 1 + btns.length) % btns.length : e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    btns[next].focus();
  };
  const tab = (i: number) => (i === active ? 0 : -1);
  const react = (e: string) => void toggleReaction(ctx.space, m, e);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainChat(text, (id) => m.mentions?.find((x) => x.id === id)?.name ?? ctx.people.get(id)));
      toast("Texto copiado");
    } catch {
      toast("Não consegui copiar o texto.", "error");
    }
  };
  const remove = async () => {
    const ok = await askConfirm({
      title: "Apagar mensagem?",
      text: "Ela some para todas as pessoas da conversa. Não dá para desfazer.",
      action: "Apagar",
    });
    if (ok) void deleteMessage(ctx.space, m);
  };
  let n = quick.length;
  const pickerAt = n++;
  const replyAt = m.thread ? n++ : -1;
  const quoteAt = n++;
  const menuAt = n;

  return (
    <div ref={bar} className={`chat-bar${picker || menu ? " is-open" : ""}`} role="toolbar" aria-label={`Ações da ${who}, ${fullDate(m.createMs)}`} onKeyDown={onKeyDown}>
      {quick.map((e, i) => (
        <QuickEmoji key={e} emoji={e} on={mine.includes(e)} tabIndex={tab(i)} onFocus={() => setActive(i)} onClick={() => react(e)} />
      ))}
      <Popover.Root open={picker} onOpenChange={setPicker}>
        <Popover.Trigger asChild>
          <button type="button" data-bar tabIndex={tab(pickerAt)} className="chat-bar-btn" aria-label="Adicionar reação" data-tip="Adicionar reação" onFocus={() => setActive(pickerAt)}>
            <SmilePlus size={16} aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="qp-content chat-rx-pop" side="top" align="start" sideOffset={8} collisionPadding={12}>
            <div className="chat-rx-grid" role="group" aria-label="Escolha um emoji">
              {EMOJIS.map(([e, name]) => {
                const on = mine.includes(e);
                return (
                  <button
                    key={e}
                    type="button"
                    className={`chat-rx-g${on ? " is-mine" : ""}`}
                    aria-label={`${on ? "Tirar" : "Reagir com"} ${name}`}
                    aria-pressed={on}
                    onClick={() => {
                      setPicker(false);
                      react(e);
                    }}
                  >
                    <span className="chat-emo" aria-hidden>
                      {e}
                    </span>
                  </button>
                );
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {m.thread && (
        <button type="button" data-bar tabIndex={tab(replyAt)} className="chat-bar-btn" aria-label="Responder no fio" data-tip="Responder no fio" onFocus={() => setActive(replyAt)} onClick={() => ctx.reply(m)}>
          <MessageSquareReply size={16} aria-hidden />
        </button>
      )}
      <button type="button" data-bar tabIndex={tab(quoteAt)} className="chat-bar-btn" aria-label="Citar na resposta" data-tip="Citar na resposta" onFocus={() => setActive(quoteAt)} onClick={() => ctx.quote(m)}>
        <TextQuote size={16} aria-hidden />
      </button>
      <Popover.Root open={menu} onOpenChange={setMenu}>
        <Popover.Trigger asChild>
          <button type="button" data-bar tabIndex={tab(menuAt)} className="chat-bar-btn" aria-label="Mais ações da mensagem" data-tip="Mais" onFocus={() => setActive(menuAt)}>
            <EllipsisVertical size={16} aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="qp-content chat-menu" side="bottom" align="end" sideOffset={6} collisionPadding={12}>
            {m.mine && m.text && (
              <Popover.Close asChild>
                <button type="button" onClick={() => ctx.onEdit(m.name)}>
                  <Pencil size={15} aria-hidden />
                  Editar
                </button>
              </Popover.Close>
            )}
            {text && (
              <Popover.Close asChild>
                <button type="button" onClick={() => void copy()}>
                  <Copy size={15} aria-hidden />
                  Copiar texto
                </button>
              </Popover.Close>
            )}
            <Popover.Close asChild>
              <button type="button" onClick={() => openLink(ctx.uri)}>
                <ExternalLink size={15} aria-hidden />
                Abrir no Google Chat
              </button>
            </Popover.Close>
            {m.mine && (
              <Popover.Close asChild>
                <button type="button" className="chat-menu-danger" onClick={() => void remove()}>
                  <Trash2 size={15} aria-hidden />
                  Apagar
                </button>
              </Popover.Close>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/** Balão virando campo de texto: Enter salva, Shift+Enter quebra a linha, Esc cancela. */
function EditBox({ space, m, onDone }: { space: string; m: ChatMessageDto; onDone: () => void }) {
  const [text, setText] = useState(m.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    el.closest(".chat-edit")?.scrollIntoView({ block: "nearest" });
  }, []);
  // cresce com o texto (até 8 linhas; depois rola)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 8 * 21 + 18)}px`;
  }, [text]);
  const tooLong = text.length > 4096;
  const empty = !text.trim();
  const save = () => {
    if (empty || tooLong) return;
    onDone();
    void editMessage(space, m, text);
  };
  return (
    <form
      className={`chat-edit${m.mine ? " is-mine" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <textarea
        ref={ref}
        className="chat-edit-input"
        value={text}
        rows={1}
        aria-label="Editar mensagem"
        aria-invalid={tooLong || undefined}
        aria-describedby={tooLong ? `${m.name}-edit-err` : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          }
        }}
      />
      {tooLong && (
        <span id={`${m.name}-edit-err`} className="chat-err chat-edit-err" role="alert">
          O Google Chat aceita até 4.096 caracteres.
        </span>
      )}
      <div className="chat-edit-acts">
        <span className="chat-edit-hint">Enter salva · Esc cancela</span>
        <button type="button" className="btn glass sm" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" className="btn solid sm" disabled={empty || tooLong}>
          Salvar
        </button>
      </div>
    </form>
  );
}

/** Miolo do cartão de citação: nome em negrito pequeno e o começo do texto (até 2 linhas, com reticências). */
export function QuoteBody({ name, text }: { name: string; text: string }) {
  return (
    <>
      <span className="chat-qn">{name}</span>
      {text && <span className="chat-qt">{text}</span>}
    </>
  );
}

/** Cartão da mensagem citada: barrinha, nome e começo do texto. Clicar leva até ela (se estiver carregada). */
function Quote({ q, nameOf }: { q: ChatQuoteDto; nameOf: (id: string) => string | null | undefined }) {
  const ctx = useList();
  const loaded = ctx.byName.get(q.name);
  const name = loaded?.mine ? "Você" : (q.sender?.name ?? loaded?.sender.name ?? "Mensagem citada");
  const raw = q.text || (loaded ? loaded.formattedText || loaded.text : "");
  const text = (raw ? plainChat(raw, nameOf) : "") || (loaded?.attachments[0] ? `Anexo: ${loaded.attachments[0].name}` : "");
  const body = <QuoteBody name={name} text={text} />;
  if (!loaded) return <div className="chat-quote">{body}</div>;
  return (
    <button type="button" className="chat-quote" aria-label={`Ir para a mensagem citada de ${name}: ${text.slice(0, 80)}`} onClick={() => ctx.jumpTo(q.name)}>
      {body}
    </button>
  );
}

/** Horário ao lado do nome, como no Google Chat: "11:00" hoje, "5 de nov., 11:00" em outro dia (sem dica). */
function Stamp({ ms }: { ms: number }) {
  const { now } = useList();
  return (
    <time className="chat-mtm" dateTime={new Date(ms).toISOString()}>
      {stampLabel(ms, now)}
    </time>
  );
}

/** Posição da mensagem no grupo (cantos do balão empilhado). */
type Pos = "single" | "first" | "middle" | "last";
const posOf = (i: number, len: number): Pos => (len === 1 ? "single" : i === 0 ? "first" : i === len - 1 ? "last" : "middle");

function MessageBody({ m, pos }: { m: ChatMessageDto; pos: Pos }) {
  const ctx = useList();
  const gone = useChat((s) => s.removing.includes(m.name));
  const isEditing = ctx.editing === m.name && !m.deleted;
  const source = m.deleted ? "" : m.formattedText || m.text;
  const blocks = useMemo(() => parseChat(source, m.customEmojis), [source, m.customEmojis]);
  const jumbo = !m.quoted && emojiOnly(blocks);
  const nameOf = (id: string) => m.mentions?.find((x) => x.id === id)?.name ?? ctx.people.get(id);
  const edited = m.edited && !m.deleted && (
    <span className="chat-edited" title={m.mine ? "Você editou esta mensagem" : "Mensagem editada"}>
      {" "}
      (editada)
    </span>
  );
  return (
    <div
      className={`chat-msg is-${pos}${gone ? " chat-gone" : ""}${isEditing ? " is-editing" : ""}`}
      data-msg={m.name}
      aria-hidden={gone || undefined}
    >
      {m.deleted ? (
        <div className={`chat-bub is-deleted ${m.mine ? "is-mine" : "is-other"}`}>Mensagem apagada</div>
      ) : isEditing ? (
        <EditBox space={ctx.space} m={m} onDone={() => ctx.onEdit(null)} />
      ) : (
        (source || m.quoted) && (
          <div className={`chat-bub ${m.mine ? "is-mine" : "is-other"}${jumbo ? " is-jumbo" : ""}`}>
            {m.quoted && <Quote q={m.quoted} nameOf={nameOf} />}
            <ChatBlocks blocks={blocks} ctx={{ nameOf, myId: ctx.myId, jumbo }} />
            {edited}
          </div>
        )
      )}
      <Attachments account={ctx.account} list={m.attachments} mine={m.mine} />
      <Reactions space={ctx.space} m={m} />
      {!isEditing && !gone && !m.deleted && <MessageBar m={m} />}
    </div>
  );
}

function ThreadChip({ replies, root }: { replies: ChatMessageDto[]; root: ChatMessageDto }) {
  const ctx = useList();
  const open = !!root.thread && ctx.openThreads.has(root.thread);
  const people = [...new Map(replies.map((r) => [r.sender.id, r.sender])).values()].slice(0, 3);
  const mineIds = new Set(replies.filter((r) => r.mine).map((r) => r.sender.id));
  return (
    <>
      <button type="button" className="chat-thr" aria-expanded={open} onClick={() => root.thread && ctx.toggleThread(root.thread)}>
        <span className="chat-mini">
          {people.map((p) => (
            <ChatAvatar key={p.id} name={p.name} photo={p.photo} size={24} seed={p.id} me={mineIds.has(p.id) ? ctx.account : undefined} />
          ))}
        </span>
        <b>{replies.length === 1 ? "1 resposta" : `${replies.length} respostas`}</b>· última às {hhmm(replies.at(-1)!.createMs)}
      </button>
      {open && (
        <div className="chat-replies">
          {replies.map((r) => (
            <div className="chat-reply" key={r.name}>
              <ChatAvatar name={r.sender.name} photo={r.sender.photo} size={26} seed={r.sender.id} me={r.mine ? ctx.account : undefined} />
              <div className="chat-mb">
                <div className="chat-mh">
                  <span className="chat-mn">{r.mine ? "Você" : r.sender.name}</span>
                  <Stamp ms={r.createMs} />
                </div>
                <MessageBody m={r} pos="single" />
              </div>
            </div>
          ))}
          <button type="button" className="btn glass sm chat-reply-btn" onClick={() => ctx.reply(root)}>
            <Reply size={14} aria-hidden />
            Responder na conversa
          </button>
        </div>
      )}
    </>
  );
}

type Item =
  | { kind: "day"; key: string; label: string }
  | { kind: "group"; key: string; mine: boolean; first: ChatMessageDto; list: ChatMessageDto[] };

/** Divide por dia e junta mensagens seguidas da mesma pessoa (até 5 min entre elas). */
function buildItems(messages: ChatMessageDto[], now: number): { items: Item[]; replies: Map<string, ChatMessageDto[]> } {
  const roots = new Set(messages.filter((m) => !m.threadReply && m.thread).map((m) => m.thread!));
  const replies = new Map<string, ChatMessageDto[]>();
  const main: ChatMessageDto[] = [];
  for (const m of messages) {
    if (m.threadReply && m.thread && roots.has(m.thread)) replies.set(m.thread, [...(replies.get(m.thread) ?? []), m]);
    else main.push(m);
  }
  const items: Item[] = [];
  let prev: ChatMessageDto | null = null;
  for (const m of main) {
    if (!prev || !sameDay(prev.createMs, m.createMs)) {
      items.push({ kind: "day", key: `d${m.createMs}`, label: dayLabel(m.createMs, now) });
      prev = null;
    }
    const last = items.at(-1);
    if (prev && last?.kind === "group" && prev.sender.id === m.sender.id && prev.mine === m.mine && m.createMs - prev.createMs < 5 * 60_000 && !(m.threadReply && !prev.threadReply)) {
      last.list.push(m);
    } else {
      items.push({ kind: "group", key: m.name, mine: m.mine, first: m, list: [m] });
    }
    prev = m;
  }
  return { items, replies };
}

function OutgoingFile({ f }: { f: PendingFile }) {
  const k = kindOf({ name: f.name, contentType: f.type });
  return (
    <div className="chat-at">
      <button
        type="button"
        className="chat-th"
        aria-label={`Ver ${f.name}`}
        onClick={() => previewAttachment({ name: f.name, mime: f.type, size: f.size, load: () => blobToBase64(f.file) })}
      >
        {f.thumb && k === "image" ? <img src={f.thumb} alt="" /> : <FileIcon name={f.name} mime={f.type} size={34} />}
      </button>
      <div className="chat-file-info">
        <div className="chat-fn">{f.name}</div>
        <div className="chat-am">{f.ref ? `${fileSize(f.size)} · Enviado` : `Enviando… ${Math.round(f.progress * 100)}%`}</div>
        <div className="chat-prog" aria-hidden>
          <i style={{ transform: `scaleX(${f.ref ? 1 : f.progress})` }} />
        </div>
      </div>
    </div>
  );
}

function OutgoingItem({ o }: { o: Outgoing }) {
  const people = useContext(ListCtx)?.people;
  return (
    <div className="chat-mine is-out">
      <div className="chat-mmeta" role="status">
        {o.status === "sending" ? (
          <>
            <LoaderCircle size={13} className="spinning" aria-hidden />
            Enviando…
          </>
        ) : (
          <span className="chat-err">Não foi enviada{o.error ? `: ${o.error}` : ""}</span>
        )}
      </div>
      {o.text && !o.textSent && (
        <div className="chat-bub is-mine is-pending">
          {o.quote && (
            <div className="chat-quote">
              <QuoteBody name={o.quote.preview.sender?.name ?? "Mensagem citada"} text={plainChat(o.quote.preview.text)} />
            </div>
          )}
          <ChatText text={o.text} ctx={{ nameOf: (id) => people?.get(id) }} />
        </div>
      )}
      {o.files.filter((f) => !f.sent).map((f) => (
        <OutgoingFile key={f.id} f={f} />
      ))}
      {o.status === "error" && (
        <div className="chat-out-acts">
          <button type="button" className="btn glass sm" onClick={() => retryOutgoing(o.id)}>
            <RotateCcw size={14} aria-hidden />
            Tentar de novo
          </button>
          <button type="button" className="btn glass sm" onClick={() => discardOutgoing(o.id)}>
            <Trash2 size={14} aria-hidden />
            Descartar
          </button>
        </div>
      )}
    </div>
  );
}

export function MessageList({
  account,
  space,
  uri,
  messages,
  outgoing,
  now,
  hasOlder,
  olderLoading,
  onOlder,
  onReply,
  onQuote,
  filter,
  onClearFilter,
}: {
  account: string;
  space: string;
  uri: string;
  messages: ChatMessageDto[];
  outgoing: Outgoing[];
  now: number;
  hasOlder: boolean;
  olderLoading: boolean;
  onOlder: () => void;
  onReply: (m: ChatMessageDto) => void;
  onQuote: (m: ChatMessageDto) => void;
  filter: string;
  onClearFilter: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set());
  // trocar de conversa fecha a edição e os fios abertos
  const [editSpace, setEditSpace] = useState(space);
  if (editSpace !== space) {
    setEditSpace(space);
    setEditing(null);
    setOpenThreads(new Set());
  }
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? messages.filter((m) => m.text.toLowerCase().includes(q) || m.attachments.some((a) => a.name.toLowerCase().includes(q))) : messages;
  }, [messages, filter]);
  const { items, replies } = useMemo(() => buildItems(shown, now), [shown, now]);
  const atBottom = useRef(true);
  const prevHeight = useRef<number | null>(null);
  const firstName = messages[0]?.name;

  // fica no fim quando chega mensagem nova (se já estava no fim); mantém o lugar ao carregar as anteriores
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (prevHeight.current != null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items, outgoing.length, firstName]);

  const byName = useMemo(() => new Map(messages.map((m) => [m.name, m])), [messages]);
  // nomes para as menções: pessoas da conversa (lista de membros) e quem aparece nas mensagens
  const members = useChat((s) => s.members[space]);
  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of members ?? []) if (p.name) map.set(p.id, p.name);
    for (const m of messages) {
      if (!m.sender.bot && m.sender.name !== "Sem nome") map.set(m.sender.id, m.mine ? "você" : m.sender.name);
      for (const x of m.mentions ?? []) if (x.name) map.set(x.id, x.name);
    }
    return map;
  }, [messages, members]);
  const myId = useMemo(() => messages.find((m) => m.mine)?.sender.id ?? null, [messages]);

  const ctx = useMemo<ListContext>(() => {
    const openThread = (thread: string) => setOpenThreads((s) => (s.has(thread) ? s : new Set(s).add(thread)));
    return {
      account,
      space,
      now,
      uri,
      byName,
      people,
      myId,
      editing,
      onEdit: setEditing,
      openThreads,
      toggleThread: (thread) =>
        setOpenThreads((s) => {
          const next = new Set(s);
          if (!next.delete(thread)) next.add(thread);
          return next;
        }),
      reply: (m) => {
        if (m.thread && replies.has(m.thread)) openThread(m.thread);
        onReply(m);
      },
      quote: onQuote,
      jumpTo: (name) => {
        const target = byName.get(name);
        if (target?.threadReply && target.thread) openThread(target.thread);
        // espera o fio abrir antes de procurar a mensagem
        window.requestAnimationFrame(() => {
          const el = box.current?.querySelector<HTMLElement>(`[data-msg="${CSS.escape(name)}"]`);
          if (!el) return;
          el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
          el.classList.remove("is-flash");
          void el.offsetWidth;
          el.classList.add("is-flash");
          window.setTimeout(() => el.classList.remove("is-flash"), 1400);
        });
      },
    };
  }, [account, space, now, uri, byName, people, myId, editing, openThreads, replies, onReply, onQuote]);

  /**
   * Dica (data-tip) dos botões da lista no lado que cabe: a lista rola e corta o que passa da borda,
   * então a posição é escolhida quando o mouse (ou o Tab) chega no botão.
   */
  const placeTip = (e: SyntheticEvent) => {
    const el = (e.target as Element).closest?.<HTMLElement>("[data-tip]");
    const list = box.current;
    if (!el || !list?.contains(el)) return;
    // área visível: a lista e qualquer moldura que corte por dentro dela (ex.: a do vídeo)
    let b = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    for (let a = el.parentElement; a; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (/(auto|scroll|hidden|clip)/.test(o.overflowX + o.overflowY)) {
        const ar = a.getBoundingClientRect();
        b = { left: Math.max(b.left, ar.left), top: Math.max(b.top, ar.top), right: Math.min(b.right, ar.right), bottom: Math.min(b.bottom, ar.bottom) };
      }
      if (a === list) break;
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el, "::after");
    const w = parseFloat(cs.width) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const need = parseFloat(cs.height) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 12;
    const mid = r.left + r.width / 2;
    let pos: string | null = null;
    if (mid + w / 2 > b.right - 12) pos = "left";
    else if (mid - w / 2 < b.left + 4) pos = "right";
    else if (b.bottom - r.bottom < need && r.top - b.top >= need) pos = "top";
    if (pos) el.dataset.tipPos = pos;
    else delete el.dataset.tipPos;
  };

  /**
   * Barra de ações no começo da mensagem, como no Google Chat: flutua sobre a borda de cima, alinhada ao
   * início do balão. Na primeira mensagem do grupo ela vai para a linha do nome, logo depois do horário
   * (nas suas, antes de "Você"), para não cobrir o nome. Medido quando o mouse (ou o Tab) chega na mensagem.
   */
  const lastBar = useRef<HTMLElement | null>(null);
  const lastScroll = useRef(0);
  const placeBar = (e: SyntheticEvent) => {
    const msg = (e.target as Element).closest?.<HTMLElement>(".chat-msg");
    const list = box.current;
    if (!msg || !list || (e.type !== "focus" && lastBar.current === msg && lastScroll.current === list.scrollTop)) return;
    lastBar.current = msg;
    lastScroll.current = list.scrollTop;
    const bar = msg.querySelector<HTMLElement>(":scope > .chat-bar");
    const content = msg.firstElementChild as HTMLElement | null;
    if (!bar || !content || content === bar) return;
    const mr = msg.getBoundingClientRect();
    const cr = content.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    const mine = !!msg.closest(".chat-mine");
    // o que fica logo acima: a linha do nome (outros), "Você · hora" (suas) ou a etiqueta "Resposta na conversa"
    const prev = msg.previousElementSibling;
    const item = msg.parentElement;
    const above = prev?.matches(".chat-mh, .chat-replytag")
      ? prev
      : item?.matches(".chat-item, .chat-mine-item") && item.previousElementSibling?.matches(".chat-mh, .chat-mmeta")
        ? item.previousElementSibling
        : null;
    let x = cr.left - mr.left + 6;
    let y = -Math.round(bh / 2) - 2;
    if (above) {
      const range = document.createRange();
      range.selectNodeContents(above);
      const ar = range.getBoundingClientRect();
      const onHeader = () => (y = Math.round(ar.top - mr.top + ar.height / 2 - bh / 2));
      if (!mine) {
        // o nome fica no começo: a barra vai logo depois do horário
        x = ar.right - mr.left + 10;
        onHeader();
      } else if (cr.left + 6 + bw + 10 > ar.left) {
        // "Você · hora" fica à direita: só quando o balão é curto a barra vai para antes dele
        x = ar.left - mr.left - bw - 10;
        onHeader();
      }
    }
    // mensagem comprida com o começo fora da tela: a barra desce para a parte que está à vista
    // (no canto direito do balão, onde costuma haver espaço), em vez de ficar escondida lá em cima
    const top = lr.top - mr.top + 8;
    if (y < top) {
      y = Math.min(top, Math.max(0, Math.min(lr.bottom, mr.bottom) - mr.top - bh - 8));
      x = cr.right - mr.left - bw - 8;
    }
    // sem passar das bordas da lista (ela rola e cortaria a barra)
    x = Math.max(lr.left + 8 - mr.left, Math.min(x, lr.right - 14 - bw - mr.left));
    msg.style.setProperty("--chat-bar-x", `${Math.round(x)}px`);
    msg.style.setProperty("--chat-bar-y", `${y}px`);
  };

  const row = (m: ChatMessageDto, pos: Pos, cls?: string) => (
    <div key={m.name} className={cls ?? "chat-item"}>
      {m.threadReply && (
        <span className="chat-replytag">
          <Reply size={12} aria-hidden />
          Resposta na conversa
        </span>
      )}
      <MessageBody m={m} pos={pos} />
      {m.thread && replies.get(m.thread) && <ThreadChip replies={replies.get(m.thread)!} root={m} />}
    </div>
  );

  return (
    <ListCtx.Provider value={ctx}>
      <div
        className="chat-msgs"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        onPointerOver={(e) => {
          placeBar(e);
          placeTip(e);
        }}
        onFocus={(e) => {
          placeBar(e);
          placeTip(e);
        }}
        aria-live="polite"
        aria-relevant="additions"
      >
        <div className="chat-msgs-top">
          {filter && (
            <div className="chat-filter-note">
              {shown.length === 0 ? "Nenhuma mensagem carregada tem esse texto." : `${shown.length} mensagens com “${filter}”`}
              <button type="button" className="btn glass sm" onClick={onClearFilter}>
                <X size={14} aria-hidden />
                Limpar
              </button>
            </div>
          )}
          {hasOlder && !filter && (
            <button
              type="button"
              className="btn glass sm chat-older"
              disabled={olderLoading}
              onClick={() => {
                prevHeight.current = box.current?.scrollHeight ?? null;
                onOlder();
              }}
            >
              {olderLoading && <LoaderCircle size={14} className="spinning" aria-hidden />}
              Carregar anteriores
            </button>
          )}
        </div>
        {items.map((it) =>
          it.kind === "day" ? (
            <div className="chat-day" key={it.key}>
              <span>{it.label}</span>
            </div>
          ) : it.mine ? (
            <div className="chat-mine" key={it.key}>
              <div className="chat-mmeta">
                Você · <Stamp ms={it.first.createMs} /> <Check size={14} aria-label="Enviada" />
              </div>
              {it.list.map((m, i) => row(m, posOf(i, it.list.length), "chat-mine-item"))}
            </div>
          ) : (
            <div className="chat-mg" key={it.key}>
              <ChatAvatar name={it.first.sender.name} photo={it.first.sender.photo} size={36} seed={it.first.sender.id} />
              <div className="chat-mb">
                <div className="chat-mh">
                  <span className="chat-mn">{it.first.sender.name}</span>
                  <Stamp ms={it.first.createMs} />
                </div>
                {it.list.map((m, i) => row(m, posOf(i, it.list.length)))}
              </div>
            </div>
          ),
        )}
        {outgoing.map((o) => (
          <OutgoingItem key={o.id} o={o} />
        ))}
      </div>
    </ListCtx.Provider>
  );
}
