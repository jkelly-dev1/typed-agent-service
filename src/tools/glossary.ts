import { z } from 'zod';
import { defineTool } from './registry.js';

/**
 * A small in-memory reference the model must cite instead of answering from
 * its own weights. This is the retrieval pattern in miniature: the tool result
 * is the source of truth, and the system prompt tells the model to say so when
 * a term is not found rather than guess (abstention over confabulation).
 */
const GLOSSARY: Record<string, string> = {
  'human-in-the-loop':
    'A control where a human must approve a consequential action before the system executes it. Used when the cost of a wrong automated action is high.',
  'audit trail':
    'An append-only record of what a system did and why, sufficient to reconstruct a decision after the fact. Tamper-evidence (e.g. hash chaining) strengthens it.',
  'retrieval-augmented generation':
    'An architecture where a model answers from documents fetched at query time rather than from its weights alone, enabling source attribution and fresher data.',
  abstention:
    'A designed behavior where a system declines to answer when confidence is low or evidence is missing, instead of producing a plausible guess.',
  hallucination:
    'Model output presented as fact but not grounded in the provided sources or reality. Mitigated by grounding, citation, validation, and abstention.',
  'eval gate':
    'A CI step that runs an evaluation suite against a golden dataset and fails the build when quality drops below a threshold.',
  'tool calling':
    'A pattern where the model requests a typed function invocation and the application executes it and returns the result, keeping side effects in application code.',
  guardrail:
    'A deterministic check around model input or output (schema validation, filters, budgets, iteration caps) that bounds what the system can do.',
};

export const glossaryTool = defineTool({
  name: 'glossary_lookup',
  description:
    'Look up an AI-governance term in the local glossary. Returns the definition, or reports that the term is not present. Answer glossary questions ONLY from this tool; if the term is not found, say so.',
  schema: z.object({
    term: z.string().min(1).max(100).describe('The term to look up, e.g. "audit trail"'),
  }),
  execute({ term }) {
    const key = term.toLowerCase().trim();
    const hit = GLOSSARY[key];
    if (hit) {
      return `${term}: ${hit}`;
    }
    return `NOT FOUND: "${term}" is not in the glossary. Available terms: ${Object.keys(GLOSSARY).join(', ')}`;
  },
});
