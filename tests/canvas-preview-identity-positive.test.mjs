import assert from "node:assert/strict";
import test from "node:test";
import { fixture, intent, preview, apply, retrieve, pauseClaim, retained, changes, actor,
  canonicalState, financialState, assertFree, json, receiptCount, arrangementCount,
  privateRows, refused, eraseThroughActualRetention, finish } from "./helpers/canvas-preview-identity-fixture.mjs";
const [authoring, policy] = await Promise.all([import("../worker/authoring-commits.ts"), import("../worker/pilot-policy.ts")]);
const observations = [];
const noCosts = (state, money) => { assert.deepEqual(financialState(state), money); assertFree(state); assert.ok(state.controls.maxBindings <= 100); };
async function principal(state) {
  const authorization = await policy.requireUser(new Request("http://localhost/api/canvas/arrangements", { headers: state.headers }), state.env, "viewer", { account: "principal" });
  assert.ok(authorization.user); return authorization.user;
}

// Seed an authentic pre-fence random-ID row using the unchanged default storage
// path and exact actual plan bytes. Remove only the initial unpublished setup row
// and its custody rows, before taking any observation snapshot. No handler changes.
async function legacyPreview(state, request) {
  const prospective = await preview(state, request), source = retained(state, prospective.previewId);
  const saved = JSON.parse(source.content), scope = saved.plan.binding.scope ?? undefined;
  const legacy = await policy.storePrivateContent(state.env, actor(state), "authoring-preview", source.content, scope);
  assert.match(legacy.contentId, /^[a-f0-9-]{36}$/u);
  state.sqlite.exec("BEGIN");
  try {
    state.sqlite.prepare("DELETE FROM private_content_retention_scopes WHERE content_id=?").run(prospective.previewId);
    state.sqlite.prepare("DELETE FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?").run(prospective.previewId);
    state.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(prospective.previewId);
    state.sqlite.exec("COMMIT");
  } catch (error) { state.sqlite.exec("ROLLBACK"); throw error; }
  assert.equal(privateRows(state).length, 1); assert.equal(retained(state, legacy.contentId).content, source.content);
  return { ...prospective, previewId: legacy.contentId };
}

