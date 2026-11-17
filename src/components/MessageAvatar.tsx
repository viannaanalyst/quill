import { useState } from "react";
import { Logo } from "./Logo";
import { usePref } from "../lib/usePref";
import type { Message } from "../inbox/types";

/** Provedores de e-mail pessoal: aí o ícone do domínio não diz quem é a pessoa, então ficam as iniciais. */
const PERSONAL = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "yahoo.com", "yahoo.com.br",
  "icloud.com", "me.com", "mac.com", "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br", "protonmail.com", "proton.me", "aol.com",
]);

/** Domínio principal do remetente ("alerts.indeed.com" → "indeed.com"; "mail.nubank.com.br" → "nubank.com.br"). */
export function senderDomain(email: string | undefined): string | null {
  const domain = email?.split("@")[1]?.toLowerCase().trim();
  if (!domain || PERSONAL.has(domain)) return null;
  const parts = domain.split(".");
  const keep = /\.(com|org|net|gov|edu|co)\.[a-z]{2}$/.test(domain) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

/**
 * Avatar do remetente: o logo da empresa (pelo domínio do e-mail), o logo do serviço nos exemplos
 * ou as iniciais coloridas. Dá para desligar os logos em Ajustes → Privacidade.
 */
export function MessageAvatar({ message: m, size }: { message: Pick<Message, "avatar"> & { fromEmail?: string }; size?: number }) {
  const [logos] = usePref("senderLogos", true);
  const [failed, setFailed] = useState<string | null>(null);
  const style = size ? { width: size, height: size, fontSize: Math.max(8, size * 0.34) } : undefined;
  const domain = logos ? senderDomain(m.fromEmail) : null;

  if (m.avatar.kind === "logo") {
    return (
      <span className="av logo" style={style}>
        <Logo name={m.avatar.logo} size={size ? size / 2 : 20} />
      </span>
    );
  }
  if (domain && failed !== domain) {
    const px = Math.round((size ?? 40) * 0.62);
    return (
      <span className="av logo av-site" style={style} aria-hidden>
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
          alt=""
          width={px}
          height={px}
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={(e) => {
            // o Google devolve um globo genérico de 16px quando não acha o ícone: aí ficam as iniciais
            if (e.currentTarget.naturalWidth <= 16) setFailed(domain);
          }}
          onError={() => setFailed(domain)}
        />
      </span>
    );
  }
  return (
    <span className={`av ${m.avatar.tone}`} style={style} aria-hidden>
      {m.avatar.initials}
    </span>
  );
}
