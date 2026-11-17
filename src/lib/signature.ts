import { getPref } from "./storage";

export const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const textToHtml = (t: string) => escapeHtml(t).replace(/\n/g, "<br>");

/** Assinatura da conta (Ajustes → Assinaturas) em HTML. */
export function signatureHtml(email: string | undefined) {
  // Ajustes → Contas pode desligar a assinatura de uma conta
  if (!email || getPref<string>(`account:${email}:signature`, "account") === "none") return "";
  const sig = getPref(`signature:${email}`, "");
  return sig.trim() ? `<br><div>--<br>${textToHtml(sig)}</div>` : "";
}
