import { compileE2aPrompt, E2A_COMPILER_VERSION } from '../../../src/model/prompt-provenance-e2a.ts';
import { freeze, freezeCase, hash, seal, validateCoverage } from '../core.mjs';

export const E2A_SETTINGS = freeze({ provider: 'openai', model: 'gpt-image-2.5-sunburst', quality: 'high', size: '1536x1024', endpoint: '/v1/images/generations', route: 'direct', streaming: false, outputFormat: 'png', moderation: 'omitted', references: [] });
const pointer = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
function leaves(value, path = '') {
  if (value && typeof value === 'object' && Object.keys(value).length) return Object.entries(value).flatMap(([key, item]) => leaves(item, `${path}/${pointer(key)}`));
  return [{ path, value }];
}
const at = (value, path) => path.split('/').slice(1).reduce((v, key) => v?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], value);

/** Exact single replacement, with UTF-16 and UTF-8 offsets. Retains unchanged prefix
 * and suffix, including all whitespace. This is not an approximate word diff. */
export function exactPromptDiff(before, after) {
  const a = Array.from(before), b = Array.from(after);
  let start = 0, tail = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (tail < a.length - start && tail < b.length - start && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const prefix = a.slice(0, start).join(''), removed = a.slice(start, a.length - tail).join(''), inserted = b.slice(start, b.length - tail).join('');
  return { beforeHash: hash(before), afterHash: hash(after), beforeBytes: Buffer.byteLength(before), afterBytes: Buffer.byteLength(after),
    textOffset: prefix.length, byteOffset: Buffer.byteLength(prefix), removed, inserted, removedUtf8Hex: Buffer.from(removed).toString('hex'), insertedUtf8Hex: Buffer.from(inserted).toString('hex'),
    beforeEnd: prefix.length + removed.length, afterEnd: prefix.length + inserted.length };
}

/** Synthetic-only local capture. No retrieval API or authorized=true shortcut.
 * Real private captures must remain in A custody, admitted by H's owner/expiry path.
 */
export function captureE2aFixture(input) {
  if (input.privacy !== 'synthetic' || input.directionProvenance !== 'synthetic-authored-fixture') throw new Error('e2a_fixture_only_no_private_authority');
  const frozen = structuredClone(input);
  const { source, direction, bindings, requirements, originalPrompt } = frozen;
  const options = { size: '1536x1024', quality: 'high' };
  const before = compileE2aPrompt('prose', source, direction, [], options);
  if (!before.fits || before.compacted) throw new Error('e2a_requires_uncompacted_baseline');
  if (typeof originalPrompt !== 'string' || before.prompt !== originalPrompt) throw new Error('e2a_original_prompt_not_reproduced');
  const after = compileE2aPrompt('prose', source, direction, [], options, { version: E2A_COMPILER_VERSION, bindings });
  const caseRecord = freezeCase({ key: frozen.key, stratum: 'new-current-synthetic-control', source, direction, prompt: before.prompt, requirements, references: [], privacy: 'synthetic', historicalReplay: false });
  validateCoverage(caseRecord, after.prompt);
  const removals = new Map(after.privateProjection.removed.map(row => [row.sourcePath, row]));
  const sourceLedger = leaves(source).map(({ path, value }) => {
    const removal = removals.get(path);
    if (!removal && JSON.stringify(at(after.privateProjection.snapshot, path)) !== JSON.stringify(value)) throw new Error(`e2a_unapproved_source_change:${path}`);
    return { sourcePath: path, value, disposition: removal ? 'nonvisual-provenance-removed' : 'unchanged-in-compiler-input', contract: removal?.contract ?? null };
  });
  const requirementCoverage = requirements.map(requirement => {
    if (!requirement.sourcePaths?.length || requirement.sourcePaths.some(path => at(source, path) === undefined || removals.has(path))) throw new Error(`e2a_requirement_source_missing:${requirement.id}`);
    return { ...requirement, before: true, after: true, method: 'source-path equality and literal render anchors; not visual fidelity' };
  });
  return seal('e2a-capture', {
    schemaVersion: 1, compilerVersion: E2A_COMPILER_VERSION, sourceRevision: frozen.sourceRevision,
    evidenceClass: 'new-current-synthetic-control', historicalReplay: false,
    sourceProvenance: frozen.sourceProvenance, directionProvenance: frozen.directionProvenance,
    futurePreparationPlannerCallNeeded: true, capturedPlannerOutput: null, fixtureDirection: direction,
    case: caseRecord, bindings, settings: E2A_SETTINGS, options,
    sourceJson: JSON.stringify(source), directionJson: JSON.stringify(direction),
    sourceBytesHash: hash(JSON.stringify(source)), directionBytesHash: hash(JSON.stringify(direction)),
    orderedInputs: leaves(source).map(({ path }) => path), orderedReferenceInputs: [],
    before: { prompt: before.prompt, hash: hash(before.prompt), bytes: Buffer.byteLength(before.prompt) },
    after: { prompt: after.prompt, hash: hash(after.prompt), bytes: Buffer.byteLength(after.prompt) },
    exactDiff: exactPromptDiff(before.prompt, after.prompt),
    privateEvidence: { sourceLedger, removed: after.privateProjection.removed, requirementCoverage },
    calls: { planner: 0, moderation: 0, image: 0, evaluator: 0 },
    limitations: ['Synthetic authored direction is not captured planner evidence.', 'Literal coverage is not proof of visual fidelity.', 'No refusal-rate or cross-media improvement measured.', 'No dispatch or spending authority.'],
  });
}
