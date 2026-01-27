import { config } from "../../package.json";
import * as React from "react";
import { Timer, createTopDiv, getAnnotationContent, getItem, getPublicationTags, memSVG, openAnnotation } from "../utils/zzlb";
import { Relations } from "../utils/Relations";
import { waitUtilAsync } from "../utils/wait";
import { getPref } from "../utils/prefs";
import { compare, sortAsc } from "../utils/sort";
import { DialogHelper } from "zotero-plugin-toolkit";
// import { DialogHelper } from "zotero-plugin-toolkit/dist/helpers/dialog";

function register() {
  Zotero.Reader.registerEventListener("renderToolbar", readerToolbarCallback, config.addonID);
  Zotero.Reader.registerEventListener("renderSidebarAnnotationHeader", renderSidebarAnnotationHeaderCallback, config.addonID);
}
function unregister() {
  Zotero.Reader.unregisterEventListener("renderToolbar", readerToolbarCallback);
  Zotero.Reader.unregisterEventListener("renderSidebarAnnotationHeader", renderSidebarAnnotationHeaderCallback);
}
export default { register, unregister };
function readerToolbarCallback(event: Parameters<_ZoteroTypes.Reader.EventHandler<"renderToolbar">>[0]) {
  const { append, doc, reader, params } = event;
  // ztoolkit.log("readerToolbarCallback reader.css");
  copyFunc(doc, "readerToolbarCallback");
  // injectCSS(doc, "reader1.css");
}

