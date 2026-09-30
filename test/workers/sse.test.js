import { describe, expect, it } from 'vitest';
import { createEventStream, parseEventStream } from '../../src/lib/scan/sse.js';

describe('createEventStream', () => {
  it('streams events with SSE headers and no content encoding', async () => {
    const stream = createEventStream({ keepAliveMs: 0 });
    stream.send('progress', { step: 'a' });
    stream.comment('note\nwith newline');
    stream.send('done', { id: 'x' });
    stream.close();

    expect(stream.response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(stream.response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(stream.response.headers.get('content-encoding')).toBeNull();

    const text = await stream.response.text();
    expect(text).toBe('event: progress\ndata: {"step":"a"}\n\n: note with newline\n\nevent: done\ndata: {"id":"x"}\n\n');
    expect(parseEventStream(text)).toEqual([
      { event: 'progress', data: { step: 'a' } },
      { event: 'done', data: { id: 'x' } },
    ]);
  });

  it('ignores sends after close and reports closed', () => {
    const stream = createEventStream({ keepAliveMs: 0 });
    stream.close();
    expect(stream.closed).toBe(true);
    expect(() => stream.send('late', {})).not.toThrow();
    expect(() => stream.close()).not.toThrow();
  });

  it('sends keep-alive comments on the interval', async () => {
    const stream = createEventStream({ keepAliveMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 35));
    stream.close();
    const text = await stream.response.text();
    expect((text.match(/: keep-alive/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('aborts the signal when the client cancels', async () => {
    const stream = createEventStream({ keepAliveMs: 0 });
    stream.send('progress', {});
    await stream.response.body?.cancel();
    expect(stream.signal.aborted).toBe(true);
    expect(stream.closed).toBe(true);
  });
});

describe('parseEventStream', () => {
  it('handles multi-line data, CRLF and non-JSON payloads', () => {
    expect(parseEventStream('event: a\r\ndata: {"x":\r\ndata: 1}\r\n\r\ndata: plain\n\n')).toEqual([
      { event: 'a', data: { x: 1 } },
      { event: 'message', data: 'plain' },
    ]);
  });
});
