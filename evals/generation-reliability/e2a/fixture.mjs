import { buildContextApplicationPlan } from '../../../src/model/context-proposal-application.ts';
import { normalizeDecompositionProposals } from '../../../src/model/context-intelligence.ts';
import { buildBoundedPromptRepresentation } from '../../../src/model/prompt-structures.ts';

/** Synthetic v2 carrier correction, 2026-09-25. No historical/private input.
 * Selection below simulates review; it does not assert real human approval.
 * Grounding excerpts are evidence. Required words belong in approved text.
 */
export function syntheticApprovedSetting() {
  const text = 'A small Alabama courthouse street in the 1930s; the courthouse is behind the lawyer. Keep the courthouse behind the lawyer.';
  const [decomposition] = normalizeDecompositionProposals(text, [{ id: 'fixture-proposal-e2a', type: 'environment', subtype: 'Place', label: 'courthouse', text, source_excerpt: text, participants: [] }]);
  if (!decomposition) throw new Error('synthetic_proposal_not_grounded');
  const target = { id: 'fixture-source', projectId: 'fixture-project', documentId: 'fixture-document-e2a', scope: 'document', type: 'direction', handle: 'direction/setting', properties: { text }, removed: false, locked: false };
  const plan = buildContextApplicationPlan({ projection: { libraryBlocks: [target], libraryBlockRelations: [] }, target,
    proposals: [{ key: 'fixture-setting', executionId: 'fixture-execution-e2a', proposalId: decomposition.id, decomposition, edit: { label: 'Approved period setting' } }], createId: () => 'fixture-research' });
  return plan.events.find(event => event.type === 'BlockCreated').payload.properties;
}

// These keys are literal sign copy, not a structured provenance/authority record.
export const E2A_SIGN_RECORD_TEXT = JSON.stringify({ source_execution_id: 'authored-opaque-id', provenance: { created_from: 'PRINT THIS', source_proposal_id: 'VISIBLE-PROPOSAL' } });

