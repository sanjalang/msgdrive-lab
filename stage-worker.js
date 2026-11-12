// Worker for method C of experiment e: writes generated content into a file of the origin private file system through a
// synchronous access handle (the API that only exists in workers).
// Message in:   { name, size, piece, reportEvery }   (reportEvery: bytes between progress messages; 0 for none)
// Messages out: { progress: true, position, writeMs }
//               { ok: true, writeMs, closeMs }  |  { ok: false, message }
'use strict';

importScripts('gen.js');

self.onmessage = async (event) => {
  const { name, size, piece, reportEvery } = event.data;
  try {
    const directory = await navigator.storage.getDirectory();
    const handle = await directory.getFileHandle(name, { create: true });
    if (typeof handle.createSyncAccessHandle !== 'function') throw new Error('createSyncAccessHandle is not available on this browser');
    const access = await handle.createSyncAccessHandle();
    let writeMs = 0;
    let closeMs = 0;
    let nextReport = reportEvery > 0 ? reportEvery : Infinity;
    try {
      // A file left by an earlier, longer run must not keep its tail
      access.truncate(0);
      for (let position = 0; position < size; ) {
        const end = Math.min(size, position + piece);
        const bytes = self.L0Gen.range(position, end);
        const started = performance.now();
        const written = access.write(bytes, { at: position });
        writeMs += performance.now() - started;
        if (written !== bytes.length) throw new Error(`short write at ${position}: ${written} of ${bytes.length} bytes`);
        position = end;
        if (position >= nextReport) {
          nextReport += reportEvery;
          self.postMessage({ progress: true, position, writeMs });
        }
      }
      const beforeFlush = performance.now();
      access.flush();
      closeMs = performance.now() - beforeFlush;
    } finally {
      access.close();
    }
    self.postMessage({ ok: true, writeMs, closeMs });
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }
};
