import * as Popover from "@radix-ui/react-popover";
import { useRef } from "react";
import { ImageIcon } from "../components/icons";
import { useMailbox } from "../state/mailbox";
import { eventsOnDay, useCalendar, visibleEvents } from "../state/calendar";
import { useClock } from "../calendar/shared";
import { BannerPicker, SceneArt, autoScene, greeting, useBannerPrefs, type SceneId } from "./BannerScenes";

/** Primeiro nome da conta conectada (na prévia, sem contas reais, usa o do exemplo). */
function useFirstName(): string {
  return useMailbox((s) => {
    if (!s.live) return "Gabriel";
    const name = Object.values(s.profiles).find((p) => p.name?.trim())?.name ?? "";
    return name.trim().split(/\s+/)[0] ?? "";
  });
}

/** Resumo do cartão: "Nenhum e-mail novo", "1 e-mail novo", "3 e-mails novos em 2 contas"… */
export function bannerSummary(unread: number, accounts: number, left: number): string {
  let s = unread === 0 ? "Nenhum e-mail novo" : `${unread} ${unread === 1 ? "e-mail novo" : "e-mails novos"}`;
  if (accounts > 1) s += ` em ${accounts} contas`;
  if (left > 0) s += ` · ${left} ${left === 1 ? "compromisso" : "compromissos"} hoje`;
  return s;
}

/** Cartão de saudação do topo da caixa de entrada; a imagem é escolhida pelo usuário. */
export function Banner({ unread, accounts }: { unread: number; accounts: number }) {
  const clock = useClock();
  const events = useCalendar(visibleEvents);
  const name = useFirstName();
  const { scene, photo } = useBannerPrefs();
  const byPointer = useRef(false);
  // compromissos que ainda faltam hoje
  const left = eventsOnDay(events, clock).filter((e) => e.end > clock).length;

  const kind = scene === "photo" && !photo ? "auto" : scene;
  const art: SceneId | null = kind === "auto" ? autoScene(clock) : kind === "photo" || kind === "none" ? null : kind;

  return (
    <div className={`banner${kind === "photo" ? " banner-is-photo" : kind === "none" ? " banner-is-none" : ""}`} data-scene={art ?? undefined}>
      {kind === "photo" ? (
        <>
          <img className="banner-photo" src={photo} alt="" decoding="async" />
          <span className="banner-veil" aria-hidden />
        </>
      ) : art ? (
        <SceneArt scene={art} className="banner-scene" />
      ) : null}
      <div className="banner-text">
        <h2>
          {greeting(clock)}
          {name ? `, ${name}` : ""}
        </h2>
        <p>{bannerSummary(unread, accounts, left)}</p>
      </div>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="banner-edit"
            aria-label="Trocar a imagem da saudação"
            data-tip="Trocar imagem"
            data-tip-pos="left"
            onPointerDown={() => (byPointer.current = true)}
          >
            <ImageIcon size={15} aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="qp-content banner-pop"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            aria-label="Imagem da saudação"
            onOpenAutoFocus={(e) => {
              // aberto com o mouse: não acende o foco na primeira miniatura; com o teclado, foca normalmente
              if (byPointer.current) e.preventDefault();
              byPointer.current = false;
            }}
          >
            <div className="banner-pop-head">Imagem da saudação</div>
            <BannerPicker now={clock} compact />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
