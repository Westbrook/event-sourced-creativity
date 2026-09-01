import assert from "node:assert/strict";
import test from "node:test";
import { outcomeRecipeSaveFixture } from "./helpers/outcome-recipe-save-fixture.mjs";

for (const lost of [false, true]) test(`actual new recipe Save ${lost ? "lost positive ACK" : "healthy ACK"} keeps one original requirement`, { concurrency: false }, async t => {
  const x = await outcomeRecipeSaveFixture(t), proposal = x.proposal("executive-deck");
  await x.open(proposal); await x.acceptInterpretation();
  let drop = lost;
  x.afterSave(entry => { if (drop) { drop = false; assert.equal(entry.status, 200); throw Error("Lost transport after the actual canonical Save"); } });
  await x.save();
  assert.equal(x.saves.length, 1); assert.equal(x.saves[0].status, 200);
  const first = x.saves[0], canonical = await x.fresh();
  assert.equal(canonical.requirements.filter(row => row.blockId === proposal.requirementId).length, 1);
  assert.equal(canonical.requirements.find(row => row.blockId === proposal.requirementId).content, proposal.spec.original_text);
  if (!lost) {
    assert.equal(x.h.store.outputRequirements.retainedWrite(x.h.worker.documentId).status, "acknowledged");
    assert.equal(x.card().snapshot.requirementId, proposal.requirementId); return;
  }
  assert.equal(x.h.store.outputRequirements.retainedWrite(x.h.worker.documentId).status, "unknown");
  const refresh = x.f.tree().visible("button").find(node => node.owner === x.controller && String(node.handlers.click).includes("#refresh(true)"));
  assert.ok(refresh, "the current explicit Output refresh is reachable after a lost new-row Save");
  await x.f.act(refresh);
  assert.equal(x.snapshot().requirements.filter(row => row.blockId === proposal.requirementId).length, 1);
  const original = x.h.store.outputRequirements.retainedWrite(x.h.worker.documentId);
  assert.equal(original.status, "unknown", "a genuine current GET is not the missing original command acknowledgment");
  assert.equal(original.clientMutationId, first.body.clientMutationId); assert.equal(x.saves.length, 1);
  const actions = x.f.tree().visible("button").filter(node => node.owner === x.controller);
  console.log(JSON.stringify({ kind: "recipe-save-recovery", lost, genuineStatus: first.status, mutationId: first.body.clientMutationId,
    eventId: first.reply.command.eventId, requirementId: proposal.requirementId, currentRows: x.snapshot().requirements.length,
    originalStatus: original.status, visibleActions: actions.map(node => node.text), totalSaves: x.saves.length }));
  // Desired liveness assertion. The proposed runtime initially has no such
  // control; do not weaken this to GET-shaped receipt inference or a new save.
  const retry = actions.find(node => node.text === "Retry this exact save");
  assert.ok(retry, "recover the same local SaveIntent explicitly without rebasing or replacing the original");
  await x.f.act(retry);
  assert.equal(x.saves.length, 2); assert.deepEqual(x.saves[1].body, first.body);
  assert.equal(x.saves[1].reply.replayed, true); assert.equal(x.saves[1].reply.command.eventId, first.reply.command.eventId);
  assert.equal(x.h.store.outputRequirements.retainedWrite(x.h.worker.documentId).status, "acknowledged");
  assert.equal((await x.fresh()).requirements.filter(row => row.blockId === proposal.requirementId).length, 1);
});
