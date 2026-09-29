import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OUTPUT_SCOPE_AMENDMENT_REASON_MAX_LENGTH,
  isOutputScopeAmendmentReason,
  outputScopeAmendmentReasonIssue,
} from "../src/model/output-scope-amendment.ts";
import { evaluateOutputDeliveryHistory } from "../src/model/output-delivery-manifest.ts";
import { createOutputDeliveryArchive, planOutputDeliveryParts } from "../src/model/output-delivery-archive.ts";
import { png, readStoredZip } from "./output-asset-fixtures.mjs";

const controlIssue = "output_scope_amendment_reason_control_characters";
const createdAt = "2026-08-27T12:00:00.000Z";
function amendment(reason) {
  return {
    id: "amendment-1", previousPlanRevisionId: "revision-1", planRevisionId: "revision-2",
    occurredAt: "2026-08-27T11:00:00.000Z", reason, actorRole: "authorized_author",
    withdrawnObligations: [], withdrawnTargets: [{ id: "old-target", label: "Withdrawn video" }],
  };
}
function history(reason, scopeHistoryComplete = true) {
  return { scopeHistoryComplete, scopeAmendments: [amendment(reason)] };
}
function freezeDeep(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}
function archiveRequest(reason) {
  const bytes = png();
  const file = { id: "cover-file", name: "cover.png", bytes, expectedSha256: createHash("sha256").update(bytes).digest("hex") };
  const input = {
    schemaVersion: 1, deliveryId: "delivery-1", planId: "plan-1", planRevision: "revision-2", createdAt,
    targets: [{ targetId: "cover:target:1", fileId: file.id, acceptanceId: "accepted-cover" }],
    scope: {
      status: "complete", inventoryComplete: true, reasonCodes: [],
      groups: [{ id: "cover-group", requirementId: "output-1", label: "Cover", required: true, obligationIds: ["cover"] }],
      obligations: [{ id: "cover", requirementId: "output-1", deliverableId: "cover-group", label: "Cover", required: true, selected: true, resolution: "resolved", targetIds: ["cover:target:1"] }],
      targets: [{ id: "cover:target:1", obligationId: "cover", label: "Cover 1", reasonCodes: [] }], unresolvedGroups: [],
    },
    ...history(reason),
  };
  return { file, input };
}

test("optional reason policy distinguishes absence from invalid types", () => {
  assert.equal(outputScopeAmendmentReasonIssue(undefined), null);
  assert.equal(outputScopeAmendmentReasonIssue(undefined, { required: true }), "output_scope_amendment_reason_required");
  for (const value of [null, 0, 1, false, true, {}, [], new String("A reason")]) {
    assert.equal(outputScopeAmendmentReasonIssue(value), "invalid_output_scope_amendment_reason");
    assert.equal(outputScopeAmendmentReasonIssue(value, { required: true }), "invalid_output_scope_amendment_reason");
  }
});

test("optional blank is valid but required withdrawal needs nonblank text", () => {
  for (const value of ["", " ", "\t\r\n ", "\u00a0", "\u2003"]) {
    assert.equal(outputScopeAmendmentReasonIssue(value), null);
    assert.equal(outputScopeAmendmentReasonIssue(value, { required: true }), "output_scope_amendment_reason_required");
  }
});

test("the shared maximum is 2000 UTF-16 code units without truncation", () => {
  assert.equal(OUTPUT_SCOPE_AMENDMENT_REASON_MAX_LENGTH, 2000);
  for (const value of ["a".repeat(2000), "😀".repeat(1000)]) {
    assert.equal(value.length, 2000);
    assert.equal(outputScopeAmendmentReasonIssue(value, { required: true }), null);
    assert.equal(outputScopeAmendmentReasonIssue(`${value}a`), "output_scope_amendment_reason_too_long");
    assert.equal(value.length, 2000);
  }
  assert.equal(outputScopeAmendmentReasonIssue(" ".repeat(2001)), "output_scope_amendment_reason_too_long");
});

test("ordinary Unicode and multiline reasons remain exact authored text", () => {
  const reasons = [
    "  Résumé : publier la présentation.  ",
    "理由：動画は次回に公開します。",
    "سبب التعديل: نشر العرض الآن",
    "Keep this part 😀; withdraw the videos.",
    "First line\twith a tab\r\nSecond line\nThird line\rFinal line",
    "e\u0301 remains decomposed, not normalized",
  ];
  for (const reason of reasons) {
    assert.equal(outputScopeAmendmentReasonIssue(reason, { required: true }), null);
    const manifest = evaluateOutputDeliveryHistory(history(reason), "complete", createdAt, "revision-2");
    assert.equal(manifest.scopeAmendments[0].reason, reason);
    assert.equal(JSON.parse(JSON.stringify(manifest)).scopeAmendments[0].reason, reason);
    assert.equal(manifest.deliveryStatus, "complete_for_amended_scope");
    assert.equal(manifest.scopeAmendments[0].withdrawnTargets[0].disposition, "withdrawn_from_previous_scope");
  }
});

test("every Cc control is rejected except TAB, CR, and LF", () => {
  for (const codepoint of [...Array.from({ length: 32 }, (_, index) => index), ...Array.from({ length: 33 }, (_, index) => index + 127)]) {
    const reason = `Before${String.fromCodePoint(codepoint)}after`;
    assert.equal(outputScopeAmendmentReasonIssue(reason), [9, 10, 13].includes(codepoint) ? null : controlIssue, `U+${codepoint.toString(16)}`);
  }
});

