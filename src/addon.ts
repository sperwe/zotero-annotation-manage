import { config } from "../package.json";
// import { ColumnOptions } from "zotero-plugin-toolkit/dist/helpers/virtualizedTable";
// import { DialogHelper } from "zotero-plugin-toolkit/dist/helpers/dialog";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { ColumnOptions, DialogHelper, ZoteroToolkit } from "zotero-plugin-toolkit";
// TXT annotation support
import { isSimpleTextReader, getReaderType, isSupportedReader, isPDFReader, getReaderTypeName } from "./utils/readerType";
import { getTextPositionFromSelection, getParagraphAtCharOffset, getFullTextContent, highlightTextPosition } from "./utils/textPosition";
import { createTextAnnotation, updateTextAnnotation, deleteTextAnnotation, getTextAnnotations, parseTextPosition, isTextAnnotation } from "./utils/createTextAnnotation";
import { TextAnnotationPosition, AnnotationPosition, CreateTextAnnotationOptions } from "./types/textAnnotation";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    prefs?: {
      window: Window;
      columns: Array<ColumnOptions>;
      rows: Array<{ [dataKey: string]: string }>;
    };
    dialog?: DialogHelper;
    exportDialog?: DialogHelper;
    relationDialog?: DialogHelper;
    copyText: string;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs for TXT annotation support
  public api: {
    // Reader type detection
    isSimpleTextReader: typeof isSimpleTextReader;
    getReaderType: typeof getReaderType;
    isSupportedReader: typeof isSupportedReader;
    isPDFReader: typeof isPDFReader;
    getReaderTypeName: typeof getReaderTypeName;
    // TXT position utilities
    getTextPositionFromSelection: typeof getTextPositionFromSelection;
    getParagraphAtCharOffset: typeof getParagraphAtCharOffset;
    getFullTextContent: typeof getFullTextContent;
    highlightTextPosition: typeof highlightTextPosition;
    // TXT annotation CRUD
    createTextAnnotation: typeof createTextAnnotation;
    updateTextAnnotation: typeof updateTextAnnotation;
    deleteTextAnnotation: typeof deleteTextAnnotation;
    getTextAnnotations: typeof getTextAnnotations;
    parseTextPosition: typeof parseTextPosition;
    isTextAnnotation: typeof isTextAnnotation;
  };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      ztoolkit: createZToolkit(),
      copyText: "",
    };
    this.hooks = hooks;
    // Initialize API for TXT annotation support
    this.api = {
      // Reader type detection
      isSimpleTextReader,
      getReaderType,
      isSupportedReader,
      isPDFReader,
      getReaderTypeName,
      // TXT position utilities
      getTextPositionFromSelection,
      getParagraphAtCharOffset,
      getFullTextContent,
      highlightTextPosition,
      // TXT annotation CRUD
      createTextAnnotation,
      updateTextAnnotation,
      deleteTextAnnotation,
      getTextAnnotations,
      parseTextPosition,
      isTextAnnotation,
    };
  }
}

export default Addon;
