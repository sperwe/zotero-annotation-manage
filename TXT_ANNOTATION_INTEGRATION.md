# Zotero Annotation Manage 支持 SimpleTextReader TXT 标注方案

> **目标**: 在不修改 PDF 功能的前提下，为 annotation-manage 添加 TXT 文件（SimpleTextReader）的标注支持

## 1. 项目现状分析

### 1.1 annotation-manage 架构

```
annotation-manage/
├── src/
│   ├── modules/
│   │   ├── annotations.tsx      # 事件注册、renderTextSelectionPopup 回调
│   │   ├── AnnotationPopup.tsx  # 标签选择弹窗 UI 和 saveAnnotationTags 核心逻辑
│   │   ├── AnnotationsToNote.tsx  # 导出为笔记功能
│   │   └── ...
│   ├── component/
│   │   ├── PopupRoot.tsx       # React 标签选择组件
│   │   └── AnnotationMatrix.tsx  # 批注矩阵展示
│   ├── action/
│   │   └── action-highlight.ts  # 自定义高亮颜色条
│   └── utils/
│       └── zzlib.ts            # 工具函数（标签颜色管理等）
└── addon.ts                     # 插件入口，api 对象定义
```

**核心流程**:
```
用户选择文本 → Zotero.Reader 触发 renderTextSelectionPopup 事件
    → annotation-manage 渲染 AnnotationPopup
    → 用户选择标签/颜色 → saveAnnotationTags()
    → 调用 reader._annotationManager.addAnnotation() 创建标注
    → 标注存储到 Zotero DB (Zotero.Item 'annotation')
```

### 1.2 annotation-manage 对 PDF 的依赖

| 代码位置 | 依赖项 | 说明 |
|----------|--------|------|
| `annotations.tsx:44` | `reader._item.parentItem` | 获取 PDF 附件的父 Item |
| `AnnotationPopup.tsx:548` | `params.annotation.position.rects` | PDF 矩形坐标数组 |
| `AnnotationPopup.tsx:411` | `getCurrentPageDiv()` | 获取 `.page` 元素 |
| `AnnotationPopup.tsx:560` | `getViewerScaleFactor()` | PDF 缩放因子 |
| `AnnotationPopup.tsx:1249` | `reader._annotationManager.addAnnotation()` | PDF 专用添加方法 |
| `AnnotationsToNote.tsx:35` | `isPDFAttachment()` | 过滤 PDF 附件 |
| `AnnotationsToNote.tsx:50` | `isPDFAttachment()` | 过滤 PDF 附件 |
| `BackupAnnotation.tsx:51` | `isPDFAttachment()` | 备份 PDF 标注 |

### 1.3 SimpleTextReader 架构

```
SimpleTextReader/
├── addon/
│   ├── content/
│   │   ├── webapp/
│   │   │   ├── reader-app.html    # 主 HTML 结构
│   │   │   ├── webapp-bundle.js   # 打包的 Web 应用
│   │   │   ├── integration-shim.js # Zotero 集成垫片
│   │   │   └── css/reader.css      # 阅读器样式
│   │   └── reader.js               # XUL Reader 窗口脚本
│   └── bootstrap.js                # Zotero 插件入口
```

**关键 DOM 结构**:
```html
<!-- reader-app.html -->
<div class="sidebar-splitview-outer">
  <div id="content">
    <!-- 段落列表，每个段落是一段文本 -->
    <p data-page-index="0">第一段文字...</p>
    <p data-page-index="1">第二段文字...</p>
  </div>
  <div id="pagination"></div>
</div>
```

---

## 2. 技术可行性论证

### 2.1 事件系统兼容性 ✅

annotation-manage 监听的 `Zotero.Reader` 事件基于 Zotero 插件 API，与文件类型无关：

```typescript
// annotations.tsx:16-17
Zotero.Reader.registerEventListener("renderTextSelectionPopup", renderTextSelectionPopup, config.addonID);
Zotero.Reader.registerEventListener("createAnnotationContextMenu", createAnnotationContextMenu, config.addonID);
```

**验证**: Zotero.Reader 事件系统在 Reader Tab 打开时触发，不区分 PDF/TXT。只要 SimpleTextReader 使用 Zotero 的 Reader Tab 框架，这些事件就会触发。

### 2.2 标注存储兼容性 ✅

