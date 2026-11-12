// Service Worker for L0 experiment e: answers GET <scope>dl/<token>?size=<bytes>&mode=<sw|page> with a streamed download
// (Content-Disposition: attachment). The body is produced piece by piece as the browser reads it, never as a whole:
//   mode=sw    this worker generates the bytes itself
//   mode=page  this worker asks a page for each piece over a MessageChannel (the shape of the real design, where the page
//              holds the keys and the Service Worker holds nothing)
// Progress is posted to every window: { type: 'dl', token, state: 'start' | 'progress' | 'done' | 'cancel' | 'error', ... }.
'use strict';

importScripts('gen.js');

const PIECE = 1048576;
const REPORT_EVERY = 32 * 1048576;
const PAGE_TIMEOUT_MS = 30000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function tellPages(message) {
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const page of pages) page.postMessage(message);
}

/** One piece from a page: the requesting client when it is known, else any window of this origin */
async function askPage(clientId, start, end) {
  let page = clientId ? await self.clients.get(clientId) : undefined;
  if (!page) page = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))[0];
  if (!page) throw new Error('no page to ask');
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('the page did not answer in time')), PAGE_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      if (event.data && event.data.bytes instanceof ArrayBuffer) resolve(new Uint8Array(event.data.bytes));
      else reject(new Error('the page answered without bytes'));
    };
    page.postMessage({ type: 'need', start, end }, [channel.port2]);
  });
}

function download(event, token, size, mode, paceMibPerSecond) {
  let position = 0;
  let nextReport = REPORT_EVERY;
  // Set when the browser stops reading: a piece that was being fetched then must not be enqueued any more
  let cancelled = false;
  const startedAt = Date.now();
  const report = (state, extra) => tellPages({ type: 'dl', token, state, position, size, mode, pace: paceMibPerSecond, elapsedMs: Date.now() - startedAt, ...extra });
  const body = new ReadableStream({
    start() {
      report('start', {
        clientId: event.clientId || '',
        resultingClientId: event.resultingClientId || '',
        destination: event.request.destination || '(empty)',
        requestMode: event.request.mode,
      });
    },
    async pull(controller) {
      try {
        if (position >= size) {
          controller.close();
          report('done');
          return;
        }
        const end = Math.min(size, position + PIECE);
        const bytes = mode === 'page' ? await askPage(event.clientId, position, end) : self.L0Gen.range(position, end);
        if (cancelled) return;
        if (bytes.length !== end - position) throw new Error(`piece of ${bytes.length} bytes, expected ${end - position}`);
        controller.enqueue(bytes);
        position = end;
        if (paceMibPerSecond > 0) {
          // Hold the next piece back until the average rate is down to the pace
          const dueMs = (position / 1048576 / paceMibPerSecond) * 1000;
          const waitMs = dueMs - (Date.now() - startedAt);
          if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        if (position >= nextReport) {
          nextReport = position + REPORT_EVERY;
          report('progress');
        }
      } catch (error) {
        if (cancelled) return;
        report('error', { message: error instanceof Error ? error.message : String(error) });
        controller.error(error);
      }
    },
    cancel(reason) {
      cancelled = true;
      report('cancel', { message: reason === undefined ? '(no reason given)' : String(reason) });
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="l0-dl-${size}.bin"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const prefix = new URL('dl/', self.registration.scope).pathname;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(prefix)) return;
  const token = url.pathname.slice(prefix.length);
  const size = Number(url.searchParams.get('size'));
  const mode = url.searchParams.get('mode') === 'page' ? 'page' : 'sw';
  if (!/^[a-z0-9]{8,32}$/.test(token) || !Number.isSafeInteger(size) || size <= 0) {
    event.respondWith(new Response('bad request', { status: 400, headers: { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' } }));
    return;
  }
  const pace = Number(url.searchParams.get('pace'));
  event.respondWith(download(event, token, size, mode, Number.isFinite(pace) && pace > 0 ? pace : 0));
});
