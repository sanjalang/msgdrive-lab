// Worker for L0 experiments c and f: hashes generated content or a picked file piece by piece, off the main thread.
// Messages in:  { id, cmd: 'gen', size, piece }  |  { id, cmd: 'file', file, piece }
// Messages out: { id, type: 'progress', done, total, readMs, hashMs }  |  { id, type: 'done', hex, done, readMs, hashMs }
//               { id, type: 'error', message }
// readMs = time spent producing the bytes (generating them, or reading the file slice); hashMs = time inside update().
'use strict';

importScripts('sha256.js', 'gen.js');

const PROGRESS_EVERY = 32 * 1048576;

self.onmessage = async (event) => {
  const { id, cmd, size, piece, file } = event.data;
  try {
    const total = cmd === 'file' ? file.size : size;
    const hasher = self.L0Sha256.create();
    let readMs = 0;
    let hashMs = 0;
    let nextReport = PROGRESS_EVERY;
    for (let position = 0; position < total; ) {
      const end = Math.min(total, position + piece);
      let started = performance.now();
      const bytes = cmd === 'file' ? new Uint8Array(await file.slice(position, end).arrayBuffer()) : self.L0Gen.range(position, end);
      readMs += performance.now() - started;
      if (bytes.length !== end - position) throw new Error(`short read at ${position}: got ${bytes.length} of ${end - position} bytes`);
      started = performance.now();
      hasher.update(bytes);
      hashMs += performance.now() - started;
      position = end;
      if (position >= nextReport && position < total) {
        nextReport = position + PROGRESS_EVERY;
        self.postMessage({ id, type: 'progress', done: position, total, readMs, hashMs });
      }
    }
    self.postMessage({ id, type: 'done', hex: self.L0Sha256.toHex(hasher.digest()), done: total, readMs, hashMs });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }
};