Zotero 的标注本质上是 `Zotero.Item('annotation')`，存储在附件 Item 下：

```javascript
// Zotero DB Schema
Zotero.Items
├── id, key, parentItemID (附件ID), itemTypeID ('annotation')
├── annotationText, annotationComment, annotationColor, annotationType
├── annotationPosition (JSON 字段，存储位置信息)
```

**关键发现**: `annotationPosition` 是 JSON 字段，Zotero 原生支持任意结构！

```javascript
// PDF 位置结构
{ pageIndex: 0, rects: [[x1,y1,x2,y2], ...], width: 100 }

// TXT 可用位置结构
{ type: "text", pageIndex: 0, charStart: 100, charEnd: 150, text: "选中文本" }
```

### 2.3 标注获取兼容性 ⚠️

`item.getAnnotations()` 返回所有子标注，不区分类型：

```typescript
// 现有代码（AnnotationsToNote.tsx:54）
return pdf.getAnnotations().flatMap((ann) => { ... });
```

**问题**: 部分代码使用 `isPDFAttachment()` 过滤，需要修改为同时支持 TXT。

### 2.4 标注创建兼容性 ❌ (需要修改)

这是最大的障碍：

```typescript
// AnnotationPopup.tsx:1249-1254
const newAnn = reader?._annotationManager.addAnnotation(
  Components.utils.cloneInto(
    { ...params?.annotation, type: annotationType || _annotationType, comment: comment, color, tags },
    doc,
  ),
);
```

`reader._annotationManager` 是 Zotero Reader 内部的 PDF/EPUB 专用管理器，不适用于 TXT。

**解决方案**: 为 TXT 创建独立的标注创建路径，直接使用 `Zotero.Item` API。

---

## 3. 集成方案详细设计

### 3.1 类型检测模块

新建 `src/utils/readerType.ts`:

```typescript
/**
 * 检测 Reader 类型
 */
export function getReaderType(reader: _ZoteroTypes.ReaderInstance): 'pdf' | 'epub' | 'snapshot' | 'txt' {
  const item = reader?._item?.parentItem;
  if (!item) return 'pdf';

  const mimeType = item.attachmentMIMEType;
  switch (mimeType) {
    case 'text/plain':
      return 'txt';
    case 'application/epub+zip':
      return 'epub';
    case 'text/html':
      return 'snapshot';
    default:
      return 'pdf';
  }
}

/**
 * 判断是否是 SimpleTextReader
 */
export function isSimpleTextReader(reader: _ZoteroTypes.ReaderInstance): boolean {
  return getReaderType(reader) === 'txt';
}

/**
 * 判断是否是支持的 Reader 类型
 * annotation-manage 目前支持 PDF/EPUB/Snapshot/TXT
 */
export function isSupportedReader(reader: _ZoteroTypes.ReaderInstance): boolean {
  const type = getReaderType(reader);
  return ['pdf', 'epub', 'snapshot', 'txt'].includes(type);
}
```

### 3.2 TXT 位置数据结构

```typescript
// src/types/textAnnotation.ts

/**
 * TXT 标注位置信息
 */
export interface TextAnnotationPosition {
  type: 'text';
  /** 段落索引（虚拟页码） */
  pageIndex: number;
  /** 相对于文件开头的字符起始偏移 */
  charStart: number;
  /** 相对于文件开头的字符结束偏移 */
  charEnd: number;
  /** 选中的原文 */
  text: string;
}

/**
 * 统一的标注位置（兼容 PDF）
 */
export interface AnnotationPosition {
  /** PDF/EPUB/Snapshot 位置 */
  pdf?: {
    pageIndex: number;
    rects: number[][];
    nextPageRects?: number[][];
    width?: number;
  };
  /** TXT 位置 */
  text?: TextAnnotationPosition;
}
```

### 3.3 TXT 位置计算工具

