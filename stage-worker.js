// Worker for the "ways of writing" comparison of experiment e: writes generated content into a file of the origin private
// file system through a synchronous access handle (the API that only exists in workers).
// Message in:  { name, size, piece }
// Message out: { ok: true, writeMs }  |  { ok: false, message }
'use strict';

importScripts('gen.js');

self.onmessage = async (event) => {
  const { name, size, piece } = event.data;
  try {
    const directory = await navigator.storage.getDirectory();
    const handle = await directory.getFileHandle(name, { create: true });
    if (typeof handle.createSyncAccessHandle !== 'function') throw new Error('createSyncAccessHandle is not available on this browser');
    const access = await handle.createSyncAccessHandle();
    let writeMs = 0;
    try {
      for (let position = 0; position < size; ) {
        const end = Math.min(size, position + piece);
        const bytes = self.L0Gen.range(position, end);
        const started = performance.now();
        const written = access.write(bytes, { at: position });
        writeMs += performance.now() - started;
        if (written !== bytes.length) throw new Error(`short write at ${position}: ${written} of ${bytes.length} bytes`);
        position = end;
      }
      access.flush();
    } finally {
      access.close();
    }
    self.postMessage({ ok: true, writeMs });
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }
};
