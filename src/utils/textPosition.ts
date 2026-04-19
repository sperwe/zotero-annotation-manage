/**
 * TXT Position Calculation Utilities
 *
 * Calculates character offset positions from DOM Selection for TXT files.
 * This is needed because TXT files don't have PDF-style rect coordinates.
 */

import { TextAnnotationPosition } from "../types/textAnnotation";
import { txtLog } from "./txtLog";

/**
 * Get the #content element from SimpleTextReader
 */
function getContentElement(doc: Document): Element | null {
  return doc.getElementById("content");
}

/**
 * Get all paragraph elements with page index data
 */
function getParagraphs(doc: Document): NodeListOf<Element> | null {
  const content = getContentElement(doc);
  return content?.querySelectorAll('[data-page-index], [data-line], [id^="line"], p, h1, h2, h3, h4, h5, h6') || null;
}

function isIgnoredTextNode(node: Node): boolean {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!element?.closest(".zam-txt-highlight-overlay,.zam-txt-highlight-menu,.zam-txt-highlight-action");
}

function createVisibleTextWalker(container: Element): TreeWalker {
  const doc = container.ownerDocument;
  const nodeFilter = doc.defaultView?.NodeFilter || NodeFilter;
  return doc.createTreeWalker(container, nodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isIgnoredTextNode(node) ? nodeFilter.FILTER_REJECT : nodeFilter.FILTER_ACCEPT;
    },
  });
}

/**
 * Calculate character offset from container start to a node within it
 */
function getCharacterOffset(container: Element, targetNode: Node, offset: number): number {
  const walker = createVisibleTextWalker(container);
  const boundary = container.ownerDocument.createRange();
  let charOffset = 0;
  let currentNode: Node | null = walker.nextNode();

  try {
    boundary.setStart(targetNode, offset);
  } catch {
    return 0;
  }

  while (currentNode) {
    if (currentNode === targetNode) {
      return charOffset + offset;
    }
    const currentRange = container.ownerDocument.createRange();
    currentRange.selectNodeContents(currentNode);
    const startToStart = container.ownerDocument.defaultView?.Range.START_TO_START ?? 0;
    const order = currentRange.compareBoundaryPoints(startToStart, boundary);
    if (order >= 0) {
      return charOffset;
    }
    charOffset += (currentNode.textContent || "").length;
    currentNode = walker.nextNode();
  }

  return charOffset;
}

/**
 * Calculate the paragraph index for a node
 */
function getParagraphIndex(container: Element, targetNode: Node): number {
  const paragraphs = container.querySelectorAll('[data-page-index], [data-line], [id^="line"], p, h1, h2, h3, h4, h5, h6');
  const elementNode = targetNode.nodeType === 1 ? (targetNode as Element) : targetNode.parentElement;

  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].contains(targetNode) || (elementNode && paragraphs[i].contains(elementNode))) {
      const element = paragraphs[i] as HTMLElement;
      const value = element.dataset.pageIndex || element.dataset.line || (element.id?.match(/^line(\d+)$/)?.[1] ?? "");
      return value ? parseInt(value, 10) : i;
    }
  }

  return 0;
}

/**
 * Check if a node is contained within an element
 */
function isContained(node: Node, container: Element): boolean {
  return container.contains(node);
}

/**
 * Extract text position from current DOM selection
 *
 * @param doc - The document containing the selection
 * @returns TextAnnotationPosition or null if no valid selection
 */
