import assert from "node:assert/strict";
import test from "node:test";
import { resolveServerRoute } from "../src/platform/applications.ts";
import { isRetainedOutputReaderRoute, routeCapabilities } from "../src/state/route-capabilities.ts";
import { projectTaskDocumentIdFromRoute, artifactFocusRoute, artifactFocusOptionsFromRoute, libraryFocusFromRoute } from "../src/model/routes.ts";
import { parseNativeRetainedOutputRoute } from "../src/model/native-retained-output.ts";

test("native Video resolves the retained app and exact Document without private hydration or job feed", () => {
  const route = `/make/video?document=doc-a&artifact=video-a&revision=2&sha256=${"a".repeat(64)}`;
  assert.deepEqual(resolveServerRoute(route), { application: "creative", entryPath: "/creative/", canonicalFamily: "/make/video" });
  assert.equal(isRetainedOutputReaderRoute(route), true);
  assert.deepEqual(routeCapabilities(route), { profile: "workspace", privateContent: false, jobHistory: false });
  assert.equal(projectTaskDocumentIdFromRoute(route), "doc-a");
  const target = parseNativeRetainedOutputRoute(route); assert.equal(target.output, "video");
  const href = artifactFocusRoute(target.selection.artifactId, "", {
    expectedRevision: target.selection.revision, expectedContentSha256: target.selection.contentSha256, intent: "inspect",
  }, "/library?document=doc-a");
  assert.deepEqual(libraryFocusFromRoute(href), { kind: "artifact", id: "video-a" });
  assert.equal(projectTaskDocumentIdFromRoute(href), "doc-a");
  const options = artifactFocusOptionsFromRoute(href);
  assert.deepEqual(options, { expectedRevision: 2, expectedContentSha256: "a".repeat(64), intent: "inspect" });
  assert.equal(projectTaskDocumentIdFromRoute(route + "&document=other"), "");
  assert.equal(parseNativeRetainedOutputRoute(route + "&document=other"), null);
  assert.equal(parseNativeRetainedOutputRoute("/make/video"), null, "bare route never picks the latest output");
});
