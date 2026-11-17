import * as Popover from "@radix-ui/react-popover";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, friendlyError, type ChatAttachmentDto, type ChatMessageDto } from "../lib/api";
import { isTauri } from "../lib/platform";
import { FILE_LABEL, fileSize, fileType } from "../lib/files";
import { FileIcon } from "../components/FileIcon";
import { AccountPhoto } from "../components/MyAvatar";
import { previewAttachment } from "../components/AttachmentPreview";
import { toast } from "../components/Toasts";
import { askConfirm } from "../components/ConfirmHost";
import {
  Check,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  Hash,
  LoaderCircle,
  Maximize2,
  Pause,
  Pencil,
  Play,
  Plus,
  Reply,
  RotateCcw,
  Smile,
  Trash2,
  Users,
  Video,
  X,
} from "../components/icons";
import { EMOJIS, QUICK_REACTIONS, emojiName } from "../lib/emojis";
import { deleteMessage, discardOutgoing, editMessage, retryOutgoing, toggleReaction, useChat, type Outgoing, type PendingFile } from "../state/chat";
import type { ChatPersonDto, ChatSpaceDto } from "../lib/api";
import { ChatText, openLink } from "./chatText";
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

/** Player compacto: play/pausa, ondinha (clicável para pular) e duração. */
export function AudioPlayer({ src, seed, mine, onError }: { src: string | null; seed: string; mine?: boolean; onError?: string | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [pos, setPos] = useState(0);
  const bars = useMemo(() => waveOf(seed), [seed]);
  const played = dur > 0 ? Math.round((pos / dur) * bars.length) : 0;

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

  return (
    <div className={`chat-aud${mine ? " is-mine" : ""}`}>
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => fixDuration(e.currentTarget)}
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
          if (e.key === "ArrowRight") seek((pos + 5) / (dur || 1));
          if (e.key === "ArrowLeft") seek((pos - 5) / (dur || 1));
        }}
      >
        {bars.map((h, i) => (
          <i key={i} className={i < played ? "is-p" : undefined} style={{ height: h }} />
        ))}
      </div>
      <span className="chat-adur">{onError ? "Não abriu" : playing || pos > 0 ? clock(pos) : clock(dur)}</span>
    </div>
  );
}

