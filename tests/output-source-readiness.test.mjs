import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  captureOutputRelease, classifyOutputUploadFailure, outputDeliveryReadiness, outputNativeReadiness, outputPackageReadiness,
  outputReleaseStillAllowed, outputSourceCapacity, outputSourceGovernance, outputSourceReadiness, outputUploadCanRestage, outputUploadNeedsRestage,
} from "../src/components/output-source-readiness.ts";

const capacity = () => ({ referenceCount: 0, distinctObjectCount: 0, ownedReadLimit: 4, nativeLimit: 0, countsComplete: true, sourcesComplete: true, sources: [] });
const snapshot = () => ({ documentId: "fixture-document", revision: "head-1", sourceRevision: "source-1", requirementRevision: "requirements-1",
  sourceVerification: { status: "verified", reasonCodes: [], capacity: capacity() },
  confirmedPlan: { revisionId: "plan-1", sourceDigest: "source-1", requirementsDigest: "requirements-1" },
  summary: { scope_known: true, completion: "unresolved", delivery_ready: false }, permissions: { canAuthor: true }, capabilities: { limitationCodes: [] } });

test("unverified immutable scope history blocks only packages, not verified source, work, or exact-file review", () => {
  const data = snapshot();
  data.capabilities.limitationCodes = ["output_scope_history_reason_unverified"];
  assert.equal(outputPackageReadiness(data).reason, "history_unverified");
  assert.deepEqual(outputPackageReadiness(data).reasonCodes, ["output_scope_history_reason_unverified"]);
  assert.equal(captureOutputRelease(data, "package"), null);
  assert.ok(captureOutputRelease(data, "file"));
  assert.equal(outputSourceReadiness(data).allowed, true);
  assert.equal(outputDeliveryReadiness(data).allowed, true);
  assert.equal(outputNativeReadiness(data).allowed, true);
  const changedPlan = structuredClone(data); changedPlan.confirmedPlan.revisionId = "new-plan";
  assert.equal(outputPackageReadiness(changedPlan).reason, "history_unverified", "reconfirming cannot repair immutable ancestry");
});

test("a same-revision history failure after a package capture retires package bytes but permits exact-file release", () => {
  const data = snapshot(), file = captureOutputRelease(data, "file"), packageCapture = captureOutputRelease(data, "package");
  assert.ok(file); assert.ok(packageCapture);
  data.capabilities.limitationCodes = ["output_scope_history_reason_unverified"];
  assert.equal(outputReleaseStillAllowed(packageCapture, data), false);
  assert.equal(outputReleaseStillAllowed(file, data), true);
  assert.equal(data.revision, "head-1"); assert.equal(data.sourceRevision, "source-1");
});

