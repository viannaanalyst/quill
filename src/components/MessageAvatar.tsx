import { useState } from "react";
import { Logo } from "./Logo";
import { usePref } from "../lib/usePref";
import type { Message } from "../inbox/types";
import { md5 } from "../lib/md5";

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

/** Endereços que já falharam nesta sessão (não tenta de novo a cada lista). */
const failedUrls = new Set<string>();

/**
 * Fontes da foto/logo, em ordem: Gravatar (foto da pessoa ou da marca), ícone do site pelo Google
 * (domínio principal e o completo) e o da DuckDuckGo. Para Gmail/Hotmail etc. só o Gravatar.
 */
export function avatarSources(email: string | undefined): string[] {
  const clean = email?.trim().toLowerCase();
  if (!clean || !clean.includes("@")) return [];
  const out = [`https://www.gravatar.com/avatar/${md5(clean)}?d=404&s=128`];
  const main = senderDomain(clean);
  const full = clean.split("@")[1];
  if (main) {
    out.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(main)}&sz=128`);
    if (full !== main) out.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(full)}&sz=128`);
    out.push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(main)}.ico`);
  }
  return out.filter((u) => !failedUrls.has(u));
}

/**
 * Avatar do remetente: foto do Gravatar ou logo da empresa (pelo domínio do e-mail), o logo do serviço
 * nos exemplos ou as iniciais coloridas. Dá para desligar em Ajustes → Privacidade.
 */
export function MessageAvatar({ message: m, size }: { message: Pick<Message, "avatar"> & { fromEmail?: string }; size?: number }) {
  const [logos] = usePref("senderLogos", true);
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState(m.fromEmail);
  if (email !== m.fromEmail) {
    setEmail(m.fromEmail);
    setStep(0);
  }
  const style = size ? { width: size, height: size, fontSize: Math.max(8, size * 0.34) } : undefined;
  const sources = logos && m.avatar.kind !== "logo" ? avatarSources(m.fromEmail) : [];
  const src = sources[step];

  if (m.avatar.kind === "logo") {
    return (
      <span className="av logo" style={style}>
        <Logo name={m.avatar.logo} size={size ? size / 2 : 20} />
      </span>
    );
  }
  if (src) {
    const isPhoto = src.includes("gravatar.com");
    const px = isPhoto ? (size ?? 40) : Math.round((size ?? 40) * 0.62);
    const fail = () => {
      failedUrls.add(src);
      setStep((n) => n + 1);
    };
    return (
      <span className={`av logo av-site${isPhoto ? " av-photo" : ""}`} style={style} aria-hidden>
        <img
          src={src}
          alt=""
          width={px}
          height={px}
          referrerPolicy="no-referrer"
          draggable={false}
          // ícone genérico de 16px (o "globo" quando o site não tem ícone): passa para a próxima fonte
          onLoad={(e) => e.currentTarget.naturalWidth <= 16 && fail()}
          onError={fail}
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
