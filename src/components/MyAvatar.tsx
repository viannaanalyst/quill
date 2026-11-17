import { useState } from "react";
import { isTauri } from "../lib/platform";
import { usePref } from "../lib/usePref";
import { useMailbox } from "../state/mailbox";

export const AVATAR_PREF = "avatarPhoto";

export function initialsOf(email: string | undefined, name?: string | null) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    const two = (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
    if (two) return two.toUpperCase();
  }
  if (!email) return isTauri ? "?" : "GV";
  const local = email.split("@")[0].replace(/[^a-zA-Z]/g, "");
  return (local.slice(0, 2) || "?").toUpperCase();
}

/**
 * Foto de uma conta: a do Google (ou as iniciais, se não houver). A foto escolhida no Quill só aparece
 * com `main` (avatar do cabeçalho e do menu da conta); nas listas de contas cada uma mostra a sua.
 */
export function AccountPhoto({ email, size = 34, main = false, className = "" }: { email?: string; size?: number; main?: boolean; className?: string }) {
  const [custom] = usePref<string | null>(AVATAR_PREF, null);
  const profile = useMailbox((s) => (email ? s.profiles[email] : undefined));
  const [broken, setBroken] = useState<string | null>(null);
  const src = (main && custom) || profile?.picture || null;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };

  if (src && broken !== src) {
    return (
      <img
        className={`photo ${className}`}
        src={src}
        alt=""
        width={size}
        height={size}
        style={style}
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setBroken(src)}
      />
    );
  }
  return (
    <span className={`photo initials ${className}`} style={style} aria-hidden>
      {initialsOf(email, profile?.name)}
    </span>
  );
}

/** Reduz a foto escolhida para um quadrado pequeno (cabe nas preferências sem pesar). */
export function resizePhoto(file: File, px = 192): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, px, px);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não consegui abrir essa imagem."));
    };
    img.src = url;
  });
}
