import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createActivityInspectionCache, sameActivityInspectionJob } from "../src/model/activity-inspection-cache.ts";
import { failedGenerationInputInspection } from "../src/model/generation-inputs.ts";
import { createGenerationAccountingReader, generationAccountingTarget } from "../src/model/generation-accounting-inspection.ts";
import { accountingResponse, deferred } from "./helpers/generation-accounting-fixture.mjs";
import { failedJob } from "./helpers/activity-receipt-focus-data.mjs";

// Inert deterministic model/reader controls, not a browser or real Store/auth run.
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("No network in Activity lifetime controls"); };
after(() => { globalThis.fetch = originalFetch; assert.equal(networkAttempts, 0); });
const clone = value => JSON.parse(JSON.stringify(value));

function harness({ cached = true } = {}) {
  const cache = createActivityInspectionCache();
  const reader = createGenerationAccountingReader();
  const detail = failedJob();
  detail.moderationPromptRef = "private-prompt";
  let currentJob = detail, content = { "private-prompt": "Synthetic original private prompt" }, events = [];
  let inspection = null, owner = null;
  let scopeKey = "owner:epoch-1", route = "/library", connected = true, dialogOpen = true, open = true, openingCurrent = true;
  let admission = { role: "admin", shared: false, impersonating: false };
  const target = () => generationAccountingTarget(inspection, admission);
  // Matches the unchanged child owner's checks; no custom component or authorization claim.
  const current = () => {
    try {
      const next = target();
      return connected && open && dialogOpen && inspection === owner?.inspection
        && owner !== null && scopeKey === owner.scopeKey && route === owner.route && openingCurrent
        && next !== null && next.jobId === owner.target.jobId && next.documentId === owner.target.documentId
        && next.attemptCount === owner.target.attemptCount && next.status === owner.target.status;
    } catch { return false; }
  };
  const render = () => {
    if (!sameActivityInspectionJob(currentJob, detail)) {
      cache.clear(); inspection = null;
    } else {
      const next = failedGenerationInputInspection(detail, events, content);
      inspection = cached ? cache.select(next) : next;
    }
    // Actual child performs this check in willUpdate and Store subscription.
    if (owner && !current()) { reader.cancel(); owner = null; }
  };
  render();
  const requests = [], gates = [];
  let notifications = 0;
  const start = () => {
    const selected = target(); assert.ok(selected);
    owner = { inspection, scopeKey, route, target: selected };
    const gate = deferred(); gates.push(gate);
    return reader.read(selected, {
      current,
      changed: () => { notifications++; },
      fetch: async (url, init, stillCurrent) => {
        assert.equal(stillCurrent(), true); assert.equal(init.method, "GET");
        assert.equal(url, "/api/admin/generation-accounting?jobId=job-1");
        requests.push({ url, signal: init.signal }); return gate.promise;
      },
    });
  };
  return {
    cache, reader, detail, requests, gates, start, render,
    inspection: () => inspection, notifications: () => notifications,
    unrelatedNotify: () => render(),
    equivalentInputCopies: () => { currentJob = clone(currentJob); content = clone(content); events = clone(events); render(); },
    changePrompt: () => { content = { ...content, "private-prompt": "Synthetic changed private prompt" }; render(); },
    mutatePromptSource: () => { content["private-prompt"] = "Synthetic in-place changed prompt"; render(); },
    changeJob: (key, value) => { currentJob = { ...currentJob, [key]: value }; render(); },
    setGuard: (key, value) => {
      if (key === "scope") scopeKey = value;
      else if (key === "route") route = value;
      else if (key === "connected") connected = value;
      else if (key === "dialogOpen") dialogOpen = value;
      else if (key === "open") open = value;
      else if (key === "openingCurrent") openingCurrent = value;
      else admission = { ...admission, [key]: value };
      render();
    },
    closeAndReopen: () => { reader.cancel(); owner = null; cache.clear(); inspection = null; render(); },
  };
}

test("actual inspection factory returns different objects for identical receipt content", () => {
  const job = failedJob();
  const one = failedGenerationInputInspection(job, [], {});
  const two = failedGenerationInputInspection(job, [], {});
  assert.notEqual(one, two); assert.deepEqual(one, two);
  const cache = createActivityInspectionCache();
  assert.equal(cache.select(one), one); assert.equal(cache.select(two), one);
});

