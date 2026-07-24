import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/tools/calculator.js';
import { convert } from '../src/tools/units.js';
import { buildRegistry } from '../src/server.js';

describe('calculator parser', () => {
  it('applies operator precedence', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14);
    expect(evaluate('(2 + 3) * 4')).toBe(20);
  });

  it('handles power right-associatively and unary minus', () => {
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512); // 2^(3^2), not (2^3)^2
    expect(evaluate('-3 + 5')).toBe(2);
    expect(evaluate('10 % 4')).toBe(2);
  });

  it('rejects malformed input instead of guessing', () => {
    expect(() => evaluate('2 +')).toThrow();
    expect(() => evaluate('(2 + 3')).toThrow(/parenthesis/);
    expect(() => evaluate('2; process.exit()')).toThrow();
    expect(() => evaluate('1 / 0')).toThrow(/zero/i);
  });
});

describe('unit conversion', () => {
  it('converts within a quantity', () => {
    expect(convert(10, 'km', 'mi')).toBeCloseTo(6.21371, 4);
    expect(convert(1, 'lb', 'g')).toBeCloseTo(453.59237, 4);
  });

  it('converts temperature with affine formulas', () => {
    expect(convert(100, 'c', 'f')).toBeCloseTo(212, 6);
    expect(convert(0, 'c', 'k')).toBeCloseTo(273.15, 6);
  });

  it('refuses cross-quantity conversion', () => {
    expect(() => convert(1, 'kg', 'm')).toThrow(/Cannot convert/);
  });
});

describe('tool registry (Zod boundary)', () => {
  const registry = buildRegistry();

  it('executes a valid call', async () => {
    const run = await registry.run('calculator', { expression: '6 * 7' });
    expect(run).toEqual({ ok: true, result: '6 * 7 = 42' });
  });

  it('rejects schema-invalid input before the executor sees it', async () => {
    const run = await registry.run('calculator', { expression: 42 });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.errorCode).toBe('invalid_input');
      expect(run.error).toMatch(/expression/);
    }
  });

  it('rejects unknown tools', async () => {
    const run = await registry.run('rm_rf', {});
    expect(run).toMatchObject({ ok: false, errorCode: 'unknown_tool' });
  });

  it('captures executor failures as data, not crashes', async () => {
    const run = await registry.run('calculator', { expression: '1 / 0' });
    expect(run).toMatchObject({ ok: false, errorCode: 'execution_failed' });
  });

  it('generates JSON Schema for the provider from the Zod schemas', () => {
    const specs = registry.specs();
    expect(specs.map((s) => s.name).sort()).toEqual(['calculator', 'glossary_lookup', 'unit_convert']);
    const calc = specs.find((s) => s.name === 'calculator');
    expect(calc?.inputSchema).toMatchObject({
      type: 'object',
      required: ['expression'],
    });
  });

  it('glossary abstains explicitly on unknown terms', async () => {
    const hit = await registry.run('glossary_lookup', { term: 'audit trail' });
    expect(hit).toMatchObject({ ok: true });
    const miss = await registry.run('glossary_lookup', { term: 'flux capacitor' });
    expect(miss.ok).toBe(true);
    if (miss.ok) expect(miss.result).toMatch(/^NOT FOUND/);
  });
});
