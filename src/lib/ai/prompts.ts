/**
 * Prompts for the AI Answer Layer.
 *
 * The contract: answers are synthesized ONLY from the supplied evidence,
 * statements carry [n] citations, and the model must say so when the
 * evidence doesn't cover the question. This turns the LLM from a generic
 * chatbot into an evidence synthesizer sitting on the federated index.
 */
import type { AIEvidenceItem } from './types';
import { APP_PROFILE } from '@/lib/appProfile';

/**
 * The answer-layer system prompt comes from the app profile — the engine's
 * AI personality is configuration, not a scattered string.
 */
export const ANSWER_SYSTEM_PROMPT = APP_PROFILE.ai.systemPrompt;

/** Build the user message: query + numbered evidence block. */
export function buildEvidencePrompt(query: string, evidence: AIEvidenceItem[]): string {
  const block = evidence
    .map((e) => `[${e.n}]\ntitle: ${e.title}\nurl: ${e.url}\nsnippet: ${e.snippet}`)
    .join('\n\n');

  return `QUERY:\n${query}\n\nEVIDENCE:\n${block}\n\nAnswer the query. End with a "Sources:" section listing the [n] references you actually used, one per line, exactly like "[1] <title>".`;
}