export function getTextPositionFromSelection(doc: Document): TextAnnotationPosition | null {
  const selection = doc.getSelection();

  if (!selection || selection.rangeCount === 0) {
    ztoolkit.log("[textPosition] No selection found");
    return null;
  }

  if (selection.isCollapsed) {
    ztoolkit.log("[textPosition] Selection is collapsed (empty)");
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = selection.toString();

  if (!text.trim()) {
    ztoolkit.log("[textPosition] Selected text is empty");
    return null;
  }

  const content = getContentElement(doc);
  if (!content) {
    ztoolkit.log("[textPosition] #content element not found");
    return null;
  }

  // Calculate start position
  const startContainer = range.startContainer;
  const startOffset = range.startOffset;
  const startPageIndex = getParagraphIndex(content, startContainer);

  // Calculate end position
  const endContainer = range.endContainer;
  const endOffset = range.endOffset;
  const endPageIndex = getParagraphIndex(content, endContainer);

  // Calculate character offsets
  const charStart = getCharacterOffset(content, startContainer, startOffset);
  const charEnd = getCharacterOffset(content, endContainer, endOffset);
  const fullText = buildVisibleTextIndex(content).text;

  const position: TextAnnotationPosition = {
    type: "text",
    pageIndex: startPageIndex,
    charStart,
    charEnd,
    text,
    anchor: {
      exact: text,
      prefix: fullText.slice(Math.max(0, charStart - 80), charStart),
      suffix: fullText.slice(charEnd, charEnd + 80),
    },
  };

  ztoolkit.log("[textPosition] Calculated position:", {
    pageIndex: position.pageIndex,
    charStart: position.charStart,
    charEnd: position.charEnd,
    textLength: text.length,
    textPreview: text.substring(0, 50),
  });

  return position;
}

/**
 * Get the paragraph element containing a specific character offset
 *
 * @param doc - The document
 * @param charOffset - Character offset to find
 * @returns Paragraph element or null
 */
export function getParagraphAtCharOffset(doc: Document, charOffset: number): Element | null {
  const paragraphs = getParagraphs(doc);
  if (!paragraphs) return null;

  let currentOffset = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!p) continue;

    const pText = p.textContent || "";
    const pLength = pText.length;

    if (charOffset < currentOffset + pLength) {
      return p;
    }

    currentOffset += pLength;
  }

  return null;
}

/**
 * Get the text content of the entire document (for debugging)
 */
export function getFullTextContent(doc: Document): string {
  const content = getContentElement(doc);
  return content?.textContent || "";
}

export function highlightTextPosition(doc: Document, position: TextAnnotationPosition): HTMLElement | null {
  const content = getContentElement(doc);
  if (!content) return null;

  const hasTextAnchor = !!(position.anchor?.exact || position.text)?.trim();
  const anchoredRange = findRangeByStoredText(content, position) || (!hasTextAnchor ? findRangeByOffset(content, position) : null);

  if (!anchoredRange) {
    ztoolkit.log("[textPosition] Could not find stored text anchor");
    txtLog("highlight:anchor-miss", {
      pageIndex: position.pageIndex,
      charStart: position.charStart,
      charEnd: position.charEnd,
      textLen: (position.anchor?.exact || position.text || "").length,
    });
    return null;
  }

  const contentElement = content as HTMLElement;
  const originalPosition = doc.defaultView?.getComputedStyle(contentElement)?.position;
  if (!originalPosition || originalPosition === "static") {
    contentElement.style.position = "relative";
  }
  contentElement.style.isolation = "isolate";
  const contentRect = contentElement.getBoundingClientRect();
  const overlay = doc.createElement("span");
  overlay.className = "zam-txt-highlight-overlay";
  overlay.style.position = "absolute";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.width = "0";
  overlay.style.height = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "1";

  const rects = Array.from(anchoredRange.getClientRects() || []).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) {
    txtLog("highlight:empty-rects", {
      pageIndex: position.pageIndex,
      charStart: position.charStart,
      charEnd: position.charEnd,
      textLen: (position.anchor?.exact || position.text || "").length,
    });
    return null;
  }

  for (const rect of rects) {
    const segment = doc.createElement("span");
    segment.className = "zam-txt-highlight-segment";
    segment.style.position = "absolute";
    segment.style.left = `${rect.left - contentRect.left + contentElement.scrollLeft}px`;
    segment.style.top = `${rect.top - contentRect.top + contentElement.scrollTop}px`;
    segment.style.width = `${rect.width}px`;
    segment.style.height = `${rect.height}px`;
    segment.style.pointerEvents = "none";
    overlay.appendChild(segment);
  }

  contentElement.appendChild(overlay);
  return overlay;
}