```typescript
// src/utils/textPosition.ts

import { TextAnnotationPosition } from '../types/textAnnotation';

/**
 * 从 DOM Selection 计算 TXT 位置
 */
export function getTextPositionFromSelection(doc: Document): TextAnnotationPosition | null {
  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = selection.toString();
  if (!text.trim()) return null;

  // 获取 #content 元素
  const content = doc.getElementById('content');
  if (!content) return null;

  // 计算字符偏移
  const result = calculateCharOffset(content, range);
  if (!result) return null;

  return {
    type: 'text',
    pageIndex: result.pageIndex,
    charStart: result.charStart,
    charEnd: result.charEnd,
    text: text
  };
}

/**
 * 计算 DOM Range 相对于容器的字符偏移
 */
function calculateCharOffset(
  container: Element,
  range: Range
): { pageIndex: number; charStart: number; charEnd: number } | null {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    null
  );

  let charOffset = 0;
  let pageIndex = 0;
  let startFound = false;
  let endCharOffset = 0;
  let endPageIndex = 0;
  const paragraphs = container.querySelectorAll('p[data-page-index]');

  for (const p of paragraphs) {
    const pText = p.textContent || '';
    const pIndex = parseInt((p as HTMLElement).dataset.pageIndex || '0', 10);

    // 检查范围起点是否在此段落
    if (!startFound && range.intersectsNode(p)) {
      const preRange = document.createRange();
      preRange.selectNodeContents(p);
      preRange.setEnd(range.startContainer, range.startOffset);
      startFound = true;
      charOffset = preRange.toString().length;
      pageIndex = pIndex;
    }

    // 检查范围终点
    if (startFound && range.intersectsNode(p)) {
      const preRange = document.createRange();
      preRange.selectNodeContents(p);
      preRange.setEnd(range.endContainer, range.endOffset);
      endCharOffset = preRange.toString().length;
      endPageIndex = pIndex;
      break;
    }

    // 如果还没找到起点，继续累加
    if (!startFound) {
      charOffset += pText.length;
      pageIndex = pIndex;
    }
  }

  if (!startFound) return null;

  // 如果终点在同一段落
  if (endCharOffset === 0) {
    endCharOffset = charOffset + text.length;
    endPageIndex = pageIndex;
  }

  return {
    pageIndex,
    charStart: charOffset,
    charEnd: endCharOffset,
  };
}
```

### 3.4 TXT 标注创建

```typescript
// src/utils/createTextAnnotation.ts

import { TextAnnotationPosition } from '../types/textAnnotation';

/**
 * 为 TXT 创建标注
 */
export async function createTextAnnotation(
  item: Zotero.Item,  // 附件 Item (TXT)
  position: TextAnnotationPosition,
  options: {
    type?: 'highlight' | 'underline' | 'note';
    color?: string;
    tags?: Array<{ name: string }>;
    comment?: string;
  }
): Promise<Zotero.Item> {
  const { type = 'highlight', color, tags = [], comment = '' } = options;

  // 生成唯一 key
  const key = Zotero.DataObjectUtilities.generateKey();

  // 创建 annotation Item
  const annotation = new Zotero.Item('annotation');
  annotation.setFields({
    key,
    parentItemID: item.id,
    annotationText: position.text,
    annotationComment: comment,
    annotationColor: color || '#ffd400',
    annotationType: type,
    annotationPosition: JSON.stringify({ text: position }),
  });

  // 添加标签
  for (const tag of tags) {
    annotation.addTag(tag.name, 0);
  }

  // 保存
  await annotation.saveTx();

  return annotation;
}
```

### 3.5 修改 saveAnnotationTags 支持 TXT

**核心修改位置**: `src/modules/AnnotationPopup.tsx` 第 1189-1296 行

```typescript
// 修改后的 saveAnnotationTags 函数签名
export async function saveAnnotationTags(
  searchTagAddIfEmpty: string,
  selectedTags: { tag: string; color: string }[],
  delTags: string[],
  reader: _ZoteroTypes.ReaderInstance,
  params: {
    annotation?: _ZoteroTypes.Annotations.AnnotationJson;
    ids?: any;
    currentID?: string;
    x?: number;
    y?: number;
  },
  doc: Document,
  annotationType: "highlight" | "underline" | undefined = undefined,
  comment = "",
) {
  // ... 现有代码省略 ...

  if (reader) {
    const item = reader._item;
    const isTxt = isSimpleTextReader(reader);

    if (params.ids) {
      // === 现有：修改已有标注的标签 ===
      // ... 不需要修改 ...
    } else if (isTxt) {
      // === 新增：TXT 标注创建 ===
      const textPos = getTextPositionFromSelection(doc);
      if (!textPos) {
        ztoolkit.log('TXT: 未找到有效选择');
        return false;
      }

      const color = selectedTags.map((a) => a.color).filter((f) => f)[0] ||
        memFixedColor(tagsRequire[0], undefined);
      const tagsToAdd = tagsRequire.map((a) => ({ name: a }));

      const newAnnotation = await createTextAnnotation(
        item,  // 这里传入的是 reader._item，即 TXT 附件
        textPos,
        {
          type: annotationType || 'highlight',
          color,
          tags: tagsToAdd,
          comment,
        }
      );

      memoizeAsyncGroupAllTagsDB.replaceCacheByKey();
      memRelateTags.replaceCacheByArgs(item);
      return [newAnnotation];

    } else {
      // === 现有：PDF/EPUB 标注创建 ===
      // ... 不需要修改 ...
    }
  }
}
```

