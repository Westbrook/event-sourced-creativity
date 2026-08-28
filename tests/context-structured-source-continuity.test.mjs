import assert from "node:assert/strict";
import test from "node:test";
import {currentPage,digest,foldEvents,outputInputDraft,targetId} from "./helpers/context-structured-source-fixture.mjs";
const previousFetch=globalThis.fetch;
let networkCalls=0;
globalThis.fetch=async()=>{networkCalls++;throw new Error("No external/provider request is permitted in this source-continuity test.");};
test.after(()=>{try{assert.equal(networkCalls,0);}finally{globalThis.fetch=previousFetch;}});

for (const locale of ['en', 'fr', 'ar', 'ja']) {
  for (const mode of ['unchanged', 'manual-peer', 'untouched-peer', 'exact-revert-note']) {
    test('context structured source continuity ' + locale + ' ' + mode, async t => {
      const x = await currentPage(t, locale), { f } = x;
      const original = x.state(), originalChild = x.child();
      const requestStart = x.host.requests.length, routeStart = x.routed.length, headStart = x.eventHead();
      if (mode === 'manual-peer') await x.input('markdown', 'Deliberate local user draft C');
      if (mode === 'exact-revert-note') { await x.input('title', 'Temporary title'); await x.input('title', original.title); }
      const local = x.child().draft;
      if (mode === 'exact-revert-note') assert.deepEqual(local, original, 'full structured draft is byte-identical before closing');
      await f.act(x.toggle());
      const peerStatus = mode.endsWith('-peer') ? await x.peer() : null;
      const canonicalBefore = x.state();
      const noteCount = f.tree().visible('small').filter(row => row.owner === x.owner() && row.attributes.class === 'context-draft-note').length;
      assert.equal(x.host.requests.slice(requestStart).filter(row => row.init.method === 'POST').length, 0, 'typing, closing and authoritative source refresh never save or buy');
      await f.act(x.toggle());
      assert.equal(x.child(), originalChild, 'the actual whole-editor cache retained the original child');
      const reopened = x.child().draft, canonicalHeadBeforeSave = x.eventHead();
      if (mode !== 'exact-revert-note') await x.saveVisible();
      const canonicalAfter = x.state();
      const storedRows = x.worker.sqlite.prepare('SELECT event_id,type,payload FROM events WHERE stream_id=? AND sequence>? ORDER BY sequence')
        .all(x.worker.streamId, canonicalHeadBeforeSave);
      // Stored authored values use private-content references. Read them through
      // the actual current scoped GET; never call a redacted raw SQL value zero,
      // absent, released, or evidence of an optimistic-only write.
      const afterResponse = await x.worker.request('/api/events?after=0&limit=2000&content=1');
      assert.equal(afterResponse.status, 200);
      const afterBody = await afterResponse.json();
      const serverRows = afterBody.events.filter(row => row.sequence > canonicalHeadBeforeSave);
      assert.deepEqual(serverRows.map(row => row.eventId), storedRows.map(row => row.event_id), 'current private GET resolves these exact persisted event identities');
      const durable = foldEvents(afterBody.events, Infinity, x.binding.documentId, x.binding.projectId);
      const durableInput = outputInputDraft(durable.libraryBlocks.find(block => block.id === targetId));
      assert.deepEqual(durableInput, canonicalAfter, 'fresh current Worker GET and actual fold certify the same final saved bytes as the Store');
      const manuscriptWrites = serverRows.filter(row => row.type === 'BlockPropertyEdited' && row.payload.block_id === targetId
        && row.payload.property_path === 'artifact_markdown').map(row => ({ old: row.payload.old_value, next: row.payload.new_value }));
      const posts = x.host.requests.slice(requestStart).filter(row => row.init.method === 'POST');
      assert.ok(posts.every(row => row.url === '/api/events'), 'only explicit ordinary source Save commands');
      assert.ok(x.routed.slice(routeStart).filter(row => row.method === 'POST').every(row => row.status === 200), 'unchanged real Worker responses, no fabricated ACK');
      x.unchangedAuthority(); assert.deepEqual(x.financial(), x.financialBefore, 'all original job/budget/cost rows remain unchanged');
      assert.equal(networkCalls, 0);
      const expectedReopen = mode === 'manual-peer' ? local : canonicalBefore;
      const refreshed = digest(reopened) === digest(expectedReopen);
      const expectedAfter = mode === 'manual-peer' ? local.markdown : canonicalBefore.markdown;
      console.log(JSON.stringify({ evidence: 'actual-full-store-worker-source-flow', locale, mode, binding: x.binding,
        sameRetainedChild: true, reopenedMatchesOwnedContent: refreshed,
        reopenedMarkdown: reopened.markdown, currentBeforeSave: canonicalBefore.markdown,
        currentAfterSave: canonicalAfter.markdown, noteCount, peerStatus, freshVisibleSave: mode !== 'exact-revert-note',
        foregroundPosts: posts.length, routedStatuses: x.routed.slice(routeStart).filter(row => row.method === 'POST').map(row => row.status),
        manuscriptWrites, serverEventsAfterVisibleSave: serverRows.length, currentWorkerReadMatchesStore: true,
        preservedOriginalFinancialRows: true, networkCalls }));
      if (mode === 'unchanged' || mode === 'exact-revert-note') {
        assert.equal(x.eventHead(), headStart, 'byte-normalized unchanged or reverted input creates no source write');
        assert.equal(posts.length, 0);
      }
      if (mode === 'manual-peer') { assert.equal(posts.length, 1); assert.equal(noteCount, 1); }
      if (mode === 'exact-revert-note') assert.equal(noteCount, 0, 'a byte-identical reverted structured input is not unsaved');
      assert.equal(refreshed, true, 'untouched structured input must refresh authoritative saved bytes; deliberate local draft must remain local');
      assert.equal(canonicalAfter.markdown, expectedAfter, 'a fresh Save of an untouched reopened input must not silently undo newer saved work');
    });
  }
}
