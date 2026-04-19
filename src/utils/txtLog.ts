export function txtLog(event: string, data: Record<string, unknown> = {}) {
  ztoolkit.log("[txt-bridge]", event, data);
  try {
    const profile = Zotero.getProfileDirectory();
    const classes = Components.classes as any;
    const file = classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
    file.initWithPath(`${profile.path}/zotero-annotation-manage-txt.log`);
    const stream = classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);
    stream.init(file, 0x02 | 0x08 | 0x10, 0o666, 0);
    const line = `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`;
    stream.write(line, line.length);
    stream.close();
  } catch {
    // Logging must not affect reader interactions.
  }
}

export function txtLogError(event: string, error: unknown, data: Record<string, unknown> = {}) {
  txtLog(event, {
    ...data,
    error: String(error),
    name: (error as any)?.name,
    message: (error as any)?.message,
    stack: String((error as any)?.stack || "").slice(0, 800),
  });
}
