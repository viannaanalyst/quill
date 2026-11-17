/** Emojis com nome (para leitores de tela), usados no Escrever e nas reações do Chat. */
export const EMOJIS: [string, string][] = [
  ["😀", "Sorriso"], ["😁", "Sorrisão"], ["😂", "Rindo"], ["😊", "Feliz"], ["😍", "Apaixonado"], ["🥰", "Carinho"], ["😉", "Piscadela"], ["😎", "Óculos escuros"],
  ["🤩", "Encantado"], ["🤔", "Pensando"], ["😅", "Ufa"], ["🥲", "Emocionado"], ["😢", "Triste"], ["😮", "Surpreso"], ["😬", "Constrangido"], ["🙄", "Revirando os olhos"],
  ["😴", "Com sono"], ["🤗", "Abraço"], ["🙏", "Mãos juntas"], ["👏", "Palmas"], ["👍", "Joinha"], ["👎", "Não curti"], ["👋", "Tchau"], ["💪", "Força"],
  ["🤝", "Aperto de mãos"], ["🙌", "Mãos para cima"], ["✌️", "Paz"], ["👀", "Olhos"], ["❤️", "Coração"], ["🔥", "Fogo"], ["✨", "Brilho"], ["💯", "Cem"],
  ["🎉", "Festa"], ["🎂", "Bolo"], ["🎁", "Presente"], ["✅", "Feito"], ["❌", "Não"], ["⚠️", "Atenção"], ["📌", "Alfinete"], ["📎", "Clipe"],
  ["📅", "Calendário"], ["⏰", "Despertador"], ["📞", "Telefone"], ["💡", "Ideia"], ["🚀", "Foguete"], ["☕", "Café"], ["⭐", "Estrela"], ["🌟", "Estrela brilhante"],
];

/** Reações rápidas do Chat (a faixa que aparece primeiro). */
export const QUICK_REACTIONS: [string, string][] = [
  ["👍", "Joinha"],
  ["❤️", "Coração"],
  ["😂", "Rindo"],
  ["😮", "Surpreso"],
  ["😢", "Triste"],
  ["🙏", "Mãos juntas"],
];

const NAMES = new Map(EMOJIS);
/** Nome do emoji para o leitor de tela (ou o próprio emoji, se não estiver na lista). */
export const emojiName = (e: string) => NAMES.get(e) ?? e;
