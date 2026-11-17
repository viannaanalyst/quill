import * as Popover from "@radix-ui/react-popover";
import { useMemo, useRef, useState } from "react";
import { MessageAvatar } from "./MessageAvatar";
import { Bell, BellOff, RefreshCw, TriangleAlert } from "./icons";
import { usePref } from "../lib/usePref";
import { folderMessages, refreshMailbox, signInWithGoogle, markReadRemote, useMailbox } from "../state/mailbox";
import { markRead, navigate, useStore } from "../state/store";

const MAX = 8;

/** Sino do cabeçalho: e-mails novos não lidos e contas que precisam entrar de novo. */
export function Notifications() {
  const [open, setOpen] = useState(false);
  const byPointer = useRef(false);
  const [seenAt, setSeenAt] = usePref<number>("notifSeenAt", 0);
  const inbox = useMailbox((s) => folderMessages(s, "inbox"));
  const needsLogin = useMailbox((s) => s.needsLogin);
  const refreshing = useMailbox((s) => s.refreshing);
  const readIds = useStore((s) => s.readIds);

  const unread = useMemo(() => inbox.filter((m) => m.unread && !readIds.has(m.id)).slice(0, MAX), [inbox, readIds]);
  const fresh = unread.some((m) => (m.internalDate ?? Number.MAX_SAFE_INTEGER) > seenAt) || needsLogin.length > 0;

  const openMessage = (id: string) => {
    markRead(id);
    markReadRemote(id);
    setOpen(false);
    navigate({ name: "read", id });
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setSeenAt(Date.now());
      }}
    >
      <Popover.Trigger asChild>
        <button className="btn glass ic ntf-bell" onPointerDown={() => (byPointer.current = true)} aria-label={fresh ? "Notificações (novas)" : "Notificações"} data-tip="Notificações">
          <Bell size={17} aria-hidden />
          {fresh && <span className="ntf-dot" aria-hidden />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="qp-content ntf-pop" onOpenAutoFocus={(e) => {
            // aberto com o mouse: não acende o foco no primeiro botão; com o teclado, foca normalmente
            if (byPointer.current) e.preventDefault();
            byPointer.current = false;
          }} align="end" sideOffset={10} collisionPadding={12} aria-label="Notificações">
          <div className="ntf-head">
            <strong>Notificações</strong>
            <button className="ntf-refresh" onClick={() => void refreshMailbox()} aria-label="Atualizar" data-tip="Atualizar" disabled={refreshing}>
              <span className={refreshing ? "spinning" : undefined} style={{ display: "flex" }}>
                <RefreshCw size={14} aria-hidden />
              </span>
            </button>
          </div>

          {needsLogin.map((email) => (
            <button key={email} className="ntf-item ntf-warn" onClick={() => void signInWithGoogle(email).catch(() => undefined)}>
              <span className="ntf-warn-ic" aria-hidden>
                <TriangleAlert size={15} />
              </span>
              <span className="ntf-text">
                <strong>Entre de novo em {email}</strong>
                <span>O Google pediu um novo login. Toque para entrar.</span>
              </span>
            </button>
          ))}

          {unread.length === 0 && needsLogin.length === 0 ? (
            <div className="ntf-empty">
              <BellOff size={22} aria-hidden />
              <p>Nada novo por aqui.</p>
              <span>E-mails não lidos da Entrada aparecem aqui.</span>
            </div>
          ) : (
            <ul className="ntf-list stagger">
              {unread.map((m) => (
                <li key={m.id}>
                  <button className="ntf-item" onClick={() => openMessage(m.id)}>
                    <MessageAvatar message={m} size={32} />
                    <span className="ntf-text">
                      <strong>{m.from}</strong>
                      <span>{m.subject || "(sem assunto)"}</span>
                    </span>
                    <time className="ntf-time">{m.date}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {unread.length > 0 && (
            <button
              className="ntf-all"
              onClick={() => {
                setOpen(false);
                navigate({ name: "inbox", folder: "inbox" });
              }}
            >
              Ver caixa de entrada
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