test("actual controller timing methods treat missing/null settings as unknown and block new approval", async () => {
  // Unit-boundary execution of the two actual methods; this is not a browser or store substitute.
  const root = process.env.FORMA_OUTPUT_REGRESSION_ROOT || fileURLToPath(new URL("../", import.meta.url));
  const ts = createRequire(resolve(root, "package.json"))("typescript");
  const [policy, messages] = await Promise.all([
    import(pathToFileURL(resolve(root, "src/model/output-execution-policy.ts")).href),
    import(pathToFileURL(resolve(root, "src/components/design-system/locales/output-delivery-runtime-messages.ts")).href),
  ]);
  const source = readFileSync(new URL("../src/components/forma-output-requirements.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("controller.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = parsed.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "FormaOutputRequirements");
  const methods = ["#preflightAvailable", "#executionWindow"].map((name) => declaration.members.find((node) => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name).getText(parsed));
  const isolated = `class TimingBoundary { ${methods.join("\n")} #message(code, values) { return {code, values}; } available(value) { return this.#preflightAvailable(value); } window(value) { return this.#executionWindow(value); } }`;
  const javascript = ts.transpileModule(isolated, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Boundary = new Function("readOutputNativeExecutionPolicy", "outputDeliveryMessageDescriptor", `${javascript}; return TimingBoundary;`)(policy.readOutputNativeExecutionPolicy, messages.outputDeliveryMessageDescriptor);
  const boundary = new Boundary();
  const offered = { available: true, reasonCode: "output_native_image_ready", transferCode: "output_transfer_document_after_authorization" };
  for (const settings of [undefined, null, {}, { executionPolicy: { maximumMilliseconds: 240000 } }]) {
    assert.equal(boundary.available({ targets: [{ ...offered, settings }] }), false);
    assert.equal(boundary.window({ ...offered, settings }).code, "output_native_execution_window_unknown");
  }
  const current = { ...offered, settings: { executionPolicy: policy.OUTPUT_NATIVE_EXECUTION_POLICY } };
  assert.equal(boundary.available({ targets: [current] }), true);
  assert.deepEqual(boundary.window(current), { code: "output_native_execution_window", values: { maximumExecutionSeconds: 240 } });
});

test("equal digests cannot make unavailable source proof ready", () => {
  const data = snapshot();
  data.sourceVerification = { status: "unavailable", reasonCodes: ["context_source_evidence_capacity_exceeded"] };
  assert.equal(data.confirmedPlan.sourceDigest, data.sourceRevision);
  assert.equal(outputSourceReadiness(data).allowed, false);
  assert.equal(outputDeliveryReadiness(data).reason, "source_unavailable");
  assert.equal(outputNativeReadiness(data).allowed, false);
  assert.deepEqual(outputSourceReadiness(data).reasonCodes, ["context_source_evidence_capacity_exceeded"]);
});

test("missing, malformed, or contradictory verification is never inferred as verified", () => {
  for (const value of [undefined, null, {}, [], { status: "verified" }, { status: "verified", reasonCodes: [7] }, { status: "future", reasonCodes: [] }]) {
    assert.equal(outputSourceReadiness({ sourceVerification: value }).reason, "source_unknown");
  }
  assert.equal(outputSourceReadiness({ sourceVerification: { status: "verified", reasonCodes: ["source_context_unavailable"] } }).allowed, false);
  assert.equal(outputSourceReadiness({ sourceVerification: { status: "unavailable", reasonCodes: [] } }).reason, "source_unavailable");
});

test("known unresolved work is allowed; incomplete scope is not", () => {
  const data = snapshot();
  assert.equal(data.summary.delivery_ready, false);
  assert.equal(outputDeliveryReadiness(data).allowed, true);
  data.summary.scope_known = false;
  assert.equal(outputDeliveryReadiness(data).reason, "scope_unknown");
  data.summary = null;
  assert.equal(outputDeliveryReadiness(data).allowed, false);
});

test("model or custody capacity is explained before stale-plan guidance", () => {
  const data = snapshot();
  data.sourceRevision = "source-2";
  data.summary.scope_known = false;
  data.capabilities.limitationCodes = ["output_full_document_recheck", "output_read_model_private_evidence_incomplete", "output_custody_inventory_incomplete"];
  const gate = outputDeliveryReadiness(data);
  assert.equal(gate.reason, "scope_unknown");
  assert.deepEqual(gate.reasonCodes, ["output_read_model_private_evidence_incomplete", "output_custody_inventory_incomplete"]);
});

test("known stale plan remains distinct from matching-but-unavailable scope", () => {
  const data = snapshot(); data.requirementRevision = "requirements-2";
  assert.equal(outputDeliveryReadiness(data).reason, "plan_stale");
  data.sourceVerification.status = "unavailable"; data.sourceVerification.reasonCodes = ["context_source_rights_expired"];
  assert.equal(outputDeliveryReadiness(data).reason, "source_unavailable", "rights errors must not recommend reconfirming as a repair");
});

test("verified uploads and standalone file reads do not require a confirmed plan", () => {
  const data = snapshot(); data.confirmedPlan = null; data.summary = null;
  assert.equal(outputSourceReadiness(data).allowed, true);
  assert.equal(outputDeliveryReadiness(data).reason, "plan_unconfirmed");
  assert.ok(captureOutputRelease(data, "file"));
  assert.equal(captureOutputRelease(data, "package"), null);
});

test("file bytes fetched earlier cannot be released after source verification fails without digest changes", () => {
  const data = snapshot(), captured = captureOutputRelease(data, "file");
  assert.ok(captured);
  data.sourceVerification.status = "unavailable";
  data.sourceVerification.reasonCodes = ["output_source_private_evidence_unavailable"];
  assert.equal(outputReleaseStillAllowed(captured, data), false);
  delete data.sourceVerification;
  assert.equal(outputReleaseStillAllowed(captured, data), false);
});

test("package parts require the same current plan and a completely known scope after awaited bytes", () => {
  const data = snapshot(), captured = captureOutputRelease(data, "package");
  assert.ok(captured);
  data.summary.scope_known = false;
  assert.equal(outputReleaseStillAllowed(captured, data), false);
  data.summary.scope_known = true; data.confirmedPlan.revisionId = "plan-2";
  assert.equal(outputReleaseStillAllowed(captured, data), false);
  data.confirmedPlan.revisionId = "plan-1"; data.documentId = "another-document";
  assert.equal(outputReleaseStillAllowed(captured, data), false);
});

test("an unrelated owner head does not change an otherwise exact release contract", () => {
  const data = snapshot(), captured = captureOutputRelease(data, "package");
  data.revision = "another-owner-event";
  assert.equal(outputReleaseStillAllowed(captured, data), true);
  data.sourceRevision = "source-2";
  assert.equal(outputReleaseStillAllowed(captured, data), false);
});

test("only the exact revision-conflict code is classified as pure CAS", () => {
  assert.deepEqual(classifyOutputUploadFailure({ status: "conflict", body: { error: "output_revision_conflict" } }), { kind: "revision", code: "output_revision_conflict" });
  for (const code of ["context_source_evidence_capacity_exceeded", "context_source_rights_expired", "output_source_projection_stale", "output_private_evidence_missing", "output_source_private_evidence_unavailable", "future_409"]) {
    const failure = classifyOutputUploadFailure({ status: "conflict", body: { error: code } });
    assert.equal(failure.kind, "rejected", code);
    assert.equal(outputUploadNeedsRestage(failure), false, code);
  }
  assert.equal(classifyOutputUploadFailure({ status: "conflict", body: null }).kind, "rejected");
  assert.equal(classifyOutputUploadFailure({ status: "invalid", body: { error: "output_revision_conflict" } }).kind, "rejected");
});

test("an ambiguous authority guard is not a revision claim and requires a fresh authorized read", () => {
  const failure = classifyOutputUploadFailure({ status: "conflict", body: { error: "output_revision_or_authority_changed" } });
  assert.equal(failure.kind, "authority");
  const data = snapshot();
  assert.equal(outputUploadCanRestage(failure, "head-1", data, false), false);
  assert.equal(outputUploadCanRestage(failure, "head-1", data, true), true);
  data.permissions.canAuthor = false;
  assert.equal(outputUploadCanRestage(failure, "head-1", data, true), false);
});

test("pure CAS restaging requires a fresh verified newer head and never accepts capacity as permission", () => {
  const failure = classifyOutputUploadFailure({ status: "conflict", body: { error: "output_revision_conflict" } });
  const data = snapshot();
  assert.equal(outputUploadCanRestage(failure, "head-1", data, true), false);
  data.revision = "head-2";
  assert.equal(outputUploadCanRestage(failure, "head-1", data, false), false);
  assert.equal(outputUploadCanRestage(failure, "head-1", data, true), true);
  data.sourceVerification.status = "unavailable";
  assert.equal(outputUploadCanRestage(failure, "head-1", data, true), false);
  data.sourceVerification.status = "verified";
  const capacityFailure = classifyOutputUploadFailure({ status: "conflict", body: { error: "context_source_evidence_capacity_exceeded" } });
  assert.equal(outputUploadCanRestage(capacityFailure, "head-1", data, true), false);
});

test("lost responses remain uncertain and do not authorize a new staged operation", () => {
  const failure = classifyOutputUploadFailure({ status: "unavailable", body: null });
  assert.equal(failure.kind, "uncertain"); assert.equal(outputUploadNeedsRestage(failure), false);
  assert.equal(classifyOutputUploadFailure({ status: "saved", body: {} }), null);
});

test("missing numeric capacity cannot be interpreted as zero imports or a fitting native route", () => {
  for (const replacement of [undefined, null, {}, { nativeLimit: 0 }, { ...capacity(), distinctObjectCount: "0" }, { ...capacity(), nativeLimit: -1 }, { ...capacity(), ownedReadLimit: Infinity }]) {
    const data = snapshot(); data.sourceVerification.capacity = replacement;
    assert.equal(outputSourceReadiness(data).allowed, true, "source health and route metadata are separate");
    assert.equal(outputNativeReadiness(data).reason, "capacity_unknown");
  }
});

test("an observed zero is not a verified total when countsComplete is false", () => {
  const data = snapshot(); data.sourceVerification.capacity.countsComplete = false;
  assert.equal(outputSourceCapacity(data).distinctObjectCount, 0);
  assert.equal(outputSourceCapacity(data).countsComplete, false);
  assert.equal(outputNativeReadiness(data).reason, "capacity_unknown");
});

test("the native route uses the supplied native limit, independently of the owned/read limit", () => {
  const data = snapshot();
  data.sourceVerification.capacity = { ...capacity(), referenceCount: 2, distinctObjectCount: 1, nativeLimit: 0,
    sources: [{ blockId: "one", label: "Authorized source" }, { blockId: "two", label: "Second reference to the same source" }] };
  assert.equal(outputSourceReadiness(data).allowed, true);
  assert.equal(outputDeliveryReadiness(data).allowed, true);
  assert.equal(outputNativeReadiness(data).reason, "native_capacity");
  assert.deepEqual(outputNativeReadiness(data).values, { count: 1, limit: 0 });
  data.sourceVerification.capacity.nativeLimit = 1;
  assert.equal(outputNativeReadiness(data).allowed, true);
  data.sourceVerification.capacity.distinctObjectCount = 2;
  assert.equal(outputNativeReadiness(data).reason, "native_capacity");
});

test("bounded or invalid display-name rows do not invent another numeric capacity limit", () => {
  const data = snapshot(); data.sourceVerification.capacity = { ...capacity(), referenceCount: 35, distinctObjectCount: 1, nativeLimit: 1,
    sourcesComplete: false, sources: Array.from({ length: 32 }, (_, index) => ({ blockId: `reference-${index}`, label: `Authorized reference ${index}` })) };
  assert.equal(outputSourceCapacity(data).sources.length, 32);
  assert.equal(outputSourceCapacity(data).sourcesComplete, false);
  assert.equal(outputNativeReadiness(data).allowed, true, "35 references to one verified object can fit a one-object route");
  data.sourceVerification.capacity.sources.push({ blockId: null, label: "Unusable row" });
  assert.equal(outputSourceCapacity(data).sources.length, 32);
  assert.equal(outputNativeReadiness(data).allowed, true);
});

test("capacity metadata is not proof of source health or a known complete delivery scope", () => {
  const data = snapshot(); data.sourceVerification.status = "unavailable"; data.sourceVerification.reasonCodes = ["context_source_evidence_unavailable"];
  assert.equal(outputNativeReadiness(data).reason, "source_unavailable");
  data.sourceVerification.status = "verified"; data.sourceVerification.reasonCodes = []; data.summary.scope_known = false;
  assert.equal(outputNativeReadiness(data).reason, "scope_unknown");
});

test("governance capacity is a distinct unavailable-source reason even when all revisions and file counts match", () => {
  const data = snapshot();
  data.sourceVerification.status = "unavailable";
  data.sourceVerification.reasonCodes = ["output_source_governance_capacity_exceeded"];
  data.sourceVerification.governance = { captureBatchLimit: 2, sources: [{ blockId: "doc-governed-block", label: "Authorized Document source" }], sourcesComplete: true };
  assert.equal(data.confirmedPlan.sourceDigest, data.sourceRevision);
  assert.equal(data.sourceVerification.capacity.distinctObjectCount, 0);
  assert.equal(outputSourceReadiness(data).reason, "source_unavailable");
  assert.deepEqual(outputSourceReadiness(data).reasonCodes, ["output_source_governance_capacity_exceeded"]);
  assert.equal(outputDeliveryReadiness(data).allowed, false); assert.equal(outputNativeReadiness(data).allowed, false);
  assert.equal(captureOutputRelease(data, "file"), null); assert.equal(captureOutputRelease(data, "package"), null);
  const failure = classifyOutputUploadFailure({ status: "conflict", body: { error: "output_source_governance_capacity_exceeded" } });
  assert.equal(failure.kind, "rejected"); assert.equal(outputUploadNeedsRestage(failure), false);
  assert.equal(outputUploadCanRestage(failure, "older-head", data, true), false);
});

test("optional governance display metadata never grants or revokes source authority", () => {
  const data = snapshot();
  for (const governance of [undefined, null, {}, { captureBatchLimit: 2, sources: [], sourcesComplete: true }, { captureBatchLimit: "2", sources: null }]) {
    data.sourceVerification.governance = governance;
    assert.equal(outputSourceReadiness(data).allowed, true);
    assert.equal(outputDeliveryReadiness(data).allowed, true);
    assert.equal(outputNativeReadiness(data).allowed, true);
  }
  data.sourceVerification.status = "unavailable"; data.sourceVerification.reasonCodes = ["output_source_governance_capacity_exceeded"];
  delete data.sourceVerification.governance;
  assert.equal(outputSourceGovernance(data), null);
  assert.equal(outputSourceReadiness(data).allowed, false, "missing disclosure cannot turn missing proof into approval");
  data.sourceVerification.governance = { captureBatchLimit: 2, sources: [], sourcesComplete: true };
  delete data.sourceVerification.status;
  assert.equal(outputSourceReadiness(data).reason, "source_unknown", "display metadata cannot stand in for required verification status");
});

test("governed-source labels are bounded, explicitly incomplete, and never echo private extra fields", () => {
  const data = snapshot();
  const rows = Array.from({ length: 37 }, (_, index) => ({ blockId: `authorized-block-${index}`, label: `Authorized source ${index}`, originPackageId: "DO_NOT_DISPLAY_PRIVATE_ORIGIN" }));
  rows[1].label = "x".repeat(121);
  data.sourceVerification.governance = { captureBatchLimit: 2, sources: rows, sourcesComplete: true, privateOriginUrl: "DO_NOT_DISPLAY_PRIVATE_URL" };
  const display = outputSourceGovernance(data);
  assert.equal(display.captureBatchLimit, 2); assert.equal(display.sources.length, 31);
  assert.equal(display.sourcesComplete, false);
  assert.ok(display.sources.every((source) => [...source.label].length <= 120));
  assert.ok(!JSON.stringify(display).includes("DO_NOT_DISPLAY"));
  assert.equal(outputNativeReadiness(data).allowed, true, "display truncation is not a new verification limit");
});

test("missing or malformed governance limits stay unknown rather than becoming zero or two", () => {
  const data = snapshot();
  for (const limit of [undefined, null, "2", -1, 1.5, Infinity]) {
    data.sourceVerification.governance = { captureBatchLimit: limit, sources: [], sourcesComplete: false };
    assert.equal(outputSourceGovernance(data).captureBatchLimit, null);
    assert.equal(outputNativeReadiness(data).allowed, true);
  }
  for (const governance of [undefined, null, [], "unknown"]) {
    data.sourceVerification.governance = governance;
    assert.equal(outputSourceGovernance(data), null);
  }
});

test("the disclosed database batch limit is not a package-count or nesting-depth client rule", () => {
  const data = snapshot();
  for (const sourceCount of [0, 1, 2, 37]) {
    data.sourceVerification.governance = { captureBatchLimit: 2, sources: Array.from({ length: sourceCount }, (_, index) => ({ blockId: `source-${index}`, label: `Document source ${index}` })), sourcesComplete: true };
    assert.equal(outputSourceReadiness(data).allowed, true);
    assert.equal(outputNativeReadiness(data).allowed, true);
  }
});

test("source display labels retain all 120 Unicode code points, independently of UTF-16 or byte length", () => {
  const data = snapshot(), label = "😀".repeat(120);
  assert.equal([...label].length, 120);
  assert.equal(label.length, 240);
  assert.equal(new TextEncoder().encode(label).byteLength, 480, "this display bound is not a private-evidence byte limit");
  const row = { blockId: "authorized-document-block", label, originPackageId: "DO_NOT_DISPLAY_PRIVATE_ORIGIN" };
  data.sourceVerification.governance = { captureBatchLimit: 2, sources: [row], sourcesComplete: true };
  data.sourceVerification.capacity.sources = [row];
  const before = structuredClone(data);
  for (const display of [outputSourceGovernance(data), outputSourceCapacity(data)]) {
    assert.deepEqual(display.sources, [{ blockId: row.blockId, label }]);
    assert.equal(display.sourcesComplete, true);
    assert.ok(!JSON.stringify(display).includes("DO_NOT_DISPLAY"));
  }
  assert.deepEqual(data, before, "reading labels must not normalize, truncate, or mutate authored metadata");
});

test("121 astral code points exceed the governance display bound without silently shortening the label", () => {
  const data = snapshot(), valid = "😀".repeat(120), oversized = "😀".repeat(121);
  data.sourceVerification.governance = { captureBatchLimit: 2, sources: [
    { blockId: "oversized-label", label: oversized }, { blockId: "valid-label", label: valid },
  ], sourcesComplete: true };
  const before = structuredClone(data);
  assert.deepEqual(outputSourceGovernance(data).sources, [{ blockId: "valid-label", label: valid }]);
  assert.equal(outputSourceGovernance(data).sourcesComplete, false);
  assert.deepEqual(data, before);
});

test("32 valid astral governance labels form a complete list and a 33rd row makes it incomplete", () => {
  const data = snapshot(), label = "😀".repeat(120);
  const rows = Array.from({ length: 32 }, (_, index) => ({ blockId: `authorized-block-${index}`, label }));
  data.sourceVerification.governance = { captureBatchLimit: 2, sources: rows, sourcesComplete: true };
  assert.deepEqual(outputSourceGovernance(data).sources, rows);
  assert.equal(outputSourceGovernance(data).sourcesComplete, true);
  data.sourceVerification.capacity.sources = rows;
  assert.deepEqual(outputSourceCapacity(data).sources, rows);
  assert.equal(outputSourceCapacity(data).sourcesComplete, true);
  data.sourceVerification.governance.sources = [...rows, { blockId: "authorized-block-32", label }];
  assert.deepEqual(outputSourceGovernance(data).sources, rows);
  assert.equal(outputSourceGovernance(data).sourcesComplete, false);
});

test("server-shortened astral labels and a bounded 32-row list retain the server's incomplete disclosure flag", () => {
  const data = snapshot();
  // Mirror outputSourceNames: shorten by code points before transmission, without splitting surrogate pairs.
  const label = [..."😀".repeat(121)].slice(0, 120).join("");
  const rows = Array.from({ length: 32 }, (_, index) => ({ blockId: `authorized-block-${index}`, label }));
  data.sourceVerification.governance = { captureBatchLimit: 2, sources: rows, sourcesComplete: false };
  data.sourceVerification.capacity = { ...capacity(), referenceCount: 37, distinctObjectCount: 1, nativeLimit: 1,
    sources: rows, sourcesComplete: false };
  for (const display of [outputSourceGovernance(data), outputSourceCapacity(data)]) {
    assert.deepEqual(display.sources, rows);
    assert.equal(display.sourcesComplete, false);
    assert.ok(display.sources.every((source) => source.label === "😀".repeat(120)));
  }
  assert.equal(outputSourceCapacity(data).referenceCount, 37, "display bounds do not reduce the observed reference inventory");
  assert.equal(outputNativeReadiness(data).allowed, true, "37 references to one verified stored object still fit the supplied one-object limit");
});

test("Unicode label acceptance and display completeness cannot change source, delivery, native, or release authority", () => {
  const rows = (count, length) => Array.from({ length: count }, (_, index) => ({ blockId: `authorized-block-${index}`, label: "😀".repeat(length) }));
  for (const condition of ["verified", "unavailable", "unknown", "unknown-inventory", "native-capacity"]) {
    const baseline = snapshot();
    if (condition === "unavailable") {
      baseline.sourceVerification.status = "unavailable";
      baseline.sourceVerification.reasonCodes = ["output_source_governance_capacity_exceeded"];
    } else if (condition === "unknown") delete baseline.sourceVerification.status;
    else if (condition === "unknown-inventory") baseline.sourceVerification.capacity.countsComplete = false;
    else if (condition === "native-capacity") baseline.sourceVerification.capacity.distinctObjectCount = 1;
    for (const sources of [rows(1, 120), rows(1, 121), rows(32, 120), rows(33, 120)]) {
      const data = structuredClone(baseline);
      data.sourceVerification.governance = { captureBatchLimit: 2, sources, sourcesComplete: true };
      data.sourceVerification.capacity.sources = sources.slice(0, 32);
      data.sourceVerification.capacity.sourcesComplete = sources.length <= 32;
      outputSourceGovernance(data); outputSourceCapacity(data);
      for (const gate of [outputSourceReadiness, outputDeliveryReadiness, outputNativeReadiness]) {
        assert.deepEqual(gate(data), gate(baseline), condition);
      }
      for (const kind of ["file", "package"]) assert.deepEqual(captureOutputRelease(data, kind), captureOutputRelease(baseline, kind), condition);
    }
  }
});
