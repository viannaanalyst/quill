/**
 * Resposta rápida em andamento, por e-mail: o texto (HTML), os anexos e o rascunho no Gmail.
 * Fica guardada ao sair do e-mail e ao voltar do editor completo, para a caixa reabrir como estava.
 */
export interface ReplyFile {
  name: string;
  mimeType: string;
  /** conteúdo em base64 */
  data: string;
  size: number;
}

export interface ReplyDraft {
  html: string;
  files: ReplyFile[];
  /** rascunho já salvo no Gmail (para continuar o mesmo e apagar depois do envio) */
  draftId?: string;
  /** mudou algo que ainda não foi salvo no Gmail */
  dirty?: boolean;
}

const drafts = new Map<string, ReplyDraft>();

export const getReplyDraft = (messageId: string) => drafts.get(messageId);
export const setReplyDraft = (messageId: string, d: ReplyDraft) => void drafts.set(messageId, d);
export const clearReplyDraft = (messageId: string) => void drafts.delete(messageId);

/** O HTML tem texto ou imagem (não é só <br> e espaços)? */
export function hasText(html: string) {
  if (/<(img|hr)\b/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;| /g, " ").trim().length > 0;
}
