import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { retainedImageSourceMessage } from "../src/experiences/retained-image-source-message.ts";

// Exact host snapshot method; plain deterministic resource ports, not live browser proof.
const source = readFileSync(new URL("../src/components/forma-experience-host.ts", import.meta.url), "utf8");
const begin = source.indexOf("  #snapshotMatches("), end = source.indexOf("  #candidate(", begin);
const code = stripTypeScriptTypes(source.slice(begin, end).replace("#snapshotMatches", "function snapshotMatches").replaceAll("this.#binding", "this.binding"));
const check = new Function("bindingJson", code + "; return snapshotMatches;")(JSON.stringify);
function fixture() {
  const grant = { id: "original-grant", status: "completed" };
  const state = { output: "image", documentId: "document", projectId: "project", grant,
    current: { source: "changed", sourceDigest: "after-adoption", requirementsDigest: "requirements" },
    plan: { revisionId: "original-plan", sourceDigest: "before-adoption", requirementsDigest: "requirements", targetId: "original-target", targetContractDigest: "original-contract" },
    original: { grantId: grant.id } };
  const snapshot = { documentId: "document", projectId: "project", scope: { kind: "personal", actorUserId: "owner" },
    sourceVerification: { status: "verified" }, permissions: { canRequest: true }, sourceRevision: "after-adoption", requirementRevision: "requirements",
    confirmedPlan: { revisionId: "original-plan", sourceDigest: "before-adoption", requirementsDigest: "requirements",
      targetContractDigests: { "original-target": "original-contract" }, plan: { targets: [{ id: "original-target", media_kind: "image" }] } }, grants: [grant] };
  const resource = { snapshot, state: "ready", accessLost: false, privateUnavailable: false };
  const context = { binding: { ownerId: "owner" }, store: { outputRequirements: { resource: () => resource } } };
  return { state, snapshot, resource, context };
}
test("retained Image matches current source separately from immutable original plan", () => {
  const f = fixture(); assert.equal(check.call(f.context, f.state), true);
  for (const mutate of [
    f => { f.snapshot.sourceRevision = "newer-mutation"; },
    f => { f.snapshot.requirementRevision = "newer-requirements"; },
    f => { f.snapshot.confirmedPlan.revisionId = "different-plan"; },
    f => { f.snapshot.grants = [{ id: "different-grant" }]; },
    f => { f.snapshot.scope.actorUserId = "different-owner"; },
    f => { f.resource.accessLost = true; },
    f => { f.resource.privateUnavailable = true; },
    f => { f.snapshot.permissions.canRequest = false; },
  ]) { const f = fixture(); mutate(f); assert.equal(check.call(f.context, f.state), false); }
});
test("retained context disclosure remains after the image status changes and paid decisions require verified source", () => {
  assert.match(source, /data-experience-retained-source dir="auto"/);
  assert.match(source.slice(source.indexOf("  #paidDecision("), source.indexOf("  #arm(")), /state.current.source !== "verified"/);
  for (const locale of ["en", "fr", "ar", "ja"]) assert.ok(retainedImageSourceMessage(locale).length > 10);
});
