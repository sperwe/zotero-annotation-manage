/**
 * TXT Annotation Creation Utilities
 *
 * Creates TXT annotations using Zotero Item API.
 * This bypasses the PDF-specific _annotationManager for TXT files.
 */

import { TextAnnotationPosition, CreateTextAnnotationOptions } from "../types/textAnnotation";

/**
 * Generate a unique annotation key
 */
function generateAnnotationKey(): string {
  // Zotero.DataObjectUtilities.generateKey is the standard way
  const key =
    (Zotero as any).DataObjectUtilities?.generateKey?.() ||
    `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`.replace(/X/g, () => Math.floor(Math.random() * 16).toString(16));
  return key;
}

/**
 * Create a TXT annotation item
 *
 * @param attachmentItem - The TXT attachment Zotero Item
 * @param position - The text position (charStart, charEnd, etc.)
 * @param options - Annotation options (type, color, tags, comment)
 * @returns The created annotation item
 */
export async function createTextAnnotation(
  attachmentItem: Zotero.Item,
  position: TextAnnotationPosition,
  options: CreateTextAnnotationOptions = {},
): Promise<Zotero.Item> {
  const { type = "highlight", color = "#ffd400", tags = [], comment = "" } = options;

  ztoolkit.log("[createTextAnnotation] Creating TXT annotation:", {
    attachmentItem: attachmentItem.id,
    position,
    options,
  });

  const key = generateAnnotationKey();
  const pageLabel = `段落 ${position.pageIndex + 1}`;

  const annotation = await Zotero.Annotations.saveFromJSON(attachmentItem, {
    key,
    type,
    text: position.text,
    comment,
    color,
    pageLabel,
    sortIndex: String(position.charStart).padStart(10, "0"),
    position: {
      type: "text",
      pageIndex: position.pageIndex,
      charStart: position.charStart,
      charEnd: position.charEnd,
      text: position.text,
    },
    tags,
  } as unknown as _ZoteroTypes.Annotations.AnnotationJson);
  await annotation.saveTx();

  ztoolkit.log("[createTextAnnotation] Annotation created:", {
    key: annotation.key,
    id: annotation.id,
    type: annotation.annotationType,
    color: annotation.annotationColor,
  });

  return annotation;
}

/**
 * Update an existing TXT annotation
 */
export async function updateTextAnnotation(
  annotationItem: Zotero.Item,
  updates: {
    color?: string;
    tags?: Array<{ name: string }>;
    comment?: string;
  },
): Promise<Zotero.Item> {
  if (updates.color !== undefined) {
    annotationItem.annotationColor = updates.color;
  }

  if (updates.comment !== undefined) {
    annotationItem.annotationComment = updates.comment;
  }

  if (updates.tags !== undefined) {
    // Remove existing tags
    const existingTags = annotationItem.getTags();
    for (const tag of existingTags) {
      annotationItem.removeTag(tag.tag);
    }

    // Add new tags
    for (const tag of updates.tags) {
      annotationItem.addTag(tag.name, 0);
    }
  }

  await annotationItem.saveTx();
  return annotationItem;
}

/**
 * Delete a TXT annotation
 */
export async function deleteTextAnnotation(annotationItem: Zotero.Item): Promise<void> {
  await annotationItem.eraseTx();
}

/**
 * Get all TXT annotations for an attachment
 */
export function getTextAnnotations(attachmentItem: Zotero.Item): Zotero.Item[] {
  return attachmentItem.getAnnotations().filter((ann) => isTextAnnotation(ann));
}

/**
 * Parse TXT position from annotation
 */
export function parseTextPosition(annotationItem: Zotero.Item): TextAnnotationPosition | null {
  const posStr = annotationItem.annotationPosition;
  if (!posStr) return null;

  try {
    const pos = JSON.parse(posStr);
    if (pos?.text?.type === "text") {
      return {
        type: "text",
        pageIndex: pos.text.pageIndex,
        charStart: pos.text.charStart,
        charEnd: pos.text.charEnd,
        text: pos.text.text || annotationItem.annotationText || "",
      };
    }
    if (pos?.type === "text") {
      return {
        type: "text",
        pageIndex: pos.pageIndex,
        charStart: pos.charStart,
        charEnd: pos.charEnd,
        text: pos.text || annotationItem.annotationText || "",
      };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

/**
 * Check if an annotation is a TXT annotation
 */
export function isTextAnnotation(annotationItem: Zotero.Item): boolean {
  const posStr = annotationItem.annotationPosition;
  if (!posStr) return false;

  try {
    const pos = JSON.parse(posStr);
    return pos?.text?.type === "text" || pos?.type === "text";
  } catch {
    return false;
  }
}
