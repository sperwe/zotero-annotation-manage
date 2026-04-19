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

export async function createEpubAnnotationCard(annotation: Zotero.Item, comment = "") {
  const attachment = annotation.parentItem;
  const parent = attachment?.parentItem;
  if (!attachment || !parent) return null;

  const createdAt = formatCardTimestamp();
  const pageLabel = annotation.annotationPageLabel || "EPUB";
  const color = annotation.annotationColor || "#ffd400";
  const excerpt = annotation.annotationText || "";
  const sourceTitle = attachment.getDisplayTitle?.() || parent.getDisplayTitle?.() || "EPUB";
  const note = new Zotero.Item("note");
  note.libraryID = attachment.libraryID;
  note.parentID = parent.id;
  note.setNote(
    `<div data-zam-epub-annotation-card="true" style="border-left:4px solid ${escapeHtml(color)};padding-left:12px;">` +
      `<h2>${createdAt}｜卡片｜${escapeHtml(pageLabel)}｜</h2>` +
      `<p><strong>返回 EPUB 摘录</strong>：${getCiteAnnotationHtml(annotation, "返回 EPUB 摘录")}</p>` +
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
