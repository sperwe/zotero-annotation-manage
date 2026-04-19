import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import { sortValuesLength } from "../utils/sort";
import { addCssFile, getItem, isDebug } from "../utils/zzlb";
import { groupBy } from "../utils/groupBy";
import { AnnotationPopup } from "./AnnotationPopup";
import { Relations } from "../utils/Relations";
import { isSupportedReader, isSimpleTextReader } from "../utils/readerType";
import { getTextPositionFromSelection } from "../utils/textPosition";
// import { text2Ma } from "./readerTools";

const simpleTextReaderCleanups: Array<() => void> = [];
const simpleTextReaderDocs = new WeakSet<Document>();
const simpleTextReaderBrowsers = new WeakSet<Element>();

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
    const tabs = (win as any).Zotero_Tabs;
    const deck = tabs?.deck as Element | undefined;
    if (!deck) continue;

    const discover = () => installSimpleTextReaderDocs(win);
    discover();

    const observer = new win.MutationObserver(discover);
    observer.observe(deck, { childList: true, subtree: true });
    simpleTextReaderCleanups.push(() => observer.disconnect());
  }
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
  });
}

function installSimpleTextReaderDoc(_win: Window, contentWin?: Window, doc?: Document) {
  if (!contentWin || !doc || simpleTextReaderDocs.has(doc) || !doc.getElementById("content")) return;

  const bookData = (contentWin as any)._str_bookData || (contentWin.parent as any)?._str_bookData;
  const itemID = Number(bookData?.itemID);
  if (!itemID || !Zotero.Items.exists(itemID)) return;

  const item = Zotero.Items.get(itemID);
  if (!item?.isAttachment?.()) return;

  simpleTextReaderDocs.add(doc);
  let popup: AnnotationPopup | undefined;
  let timer: number | undefined;
  let interactingWithPopup = false;

  const hidePopup = () => {
    popup?.rootDiv?.remove();
    popup = undefined;
  };

  const showPopup = () => {
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hidePopup();
      return;
    }

    const root = doc.getElementById(`${config.addonRef}-PopupDiv`);
    const commonAncestor = selection.getRangeAt(0).commonAncestorContainer;
    if (root?.contains(commonAncestor)) return;

    const textPosition = getTextPositionFromSelection(doc);
    if (!textPosition) {
      hidePopup();
      return;
    }

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
    }
  };

  const onSelectionChange = () => {
    if (interactingWithPopup) return;
    if (timer) contentWin.clearTimeout(timer);
    timer = contentWin.setTimeout(showPopup, 150);
  };

  doc.addEventListener("selectionchange", onSelectionChange);
  simpleTextReaderCleanups.push(() => {
    doc.removeEventListener("selectionchange", onSelectionChange);
    hidePopup();
  });
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
