/**
 * A Server-Sent Events response backed by a ReadableStream. Events are
 * written as they happen; a keep-alive comment goes out on an interval so
 * intermediaries do not drop a quiet connection. No Content-Encoding is
 * set, since a compressed event stream can sit in the encoder buffer.
 */

/**
 * @param {Object} [options]
 * @param {number} [options.keepAliveMs]  0 disables keep-alive comments
 * @param {HeadersInit} [options.headers]
 */
export function createEventStream({ keepAliveMs = 15_000, headers = {} } = {}) {
  const encoder = new TextEncoder();
  /** @type {ReadableStreamDefaultController<Uint8Array> | undefined} */
  let controller;
  let closed = false;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;
  const aborter = new AbortController();

  /** @param {string} text */
  function write(text) {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      closed = true;
      clearInterval(timer);
    }
  }

  const stream = new ReadableStream({
    start(c) {
      controller = c;
      if (keepAliveMs > 0) timer = setInterval(() => write(': keep-alive\n\n'), keepAliveMs);
    },
    cancel() {
      closed = true;
      clearInterval(timer);
      aborter.abort();
    },
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
        ...headers,
      },
    }),
    /** Fires when the client goes away. */
    signal: aborter.signal,
    get closed() {
      return closed;
    },
    /**
     * @param {string} event
     * @param {unknown} data  JSON-serialisable
     */
    send(event, data) {
      write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    /** @param {string} text */
    comment(text) {
      write(`: ${text.replace(/\r?\n/g, ' ')}\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      try {
        controller?.close();
      } catch {
        // already closed by the client
      }
    },
  };
}

/**
 * Parse a complete SSE body into events. Used by tests and by the report
 * tooling; the browser has its own incremental parser.
 * @param {string} text
 * @returns {Array<{ event: string, data: unknown }>}
 */
export function parseEventStream(text) {
  const events = [];
  for (const frame of text.split(/\r?\n\r?\n/)) {
    let event = 'message';
    const dataLines = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith(':') || line.trim() === '') continue;
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length === 0) continue;
    const raw = dataLines.join('\n');
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    events.push({ event, data });
  }
  return events;
}
