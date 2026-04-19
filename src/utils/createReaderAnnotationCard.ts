import { getCiteAnnotationHtml } from "../modules/getCitationItem";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCardTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function getReturnLabel(readerType: string) {
  if (readerType === "pdf") return "返回 PDF 摘录";
  if (readerType === "snapshot") return "返回网页摘录";
  return "返回 EPUB 摘录";
}

export async function createReaderAnnotationCard(annotation: Zotero.Item, readerType = "epub", comment = "") {
  const attachment = annotation.parentItem;
  const parent = attachment?.parentItem;
  if (!attachment || !parent) return null;

  const createdAt = formatCardTimestamp();
  const returnLabel = getReturnLabel(readerType);
  const pageLabel = annotation.annotationPageLabel || readerType.toUpperCase();
  const color = annotation.annotationColor || "#ffd400";
  const excerpt = annotation.annotationText || "";
  const sourceTitle = attachment.getDisplayTitle?.() || parent.getDisplayTitle?.() || readerType.toUpperCase();
  const note = new Zotero.Item("note");
  note.libraryID = attachment.libraryID;
  note.parentID = parent.id;
  note.setNote(
    `<div data-zam-reader-annotation-card="true" data-zam-reader-type="${escapeHtml(readerType)}" style="border-left:4px solid ${escapeHtml(color)};padding-left:12px;">` +
      `<h2>${createdAt}｜卡片｜${escapeHtml(pageLabel)}｜</h2>` +
      `<p><strong>${returnLabel}</strong>：${getCiteAnnotationHtml(annotation, returnLabel)}</p>` +
      `<p><strong>核心摘录</strong></p>` +
      `<blockquote>${escapeHtml(excerpt).replace(/\n/g, "<br/>")}</blockquote>` +
      `<p><strong>我的理解</strong></p>` +
      `<p>${comment ? escapeHtml(comment).replace(/\n/g, "<br/>") : " "}</p>` +
      `<p><strong>可连接的概念</strong></p>` +
      `<ul><li> </li></ul>` +
      `<p><strong>后续问题</strong></p>` +
      `<ul><li> </li></ul>` +
      `<p><strong>来源</strong>：${escapeHtml(sourceTitle)}｜${escapeHtml(pageLabel)}｜摘录时间 ${createdAt}</p>` +
      `</div>`,
  );
  for (const tag of annotation.getTags()) {
    note.addTag(tag.tag, tag.type || 0);
  }
  await note.saveTx();
  return note;
}
