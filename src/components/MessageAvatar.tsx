import { Logo } from "./Logo";
import type { Message } from "../inbox/types";

/** Avatar do remetente: iniciais coloridas ou o logo do serviço num círculo claro. */
export function MessageAvatar({ message: m, size }: { message: Pick<Message, "avatar">; size?: number }) {
  const style = size ? { width: size, height: size, fontSize: Math.max(8, size * 0.34) } : undefined;
  return m.avatar.kind === "logo" ? (
    <span className="av logo" style={style}>
      <Logo name={m.avatar.logo} size={size ? size / 2 : 20} />
    </span>
  ) : (
    <span className={`av ${m.avatar.tone}`} style={style} aria-hidden>
      {m.avatar.initials}
    </span>
  );
}
