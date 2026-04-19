/**
 * TXT Annotation Type Definitions
 *
 * These types define the structure for TXT file annotations in SimpleTextReader.
 * They extend Zotero's annotation system with TXT-specific position data.
 */

/**
 * TXT-specific annotation position information
 */
export interface TextAnnotationPosition {
  type: 'text';
  /** Paragraph index (virtual page number in SimpleTextReader) */
  pageIndex: number;
  /** Character start offset relative to file beginning */
  charStart: number;
  /** Character end offset relative to file beginning */
  charEnd: number;
  /** Selected text content */
  text: string;
  /** Text quote anchor used to relocate highlights after reader pagination changes */
  anchor?: {
    exact: string;
    prefix: string;
    suffix: string;
  };
}

/**
 * PDF/EPUB/Snapshot position structure (for compatibility)
 */
export interface PDFAnnotationPosition {
  pageIndex: number;
  rects: number[][];
  nextPageRects?: number[][];
  width?: number;
}

/**
 * Unified annotation position structure
 */
export interface AnnotationPosition {
  /** PDF/EPUB/Snapshot position */
  pdf?: PDFAnnotationPosition;
  /** TXT position */
  text?: TextAnnotationPosition;
}

/**
 * Options for creating a TXT annotation
 */
export interface CreateTextAnnotationOptions {
  type?: 'highlight' | 'underline' | 'note';
  color?: string;
  tags?: Array<{ name: string }>;
  comment?: string;
}
