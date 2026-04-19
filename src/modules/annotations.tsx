import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import { sortValuesLength } from "../utils/sort";
import { addCssFile, getItem, isDebug } from "../utils/zzlb";
import { groupBy } from "../utils/groupBy";
import { AnnotationPopup } from "./AnnotationPopup";
import { Relations } from "../utils/Relations";
import { isSupportedReader, isSimpleTextReader } from "../utils/readerType";
import { getTextPositionFromSelection, highlightTextPosition, scrollToTextPosition } from "../utils/textPosition";
import { txtLog, txtLogError } from "../utils/txtLog";
import { parseTextAnnotationNote } from "../utils/createTextAnnotation";
// import { text2Ma } from "./readerTools";

const simpleTextReaderCleanups: Array<() => void> = [];
const simpleTextReaderDocs = new WeakSet<Document>();
const simpleTextReaderBrowsers = new WeakSet<Element>();
const txtReturnClickDocs = new WeakSet<Document>();
const simpleTextReaderJumpers = new Map<string, { jump: (noteKey: string) => boolean; win: Window; tabID?: string }>();
let pendingTxtReturnKey = "";

function register() {
  // if (!getPref("enable")) return;
  // ztoolkit.UI.basicOptions.log.disableZLog = true;
  // ztoolkit.log("Annotations register");

  // if (!getPref("hide-in-selection-popup"))
  {
    Zotero.Reader.registerEventListener("renderTextSelectionPopup", renderTextSelectionPopup, config.addonID);
  }

  // if (!getPref("hide-in-annotation-context-menu"))
  {
    Zotero.Reader.registerEventListener("createAnnotationContextMenu", createAnnotationContextMenu, config.addonID);
  }

  registerSimpleTextReaderBridge();
}
function unregister() {
  ztoolkit.log("Annotations unregister");
  Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", renderTextSelectionPopup);
  Zotero.Reader.unregisterEventListener("createAnnotationContextMenu", createAnnotationContextMenu);
  while (simpleTextReaderCleanups.length) {
    simpleTextReaderCleanups.pop()?.();
  }
}

function registerSimpleTextReaderBridge() {
  for (const win of Zotero.getMainWindows()) {
    (win as any).__zoteroAnnotationManageTxtBridgeWindowCleanup?.();
    const tabs = (win as any).Zotero_Tabs;
    const deck = tabs?.deck as Element | undefined;
    if (!deck) continue;

    const discover = () => installSimpleTextReaderDocs(win);
    installTxtReturnClickDoc(win.document);
    discover();

    const observer = new win.MutationObserver(discover);
    observer.observe(deck, { childList: true, subtree: true });
    const cleanup = () => {
      observer.disconnect();
      delete (win as any).__zoteroAnnotationManageTxtBridgeWindowCleanup;
    };
    (win as any).__zoteroAnnotationManageTxtBridgeWindowCleanup = cleanup;
    simpleTextReaderCleanups.push(cleanup);
  }
}