test("uncached parent rerender deterministically reproduces loading → idle with no result", async () => {
  const h = harness({ cached: false }), pending = h.start(), before = h.inspection();
  assert.equal(h.reader.state().status, "loading"); assert.equal(h.requests.length, 1);
  h.unrelatedNotify();
  assert.notEqual(h.inspection(), before); assert.deepEqual(h.inspection(), before);
  assert.equal(h.reader.state().status, "idle"); assert.equal(h.requests[0].signal.aborted, true);
  h.gates[0].resolve(Response.json(accountingResponse())); await pending;
  assert.equal(h.reader.state().status, "idle"); assert.equal(h.reader.state().preview, null);
  assert.equal(h.requests.length, 1);
});

test("same caller receipt survives unrelated notify and equal replacement inputs during pending and ready", async () => {
  const h = harness(), original = h.inspection(), pending = h.start();
  h.unrelatedNotify(); h.equivalentInputCopies(); h.unrelatedNotify();
  assert.equal(h.inspection(), original);
  assert.equal(h.reader.state().status, "loading"); assert.equal(h.requests[0].signal.aborted, false);
  h.gates[0].resolve(Response.json(accountingResponse())); await pending;
  assert.equal(h.reader.state().status, "ready");
  const ready = h.reader.state().preview;
  h.equivalentInputCopies(); h.unrelatedNotify();
  assert.equal(h.inspection(), original); assert.equal(h.reader.state().preview, ready);
  assert.equal(h.requests.length, 1); assert.equal(h.notifications(), 2);
});

for (const change of ["changePrompt", "mutatePromptSource"]) test(`real receipt change via ${change} cancels pending read and discards its late body`, async () => {
  const h = harness(), original = h.inspection(), pending = h.start();
  h[change]();
  assert.notEqual(h.inspection(), original); assert.equal(h.reader.state().status, "idle");
  assert.equal(h.requests[0].signal.aborted, true);
  h.gates[0].resolve(Response.json(accountingResponse())); await pending;
  assert.equal(h.reader.state().preview, null); assert.equal(h.requests.length, 1);
});

test("changed visible receipt retires already-ready accounting instead of preserving a stale snapshot", async () => {
  const h = harness(), pending = h.start();
  h.gates[0].resolve(Response.json(accountingResponse())); await pending;
  assert.equal(h.reader.state().status, "ready");
  h.changePrompt(); assert.equal(h.reader.state().status, "idle"); assert.equal(h.reader.state().preview, null);
});

for (const [key, value] of [
  ["jobId", "other-job"], ["documentId", "other-document"], ["attemptCount", 2],
  ["status", "canceled"], ["kind", "preview"], ["productionMode", "manual"],
]) test(`parent's actual ${key} replacement clears the active inspection even before response`, async () => {
  const h = harness(), pending = h.start();
  h.changeJob(key, value);
  assert.equal(h.inspection(), null); assert.equal(h.reader.state().status, "idle");
  assert.equal(h.requests[0].signal.aborted, true);
  h.gates[0].resolve(Response.json(accountingResponse())); await pending;
  assert.equal(h.reader.state().preview, null);
});

for (const [key, value] of [
  ["scope", "owner:epoch-2"], ["route", "/projects"], ["connected", false],
  ["dialogOpen", false], ["open", false], ["openingCurrent", false],
  ["role", "viewer"], ["shared", true], ["impersonating", true],
]) test(`unchanged child ${key} guard still cancels semantically identical inspection`, async () => {
  const h = harness(), pending = h.start(), original = h.inspection();
  h.setGuard(key, value);
  assert.equal(h.inspection(), original); // Cache cannot confer authority/lifetime.
  assert.equal(h.reader.state().status, "idle"); assert.equal(h.requests[0].signal.aborted, true);
  h.gates[0].resolve(Response.json(accountingResponse())); await pending;
  assert.equal(h.reader.state().preview, null);
});