function renderSidebarAnnotationHeaderCallback(event: Parameters<_ZoteroTypes.Reader.EventHandler<"renderSidebarAnnotationHeader">>[0]) {
  const { append, doc, reader, params } = event;
  // copyFunc(doc, "renderSidebarAnnotationHeaderCallback");
  if (getPref("hide-annotation-link")) return;
  // ztoolkit.log(event, params.annotation.id);
  // await waitFor(()=>getItem(params.annotation.id))
  const relations = new Relations(params.annotation.id);
  // ztoolkit.log("新建的item",params.annotation.id,

  // getItem(params.annotation.id);
  // relations.getLinkRelations()
  // const relatedAnnotations= getRelatedAnnotations(ann);
  const linkAnnotations = relations.getLinkRelations();
  // ztoolkit.log("readerToolbarCallback111", params, linkAnnotations);
  const userActions: HTMLElement[] = [];

  const add = ztoolkit.UI.createElement(doc, "span", {
    namespace: "html",
    id: `renderSidebarAnnotationHeader-add-${params.annotation.id}`,
    properties: { textContent: "🧷", title: "添加双链" },
    classList: ["zotero-annotation-manage-red"],
    listeners: [
      {
        type: "click",
        listener: (_e: Event) => {
          // const r = new Relations(params.annotation.id);
          // const man = Relations.allOpenPdf(addon.data.copy);
          // r.addRelations(man.map((a) => a.openPdf));

          const openPdfs = Relations.getItemURIs(addon.data.copyText);

          if (openPdfs.length > 0) {
            relations.addRelations(openPdfs);
            new ztoolkit.ProgressWindow("添加双链", {
              closeOnClick: true,
            })
              .createLine({ text: "准备添加" + openPdfs.length + "项" })
              .createLine({
                text: "已添加" + relations.getLinkRelations().length + "项",
              })
              .show()
              .startCloseTimer(5000, false);
          } else {
            ztoolkit.log("请先复制至少一个批注", addon.data.copyText, openPdfs);
            new ztoolkit.ProgressWindow("添加双链", {
              closeOnClick: true,
            })
              .createLine({ text: "请先复制至少一个批注" })
              .createLine({ text: addon.data.copyText })
              .show()
              .startCloseTimer(5000, false);
          }
        },
      },
      {
        type: "mouseover",
        listener: (e: Event) => {
          (e.target as HTMLElement).style.backgroundColor = "#F0F0F0";
        },
      },
      {
        type: "mouseout",
        listener: (e: Event) => {
          (e.target as HTMLElement).style.removeProperty("background-color");
        },
      },
    ],
    enableElementRecord: false,
    ignoreIfExists: true,
  });
  userActions.push(add);
  // ztoolkit.log("userActions1", userActions);
  if (linkAnnotations && linkAnnotations.length > 0) {
    const u = ztoolkit.UI.createElement(doc, "span", {
      namespace: "html",
      id: config.addonRef + `renderSidebarAnnotationHeader-link-${params.annotation.id}`,
      properties: {
        textContent: "🍡",
        title: "双链" + linkAnnotations.length + "项",
      },
      listeners: [
        {
          type: "click",
          listener: async (e: Event) => {
            e.preventDefault();
            const anKey = params.annotation.id;
            const win = await createRelatedDialog(doc, anKey);
            const { fromEle, left, top } = getFromEleLeftTop(doc, anKey);
            await createRelatedContent(anKey, win, undefined, fromEle);
            // await waitFor(() => win.document.querySelector(".loaded"));
            await waitUtilAsync(() => !!win.document.querySelector(".loaded"));
            await relatedDialogResize(win, top, left);
            Zotero.getMainWindow()
              .document.getElementById(config.addonRef + `-renderSidebarAnnotationHeader-TopDiv`)
              ?.remove();
          },
        },
        {
          type: "mouseover",
          listener: async (e: Event) => {
            (e.target as HTMLElement).style.backgroundColor = "#F0F0F0";
            // createPopupDiv(doc, params.annotation.id);
            if (addon.data.relationDialog) return;
            const anKey = params.annotation.id;
            const { fromEle, left, top } = getFromEleLeftTop(doc, anKey);
            const div = await createRelatedPopupDiv(doc, anKey);
            div.style.left = left + "px";
            div.style.top = Math.max(top, 118) + "px";
            await createRelatedContent(anKey, undefined, div, fromEle);
          },
        },
        {
          type: "mouseout",
          listener: (e: Event) => {
            (e.target as HTMLElement).style.removeProperty("background-color");
          },
        },
      ],
      enableElementRecord: false,
      ignoreIfExists: true,
    });
    userActions.push(u);
  }
  // ztoolkit.log("userActions2", userActions);
  if (userActions.length > 0) append(...userActions);
}
async function createRelatedPopupDiv(readerDoc: Document, anKey: string) {
  const rootDoc = Zotero.getMainWindow().document;
  const div = createTopDiv(rootDoc, config.addonRef + `-renderSidebarAnnotationHeader-TopDiv`, [
    {
      tag: "div",
      properties: { textContent: "" },
      classList: ["content"],
      styles: {
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "flex-start",
        background: "#eeeeee",
      },
    },
  ])!;
  const content = div.querySelector(".content")! as HTMLDivElement;
  const { fromEle, left, top } = getFromEleLeftTop(readerDoc, anKey);
  const fromMouseTimer = new Timer(() => div.remove());
  fromEle.addEventListener("mouseover", () => {
    fromMouseTimer.clearTimer();
    setTimeout(() => fromMouseTimer.clearTimer(), 50);
  });
  fromEle.addEventListener("mouseout", () => {
    fromMouseTimer.startTimer();
  });

  content.addEventListener("mouseover", () => {
    fromMouseTimer.clearTimer();
  });

  content.style.left = left + "px";
  content.style.top = Math.max(top, 118) + "px";
  return div;
}
function getFromEleLeftTop(readerDoc: Document, anKey: string) {
  const fromEle = readerDoc.getElementById(config.addonRef + `renderSidebarAnnotationHeader-link-${anKey}`) as HTMLElement;
  const left = fromEle.offsetLeft + 25;
  const sliderAnnotations = readerDoc.getElementById("annotations");
  const scrollTop = sliderAnnotations?.scrollTop || 0;
  const top = fromEle.offsetTop - scrollTop;
  ztoolkit.log("定位 top", sliderAnnotations, fromEle.offsetTop, fromEle.clientTop, scrollTop);
  return { fromEle, left, top };
}

