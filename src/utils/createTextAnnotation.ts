/**
 * TXT Annotation Creation Utilities
 *
 * Creates TXT annotations using Zotero Item API.
 * This bypasses the PDF-specific _annotationManager for TXT files.
 */

import { TextAnnotationPosition, CreateTextAnnotationOptions } from "../types/textAnnotation";
import { txtLog } from "./txtLog";

const TXT_NOTE_MARKER = "zotero-annotation-manage-txt";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function formatCardTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function htmlToText(html: string): string {
  return unescapeHtml(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function extractCoreExcerptFromNote(note: string): string {
  const blockquote = note.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i)?.[1];
  return blockquote ? htmlToText(blockquote) : "";
}

function parseVisibleTextAnnotationMeta(note: string, noteItem: Zotero.Item) {
  const text = htmlToText(note);
  const attachmentKey = note.match(/zotero:\/\/select\/library\/items\/([A-Z0-9]+)#zam-txt-return=/)?.[1] || "";
  const pageLabel = text.match(/来源：.*?｜(.*?)｜字符/)?.[1] || "TXT";
  const range = text.match(/字符\s*(\d+)-(\d+)/);
  const createdAt = text.match(/摘录时间\s*(\d{12})/)?.[1] || "";
  const coreExcerpt = extractCoreExcerptFromNote(note);
  if (!attachmentKey || !range || !coreExcerpt) return null;
  const charStart = Number(range[1]);
  const charEnd = Number(range[2]);
  const attachment = getItemSafe(attachmentKey);
  const position = {
    type: "text" as const,
    pageIndex: Math.max(0, Number(pageLabel.match(/\d+/)?.[0] || 1) - 1),
    charStart,
    charEnd,
    text: coreExcerpt,
    anchor: { exact: coreExcerpt, prefix: "", suffix: "" },
  };
  return {
    marker: TXT_NOTE_MARKER,
    attachmentKey,
    attachmentID: attachment?.id || 0,
    type: "highlight" as const,
    color: note.match(/border-left:\s*4px solid\s*(#[0-9a-fA-F]{6})/)?.[1] || "#ffd400",
    pageLabel,
    position,
    text: coreExcerpt,
    comment: "",
    createdAt,
    noteKey: noteItem.key,
  };
}

function getItemSafe(key: string) {
  try {
    return Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, key) as Zotero.Item;
  } catch {
    return undefined;
  }
}

export function parseTextAnnotationNote(noteItem: Zotero.Item, attachmentItem?: Zotero.Item) {
  if (!noteItem?.isNote?.()) return null;
  const note = noteItem.getNote?.() || "";
  const visibleMeta = parseVisibleTextAnnotationMeta(note, noteItem);
  if (!note.includes(TXT_NOTE_MARKER)) {
    if (visibleMeta && (!attachmentItem || visibleMeta.attachmentKey === attachmentItem.key)) return visibleMeta;
    return null;
  }
  const match =
    note.match(/<!--\s*ZAM_TXT_ANNOTATION_META:([\s\S]*?):ZAM_TXT_ANNOTATION_META_END\s*-->/) ||
    note.match(/data-zam-txt-annotation-meta=["']([^"']+)["']/) ||
    note.match(/<pre[^>]*>\s*ZAM_TXT_ANNOTATION_META:([\s\S]*?):ZAM_TXT_ANNOTATION_META_END\s*<\/pre>/) ||
    note.match(/ZAM_TXT_ANNOTATION_META:([\s\S]*?):ZAM_TXT_ANNOTATION_META_END/) ||
    note.match(/<pre[^>]*data-zam-txt-annotation-meta=["']true["'][^>]*>([\s\S]*?)<\/pre>/);
  if (!match?.[1]) {
    if (visibleMeta && (!attachmentItem || visibleMeta.attachmentKey === attachmentItem.key)) return visibleMeta;
    return null;
  }
  try {
    const meta = JSON.parse(unescapeHtml(match[1]));
    if (meta?.marker !== TXT_NOTE_MARKER) return null;
    if (attachmentItem && meta.attachmentKey !== attachmentItem.key) return null;
    const coreExcerpt = extractCoreExcerptFromNote(note);
    if (coreExcerpt) {
      meta.text = coreExcerpt;
      meta.position = {
        ...meta.position,
        text: coreExcerpt,
        anchor: {
          exact: meta.position?.anchor?.exact || coreExcerpt,
          prefix: meta.position?.anchor?.prefix || "",
          suffix: meta.position?.anchor?.suffix || "",
        },
      };
    }
    return meta as {
      marker: string;
      attachmentKey: string;
      attachmentID: number;
      type: "highlight" | "underline" | "note";
      color: string;
      pageLabel: string;
      position: TextAnnotationPosition;
      text: string;
      comment: string;
      createdAt?: string;
    };
  } catch {
    if (visibleMeta && (!attachmentItem || visibleMeta.attachmentKey === attachmentItem.key)) return visibleMeta;
    return null;
  }
}

/**
 * Create a TXT pseudo-annotation note.
 *
 * Zotero core only allows annotation parents to be PDF, EPUB, or HTML snapshots.
 * TXT selections are therefore persisted as tagged child notes with structured metadata,
 * and export code reads them back as annotation-shaped records.
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

  const pageLabel = `段落 ${position.pageIndex + 1}`;
  const annotationPosition = {
    type: "text",
    pageIndex: position.pageIndex,
    charStart: position.charStart,
    charEnd: position.charEnd,
    text: position.text,
    anchor: position.anchor,
  };
  const createdAt = formatCardTimestamp();
  const meta = {
    marker: TXT_NOTE_MARKER,
    attachmentKey: attachmentItem.key,
    attachmentID: attachmentItem.id,
    type,
    color,
    pageLabel,
    position: annotationPosition,
    text: position.text,
    comment,
    createdAt,
  };
  const tagNames = tags.map((tag) => tag.name);
  const sourceTitle = attachmentItem.getDisplayTitle?.() || "TXT";
  const escapedMeta = escapeHtml(JSON.stringify(meta));
  const excerptHtml = escapeHtml(position.text).replace(/\n/g, "<br/>");
  const commentHtml = comment ? escapeHtml(comment).replace(/\n/g, "<br/>") : "";

  txtLog("create:start", {
    attachmentID: attachmentItem.id,
    attachmentKey: attachmentItem.key,
    type,
    color,
    pageLabel,
    textLen: position.text.length,
    tags: tags.map((tag) => tag.name),
  });

  const note = new Zotero.Item("note");
  note.libraryID = attachmentItem.libraryID;
  note.parentID = attachmentItem.parentItemID || attachmentItem.id;
  const renderNote = (noteKey = "") =>
    `<div data-zam-txt-annotation="true" style="border-left:4px solid ${escapeHtml(color)};padding-left:12px;">` +
      `<h2>${createdAt}｜卡片｜${escapeHtml(pageLabel)}｜</h2>` +
      `<!-- ZAM_TXT_ANNOTATION_META:${escapedMeta}:ZAM_TXT_ANNOTATION_META_END -->` +
      `<span data-zam-txt-annotation-meta="${escapedMeta}" style="display:none">&nbsp;</span>` +
      `<p><a href="zotero://select/library/items/${escapeHtml(attachmentItem.key)}#zam-txt-return=${escapeHtml(noteKey)}" data-zam-txt-return-key="${escapeHtml(noteKey)}">返回 TXT 摘录</a></p>` +
      `<p><strong>核心摘录</strong></p>` +
      `<blockquote>${excerptHtml}</blockquote>` +
      `<p><strong>我的理解</strong></p>` +
      `<p>${commentHtml || " "}</p>` +
      `<p><strong>可连接的概念</strong></p>` +
      `<ul><li> </li></ul>` +
      `<p><strong>后续问题</strong></p>` +
      `<ul><li> </li></ul>` +
      `<p><strong>来源</strong>：${escapeHtml(sourceTitle)}｜${escapeHtml(pageLabel)}｜字符 ${position.charStart}-${position.charEnd}｜摘录时间 ${createdAt}</p>` +
      (tagNames.length ? `<p><strong>标签</strong>：${tagNames.map(escapeHtml).join("、")}</p>` : "") +
      `</div>`;
  note.setNote(renderNote());

  for (const tag of tags) {
    note.addTag(tag.name, 0);
  }

  txtLog("create:note-before", {
    parentID: note.parentID,
    libraryID: note.libraryID,
    metaLen: JSON.stringify(meta).length,
  });
  await note.saveTx();
  if (note.key) {
    note.setNote(renderNote(note.key));
    await note.saveTx();
  }

  txtLog("create:note-success", {
    key: note.key,
    id: note.id,
    parentID: note.parentID,
  });

  return note;
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
