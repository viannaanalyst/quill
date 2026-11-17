import gmail from "../assets/logos/gmail.svg";
import microsoft from "../assets/logos/microsoft.svg";
import icloud from "../assets/logos/icloud.svg";
import inchurch from "../assets/logos/inchurch.svg";
import nubank from "../assets/logos/nubank.svg";
import vercel from "../assets/logos/vercel.svg";
import googleCalendar from "../assets/logos/google-calendar.svg";
import supabase from "../assets/logos/supabase.svg";

const LOGOS = {
  gmail,
  microsoft,
  icloud,
  inchurch,
  nubank,
  vercel,
  "google-calendar": googleCalendar,
  supabase,
} as const;

export type LogoName = keyof typeof LOGOS;

export function Logo({ name, size = 20, alt = "" }: { name: LogoName; size?: number; alt?: string }) {
  return <img src={LOGOS[name]} width={size} height={size} alt={alt} draggable={false} />;
}
