import { parseRange } from './byte-range.js';

describe('parseRange', () => {
  it('reads closed, open and suffix ranges within the file', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({
      kind: 'partial',
      start: 0,
      end: 99,
    });
    expect(parseRange('bytes=900-', 1000)).toEqual({
      kind: 'partial',
      start: 900,
      end: 999,
    });
    expect(parseRange('bytes=-50', 1000)).toEqual({
      kind: 'partial',
      start: 950,
      end: 999,
    });
    expect(parseRange('bytes=990-5000', 1000)).toEqual({
      kind: 'partial',
      start: 990,
      end: 999,
    });
    expect(parseRange('bytes=-5000', 1000)).toEqual({
      kind: 'partial',
      start: 0,
      end: 999,
    });
  });

  it('serves the whole file for no, multiple or malformed ranges', () => {
    for (const header of [
      undefined,
      '',
      'bytes=0-1,5-9',
      'items=0-1',
      'bytes=-',
      'bytes=9-3',
    ])
      expect(parseRange(header, 1000)).toEqual({ kind: 'full' });
  });

  it('refuses ranges that start past the end', () => {
    expect(parseRange('bytes=1000-', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=-0', 1000)).toEqual({ kind: 'unsatisfiable' });
  });
});
