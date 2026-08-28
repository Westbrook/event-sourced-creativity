import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { normalizeOutputRequirementCreation } from "../src/model/output-requirement-creation.ts";
import { normalizeOutputRequirementCreation as workerNormalize } from "../worker/output-requirement-event-guards.ts";
import { isOutputContextType, parseOutputRequirement } from "../src/model/output-requirements.ts";
import { writeFixture, eventPost, sceneDeferred } from "./helpers/event-source-retirement-fixture.mjs";

const legacySource = "export function normalizeOutputRequirementCreation(payload: Record<string, unknown>): Record<string, unknown> {\n  if (!isOutputContextType(payload.type)) return payload;\n  const properties = record(payload.properties) ? { ...payload.properties } : {};\n  for (const key of influenceProperties) delete properties[key];\n  if (!Object.hasOwn(properties, \"output_spec\")) {\n    const parsed = parseOutputRequirement({\n      id: String(payload.block_id ?? \"\"), type: \"output\", content: typeof properties.text === \"string\" ? properties.text : \"\",\n      subtype: typeof properties.subtype === \"string\" ? properties.subtype : \"Custom deliverables\",\n    });\n    if (parsed.spec) properties.output_spec = parsed.spec;\n  }\n  // Do not normalize an unsupported schema into schema 1 or fabricate confirmation/approval.\n  return { ...payload, type: \"output\", properties };\n}";
const legacy = new Function("isOutputContextType", "parseOutputRequirement", "record", "influenceProperties",
  ts.transpileModule(legacySource.replace(/^export /u, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
    + "\nreturn normalizeOutputRequirementCreation;"
)(isOutputContextType, parseOutputRequirement, value => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  new Set(["weight", "influence", "intent", "effect"]));

test("one shared Output creation normalizer preserves the exact prior Worker function body and export", () => {
  const source = fs.readFileSync(new URL("../src/model/output-requirement-creation.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("creation.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "normalizeOutputRequirementCreation");
  assert.equal(declaration.getText(tree), legacySource);
  assert.equal(workerNormalize, normalizeOutputRequirementCreation);
});

test("Output creation preserves old malformed-properties, aliases, parsed and opaque-schema behavior", () => {
  const properties = [undefined, null, false, 7, "malformed", [], ["not", "a", "record"], {},
    { text: "One image", weight: 1, influence: 0.5, intent: "require", effect: "avoid", custom: "retain" },
    { text: 7, subtype: false, output_spec: null },
    { text: "opaque", weight: 1, output_spec: { schema_version: 999, retained: { exact: "opaque intent" } } },
    { text: "malformed schema", output_spec: ["opaque-array"], output_status: "untrusted unchanged here" }];
  for (const type of ["output", "OUTPUT", " Output ", "direction", "output-like"]) for (const value of properties) {
    const payload = { block_id: "identity", type, document_id: "document", properties: value, extra: { retain: true } };
    const before = structuredClone(payload), expected = legacy(payload), actual = normalizeOutputRequirementCreation(payload);
    assert.deepEqual(actual, expected, JSON.stringify({ type, value }));
    assert.deepEqual(payload, before, "normalization never edits the request being matched");
    if (!isOutputContextType(type)) assert.equal(actual, payload, "non-Output input remains identity-exact");
  }
  for (const malformed of [null, undefined]) {
    assert.throws(() => legacy(malformed), TypeError);
    assert.throws(() => normalizeOutputRequirementCreation(malformed), TypeError);
  }
});

test("Output normalization never upgrades an opaque contract or invents approval", () => {
  const opaque = { schema_version: 999, id: "opaque", private_future: { kept: true } };
  const value = normalizeOutputRequirementCreation({ type: "OUTPUT", block_id: "opaque", properties: {
    output_spec: opaque, weight: 1, influence: 1, intent: "require", effect: "include", text: "Exact original prose",
  } });
  assert.equal(value.type, "output"); assert.equal(value.properties.output_spec, opaque);
  assert.deepEqual(Object.keys(value.properties).sort(), ["output_spec", "text"]);
});

const output = (h, id, type = "output", properties = { text: "One image", weight: 1 }, client = false) => ({
  type: "BlockCreated", payload: { project_id: h.worker.projectId, document_id: h.worker.documentId,
    block_id: id, type, handle: "output/" + id, position: "z" + id, properties,
    ...(client ? { client_event_id: id + "-original-client" } : {}) },
});
for (const shared of [false, true]) test("actual " + (shared ? "shared" : "personal") + " Store receives all normalized Output commits under native SQL limits", async t => {
  const h = await writeFixture(t, { shared }), inputs = [
    output(h, "weight", "output", { text: "One image", weight: 1 }),
    output(h, "influence", "output", { text: "One image", influence: 0.7 }),
    output(h, "intent", "output", { text: "One image", intent: "require" }),
    output(h, "effect", "output", { text: "One image", effect: "include" }),
    output(h, "uppercase", "OUTPUT", { text: "One image", weight: 1, influence: 1, intent: "require", effect: "include" }),
    output(h, "whitespace", " Output ", null),
    output(h, "opaque", "output", { text: "Keep the opaque version", weight: 1, output_spec: { schema_version: 999, retained: "exact original" } }),
  ];
  let calls = 0;
  h.transport = async request => { if (eventPost(request)) calls++; return h.worker.request(request.url, request.init); };
  for (const input of inputs) {
    const before = structuredClone(input), result = await h.store.appendWithReceipt(input);
    assert.equal(result.publication, "published", JSON.stringify(result));
    assert.equal(result.acknowledgment.outcome, "observed");
    assert.equal(result.appended.length, 1);
    const event = result.appended[0];
    assert.deepEqual(event.payload, normalizeOutputRequirementCreation(input.payload));
    assert.equal(result.acknowledgment.committed[0].eventId, event.eventId);
    assert.deepEqual(result.acknowledgment.rejectedIndices, []);
    assert.equal(h.store.head.get(), event.sequence);
    assert.equal(h.worker.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE event_id=? AND type='BlockCreated'").get(event.eventId).n, 1);
    assert.deepEqual(input, before); assert.deepEqual(h.store.eventWriteAcknowledgments(result.acknowledgment.owner), []);
  }
  assert.equal(calls, inputs.length);
});

const mutations = [
  ["non-Output dropped weight", input => { input.payload.type = "direction"; }, event => { delete event.payload.properties.weight; }],
  ["wrong block identity", () => {}, event => { event.payload.block_id = "different-block"; }],
  ["wrong block type", () => {}, event => { event.payload.type = "direction"; }],
  ["changed authored prose", () => {}, event => { event.payload.properties.text = "Different prose"; }],
  ["wrong event type", () => {}, event => { event.type = "BlockRemoved"; }],
  ["wrong compensation identity", () => {}, event => { event.compensatesEventId = "different-original"; }],
  ["wrong actor", () => {}, event => { event.actor = "user:different"; }],
  ["wrong stream", () => {}, event => { event.streamId = "different-stream"; }],
  ["malformed schema metadata", () => {}, event => { event.schemaVersion = "1"; }],
  ["missing timestamp", () => {}, event => { delete event.occurredAt; }],
  ["missing recorded timestamp", () => {}, event => { delete event.recordedAt; }],
  ["missing client metadata", () => {}, event => { delete event.clientId; }],
  ["wrong original client event ID", () => {}, event => { event.payload.client_event_id = "different-client"; }],
  ["missing expected canonical Output contract", () => {}, event => { delete event.payload.properties.output_spec; }],
];
for (const [name, prepare, mutate] of mutations) test("normalized acknowledgment still rejects " + name, async t => {
  const h = await writeFixture(t, { shared: false }), input = output(h, "negative", "output", { text: "One image", weight: 1 }, true);
  prepare(input);
  const beforeEvents = h.store.events.get().length, beforeHead = h.store.head.get();
  let canonical, calls = 0;
  h.intercept = async request => {
    if (!eventPost(request)) return;
    calls++; const response = await h.worker.request(request.url, request.init);
    assert.equal(response.status, 200);
    canonical = await response.json(); assert.equal(canonical.appended.length, 1);
    const changed = structuredClone(canonical); mutate(changed.appended[0]);
    // An explicitly altered response is a negative transport fixture, never a server certificate.
    return Response.json(changed, { status: response.status, headers: response.headers });
  };
  const result = await h.store.appendWithReceipt(input);
  assert.equal(result.publication, "none"); assert.equal(result.acknowledgment.outcome, "unconfirmed");
  assert.deepEqual(result.appended, []); assert.equal(calls, 1);
  assert.equal(h.store.events.get().length, beforeEvents); assert.equal(h.store.head.get(), beforeHead);
  assert.equal(h.worker.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE event_id=?").get(canonical.appended[0].eventId).n, 1);
  if (name === "non-Output dropped weight") assert.equal(canonical.appended[0].payload.properties.weight, 1);
});

test("normalized Output cannot turn a lost response into a confirmed commit or another dispatch", async t => {
  const h = await writeFixture(t), input = output(h, "lost-normalized", "output", { text: "One image", weight: 1 }, true);
  let calls = 0;
  h.intercept = async request => {
    if (!eventPost(request)) return;
    calls++; assert.equal((await h.worker.request(request.url, request.init)).status, 200);
    throw new Error("Synthetic lost original normalized response");
  };
  const first = await h.store.appendWithReceipt(input), second = await h.store.appendWithReceipt(input);
  assert.equal(first.acknowledgment.outcome, "unconfirmed"); assert.deepEqual(first.acknowledgment.committed, []);
  assert.equal(second.acknowledgment.observationId, first.acknowledgment.observationId);
  assert.equal(second.acknowledgment.outcome, "unconfirmed"); assert.equal(calls, 1);
});

test("a normalized committed Output receipt withholds private bytes after actual current-source denial", async t => {
  const h = await writeFixture(t), entered = sceneDeferred(), gate = sceneDeferred();
  t.after(() => gate.resolve());
  let canonical, calls = 0;
  h.intercept = async request => {
    if (!eventPost(request)) return;
    calls++; const response = await h.worker.request(request.url, request.init);
    assert.equal(response.status, 200); canonical = await response.clone().json();
    entered.resolve(); await gate.promise; return response;
  };
  const pending = h.store.appendWithReceipt(output(h, "withdrawn-normalized"));
  await entered.promise; await h.deny(); gate.resolve();
  const result = await pending;
  assert.equal(result.publication, "withheld"); assert.deepEqual(result.appended, []);
  assert.equal(result.acknowledgment.outcome, "observed"); assert.equal(result.acknowledgment.privateUnavailable, true);
  assert.deepEqual(result.acknowledgment.committed.map(event => event.eventId), canonical.appended.map(event => event.eventId));
  assert.equal(h.retired(), true); assert.equal(calls, 1);
});

test("normalized mixed batches retain original rejected indices and exact successful subset", async t => {
  const h = await writeFixture(t, { shared: false }), result = await h.store.appendBatchWithReceipt([
    output(h, "valid-normalized"), { type: "ProviderBillableUsage", payload: { private: "invalid caller event" } },
  ]);
  assert.equal(result.publication, "published"); assert.equal(result.acknowledgment.outcome, "observed");
  assert.deepEqual(result.acknowledgment.rejectedIndices, [1]);
  assert.equal(result.appended.filter(event => event.type === "BlockCreated").length, 1);
  assert.equal(result.acknowledgment.committed.length, 1);
});

test("shared unsupported-event denial still rejects the entire normalized batch", async t => {
  const h = await writeFixture(t, { shared: true });
  let status, calls = 0;
  h.intercept = async request => {
    if (!eventPost(request)) return;
    calls++; const response = await h.worker.request(request.url, request.init);
    status = response.status; return response;
  };
  const result = await h.store.appendBatchWithReceipt([
    output(h, "shared-denied-normalized"), { type: "ProviderBillableUsage", payload: { private: "invalid caller event" } },
  ]);
  assert.equal(status, 403); assert.equal(calls, 1);
  assert.equal(result.publication, "withheld"); assert.deepEqual(result.appended, []);
  assert.deepEqual(result.acknowledgment.committed, []); assert.equal(h.retired(), true);
  assert.equal(h.worker.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='BlockCreated' AND payload LIKE ?").get("%shared-denied-normalized%").n, 0);
});
