// Deterministic test content (made-up data): block i is 1 MiB of a linear congruential sequence seeded by i, so any range of
// a "file" of any size can be produced without keeping it. Shared by the page, the worker, the Service Worker and Node.
// Assumes a little-endian platform (every browser this runs on is).
(function (root) {
  'use strict';

  const BLOCK = 1048576;

  /** Block `index` (1 MiB) as a new Uint8Array */
  function block(index) {
    const words = new Uint32Array(BLOCK / 4);
    let x = (Math.imul(index + 1, 0x9e3779b1) ^ 0x5bd1e995) | 0;
    for (let i = 0; i < words.length; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) | 0;
      words[i] = x;
    }
    return new Uint8Array(words.buffer);
  }

  /** Bytes [start, end) of the generated content; offsets are plain numbers (may exceed 4 GiB) */
  function range(start, end) {
    const out = new Uint8Array(end - start);
    let position = start;
    while (position < end) {
      const index = Math.floor(position / BLOCK);
      const inBlock = position - index * BLOCK;
      const take = Math.min(BLOCK - inBlock, end - position);
      out.set(block(index).subarray(inBlock, inBlock + take), position - start);
      position += take;
    }
    return out;
  }

  root.L0Gen = { BLOCK, block, range };
})(typeof self !== 'undefined' ? self : globalThis);
