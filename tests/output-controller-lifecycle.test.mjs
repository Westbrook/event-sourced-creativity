import assert from "node:assert/strict";
import test from "node:test";
import {
  cardEditorState, changeDocument, controllerFixture, selectUpload,
  startDownload, startPreflight, startSave, startUpload,
} from "./output-ui-source-harness.mjs";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";

// These execute real controller methods with synthetic rendered-handler bindings.
// They do not claim real Lit scheduling, DOM focus, browser activation, or server authority.
const actions = {
  preflight: {
    start: startPreflight,
    response: () => ({ status: "saved", body: { command: { preflight: {
      id: "preflight-doc-a", planRevisionId: "plan-doc-a", termsDigest: "fixture-terms-doc-a", sourceDigest: "source-1", requirementsDigest: "1",
      maximumMicrousd: 1_000_000, maximumCalls: 1, createdAt: "2026-08-27T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      operationAttempts: { "target-doc-a": { ordinal: 0, previousSlotId: null } },
      targets: [{ targetId: "target-doc-a", available: true, provider: "PREFLIGHT_FOR_DOC_A_ONLY", model: "fixture", reasonCode: "output_native_image_ready",
        transferCode: "output_transfer_document_after_authorization", maximumMicrousd: 1_000_000, maximumCalls: 2, settings: { executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY } }],
    } } } }),
    completed: (fixture) => JSON.stringify(fixture.controller.render()).includes("PREFLIGHT_FOR_DOC_A_ONLY"),
  },
  save: {
    start: startSave,
    response: () => ({ status: "saved", body: { receipt: "committed-save" } }),
    completed: (fixture) => cardEditorState(fixture.controller)?.status === "saved",
  },
  upload: {
    start: startUpload,
    response: () => ({ status: "saved", body: { receipt: "committed-upload" } }),
    completed: (fixture) => fixture.effects.uploadResets > 0,
  },
  download: {
    start: startDownload,
    response: () => ({ status: "saved", body: { blob: new Blob(["owned bytes"]), filename: "doc-a.png" } }),
    completed: (fixture) => fixture.effects.downloads > 0,
  },
};

for (const [name, action] of Object.entries(actions)) {
  for (const transition of ["unchanged", "other-document", "disconnect", "return-to-document"]) {
    test(`actual Output controller ${name}: ${transition} while response is pending`, async () => {
      const fixture = await controllerFixture();
      const pending = action.start(fixture);
      assert.equal(fixture.requests.length, 1, "the control scenario must actually dispatch once");
      assert.equal(fixture.requests[0].documentId, "doc-a", "dispatch uses the originating Document");
      if (transition === "other-document" || transition === "return-to-document") changeDocument(fixture.controller, "doc-b");
      if (transition === "return-to-document") changeDocument(fixture.controller, "doc-a");
      if (transition === "disconnect") fixture.controller.disconnectedCallback();
      if (name === "upload" && transition === "other-document") selectUpload(fixture, "new-doc-b.png");
      fixture.pending.resolve(action.response());
      await pending;
      assert.equal(action.completed(fixture), transition === "unchanged",
        "only the still-current view may present completion, reset its form, or download bytes");
      assert.equal(fixture.requests.length, 1, "discarding a stale response must not resubmit the operation");
      if (transition === "other-document") assert.equal(fixture.controller.documentId, "doc-b");
      if (transition === "return-to-document") assert.equal(fixture.controller.documentId, "doc-a");
    });
  }
}

test("actual Output controller can start fresh work after disconnect/reconnect in the same Document", async () => {
  const fixture = await controllerFixture();
  const pending = startPreflight(fixture);
  assert.equal(fixture.requests.length, 1);
  fixture.controller.disconnectedCallback();
  fixture.controller.connectedCallback();
  fixture.controller.willUpdate(new Map());
  fixture.pending.resolve(actions.preflight.response());
  await pending;
  assert.equal(actions.preflight.completed(fixture), false, "the old view's reply stays discarded after reconnection");
  await startPreflight(fixture);
  assert.equal(fixture.requests.length, 2, "retired-view busy state must not permanently block the reconnected view");
});
