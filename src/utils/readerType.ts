/**
 * Reader Type Detection Utilities
 *
 * Detects the type of file being viewed in Zotero Reader.
 * Supports PDF, EPUB, Snapshot (HTML), and SimpleTextReader text formats.
 */

/**
 * Supported reader types
 */
export type ReaderType = "pdf" | "epub" | "snapshot" | "txt" | "unknown";

export function isSimpleTextReaderAttachment(item?: Zotero.Item): boolean {
  if (!item) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mimeType = (((item as any).attachmentMIMEType || (item as any).attachmentContentType || "") as string).toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attachmentPath = ((item as any).attachmentPath || "") as string;
  return ["text/plain", "text/markdown", "text/x-markdown"].includes(mimeType) || /\.(txt|md|markdown)$/i.test(attachmentPath);
}

/**
 * Get the reader type based on attachment MIME type
 */
export function getReaderType(reader: _ZoteroTypes.ReaderInstance): ReaderType {
  const item = reader?._item;
  if (!item) return "unknown";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mimeType = (((item as any).attachmentMIMEType || (item as any).attachmentContentType || "") as string).toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attachmentPath = ((item as any).attachmentPath || "") as string;

  switch (mimeType) {
    case "text/plain":
    case "text/markdown":
    case "text/x-markdown":
      return "txt";
    case "application/epub+zip":
      return "epub";
    case "text/html":
      return "snapshot";
    case "application/pdf":
      return "pdf";
    default:
      if (/\.(txt|md|markdown)$/i.test(attachmentPath)) return "txt";
      return "unknown";
  }
}

/**
 * Check if the reader is SimpleTextReader (plain text / Markdown files)
 */
export function isSimpleTextReader(reader: _ZoteroTypes.ReaderInstance): boolean {
  return getReaderType(reader) === "txt";
}

/**
 * Check if the reader type is supported by annotation-manage
 */
export function isSupportedReader(reader: _ZoteroTypes.ReaderInstance): boolean {
  const type = getReaderType(reader);
  return ["pdf", "epub", "snapshot", "txt"].includes(type);
}

/**
 * Check if the reader is PDF
 */
export function isPDFReader(reader: _ZoteroTypes.ReaderInstance): boolean {
  return getReaderType(reader) === "pdf";
}

/**
 * Get a human-readable name for the reader type
 */
export function getReaderTypeName(reader: _ZoteroTypes.ReaderInstance): string {
  const type = getReaderType(reader);
  switch (type) {
    case "txt":
      return "SimpleTextReader (Text/Markdown)";
    case "epub":
      return "EPUB";
    case "snapshot":
      return "Web Page (Snapshot)";
    case "pdf":
      return "PDF";
    default:
      return "Unknown";
  }
}
