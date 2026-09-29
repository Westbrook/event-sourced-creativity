import { buildBoundedPromptRepresentation } from '../../../src/model/prompt-structures.ts';

/** Newly authored on 2026-09-22 for compiler tests. No incident body was used.
 * Every provenance token is fake; this is neither historical replay nor research
 * evidence. The approved-research shape exercises the existing producer contract.
 */
export function newCurrentE2aFixture() {
  const source = {
    document: { id: 'fixture-document-e2a', title: 'Synthetic literary street control' },
    facts: [
      { block_id: 'fixture-subject', type: 'subject', role: 'subject', intent: 'include', effect: 'must_include', handle: 'subject/atticus-finch', properties: { text: 'Atticus Finch, an adult fictional lawyer, stands on the left holding a closed portfolio.', authority: 'authored', weight: 1, spatial_scope: { kind: 'region', region: 'left', polarity: 'inside', falloff: 'hard', feather: 0 } } },
      { block_id: 'fixture-research', type: 'environment', role: 'environment', intent: 'include', effect: 'must_include', handle: 'environment/courthouse', properties: { label: 'Approved period setting', text: 'A small Alabama courthouse street in the 1930s; the courthouse is behind the lawyer.', subtype: 'Place', intent: 'include', weight: .8, authority: 'authored', context_detail: true, source_execution_id: 'fixture-execution-e2a', source_proposal_id: 'fixture-proposal-e2a', source_excerpt: 'Keep the courthouse behind the lawyer.', human_edited: false, created_from: 'approved-context-proposal' } },
      { block_id: 'fixture-palette', type: 'palette', role: 'palette', intent: 'include', effect: 'must_include', handle: 'palette/ochre-ink', properties: { label: 'Muted ochre and ink blue', colors: ['#B88A44', '#1C304A'], weight: .8, spatial_scope: { kind: 'document', polarity: 'inside', falloff: 'hard', feather: 0 } } },
      { block_id: 'fixture-sign', type: 'text', role: 'text', intent: 'include', effect: 'must_include', handle: 'text/sign', properties: { text: 'Display exactly: CASE 7f4c20aa-9123-4f00-8777-abc123def456', exact_text: 'CASE 7f4c20aa-9123-4f00-8777-abc123def456', quote: 'source_execution_id is deliberately printed on the sign.', authored_record: { source_execution_id: 'authored-opaque-id', provenance: { created_from: 'PRINT THIS', source_proposal_id: 'VISIBLE-PROPOSAL' } }, weight: 1, spatial_scope: { kind: 'aabb', aabb: { x: .65, y: .1, width: .25, height: .2 }, polarity: 'inside', falloff: 'soft', feather: .1 } } },
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
    ['approved-excerpt', '/facts/1/properties/source_excerpt', ['Keep the courthouse behind the lawyer.']],
    ['palette', '/facts/2/properties/colors', ['#B88A44', '#1C304A']],
    ['exact-display', '/facts/3/properties/exact_text', ['CASE 7f4c20aa-9123-4f00-8777-abc123def456']],
    ['authored-provenance-words', '/facts/3/properties/quote', ['source_execution_id is deliberately printed on the sign.']],
    ['nested-authored-opaque', '/facts/3/properties/authored_record', ['authored-opaque-id', 'PRINT THIS', 'VISIBLE-PROPOSAL']],
    ['scope', '/facts/3/properties/spatial_scope', ['left 65%, top 10%, width 25%, height 20%']],
    ['negative-scope', '/facts/4/properties/spatial_scope', ['everywhere outside the document-relative rectangle', 'Intent: prohibit', 'No red lettering outside the sign rectangle.']],
    ['style', '/facts/5/properties/text', ['Restrained print illustration with fine paper grain.']],
    ['relationship', '/relationships/0', ['environment_reference', 'The courthouse belongs behind this subject.']],
    ['reference-role', '/relationships/1', ['style_reference', 'Apply print treatment to the lawyer.']],
    ['global-exclusion', '/standing_constraints/0/value', ['No watermarks or extra captions.']],
  ].map(([id, path, mustContain]) => ({ id, text: id, critical: true, sourcePaths: [path], mustContain }));
  return { key: 'e2a-new-current-synthetic-v1', privacy: 'synthetic', sourceRevision: '2a0caa914a0c57002f9b69ff3b60cb3d6d8a687f',
    sourceProvenance: 'New synthetic control authored 2026-09-22 against current compiler; not a retained user source or historical reconstruction.',
    directionProvenance: 'synthetic-authored-fixture', source, direction, requirements,
    bindings: [{ kind: 'approved-context-proposal-v1', factIndex: 1, blockId: 'fixture-research', propertiesJson: JSON.stringify(source.facts[1].properties) }],
    originalPrompt: buildBoundedPromptRepresentation('prose', source, direction, [], { size: '1536x1024', quality: 'high' }).prompt,
  };
}
