import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/**
 * The SSE parser is vendored into both clients, and the two copies are
 * character-identical. That is a COPY, not an independent implementation:
 * two identical copies misread a changed contract identically, so neither can
 * cross-check the other's reading of it.
 *
 * What the vendoring does buy is that each client compiles and tests the
 * parser under its own toolchain, and that holds only while the copies stay
 * in step. Nothing else enforces it. Either file can be edited alone and
 * both suites still pass, leaving two clients silently parsing different
 * contracts. This is that enforcement.
 */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

describe('the two vendored SSE parsers stay in step', () => {
  it('has identical code in both copies', () => {
    expect(stripComments(read('web-ng/src/lib/sse.ts'))).toBe(
      stripComments(read('web/src/lib/sse.ts')),
    );
  });

  it('exercises both copies with the same assertions', () => {
    const a = read('web/tests/sse.test.ts').replace("'../src/lib/sse'", "'./sse'");
    expect(read('web-ng/src/lib/sse.spec.ts')).toBe(a);
  });
});
