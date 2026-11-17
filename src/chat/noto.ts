/**
 * Emojis do Google (Noto Animated Emoji, licença livre), como os do Google Chat.
 * Cada emoji tem um endereço pelo código: `1f600`, sequências com `_`, sem o seletor de cor (fe0f).
 * - animado: `…/<código>/512.webp` (só parte dos emojis tem animação);
 * - parado: `…/<código>/emoji.svg` (todos têm).
 * Arquivo sem dependências (os testes rodam direto no Node: npm test).
 */

const BASE = "https://fonts.gstatic.com/s/e/notoemoji/latest";

/** Código do emoji no endereço do Google ("👍🏽" → "1f44d_1f3fd"). */
export function notoCode(emoji: string): string {
  return [...emoji]
    .map((ch) => ch.codePointAt(0)!)
    .filter((cp) => cp !== 0xfe0f)
    .map((cp) => cp.toString(16).padStart(4, "0"))
    .join("_");
}

export function notoUrl(emoji: string, kind: "anim" | "still"): string {
  return `${BASE}/${notoCode(emoji)}/${kind === "anim" ? "512.webp" : "emoji.svg"}`;
}