async function createRelatedContent(anKey: string, win: Window | undefined, div: HTMLDivElement | undefined, fromEle: HTMLElement) {
  const content = win
    ? (win.document.querySelector(".content") as HTMLDivElement)
    : div
      ? (div.querySelector(".content") as HTMLDivElement)
      : undefined;
  if (!content) return;
  const anFrom = getItem(anKey);
  const anFromRelations = new Relations(anFrom);
  const fromLinkRelations = anFromRelations.getLinkRelations();
  ztoolkit.log("fromLinkRelations", fromLinkRelations);
  const toAns = fromLinkRelations
    .map((toItemURI) => ({
      toItemURI,
      type: "链接",
      ann: getItem(Zotero.URI.getURIItemID(toItemURI) || ""),
    }))
    // .map((a) =>
    //   Object.assign(a, {
    //     parentID: a.ann.parentID,
    //     annotationPageLabel: parseInt(a.ann.annotationPageLabel),
    //     annotationPosition: a.ann.annotationPosition,
    //   }),
    // )
    // .sort(
    //    compare(
    //      "parentID",
    //      "annotationPageLabel",
    //      "annotationPosition",
    //      undefined,
    //    ),
    // );
    .sort(
      (a, b) =>
        sortAsc(b.ann.parentItem?.parentItem?.getField("year"), b.ann.parentItem?.parentItem?.getField("year")) * 1000 +
        sortAsc(a.ann.parentItemKey || undefined, b.ann.parentItemKey || undefined) * 10 +
        sortAsc(a.ann.annotationSortIndex, b.ann.annotationSortIndex),
    );
  content.innerHTML = "";
  const fromURI = Zotero.URI.getItemURI(anFrom);
  for (const to of [{ ann: anFrom, type: "来源", toItemURI: fromURI }, ...toAns]) {
    const anTo = to.ann;
    const toItemURI = to.toItemURI;
    const type = to.type;
    const u2 = ztoolkit.UI.appendElement(
      {
        tag: "div",
        namespace: "html",
        styles: {
          padding: "5px",
          marginRight: "20px",
          display: "flex",
          alignItems: "stretch",
          flexDirection: "column",
          width: "260px",
          background: "#fff",
          borderRadius: "5px",
          margin: "4px",
        },
        properties: { textContent: "" },
        children: [
          {
            tag: "div",
            styles: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            },
            children: [
              {
                tag: "span",
                styles: { color: anTo.annotationColor },
                properties: {
                  textContent: anTo.annotationType,
                  innerHTML:
                    (await memSVG(`chrome://${config.addonRef}/content/16/annotate-${anTo.annotationType}.svg`)) || anTo.annotationType,
                },
              },
              {
                tag: "span",
                namespace: "html",
                styles: {},
                properties: {
                  textContent: `${type}:${anTo.parentItem?.parentItem?.getField("firstCreator")},${anTo.parentItem?.parentItem?.getField("year")}`,
                },
                listeners: [
                  {
                    type: "click",
                    listener: (e: any) => {
                      e.stopPropagation();
                      ztoolkit.log("点击", e, e.clientX, e.target);
                      const d = showTitle(anTo, e.clientX, e.clientY, content);
                      // new Timer(() => d.remove()).startTimer(500);
                    },
                    options: { capture: true },
                  },
                  {
                    type: "mouseover",
                    listener: (e: any) => {
                      ztoolkit.log("鼠标进入", e, e.clientX, e.target);
                      const d = showTitle(anTo, e.clientX, e.clientY, content);
                      // new Timer(() => d.remove()).startTimer(500);
                    },
                  },
                ],
              },
              // {
              //   tag: "span",
              //   styles: {},
              //   properties: {
              //     textContent:
              //       anTo.parentItem?.parentItem?.getDisplayTitle()
              //         .substring(0, 15) + "...",
              //     title:anTo.parentItem?.parentItem?.firstCreator,
              //   },
              // },
              {
                tag: "div",
                namespace: "html",
                styles: {
                  color: "red",
                  fontSize: "1.5em",
                  paddingRight: "5px",
                },
                properties: {
                  textContent: fromURI == toItemURI ? "❌" : "🗑",
                  title: fromURI == toItemURI ? "清空" : "删除",
                },
                listeners: [
                  {
                    type: "click",
                    listener: (e: { stopPropagation: () => void }) => {
                      e.stopPropagation();
                      // ztoolkit.log("remove 1", anFromRelations.getLinkRelations());
                      anFromRelations.removeRelations([toItemURI]);
                      u2.remove();
                      // ztoolkit.log("remove 2", anFromRelations.getLinkRelations());
                      if (anFromRelations.getLinkRelations().length == 0) {
                        win?.close();
                        div?.remove();
                        fromEle.remove();
                      }
                    },
                    options: { capture: true },
                  },
                ],
              },
            ],
          },
          {
            tag: "div",
            listeners: [
              {
                type: "click",
                listener: (e: { stopPropagation: () => void }) => {
                  e.stopPropagation();
                  if (anTo.parentItemKey) openAnnotation(anTo.parentItemKey, anTo.annotationPageLabel, anTo.key);
                },
                options: { capture: true },
              },
            ],
            children: [
              // {
              //   tag: "div",
              //   styles: {  },
              //   properties: { textContent: anTo.parentItem?.parentItem?.getDisplayTitle().substring(0,10)+"..." },
              // },
              {
                tag: "div",
                styles: {
                  background: anTo.annotationColor + "60", //width: "200px",
                  maxHeight: "100px",
                  overflowY: "overlay",
                },
                properties: { innerHTML: await getAnnotationContent(anTo) },
              },
              {
                tag: "div",
                styles: {
                  background: anTo.annotationColor + "10", //width: "200px"
                },
                properties: {
                  innerHTML:
                    anTo
                      .getTags()
                      .map((a) => a.tag)
                      .join(",") + getPublicationTags(anTo),
                },
              },
            ],
          },
        ],
      },
      content,
    ) as HTMLDivElement;
  }
  ztoolkit.UI.appendElement(
    {
      tag: "span",
      namespace: "html",
      classList: ["loaded"],
    },
    content,
  );
}

