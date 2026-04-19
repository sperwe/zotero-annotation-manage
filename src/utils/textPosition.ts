/**
 * TXT Position Calculation Utilities
 *
 * Calculates character offset positions from DOM Selection for TXT files.
 * This is needed because TXT files don't have PDF-style rect coordinates.
 */

import { TextAnnotationPosition } from "../types/textAnnotation";

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

/**
 * Calculate character offset from container start to a node within it
 */
function getCharacterOffset(container: Element, targetNode: Node, offset: number): number {
  const doc = container.ownerDocument;
  const nodeFilter = doc.defaultView?.NodeFilter || NodeFilter;
  const walker = doc.createTreeWalker(container, nodeFilter.SHOW_TEXT, null);

  let charOffset = 0;
  let currentNode: Node | null = walker.nextNode();

  while (currentNode) {
    if (currentNode === targetNode) {
      return charOffset + offset;
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

  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].contains(targetNode)) {
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

  const position: TextAnnotationPosition = {
    type: "text",
    pageIndex: startPageIndex,
    charStart,
    charEnd,
    text,
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

/**
 * Highlight a text range in the document (for debugging/testing)
 *
 * @param doc - The document
 * @param position - The text position to highlight
 * @returns The highlighted range or null
 */
export function highlightTextPosition(doc: Document, position: TextAnnotationPosition): Range | null {
  const content = getContentElement(doc);
  if (!content) return null;

  const textContent = content.textContent || "";
  const startNodeAndOffset = findNodeAtOffset(content, position.charStart);
  const endNodeAndOffset = findNodeAtOffset(content, position.charEnd);

  if (!startNodeAndOffset || !endNodeAndOffset) {
    ztoolkit.log("[textPosition] Could not find nodes at offsets");
    return null;
  }

  const range = doc.createRange();
  range.setStart(startNodeAndOffset.node, startNodeAndOffset.offset);
  range.setEnd(endNodeAndOffset.node, endNodeAndOffset.offset);

  // Create highlight element
  const mark = doc.createElement("mark");
  mark.style.backgroundColor = "#ffd400";
  mark.style.color = "#000";

  try {
    range.surroundContents(mark);
  } catch (e) {
    // If surroundContents fails (e.g., partially selected nodes), use extractContents
    ztoolkit.log("[textPosition] surroundContents failed, using alternative method");
    return null;
  }

  return range;
}

/**
 * Find the text node and offset at a given character offset
 */
function findNodeAtOffset(container: Element, charOffset: number): { node: Text; offset: number } | null {
  const doc = container.ownerDocument;
  const nodeFilter = doc.defaultView?.NodeFilter || NodeFilter;
  const walker = doc.createTreeWalker(container, nodeFilter.SHOW_TEXT, null);

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