export function scrollToTextPosition(doc: Document, position: TextAnnotationPosition): boolean {
  const content = getContentElement(doc);
  if (!content) return false;
  const range = findRangeByStoredText(content, position) || findRangeByOffset(content, position);
  if (!range) return false;
  const rect = Array.from(range.getClientRects() || []).find((r) => r.width > 0 && r.height > 0);
  if (!rect) return false;
  const win = doc.defaultView;
  if (!win) return false;
  win.scrollBy({ top: rect.top - win.innerHeight / 3, behavior: "smooth" });
  const mark = highlightTextPosition(doc, position);
  if (mark) {
    mark.style.outline = "2px solid #ff3b30";
    mark.style.transition = "opacity .2s";
    win.setTimeout(() => {
      mark.style.opacity = "0";
      win.setTimeout(() => mark.remove(), 350);
    }, 1600);
  }
  return true;
}

function findRangeByOffset(container: Element, position: TextAnnotationPosition): Range | null {
  const startNodeAndOffset = findNodeAtOffset(container, position.charStart);
  const endNodeAndOffset = findNodeAtOffset(container, position.charEnd);
  if (!startNodeAndOffset || !endNodeAndOffset) return null;
  const range = container.ownerDocument.createRange();
  range.setStart(startNodeAndOffset.node, startNodeAndOffset.offset);
  range.setEnd(endNodeAndOffset.node, endNodeAndOffset.offset);
  return range;
}

function findRangeByStoredText(container: Element, position: TextAnnotationPosition): Range | null {
  const text = (position.anchor?.exact || position.text || "").trim();
  if (!text) return null;
  const anchor = {
    exact: text,
    prefix: position.anchor?.prefix || "",
    suffix: position.anchor?.suffix || "",
  };

  const candidates = getCandidateContainers(container, position.pageIndex);
  for (const candidate of candidates) {
    const range = findRangeByTextAnchor(candidate, anchor);
    if (range) return range;
  }

  return findRangeByTextAnchor(container, anchor);
}

function getCandidateContainers(container: Element, pageIndex: number): Element[] {
  const selectors = [
    `[data-page-index="${pageIndex}"]`,
    `[data-page-index="${pageIndex + 1}"]`,
    `[data-line="${pageIndex}"]`,
    `[data-line="${pageIndex + 1}"]`,
    `#line${pageIndex}`,
    `#line${pageIndex + 1}`,
  ];
  const candidates: Element[] = [];
  selectors.forEach((selector) => {
    Array.from(container.querySelectorAll(selector)).forEach((candidate) => {
      if (candidate?.nodeType === 1) candidates.push(candidate as Element);
    });
  });
  return Array.from(new Set(candidates.filter((candidate) => candidate.textContent?.trim())));
}

function findRangeByTextAnchor(container: Element, anchor: { exact: string; prefix?: string; suffix?: string }): Range | null {
  const index = buildVisibleTextIndex(container);
  if (!index.text) return null;

  const rawStart = chooseRawAnchorStart(index, anchor);
  if (rawStart >= 0) {
    return rangeFromVisibleTextIndex(container, index.nodes, rawStart, rawStart + anchor.exact.length);
  }

  const normalized = normalizeForAnchor(anchor.exact);
  if (!normalized) return null;
  const normalizedStart = chooseNormalizedAnchorStart(index, {
    exact: normalized,
    prefix: normalizeForAnchor(anchor.prefix || ""),
    suffix: normalizeForAnchor(anchor.suffix || ""),
  });
  if (normalizedStart < 0) return null;
  const rawStartFromNormalized = index.normalizedToRaw[normalizedStart];
  const rawEndFromNormalized = index.normalizedToRaw[normalizedStart + normalized.length - 1] + 1;
  return rangeFromVisibleTextIndex(container, index.nodes, rawStartFromNormalized, rawEndFromNormalized);
}