function installTxtReturnClickDoc(doc?: Document) {
  if (!doc || txtReturnClickDocs.has(doc)) return;
  txtReturnClickDocs.add(doc);
  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    const link = target?.closest?.("a[data-zam-txt-return-key],a[href*='zam-txt-return=']") as HTMLAnchorElement | null;
    const hrefKey = link?.getAttribute("href")?.match(/[?#&]zam-txt-return=([^&#]+)/)?.[1];
    const noteKey = link?.dataset?.zamTxtReturnKey || (hrefKey ? decodeURIComponent(hrefKey) : "");
    if (!noteKey) return;
    event.preventDefault();
    event.stopPropagation();
    txtLog("return:click", { noteKey });
    returnToTxtNote(noteKey);
  };
  doc.addEventListener("click", onClick, true);
  simpleTextReaderCleanups.push(() => doc.removeEventListener("click", onClick, true));
}

function findTabIDForDoc(win: Window, doc: Document): string | undefined {
  const tabs = (win as any).Zotero_Tabs;
  for (const tab of tabs?._tabs || []) {
    const browsers = Array.from(tab.container?.querySelectorAll?.("browser") || []) as any[];
    for (const browser of browsers) {
      if (browser.contentDocument === doc) return tab.id;
      const innerBrowser = browser.contentDocument?.getElementById?.("reader-browser") as any;
      if (innerBrowser?.contentDocument === doc) return tab.id;
    }
  }
  return undefined;
}

function returnToTxtNote(noteKey: string) {
  const note = getItem(noteKey);
  const meta = note ? parseTextAnnotationNote(note) : null;
  if (!meta) {
    txtLog("return:meta-missing", { noteKey });
    return;
  }
  pendingTxtReturnKey = noteKey;
  const attachment = getItem(meta.attachmentKey) || (Zotero.Items.exists(meta.attachmentID) ? Zotero.Items.get(meta.attachmentID) : undefined);
  if (!attachment) {
    txtLog("return:attachment-missing", { noteKey, attachmentKey: meta.attachmentKey, attachmentID: meta.attachmentID });
    return;
  }
  const pane = Zotero.getActiveZoteroPane() as any;
  const reader = simpleTextReaderJumpers.get(meta.attachmentKey);
  const tabID = reader?.tabID || (reader?.win as any)?.Zotero_Tabs?.getTabIDByItemID?.(attachment.id);
  if (tabID) (reader?.win as any)?.Zotero_Tabs?.select(tabID);
  else pane.selectItem?.(attachment.id);
  txtLog("return:start", { noteKey, attachmentKey: meta.attachmentKey, hasReader: !!reader, tabID });
  const jump = () => {
    const jumped = simpleTextReaderJumpers.get(meta.attachmentKey)?.jump(noteKey);
    txtLog("return:jump-after-open", { noteKey, attachmentKey: meta.attachmentKey, jumped });
    if (jumped) pendingTxtReturnKey = "";
  };
  setTimeout(jump, 300);
  setTimeout(jump, 900);
}

function installSimpleTextReaderDocs(win: Window) {
  const deck = (win as any).Zotero_Tabs?.deck as Element | undefined;
  if (!deck) return;

  deck.querySelectorAll("browser").forEach((browser) => {
    if (!simpleTextReaderBrowsers.has(browser)) {
      simpleTextReaderBrowsers.add(browser);
      const onLoad = () => installSimpleTextReaderDocs(win);
      browser.addEventListener("load", onLoad, true);
      simpleTextReaderCleanups.push(() => browser.removeEventListener("load", onLoad, true));
    }

    const shellDoc = (browser as any).contentDocument as Document | undefined;
    const shellWin = (browser as any).contentWindow as Window | undefined;
    installTxtReturnClickDoc(shellDoc);
    installSimpleTextReaderDoc(win, shellWin, shellDoc);

    const innerBrowser = shellDoc?.getElementById("reader-browser");
    if (innerBrowser && !simpleTextReaderBrowsers.has(innerBrowser)) {
      simpleTextReaderBrowsers.add(innerBrowser);
      const onInnerLoad = () => installSimpleTextReaderDocs(win);
      innerBrowser.addEventListener("load", onInnerLoad, true);
      simpleTextReaderCleanups.push(() => innerBrowser.removeEventListener("load", onInnerLoad, true));
    }
    installSimpleTextReaderDoc(
      win,
      (innerBrowser as any)?.contentWindow as Window | undefined,
      (innerBrowser as any)?.contentDocument as Document | undefined,
    );
    installTxtReturnClickDoc((innerBrowser as any)?.contentDocument as Document | undefined);
  });
}

function installSimpleTextReaderDoc(_win: Window, contentWin?: Window, doc?: Document) {
  if (!contentWin || !doc || !doc.getElementById("content")) return;
  if ((contentWin as any).__zoteroAnnotationManageTxtBridgeInstalled) return;
  if (simpleTextReaderDocs.has(doc)) return;
  (contentWin as any).__zoteroAnnotationManageTxtBridgeCleanup?.();
  if ((contentWin as any).__zoteroAnnotationManageTxtBridgeInstalled) return;
  if (simpleTextReaderDocs.has(doc)) return;

  const bookData = (contentWin as any)._str_bookData || (contentWin.parent as any)?._str_bookData;
  const itemID = Number(bookData?.itemID);
  if (!itemID || !Zotero.Items.exists(itemID)) return;

  const item = Zotero.Items.get(itemID);
  if (!item?.isAttachment?.()) return;
  const contentElement = doc.getElementById("content") as HTMLElement | null;
  if (!contentElement) return;

  txtLog("install", { itemID, title: item.getDisplayTitle?.() });
  (contentWin as any).__zoteroAnnotationManageTxtBridgeInstalled = true;
  simpleTextReaderDocs.add(doc);
  let popup: AnnotationPopup | undefined;
  let timer: number | undefined;
  let interactingWithPopup = false;
  let interactingWithHighlight = false;
  let restoringSelection = false;
  let restoringHighlights = false;
  let restoreHighlightsTimer: number | undefined;
  let lastTextPosition: ReturnType<typeof getTextPositionFromSelection> = null;
  let lastTextPositionAt = 0;
  let lastRange: Range | null = null;
  const excerptButtonStyle = doc.createElement("style");
  excerptButtonStyle.textContent =
    ".str-excerpt-button{display:none!important;}.zam-txt-highlight-segment{background:var(--zam-txt-highlight-bg,rgba(255,212,0,.35));border-bottom:2px solid var(--zam-txt-highlight-color,#ffd400);box-sizing:border-box;}.zam-txt-highlight-action{position:absolute;min-width:18px;height:18px;border:1px solid var(--zam-txt-highlight-color,#ffd400);border-radius:9px;background:#fff;color:#111;font:12px/16px sans-serif;padding:0;pointer-events:auto;z-index:3;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,.18);}.zam-txt-highlight-action::before{content:'...';position:relative;top:-1px}.zam-txt-highlight-menu{position:absolute;display:flex;gap:4px;padding:4px;border:1px solid #bbb;border-radius:4px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.18);pointer-events:auto;z-index:4;white-space:nowrap}.zam-txt-highlight-menu button{height:24px;border:1px solid #bbb;border-radius:4px;background:#fff;color:#111;font:12px/20px sans-serif;padding:1px 8px;cursor:pointer}.zam-txt-highlight-menu button:hover{background:#f2f2f2}.zam-txt-highlight-menu .danger{border-color:#c44;color:#a00}";
  doc.documentElement.appendChild(excerptButtonStyle);

  const isHighlightUiNode = (node: Node | null) => {
    if (!node) return false;
    const element =
      node.nodeType === 1
        ? (node as Element)
        : ((node as ChildNode).parentElement ?? ((node as ChildNode).parentNode as Element | null));
    return !!element?.closest?.(".zam-txt-highlight-overlay,.zam-txt-highlight-menu,.zam-txt-highlight-action");
  };

  const applyTxtHighlight = (position: ReturnType<typeof getTextPositionFromSelection>, color = "#ffd400", key = "") => {
    if (!position) return;
    try {
      const mark = highlightTextPosition(doc, position);
      if (mark) {
        mark.classList.add("zam-txt-highlight");
        mark.dataset.zamTxtNoteKey = key;
        mark.style.setProperty("--zam-txt-highlight-color", color);
        mark.style.setProperty("--zam-txt-highlight-bg", `${color}55`);
        const firstSegment = mark.querySelector(".zam-txt-highlight-segment") as HTMLElement | null;
        if (firstSegment && key) {
          const action = doc.createElement("button");
          action.type = "button";
          action.className = "zam-txt-highlight-action";
          action.title = "打开/删除 TXT 卡片";
          action.style.left = firstSegment.style.left;
          action.style.top = `calc(${firstSegment.style.top} - 20px)`;
          action.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            interactingWithHighlight = true;
            doc.querySelectorAll(".zam-txt-highlight-menu").forEach((el) => el.remove());
            const note = getItem(key);
            if (!note) {
              mark.remove();
              txtLog("highlight:note-missing", { key });
              interactingWithHighlight = false;
              return;
            }
            if (!parseTextAnnotationNote(note, item)) {
              txtLog("highlight:not-txt-note", { key, id: note.id });
              interactingWithHighlight = false;
              return;
            }

            const menu = doc.createElement("span");
            menu.className = "zam-txt-highlight-menu";
            menu.style.left = action.style.left;
            menu.style.top = `calc(${firstSegment.style.top} + 2px)`;
            const closeMenu = () => {
              menu.remove();
              contentWin.setTimeout(() => {
                interactingWithHighlight = false;
              }, 80);
            };
            const openButton = doc.createElement("button");
            openButton.type = "button";
            openButton.textContent = "打开卡片";
            openButton.addEventListener("click", (menuEvent) => {
              menuEvent.preventDefault();
              menuEvent.stopPropagation();
              Zotero.getActiveZoteroPane().selectItem(note.id);
              txtLog("highlight:open-note", { key, id: note.id });
              closeMenu();
            });
            const deleteButton = doc.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "danger";
            deleteButton.textContent = "删除摘录";
            deleteButton.addEventListener("click", async (menuEvent) => {
              menuEvent.preventDefault();
              menuEvent.stopPropagation();
              if (!contentWin.confirm("确定删除这条 TXT 卡片摘录？")) return;
              await note.eraseTx();
              mark.remove();
              txtLog("highlight:deleted", { key, id: note.id });
              closeMenu();
            });
            const closeButton = doc.createElement("button");
            closeButton.type = "button";
            closeButton.textContent = "关闭";
            closeButton.addEventListener("click", (menuEvent) => {
              menuEvent.preventDefault();
              menuEvent.stopPropagation();
              closeMenu();
              txtLog("highlight:menu-close", { key });
            });
            menu.addEventListener(
              "mousedown",
              (menuEvent) => {
                menuEvent.preventDefault();
                menuEvent.stopPropagation();
              },
              true,
            );
            menu.append(openButton, deleteButton, closeButton);
            mark.appendChild(menu);
            txtLog("highlight:menu-open", { key, id: note.id });
          });
          mark.appendChild(action);
        }
      }
      txtLog("highlight:applied", { key, color, hasMark: !!mark, charStart: position.charStart, charEnd: position.charEnd });
    } catch (e) {
      txtLogError("highlight:error", e, { key });
    }
  };

  const jumpToTxtNote = (noteKey: string) => {
    const note = getItem(noteKey);
    const meta = note ? parseTextAnnotationNote(note, item) : null;
    if (!meta) return false;
    const ok = scrollToTextPosition(doc, meta.position);
    txtLog("return:jump", { noteKey, ok });
    return ok;
  };
  const tabID = (_win as any).Zotero_Tabs?.getTabIDByItemID?.(item.id) || findTabIDForDoc(_win, doc);
  simpleTextReaderJumpers.set(item.key, { jump: jumpToTxtNote, win: _win, tabID });
  txtLog("return:register-reader", { attachmentKey: item.key, itemID: item.id, tabID });

  const restoreSavedHighlights = (reason = "manual") => {
    const parentItem = item.parentItem;
    if (!parentItem) return;
    restoringHighlights = true;
    doc.querySelectorAll(".zam-txt-highlight-menu").forEach((el) => el.remove());
    doc.querySelectorAll(".zam-txt-highlight-overlay").forEach((el) => el.remove());
    let count = 0;
    Zotero.Items.get(parentItem.getNotes(false)).forEach((note) => {
      const meta = parseTextAnnotationNote(note, item);
      if (!meta) return;
      applyTxtHighlight(meta.position, meta.color, note.key);
      count += 1;
    });
    txtLog("highlight:restore", { reason, count });
    contentWin.setTimeout(() => {
      restoringHighlights = false;
    }, 120);
  };
  const scheduleRestoreSavedHighlights = (reason: string) => {
    if (restoringHighlights) return;
    if (interactingWithHighlight) return;
    if (restoreHighlightsTimer) contentWin.clearTimeout(restoreHighlightsTimer);
    restoreHighlightsTimer = contentWin.setTimeout(() => {
      restoreHighlightsTimer = undefined;
      restoreSavedHighlights(reason);
    }, 250);
  };
  contentWin.setTimeout(() => restoreSavedHighlights("install"), 300);
  contentWin.setTimeout(() => {
    if (pendingTxtReturnKey && jumpToTxtNote(pendingTxtReturnKey)) pendingTxtReturnKey = "";
  }, 600);
  const highlightObserver = new contentWin.MutationObserver((mutations: MutationRecord[]) => {
    if (restoringHighlights) return;
    const onlyHighlightUiChanged = mutations.every((mutation) => {
      const changedNodes = Array.from(mutation.addedNodes).concat(Array.from(mutation.removedNodes));
      return isHighlightUiNode(mutation.target) || (changedNodes.length > 0 && changedNodes.every(isHighlightUiNode));
    });
    if (onlyHighlightUiChanged) {
      return;
    }
    scheduleRestoreSavedHighlights("mutation");
  });
  highlightObserver.observe(contentElement, { childList: true, attributes: true, attributeFilter: ["class", "style"] });
  highlightObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  if (doc.body) highlightObserver.observe(doc.body, { attributes: true, attributeFilter: ["class", "style"] });

  const restoreSelection = (reason: string) => {
    if (!lastRange) return;
    try {
      restoringSelection = true;
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(lastRange);
      txtLog("restore-selection", { reason, isCollapsed: selection?.isCollapsed, textLen: selection?.toString().length || 0 });
      contentWin.setTimeout(() => {
        restoringSelection = false;
      }, 80);
    } catch (e) {
      restoringSelection = false;
      txtLogError("restore-selection:error", e, { reason });
    }
  };

  const hidePopup = () => {
    txtLog("hide", { hasPopup: !!popup });
    if (timer) {
      contentWin.clearTimeout(timer);
      timer = undefined;
    }
    popup?.rootDiv?.remove();
    popup = undefined;
  };

  const showPopup = () => {
    try {
      if (popup) {
        txtLog("show:skip-existing-popup");
        return;
      }
      const selection = doc.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        txtLog("show:empty-selection", { hasPopup: !!popup, rangeCount: selection?.rangeCount, isCollapsed: selection?.isCollapsed });
        if (!popup) hidePopup();
        return;
      }

      const root = doc.getElementById(`${config.addonRef}-PopupDiv`);
      const commonAncestor = selection.getRangeAt(0).commonAncestorContainer;
      if (root?.contains(commonAncestor)) return;

      const textPosition = getTextPositionFromSelection(doc);
      if (!textPosition) {
        txtLog("show:no-position");
        hidePopup();
        return;
      }
      lastTextPosition = textPosition;
      lastTextPositionAt = Date.now();
      lastRange = selection.getRangeAt(0).cloneRange();
      txtLog("show:create", {
        text: textPosition.text.slice(0, 24),
        len: textPosition.text.length,
        pageIndex: textPosition.pageIndex,
        charStart: textPosition.charStart,
        charEnd: textPosition.charEnd,
      });

      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const left = Math.max(12, Math.min(rect.left, doc.documentElement.clientWidth - 340));
      const top = Math.max(12, rect.bottom + 8);
      const reader = {
        itemID: item.id,
        _item: item,
        _iframeWindow: contentWin,
        _window: contentWin,
        _state: { textSelectionAnnotationMode: "highlight" },
        _primaryView: { _onSetSelectionPopup: hidePopup },
      } as unknown as _ZoteroTypes.ReaderInstance;

      hidePopup();
      popup = new AnnotationPopup(
        reader,
        {
          annotation: {
            text: textPosition.text,
            type: "highlight",
            color: "#ffd400",
            pageLabel: `段落 ${textPosition.pageIndex + 1}`,
            position: textPosition,
          } as unknown as _ZoteroTypes.Annotations.AnnotationJson,
        },
        item,
        doc,
      );

      if (popup.rootDiv) {
        const closeButton = doc.createElement("button");
        closeButton.type = "button";
        closeButton.textContent = "×";
        closeButton.title = "关闭";
        closeButton.style.position = "sticky";
        closeButton.style.top = "0";
        closeButton.style.float = "right";
        closeButton.style.zIndex = "1";
        closeButton.style.width = "24px";
        closeButton.style.height = "24px";
        closeButton.style.margin = "2px";
        closeButton.style.border = "1px solid #bbb";
        closeButton.style.borderRadius = "12px";
        closeButton.style.background = "#fff";
        closeButton.style.cursor = "pointer";
        closeButton.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();
            hidePopup();
            txtLog("show:manual-close");
          },
          true,
        );
        popup.rootDiv.prepend(closeButton);
        popup.rootDiv.addEventListener(
          "mousedown",
          () => {
            interactingWithPopup = true;
            contentWin.setTimeout(() => {
              interactingWithPopup = false;
            }, 300);
          },
          true,
        );
        popup.rootDiv.style.position = "fixed";
        popup.rootDiv.style.left = `${left}px`;
        popup.rootDiv.style.top = `${top}px`;
        popup.rootDiv.style.zIndex = "99990";
        popup.rootDiv.style.maxWidth = "888px";
        popup.rootDiv.style.maxHeight = "320px";
        popup.rootDiv.style.overflowY = "auto";
        doc.body.appendChild(popup.rootDiv);
        txtLog("show:appended", { active: doc.activeElement?.tagName, selectionCollapsed: doc.getSelection()?.isCollapsed });
        contentWin.setTimeout(() => restoreSelection("after-append"), 0);
        contentWin.setTimeout(() => restoreSelection("after-react"), 50);
      }
    } catch (e) {
      txtLogError("show:error", e);
      hidePopup();
    }
  };

  const onSelectionChange = () => {
    if (interactingWithPopup || restoringSelection) {
      txtLog("selection:ignored-transient", { interactingWithPopup, restoringSelection });
      return;
    }
    const selection = doc.getSelection();
    if (popup) {
      const root = doc.getElementById(`${config.addonRef}-PopupDiv`);
      const commonAncestor = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
      if (
        selection &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed &&
        !(commonAncestor && root?.contains(commonAncestor))
      ) {
        const textPosition = getTextPositionFromSelection(doc);
        if (textPosition) {
          lastTextPosition = textPosition;
          lastTextPositionAt = Date.now();
          lastRange = selection.getRangeAt(0).cloneRange();
          if (popup.params?.annotation) {
            popup.params.annotation.text = textPosition.text;
            (popup.params.annotation as any).position = textPosition;
            popup.params.annotation.pageLabel = `段落 ${textPosition.pageIndex + 1}`;
          }
          txtLog("selection:update-while-popup", {
            len: textPosition.text.length,
            pageIndex: textPosition.pageIndex,
            charStart: textPosition.charStart,
            charEnd: textPosition.charEnd,
          });
        }
      } else {
        txtLog("selection:ignored-while-popup", { rangeCount: selection?.rangeCount, isCollapsed: selection?.isCollapsed });
      }
      return;
    }
    txtLog("selection", { hasPopup: !!popup, rangeCount: selection?.rangeCount, isCollapsed: selection?.isCollapsed });
    if (timer) contentWin.clearTimeout(timer);
    timer = contentWin.setTimeout(showPopup, 150);
  };

  doc.addEventListener("selectionchange", onSelectionChange);
  (contentWin as any).__zoteroAnnotationManageGetLastTextPosition = () =>
    lastTextPosition && Date.now() - lastTextPositionAt < 30000 ? lastTextPosition : null;
  (contentWin as any).__zoteroAnnotationManageRestoreSelection = () => restoreSelection("external");
  (contentWin as any).__zoteroAnnotationManageApplyHighlight = applyTxtHighlight;
  const cleanup = () => {
    doc.removeEventListener("selectionchange", onSelectionChange);
    highlightObserver.disconnect();
    if (restoreHighlightsTimer) contentWin.clearTimeout(restoreHighlightsTimer);
    simpleTextReaderJumpers.delete(item.key);
    excerptButtonStyle.remove();
    simpleTextReaderDocs.delete(doc);
    delete (contentWin as any).__zoteroAnnotationManageGetLastTextPosition;
    delete (contentWin as any).__zoteroAnnotationManageRestoreSelection;
    delete (contentWin as any).__zoteroAnnotationManageApplyHighlight;
    delete (contentWin as any).__zoteroAnnotationManageTxtBridgeCleanup;
    delete (contentWin as any).__zoteroAnnotationManageTxtBridgeInstalled;
    hidePopup();
  };
  (contentWin as any).__zoteroAnnotationManageTxtBridgeCleanup = cleanup;
  simpleTextReaderCleanups.push(cleanup);
}

