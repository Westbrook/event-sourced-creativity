import { buildBoundedPromptRepresentation, PROMPT_TECHNIQUES } from '../../src/model/prompt-structures.ts';
import { hash, freeze } from './core.mjs';

/** Replaces generation-readiness's synthetic-direction comparison for experiments.
 * No planner invocation, title-derived direction, trimming, or incident substitution. */
export function frozenTechniqueComparison({ source, direction, references = [], settings, capturedPrompt = null }) {
  if (!source || !direction?.scene || !settings) throw new Error('captured_source_and_direction_required');
  const sourceHash = hash(source), plannerHash = hash(direction), referenceHash = hash(references);
  const variants = PROMPT_TECHNIQUES.map(technique => {
    const built = buildBoundedPromptRepresentation(technique, structuredClone(source), structuredClone(direction), structuredClone(references), settings);
    if (!built.fits || built.compacted) throw new Error('format_comparison_requires_uncompacted_source');
    return { technique, prompt: built.prompt, promptHash: hash(built.prompt), sourceHash, plannerHash, referenceHash };
  });
  if (capturedPrompt && variants.find(v => v.technique === capturedPrompt.technique)?.prompt !== capturedPrompt.text) throw new Error('original_prompt_not_reproduced_do_not_claim_historical_format_control');
  return freeze({ sourceHash, plannerHash, referenceHash, variants, plannerCalls: 0 });
}