export function showTitle(anTo: Zotero.Item, x: number, y: number, parent: HTMLElement, ms: number = 500) {
  const title = anTo.parentItem?.parentItem?.getDisplayTitle() || "";

  const d = ztoolkit.UI.appendElement(
    {
      tag: "span",
      namespace: "html",
      id: config.addonRef + `-annotation-show-title`,
      removeIfExists: true,
      properties: {
        textContent: title,
      },
      styles: {
        position: "fixed",
        zIndex: "9999",
        left: x - 100 + "px",
        top: y + 1 + "px",
        background: "#000000",
        color: "#ffffff",
        padding: "5px",
        borderRadius: "4px",
      },
      listeners: [
        {
          type: "click",
          listener: () => {
            //点击标题栏复制条目标题
            new ztoolkit.Clipboard().addText(title).copy();
            new ztoolkit.ProgressWindow("复制标题").createLine({ text: title }).show(5000);
            d.remove();
          },
        },
      ],
    },
    parent,
  ) as HTMLSpanElement;
  if (ms > 0) {
    new Timer(() => d.remove()).startTimer(ms);
  }
  return d;
}
async function createRelatedDialog(readerDoc: Document, anKey: string) {
  ztoolkit.log(" Zotero.getMainWindow().screenLeft", Zotero.getMainWindow().screenLeft);
  const mainWindow = Zotero.getMainWindow();
  const { fromEle, left, top } = getFromEleLeftTop(readerDoc, anKey);
  let dialogHelper: DialogHelper | undefined = addon.data.relationDialog;

  if (dialogHelper == null) {
    const dialogData: { [key: string | number]: any } = {
      inputValue: "test",
      checkboxValue: true,
      loadCallback: () => {
        ztoolkit.log(dialogData, "Dialog Opened!");
        addon.data.relationDialog = dialogHelper;
      },
      unloadCallback: () => {
        ztoolkit.log(dialogData, "Dialog closed!");
        addon.data.relationDialog = undefined;
      },
    };

    dialogHelper = new ztoolkit.Dialog(1, 1)
      .addCell(0, 0, {
        tag: "div",
        classList: ["content"],
        // properties: {textContent:"111"},
        styles: {
          minHeight: "20px",
          minWidth: "100px",
          display: "flex",
          maxHeight: mainWindow.innerHeight - 40 + "px",
          maxWidth: Math.max(mainWindow.outerWidth - left - 100, 1000) + "px",
          flexWrap: "wrap",
          overflowY: "overlay",
        },
      })
      // .addButton("Confirm", "confirm")
      // .addButton("Cancel", "cancel")
      // .addButton("Help", "help", {
      //   noClose: true,
      //   callback: (e) => {
      //   },
      // })
      .setDialogData(dialogData)
      .open("相关标签", {
        alwaysRaised: true,
        left: left,
        top: top,
        fitContent: true,
        resizable: true,
      }) as DialogHelper;
    // injectCSS(dialogHelper.window.document, "related.css");
  }
  const fromMouseTimer = new Timer(() => {
    dialogHelper?.window?.close();
  });
  fromEle.addEventListener("mouseover", () => {
    fromMouseTimer.clearTimer();
  });
  fromEle.addEventListener("mouseout", () => {
    fromMouseTimer.startTimer();
  });

  // await waitFor(() => dialogHelper.window.document.querySelector(".content"));
  await waitUtilAsync(() => !!dialogHelper?.window?.document.querySelector(".content"));
  // ztoolkit.log("窗口2",dialogHelper.window)
  const content = dialogHelper.window.document.querySelector(".content")! as HTMLDivElement;
  content.addEventListener("mouseover", () => {
    fromMouseTimer.clearTimer();
  });
  return dialogHelper.window;
}

