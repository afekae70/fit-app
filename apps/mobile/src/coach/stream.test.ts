/**
 * SSE frame-parser tests.
 *
 * Chunk boundaries are the thing that breaks here, and they break *intermittently* — the same
 * conversation works on a fast connection and drops a word on a slow one, because the split
 * lands mid-frame. That makes it close to undebuggable in the wild and worth pinning precisely.
 */

import { describe, expect, it } from 'vitest';

import { parseSseChunk } from './stream.js';

describe('parseSseChunk', () => {
  it('parses a single complete frame', () => {
    const { frames, rest } = parseSseChunk('event: delta\ndata: {"text":"Hello"}\n\n');
    expect(frames).toEqual([{ event: 'delta', data: { text: 'Hello' } }]);
    expect(rest).toBe('');
  });

  it('parses several frames arriving in one chunk', () => {
    const { frames } = parseSseChunk(
      'event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text":"b"}\n\n',
    );
    expect(frames.map((f) => (f.data as { text: string }).text)).toEqual(['a', 'b']);
  });

  it('holds back an incomplete frame instead of parsing it', () => {
    // The killer case: the chunk ends mid-JSON. Parsing now throws; the bytes must be carried.
    const { frames, rest } = parseSseChunk('event: delta\ndata: {"text":"par');
    expect(frames).toEqual([]);
    expect(rest).toBe('event: delta\ndata: {"text":"par');
  });

  it('completes a frame split across two chunks', () => {
    const first = parseSseChunk('event: delta\ndata: {"te');
    const second = parseSseChunk(first.rest + 'xt":"split"}\n\n');
    expect(second.frames).toEqual([{ event: 'delta', data: { text: 'split' } }]);
    expect(second.rest).toBe('');
  });

  it('survives a split landing exactly on the frame terminator', () => {
    // '\n\n' arriving as two separate chunks is a real boundary case: after the first, the
    // buffer ends in a single newline and the frame is not yet terminated.
    const first = parseSseChunk('event: delta\ndata: {"text":"x"}\n');
    expect(first.frames).toEqual([]);
    const second = parseSseChunk(first.rest + '\n');
    expect(second.frames).toEqual([{ event: 'delta', data: { text: 'x' } }]);
  });

  it('keeps a complete frame and holds the partial one behind it', () => {
    const { frames, rest } = parseSseChunk(
      'event: delta\ndata: {"text":"done"}\n\nevent: delta\ndata: {"text":"partia',
    );
    expect(frames).toHaveLength(1);
    expect(rest).toContain('partia');
  });

  it('reads the event name, defaulting to message', () => {
    expect(parseSseChunk('data: {"a":1}\n\n').frames[0]?.event).toBe('message');
    expect(parseSseChunk('event: refusal\ndata: {"category":"cyber"}\n\n').frames[0]?.event).toBe(
      'refusal',
    );
  });

  it('joins multi-line data per the SSE spec', () => {
    const { frames } = parseSseChunk('event: delta\ndata: {"text":\ndata: "multi"}\n\n');
    expect((frames[0]?.data as { text: string }).text).toBe('multi');
  });

  it('skips a corrupt frame without discarding the ones around it', () => {
    const { frames } = parseSseChunk(
      'event: delta\ndata: {"text":"ok"}\n\nevent: delta\ndata: {not json}\n\nevent: done\ndata: {}\n\n',
    );
    // A frame that terminated but will not parse is corrupt, not partial — dropping just it
    // beats tearing down a stream that is otherwise delivering fine.
    expect(frames.map((f) => f.event)).toEqual(['delta', 'done']);
  });

  it('ignores comment and heartbeat lines that carry no data', () => {
    const { frames } = parseSseChunk(': keep-alive\n\nevent: delta\ndata: {"text":"y"}\n\n');
    expect(frames).toHaveLength(1);
  });

  it('handles an empty buffer', () => {
    expect(parseSseChunk('')).toEqual({ frames: [], rest: '' });
  });

  it('reassembles a whole reply delivered one character at a time', () => {
    // Worst realistic case: a slow connection delivering byte by byte. Every intermediate
    // state must be either a complete frame or carried remainder — never a lost token.
    const wire =
      'event: delta\ndata: {"text":"Your bench "}\n\n' +
      'event: delta\ndata: {"text":"is progressing."}\n\n' +
      'event: done\ndata: {}\n\n';

    let buffer = '';
    const received: string[] = [];
    let sawDone = false;

    for (const char of wire) {
      buffer += char;
      const { frames, rest } = parseSseChunk(buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame.event === 'delta') received.push((frame.data as { text: string }).text);
        if (frame.event === 'done') sawDone = true;
      }
    }

    expect(received.join('')).toBe('Your bench is progressing.');
    expect(sawDone).toBe(true);
    expect(buffer).toBe('');
  });
});
