import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DOCUMENT_ARTIFACT_KINDS } from "../../../src/model/document-artifacts.ts";
import { definitions, fixtureCatalog } from "./catalog.ts";
import { compileExperience, digest, jsonIssues, valueIssues } from "./compiler.ts";
import { CandidateRegistry, compareReleases, proposePatch } from "./patches.ts";
import { bindDraft, createDraft, ExperienceRuntime, FixtureTransport } from "./runtime.ts";

const clone = value => structuredClone(value);
const compile = async (id = "image", catalog = fixtureCatalog) => {
  const result = await compileExperience(definitions.find(item => item.id === id), catalog);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.release;
};
const fill = runtime => {
  for (const decision of runtime.release.definition.decisions) {
    const interaction = runtime.release.interactions[decision.id];
    if (interaction.kind === "source") runtime.change(decision.id, `Example ${decision.id}`);
    else if (interaction.kind === "relationship") runtime.change(decision.id, Object.fromEntries(interaction.fields.map(field => [field.id, `Example ${field.label}`])));
    else if (interaction.kind === "order") runtime.change(decision.id, [1, 2, 3].map(index => ({ id: `e${index}`, text: `Evidence ${index}` })));
  }
  return runtime;
};
const reorder = release => ({ schemaVersion: 1, baseReleaseHash: release.releaseHash, operations: [{ kind: "reorder-decisions", ids: release.definition.decisions.map(item => item.id).reverse() }] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

for (const definition of definitions) test(`${definition.id}: complete fixture preserves bound choices and has no canonical handoff`, async () => {
  const release = await compile(definition.id), runtime = fill(new ExperienceRuntime(release));
  const before = clone(runtime.state.draft);
  assert.equal(await runtime.prepare(), true);
  assert.equal(runtime.state.phase, "review");
  assert.equal(await runtime.submit(), true);
  assert.equal(runtime.state.phase, "complete");
  assert.deepEqual(runtime.state.draft, before);
  assert.equal(runtime.state.result.receipt.contextHash, await digest(runtime.state.result.context));
  assert.deepEqual(runtime.handoff(), { mode: "fixture", available: false });
  assert.equal(runtime.change(definition.decisions[0].id, "Changed"), false);
  assert.equal(await runtime.submit(), false);
  assert.equal(runtime.transport.calls, 1);
});

test("release hash is deterministic, order-sensitive and dependency-bound", async () => {
  const a = await compile();
  const reorderedKeys = Object.fromEntries(Object.entries(definitions[0]).reverse());
  const b = await compileExperience(reorderedKeys, fixtureCatalog);
  assert.equal(b.release.releaseHash, a.releaseHash);
  const changed = clone(fixtureCatalog);
  changed.interactions["lighting@1"].options[0].label = "Day light";
  assert.notEqual((await compile("image", changed)).releaseHash, a.releaseHash);
  const c = await proposePatch(a, reorder(a), fixtureCatalog);
  assert.equal(c.ok, true);
  assert.notEqual(c.candidate.releaseHash, a.releaseHash);
  assert.deepEqual(c.candidate.dependencies, a.dependencies);
  assert.equal(Object.isFrozen(a.definition.decisions), true);
});

test("compiler snapshots both definition and catalog before asynchronous hashing", async () => {
  const definition = clone(definitions[0]), catalog = clone(fixtureCatalog);
  const pending = compileExperience(definition, catalog);
  definition.layout = "arbitrary-code";
  definition.decisions[0].bindingSlot = "account.balance";
  catalog.interactions["composition@1"].renderer = "remote-script";
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.release.releaseHash, (await compile()).releaseHash);
});

const malformed = [
  ["arbitrary code", value => { value.script = "fetch('/api/document-jobs')"; }],
  ["unknown output", value => { value.outputContractRef = "unknown.single@1"; }],
  ["unknown interaction", value => { value.decisions[0].interactionRef = "remote@1"; }],
  ["binding path", value => { value.decisions[0].bindingSlot = "account.credits"; }],
  ["missing binding", value => { value.decisions.pop(); }],
  ["duplicate ID", value => { value.decisions[1].id = value.decisions[0].id; }],
  ["duplicate binding", value => { value.decisions[1].bindingSlot = value.decisions[0].bindingSlot; }],
  ["editable result", value => { value.viewerRef = "image.editor@1"; }],
  ["essential interaction removed", value => { value.essentialInteractionRef = "subject@1"; }],
  ["mobile floor removed", value => { value.mobileProfileRef = "desktop@1"; }],
  ["unapproved copy", value => { value.decisions[0].labelKey = "Make something amazing"; }],
  ["unsafe revision", value => { value.revision = Number.MAX_SAFE_INTEGER + 1; }],
  ["oversized string", value => { value.id = "x".repeat(20000); }],
  ["non-finite number", value => { value.revision = NaN; }],
  ["sparse decisions", value => { delete value.decisions[1]; }],
];
for (const [label, mutate] of malformed) test(`compiler rejects ${label}`, async () => {
  const definition = clone(definitions[0]); mutate(definition);
  const result = await compileExperience(definition, fixtureCatalog);
  assert.equal(result.ok, false);
  assert.ok(result.issues.length);
});

test("untrusted object traversal rejects accessors, cycles, symbols and prototype keys without invoking code", async () => {
  let called = false;
  const object = clone(definitions[0]);
  Object.defineProperty(object, "id", { enumerable: true, get() { called = true; return "image"; } });
  assert.equal((await compileExperience(object, fixtureCatalog)).ok, false);
  assert.equal(called, false);
  const cycle = {}; cycle.x = cycle;
  assert.ok(jsonIssues(cycle).length);
  assert.ok(jsonIssues({ [Symbol("hidden")]: "value" }).length);
  assert.ok(jsonIssues(JSON.parse('{"__proto__":{"polluted":true}}')).length);
  assert.equal({}.polluted, undefined);
});

test("incomplete and invalid local decisions cannot prepare a request", async () => {
  const runtime = new ExperienceRuntime(await compile());
  assert.equal(await runtime.prepare(), false);
  assert.equal(runtime.state.issues[0].code, "required");
  assert.equal(runtime.change("subject", "x".repeat(601)), false);
  assert.equal(runtime.change("composition", "outside"), false);
  assert.equal(runtime.change("unknown", "value"), false);
  assert.equal(runtime.transport.calls, 0);
});

test("default adoption is explicit and maintains stable binding identities", async () => {
  const runtime = fill(new ExperienceRuntime(await compile()));
  const before = bindDraft(runtime.release, runtime.state.draft);
  assert.equal(runtime.state.draft.values.lighting.provenance, "default");
  assert.equal(runtime.change("lighting", "daylight"), true);
  assert.equal(runtime.state.draft.values.lighting.provenance, "authored");
  const after = bindDraft(runtime.release, runtime.state.draft);
  assert.deepEqual(after.map(item => item.id), before.map(item => item.id));
  assert.notEqual(await digest(after), await digest(before));
});

test("typed patches reject stale bases, authority fields, unsupported operations and ID loss", async () => {
  const release = await compile();
  for (const patch of [
    { ...reorder(release), approved: true },
    { ...reorder(release), baseReleaseHash: "old" },
    { ...reorder(release), operations: [{ kind: "set-provider", endpoint: "https://invalid" }] },
    { ...reorder(release), operations: [{ kind: "reorder-decisions", ids: ["subject"] }] },
    { ...reorder(release), operations: [{ kind: "reorder-decisions", ids: ["subject", "subject", "lighting"] }] },
  ]) assert.equal((await proposePatch(release, patch, fixtureCatalog)).ok, false);
  const noOp = await proposePatch(release, { ...reorder(release), operations: [{ kind: "set-layout", layout: release.definition.layout }] }, fixtureCatalog);
  assert.equal(noOp.candidate, release);
  assert.equal(noOp.diff.risk, "none");
});

test("semantic diff is computed from actual dependencies; registry compare-and-swap prevents lost proposals", async () => {
  const release = await compile(), registry = new CandidateRegistry(release);
  const proposal = await proposePatch(release, reorder(release), fixtureCatalog);
  assert.equal(proposal.diff.risk, "presentation");
  assert.equal(registry.acceptPreview(release.releaseHash, proposal.candidate), true);
  assert.equal(registry.acceptPreview(release.releaseHash, release), false);
  const alteredCatalog = clone(fixtureCatalog);
  alteredCatalog.interactions["composition@1"].defaultValue = "left";
  const altered = await compile("image", alteredCatalog);
  assert.equal(compareReleases(release, altered).risk, "semantic");
  assert.equal(new CandidateRegistry(release).acceptPreview(release.releaseHash, altered), false);
});

test("explicit setup preview retains the pinned draft and rejects presentation replacement after review", async () => {
  const runtime = fill(new ExperienceRuntime(await compile()));
  const before = clone(runtime.state.draft);
  const proposal = await proposePatch(runtime.release, reorder(runtime.release), fixtureCatalog);
  assert.equal(runtime.previewPresentation(proposal.candidate), true);
  assert.deepEqual(runtime.state.draft, before);
  assert.equal(runtime.release.releaseHash, before.releaseHash);
  await runtime.prepare();
  assert.equal(runtime.previewPresentation(runtime.release), false);
  assert.equal(runtime.state.receipt.releaseHash, before.releaseHash);
});

test("unchanged availability preserves review; actual unavailability retains decisions and blocks new execution", async () => {
  const runtime = fill(new ExperienceRuntime(await compile()));
  await runtime.prepare();
  const receipt = runtime.state.receipt, draft = runtime.state.draft;
  runtime.availability(true);
  assert.equal(runtime.state.receipt, receipt);
  runtime.availability(false);
  assert.equal(runtime.state.phase, "blocked");
  assert.equal(runtime.state.draft, draft);
  assert.equal(await runtime.submit(), false);
  runtime.availability(true);
  assert.equal(runtime.state.phase, "setup");
});

test("editing during asynchronous preparation discards the stale receipt", async () => {
  const runtime = fill(new ExperienceRuntime(await compile()));
  const pending = runtime.prepare();
  runtime.change("subject", "Updated subject");
  assert.equal(await pending, false);
  assert.equal(runtime.state.phase, "setup");
  assert.equal(runtime.state.receipt, undefined);
});

test("double taps and two instances share one exact fixture intent", async () => {
  const release = await compile(), transport = new FixtureTransport();
  const first = fill(new ExperienceRuntime(release, transport));
  const second = new ExperienceRuntime(release, transport, first.state.draft);
  await Promise.all([first.prepare(), second.prepare()]);
  assert.equal(first.state.receipt.intentId, second.state.receipt.intentId);
  const results = await Promise.all([first.submit(), first.submit(), second.submit()]);
  assert.deepEqual(results, [true, false, true]);
  assert.equal(first.state.result.jobId, second.state.result.jobId);
  assert.equal(transport.calls, 1);
});

test("lost response is recovered by inspection without another submission or purchase", async () => {
  const runtime = fill(new ExperienceRuntime(await compile()));
  runtime.transport.loseNextResponse = true;
  await runtime.prepare();
  const receipt = runtime.state.receipt;
  assert.equal(await runtime.submit(), false);
  assert.equal(runtime.state.phase, "uncertain");
  assert.equal(await runtime.submit(), false);
  runtime.availability(false);
  assert.equal(await runtime.recover(), true);
  assert.equal(runtime.state.receipt, receipt);
  assert.equal(runtime.transport.calls, 1);
});

test("transport snapshots admission inputs before hashing", async () => {
  const runtime = fill(new ExperienceRuntime(await compile()));
  await runtime.prepare();
  const receipt = clone(runtime.state.receipt), context = clone(bindDraft(runtime.release, runtime.state.draft));
  const originalIntent = receipt.intentId;
  const pending = runtime.transport.start(receipt, "image", context);
  receipt.intentId = "changed";
  context[0].value = "changed";
  const result = await pending;
  assert.equal(result.receipt.intentId, originalIntent);
  assert.equal(result.receipt.contextHash, await digest(result.context));
  assert.notEqual(result.context[0].value, "changed");
});

test("same intent with altered output or source conflicts instead of producing a second job", async () => {
  const runtime = fill(new ExperienceRuntime(await compile()));
  await runtime.prepare(); await runtime.submit();
  await assert.rejects(runtime.transport.start(runtime.state.receipt, "video", runtime.state.result.context), /intent_conflict/);
  assert.equal(runtime.transport.calls, 1);
});

for (const corruption of ["context", "jobId"]) test(`mismatched ${corruption} cannot become a completed result`, async () => {
  class CorruptTransport extends FixtureTransport {
    async start(...args) { const result = clone(await super.start(...args)); if (corruption === "context") result.context[0].value = "Different source"; else result.jobId = "canonical-document"; return result; }
    async inspect(...args) { const result = clone(await super.inspect(...args)); result.jobId = "canonical-document"; return result; }
  }
  const runtime = fill(new ExperienceRuntime(await compile(), new CorruptTransport()));
  await runtime.prepare();
  assert.equal(await runtime.submit(), false);
  assert.equal(runtime.state.phase, "uncertain");
  assert.equal(await runtime.recover(), false);
  assert.notEqual(runtime.state.phase, "complete");
});

test("detached instance rejects late completion and active-session presentation changes", async () => {
  const pause = deferred();
  class DelayedTransport extends FixtureTransport { async start(...args) { await pause.promise; return super.start(...args); } }
  const runtime = fill(new ExperienceRuntime(await compile(), new DelayedTransport()));
  await runtime.prepare();
  const pending = runtime.submit();
  const proposal = await proposePatch(runtime.release, reorder(runtime.release), fixtureCatalog);
  assert.equal(runtime.previewPresentation(proposal.candidate), false);
  runtime.dispose(); pause.resolve();
  assert.equal(await pending, false);
  assert.notEqual(runtime.state.phase, "complete");
});

test("profiles, proportions and evidence order enforce their exact local bounds", async () => {
  assert.ok(valueIssues({ opening: 0, peak: 6, ending: 2 }, fixtureCatalog.interactions["energy@1"], "energy", false).length);
  assert.ok(valueIssues({ width: 1, height: 2, depth: 0 }, fixtureCatalog.interactions["proportions@1"], "proportions", false).length);
  assert.ok(valueIssues([{ id: "e1", text: "a" }, { id: "e1", text: "b" }, { id: "e3", text: "c" }], fixtureCatalog.interactions["evidence@1"], "evidence", true).length);
  const release = await compile();
  assert.throws(() => createDraft(release, "real-document"), /fixture_identity_required/);
});

test("validation retains group shape errors and reports every invalid stable leaf", () => {
  assert.deepEqual(valueIssues({ opening: -1, peak: 6, ending: 2 }, fixtureCatalog.interactions["energy@1"], "energy", true), [
    { code: "range_limit", path: "energy.opening" }, { code: "range_limit", path: "energy.peak" },
  ]);
  assert.deepEqual(valueIssues({ goal: "", obstacle: " ", decision: "Retained" }, fixtureCatalog.interactions["causality@1"], "causality", true), [
    { code: "required", path: "causality.goal" }, { code: "required", path: "causality.obstacle" },
  ]);
  assert.deepEqual(valueIssues([{ id: "e3", text: "" }, { id: "e1", text: "Retained" }, { id: "e2", text: "" }], fixtureCatalog.interactions["evidence@1"], "evidence", true), [
    { code: "required", path: "evidence.e3.text" }, { code: "required", path: "evidence.e2.text" },
  ]);
  assert.deepEqual(valueIssues({ goal: "Retained" }, fixtureCatalog.interactions["causality@1"], "causality", true), [{ code: "field_shape", path: "causality" }]);
  assert.deepEqual(valueIssues([{ id: "e1", text: "" }, { id: "e1", text: "" }, { id: "e3", text: "" }], fixtureCatalog.interactions["evidence@1"], "evidence", true), [{ code: "order_shape", path: "evidence" }]);
});

test("new canonical outputs require explicit fixture registration and renderer qualification", async () => {
  assert.deepEqual(Object.values(fixtureCatalog.outputs).map(item => item.output).sort(), ["image", ...DOCUMENT_ARTIFACT_KINDS].sort());
  for (const mutate of [
    catalog => { catalog.interactions["composition@1"].renderer = "unknown-stage@1"; },
    catalog => { catalog.interactions["composition@1"].defaultValue = "outside"; },
    catalog => { catalog.outputs["image.single@1"].viewerRef = "unknown.read-only@1"; },
    catalog => { catalog.outputs["image.single@1"].bindings[0].target = "video"; },
  ]) {
    const catalog = clone(fixtureCatalog); mutate(catalog);
    assert.equal((await compileExperience(definitions[0], catalog)).ok, false);
  }
});

test("fixture completion performs no network request and its static host denies connections", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("network_forbidden"); };
  try {
    const runtime = fill(new ExperienceRuntime(await compile()));
    runtime.transport.loseNextResponse = true;
    await runtime.prepare(); await runtime.submit(); await runtime.recover(); runtime.handoff();
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  const entry = await readFile(new URL("./entry.ts", import.meta.url), "utf8");
  assert.match(entry, /import "\.\/view\.ts"/);
});

test("proposal CLI returns a reviewed candidate and rejects model-provided publication authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forma-experience-proposal-test-"));
  const patchFile = join(directory, "patch.json");
  const release = await compile();
  const executable = new URL("./propose.mjs", import.meta.url);
  await writeFile(patchFile, JSON.stringify(reorder(release)));
  const run = spawnSync(process.execPath, ["--experimental-strip-types", executable.pathname, "image", patchFile], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const proposal = JSON.parse(run.stdout);
  assert.equal(proposal.published, false);
  assert.equal(proposal.diff.risk, "presentation");
  assert.equal(proposal.baseReleaseHash, release.releaseHash);
  await writeFile(patchFile, JSON.stringify({ ...reorder(release), approved: true }));
  const rejected = spawnSync(process.execPath, ["--experimental-strip-types", executable.pathname, "image", patchFile], { encoding: "utf8" });
  assert.equal(rejected.status, 1);
  assert.equal(JSON.parse(rejected.stdout).issues[0].code, "patch_shape");
});
