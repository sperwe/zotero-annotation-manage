/**
 * Reader Type Detection Utilities
 *
 * Detects the type of file being viewed in Zotero Reader.
 * Supports PDF, EPUB, Snapshot (HTML), and TXT (SimpleTextReader).
 */

/**
 * Supported reader types
 */
export type ReaderType = 'pdf' | 'epub' | 'snapshot' | 'txt' | 'unknown';

/**
 * Get the reader type based on attachment MIME type
 */
export function getReaderType(reader: _ZoteroTypes.ReaderInstance): ReaderType {
  const item = reader?._item?.parentItem;
  if (!item) return 'unknown';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mimeType = (item as any).attachmentMIMEType as string | undefined;
  if (!mimeType) return 'unknown';

  switch (mimeType) {
    case 'text/plain':
      return 'txt';
    case 'application/epub+zip':
      return 'epub';
    case 'text/html':
      return 'snapshot';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'unknown';
  }
}

/**
 * Check if the reader is SimpleTextReader (TXT files)
 */
export function isSimpleTextReader(reader: _ZoteroTypes.ReaderInstance): boolean {
  return getReaderType(reader) === 'txt';
}

/**
 * Check if the reader type is supported by annotation-manage
 */
export function isSupportedReader(reader: _ZoteroTypes.ReaderInstance): boolean {
  const type = getReaderType(reader);
  return ['pdf', 'epub', 'snapshot', 'txt'].includes(type);
}

/**
 * Check if the reader is PDF
 */
export function isPDFReader(reader: _ZoteroTypes.ReaderInstance): boolean {
  return getReaderType(reader) === 'pdf';
}

/**
 * Get a human-readable name for the reader type
 */
export function getReaderTypeName(reader: _ZoteroTypes.ReaderInstance): string {
  const type = getReaderType(reader);
  switch (type) {
    case 'txt':
      return 'SimpleTextReader (TXT)';
    case 'epub':
      return 'EPUB';
    case 'snapshot':
      return 'Web Page (Snapshot)';
    case 'pdf':
      return 'PDF';
    default:
      return 'Unknown';
  }
}