test("format controls including bidi overrides and ZWJ follow the existing export policy", () => {
  for (const codepoint of [0x00ad, 0x061c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff, 0xe0001]) {
    assert.equal(outputScopeAmendmentReasonIssue(`Before${String.fromCodePoint(codepoint)}after`), controlIssue, `U+${codepoint.toString(16)}`);
  }
  assert.equal(outputScopeAmendmentReasonIssue("Use the revised scope 👩\u200d💻"), controlIssue);
});

test("forbidden characters cannot disappear through trim or optional blank omission", () => {
  for (const reason of ["\ufeff", " \ufeff ", "\u000b", "\ufeffPublish the deck\ufeff"]) {
    assert.equal(outputScopeAmendmentReasonIssue(reason), controlIssue);
    assert.equal(outputScopeAmendmentReasonIssue(reason, { required: true }), controlIssue);
    assert.notEqual(reason, reason.trim());
  }
});

test("boolean predicate and actionable issue helper use the same policy", () => {
  for (const reason of [undefined, null, 12, "", " ", "reason", "a".repeat(2001), "\ufeff", "\tReason\r\n", "👩\u200d💻"]) {
    for (const options of [{}, { required: false }, { required: true }]) {
      assert.equal(isOutputScopeAmendmentReason(reason, options), outputScopeAmendmentReasonIssue(reason, options) === null);
    }
  }
});

test("portable history accepts the same exact boundary as required authoring", () => {
  for (const reason of ["x".repeat(2000), "😀".repeat(1000)]) {
    assert.equal(isOutputScopeAmendmentReason(reason, { required: true }), true);
    assert.equal(evaluateOutputDeliveryHistory(history(reason), "complete", createdAt, "revision-2").scopeAmendments[0].reason, reason);
  }
});

test("invalid history preserves its existing export error and never rewrites authored values", () => {
  for (const reason of [undefined, null, 42, "", " \t\r\n", "x".repeat(2001), "bad\u0000reason", "bad\u202ereason", "👩\u200d💻", "\ufeff"]) {
    const input = freezeDeep(history(reason)), before = structuredClone(input);
    assert.equal(isOutputScopeAmendmentReason(reason, { required: true }), false);
    assert.throws(() => evaluateOutputDeliveryHistory(input, "complete", createdAt, "revision-2"), { message: "invalid_output_delivery_scope_amendment_reason" });
    assert.deepEqual(input, before);
  }
});

test("unverified ancestry does not silently omit a known invalid reason", () => {
  for (const scopeHistoryComplete of [false, undefined]) {
    const input = { scopeHistoryComplete, scopeAmendments: [amendment("bad\u202ereason")] };
    const before = structuredClone(input);
    assert.throws(() => evaluateOutputDeliveryHistory(input, "complete", createdAt, "revision-2"), { message: "invalid_output_delivery_scope_amendment_reason" });
    assert.deepEqual(input, before);
  }
});

test("a valid later amendment does not make an invalid retained ancestor exportable", () => {
  const input = history("bad\u202ereason");
  input.scopeAmendments.push({ ...amendment("A later valid reason"), id: "amendment-2", previousPlanRevisionId: "revision-2", planRevisionId: "revision-3" });
  const before = structuredClone(input);
  assert.throws(() => evaluateOutputDeliveryHistory(input, "complete", createdAt, "revision-3"), { message: "invalid_output_delivery_scope_amendment_reason" });
  assert.deepEqual(input, before);
  assert.equal(input.scopeAmendments.length, 2);
});

test("a valid reason does not establish missing ancestry or unqualified completion", () => {
  const input = history("Publish the deck first", false);
  const manifest = evaluateOutputDeliveryHistory(input, "complete", createdAt, "revision-2");
  assert.equal(manifest.scopeHistoryComplete, false);
  assert.equal(manifest.currentScopeStatus, "complete");
  assert.equal(manifest.deliveryStatus, "unknown");
  assert.equal(manifest.completionQualification, "current_scope_complete_history_unknown");
  assert.equal(manifest.scopeAmendments[0].reason, input.scopeAmendments[0].reason);
  assert.match(manifest.completionExplanation, /history is unverified/);
});

test("actual ZIP JSON and CSV preserve a valid multiline Unicode reason exactly", async () => {
  const reason = '  Première ligne "exacte"\t東京 😀\r\nDeuxième ligne  ';
  const { file, input } = archiveRequest(reason), before = structuredClone(input);
  const result = await createOutputDeliveryArchive([file], input);
  const entries = readStoredZip(result.bytes), decoder = new TextDecoder();
  const manifest = JSON.parse(decoder.decode(entries.get("manifest.json")));
  assert.equal(manifest.scopeAmendments[0].reason, reason);
  assert.equal(manifest.deliveryStatus, "complete_for_amended_scope");
  const csv = decoder.decode(entries.get("manifest.csv"));
  assert.ok(csv.includes(`,"${reason.replaceAll('"', '""')}"\r\n`));
  assert.deepEqual(input, before);
  assert.deepEqual(entries.get("files/cover-file.png"), file.bytes);
});

test("metadata preflight and real ZIP creation refuse invalid reasons without changing history", async () => {
  for (const reason of ["bad\u202ereason", "👩\u200d💻", "\ufeff"]) {
    const { file, input } = archiveRequest(reason), before = structuredClone(input);
    assert.equal(outputScopeAmendmentReasonIssue(reason, { required: true }), controlIssue);
    assert.throws(() => planOutputDeliveryParts([{ id: file.id, byteLength: file.bytes.length }], input), { message: "invalid_output_delivery_scope_amendment_reason" });
    await assert.rejects(createOutputDeliveryArchive([file], input), { message: "invalid_output_delivery_scope_amendment_reason" });
    assert.deepEqual(input, before);
  }
});
