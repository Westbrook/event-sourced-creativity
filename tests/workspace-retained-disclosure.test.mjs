import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { canonicalState, financialState, disclosureBoundary, pauseOperationLookup, pauseClaim } from "./helpers/authoring-disclosure-boundary.mjs";
const original = new URL("./workspace-local-proposal-api.test.mjs", import.meta.url), raw = fs.readFileSync(original, "utf8");
assert.equal(createHash("sha256").update(raw).digest("hex"), "503542b8b29d25c6fbf474e9bea4481ee7decfdc750fdf683eebe28032d98c11");
const marker = "for (const mode of [\"personal\", \"migrated\", \"shared\", \"editor\"]) test(\"free workspace atomic protocol:", at = raw.indexOf(marker);
assert.ok(at > 0); assert.equal(raw.indexOf(marker, at + 1), -1);
const virtual = new URL("./workspace-retained-disclosure-fixture.mjs", import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, next) { return specifier === virtual.href ? { url: virtual.href, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === virtual.href ? { format: "module", shortCircuit: true,
    source: raw.slice(0, at) + "\nexport { fixture, intent, preview, confirm, scope };\n" } : next(url, context); },
});
const { fixture, intent, preview, confirm, scope } = await import(virtual.href).finally(() => hook.deregister());

const faults = ["healthy", "erased", "redacted", "missing", "bytes", "source", "owner", "kind", "expiry", "bad-json", "principal", "custody"];
for (const mode of ["personal", "shared"]) for (const route of ["fresh", "retained", "committed", "applying"]) for (const fault of faults)
test("workspace final private disclosure " + mode + "/" + route + "/" + fault, async () => {
  const state = await fixture(mode); let boundary, claim, applying;
  try {
    const request = intent({ prompt: "PRIVATE_WORKSPACE_REVIEW_文書" }), saved = route === "fresh" ? null : await preview(state, request);
    if (route === "committed") { const response = await state.quick(confirm(saved)); assert.equal(response.status, 200); assert.equal((await response.json()).status, "applied"); }
    if (route === "applying") { claim = pauseClaim(state); applying = state.quick(confirm(saved)); await claim.entered; }
    const before = canonicalState(state), finances = financialState(state);
    boundary = disclosureBoundary(state, fault);
    const response = await state.quick(route === "fresh" ? request : confirm(saved, route === "applying" ? "apply" : "retrieve"));
    const value = await response.json(); boundary.restore();
    assert.equal(boundary.evidence.reached, 1); assert.deepEqual(canonicalState(state), before); assert.deepEqual(financialState(state), finances);
    if (fault === "healthy") {
      assert.equal(response.status, route === "applying" ? 202 : 200); assert.equal(value.preview.localReview.prompt, request.prompt);
      assert.equal(value.preview.previewId, saved?.previewId ?? boundary.evidence.previewId);
      if (route === "committed") assert.equal(value.status, "applied");
    } else {
      assert.equal(response.status, route === "committed" && fault !== "principal" ? 200 : 403);
      assert.equal(value.preview, undefined); assert.equal(JSON.stringify(value).includes(request.prompt), false);
      if (route === "committed" && fault !== "principal") { assert.equal(value.status, "applied"); assert.equal(value.previewId, saved.previewId); }
    }
  } finally { boundary?.restore(); claim?.release(); if (applying) await applying; claim?.restore(); await state.close(); }
});

for (const mode of ["personal", "shared"]) for (const fault of ["healthy", "erased"])
test("workspace simultaneous preview catch rechecks the real saved winner " + mode + "/" + fault, async () => {
  const state = await fixture(mode); let pause, boundary, loser;
  try {
    const request = intent({ prompt: "PRIVATE_WORKSPACE_CONCURRENT" }), before = canonicalState(state), finances = financialState(state);
    pause = pauseOperationLookup(state); loser = state.quick(request); await pause.entered;
    const winner = await preview(state, request);
    boundary = disclosureBoundary(state, fault); pause.release();
    const response = await loser; loser = null; const value = await response.json();
    assert.equal(boundary.evidence.reached, 1); assert.equal(boundary.evidence.previewId, winner.previewId);
    if (fault === "healthy") { assert.equal(response.status, 200); assert.equal(value.preview.previewId, winner.previewId); }
    else { assert.equal(response.status, 403); assert.equal(value.preview, undefined); assert.equal(JSON.stringify(value).includes(request.prompt), false); }
    assert.deepEqual(canonicalState(state), before); assert.deepEqual(financialState(state), finances);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='authoring-preview'").get().n, 1);
  } finally { pause?.release(); if (loser) await loser; boundary?.restore(); pause?.restore(); await state.close(); }
});

for (const mode of ["personal", "shared"]) test("workspace reversible removed source retains inspection but never authorizes Apply " + mode, async () => {
  const state = await fixture(mode);
  try {
    const saved = await preview(state); await state.seed([["DocumentRemoved", { document_id: scope.documentId }]]);
    const before = canonicalState(state), response = await state.quick(confirm(saved, "retrieve")), value = await response.json();
    assert.equal(response.status, 200); assert.equal(value.preview.previewId, saved.previewId); assert.equal(value.stale, true);
    assert.deepEqual(canonicalState(state), before);
    const rejected = await state.quick(confirm(saved)), refusal = await rejected.json();
    assert.equal(rejected.status, 403); assert.equal(refusal.error, "context_document_denied");
    assert.notEqual(refusal.status, "applied"); assert.deepEqual(canonicalState(state), before);
  } finally { await state.close(); }
});

for (const mode of ["personal", "shared"]) test("workspace changed approved source bytes fail their original hash " + mode, async () => {
  const state = await fixture(mode);
  try {
    const saved = await preview(state);
    state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.plan.binding.sourceHash','defensive-source-hash') WHERE content_id=?").run(saved.previewId);
    const before = canonicalState(state), response = await state.quick(confirm(saved, "retrieve"));
    assert.equal(response.status, 403); assert.equal((await response.json()).preview, undefined); assert.deepEqual(canonicalState(state), before);
  } finally { await state.close(); }
});