### 3.6 修改 AnnotationsToNote 支持 TXT

**修改位置**: `src/modules/AnnotationsToNote.tsx`

```typescript
// getAllAnnotations 函数修改
export function getAllAnnotations(items: Zotero.Item[]) {
  const items1 = items.map((a) => {
    // 修改：支持 TXT 附件
    if (a.isAttachment() && a.isPDFAttachment()) {
      return a.parentItem;
    }
    // 新增：TXT 附件
    if (a.isAttachment() && a.attachmentMIMEType === 'text/plain') {
      return a.parentItem;
    }
    return a;
  });

  const data = uniqueBy(items1, (a) => a.key)
    .filter((f) => !f.isAttachment())
    .flatMap((item) => {
      return Zotero.Items.get(item.getAttachments(false))
        .filter((f) => f.isPDFAttachment() || f.attachmentMIMEType === 'text/plain')  // 新增 TXT 过滤
        .flatMap((attachment) => {
          return attachment.getAnnotations().flatMap((ann) => {
            // 新增：解析 TXT 标注位置
            let page = ann.annotationPageLabel;
            if (!page) {
              const pos = ann.annotationPosition;
              if (pos?.text?.pageIndex !== undefined) {
                page = `段落 ${pos.text.pageIndex + 1}`;
              }
            }
            // ... 其余代码不变 ...
          });
        });
    });
  return data;
}
```

### 3.7 API 暴露

在 `addon.ts` 中填充 `api` 对象：

```typescript
// addon.ts
this.api = {
  // 类型检测
  isSimpleTextReader,
  getReaderType,
  isSupportedReader,

  // TXT 标注操作
  createTextAnnotation,
  getTextPositionFromSelection,

  // 兼容现有功能
  AnnotationPopup,
  saveAnnotationTags,
};
```

---

## 4. 实施计划

### 4.1 阶段一：基础设施 (0.5 天)

| 任务 | 文件 | 改动 |
|------|------|------|
| 类型定义 | `src/types/textAnnotation.ts` | 新建 |
| 类型检测 | `src/utils/readerType.ts` | 新建 |
| TXT 位置计算 | `src/utils/textPosition.ts` | 新建 |
| TXT 标注创建 | `src/utils/createTextAnnotation.ts` | 新建 |

### 4.2 阶段二：核心集成 (1 天)

| 任务 | 文件 | 改动 |
|------|------|------|
| 事件过滤 | `src/modules/annotations.tsx` | 添加 `isSupportedReader` 检查 |
| 标注创建 | `src/modules/AnnotationPopup.tsx` | 添加 TXT 分支 |
| 标注导出 | `src/modules/AnnotationsToNote.tsx` | 移除 `isPDFAttachment` 限制 |

### 4.3 阶段三：UI 适配 (0.5 天)

| 任务 | 文件 | 改动 |
|------|------|------|
| 位置显示 | `src/component/PopupRoot.tsx` | TXT 显示"段落 N"而非页码 |
| 样式适配 | `src/component/annotation.css` | 可能需要微调 |

### 4.4 阶段四：测试 (0.5 天)

- [ ] PDF 标注功能回归测试
- [ ] EPUB 标注功能回归测试
- [ ] TXT 标注功能测试
- [ ] 标签导出功能测试（所有类型）

---

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| Zotero 版本更新导致 API 变化 | 中 | 使用 zotero-types 锁定版本 |
| TXT 选择位置计算不准确 | 低 | 提供调试模式，显示偏移信息 |
| 与其他 TXT 插件冲突 | 低 | 仅在 SimpleTextReader Tab 中激活 |
| annotationPosition JSON 格式不被未来版本支持 | 中 | 准备降级方案（存到 Extra 字段） |