try {
  for (const mode of ["personal", "selected"]) for (const scenario of ["healthy-same-op", "lost-saved", "live-winner", "applied-winner"]) {
    await test("prospective identity preserves " + mode + "/" + scenario, { timeout: 30000 }, async () => {
      const state = await fixture(mode); let claim, pending;
      try {
        const current = await refused(state), money = financialState(state), canonical = canonicalState(state);
        const expected = await authoring.canvasArrangementPreviewId(actor(state), current.operationId);
        if (scenario === "healthy-same-op") {
          const saved = await preview(state, current), before = privateRows(state), again = await preview(state, current);
          assert.equal(saved.previewId, expected); assert.deepEqual(again, saved); assert.deepEqual(privateRows(state), before);
          assert.deepEqual(canonicalState(state), canonical); assert.equal(receiptCount(state), 0);
          const committed = await json(await apply(state, current, saved)); assert.equal(committed.http, 200); assert.equal(committed.body.status, "applied");
          assert.equal((await json(await apply(state, current, saved))).body.previewId, expected);
          assert.equal(receiptCount(state), 1); assert.equal(arrangementCount(state), 1);
        } else {
          const earlierRequest = { ...current, name: "Saved original competing choice" };
          // The test observes the response only to verify its true identity; the
          // would-be correcting caller in lost-saved has never received it.
          const saved = await preview(state, earlierRequest); assert.equal(saved.previewId, expected);
          if (scenario === "live-winner") { claim = pauseClaim(state); pending = apply(state, earlierRequest, saved); await claim.entered; }
          if (scenario === "applied-winner") {
            const committed = await json(await apply(state, earlierRequest, saved)); assert.equal(committed.http, 200); assert.equal(committed.body.status, "applied");
          }
          const before = privateRows(state), count = changes(state), refusedCorrection = await json(await state.call({ ...current, action: "preview" }));
          assert.equal(refusedCorrection.http, 409); assert.equal(refusedCorrection.body.error, "canvas_arrangement_operation_mismatch");
          assert.equal(changes(state), count); assert.deepEqual(privateRows(state), before);
          const checked = await json(await retrieve(state, current)), status = scenario === "lost-saved" ? "review" : scenario === "live-winner" ? "applying" : "applied";
          assert.equal(checked.body.status, status); assert.equal((checked.body.preview ?? checked.body).previewId, expected);
          if (status === "review") assert.equal(checked.body.preview.name, earlierRequest.name);
          if (claim) { claim.release(); assert.equal((await pending).status, 200); pending = null; }
          assert.equal(receiptCount(state), scenario === "lost-saved" ? 0 : 1);
          assert.equal(arrangementCount(state), scenario === "lost-saved" ? 0 : 1);
        }
        noCosts(state, money); observations.push({ mode, scenario, privateRows: privateRows(state).length, receipts: receiptCount(state), maximumBindings: state.controls.maxBindings });
      } finally { claim?.release(); if (pending) await pending; claim?.restore(); state.sqlite.close(); }
    });
  }

  for (const mode of ["personal", "selected"]) await test("same operation survives lost committed acknowledgment: " + mode, { timeout: 30000 }, async () => {
    const state = await fixture(mode);
    try {
      const request = await intent(state), saved = await preview(state, request), money = financialState(state);
      state.controls.loseResponse = true;
      const reply = await json(await apply(state, request, saved)); assert.equal(reply.http, 200); assert.equal(reply.body.status, "applied");
      assert.equal(reply.body.previewId, saved.previewId); const canonical = canonicalState(state), rows = privateRows(state);
      const checked = await json(await retrieve(state, request)); assert.equal(checked.body.status, "applied"); assert.equal(checked.body.previewId, saved.previewId);
      assert.equal((await apply(state, request, saved)).status, 200); assert.deepEqual(canonicalState(state), canonical); assert.deepEqual(privateRows(state), rows);
      assert.equal(receiptCount(state), 1); assert.equal(arrangementCount(state), 1); noCosts(state, money);
      observations.push({ mode, scenario: "lost-commit", receipts: 1, privateRows: rows.length });
    } finally { state.sqlite.close(); }
  });

  await test("Canvas actor/op identity follows existing operation grammar and differs from copy", async () => {
    const actorId = "identity-current-actor", otherActor = "identity-other-actor", common = crypto.randomUUID();
    const first = await authoring.canvasArrangementPreviewId(actorId, common);
    assert.match(first, /^canvas-arrangement-preview-[a-f0-9]{64}$/u);
    assert.equal(first, await authoring.canvasArrangementPreviewId(actorId, common));
    assert.notEqual(first, await authoring.canvasArrangementPreviewId(otherActor, common));
    assert.notEqual(first, await authoring.canvasArrangementPreviewId(actorId, crypto.randomUUID()));
    assert.notEqual(first, await authoring.documentCopyPreviewId(actorId, common));
    for (const operation of ["a", "A", "0", "a:0_-", "a".repeat(80), "\u212A:op", "\u017F"])
      assert.match(await authoring.canvasArrangementPreviewId(actorId, operation), /^canvas-arrangement-preview-[a-f0-9]{64}$/u);
    for (const operation of ["", "-a", "_a", ":a", "a.b", "a/b", "a b", "\u00E9", "a".repeat(81), null, 42])
      await assert.rejects(() => authoring.canvasArrangementPreviewId(actorId, operation), /canvas_arrangement_scope_invalid/u);
    for (const invalidActor of ["", null, 42]) await assert.rejects(() => authoring.canvasArrangementPreviewId(invalidActor, common), /canvas_arrangement_scope_invalid/u);
    observations.push({ scenario: "identity-grammar-actor-and-domain", validOperations: 7, invalidOperations: 11, invalidActors: 3 });
  });

  await test("different operation IDs remain independently previewable after another erasure", { timeout: 30000 }, async () => {
    const state = await fixture("selected");
    try {
      const firstRequest = await intent(state), first = await preview(state, firstRequest), money = financialState(state), canonical = canonicalState(state);
      const secondRequest = await intent(state), second = await preview(state, secondRequest); assert.notEqual(first.previewId, second.previewId);
      await eraseThroughActualRetention(state, first.previewId); const preserved = retained(state, second.previewId);
      const thirdRequest = await intent(state), third = await preview(state, thirdRequest);
      assert.equal(new Set([first.previewId, second.previewId, third.previewId]).size, 3); assert.equal(privateRows(state).length, 3);
      assert.deepEqual(retained(state, second.previewId), preserved); assert.equal(retained(state, first.previewId).content, "");
      assert.deepEqual(canonicalState(state), canonical); noCosts(state, money); observations.push({ scenario: "different-ops", privateRows: 3, receipts: 0 });
    } finally { state.sqlite.close(); }
  });

  await test("same operation ID for two currently authorized actors has two distinct private owners", { timeout: 30000 }, async () => {
    const state = await fixture("editor");
    try {
      const request = await intent(state), editorId = actor(state), editor = await preview(state, request), money = financialState(state), canonical = canonicalState(state);
      state.headers = { "oai-authenticated-user-id": state.ownerId, "oai-authenticated-user-email": state.ownerId + "@example.test" };
      const ownerRequest = await intent(state, { operationId: request.operationId }), owner = await preview(state, ownerRequest);
      assert.notEqual(owner.previewId, editor.previewId); assert.equal(retained(state, editor.previewId).owner_id, editorId);
      assert.equal(retained(state, owner.previewId).owner_id, state.ownerId); assert.equal(privateRows(state).length, 2);
      assert.deepEqual(canonicalState(state), canonical); noCosts(state, money); observations.push({ scenario: "different-actors-same-op", privateRows: 2, receipts: 0 });
    } finally { state.sqlite.close(); }
  });

  for (const mode of ["personal", "selected"]) await test("Canvas namespace is authoring-preview-only, rejects arbitrary IDs and never overwrites: " + mode,
    { timeout: 30000 }, async () => {
    const state = await fixture(mode);
    try {
      const request = await intent(state), original = await preview(state, request), plan = JSON.parse(retained(state, original.previewId).content).plan;
      const owner = actor(state), scope = plan.binding.scope ?? undefined, money = financialState(state), before = privateRows(state);
      const identity = { contentId: await authoring.canvasArrangementPreviewId(owner, crypto.randomUUID()) };
      const kinds = ["prompt", "provider-output", "provider-response", "intent", "condition", "critique", "adaptive-intent", "adaptive-structure", "chat-user", "chat-assistant", "ideation-prompt", "document-artifact", "document-artifact-input", "activity-issue-note", "execution-consent", "context-proposal"];
      for (const kind of kinds) await assert.rejects(() => policy.storePrivateContent(state.env, owner, kind, "rejected non-preview identity", scope, undefined, undefined, identity), /private_content_identity_invalid/u);
      for (const contentId of ["arbitrary", "canvas-preview-" + "a".repeat(64), "canvas-arrangement-preview-" + "a".repeat(63), "canvas-arrangement-preview-" + "A".repeat(64), identity.contentId + "x", "copy-preview-" + "g".repeat(64)])
        await assert.rejects(() => policy.storePrivateContent(state.env, owner, "authoring-preview", "rejected unsupported identity", scope, undefined, undefined, { contentId }), /private_content_identity_invalid/u);
      assert.deepEqual(privateRows(state), before);
      const saved = await policy.storePrivateContent(state.env, owner, "authoring-preview", "Original opaque private preview", scope, undefined, undefined, identity);
      const intact = retained(state, saved.contentId);
      await assert.rejects(() => policy.storePrivateContent(state.env, owner, "authoring-preview", "Replacement must never overwrite", scope, undefined, undefined, identity), /UNIQUE constraint/u);
      assert.deepEqual(retained(state, saved.contentId), intact);
      await eraseThroughActualRetention(state, saved.contentId); const erased = retained(state, saved.contentId);
      await assert.rejects(() => policy.storePrivateContent(state.env, owner, "authoring-preview", "Erased bytes must never return", scope, undefined, undefined, identity), /UNIQUE constraint/u);
      assert.deepEqual(retained(state, saved.contentId), erased); noCosts(state, money);
      observations.push({ mode, scenario: "namespace-and-insert-only", invalidKinds: kinds.length, invalidIds: 6 });
    } finally { state.sqlite.close(); }
  });

  for (const mode of ["personal", "selected"]) await test("all existing default private-content kinds retain random IDs: " + mode, { timeout: 30000 }, async () => {
    const state = await fixture(mode);
    try {
      const request = await intent(state), saved = await preview(state, request), scope = JSON.parse(retained(state, saved.previewId).content).plan.binding.scope ?? undefined;
      const money = financialState(state), ids = [];
      const kinds = ["prompt", "provider-output", "provider-response", "intent", "condition", "critique", "adaptive-intent", "adaptive-structure", "chat-user", "chat-assistant", "ideation-prompt", "document-artifact", "document-artifact-input", "activity-issue-note", "execution-consent", "context-proposal", "authoring-preview"];
      for (const kind of kinds) for (let repeat = 0; repeat < 2; repeat++) {
        const row = await policy.storePrivateContent(state.env, actor(state), kind, "Independent default private body", scope);
        assert.match(row.contentId, /^[a-f0-9-]{36}$/u); assert.equal(retained(state, row.contentId).kind, kind); ids.push(row.contentId);
      }
      assert.equal(new Set(ids).size, kinds.length * 2); noCosts(state, money);
      observations.push({ mode, scenario: "default-private-kinds", kinds: kinds.length, distinctIds: ids.length });
    } finally { state.sqlite.close(); }
  });

  for (const mode of ["personal", "selected"]) await test("other authoring operation still uses its existing random preview and supersession behavior: " + mode,
    { timeout: 30000 }, async () => {
    const state = await fixture(mode);
    try {
      const request = await intent(state), canvas = await preview(state, request), actorUser = await principal(state), canvasRow = retained(state, canvas.previewId);
      const original = JSON.parse(canvasRow.content).plan, plan = { ...original, operation: "context-proposal",
        binding: { ...original.binding, operation: "context-proposal" }, events: [], changes: [], arrangement: undefined,
        result: { operationId: request.operationId, blockIds: [], relationCount: 0 } };
      const money = financialState(state), canonical = canonicalState(state);
      // This is the storage selector's typed input contract, not a claim that an
      // empty proposal is a valid user-facing Apply operation.
      const first = await authoring.storeAuthoringPreview(state.env, actorUser, plan), second = await authoring.storeAuthoringPreview(state.env, actorUser, plan);
      assert.match(first.previewId, /^[a-f0-9-]{36}$/u); assert.match(second.previewId, /^[a-f0-9-]{36}$/u); assert.notEqual(first.previewId, second.previewId);
      assert.equal(JSON.parse(retained(state, first.previewId).content).state, "dismissed"); assert.equal(JSON.parse(retained(state, second.previewId).content).state, "review");
      assert.deepEqual(retained(state, canvas.previewId), canvasRow); assert.deepEqual(canonicalState(state), canonical); noCosts(state, money);
      observations.push({ mode, scenario: "other-authoring-kind", randomIdsRemainDistinct: true, originalSupersessionRetained: true });
    } finally { state.sqlite.close(); }
  });

  for (const mode of ["personal", "selected"]) for (const lifecycle of ["review", "applying", "applied"]) {
    await test("retained legacy random preview remains recoverable: " + mode + "/" + lifecycle, { timeout: 30000 }, async () => {
      const state = await fixture(mode); let claim, pending;
      try {
        const request = await refused(state), saved = await legacyPreview(state, request), money = financialState(state);
        if (lifecycle === "applying") { claim = pauseClaim(state); pending = apply(state, request, saved); await claim.entered; }
        if (lifecycle === "applied") { assert.equal((await apply(state, request, saved)).status, 200); await eraseThroughActualRetention(state, saved.previewId); }
        const before = privateRows(state), canonical = canonicalState(state), checked = await json(await retrieve(state, request));
        assert.equal(checked.body.status, lifecycle); assert.equal((checked.body.preview ?? checked.body).previewId, saved.previewId);
        const repeated = await json(await state.call({ ...request, action: "preview" })); assert.equal(repeated.body.status, lifecycle);
        assert.equal((repeated.body.preview ?? repeated.body).previewId, saved.previewId);
        assert.deepEqual(privateRows(state), before); assert.deepEqual(canonicalState(state), canonical); assert.equal(privateRows(state).length, 1);
        if (claim) { claim.release(); assert.equal((await pending).status, 200); pending = null; }
        noCosts(state, money); observations.push({ mode, scenario: "retained-legacy-" + lifecycle, retainedIdStillRandom: true, privateRows: 1 });
      } finally { claim?.release(); if (pending) await pending; claim?.restore(); state.sqlite.close(); }
    });
  }

  for (const mode of ["personal", "selected"]) await test("prospective-only limit: erased legacy random ID cannot be retrospectively mapped: " + mode,
    { timeout: 30000 }, async () => {
    const state = await fixture(mode);
    try {
      const request = await refused(state), legacy = await legacyPreview(state, request); await eraseThroughActualRetention(state, legacy.previewId);
      const old = retained(state, legacy.previewId), money = financialState(state), canonical = canonicalState(state);
      const missing = await json(await retrieve(state, request)); assert.equal(missing.http, 409); assert.equal(missing.body.status, undefined);
      const prospective = await preview(state, request);
      assert.equal(prospective.previewId, await authoring.canvasArrangementPreviewId(actor(state), request.operationId));
      assert.notEqual(prospective.previewId, legacy.previewId); assert.equal(privateRows(state).length, 2);
      assert.deepEqual(retained(state, legacy.previewId), old); assert.deepEqual(canonicalState(state), canonical); assert.equal(receiptCount(state), 0); noCosts(state, money);
      observations.push({ mode, scenario: "erased-legacy-limit", prospectiveOnly: true, retrospectiveIdentityRecoveryClaimed: false, privateRows: 2, receipts: 0 });
    } finally { state.sqlite.close(); }
  });
} finally { finish("CANVAS_PREVIEW_IDENTITY_POSITIVE", observations); }