test("real close/new opening does not reuse prior object; old result cannot replace the new owner's result", async () => {
  const h = harness(), original = h.inspection(), old = h.start();
  h.closeAndReopen(); assert.notEqual(h.inspection(), original);
  const newer = h.start(), response = accountingResponse(); response.preview.snapshotSha256 = "e".repeat(64);
  h.gates[1].resolve(Response.json(response)); await newer;
  h.gates[0].resolve(Response.json(accountingResponse())); await old;
  assert.equal(h.reader.state().status, "ready"); assert.equal(h.reader.state().preview.snapshotSha256, "e".repeat(64));
  assert.equal(h.requests.length, 2); assert.equal(h.requests[0].signal.aborted, true);
});

for (const code of [403, 409, 503]) test(`stable owner with HTTP${code} retains unavailable feedback, not silent idle`, async () => {
  const h = harness(), pending = h.start(); h.unrelatedNotify();
  h.gates[0].resolve(Response.json({ error: "Synthetic refusal" }, { status: code })); await pending;
  assert.equal(h.reader.state().status, "unavailable"); assert.equal(h.reader.state().preview, null);
  assert.equal(h.requests.length, 1);
});

test("null/explicit retirement clears cache; unsupported serialization never reuses a prior candidate", () => {
  const cache = createActivityInspectionCache(), one = failedGenerationInputInspection(failedJob(), [], {});
  assert.equal(cache.select(one), one); assert.equal(cache.select(null), null);
  const two = clone(one); assert.equal(cache.select(two), two); cache.clear();
  const three = clone(one); assert.equal(cache.select(three), three);
  const bad = clone(one); bad.receipt.cyclic = bad;
  assert.equal(cache.select(bad), bad);
  const four = clone(one); assert.equal(cache.select(four), four);
  const none = { ...one, toJSON: () => undefined }; assert.equal(cache.select(none), none);
  const five = clone(one); assert.equal(cache.select(five), five);
  assert.equal(sameActivityInspectionJob(null, failedJob()), false);
});

test("different caller instances never share inspections or retain cleared former lifetimes", () => {
  const one = createActivityInspectionCache(), two = createActivityInspectionCache();
  const a = failedGenerationInputInspection(failedJob(), [], {}), b = clone(a);
  assert.equal(one.select(a), a); assert.equal(two.select(b), b); assert.notEqual(one.select(clone(a)), two.select(clone(b)));
  one.clear(); const next = clone(a); assert.equal(one.select(next), next); assert.equal(two.select(clone(b)), b);
});

test("actual caller wires creation, selection and real retirement; child strict identity/authorization guards remain", async () => {
  const parent = await readFile(new URL("../src/components/forma-activity-issue-panel.ts", import.meta.url), "utf8");
  const child = await readFile(new URL("../src/components/generation-input-dialog.ts", import.meta.url), "utf8");
  assert.match(parent, /#inspectionCache = createActivityInspectionCache\(\)/u);
  assert.match(parent, /const failedInput = this\.#inspectionCache\.select\(this\.#inspectionJob/u);
  assert.match(parent, /#clearInspection\(\)\s*\{\s*this\.#inspectionJob = null;\s*this\.#actorContent = \{\};\s*this\.#inspectionCache\.clear\(\);/u);
  assert.match(parent, /willUpdate\(\)[\s\S]{0,220}sameActivityInspectionJob\(this\.job, this\.#inspectionJob\)[\s\S]{0,50}this\.#clearInspection\(\)/u);
  assert.match(parent, /#clearPrivateState = \(\) => \{\s*this\.#releaseCorrectionOwner\(\);\s*this\.#clearInspection\(\)/u);
  assert.match(parent, /#busy = "receipt";\s*this\.#clearInspection\(\)/u);
  assert.match(parent, /@generation-input-close=\$\{\(\) => \{ this\.#clearInspection\(\); this\.requestUpdate\(\); \}\}/u);
  assert.match(parent, /disconnectedCallback\(\)[\s\S]{0,400}this\.#clearPrivateState\(\)/u);
  assert.match(parent, /addEventListener\("forma-authorization-changed", this\.#clearPrivateState\)/u);
  assert.match(child, /this\.inspection===owner\.inspection/u);
  assert.match(child, /this\.#accountingOwner===owner&&this\.store\.captureAuthorizationScope\(\)\?\.key===owner\.scopeKey&&this\.store\.route\.get\(\)===owner\.route/u);
  assert.match(child, /\(!this\.openingCurrent\|\|this\.openingCurrent\(\)\)&&target!==null/u);
});
