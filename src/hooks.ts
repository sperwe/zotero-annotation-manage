import { BasicExampleFactory, HelperExampleFactory, KeyExampleFactory, PromptExampleFactory, UIExampleFactory } from "./modules/examples";
import { config } from "../package.json";
import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts, registerPrefsWindow } from "./modules/preferenceScript";
// import { createZToolkit } from "./utils/ztoolkit";
import Annotations from "./modules/annotations";
import AnnotationsToNote, { getSelectedItems } from "./modules/menu";
import RelationHeader from "./modules/RelationHeader";
import highlightWords from "./modules/highlightWords";
import toolLink from "./modules/referenceMark";
import { actionTranAnnotations } from "./action/action-tran-annotations";
import { memFixedColor, stopPropagation } from "./utils/zzlb";
import { exportNoteByType, exportSingleNote, getAllAnnotations } from "./modules/AnnotationsToNote";
import { groupBy } from "./utils/groupBy";
import { sortFixedTags10ValuesLength, sortValuesLength } from "./utils/sort";
// import { TagElementProps } from "zotero-plugin-toolkit/dist/tools/ui";
import { annotationToNoteTags, annotationToNoteType, annotationToNoteColor } from "./hooksMenuEvent";
import { createZToolkit } from "./utils/ztoolkit";
import { txtLog } from "./utils/txtLog";

const keyLInterceptorDocs = new WeakSet<Document>();
const keyLKnownDocs = new Set<Document>();
const keyLInterceptorWindows = new WeakSet<Window>();
const keyLInterceptorCleanups: Array<() => void> = [];
const readAloudGuardedReaders = new WeakSet<object>();

function isElementLike(node: unknown): node is Element {
  return !!node && typeof node === "object" && (node as Node).nodeType === 1 && typeof (node as Element).matches === "function";
}

function isEditableElement(element: Element): boolean {
  const editable = element.getAttribute("contenteditable");
  return (
    element.matches("input, textarea, select") ||
    editable === "" ||
    (editable != null && editable.toLowerCase() !== "false") ||
    !!element.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [data-zam-annotation-card], .selection-popup")
  );
}

function isEditableKeyTarget(event: KeyboardEvent): boolean {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const current = event.currentTarget as Document | Window | null;
  const activeElement = current instanceof Document ? current.activeElement : current?.document?.activeElement;
  const nodes = path.length ? path : [event.target, activeElement].filter(Boolean);
  return nodes.some((node) => {
    if (!isElementLike(node)) return false;
    return isEditableElement(node);
  });
}

function docHasFocusedEditable(doc?: Document | null): boolean {
  const active = doc?.activeElement;
  return isElementLike(active) && isEditableElement(active);
}

function shouldBlockReaderReadAloud(reader: any) {
  const docs = [
    reader?._iframeWindow?.document,
    reader?._primaryView?._iframeWindow?.document,
    reader?._lastView?._iframeWindow?.document,
    reader?._window?.document,
    Zotero.getMainWindow?.()?.document,
    ...Array.from(keyLKnownDocs),
  ];
  return docs.some(docHasFocusedEditable);
}

function guardReadAloudTarget(target: any) {
  if (!target || typeof target !== "object" || readAloudGuardedReaders.has(target)) return;
  if (typeof target.startReadAloudAtPosition !== "function") return;
  readAloudGuardedReaders.add(target);

  const originalStart = target.startReadAloudAtPosition;
  target.startReadAloudAtPosition = function (...args: unknown[]) {
    if (shouldBlockReaderReadAloud(this)) {
      txtLog("keyl:block-start-read-aloud", {
        activeTag:
          this?._iframeWindow?.document?.activeElement?.tagName ||
          this?._primaryView?._iframeWindow?.document?.activeElement?.tagName ||
          Zotero.getMainWindow?.()?.document?.activeElement?.tagName,
      });
      return;
    }
    return originalStart.apply(this, args);
  };
  txtLog("keyl:guard-installed", {
    hasIframe: !!target._iframeWindow,
    hasPrimaryView: !!target._primaryView,
  });
}

function installReadAloudGuards() {
  for (const reader of Array.from((Zotero.Reader as any)?._readers || [])) {
    guardReadAloudTarget(reader);
    guardReadAloudTarget((reader as any)?._internalReader);
  }
}

