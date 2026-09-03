import assert from "node:assert/strict";
import test from "node:test";
import { syntheticEvidence, syntheticNetworkProvenance } from "./browser/helpers/synthetic-network.mjs";

// Destination: tests/synthetic-evidence-custody.test.mjs. Pure evidence-format
// behavior only: no browser, Store, network installation, API or provider call.
const rawSource = "  Preserve café, العربية and 日本語.\nKeep the original spaces.  ";
const retainedAuthority = "Actual personal account without a shared-project context";

test("synthetic transport preserves an existing E6 custody fixture by identity and bytes", () => {
  const source = Object.freeze({ id: "original-source", raw: rawSource, authority: retainedAuthority });
  const events = Object.freeze([Object.freeze({ type: "BlockCreated", payload: source })]);
  const fixture = Object.freeze({
    schema: "forma-isolated-e6-r1",
    owner: Object.freeze({ tag: "forma-workspace", connected: true }),
    custody: Object.freeze({ events, optimisticEvents: Object.freeze([]), head: 1, jobs: Object.freeze([]) }),
    reads: Object.freeze([Object.freeze({ path: "/api/output-requirements", status: 503 })]),
    forbidden: Object.freeze([]),
    limits: Object.freeze(["Existing fixture limits remain original evidence."]),
  });
  const value = Object.freeze({ fixture, source, errors: Object.freeze([]) });
  const before = JSON.stringify(value);
  const result = syntheticEvidence("e6-synthetic-boundary", value);

  assert.notStrictEqual(result, value);
  assert.strictEqual(result.fixture, fixture);
  assert.strictEqual(result.fixture.custody.events, events);
  assert.strictEqual(result.fixture.custody.events[0].payload, source);
  assert.strictEqual(result.source, source);
  assert.equal(JSON.stringify(result.fixture), JSON.stringify(fixture));
  assert.equal(JSON.stringify(value), before);
  const { syntheticTransport, ...originalEvidence } = result;
  assert.strictEqual(syntheticTransport, syntheticNetworkProvenance);
  assert.equal(JSON.stringify(originalEvidence), before);
  assert.equal(result.source.raw, rawSource);
  assert.equal(result.source.authority, retainedAuthority);
});

test("existing own fixture values are retained even when null, false, empty or undefined", () => {
  for (const fixture of [null, false, "", undefined]) {
    const value = Object.freeze({ fixture, rawSource });
    const result = syntheticEvidence("fixture-boundary", value);
    assert.equal(Object.hasOwn(result, "fixture"), true);
    assert.strictEqual(result.fixture, fixture);
    assert.strictEqual(result.syntheticTransport, syntheticNetworkProvenance);
    assert.equal(result.rawSource, rawSource);
    assert.deepEqual(value, { fixture, rawSource });
  }
});

test("ordinary non-colliding receipts keep their existing fixture provenance shape", () => {
  const nested = Object.freeze({ authority: retainedAuthority, rawSource });
  const value = Object.freeze({ reads: 2, nested, forbidden: Object.freeze([]) });
  const result = syntheticEvidence("read-only-network", value);
  assert.strictEqual(result.fixture, syntheticNetworkProvenance);
  assert.equal(Object.hasOwn(result, "syntheticTransport"), false);
  assert.strictEqual(result.nested, nested);
  assert.strictEqual(result.forbidden, value.forbidden);
  assert.equal(Object.hasOwn(value, "fixture"), false);
  assert.equal(result.reads, 2);
});

test("named top-level authority relabeling preserves an existing fixture and nested wording", () => {
  const nested = Object.freeze({ authority: retainedAuthority, rawSource });
  const fixture = Object.freeze({ nested, limits: "Original nested custody limit." });
  const value = Object.freeze({ authority: retainedAuthority, limits: "Original outer limit.", fixture, nested });
  const before = JSON.stringify(value);
  const result = syntheticEvidence("view-native-coverage", value);
  assert.equal(result.authority, "Synthetic personal-author declaration without shared-project context; no authentication proof");
  assert.match(result.limits, /One synthetic Document/);
  assert.strictEqual(result.fixture, fixture);
  assert.strictEqual(result.nested, nested);
  assert.equal(result.fixture.nested.authority, retainedAuthority);
  assert.equal(result.fixture.nested.rawSource, rawSource);
  assert.strictEqual(result.syntheticTransport, syntheticNetworkProvenance);
  assert.equal(JSON.stringify(value), before);
});

test("unrecognized receipts never relabel matching authored strings", () => {
  const value = Object.freeze({ authority: retainedAuthority, landing: rawSource, premise: rawSource, limits: rawSource });
  const result = syntheticEvidence("authored-source-custody", value);
  const { fixture, ...retained } = result;
  assert.deepEqual(retained, value);
  assert.strictEqual(fixture, syntheticNetworkProvenance);
});

test("array and primitive observations remain original values under a provenance wrapper", () => {
  const articles = Object.freeze([Object.freeze({ id: "source-1", rawSource })]);
  for (const value of [articles, rawSource, null, undefined, false, 0]) {
    const result = syntheticEvidence("saved-context-before", value);
    assert.strictEqual(result.observation, value);
    assert.strictEqual(result.fixture, syntheticNetworkProvenance);
  }
});

test("a second occupied provenance slot fails without overwriting either original payload", () => {
  const fixture = Object.freeze({ custody: rawSource });
  const transport = Object.freeze({ original: "Already retained evidence." });
  const value = Object.freeze({ fixture, syntheticTransport: transport });
  const before = JSON.stringify(value);
  assert.throws(() => syntheticEvidence("e6-synthetic-boundary", value),
    /already owns reserved provenance key: syntheticTransport/);
  assert.strictEqual(value.fixture, fixture);
  assert.strictEqual(value.syntheticTransport, transport);
  assert.equal(JSON.stringify(value), before);
});
