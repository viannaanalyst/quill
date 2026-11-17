/** Tipo de arquivo pela extensão (ou pelo tipo MIME), para o ícone e a descrição. */
export type FileType = "pdf" | "sheet" | "doc" | "slides" | "image" | "video" | "audio" | "zip" | "code" | "text" | "file";

const BY_EXT: Record<string, FileType> = {
  pdf: "pdf",
  xls: "sheet", xlsx: "sheet", csv: "sheet", numbers: "sheet", ods: "sheet",
  doc: "doc", docx: "doc", pages: "doc", odt: "doc", rtf: "doc",
  ppt: "slides", pptx: "slides", key: "slides", odp: "slides",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", heic: "image", svg: "image", bmp: "image", tiff: "image",
  mp4: "video", mov: "video", m4v: "video", avi: "video", webm: "video", mkv: "video",
  mp3: "audio", m4a: "audio", wav: "audio", aac: "audio", ogg: "audio", flac: "audio",
  zip: "zip", rar: "zip", "7z": "zip", tar: "zip", gz: "zip", dmg: "zip",
  json: "code", js: "code", ts: "code", html: "code", css: "code", xml: "code", py: "code", sql: "code",
  txt: "text", md: "text", log: "text", ics: "text", eml: "text",
};

export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export function fileType(name: string, mime = ""): FileType {
  const byExt = BY_EXT[extOf(name)];
  if (byExt) return byExt;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  return "file";
}

export const FILE_LABEL: Record<FileType, string> = {
  pdf: "PDF", sheet: "Planilha", doc: "Documento", slides: "Apresentação", image: "Imagem", video: "Vídeo",
  audio: "Áudio", zip: "Compactado", code: "Código", text: "Texto", file: "Arquivo",
};

/** Tamanho legível: "842 KB", "1,2 MB". */
export function fileSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** Tipo MIME para enviar (o do navegador ou um palpite pela extensão). */
export function mimeFor(file: File) {
  if (file.type) return file.type;
  const t = fileType(file.name);
  return t === "pdf" ? "application/pdf" : t === "image" ? `image/${extOf(file.name) || "png"}` : "application/octet-stream";
}

/** Conteúdo do arquivo em base64 comum (para anexar). */
export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("Não consegui ler o arquivo."));
    r.readAsDataURL(file);
  });
}
