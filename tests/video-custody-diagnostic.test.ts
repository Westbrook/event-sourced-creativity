import assert from "node:assert/strict";
import test from "node:test";
import { recordVideoCustodyFailure } from "../worker/video-custody-diagnostic.ts";
import { ProviderRequestError } from "../worker/provider-errors.ts";
test("Video custody diagnostics disclose only fixed reasons and cannot replace failures", () => {
  const original = console.warn, seen: unknown[][] = [];
  try {
    console.warn = (...args: unknown[]) => { seen.push(args); };
    recordVideoCustodyFailure(Object.assign(new Error("video_reference_snapshot_unavailable"), { snapshotReason: "fields" }));
    recordVideoCustodyFailure(new Error("private authored data"));
    recordVideoCustodyFailure({ get code(): never { return assert.fail("getter must not run"); } });
    recordVideoCustodyFailure(new ProviderRequestError({ code: "derived_reference_source_changed", message: "private source",
      category: "provider", scope: "request", action: "edit_request", retryable: false, retryAfterMs: null, requestId: null, httpStatus: 403 }));
    recordVideoCustodyFailure({ get detail(): never { return assert.fail("detail getter must not run"); } });
    assert.deepEqual(seen, [
      ["video_reference_custody_refused", { code: "video_reference_snapshot_unavailable", reason: "fields" }],
      ["video_reference_custody_refused", { code: "unknown", reason: "unspecified" }],
      ["video_reference_custody_refused", { code: "unknown", reason: "unspecified" }],
      ["video_reference_custody_refused", { code: "derived_reference_source_changed", reason: "unspecified" }],
      ["video_reference_custody_refused", { code: "unknown", reason: "unspecified" }],
    ]);
    recordVideoCustodyFailure(new Error("video_reference_source_unavailable"), { contextPresent: false, privateCaptured: true,
      problems: ["private data", "context_source_rights_expired"] });
    assert.deepEqual(seen.at(-1), ["video_reference_custody_refused", { code: "video_reference_source_unavailable", reason: "unspecified",
      contextPresent: false, privateCaptured: true, problems: ["unknown", "context_source_rights_expired"] }]);
    console.warn = () => { throw new Error("logger unavailable"); };
    assert.doesNotThrow(() => recordVideoCustodyFailure(new Error("private data")));
  } finally { console.warn = original; }
});
