import assert from 'node:assert/strict';

import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const { createSceneCostFixture } = await import(`${root}/tests/helpers/scene-cost-fixture.mjs`);
const { StillClient } = await import(`${root}/src/still/client.ts`);
const { documentSource } = await import(`${root}/src/still/context.ts`);
const { operationJournal } = await import(`${root}/src/still/operation-journal.ts`);
const { authoritativeCreativeContext } = await import(`${root}/worker/context-authority.ts`);

const results = [];
for (const shared of [false, true]) {
  const f = await createSceneCostFixture(1, 'visual', { shared });
  const original = globalThis.fetch;
  let posts = 0, externalCalls = 0, dropNextWrite = false;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('/')) { externalCalls++; throw new Error('External calls prohibited'); }
    if (url === '/api/events' && init?.method === 'POST') {
      posts++;
      const response = await f.request(url, init);
      if (dropNextWrite) {
        dropNextWrite = false;
        assert.equal(response.ok, true, await response.clone().text());
        throw new Error('Simulated lost committed receipt');
      }
      return response;
    }
    return f.request(String(url), init);
  };
  const result = { scope: shared ? 'shared' : 'personal' };
  try {
    const c = new StillClient();
    await c.load();
    if (shared) c.position.projectId = f.projectId;
    else {
      const ids = await c.createProject('Still integration project', 'A small ceramic observatory');
      c.position = { ...c.position, ...ids, view: 'document' };
      assert.equal(c.projection.projectName, 'Still integration project');
      assert.equal(c.projection.documentTitle, 'Still integration project');
      assert.equal(c.projection.blocks[0].properties.text, 'A small ceramic observatory');
    }
    const ids = await c.createDocument('Second document', 'Keep the surface unglazed');
    c.position = { ...c.position, ...ids, view: 'document' };
    await c.append([c.blockEvent('No people', 'An exclusion', 'exclusion')]);
    assert.equal(c.projection.blocks.length, 2);
    result.canonicalCreation = 'project/document/block events persisted and folded';

    const source = documentSource(c.projection, c.position.documentId);
    const trusted = authoritativeCreativeContext(c.events, { documentId: c.position.documentId, projectId: c.position.projectId });
    assert.deepEqual(source.snapshot, trusted.snapshot);
    assert.deepEqual(source.sourceBlockVersions, trusted.sourceBlockVersions);
    assert.equal(source.revision, trusted.documentRevision);
    result.sourceParity = 'exact snapshot, versions and revision';

    const base = { kind: 'generate', documentId: c.position.documentId, sourceSurface: 'still', payload: {
      requestKey: 'still-integration-no-dispatch', snapshot: source.snapshot,
      sourceBlockVersions: source.sourceBlockVersions, expectedDocumentRevision: source.revision,
      productionMode: 'manual',
    } };
    const before = f.counts();
    await c.append([c.blockEvent('Evening shadows', 'Light', 'style')]);
    let response = await f.request('/api/document-jobs', f.json(base));
    let body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.error, 'context_source_version_mismatch');
    assert.deepEqual(f.counts(), before);
    result.additionalContextGuard = '409 context_source_version_mismatch';

    const current = documentSource(c.projection, c.position.documentId), target = c.projection.blocks[0];
    await c.append([{ type: 'BlockPropertyEdited', payload: { block_id: target.id, property_path: 'text',
      old_value: target.properties.text, new_value: 'A changed material direction' } }]);
    // Deliberately omit sourceBlockVersions: this verifies the new exact-revision guard itself.
    response = await f.request('/api/document-jobs', f.json({ ...base, payload: { ...base.payload,
      snapshot: current.snapshot, sourceBlockVersions: undefined, expectedDocumentRevision: current.revision } }));
    body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.error, 'context_source_version_mismatch');
    assert.deepEqual(f.counts(), before);
    result.changedTextGuard = '409 from expectedDocumentRevision without block-version claims';

    const block = c.blockEvent('A stable recovered thought', 'Recovered thought');
    dropNextWrite = true;
    await assert.rejects(c.append([block]), /lost committed receipt/);
    const beforeRecoveryPosts = posts;
    const reopened = new StillClient();
    await reopened.load();
    reopened.position = { ...c.position };
    assert.equal(reopened.recoveredWrite,true);
    assert.equal(posts, beforeRecoveryPosts);
    assert.equal(reopened.events.filter(e => e.type === 'BlockCreated' && e.payload.block_id === block.payload.block_id).length, 1);
    assert.equal(reopened.hasUnconfirmedWrite, false);
    result.createReceiptRecovery = 'fresh client, one block, no repeated POST';

    const edit = { type: 'BlockPropertyEdited', payload: { block_id: block.payload.block_id, property_path: 'text',
      old_value: 'A stable recovered thought', new_value: 'The edited recovered thought' } };
    dropNextWrite = true;
    await assert.rejects(reopened.append([edit]), /lost committed receipt/);
    const beforeEditRecoveryPosts = posts;
    const reopenedEdit = new StillClient();
    await reopenedEdit.load();
    reopenedEdit.position = { ...reopened.position };
    assert.equal(reopenedEdit.recoveredWrite,true);
    assert.equal(posts, beforeEditRecoveryPosts);
    assert.equal(reopenedEdit.hasUnconfirmedWrite, false);
    assert.equal(reopenedEdit.projection.blocks.find(b => b.id === block.payload.block_id).properties.text, edit.payload.new_value);
    result.editReceiptRecovery = 'fresh client, reconciled before conflict check, no repeated POST';
    assert.equal(externalCalls, 0);
    assert.equal(f.counts().document_jobs, 0);
    assert.equal(f.counts().budget_reservations, 0);
    assert.equal(f.counts().cost_budget_reservations, 0);
    result.externalCalls = externalCalls;
    result.providerJobsAndReservations = 0;
    results.push(result);
  } finally {
    globalThis.fetch = original;
    operationJournal.clearWrite(`${f.owner}:${f.sharing?.projectAccessId ?? 'personal'}`);
    await f.drainBackground();
    f.close();
  }
}
console.log(JSON.stringify(results, null, 2));