export function newCurrentE2aFixture() {
  const source = {
    document: { id: 'fixture-document-e2a', title: 'Synthetic literary street control' },
    facts: [
      { block_id: 'fixture-subject', type: 'subject', role: 'subject', intent: 'include', effect: 'must_include', handle: 'subject/atticus-finch', properties: { text: 'Atticus Finch, an adult fictional lawyer, stands on the left holding a closed portfolio.', authority: 'authored', weight: 1, spatial_scope: { kind: 'region', region: 'left', polarity: 'inside', falloff: 'hard', feather: 0 } } },
      { block_id: 'fixture-research', type: 'environment', role: 'environment', intent: 'include', effect: 'must_include', handle: 'environment/courthouse', properties: syntheticApprovedSetting() },
      { block_id: 'fixture-palette', type: 'palette', role: 'palette', intent: 'include', effect: 'must_include', handle: 'palette/ochre-ink', properties: { label: 'Muted ochre and ink blue', colors: ['#B88A44', '#1C304A'], weight: .8, spatial_scope: { kind: 'document', polarity: 'inside', falloff: 'hard', feather: 0 } } },
      { block_id: 'fixture-sign', type: 'text', role: 'text', intent: 'include', effect: 'must_include', handle: 'text/sign', properties: { text: `Display exactly: CASE 7f4c20aa-9123-4f00-8777-abc123def456\n${E2A_SIGN_RECORD_TEXT}`, exact_text: 'CASE 7f4c20aa-9123-4f00-8777-abc123def456', quote: 'source_execution_id is deliberately printed on the sign.', weight: 1, spatial_scope: { kind: 'aabb', aabb: { x: .65, y: .1, width: .25, height: .2 }, polarity: 'inside', falloff: 'soft', feather: .1 } } },
      { block_id: 'fixture-exclusion', type: 'exclusion', role: 'exclusion', intent: 'prohibit', effect: 'must_not_include', handle: 'exclusion/red', properties: { text: 'No red lettering outside the sign rectangle.', weight: 1, spatial_scope: { kind: 'aabb', aabb: { x: .65, y: .1, width: .25, height: .2 }, polarity: 'outside', falloff: 'hard', feather: 0 } } },
      { block_id: 'fixture-style', type: 'style', role: 'style', intent: 'include', effect: 'must_include', handle: 'style/print', properties: { text: 'Restrained print illustration with fine paper grain.', weight: .7 } },
    ],
    relationships: [
      { relation_id: 'fixture-relation-location', from_block_id: 'fixture-subject', to_block_id: 'fixture-research', kind: 'environment_reference', properties: { instruction: 'The courthouse belongs behind this subject.' } },
      { relation_id: 'fixture-relation-style', from_block_id: 'fixture-subject', to_block_id: 'fixture-style', kind: 'style_reference', properties: { instruction: 'Apply print treatment to the lawyer.' } },
    ],
    pins: ['fixture-subject'], standing_constraints: [{ axis: 'additions', polarity: 'prohibit', value: 'No watermarks or extra captions.' }],
  };
  const direction = { title: 'Synthetic courthouse street', scene: 'Atticus Finch stands at the left; the 1930s courthouse remains behind him. The sign stays at upper right.', rationale: 'Keep the authored subject, period setting, muted palette, exact sign and scoped prohibition together.', palette: ['muted ochre', 'ink blue'], next_moves: ['Keep the approved setting.'] };
  const requirements = [
    ['identity', '/facts/0/properties/text', ['Atticus Finch', 'adult fictional lawyer', 'closed portfolio']],
    ['approved-research', '/facts/1/properties/text', ['Alabama', '1930s', 'courthouse is behind the lawyer']],
    ['approved-excerpt', '/facts/1/properties/text', ['Keep the courthouse behind the lawyer.']],
    ['palette', '/facts/2/properties/colors', ['#B88A44', '#1C304A']],
    ['exact-display', '/facts/3/properties/exact_text', ['CASE 7f4c20aa-9123-4f00-8777-abc123def456']],
    ['authored-provenance-words', '/facts/3/properties/quote', ['source_execution_id is deliberately printed on the sign.']],
    ['nested-authored-opaque', '/facts/3/properties/text', ['authored-opaque-id', 'PRINT THIS', 'VISIBLE-PROPOSAL']],
    ['scope', '/facts/3/properties/spatial_scope', ['left 65%, top 10%, width 25%, height 20%']],
    ['negative-scope', '/facts/4/properties/spatial_scope', ['everywhere outside the document-relative rectangle', 'Intent: prohibit', 'No red lettering outside the sign rectangle.']],
    ['style', '/facts/5/properties/text', ['Restrained print illustration with fine paper grain.']],
    ['relationship', '/relationships/0', ['environment_reference', 'The courthouse belongs behind this subject.']],
    ['reference-role', '/relationships/1', ['style_reference', 'Apply print treatment to the lawyer.']],
    ['global-exclusion', '/standing_constraints/0/value', ['No watermarks or extra captions.']],
  ].map(([id, path, mustContain]) => ({ id, text: id, critical: true, sourcePaths: [path], mustContain }));
  return { key: 'e2a-new-current-synthetic-v2', privacy: 'synthetic', sourceRevision: 'c28af5fea0fc3ec2b37b878a544ec59c52a64daf',
    sourceProvenance: 'Synthetic v2 fixture corrected 2026-09-25: simulated approved text from the real proposal producer and literal JSON sign copy in text. Not retained user source, real approval, research evidence or historical reconstruction.',
    directionProvenance: 'synthetic-authored-fixture', source, direction, requirements,
    bindings: [{ kind: 'approved-context-proposal-v1', factIndex: 1, blockId: 'fixture-research', propertiesJson: JSON.stringify(source.facts[1].properties) }],
    originalPrompt: buildBoundedPromptRepresentation('prose', source, direction, [], { size: '1536x1024', quality: 'high' }).prompt,
  };
}