function chooseRawAnchorStart(index: ReturnType<typeof buildVisibleTextIndex>, anchor: { exact: string; prefix?: string; suffix?: string }) {
  const starts = findAllStarts(index.text, anchor.exact);
  if (!starts.length) return -1;
  return starts.sort((a, b) => scoreRawAnchor(index.text, b, anchor) - scoreRawAnchor(index.text, a, anchor))[0];
}

function chooseNormalizedAnchorStart(
  index: ReturnType<typeof buildVisibleTextIndex>,
  anchor: { exact: string; prefix?: string; suffix?: string },
) {
  const starts = findAllStarts(index.normalizedText, anchor.exact);
  if (!starts.length) return -1;
  return starts.sort((a, b) => scoreRawAnchor(index.normalizedText, b, anchor) - scoreRawAnchor(index.normalizedText, a, anchor))[0];
}

function findAllStarts(text: string, needle: string) {
  const starts: number[] = [];
  if (!needle) return starts;
  let index = text.indexOf(needle);
  while (index >= 0) {
    starts.push(index);
    index = text.indexOf(needle, index + 1);
  }
  return starts;
}

function scoreRawAnchor(text: string, start: number, anchor: { exact: string; prefix?: string; suffix?: string }) {
  let score = 0;
  const prefix = anchor.prefix || "";
  const suffix = anchor.suffix || "";
  if (prefix && text.slice(Math.max(0, start - prefix.length), start).endsWith(prefix)) score += prefix.length;
  if (suffix && text.slice(start + anchor.exact.length, start + anchor.exact.length + suffix.length).startsWith(suffix)) {
    score += suffix.length;
  }
  return score;
}

function normalizeForAnchor(text: string): string {
  return text.replace(/\s+/g, "").replace(/[‐‑‒–—―-]/g, "-");
}

function buildVisibleTextIndex(container: Element) {
  const walker = createVisibleTextWalker(container);
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  let text = "";
  let normalizedText = "";
  const normalizedToRaw: number[] = [];
  let node: Node | null = walker.nextNode();

  while (node) {
    const nodeText = node.textContent || "";
    const start = text.length;
    const end = start + nodeText.length;
    nodes.push({ node: node as Text, start, end });
    for (let i = 0; i < nodeText.length; i++) {
      const normalized = normalizeForAnchor(nodeText[i]);
      if (!normalized) continue;
      normalizedText += normalized;
      normalizedToRaw.push(start + i);
    }
    text += nodeText;
    node = walker.nextNode();
  }

  return { text, normalizedText, normalizedToRaw, nodes };
}

function rangeFromVisibleTextIndex(
  container: Element,
  nodes: Array<{ node: Text; start: number; end: number }>,
  rawStart: number,
  rawEnd: number,
): Range | null {
  const start = nodeOffsetFromRaw(nodes, rawStart);
  const end = nodeOffsetFromRaw(nodes, rawEnd);
  if (!start || !end) return null;
  const range = container.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function nodeOffsetFromRaw(nodes: Array<{ node: Text; start: number; end: number }>, rawOffset: number): { node: Text; offset: number } | null {
  for (const entry of nodes) {
    if (rawOffset >= entry.start && rawOffset <= entry.end) {
      return { node: entry.node, offset: rawOffset - entry.start };
    }
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last.node, offset: (last.node.textContent || "").length } : null;
}

/**
 * Find the text node and offset at a given character offset
 */
function findNodeAtOffset(container: Element, charOffset: number): { node: Text; offset: number } | null {
  const walker = createVisibleTextWalker(container);

  let currentOffset = 0;
  let node: Node | null = walker.nextNode();

  while (node) {
    const nodeLength = (node.textContent || "").length;
    if (currentOffset + nodeLength >= charOffset) {
      return {
        node: node as Text,
        offset: charOffset - currentOffset,
      };
    }
    currentOffset += nodeLength;
    node = walker.nextNode();
  }

  return null;
}
