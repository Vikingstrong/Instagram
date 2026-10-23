export type ByteRange =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

// One "bytes=" range (RFC 9110): "a-b", "a-" or "-n". Several ranges or a
// malformed header get the whole file, which a client must accept too.
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange {
  if (!header) return { kind: 'full' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return { kind: 'full' };
  const [, first, last] = match;
  if (first === '') {
    // Suffix: the last n bytes.
    const length = Number(last);
    if (length === 0) return { kind: 'unsatisfiable' };
    return {
      kind: 'partial',
      start: Math.max(0, size - length),
      end: size - 1,
    };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size) return { kind: 'unsatisfiable' };
  if (end < start) return { kind: 'full' };
  return { kind: 'partial', start, end };
}