function interceptReaderKeyL(event: KeyboardEvent) {
  if (event.code !== "KeyL" && event.key?.toLowerCase() !== "l") return;
  if (!isEditableKeyTarget(event)) return;
  ztoolkit.log("[KeyL interceptor] stop in editable", event.code, event.key);
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function addKeyLListenerToWindow(win?: Window | null) {
  if (!win || keyLInterceptorWindows.has(win)) return;
  keyLInterceptorWindows.add(win);
  win.addEventListener("keydown", interceptReaderKeyL, true);
  keyLInterceptorCleanups.push(() => win.removeEventListener("keydown", interceptReaderKeyL, true));
}

function addKeyLListenerToDoc(doc?: Document | null) {
  if (!doc || keyLInterceptorDocs.has(doc)) return;
  keyLInterceptorDocs.add(doc);
  keyLKnownDocs.add(doc);
  doc.addEventListener("keydown", interceptReaderKeyL, true);
  keyLInterceptorCleanups.push(() => {
    doc.removeEventListener("keydown", interceptReaderKeyL, true);
    keyLKnownDocs.delete(doc);
  });
  addKeyLListenerToWindow(doc.defaultView);
}

function installKeyLInterceptors(win: Window) {
  (win as any).__zoteroAnnotationManageKeyLCleanup?.();

  const discoverDocs = () => {
    addKeyLListenerToDoc(win.document);
    for (const iframe of Array.from(win.document.querySelectorAll("iframe,browser")) as HTMLIFrameElement[]) {
      try {
        addKeyLListenerToDoc(iframe.contentDocument);
      } catch (e) {
        ztoolkit.log("[KeyL interceptor] iframe discover error", e);
      }
    }
    installReadAloudGuards();
  };

  discoverDocs();
  const observer = new win.MutationObserver(discoverDocs);
  observer.observe(win.document.documentElement, { childList: true, subtree: true });
  const cleanup = () => {
    observer.disconnect();
    delete (win as any).__zoteroAnnotationManageKeyLCleanup;
  };
  (win as any).__zoteroAnnotationManageKeyLCleanup = cleanup;
  keyLInterceptorCleanups.push(cleanup);
  ztoolkit.log("[KeyL interceptor] installed");
}

async function onStartup() {
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);

  initLocale();

  BasicExampleFactory.registerPrefs();

  await Promise.all(Zotero.getMainWindows().map((win) => onMainWindowLoad(win)));
  // self = window;
}

async function onMainWindowLoad(win: Window): Promise<void> {
  await new Promise((resolve) => {
    if (win.document.readyState !== "complete") {
      win.document.addEventListener("readystatechange", () => {
        if (win.document.readyState === "complete") {
          resolve(void 0);
        }
      });
    }
    resolve(void 0);
  });

  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);

  // Services.scriptloader.loadSubScript(
  //   `chrome://${config.addonRef}/content/scripts/customElements.js`,
  //   win,
  // );

  (win as any).MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);

  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();
  win.console.log("onMainWindowLoad");

  Annotations.register();
  AnnotationsToNote.register();
  RelationHeader.register();
  highlightWords.register();
  toolLink.register();
  // registeredID_showAnnotations()
  registerPrefsWindow();

  // Zotero Reader maps KeyL to Read Aloud. Keep that shortcut in normal
  // browsing, but stop it while focus is inside plugin/editor inputs.
  installKeyLInterceptors(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  win.console.log("onMainWindowUnload");
  Annotations.unregister();
  AnnotationsToNote.unregister();
  RelationHeader.unregister();
  highlightWords.unregister();
  toolLink.unregister();
  (win as any).__zoteroAnnotationManageKeyLCleanup?.();
  // unregisteredID_showAnnotations()
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  win.document.querySelector(`[href="${config.addonRef}-mainWindow.ftl"]`)?.remove();
}

function onShutdown(): void {
  ztoolkit.log("onShutdown");
  while (keyLInterceptorCleanups.length) {
    keyLInterceptorCleanups.pop()?.();
  }
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  // @ts-ignore - Plugin instance is not typed
  delete Zotero[config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this funcion clear.
 */
async function onNotify(event: string, type: string, ids: Array<string | number>, extraData: { [key: string]: any }) {
  // You can add your code to the corresponding notify type
  ztoolkit.log("notify", event, type, ids, extraData);
  if (event == "select" && type == "tab" && extraData[ids[0]].type == "reader") {
    BasicExampleFactory.exampleNotifierCallback();
  } else {
    return;
  }
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

function onShortcuts(type: string) {
  switch (type) {
    case "larger":
      KeyExampleFactory.exampleShortcutLargerCallback();
      break;
    case "smaller":
      KeyExampleFactory.exampleShortcutSmallerCallback();
      break;
    default:
      break;
  }
}

async function onMenuEvent(type: "annotationToNoteTags" | "annotationToNoteType" | "annotationToNoteColor", data: { [key: string]: any }) {
  switch (type) {
    case "annotationToNoteTags":
      annotationToNoteTags(data.window, data.type);
      break;
    case "annotationToNoteType":
      annotationToNoteType(data.window, data.type);
      break;
    case "annotationToNoteColor":
      annotationToNoteColor(data.window, data.type);
      break;
    default:
      return;
  }
}

function onDialogEvents(type: string) {
  switch (type) {
    case "dialogExample":
      HelperExampleFactory.dialogExample();
      break;
    case "clipboardExample":
      HelperExampleFactory.clipboardExample();
      break;
    case "filePickerExample":
      HelperExampleFactory.filePickerExample();
      break;
    case "progressWindowExample":
      HelperExampleFactory.progressWindowExample();
      break;
    case "vtableExample":
      HelperExampleFactory.vtableExample();
      break;
    default:
      break;
  }
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
  onMenuEvent,
};
