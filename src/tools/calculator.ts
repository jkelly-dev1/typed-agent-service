import { z } from 'zod';
import { defineTool } from './registry.js';

/**
 * Safe arithmetic: a small recursive-descent parser instead of eval(). The
 * grammar is exactly + - * / % ^ parentheses and unary minus over decimal
 * numbers; anything else is rejected.
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := factor (('*' | '/' | '%') factor)*
 *   factor := unary ('^' factor)?          right-associative power
 *   unary  := '-' unary | primary
 *   primary:= NUMBER | '(' expr ')'
 */
class Parser {
  private pos = 0;
  constructor(private readonly src: string) {}

  parse(): number {
    const value = this.expr();
    this.skipWs();
    if (this.pos < this.src.length) {
      throw new Error(`Unexpected character '${this.src[this.pos]}' at position ${this.pos}`);
    }
    return value;
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos] as string)) this.pos++;
  }

  private peek(): string | undefined {
    this.skipWs();
    return this.src[this.pos];
  }

  private expr(): number {
    let value = this.term();
    for (;;) {
      const c = this.peek();
      if (c === '+') { this.pos++; value += this.term(); }
      else if (c === '-') { this.pos++; value -= this.term(); }
      else return value;
    }
  }

  private term(): number {
    let value = this.factor();
    for (;;) {
      const c = this.peek();
      if (c === '*') { this.pos++; value *= this.factor(); }
      else if (c === '/') {
        this.pos++;
        const divisor = this.factor();
        if (divisor === 0) throw new Error('Division by zero');
        value /= divisor;
      } else if (c === '%') {
        this.pos++;
        const divisor = this.factor();
        if (divisor === 0) throw new Error('Modulo by zero');
        value %= divisor;
      } else return value;
    }
  }

  private factor(): number {
    const base = this.unary();
    if (this.peek() === '^') {
      this.pos++;
      return base ** this.factor();
    }
    return base;
  }

  private unary(): number {
    if (this.peek() === '-') {
      this.pos++;
      return -this.unary();
    }
    return this.primary();
  }

  private primary(): number {
    const c = this.peek();
    if (c === '(') {
      this.pos++;
      const value = this.expr();
      if (this.peek() !== ')') throw new Error('Missing closing parenthesis');
      this.pos++;
      return value;
    }
    const rest = this.src.slice(this.pos);
    const match = /^\d+(\.\d+)?/.exec(rest);
    if (!match) {
      throw new Error(`Expected a number at position ${this.pos}`);
    }
    this.pos += match[0].length;
    return Number(match[0]);
  }
}

export function evaluate(expression: string): number {
  const value = new Parser(expression).parse();
  if (!Number.isFinite(value)) throw new Error('Result is not a finite number');
  return value;
}

export const calculatorTool = defineTool({
  name: 'calculator',
  description:
    'Evaluate an arithmetic expression. Supports + - * / % ^ parentheses and decimal numbers. Use for any math instead of computing yourself.',
  schema: z.object({
    expression: z
      .string()
      .min(1)
      .max(200)
      .describe('The arithmetic expression to evaluate, e.g. "(2 + 3) * 4 ^ 2"'),
  }),
  execute({ expression }) {
    const value = evaluate(expression);
    return `${expression} = ${value}`;
  },
});
