import assert from "node:assert/strict";
import test from "node:test";
import { fixture, preview, apply, retrieve, pauseClaim, pauseOperationLookup, retained,
  canonicalState, financialState, assertFree, json, receiptCount, arrangementCount,
  privateRows, refused, eraseThroughActualRetention, finish } from "./helpers/canvas-preview-identity-fixture.mjs";

// Every newly created Canvas preview keeps its original private identity after
// content redaction, including correction after a known source-change refusal.
const observations = [];
try {
  for (const mode of ["personal", "selected"]) for (const scenario of ["erased-before", "erased-during"]) {
    await test("same original operation never gains another private identity after " + mode + "/" + scenario,
      { timeout: 30000 }, async () => {
      const state = await fixture(mode);
      let claim, lookup, oldApply, correcting;
      try {
        const current = await refused(state), money = financialState(state), canonical = canonicalState(state);
        if (scenario === "erased-during") {
          lookup = pauseOperationLookup(state);
          correcting = state.call({ ...current, action: "preview" }); await lookup.entered;
        }
        const earlierRequest = { ...current, name: "Earlier same-original saved choice" };
        const earlier = await preview(state, earlierRequest);
        claim = pauseClaim(state); oldApply = apply(state, earlierRequest, earlier); await claim.entered;
        await eraseThroughActualRetention(state, earlier.previewId);
        const erasedRows = privateRows(state);
        assert.equal(erasedRows.length, 1); assert.equal(erasedRows[0].content, "");
        const unavailable = await json(await retrieve(state, current));
        assert.equal(unavailable.http, 409); assert.equal(unavailable.body.error, "canvas_arrangement_operation_unavailable");
        assert.equal(unavailable.body.status, undefined); assert.equal(unavailable.body.disposition, undefined);
        if (lookup) lookup.release(); else correcting = state.call({ ...current, action: "preview" });
        const corrected = await json(await correcting); correcting = null;
        const observation = { mode, scenario, correctedHttp: corrected.http, privateRowCount: privateRows(state).length,
          secondPrivateCreated: privateRows(state).length > 1, correctedHasPreview: Boolean(corrected.body.preview),
          correctedStatus: corrected.body.status ?? null, correctedDisposition: corrected.body.disposition ?? null };
        observations.push(observation);
        assert.equal(privateRows(state).length, 1, "The same original operation must not create a second private row after erasure");
        assert.deepEqual(privateRows(state), erasedRows, "The occupied insert-only private row is not overwritten or resurrected");
        assert.ok(corrected.http >= 400); assert.equal(corrected.body.preview, undefined);
        assert.equal(corrected.body.status, undefined); assert.equal(corrected.body.disposition, undefined);
        assert.deepEqual(canonicalState(state), canonical); assert.equal(receiptCount(state), 0); assert.equal(arrangementCount(state), 0);
        const oldRetry = await json(await apply(state, earlierRequest, earlier)); assert.ok(oldRetry.http >= 400);
        claim.release(); const oldResult = await json(await oldApply); oldApply = null; assert.ok(oldResult.http >= 400);
        assert.deepEqual(canonicalState(state), canonical); assert.equal(receiptCount(state), 0);
        assert.equal(retained(state, earlier.previewId).content, "");
        const checked = await json(await retrieve(state, current)); assert.equal(checked.http, 409);
        assert.equal(checked.body.status, undefined); assert.equal(checked.body.disposition, undefined);
        assert.deepEqual(financialState(state), money); assertFree(state);
        assert.ok(state.controls.maxBindings <= 100);
        Object.assign(observation, { oldRetryHttp: oldRetry.http, heldOldApplyHttp: oldResult.http,
          canonicalReceipts: 0, canonicalArrangements: 0, noReplacementApply: true, maximumBindings: state.controls.maxBindings });
      } finally {
        lookup?.release(); claim?.release();
        if (correcting) await correcting; if (oldApply) await oldApply;
        lookup?.restore(); claim?.restore(); state.sqlite.close();
      }
    });
  }
} finally { finish("CANVAS_PREVIEW_IDENTITY_ERASURE", observations); }