---

## 6. 代码改动汇总

### 6.1 新建文件 (4 个)

```
src/types/textAnnotation.ts       # TXT 标注类型定义
src/utils/readerType.ts           # Reader 类型检测
src/utils/textPosition.ts         # TXT 位置计算
src/utils/createTextAnnotation.ts # TXT 标注创建
```

### 6.2 修改文件 (4 个)

| 文件 | 修改行数 | 主要改动 |
|------|----------|----------|
| `src/modules/annotations.tsx` | ~5 行 | 添加类型检测，早期返回 |
| `src/modules/AnnotationPopup.tsx` | ~50 行 | 添加 TXT 标注创建分支 |
| `src/modules/AnnotationsToNote.tsx` | ~5 行 | 移除 `isPDFAttachment()` 硬编码 |
| `addon.ts` | ~15 行 | 填充 `api` 对象 |

**总计**: 新增约 400 行，修改约 75 行

---

## 7. 兼容性保证

### 7.1 向后兼容

- 所有修改都有 `isSimpleTextReader()` 条件判断
- PDF/EPUB/Snapshot 代码路径完全不变
- 现有用户无感知升级

### 7.2 数据兼容

- 已有标注的 `annotationPosition` 结构不变
- 新 TXT 标注使用独立的 `{ type: "text", ... }` 结构
- 读取时通过 `type` 字段区分处理

### 7.3 API 兼容

- `api` 对象新增方法，不影响现有调用
- 函数签名与原 `saveAnnotationTags` 保持一致

---

## 8. 测试验证方案

### 8.1 单元测试

```typescript
// test/textPosition.test.ts
describe('getTextPositionFromSelection', () => {
  it('应该正确计算段落内的字符偏移', () => {
    // 模拟 DOM 结构
    // 验证 charStart/charEnd 计算正确
  });
});
```

### 8.2 集成测试

1. **PDF 流程**: 选择文本 → 添加标签 → 保存 → 导出笔记
2. **TXT 流程**: 选择文本 → 添加标签 → 保存 → 导出笔记

### 8.3 边界测试

- 空选择
- 跨段落选择
- 全选
- 特殊字符（中文、emoji）

---

## 9. 结论

### 9.1 可行性

✅ **论证通过**

1. 事件系统与文件类型无关，`renderTextSelectionPopup` 在 TXT Reader 中同样触发
2. `Zotero.Item('annotation')` 支持自定义 `annotationPosition` JSON 结构
3. 标注创建和读取都有清晰的扩展点
4. PDF 功能完全不修改，保证向后兼容

### 9.2 工作量评估

| 阶段 | 工作量 | 说明 |
|------|--------|------|
| 基础设施 | 0.5 天 | 4 个新文件 |
| 核心集成 | 1 天 | 主要是条件分支 |
| UI 适配 | 0.5 天 | 边界情况处理 |
| 测试 | 0.5 天 | 回归 + 新功能测试 |
| **总计** | **2.5 天** | - |

### 9.3 下一步行动

1. **确认需求**: SimpleTextReader 是否已支持文本选择 API 暴露？
2. **原型验证**: 先实现 `getTextPositionFromSelection` 验证位置计算
3. **数据迁移**: 考虑现有 SimpleTextReader 是否有旧标注需要迁移
4. **用户体验**: TXT 标注的"页面"概念是否需要特殊 UI？

---

## 附录

### A. 相关 Zotero API 文档

- `Zotero.Item` - https://www.zotero.org/support/dev/zotero_7/api_library/items
- `Zotero.Reader` - https://www.zotero.org/support/dev/zotero_7/api_library/readers
- `annotationPosition` - https://github.com/zotero/zotero/blob/main/chrome/content/zotero/annotations.js

### B. 参考实现

- Zotero Reader 源码: https://github.com/zotero/reader
- annotation-manage 源码: https://github.com/zzlb0224/zotero-annotation-manage

### C. 术语表

| 术语 | 说明 |
|------|------|
| charOffset | 字符偏移量，相对于文本开头的字符位置 |
| pageIndex | 段落索引（SimpleTextReader 中的虚拟页码） |
| annotationPosition | Zotero 标注的位置信息存储字段 |
| renderTextSelectionPopup | Zotero Reader 选择文本后触发的回调事件 |
