import { z } from 'zod';
import type { ToolSpec } from '../providers/types.js';

/**
 * Tool definitions carry their Zod schema. The schema is the single source of
 * truth: it validates every tool call at runtime, infers the TypeScript type
 * the executor receives, and generates the JSON Schema the model sees. There
 * is no way to register a tool whose executor disagrees with its schema.
 */
export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  execute(input: z.infer<S>): Promise<string> | string;
}

/** Identity helper that preserves the schema type for `execute`. */
export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool;
}

export type ToolRunResult =
  | { ok: true; result: string }
  | { ok: false; errorCode: 'unknown_tool' | 'invalid_input' | 'execution_failed'; error: string };

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool<z.ZodType<unknown>>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** Provider-facing specs, with JSON Schema generated from each Zod schema. */
  specs(): ToolSpec[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.schema) as Record<string, unknown>,
    }));
  }

  /**
   * Validate then execute. A model-supplied input never reaches an executor
   * without passing the Zod schema first; executor failures are captured as
   * data instead of crashing the loop.
   */
  async run(name: string, input: unknown): Promise<ToolRunResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, errorCode: 'unknown_tool', error: `No such tool: ${name}` };
    }
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return { ok: false, errorCode: 'invalid_input', error: `Invalid input for ${name}: ${detail}` };
    }
    try {
      const result = await tool.execute(parsed.data);
      return { ok: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, errorCode: 'execution_failed', error: `${name} failed: ${message}` };
    }
  }
}