function renderTextSelectionPopup(event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">) {
  const { append, reader, doc, params } = event;

  // Only process supported reader types (PDF, EPUB, Snapshot, TXT)
  // Unknown types (plugins without proper reader) should be skipped
  if (!isSupportedReader(reader)) {
    ztoolkit.log("[annotations] Skipping unsupported reader type");
    return;
  }

  const filename = "annotation.css";
  addCssFile(doc, filename, true);
  // ztoolkit.log("addCssFile doc", doc)
  addCssFile(Zotero.getActiveZoteroPane().document, filename, true);
  addCssFile(reader?._window?.document, filename, true);
  // doc.documentElement.addEventListener("contextmenu", e => {
  //   ztoolkit.log("右键contextmenu", e.buttons, e.button, e.currentTarget, e)
  // })

  // doc.documentElement.addEventListener("click", e => {
  //   ztoolkit.log("右键click", e.buttons, e.button, e.currentTarget, e)
  // })
  const item = Zotero.Items.get(reader.itemID!).parentItem; //ZoteroPane.getSelectedItems()[0]
  const publicationTitle = item?.getField("publicationTitle");
  if (__env__ === "development") {
    //@ts-ignore  Zotero.ref_item
    Zotero.ref_item = { item, params };
  }
  if (item) {
    //@ts-ignore IF11
    ztoolkit.log(
      item,
      "显示IF",
      item.getField("extra"),
      item.getExtraField("IF"),
      ztoolkit.ExtraField.getExtraFields(item),
      ztoolkit.ExtraField.getExtraField(item, "IF"),
    );
  }
  if (__env__ === "development") {
    //@ts-ignore  Zotero.ref_reader
    Zotero.ref_reader = reader;
    //@ts-ignore  Zotero.ref_reader
    Zotero.ref_reader_annotationManager = reader._annotationManager;
    //@ts-ignore  Zotero.ref_reader
    Zotero.ref_reader_keyboardManager = reader._keyboardManager;
  }

  if (getPref("hide-in-selection-popup")) {
    return;
  }
  const ap = new AnnotationPopup(reader, params);

  // addon.data.test = ap;
  const div = ap.rootDiv;
  // const div = createDiv(reader, params);
  if (div) {
    // append(div);
    // reader?._iframeWindow?.document.body.appendChild(div)
    append(div);
  }
}
function createAnnotationContextMenu(event: _ZoteroTypes.Reader.EventParams<"createAnnotationContextMenu">) {
  const { reader, params, append } = event;

  // Only process supported reader types
  if (!isSupportedReader(reader)) {
    ztoolkit.log("[annotations] Skipping unsupported reader type for context menu");
    return;
  }

  if (getPref("hide-in-annotation-context-menu")) {
    return;
  }
  const doc = reader?._iframeWindow?.document;
  if (!doc) return;
  //这里不能用异步
  const currentAnnotations = reader._item.getAnnotations().filter((f) => params.ids.includes(f.key));
  const currentTags = groupBy(
    currentAnnotations.flatMap((f) => f.getTags()),
    (t7) => t7.tag,
  ).sort(sortValuesLength);
  const currentTagsString = currentTags.map((f) => `${f.key}[${f.values.length}]`).join(",");
  const label =
    currentTags.length > 0
      ? `添加标签，已有${currentTags.length}个Tag【${currentTagsString.length > 11 ? currentTagsString.slice(0, 10) + "..." : currentTagsString}】`
      : "添加标签";
  //

  append({
    label: label,
    onCommand: () => {
      // const div = createDiv(reader, params);
      const popDiv = new AnnotationPopup(reader, params);
      const div = popDiv.rootDiv;
      // popDiv.startCountDown();
      // popDiv.countDown.start();
      if (div) {
        doc.body.appendChild(div);
      }
    },
  });
  if (currentAnnotations.length == 1 && currentAnnotations[0].hasTag("量表")) {
    append({
      label: "指定为最近的量表",
      onCommand: () => {
        setPref("lastScaleKey", currentAnnotations[0].key);
        setPref("lastScaleItemKey", "");
      },
    });
  }
  const lastScale = getItem(getPref("lastScaleKey") as string);
  if (currentAnnotations.length == 1 && currentAnnotations[0].hasTag("量表item") && lastScale.parentKey == reader._item.key) {
    append({
      label: "指定为最近的量表item",
      onCommand: () => {
        const scale = new Relations(currentAnnotations[0]).getLinkRelationItems().find((f) => f.hasTag("量表"));
        if (scale) {
          setPref("lastScaleKey", scale.key);
          setPref("lastScaleItemKey", currentAnnotations[0].key);
        }
      },
    });
  }
}

export default { register, unregister, AnnotationPopup };