function AudioAttachment({ account, a, mine }: { account: string; a: ChatAttachmentDto; mine: boolean }) {
  const { ref, url, error } = useVisibleBlob(account, a);
  return (
    <div ref={ref} className={mine ? "chat-bub chat-bub-aud" : "chat-aud-wrap"}>
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
        const isMine = mine.includes(r.emoji);
        return (
          <button
            key={r.emoji}
            type="button"
            className={`chat-rx${isMine ? " is-mine" : ""}`}
            aria-pressed={isMine}
            aria-label={`${emojiName(r.emoji)}: ${r.count} ${r.count === 1 ? "reação" : "reações"}${isMine ? ", uma é sua" : ""}`}
            data-tip={isMine ? "Tirar sua reação" : `Reagir com ${r.emoji}`}
            onClick={() => void toggleReaction(space, m, r.emoji)}
          >
            <span className="chat-rx-e" aria-hidden>
              {r.emoji}
            </span>
            <span className="chat-rx-n" aria-hidden>
              {r.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Botão de reagir: faixa com 6 rápidas e "+" que abre todos os emojis. */
function ReactButton({ space, m, onOpenChange }: { space: string; m: ChatMessageDto; onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const mine = useMine(m);
  const change = (v: boolean) => {
    setOpen(v);
    if (!v) setAll(false);
    onOpenChange(v);
  };
  const pick = (e: string) => {
    change(false);
    void toggleReaction(space, m, e);
  };
  const item = ([e, name]: [string, string], cls: string) => (
    <button key={e} type="button" className={`${cls}${mine.includes(e) ? " is-mine" : ""}`} aria-label={`${mine.includes(e) ? "Tirar" : "Reagir com"} ${name}`} aria-pressed={mine.includes(e)} onClick={() => pick(e)}>
      <span aria-hidden>{e}</span>
    </button>
  );
  return (
    <Popover.Root open={open} onOpenChange={change}>
      <Popover.Trigger asChild>
        <button type="button" className="chat-tool" data-tip="Reagir" aria-label="Reagir">
          <Smile size={15} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="qp-content chat-rx-pop" side="top" align={m.mine ? "end" : "start"} sideOffset={8} collisionPadding={12}>
          <div className="chat-rx-quick" role="group" aria-label="Reações rápidas">
            {QUICK_REACTIONS.map((q) => item(q, "chat-rx-q"))}
            <button type="button" className="chat-rx-q chat-rx-more" aria-label="Mais emojis" aria-expanded={all} data-tip="Mais emojis" onClick={() => setAll(!all)}>
              <Plus size={16} aria-hidden />
            </button>
          </div>
          {all && (
            <div className="chat-rx-grid" role="group" aria-label="Todos os emojis">
              {EMOJIS.map((q) => item(q, "chat-rx-g"))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Ações que aparecem ao passar o mouse (ou com o foco do teclado): reagir, responder e, nas suas, editar e apagar. */
function MessageTools({ space, m, onReply, onEdit }: { space: string; m: ChatMessageDto; onReply: (m: ChatMessageDto) => void; onEdit: (m: ChatMessageDto) => void }) {
  const [reacting, setReacting] = useState(false);
  const [menu, setMenu] = useState(false);
  if (m.deleted) return null;
  const remove = async () => {
    const ok = await askConfirm({
      title: "Apagar mensagem?",
      text: "Ela some para todas as pessoas da conversa. Não dá para desfazer.",
      action: "Apagar",
    });
    if (ok) void deleteMessage(space, m);
  };
  return (
    <div className={`chat-tools${reacting || menu ? " is-open" : ""}`} role="toolbar" aria-label="Ações da mensagem">
      <ReactButton space={space} m={m} onOpenChange={setReacting} />
      {m.thread && (
        <button type="button" className="chat-tool" data-tip="Responder na conversa" aria-label="Responder na conversa" onClick={() => onReply(m)}>
          <Reply size={15} aria-hidden />
        </button>
      )}
      {m.mine && (
        <Popover.Root open={menu} onOpenChange={setMenu}>
          <Popover.Trigger asChild>
            <button type="button" className="chat-tool" data-tip="Mais" aria-label="Mais ações da mensagem">
              <Ellipsis size={15} aria-hidden />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="qp-content chat-menu" side="bottom" align="end" sideOffset={6} collisionPadding={12}>
              {m.text && (
                <Popover.Close asChild>
                  <button type="button" onClick={() => onEdit(m)}>
                    <Pencil size={15} aria-hidden />
                    Editar
                  </button>
                </Popover.Close>
              )}
              <Popover.Close asChild>
                <button type="button" className="chat-menu-danger" onClick={() => void remove()}>
                  <Trash2 size={15} aria-hidden />
                  Apagar
                </button>
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
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

interface BodyProps {
  account: string;
  space: string;
  m: ChatMessageDto;
  onReply: (m: ChatMessageDto) => void;
  editing: string | null;
  onEdit: (name: string | null) => void;
}

function MessageBody({ account, space, m, onReply, editing, onEdit }: BodyProps) {
  const gone = useChat((s) => s.removing.includes(m.name));
  const isEditing = editing === m.name && !m.deleted;
  const edited = m.edited && !m.deleted && (
    <span className="chat-edited" title={m.mine ? "Você editou esta mensagem" : "Mensagem editada"}>
      {" "}
      (editada)
    </span>
  );
  return (
    <div className={`chat-msg${gone ? " chat-gone" : ""}${isEditing ? " is-editing" : ""}`} aria-hidden={gone || undefined}>
      {m.deleted ? (
        <div className="chat-mt is-deleted">Mensagem apagada</div>
      ) : isEditing ? (
        <EditBox space={space} m={m} onDone={() => onEdit(null)} />
      ) : (
        m.text && (
          <div className={m.mine ? "chat-bub" : "chat-mt"}>
            <ChatText text={m.text} />
            {edited}
          </div>
        )
      )}
      <Attachments account={account} list={m.attachments} mine={m.mine} />
      <Reactions space={space} m={m} />
      {!isEditing && !gone && <MessageTools space={space} m={m} onReply={onReply} onEdit={(x) => onEdit(x.name)} />}
    </div>
  );
}

function ThreadChip({
  account,
  space,
  replies,
  onReply,
  root,
}: {
  account: string;
  space: string;
  replies: ChatMessageDto[];
  root: ChatMessageDto;
  onReply: (m: ChatMessageDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const people = [...new Map(replies.map((r) => [r.sender.id, r.sender])).values()].slice(0, 3);
  const mineIds = new Set(replies.filter((r) => r.mine).map((r) => r.sender.id));
  return (
    <>
      <button type="button" className="chat-thr" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="chat-mini">
          {people.map((p) => (
            <ChatAvatar key={p.id} name={p.name} photo={p.photo} size={24} seed={p.id} me={mineIds.has(p.id) ? account : undefined} />
          ))}
        </span>
        <b>{replies.length === 1 ? "1 resposta" : `${replies.length} respostas`}</b>· última às {hhmm(replies.at(-1)!.createMs)}
      </button>
      {open && (
        <div className="chat-replies">
          {replies.map((r) => (
            <div className="chat-reply" key={r.name}>
              <ChatAvatar name={r.sender.name} photo={r.sender.photo} size={26} seed={r.sender.id} me={r.mine ? account : undefined} />
              <div className="chat-mb">
                <div className="chat-mh">
                  <span className="chat-mn">{r.mine ? "Você" : r.sender.name}</span>
                  <span className="chat-mtm">{hhmm(r.createMs)}</span>
                </div>
                {r.deleted ? (
                  <div className="chat-mt is-deleted">Mensagem apagada</div>
                ) : (
                  r.text && (
                    <div className="chat-mt">
                      <ChatText text={r.text} />
                      {r.edited && <span className="chat-edited"> (editada)</span>}
                    </div>
                  )
                )}
                <Attachments account={account} list={r.attachments} mine={false} />
                <Reactions space={space} m={r} />
              </div>
            </div>
          ))}
          <button type="button" className="btn glass sm chat-reply-btn" onClick={() => onReply(root)}>
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
        <div className="chat-bub is-pending">
          <ChatText text={o.text} />
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
  messages,
  outgoing,
  now,
  hasOlder,
  olderLoading,
  onOlder,
  onReply,
  filter,
  onClearFilter,
}: {
  account: string;
  space: string;
  messages: ChatMessageDto[];
  outgoing: Outgoing[];
  now: number;
  hasOlder: boolean;
  olderLoading: boolean;
  onOlder: () => void;
  onReply: (m: ChatMessageDto) => void;
  filter: string;
  onClearFilter: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // trocar de conversa fecha a edição
  const [editSpace, setEditSpace] = useState(space);
  if (editSpace !== space) {
    setEditSpace(space);
    setEditing(null);
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

  return (
    <div
      className="chat-msgs"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
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
              Você · {hhmm(it.first.createMs)} <Check size={14} aria-label="Enviada" />
            </div>
            {it.list.map((m) => (
              <div key={m.name} className="chat-mine-item">
                {m.threadReply && <span className="chat-replytag"><Reply size={12} aria-hidden />Resposta na conversa</span>}
                <MessageBody account={account} space={space} m={m} onReply={onReply} editing={editing} onEdit={setEditing} />
                {m.thread && replies.get(m.thread) && <ThreadChip account={account} space={space} replies={replies.get(m.thread)!} root={m} onReply={onReply} />}
              </div>
            ))}
          </div>
        ) : (
          <div className="chat-mg" key={it.key}>
            <ChatAvatar name={it.first.sender.name} photo={it.first.sender.photo} size={36} seed={it.first.sender.id} />
            <div className="chat-mb">
              <div className="chat-mh">
                <span className="chat-mn">{it.first.sender.name}</span>
                <span className="chat-mtm">{hhmm(it.first.createMs)}</span>
              </div>
              {it.list.map((m) => (
                <div key={m.name}>
                  {m.threadReply && <span className="chat-replytag"><Reply size={12} aria-hidden />Resposta na conversa</span>}
                  <MessageBody account={account} space={space} m={m} onReply={onReply} editing={editing} onEdit={setEditing} />
                  {m.thread && replies.get(m.thread) && <ThreadChip account={account} space={space} replies={replies.get(m.thread)!} root={m} onReply={onReply} />}
                </div>
              ))}
            </div>
          </div>
        ),
      )}
      {outgoing.map((o) => (
        <OutgoingItem key={o.id} o={o} />
      ))}
    </div>
  );
}