async function relatedDialogResize(win: Window, top: number, left: number) {
  const mainWindow = Zotero.getMainWindow();
  (win as any).sizeToContent();
  if (win.outerHeight + top - mainWindow.outerHeight > 0) {
    win.moveTo(left, Math.max(0, mainWindow.outerHeight - win.outerHeight - 20));
  }
}

// async function getAnnotationContent(ann: Zotero.Item) {
//   const html = (await Zotero.BetterNotes.api.convert.annotations2html([ann], {
//     noteItem: undefined,
//   })) as string;
//   const html2 = html
//     .replace(
//       /<img (?<attrs>(?!style).*)\/>/g,
//       '<div style="height:100px"><img style="height:100%;width:100%;object-fit:contain;" $<attrs>/></div>',
//     ) //图片自适应  如果已经有style属性了，那么就跳过
//     .replace(/<br>/g, "<br/>") // br 导致无法显示
//     .replace(/<\/br>/g, "") // br 导致无法显示
//     .replace(/<p>/g, `<p style="margin:0px">`); // 缩减头尾的空白
//   // ztoolkit.log(html, html2);
//   return html2;
// }

function getRelatedItemsAnnotations(ann: Zotero.Item) {
  if (ann.relatedItems && ann.relatedItems.length > 0) {
    const relatedItemsA = Zotero.Items.get(ann.relatedItems);
    ztoolkit.log("getRelatedAnnotations", relatedItemsA);
    return relatedItemsA.filter((f) => f.isAnnotation());
  }
  return [];
}

