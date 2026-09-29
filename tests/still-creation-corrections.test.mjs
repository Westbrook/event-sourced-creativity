import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CreationCorrectionsController } from '../src/still/creation-corrections.ts';
import { plainTextIdeaBody } from '../src/model/idea-body.ts';
const fixture = JSON.parse(readFileSync(new URL('../docs/still-unified-creation-fixtures-2026-09-23.json', import.meta.url)));
function options() {
  const idea = { id: 'idea', kind: 'idea', projectId: 'project', title: 'Window', text: 'A window.',
    body: plainTextIdeaBody('A window.'), type: 'subject', subtype: 'Object study', revision: 1, disposition: 'retained', sourceEvidence: [] };
  const plan = { schemaVersion: 1, draftId: 'draft', draftRevision: 1, entryKind: 'document', scope: { actorUserId: 'actor', projectId: 'project', documentId: null, custodyKey: 'personal', permissionEpoch: 1 },
    sourceText: 'A window.', nodes: [{ id: 'doc', projectId: 'project', kind: 'document', title: 'Window study', revision: 1, disposition: 'retained', sourceEvidence: [] }, idea],
    uses: [{ id: 'use', documentId: 'doc', ideaId: 'idea', order: 0, revision: 1, disposition: 'retained', dependencyManifest: [] }],
    references: [], issues: [], coverage: [], decisions: [], modelVersion: 'fixture', compiledEventBound: 10 };
  const review = { schemaVersion: 1, nodes: { idea: { complete: false } }, uses: {}, stage: 'ideas', lastAcknowledgedRevision: 1 };
  return { draft: {}, plan, review, onChange(next, nextReview) { this.plan = next; this.review = nextReview; }, onError() {} };
}
test('correction form previews then accepts and undoes Document removal without losing unfinished Ideas', () => {
  const o = options(), c = new CreationCorrectionsController();
  c.select(o.plan.nodes[0]); c.prepare(o);
  assert.equal(o.plan.nodes[0].disposition, 'retained');
  c.accept(o);
  assert.equal(o.plan.nodes[0].disposition, 'removed');
  assert.equal(o.plan.nodes[1].text, 'A window.');
  assert.deepEqual(o.review.nodes.idea, { complete: false });
  c.undo(o);
  assert.equal(o.plan.nodes[0].disposition, 'retained');
});
test('form preserves rich reference tokens and starts partial reuse with an explicitly empty body', () => {
  const c = new CreationCorrectionsController(), scene = fixture.ideas.find(n => n.id === 'idea-first-scene');
  c.select(scene);
  assert.deepEqual(c.patch.body, scene.body);
  assert.notEqual(c.patch.body, scene.body);
  c.chooseMode('partial', scene);
  assert.equal(c.patch.text, '');
  assert.equal(scene.text, fixture.ideas.find(n => n.id === 'idea-first-scene').text);
});
test('variation requires current destination, complete authored content and explicit meaning review', () => {
  const o = options(), c = new CreationCorrectionsController();
  c.select(o.plan.nodes[1]); c.chooseMode('variation', o.plan.nodes[1]); c.documentId = 'doc';
  assert.throws(() => c.prepare(o), /retained meaning/);
  c.meaningReviewed = true; c.prepare(o);
  o.plan.nodes[0].title = 'Changed after preview';
  assert.throws(() => c.accept(o), /stale/);
});
