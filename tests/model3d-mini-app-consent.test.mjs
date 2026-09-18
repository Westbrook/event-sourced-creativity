import test from "node:test";
import assert from "node:assert/strict";
import { parseModel3dMiniAppCostPreview, model3dMiniAppCostApprovalMatches, model3dMiniAppAttemptMatches } from "../src/model/model3d-mini-app-consent.ts";
import { MODEL3D_MINI_APP_SETTINGS } from "../src/model/output-model3d-contract.ts";
import { estimateModel3dCostMicrousd, RODIN_IMAGE_MODEL, RODIN_TEXT_MODEL } from "../src/model/model3d.ts";
const now = Date.parse("2026-09-13T12:00:00.000Z");
const preview = (image = true) => ({ version: "model3d-mini-app-cost-v1", requestId: "model3d-" + "a".repeat(64), actorUserId: "owner", projectId: "project", documentId: "document",
  draftId: "experience-draft-" + "b".repeat(64), sourceDigest: "c".repeat(64), requirementsDigest: "d".repeat(64), preparationDigest: "sha256:" + "e".repeat(64),
  expiresAt: "2026-09-13T12:15:00.000Z", maximumMicrousd: estimateModel3dCostMicrousd(MODEL3D_MINI_APP_SETTINGS), maximumCalls: 1, maximumTokens: 1,
  model: image ? RODIN_IMAGE_MODEL : RODIN_TEXT_MODEL, sourceFilesTransferred: image ? 1 : 0, sourceKind: image ? "image" : null,
  referenceSha256: image ? "f".repeat(64) : null, referenceBytes: image ? 64 : 0, referenceMimeType: image ? "image/png" : null });
const approval = v => ({ ...v, confirmed: true, providerTransferConfirmed: true });
test('replacement binds separate original hold, new ceiling and exact predecessor into fresh consent', () => {
  const v = { ...preview(false), version: 'model3d-mini-app-replacement-cost-v1', replacementCycleId: '1'.repeat(64),
    previousSlotId: 'parent-slot', previousJobId: 'model3d-' + '2'.repeat(64), previousProviderRequestId: 'parent-provider',
    priorHeldMicrousd: 400000, cumulativeMaximumMicrousd: 800000 };
  assert.deepEqual(parseModel3dMiniAppCostPreview(v), v);
  assert.equal(model3dMiniAppCostApprovalMatches(approval(v), v, now), true);
  assert.equal(model3dMiniAppCostApprovalMatches(approval(preview(false)), v, now), false);
  assert.equal(model3dMiniAppAttemptMatches(v, { jobId: v.requestId, attemptOrdinal: 1, previousSlotId: v.previousSlotId }), true);
  for (const key of Object.keys(v)) {
    const changed = { ...approval(v), [key]: typeof v[key] === 'number' ? v[key] + 1 : String(v[key]) + '-changed' };
    assert.equal(model3dMiniAppCostApprovalMatches(changed, v, now), false, key);
  }
  for (const change of [{ attemptOrdinal: 0 }, { attemptOrdinal: 2 }, { previousSlotId: null }, { previousSlotId: 'other' }, { jobId: v.previousJobId }])
    assert.equal(model3dMiniAppAttemptMatches(v, { jobId: v.requestId, attemptOrdinal: 1, previousSlotId: v.previousSlotId, ...change }), false);
  for (const change of [{ version: 'model3d-mini-app-cost-v1' }, { previousJobId: v.requestId }, { priorHeldMicrousd: 0 },
    { cumulativeMaximumMicrousd: 400000 }, { model: RODIN_IMAGE_MODEL, sourceFilesTransferred: 1, sourceKind: 'image', referenceSha256: 'f'.repeat(64), referenceBytes: 64, referenceMimeType: 'image/png' }])
    assert.equal(parseModel3dMiniAppCostPreview({ ...v, ...change }), null);
});
test("explicit exact original terms match text or one owned-reference transfer without minting approval", () => {
  for (const image of [false, true]) {
    const v = preview(image), parsed = parseModel3dMiniAppCostPreview(v);
    assert.deepEqual(parsed, v); assert(Object.isFrozen(parsed)); assert.equal(parsed.confirmed, undefined);
    assert.equal(model3dMiniAppCostApprovalMatches(v, parsed, now), false);
    assert.equal(model3dMiniAppCostApprovalMatches(approval(v), parsed, now), true);
  }
  const saved = { ...preview(), sourceKind: "saved-model-view" };
  assert.equal(model3dMiniAppCostApprovalMatches(approval(saved), saved, now), true);
});
test("every original identity, digest, transfer and finite-cost term is part of approval", () => {
  const original = preview();
  for (const key of Object.keys(original)) {
    const changed = approval(original);
    changed[key] = typeof changed[key] === "number" ? changed[key] + 1 : changed[key] + "-changed";
    assert.equal(model3dMiniAppCostApprovalMatches(changed, original, now), false, key);
  }
  for (const value of [false, 1, "true", null, undefined]) {
    assert.equal(model3dMiniAppCostApprovalMatches({ ...approval(original), confirmed: value }, original, now), false);
    assert.equal(model3dMiniAppCostApprovalMatches({ ...approval(original), providerTransferConfirmed: value }, original, now), false);
  }
  assert.equal(model3dMiniAppCostApprovalMatches(approval(original), original, Date.parse(original.expiresAt)), false);
  assert.equal(model3dMiniAppCostApprovalMatches(approval(original), original, Infinity), false);
});
test("missing, contradictory, extra, accessor and proxy records refuse without invoked getters", () => {
  const changes = [v => { delete v.referenceSha256; }, v => { v.sourceFilesTransferred = 2; }, v => { v.referenceBytes = 24 * 1024 * 1024 + 1; },
    v => { v.maximumMicrousd--; }, v => { v.maximumTokens = 0; }, v => { v.referenceMimeType = "model/gltf-binary"; },
    v => { v.model = RODIN_TEXT_MODEL; }, v => { v.referenceSha256 = "legacy-missing-hash"; }, v => { v.url = "https://not-authority.invalid"; }];
  for (const change of changes) { const v = preview(); change(v); assert.equal(parseModel3dMiniAppCostPreview(v), null); }
  let invoked = 0;
  const v = preview(); Object.defineProperty(v, "referenceSha256", { enumerable: true, get() { invoked++; throw Error("getter"); } });
  assert.equal(parseModel3dMiniAppCostPreview(v), null); assert.equal(invoked, 0);
  const hostile = new Proxy(preview(), { ownKeys() { throw Error("proxy"); } });
  assert.equal(parseModel3dMiniAppCostPreview(hostile), null);
  assert.equal(model3dMiniAppCostApprovalMatches(hostile, preview(), now), false);
  const hidden = approval(preview()); Object.defineProperty(hidden, "grantId", { value: "invented" });
  assert.equal(model3dMiniAppCostApprovalMatches(hidden, preview(), now), false);
});
