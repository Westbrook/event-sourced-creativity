import assert from "node:assert/strict";
import test from "node:test";
import { recordVideoCustodyFailure } from "../worker/video-custody-diagnostic.ts";
test("Video custody diagnostics disclose only fixed reasons and cannot replace failures", () => {
  const original = console.warn, seen: unknown[][] = [];
  try {
    console.warn = (...args: unknown[]) => { seen.push(args); };
    recordVideoCustodyFailure(Object.assign(new Error("video_reference_snapshot_unavailable"), { snapshotReason: "fields" }));
    recordVideoCustodyFailure(new Error("private authored data"));
    recordVideoCustodyFailure({ get code() { assert.fail("getter must not run"); } });
    assert.deepEqual(seen, [
      ["video_reference_custody_refused", { code: "video_reference_snapshot_unavailable", reason: "fields" }],
      ["video_reference_custody_refused", { code: "unknown", reason: "unspecified" }],
      ["video_reference_custody_refused", { code: "unknown", reason: "unspecified" }],
    ]);
    console.warn = () => { throw new Error("logger unavailable"); };
    assert.doesNotThrow(() => recordVideoCustodyFailure(new Error("private data")));
  } finally { console.warn = original; }
});