function copyFunc(doc: Document, copyFrom: string = "") {
  if ((doc as any)._copyFrom) return;
  (doc as any)._copyFrom = copyFrom;
  doc.addEventListener("copy", function (e) {
    // clipboardData 对象是为通过编辑菜单、快捷菜单和快捷键执行的编辑操作所保留的，也就是你复制或者剪切内容
    //@ts-ignore window.clipboardData
    const clipboardData = e.clipboardData || window.clipboardData;
    // 如果 未复制或者未剪切，直接 return
    if (!clipboardData) return;
    // Selection 对象 表示用户选择的文本范围或光标的当前位置。
    // 声明一个变量接收 -- 用户输入的剪切或者复制的文本转化为字符串
    const text = clipboardData.getData("text") as string;
    // ztoolkit.log("123 copy", doc, clipboardData, clipboardData.getData("text"));
    if (!text) return;
    // const man = text2Ma(text);
    const man = Relations.getOpenPdfs(text);
    ztoolkit.log(man);
    doc.querySelector(`#${config.addonRef}-copy-annotations`)?.remove();
    if (man.length == 0) return;
    addon.data.copyText = text;
    ztoolkit.log("复制内容 有效", addon.data.copyText, man);
    const div = createTopDiv(doc, `${config.addonRef}-copy-annotations`, [
      {
        tag: "div",
        classList: ["query"],
      },
      {
        tag: "div",
        classList: ["content"],
      },
    ])!;

    div.style.left = "10px";
    div.style.top = "45px";
    div.style.boxShadow = "#999999 0px 0px 4px 3px";
    const content = div.querySelector(".content")!;
    const query = div.querySelector(".query")!;
    const popupWin = new ztoolkit.ProgressWindow("添加双链", {
      closeOnClick: true,
    })
      .createLine({ text: "已复制:" + man.length })
      .show();
    popupWin.startCloseTimer(5000, false);

    man
      .map((m, i) => {
        const an = getItem(m.annotationKey);
        const content = (an.annotationComment || "") + (an.annotationText || "") + m.text;
        popupWin.createLine({ text: content.substring(0, 10) });
        popupWin.createLine({ text: Zotero.URI.getItemURI(an) });
        return {
          tag: "span",
          properties: { textContent: i + 1 + ":" + content.substring(0, 7) },
          styles: {
            background: an.annotationColor + "80",
            margin: "3px",
            border: "1px solid #000000",
          },
        };
      })
      .forEach((f) => ztoolkit.UI.appendElement(f, content));
    const timer = new Timer(() => {
      div.remove();
    });
    timer.startTimer();
    div.addEventListener("mouseover", () => {
      timer.clearTimer();
    });
    div.addEventListener("mouseout", () => {
      timer.startTimer(3000);
    });
    query.textContent = "已复制:" + man.length;

    div.addEventListener(
      "click",
      (_e) => {
        if (query.textContent == "已复制") {
          query.textContent = "已清空";
          addon.data.copyText = "";
          popupWin.createLine({ text: "已清空" }).startCloseTimer(5000, false);
        } else {
          query.textContent = "已复制:" + man.length;
          addon.data.copyText = text;
          popupWin.createLine({ text: "已复制:" + man.length }).startCloseTimer(5000, false);
        }
      },
      { capture: true },
    );
    // content.addEventListener("click",(e)=>{e.stopPropagation()
    //   content.textContent= content.textContent == "1已复制"?"1清空":"1已复制"},{"capture":true})
    // const z = ztoolkit.UI.appendElement(
    //   {
    //     id: `${config.addonRef}-copy-annotations`,
    //     tag: "div",
    //     properties: { textContent: "已复制：" },
    //     styles: {
    //       position: "fixed",
    //       left: "10px",
    //       top: "45px",
    //       zIndex: "9999",
    //       boxShadow: "#999999 0px 0px 4px 3px",
    //       padding: "5px",
    //       background: "#ffffff",
    //     },
    //     children: man.map((m, i) => {
    //       const an = getItem(m.annotationKey);
    //       const content =
    //         (an.annotationComment || "") + (an.annotationText || "") + m.text;
    //       return {
    //         tag: "span",
    //         properties: { textContent: i + 1 + ":" + content.substring(0, 7) },
    //         styles: {
    //           background: an.annotationColor + "80",
    //           margin: "3px",
    //           border: "1px solid #000000",
    //         },
    //       };
    //     }),
    //     listeners: [
    //       {
    //         type: "click",
    //         listener: (e) => {
    //           z.remove();
    //         },
    //       },
    //     ],
    //   },
    //   doc.body,
    // );
    // setTimeout(() => {
    //   z.remove();
    // }, 10000);
  });
}
export function text2Ma(text: string) {
  //    text = `“H2a：企业占据的结构洞数正向调节知识关键性 与网络权力的关系。 H2b：企业占据的结构洞数正向调节知识不可替 代性与网络权力的关系。 H2c：企业占据的结构洞数正向调节知识中心性 与网络权力的关系。” ([⁨刘立⁩和⁨党兴华⁩, 2014, p. 3](zotero://select/library/items/MBYKPZRC)) ([pdf](zotero://open-pdf/library/items/ALUKNMR8?page=3&annotation=UJ8F3GL4))

  // [image] ([pdf](zotero://open-pdf/library/items/ALUKNMR8?page=3&annotation=CCYZI87Y))
  // ([⁨刘立⁩和⁨党兴华⁩, 2014, p. 3](zotero://select/library/items/MBYKPZRC))

  // “知识价值性” ([⁨刘立⁩和⁨党兴华⁩, 2014, p. 5](zotero://select/library/items/MBYKPZRC)) ([pdf](zotero://open-pdf/library/items/ALUKNMR8?page=5&annotation=IL3PXPUF))`

  const reStr = ".*[[]pdf][(](zotero://open-pdf/library/items/(.*?)[?]page=(.*?)&annotation=(.*?))[)][)]";
  const reG = new RegExp(reStr, "g");
  const reN = new RegExp(reStr, "");
  // const reG = /.*[[]pdf][(](zotero:\/\/open-pdf\/library\/items\/(.*?)[?]page=(.*?)&annotation=(.*?))[)][)].*/g;
  // const reN = /^.*[[]pdf][(](zotero:\/\/open-pdf\/library\/items\/(.*?)[?]page=(.*?)&annotation=(.*?))[)][)].*$/;
  const mag = text.match(reG) || [];
  const man = mag
    .map((m) => m.match(reN) || [])
    .map((a) => ({
      text: a[0],
      openPdf: a[1],
      pdfKey: a[2],
      page: a[3],
      annotationKey: a[4],
    }));
  // man;
  return man;
}
