import assert from "node:assert/strict";
import test from "node:test";
import { ExperienceHostOperation } from "../src/experiences/host-operation.ts";
import { experienceHostTimeout, experienceResponseTimeout } from "../src/experiences/output-transport-lifetime.ts";
import {
  decodeExperienceBinding,
  experienceResultGrantCurrent,
  ExperienceOutputBindingClient,
  unavailableBinding,
  type ExperienceBindingIdentity,
} from "../src/experiences/output-binding-client.ts";
import type { ExperienceNativeState } from "../src/experiences/output-binding-contract.ts";

// Synthetic transport evidence only. No Store, browser, provider or database is loaded.
const origin = "https://forma.test";
const identity: ExperienceBindingIdentity = {
  draftId: "experience-draft-" + "a".repeat(64), draftHash: "b".repeat(64), releaseHash: "c".repeat(64),
  documentId: "document-original", projectId: "project-original", output: "image", actorUserId: "user-original",
};
const basePath = `/api/experiences/drafts/${identity.draftId}/output`;
const denied = () => ({ prepare: false, authorize: false, run: false, resumeRun: false });
// Known containers in the original fixture; individual fields deliberately
// accept invalid values for decoder rejection controls.
type MutableRecord = Record<PropertyKey, unknown> & {
  current: Record<string, unknown>; plan: Record<string, unknown>;
  original: Record<string, unknown>; permitted: Record<string, unknown>;
  preflight: Record<string, unknown> & { targets: Record<string, unknown>[] };
  grant: Record<string, unknown> & { operations: Record<string, unknown>[]; disclosure: Record<string, unknown> };
};

function state(status: ExperienceNativeState["status"] = "absent", output: "image" | "slides" = "image"): ExperienceNativeState {
  const value: ExperienceNativeState = {
    version: 1, ...identity, output, sourceSurface: "outputs", status, disposition: "never_admitted", stage: null,
    current: { custody: "verified", source: "verified", sourceDigest: "source-original", requirementsDigest: "requirements-original" },
    plan: null, preflight: null, grant: null, original: null, permitted: denied(),
  };
  if (status === "absent" || status === "preparing") {
    value.permitted.prepare = true;
    value.stage = status === "preparing" ? "save" : null;
    return value;
  }
  value.plan = { revisionId: "plan-original", targetId: "target-original", targetContractDigest: "contract-original",
    sourceDigest: value.current.sourceDigest, requirementsDigest: value.current.requirementsDigest };
  value.preflight = {
    id: "preflight-original", planRevisionId: value.plan.revisionId, termsDigest: "terms-original",
    sourceDigest: value.plan.sourceDigest, requirementsDigest: value.plan.requirementsDigest,
    maximumMicrousd: 42000, maximumCalls: 1, createdAt: "2026-09-12T12:00:00.000Z", expiresAt: "2026-09-12T12:30:00.000Z",
    targets: [{ targetId: value.plan.targetId, available: true, reason: "available", provider: "synthetic-provider", model: "synthetic-model",
      route: "synthetic-route", maximumMicrousd: 42000, maximumCalls: 1, maximumTokens: 1024,
      settings: { count: output === "image" ? 1 : 5 }, transferDescription: "Synthetic source" }],
    operationAttempts: { "target-original": { ordinal: 1, previousSlotId: null } },
  };
  value.disposition = "prepared";
  value.stage = "preflight";
  if (status === "review") { value.permitted.authorize = true; return value; }
  const isAuthorized = status === "authorized";
  value.original = {
    authorization: { key: "authorize-original", eventId: "event-authorize-original" },
    run: isAuthorized ? null : { key: "run-original", eventId: "event-run-original" },
    grantId: "grant-original", grantStatus: isAuthorized ? "authorized" : "active",
    slotId: "slot-original", slotStatus: isAuthorized ? "authorized" : status,
    jobId: "job-original", jobStatus: isAuthorized ? "queued" : status,
    targetId: value.plan.targetId, targetContractDigest: value.plan.targetContractDigest,
    routeDigest: "route-original", planRevisionId: value.plan.revisionId,
    sourceDigest: value.plan.sourceDigest, requirementsDigest: value.plan.requirementsDigest,
    expiresAt: "2026-09-12T13:00:00.000Z", correlationId: "correlation-original", jobExpiresAt: "2026-09-12T13:00:00.000Z",
  };
  value.grant = {
    id: value.original.grantId, planRevisionId: value.plan.revisionId, actorUserId: identity.actorUserId, payerUserId: identity.actorUserId,
    status: isAuthorized ? "authorized" : "active", maximumMicrousd: 42000, maximumCalls: 1,
    usedMicrousd: 0, exposedMicrousd: isAuthorized ? 0 : 42000, usedCalls: 0, pendingCalls: isAuthorized ? 0 : 1,
    expiresAt: value.original.expiresAt, disclosure: structuredClone(value.preflight),
    operations: [{ id: value.original.slotId, targetId: value.plan.targetId, targetLabel: "Image", jobId: value.original.jobId,
      status: value.original.slotStatus, maximumMicrousd: 42000, maximumCalls: 1, usedMicrousd: 0,
      exposedMicrousd: isAuthorized ? 0 : 42000, usedCalls: 0, pendingCalls: isAuthorized ? 0 : 1 }],
  };
  value.disposition = isAuthorized ? "original_authorized" : "original_run_recorded";
  value.stage = isAuthorized ? "authorize" : "run";
  value.permitted.run = isAuthorized;
  return value;
}

function response(value: unknown, path = basePath, options: { status?: number; headers?: Record<string, string>; url?: string; redirected?: boolean; raw?: Uint8Array | string } = {}) {
  const result = new Response(options.raw ?? JSON.stringify(value), {
    status: options.status ?? 200, headers: { "content-type": "application/json", ...options.headers },
  });
  Object.defineProperty(result, "url", { value: options.url ?? new URL(path, origin).href });
  Object.defineProperty(result, "redirected", { value: options.redirected ?? false });
  return result;
}

function changedSourceResult() {
  const value = state("succeeded"); value.current.source = "changed"; value.current.sourceDigest = "current-source-after-adoption";
  value.original!.jobStatus = "completed"; value.original!.grantStatus = value.grant!.status = "completed";
  value.grant!.pendingCalls = value.grant!.operations[0]!.pendingCalls = 0;
  return value;
}

test("Audio renewal decodes only the exact expired never-authorized quote and sends one unpaid preparation", async () => {
  const audioIdentity = { ...identity, output: "audio" as const };
  const expired = { ...state("review", "slides"), output: "audio" as const, audioCostPreview: null } as ExperienceNativeState;
  expired.status = "unavailable"; expired.permitted = { ...denied(), renewPreparation: true };
  expired.audioRenewal = { predecessorPreflightId: expired.preflight!.id, expiredAt: expired.preflight!.expiresAt };
  assert.ok(decodeExperienceBinding(expired, audioIdentity));
  for (const altered of [
    { ...expired, audioRenewal: { ...expired.audioRenewal, predecessorPreflightId: "other" } },
    { ...expired, audioRenewal: { ...expired.audioRenewal, expiredAt: "2999-01-01T00:00:00.000Z" } },
    { ...expired, sceneRenewal: expired.audioRenewal },
    { ...expired, permitted: { ...expired.permitted, authorize: true } },
    { ...expired, original: state("authorized", "slides").original },
  ]) assert.equal(decodeExperienceBinding(altered, audioIdentity), null);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new ExperienceOutputBindingClient(audioIdentity, {
    origin, current: () => true,
    request: async (input, init) => { calls.push({ url: String(input), init }); return response(expired, init?.method === "POST" ? basePath + "/prepare" : basePath); },
  });
  const shown = await client.read(); assert.ok(shown && "output" in shown);
  await client.command("renewPreparation", shown);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.url, basePath + "/prepare");
  assert.deepEqual(JSON.parse(String(calls[1]!.init!.body)), { draftHash: identity.draftHash, explicitRequirementsConfirmation: true,
    renewal: { predecessorPreflightId: expired.preflight!.id, explicitRenewal: true } });
  assert.equal(calls.some(call => /\/(authorize|run)$/.test(call.url)), false);
});

test("Storyboard renewal decodes only the exact expired never-authorized quote and sends one unpaid preparation", async () => {
  const storyboardIdentity = { ...identity, output: "storyboard" as const };
  const expired = { ...state("review", "slides"), output: "storyboard" as const } as ExperienceNativeState;
  expired.status = "unavailable"; expired.permitted = { ...denied(), renewPreparation: true };
  expired.storyboardRenewal = { predecessorPreflightId: expired.preflight!.id, expiredAt: expired.preflight!.expiresAt };
  assert.ok(decodeExperienceBinding(expired, storyboardIdentity));
  for (const altered of [
    { ...expired, storyboardRenewal: { ...expired.storyboardRenewal, predecessorPreflightId: "other" } },
    { ...expired, storyboardRenewal: { ...expired.storyboardRenewal, expiredAt: "2999-01-01T00:00:00.000Z" } },
    { ...expired, sceneRenewal: expired.storyboardRenewal },
    { ...expired, permitted: { ...expired.permitted, authorize: true } },
    { ...expired, original: state("authorized", "slides").original },
  ]) assert.equal(decodeExperienceBinding(altered, storyboardIdentity), null);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new ExperienceOutputBindingClient(storyboardIdentity, {
    origin, current: () => true,
    request: async (input, init) => { calls.push({ url: String(input), init }); return response(expired, init?.method === "POST" ? basePath + "/prepare" : basePath); },
  });
  const shown = await client.read(); assert.ok(shown && "output" in shown);
  await client.command("renewPreparation", shown);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.url, basePath + "/prepare");
  assert.deepEqual(JSON.parse(String(calls[1]!.init!.body)), { draftHash: identity.draftHash, explicitRequirementsConfirmation: true,
    renewal: { predecessorPreflightId: expired.preflight!.id, explicitRenewal: true } });
  assert.equal(calls.some(call => /\/(authorize|run)$/.test(call.url)), false);
});
test("Slides renewal decodes only the exact expired never-authorized quote and sends one unpaid preparation", async () => {
  const slidesIdentity = { ...identity, output: "slides" as const };
  const expired = state("review", "slides");
  expired.status = "unavailable"; expired.permitted = { ...denied(), renewPreparation: true };
  expired.slidesRenewal = { predecessorPreflightId: expired.preflight!.id, expiredAt: expired.preflight!.expiresAt };
  assert.ok(decodeExperienceBinding(expired, slidesIdentity));
  for (const altered of [
    { ...expired, slidesRenewal: { ...expired.slidesRenewal, predecessorPreflightId: "other" } },
    { ...expired, slidesRenewal: { ...expired.slidesRenewal, expiredAt: "2026-01-01T00:00:00.000Z" } },
    { ...expired, sceneRenewal: expired.slidesRenewal },
    { ...expired, permitted: { ...expired.permitted, authorize: true } },
    { ...expired, original: state("authorized", "slides").original },
  ]) assert.equal(decodeExperienceBinding(altered, slidesIdentity), null);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new ExperienceOutputBindingClient(slidesIdentity, {
    origin, current: () => true,
    request: async (input, init) => { calls.push({ url: String(input), init }); return response(expired, init?.method === "POST" ? basePath + "/prepare" : basePath); },
  });
  const shown = await client.read(); assert.ok(shown && "output" in shown);
  await client.command("renewPreparation", shown);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.url, basePath + "/prepare");
  assert.deepEqual(JSON.parse(String(calls[1]!.init!.body)), { draftHash: identity.draftHash, explicitRequirementsConfirmation: true,
    renewal: { predecessorPreflightId: expired.preflight!.id, explicitRenewal: true } });
  assert.equal(calls.some(call => /\/(authorize|run)$/.test(call.url)), false);
});
test("changed-source completed Image decoder retains separate current and original digests", () => {
  const value = changedSourceResult(), decoded = decodeExperienceBinding(value, identity);
  assert.deepEqual(decoded, value); assert.ok(Object.isFrozen(decoded));
  assert.notEqual(value.current.sourceDigest, value.plan!.sourceDigest);
  for (const action of ["prepare", "authorize", "run", "resumeRun", "recoverResult", "renewPreparation"] as const) {
    const invalid = changedSourceResult(); invalid.permitted[action] = true;
    assert.equal(decodeExperienceBinding(invalid, identity), null, action);
  }
  for (const change of [
    (v: ExperienceNativeState) => { v.original!.run = null; },
    (v: ExperienceNativeState) => { v.original!.jobStatus = "running"; },
    (v: ExperienceNativeState) => { v.original!.grantStatus = v.grant!.status = "active"; },
    (v: ExperienceNativeState) => { v.grant!.pendingCalls = 1; },
    (v: ExperienceNativeState) => { v.original!.sourceDigest = v.current.sourceDigest; },
    (v: ExperienceNativeState) => { v.grant!.actorUserId = "foreign"; },
  ]) { const invalid = changedSourceResult(); change(invalid); assert.equal(decodeExperienceBinding(invalid, identity), null); }
  const slides = changedSourceResult(); slides.output = "slides";
  assert.equal(decodeExperienceBinding(slides, { ...identity, output: "slides" }), null);
});

test("retained changed-source transport never posts prepare, authorize, run, resume or recovery", async () => {
  const calls: string[] = [];
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true,
    request: async (_url, init) => { calls.push(init?.method ?? "GET"); return response(changedSourceResult()); } });
  await client.read(); const shown = client.state as ExperienceNativeState;
  for (const action of ["prepare", "authorize", "run", "resumeRun", "recoverResult", "renewPreparation"] as const) await client.command(action, shown);
  assert.deepEqual(calls, ["GET"]);
});

function transport(replies: Array<Response | Error | (() => Promise<Response>)>) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const request: typeof fetch = async (input, init = {}) => {
    calls.push({ path: String(input), init });
    const next = replies.shift();
    assert.ok(next, "Unexpected synthetic request");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  };
  return { calls, request };
}

function mutable(value: ExperienceNativeState = state("authorized")): MutableRecord { return structuredClone(value) as unknown as MutableRecord; }
function resumable(status: "queued" | "running" = "queued"): ExperienceNativeState {
  const value = state(status);
  value.permitted.resumeRun = true;
  value.grant!.pendingCalls = 0; value.grant!.operations[0].pendingCalls = 0;
  return value;
}
function shown(client: ExperienceOutputBindingClient): ExperienceNativeState {
  assert.ok("draftId" in client.state, "Expected a decoded native state");
  return client.state;
}

test("known413 source capacity after prepare remains a decoded refusal rather than transport uncertainty", async () => {
  const refusal = unavailableBinding("output_source_proof_too_large");
  const fake = transport([response(state()), response(refusal, basePath + "/prepare", { status: 413 })]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  await client.read();
  const result = await client.command("prepare", shown(client));
  assert.deepEqual(result, refusal); assert.deepEqual(client.state, refusal);
  assert.equal(client.pending, false); assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1]!.init.method, "POST");
  assert.ok(Object.values(client.state.permitted).every(v => v === false));
});
function setPath(value: MutableRecord, path: string[], next: unknown) {
  let parent: Record<PropertyKey, unknown> = value;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<PropertyKey, unknown>;
  parent[path.at(-1)!] = next;
}

test("decodes canonical-shaped absent, preparing, review, authorized, queued and terminal original states for both outputs", () => {
  for (const output of ["image", "slides"] as const) {
    for (const status of ["absent", "preparing", "review", "authorized", "queued", "running", "succeeded", "failed", "cancelled", "partial", "uncertain", "unavailable"] as const) {
      const input = state(status, output);
      const result = decodeExperienceBinding(input, { ...identity, output });
      assert.deepEqual(result, input, `${output}/${status}`);
    }
  }
  assert.deepEqual(decodeExperienceBinding(unavailableBinding(), identity), unavailableBinding());
});

test("rejects mismatched draft, release, document, project, output and custody/source identity", () => {
  for (const path of [["draftId"], ["draftHash"], ["releaseHash"], ["documentId"], ["projectId"], ["output"], ["sourceSurface"],
    ["current", "custody"], ["current", "source"], ["current", "sourceDigest"], ["current", "requirementsDigest"]]) {
    const input = mutable(); setPath(input, path, "different");
    assert.equal(decodeExperienceBinding(input, identity), null, path.join("."));
  }
});

test("rejects mismatched exact plan, preflight, grant, slot, original job and source associations", () => {
  for (const path of [["plan", "revisionId"], ["plan", "targetId"], ["plan", "targetContractDigest"],
    ["plan", "sourceDigest"], ["plan", "requirementsDigest"], ["preflight", "planRevisionId"], ["preflight", "sourceDigest"],
    ["preflight", "requirementsDigest"], ["preflight", "targets", "0", "targetId"], ["grant", "id"], ["grant", "status"],
    ["grant", "planRevisionId"], ["grant", "actorUserId"], ["grant", "operations", "0", "id"],
    ["grant", "operations", "0", "targetId"], ["grant", "operations", "0", "jobId"], ["grant", "operations", "0", "status"],
    ["original", "grantId"], ["original", "grantStatus"], ["original", "slotId"], ["original", "slotStatus"],
    ["original", "jobId"], ["original", "targetId"], ["original", "targetContractDigest"], ["original", "planRevisionId"],
    ["original", "sourceDigest"], ["original", "requirementsDigest"]]) {
    const input = mutable(); setPath(input, path, "different");
    assert.equal(decodeExperienceBinding(input, identity), null, path.join("."));
  }
  for (const path of [["grant", "operations"], ["preflight", "targets"]]) {
    const input = mutable(); setPath(input, path, []);
    assert.equal(decodeExperienceBinding(input, identity), null, path.join("."));
  }
  const changedTerms = mutable(); changedTerms.grant.disclosure.termsDigest = "different";
  assert.equal(decodeExperienceBinding(changedTerms, identity), null);
  const changedExpiry = mutable(); changedExpiry.grant.expiresAt = "2026-09-12T14:00:00.000Z";
  assert.equal(decodeExperienceBinding(changedExpiry, identity), null);
  for (const path of [["grant", "maximumMicrousd"], ["grant", "maximumCalls"],
    ["grant", "operations", "0", "maximumMicrousd"], ["grant", "operations", "0", "maximumCalls"]]) {
    const input = mutable(); setPath(input, path, 90000);
    assert.equal(decodeExperienceBinding(input, identity), null, path.join("."));
  }
});

test("requires retained original command, correlation and expiry evidence without inventing command digests", () => {
  assert.ok(decodeExperienceBinding(state("authorized"), identity));
  assert.ok(decodeExperienceBinding(state("queued"), identity));
  for (const path of [["original", "authorization", "key"], ["original", "authorization", "eventId"],
    ["original", "run", "key"], ["original", "run", "eventId"], ["original", "correlationId"],
    ["original", "jobExpiresAt"], ["original", "expiresAt"], ["original", "routeDigest"], ["original", "jobStatus"]]) {
    const input = mutable(state("queued")); setPath(input, path, "");
    assert.equal(decodeExperienceBinding(input, identity), null, path.join("."));
  }
});

test("rejects terminal paid permissions and inconsistent original dispositions", () => {
  for (const status of ["queued", "running", "succeeded", "failed", "cancelled", "partial", "uncertain", "unavailable"] as const) {
    for (const action of ["prepare", "authorize", "run", "resumeRun"] as const) {
      const input = state(status); input.permitted[action] = true;
      assert.equal(decodeExperienceBinding(input, identity), null, `${status}/${action}`);
    }
  }
  const mismatches: MutableRecord[] = [];
  for (const disposition of ["never_admitted", "prepared", "original_run_recorded"]) { const input = mutable(); input.disposition = disposition; mismatches.push(input); }
  const runWithoutReceipt = mutable(state("queued")); runWithoutReceipt.original.run = null; mismatches.push(runWithoutReceipt);
  const newBuyAfterOriginal = mutable(); newBuyAfterOriginal.permitted.prepare = true; mismatches.push(newBuyAfterOriginal);
  const grantWithoutOriginal = mutable(); setPath(grantWithoutOriginal, ["original"], null); mismatches.push(grantWithoutOriginal);
  for (const input of mismatches) assert.equal(decodeExperienceBinding(input, identity), null);
  for (const action of ["prepare", "authorize", "run", "resumeRun"] as const) {
    const unknown: { permitted: Record<string, unknown> } = structuredClone(unavailableBinding()); unknown.permitted[action] = true;
    assert.equal(decodeExperienceBinding(unknown, identity), null);
  }
});

test("rejects non-finite, negative and unsafe numeric budget evidence", () => {
  for (const root of [["preflight"], ["grant"], ["grant", "operations", "0"]]) {
    for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 1.5, "42000"]) {
      const input = mutable(); setPath(input, [...root, "maximumMicrousd"], amount);
      assert.equal(decodeExperienceBinding(input, identity), null, `${root.join(".")}/${String(amount)}`);
    }
  }
});

test("rejects object/array accessors and custom prototypes without invoking getters", () => {
  let invoked = 0;
  const getter = () => { invoked++; throw new Error("Getter must not run"); };
  const cases: unknown[] = [];
  const top = mutable(); Object.defineProperty(top, "version", { enumerable: true, get: getter }); cases.push(top);
  const nested = mutable(); Object.defineProperty(nested.current, "sourceDigest", { enumerable: true, get: getter }); cases.push(nested);
  const array = mutable(); Object.defineProperty(array.grant.operations, "0", { enumerable: true, get: getter }); cases.push(array);
  const extraArray = mutable(); Object.defineProperty(extraArray.grant.operations, "extra", { enumerable: true, get: getter }); cases.push(extraArray);
  const prototype = mutable(); Object.setPrototypeOf(prototype, { get hostile() { return getter(); } }); cases.push(prototype);
  const nestedPrototype = mutable(); Object.setPrototypeOf(nestedPrototype.plan, { get hostile() { return getter(); } }); cases.push(nestedPrototype);
  const arrayPrototype = mutable(); Object.setPrototypeOf(arrayPrototype.grant.operations, { get hostile() { return getter(); } }); cases.push(arrayPrototype);
  const hidden = mutable(); Object.defineProperty(hidden, "hidden", { value: true, enumerable: false }); cases.push(hidden);
  const symbolic = mutable(); symbolic[Symbol("extra")] = true; cases.push(symbolic);
  for (const input of cases) assert.equal(decodeExperienceBinding(input, identity), null);
  assert.equal(invoked, 0);
});

test("rejects sparse arrays, excessive depth, oversized strings and unsupported JSON values", () => {
  const cases: MutableRecord[] = [];
  const sparse = mutable(); sparse.grant.operations = new Array(1); cases.push(sparse);
  const long = mutable(); long.extra = "x".repeat(65537); cases.push(long);
  const wide = mutable(); wide.extra = Array(4097).fill(null); cases.push(wide);
  const deep = mutable(); let cursor: Record<string, unknown> = deep; for (let index = 0; index < 18; index++) cursor = cursor.extra = {}; cases.push(deep);
  for (const extra of [undefined, 1n, () => null, new Date("2026-09-12T00:00:00.000Z")]) { const input = mutable(); input.extra = extra; cases.push(input); }
  for (const input of cases) assert.equal(decodeExperienceBinding(input, identity), null);
});

test("returns detached deeply immutable state and original evidence", () => {
  const input = state("authorized"); const result = decodeExperienceBinding(input, identity);
  assert.ok(result && "original" in result && result.original && result.grant && result.preflight);
  assert.notEqual(result, input);
  assert.notEqual(result.original, input.original);
  for (const value of [result, result.permitted, result.current, result.plan, result.original, result.original.authorization,
    result.grant, result.grant.operations, result.grant.operations[0], result.preflight.targets, result.preflight.targets[0].settings]) assert.ok(Object.isFrozen(value));
  input.original!.jobId = "mutated"; input.grant!.operations[0].jobId = "mutated";
  assert.equal(result.original.jobId, "job-original"); assert.equal(result.grant.operations[0].jobId, "job-original");
  assert.throws(() => { (result.original as Record<string, unknown>).jobId = "changed"; }, TypeError);
  assert.ok(Object.isFrozen(unavailableBinding().permitted));
});

test("constructing, reading and re-reading bind with GET only and same-origin non-cached response checks", async () => {
  const fake = transport([response(state()), response(state("preparing"))]);
  const mutableIdentity = { ...identity };
  const client = new ExperienceOutputBindingClient(mutableIdentity, { origin, current: () => true, request: fake.request });
  assert.equal(fake.calls.length, 0); assert.equal(client.state.status, "unavailable");
  mutableIdentity.documentId = "changed"; assert.equal(client.identity.documentId, identity.documentId); assert.ok(Object.isFrozen(client.identity));
  await client.read(); await client.read();
  assert.equal(client.state.status, "preparing"); assert.equal(client.pending, false);
  assert.equal(fake.calls.length, 2);
  for (const { path, init } of fake.calls) {
    assert.equal(path, basePath); assert.equal(init.method, "GET"); assert.equal(init.body, undefined);
    assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal); assert.deepEqual(init.headers, { accept: "application/json" });
  }
});

test("explicit prepare, authorize and original run use only their exact fixed bodies", async () => {
  const fake = transport([response(state()), response(state("review"), basePath + "/prepare"),
    response(state("authorized"), basePath + "/authorize"), response(state("queued"), basePath + "/run")]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  await client.read(); await client.command("prepare", shown(client)); await client.command("authorize", shown(client)); await client.command("run", shown(client));
  assert.equal(client.state.status, "queued");
  const expected = [
    ["prepare", { draftHash: identity.draftHash, explicitRequirementsConfirmation: true }],
    ["authorize", { draftHash: identity.draftHash, termsDigest: "terms-original", maximumMicrousd: 42000, explicitAuthorization: true }],
    ["run", { draftHash: identity.draftHash, grantId: "grant-original", explicitRun: true }],
  ] as const;
  for (let index = 0; index < expected.length; index++) {
    const [action, body] = expected[index]; const call = fake.calls[index + 1];
    assert.equal(call.path, `${basePath}/${action}`); assert.equal(call.init.method, "POST");
    assert.deepEqual(JSON.parse(String(call.init.body)), body);
    assert.deepEqual(call.init.headers, { accept: "application/json", "content-type": "application/json" });
    assert.equal(call.init.credentials, "same-origin"); assert.equal(call.init.cache, "no-store"); assert.equal(call.init.redirect, "error");
  }
  assert.equal(fake.calls.length, 4);
});

test("lost original POST stays unavailable and a subsequent passive lookup cannot resubmit it", async () => {
  const fake = transport([response(state("authorized")), new Error("Synthetic lost acknowledgment"), response(state("queued"))]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  await client.read(); const authorized = shown(client); await client.command("run", authorized);
  assert.deepEqual(client.state, unavailableBinding("submission_unconfirmed"));
  await client.command("run", authorized); assert.equal(fake.calls.length, 2);
  await client.read(); assert.equal(client.state.status, "queued");
  await client.command("run", shown(client));
  assert.deepEqual(fake.calls.map(call => call.init.method), ["GET", "POST", "GET"]);
  assert.equal((shown(client)).original!.jobId, "job-original");
});

test("stale shown objects, copied states and unavailable actions never dispatch", async () => {
  const fake = transport([response(state()), response(state("review"))]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  await client.read(); const old = shown(client);
  await client.command("prepare", structuredClone(old)); await client.command("authorize", old); assert.equal(fake.calls.length, 1);
  await client.read(); await client.command("prepare", old); await client.command("run", shown(client));
  assert.equal(fake.calls.length, 2);
});

test("pending work prevents concurrent reads and commands", async () => {
  let finish!: (value: Response) => void;
  const deferred = new Promise<Response>(resolve => { finish = resolve; });
  const fake = transport([response(state()), () => deferred]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  await client.read(); const absent = shown(client); const operation = client.command("prepare", absent);
  assert.equal(client.pending, true); await client.read(); await client.command("prepare", absent); assert.equal(fake.calls.length, 2);
  finish(response(state("review"), basePath + "/prepare")); await operation;
  assert.equal(client.pending, false); assert.equal(client.state.status, "review");
});

test("wrong scope, redirect, content type, status, URL and malformed response cannot establish a binding", async () => {
  const wrongDocument = mutable(); wrongDocument.documentId = "wrong-document";
  const options = [
    response(wrongDocument), response(state(), basePath, { url: "https://other.test" + basePath }),
    response(state(), basePath, { url: origin + basePath + "?different" }), response(state(), basePath, { redirected: true }),
    response(state(), basePath, { headers: { "content-type": "text/html" } }), response(state(), basePath, { status: 500 }),
    response(null, basePath, { raw: "{" }), response(null, basePath, { raw: new Uint8Array([0xff]) }),
  ];
  for (const reply of options) {
    const fake = transport([reply]); const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
    await client.read(); assert.deepEqual(client.state, unavailableBinding("original_unavailable")); assert.equal(client.pending, false);
  }
  const fake = transport([response(unavailableBinding("retained_unavailable"), basePath, { status: 409 })]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  await client.read(); assert.deepEqual(client.state, unavailableBinding("retained_unavailable"));
});

test("declared and streamed oversized bodies plus invalid content lengths fail closed", async () => {
  const options = [
    response(state(), basePath, { headers: { "content-length": "262145" } }),
    response(state(), basePath, { headers: { "content-length": "-1" } }),
    response(state(), basePath, { headers: { "content-length": "01" } }),
    response(state(), basePath, { headers: { "content-length": "9007199254740992" } }),
    response(null, basePath, { raw: " ".repeat(262145) }),
  ];
  for (const reply of options) {
    const fake = transport([reply]); const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
    await client.read(); assert.deepEqual(client.state, unavailableBinding("original_unavailable"));
  }
});

test("retired current state never dispatches and retirement before response discards authority", async () => {
  let active = false;
  const fake = transport([response(state())]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => active, request: fake.request });
  await client.read(); assert.equal(fake.calls.length, 0);
  active = true; await client.read(); active = false;
  await client.command("prepare", shown(client)); assert.equal(fake.calls.length, 1);

  let finish!: (value: Response) => void;
  active = true; const pending = transport([() => new Promise<Response>(resolve => { finish = resolve; })]);
  const retired = new ExperienceOutputBindingClient(identity, { origin, current: () => active, request: pending.request });
  const operation = retired.read(); active = false; finish(response(state("authorized"))); await operation;
  assert.deepEqual(retired.state, unavailableBinding("original_unavailable")); assert.equal(retired.pending, false);
});

test("dispose aborts inflight work and a late response cannot resurrect original permissions", async () => {
  let finish!: (value: Response) => void;
  const fake = transport([() => new Promise<Response>(resolve => { finish = resolve; })]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  const operation = client.read(); assert.equal(client.pending, true); client.dispose();
  assert.equal(fake.calls[0].init.signal!.aborted, true); assert.equal(client.pending, false);
  finish(response(state("authorized"))); await operation;
  assert.deepEqual(client.state, unavailableBinding("withdrawn"));
});

test("foreground run survives both old cutoffs with one POST and accepts its late original response", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (value: Response) => void;
  const fake = transport([response(state("authorized")), () => new Promise<Response>(resolve => { finish = resolve; })]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  await client.read(); const authorized = shown(client);
  const host = new ExperienceHostOperation(() => client.dispose(), undefined, { action: "run", output: "image" });
  const pending = host.wait(client.command("run", authorized));
  context.mock.timers.tick(31000);
  assert.equal(host.current(), true); assert.equal(client.pending, true); assert.equal(fake.calls[1].init.signal!.aborted, false);
  await client.command("run", authorized); assert.equal(fake.calls.length, 2);
  finish(response(state("succeeded"), basePath + "/run"));
  assert.equal((await pending).status, "succeeded"); host.finish();
  assert.deepEqual(fake.calls.map(call => call.init.method), ["GET", "POST"]);
});

test("foreground hard deadline retains uncertainty and suppresses late response without redispatch", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (value: Response) => void;
  const fake = transport([response(state("authorized")), () => new Promise<Response>(resolve => { finish = resolve; }), response(state("queued"))]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  await client.read(); const authorized = shown(client), pending = client.command("run", authorized);
  context.mock.timers.tick(299999); assert.equal(fake.calls[1].init.signal!.aborted, false);
  context.mock.timers.tick(1); await pending;
  assert.equal(fake.calls[1].init.signal!.aborted, true); assert.deepEqual(client.state, unavailableBinding("submission_unconfirmed"));
  await client.command("run", authorized); assert.equal(fake.calls.length, 2);
  await client.read(); const recovered = client.state;
  finish(response(state("succeeded"), basePath + "/run")); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(client.state, recovered); assert.equal(client.state.status, "queued");
  assert.deepEqual(fake.calls.map(call => call.init.method), ["GET", "POST", "GET"]);
});

test("long foreground headers still permit only one nonrenewing twenty-second body window", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (value: Response) => void, next!: (value: ReadableStreamReadResult<Uint8Array>) => void;
  const fake = transport([response(state("authorized")), () => new Promise<Response>(resolve => { finish = resolve; })]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  await client.read(); const pending = client.command("run", shown(client));
  context.mock.timers.tick(45000);
  const reply = response(state("succeeded"), basePath + "/run");
  Object.defineProperty(reply.body, "getReader", { value: () => ({
    read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(resolve => { next = resolve; }), cancel: async () => {},
  }) });
  finish(reply); await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(19000); next({ done: false, value: new Uint8Array([32]) });
  await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(1000); await pending;
  assert.equal(fake.calls[1].init.signal!.aborted, true); assert.deepEqual(client.state, unavailableBinding("submission_unconfirmed"));
  assert.equal(fake.calls.length, 2);
});

test("ordinary delayed headers do not renew the twenty-second total deadline", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (value: Response) => void;
  const fake = transport([() => new Promise<Response>(resolve => { finish = resolve; })]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  const pending = client.read(); context.mock.timers.tick(19000);
  const reply = response(state("authorized"));
  Object.defineProperty(reply.body, "getReader", { value: () => ({read: () => new Promise<never>(() => {}), cancel: async () => {}}) });
  finish(reply); await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(999); assert.equal(client.pending, true); assert.equal(fake.calls[0].init.signal!.aborted, false);
  context.mock.timers.tick(1); await pending;
  assert.deepEqual(client.state, unavailableBinding("original_unavailable")); assert.equal(fake.calls[0].init.signal!.aborted, true);
});

test("foreground policy extends explicit admission and scoped Video reads, never unknown actions", () => {
  for (const action of ["unknown"]) {
    assert.equal(experienceResponseTimeout({action,output:"video"}), 20000);
    assert.equal(experienceHostTimeout({action,output:"video"}), 30000);
  }
  for (const output of ["image","slides","short_story","unknown"])
    assert.equal(experienceResponseTimeout({action:"authorize",output}),20000);
  for (const output of ["audio","storyboard"]) {
    assert.equal(experienceResponseTimeout({action:"authorize",output}),120000);
    assert.equal(experienceHostTimeout({action:"authorize",output}),170000);
    assert.equal(experienceResponseTimeout({action:"read",output}),20000);
  }
  assert.equal(experienceResponseTimeout({action:"authorize",output:"video"}),120000);
  assert.equal(experienceHostTimeout({action:"authorize",output:"video"}),170000);
  assert.equal(experienceResponseTimeout({action:"authorize",output:"model3d"}),120000);
  assert.equal(experienceHostTimeout({action:"authorize",output:"model3d"}),170000);
  assert.equal(experienceResponseTimeout({action:"authorize",output:"scene"}),240000);
  assert.equal(experienceHostTimeout({action:"authorize",output:"scene"}),290000);
  for (const action of ["run", "resumeRun"]) for (const output of ["image","slides","short_story","scene","storyboard","audio","video","model3d"]) {
    const expected = ["video","model3d"].includes(output) ? 960000 : 300000;
    assert.equal(experienceResponseTimeout({action,output}), expected);
    assert.equal(experienceHostTimeout({action,output}), expected + 50000);
  }
  assert.equal(experienceResponseTimeout({action:"recoverResult",output:"image"}), 180000);
  for(const action of ["prepare","renewPreparation"]){
    assert.equal(experienceResponseTimeout({action,output:"scene"}),240000);
    assert.equal(experienceHostTimeout({action,output:"scene"}),290000);
  }
});

test("one explicit Video authorization survives old cutoffs without repeat or automatic Run",async context=>{
  context.mock.timers.enable({apis:["setTimeout"]});
  const videoIdentity={...identity,output:"video" as const},review={...state("review"),output:"video" as const};
  let finish!:(value:Response)=>void;
  const fake=transport([response(review),()=>new Promise<Response>(resolve=>{finish=resolve;})]);
  const client=new ExperienceOutputBindingClient(videoIdentity,{origin,current:()=>true,request:fake.request});
  await client.read();const original=shown(client),host=new ExperienceHostOperation(()=>client.dispose(),undefined,{action:"authorize",output:"video"});
  const pending=host.wait(client.command("authorize",original));
  context.mock.timers.tick(45000);assert.equal(host.current(),true);assert.equal(client.pending,true);assert.equal(fake.calls[1].init.signal!.aborted,false);
  await client.command("authorize",original);assert.equal(fake.calls.length,2);
  assert.deepEqual(JSON.parse(String(fake.calls[1].init.body)),{draftHash:identity.draftHash,termsDigest:review.preflight!.termsDigest,maximumMicrousd:review.preflight!.maximumMicrousd,explicitAuthorization:true});
  finish(response({...state("authorized"),output:"video"},basePath+"/authorize"));
  assert.equal((await pending).status,"authorized");host.finish();assert.equal(fake.calls.length,2);
});

test("Video admission remains finite and its timeout recovers by GET only",async context=>{
  context.mock.timers.enable({apis:["setTimeout"]});
  const videoIdentity={...identity,output:"video" as const},review={...state("review"),output:"video" as const};
  const fake=transport([response(review),()=>new Promise<Response>(()=>{}),response(review)]);
  const client=new ExperienceOutputBindingClient(videoIdentity,{origin,current:()=>true,request:fake.request});
  await client.read();const original=shown(client),pending=client.command("authorize",original);
  context.mock.timers.tick(119999);assert.equal(client.pending,true);context.mock.timers.tick(1);await pending;
  assert.equal(fake.calls[1].init.signal!.aborted,true);assert.deepEqual(client.state,unavailableBinding("submission_unconfirmed"));
  await client.command("authorize",original);assert.equal(fake.calls.length,2);
  await client.read();assert.deepEqual(fake.calls.map(call=>call.init.method),["GET","POST","GET"]);
});

test("Video authorization keeps a20s body bound and discards a retired owner's late response",async context=>{
  context.mock.timers.enable({apis:["setTimeout"]});
  for(const stop of ["body-timeout","retire"]){
    const videoIdentity={...identity,output:"video" as const},review={...state("review"),output:"video" as const};
    let finish!:(value:Response)=>void;
    const fake=transport([response(review),()=>new Promise<Response>(resolve=>{finish=resolve;})]);
    const client=new ExperienceOutputBindingClient(videoIdentity,{origin,current:()=>true,request:fake.request});
    await client.read();const pending=client.command("authorize",shown(client));context.mock.timers.tick(45000);
    if(stop==="body-timeout"){
      const reply=response({...state("authorized"),output:"video"},basePath+"/authorize");
      Object.defineProperty(reply.body,"getReader",{value:()=>({read:()=>new Promise(()=>{}),cancel:async()=>{}})});
      finish(reply);await new Promise<void>(resolve=>setImmediate(resolve));context.mock.timers.tick(19999);assert.equal(client.pending,true);
      context.mock.timers.tick(1);await pending;assert.deepEqual(client.state,unavailableBinding("submission_unconfirmed"));
    }else{
      client.dispose();await pending;finish(response({...state("authorized"),output:"video"},basePath+"/authorize"));
      await new Promise<void>(resolve=>setImmediate(resolve));assert.deepEqual(client.state,unavailableBinding("withdrawn"));
    }
    assert.equal(fake.calls.length,2);assert.equal(fake.calls[1].init.signal!.aborted,true);
  }
});

test("one explicit preparation survives both old cutoffs without automatically continuing", async context => {
  context.mock.timers.enable({apis:["setTimeout"]});
  let finish!: (value:Response)=>void;
  const fake=transport([response(state("absent")),()=>new Promise<Response>(resolve=>{finish=resolve;})]);
  const client=new ExperienceOutputBindingClient(identity,{origin,current:()=>true,request:fake.request});
  await client.read();const original=shown(client);
  const host=new ExperienceHostOperation(()=>client.dispose(),undefined,{action:"prepare",output:"image"});
  const pending=host.wait(client.command("prepare",original));
  context.mock.timers.tick(31000);assert.equal(host.current(),true);assert.equal(fake.calls[1].init.signal!.aborted,false);
  await client.command("prepare",original);assert.equal(fake.calls.length,2);
  finish(response(state("preparing"),basePath+"/prepare"));assert.equal((await pending).status,"preparing");host.finish();
  assert.deepEqual(fake.calls.map(call=>call.init.method),["GET","POST"]);
});

test("binding lifetime: a never-finishing fetch times out and releases pending state", { timeout: 1000 }, async () => {
  const fake = transport([() => new Promise<Response>(() => {})]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request, timeoutMs: 20 });
  const operation = client.read(); assert.equal(client.pending, true);
  await operation;
  assert.deepEqual(client.state, unavailableBinding("original_unavailable"));
  assert.equal(client.pending, false); assert.equal(fake.calls[0].init.signal!.aborted, true);
  assert.deepEqual(fake.calls.map(call => call.init.method), ["GET"]);
});

test("binding lifetime: original POST timeout recovers with GET only and cannot publish its late response", { timeout: 1000 }, async () => {
  let finishOriginal!: (value: Response) => void;
  const original = new Promise<Response>(resolve => { finishOriginal = resolve; });
  const fake = transport([response(state("authorized")), () => original, response(state("queued"))]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request, timeoutMs: 20 });
  await client.read(); const authorized = shown(client);
  await client.command("run", authorized);
  assert.deepEqual(client.state, unavailableBinding("submission_unconfirmed"));
  assert.equal(client.pending, false); assert.equal(fake.calls[1].init.signal!.aborted, true);
  await client.command("run", authorized); assert.equal(fake.calls.length, 2);
  await client.read(); const recovered = shown(client);
  assert.equal(recovered.status, "queued"); assert.equal(recovered.original!.jobId, "job-original");
  finishOriginal(response(state("succeeded"), basePath + "/run"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(client.state, recovered); assert.equal(client.pending, false);
  assert.deepEqual(fake.calls.map(call => call.init.method), ["GET", "POST", "GET"]);
});

test("binding lifetime: a stalled body read and never-finishing cancellation cannot retain pending state", { timeout: 1000 }, async () => {
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({
    pull: () => new Promise<void>(() => {}),
    cancel: () => { cancellations++; return new Promise<void>(() => {}); },
  });
  const reply = new Response(body, { headers: { "content-type": "application/json" } });
  Object.defineProperty(reply, "url", { value: new URL(basePath, origin).href });
  const fake = transport([reply]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request, timeoutMs: 20 });
  await client.read();
  assert.deepEqual(client.state, unavailableBinding("original_unavailable"));
  assert.equal(client.pending, false); assert.equal(cancellations, 1);
  assert.equal(fake.calls[0].init.signal!.aborted, true);
});

test("binding lifetime: successful decoding is not blocked by a never-finishing reader cancellation", { timeout: 1000 }, async () => {
  const reply = response(state("authorized"));
  let reads = 0, cancellations = 0;
  const bytes = new TextEncoder().encode(JSON.stringify(state("authorized")));
  Object.defineProperty(reply.body, "getReader", { value: () => ({
    read: async () => reads++ === 0 ? { done: false, value: bytes } : { done: true, value: undefined },
    cancel: () => { cancellations++; return new Promise<void>(() => {}); },
  }) });
  const fake = transport([reply]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request, timeoutMs: 20 });
  await client.read();
  assert.equal(client.state.status, "authorized"); assert.equal(client.pending, false);
  assert.equal(cancellations, 1); assert.equal(reads, 2);
});

test("binding lifetime: disposal wakes never-finishing fetch and body races without waiting for the deadline", { timeout: 1000 }, async () => {
  const fetchFake = transport([() => new Promise<Response>(() => {})]);
  const fetchClient = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fetchFake.request, timeoutMs: 20000 });
  const fetchOperation = fetchClient.read(); fetchClient.dispose(); await fetchOperation;
  assert.deepEqual(fetchClient.state, unavailableBinding("withdrawn")); assert.equal(fetchClient.pending, false);
  assert.equal(fetchFake.calls[0].init.signal!.aborted, true);

  let started!: () => void, cancellations = 0;
  const bodyStarted = new Promise<void>(resolve => { started = resolve; });
  const reply = response(state());
  Object.defineProperty(reply.body, "getReader", { value: () => ({
    read: () => { started(); return new Promise<never>(() => {}); },
    cancel: () => { cancellations++; return new Promise<void>(() => {}); },
  }) });
  const bodyFake = transport([reply]);
  const bodyClient = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: bodyFake.request, timeoutMs: 20000 });
  const bodyOperation = bodyClient.read(); await bodyStarted; bodyClient.dispose(); await bodyOperation;
  assert.deepEqual(bodyClient.state, unavailableBinding("withdrawn")); assert.equal(bodyClient.pending, false);
  assert.equal(bodyFake.calls[0].init.signal!.aborted, true); assert.equal(cancellations, 1);
});

test("Resume decodes only the recorded original with queued or running state, slot and job plus no pending calls", () => {
  for (const output of ["image", "slides"] as const) {
    for (const stateStatus of ["queued", "running"] as const) {
      for (const slotStatus of ["queued", "running"] as const) {
        for (const jobStatus of ["queued", "running"] as const) {
          for (const grantStatus of ["authorized", "active"] as const) {
            const input = resumable(stateStatus); input.output = output;
            input.original!.slotStatus = slotStatus; input.grant!.operations[0].status = slotStatus;
            input.original!.jobStatus = jobStatus;
            input.original!.grantStatus = grantStatus; input.grant!.status = grantStatus;
            const decoded = decodeExperienceBinding(input, { ...identity, output });
            assert.deepEqual(decoded, input, `${output}/${stateStatus}/${slotStatus}/${jobStatus}/${grantStatus}`);
            assert.deepEqual(decoded!.permitted, { prepare: false, authorize: false, run: false, resumeRun: true });
          }
        }
      }
    }
  }
});

test("Resume rejects missing run evidence, conflicting paid controls, pending calls and terminal or inactive original states", () => {
  const cases: Array<{ label: string; value: MutableRecord }> = [];
  for (const status of ["absent", "preparing", "review", "authorized", "succeeded", "failed", "cancelled", "partial", "uncertain", "unavailable"]) {
    const value = mutable(resumable()); value.status = status; cases.push({ label: `state/${status}`, value });
  }
  for (const disposition of ["never_admitted", "prepared", "original_authorized"]) {
    const value = mutable(resumable()); value.disposition = disposition; cases.push({ label: `disposition/${disposition}`, value });
  }
  for (const run of [null, {}, { key: "", eventId: "event-run-original" }, { key: "run-original", eventId: "" }]) {
    const value = mutable(resumable()); value.original.run = run; cases.push({ label: "missing run evidence", value });
  }
  for (const status of ["authorized", "succeeded", "failed", "cancelled", "partial", "uncertain", "unavailable"]) {
    const slot = mutable(resumable()); slot.original.slotStatus = status; slot.grant.operations[0].status = status;
    cases.push({ label: `slot/${status}`, value: slot });
    const job = mutable(resumable()); job.original.jobStatus = status; cases.push({ label: `job/${status}`, value: job });
  }
  for (const status of ["completed", "revoked", "exceeded"]) {
    const value = mutable(resumable()); value.grant.status = status; value.original.grantStatus = status;
    cases.push({ label: `grant/${status}`, value });
  }
  for (const path of [["grant", "pendingCalls"], ["grant", "operations", "0", "pendingCalls"]]) {
    const value = mutable(resumable()); setPath(value, path, 1); cases.push({ label: path.join("."), value });
  }
  for (const action of ["prepare", "authorize", "run"] as const) {
    const value = mutable(resumable()); value.permitted[action] = true; cases.push({ label: action, value });
  }
  for (const permitted of [undefined, null, "true", 1]) {
    const value = mutable(resumable());
    if (permitted === undefined) delete value.permitted.resumeRun; else value.permitted.resumeRun = permitted;
    cases.push({ label: "required boolean permission", value });
  }
  for (const { label, value } of cases) assert.equal(decodeExperienceBinding(value, identity), null, label);
});

test("Resume remains explicit after GET and sends the original run endpoint and fixed original-grant body", async () => {
  const fake = transport([response(resumable()), response(resumable()), response(state("running"), basePath + "/run"), response(state("running"))]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  await client.read(); await client.read();
  assert.deepEqual(fake.calls.map(call => call.init.method), ["GET", "GET"]);
  const offered = shown(client); assert.equal(offered.permitted.resumeRun, true);
  await client.command("run", offered); await client.command("resumeRun", structuredClone(offered));
  assert.equal(fake.calls.length, 2);
  await client.command("resumeRun", offered);
  assert.equal(fake.calls[2].path, basePath + "/run"); assert.equal(fake.calls[2].init.method, "POST");
  assert.deepEqual(JSON.parse(String(fake.calls[2].init.body)), { draftHash: identity.draftHash, grantId: "grant-original", explicitRun: true });
  assert.equal(fake.calls[2].init.credentials, "same-origin"); assert.equal(fake.calls[2].init.cache, "no-store");
  assert.equal(fake.calls[2].init.redirect, "error");
  for (const key of ["grantId", "slotId", "jobId", "correlationId", "run", "authorization"] as const) {
    assert.deepEqual(shown(client).original![key], offered.original![key]);
  }
  await client.read(); await client.command("resumeRun", shown(client));
  assert.deepEqual(fake.calls.map(call => call.init.method), ["GET", "GET", "POST", "GET"]);
});

test("an unconfirmed Resume can only be reconsidered after passive original lookup and another explicit action", async () => {
  const fake = transport([response(resumable()), new Error("Synthetic lost Resume acknowledgment"), response(resumable()), response(state("running"), basePath + "/run")]);
  const client = new ExperienceOutputBindingClient(identity, { origin, current: () => true, request: fake.request });
  await client.read(); const offered = shown(client); await client.command("resumeRun", offered);
  assert.deepEqual(client.state, unavailableBinding("submission_unconfirmed")); assert.equal(client.pending, false);
  await client.command("resumeRun", offered); assert.equal(fake.calls.length, 2);
  await client.read(); const recovered = shown(client);
  assert.deepEqual(fake.calls.map(call => call.init.method), ["GET", "POST", "GET"]);
  for (const key of ["grantId", "slotId", "jobId", "correlationId", "run"] as const) assert.deepEqual(recovered.original![key], offered.original![key]);
  await client.command("resumeRun", recovered);
  assert.deepEqual(fake.calls.map(call => call.path), [basePath, basePath + "/run", basePath, basePath + "/run"]);
  assert.equal(fake.calls[1].init.body, fake.calls[3].init.body);
});

function recoverable():ExperienceNativeState {
  const value=state('failed');value.permitted.recoverResult=true;
  Object.assign(value.preflight!.targets[0],{provider:'fal',model:'ideogram/v4',route:'document-image-fal-manual-v1'});
  value.grant!.disclosure=structuredClone(value.preflight!);return value;
}
const videoIdentity={...identity,output:'video' as const,draftHash:'sha256:'+identity.draftHash,releaseHash:'sha256:'+identity.releaseHash};
async function recoverableVideo() {
  const {createVideoOutputContract}=await import('../src/model/output-video-contract.ts');
  const {VIDEO_ADAPTER_CONTRACT}=await import('../src/model/video-adapter.ts');
  const {VIDEO_READY_REASON,VIDEO_TRANSFER,readVideoExecutionOffer}=await import('../src/model/output-video-offer.ts');
  const {OUTPUT_VIDEO_EXECUTION_POLICY}=await import('../src/model/output-execution-policy.ts');
  const {documentRenderTokenReservation}=await import('../src/model/generation-budget.ts');
  const value=state('failed');Object.assign(value,videoIdentity);value.permitted.recoverResult=true;
  const sourceDigest='d'.repeat(64),requirementsDigest='e'.repeat(64),jobId='video-'+'f'.repeat(64);
  Object.assign(value.current,{sourceDigest,requirementsDigest});Object.assign(value.plan!,{sourceDigest,requirementsDigest});
  Object.assign(value.preflight!,{sourceDigest,requirementsDigest});Object.assign(value.original!,{sourceDigest,requirementsDigest,jobId});
  value.grant!.operations[0].jobId=jobId;
  const contract=createVideoOutputContract({source:{draftId:identity.draftId,draftHash:'sha256:'+identity.draftHash,
    releaseHash:'sha256:'+identity.releaseHash,requestHash:'sha256:'+'1'.repeat(64),sourceBindingHash:'sha256:'+'2'.repeat(64)},
    reference:{version:1,sourceProjectId:'source-project',sourceDocumentId:'source-document',sourceBlockId:'source-block',
      referenceId:'source-reference',sha256:'3'.repeat(64),permissionAttestation:'i-own-or-have-permission'},frameSize:'1280x720'});
  assert.ok(contract);
  const mediaMaximum=4*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd['480p'],maximumMicrousd=mediaMaximum+10000;
  const target={targetId:value.plan!.targetId,available:true,reasonCode:'output_video_ready',reason:VIDEO_READY_REASON,
    transferCode:'output_transfer_video_after_authorization',transferDescription:VIDEO_TRANSFER,provider:'fal',model:VIDEO_ADAPTER_CONTRACT.model,
    route:'document-video-owned-still-four-seconds-manual-v1',maximumMicrousd,maximumCalls:2,maximumTokens:documentRenderTokenReservation('video',1,1),
    settings:{kind:'render_document',preparationOnly:false,executionAvailable:true,explicitCostAndTransferApprovalRequired:true,
      executionPolicy:OUTPUT_VIDEO_EXECUTION_POLICY,videoPricingVersion:`forma.video.fal-480p-transport@1:${VIDEO_ADAPTER_CONTRACT.adapterVersion}:${VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd['480p']}`,
      original:{requestId:jobId,expiresAt:value.original!.expiresAt,draftId:identity.draftId,actorUserId:identity.actorUserId,
        projectId:identity.projectId,documentId:identity.documentId,sourceDigest,requirementsDigest},
      payload:{artifactKind:'video',productionMode:'manual',itemCount:1,outputVideo:contract,
        outputVideoPlanner:{contract,requestDigest:'4'.repeat(64),maximumInputTokens:4096},videoSeconds:4,videoSize:'1280x720',videoResolution:'480p',videoAudioMode:'silent',
        outputTargetInstructions:'Slow camera push toward the teapot.',paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true},
      calls:[{stage:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',maximumMicrousd:10000,maximumInputTokens:4096,maximumOutputTokens:3000},
        {stage:'video:initial',provider:'fal',model:VIDEO_ADAPTER_CONTRACT.model,maximumMicrousd:mediaMaximum,maximumInputTokens:0,maximumOutputTokens:0}]}};
  assert.ok(readVideoExecutionOffer(target));
  value.preflight!.targets=[target];
  for(const row of [value.preflight!,value.grant!,value.grant!.operations[0]]) Object.assign(row,{maximumMicrousd,maximumCalls:2});
  value.grant!.disclosure=structuredClone(value.preflight!);
  return value;
}
test('Video recovery accepts the closed original offer and sends only explicit original-result recovery',async()=>{
  const value=await recoverableVideo();
  assert.ok(decodeExperienceBinding(value,videoIdentity));
  const path=basePath+'/recover-result',fake=transport([response(value),response({...value,recovery:'pending'},path)]);
  const client=new ExperienceOutputBindingClient(videoIdentity,{origin,current:()=>true,request:fake.request});
  await client.read();const original=shown(client);
  await client.command('run',original);await client.command('resumeRun',original);assert.equal(fake.calls.length,1);
  await client.command('recoverResult',original);
  assert.deepEqual(fake.calls.map(c=>[c.path,c.init.method]),[[basePath,'GET'],[path,'POST']]);
  assert.deepEqual(JSON.parse(String(fake.calls[1].init.body)),{draftHash:videoIdentity.draftHash,grantId:value.original!.grantId,jobId:value.original!.jobId,explicitRecovery:true});
  assert.equal(shown(client).recovery,'pending');
});
test('Video recovery refuses changed provider policy and preserves completed recovery without authorizing generation',async()=>{
  const value=await recoverableVideo();
  for(const patch of [{provider:'other'},{model:'other'},{route:'document-image-fal-manual-v1'},{maximumCalls:3}]){
    const bad=structuredClone(value);Object.assign(bad.preflight!.targets[0],patch);bad.grant!.disclosure=structuredClone(bad.preflight!);
    assert.equal(decodeExperienceBinding(bad,videoIdentity),null);
  }
  const missing=structuredClone(value);delete missing.preflight!.targets[0].settings;missing.grant!.disclosure=structuredClone(missing.preflight!);
  assert.equal(decodeExperienceBinding(missing,videoIdentity),null);
  for(const patch of [{requestId:'video-'+'0'.repeat(64)},{actorUserId:'different-owner'},{projectId:'different-project'},
    {documentId:'different-document'},{sourceDigest:'0'.repeat(64)},{requirementsDigest:'0'.repeat(64)}]) {
    const bad=structuredClone(value),settings=bad.preflight!.targets[0].settings as {original:Record<string,unknown>};
    Object.assign(settings.original,patch);bad.grant!.disclosure=structuredClone(bad.preflight!);
    assert.equal(decodeExperienceBinding(bad,videoIdentity),null);
  }
  for(const field of ['draftHash','releaseHash']) {
    const bad=structuredClone(value),settings=bad.preflight!.targets[0].settings as {payload:{outputVideo:{source:Record<string,unknown>};outputVideoPlanner:{contract:unknown}}};
    settings.payload.outputVideo.source[field]='sha256:'+'0'.repeat(64);
    settings.payload.outputVideoPlanner.contract=structuredClone(settings.payload.outputVideo);
    bad.grant!.disclosure=structuredClone(bad.preflight!);assert.equal(decodeExperienceBinding(bad,videoIdentity),null);
  }
  // This synthetic quote is already expired; reading recovery is not new spending authority.
  assert.ok(Date.parse(value.original!.expiresAt)<Date.now());assert.ok(decodeExperienceBinding(value,videoIdentity));
  value.status='succeeded';value.recovery='completed';value.permitted.recoverResult=false;
  value.original!.jobStatus='completed';value.original!.slotStatus='succeeded';value.original!.grantStatus='completed';
  value.grant!.status='completed';value.grant!.operations[0].status='succeeded';
  assert.ok(decodeExperienceBinding(value,videoIdentity));
  assert.equal(value.permitted.run,false);assert.equal(value.permitted.resumeRun,false);
  const widened=structuredClone(value);widened.permitted.run=true;assert.equal(decodeExperienceBinding(widened,videoIdentity),null);
});
test('Audio original recovery decodes exact native terms and cannot fall back to paid Run',async()=>{
  const {createAudioOutputContract}=await import('../src/model/output-audio-contract.ts');
  const value=state('failed');value.output='audio';value.permitted.recoverResult=true;
  const audioIdentity={...identity,output:'audio' as const},sourceDigest='d'.repeat(64),requirementsDigest='e'.repeat(64),jobId='audio-'+'f'.repeat(64);
  Object.assign(value.current,{sourceDigest,requirementsDigest});Object.assign(value.plan!,{sourceDigest,requirementsDigest});
  Object.assign(value.preflight!,{sourceDigest,requirementsDigest});Object.assign(value.original!,{sourceDigest,requirementsDigest,jobId});value.grant!.operations[0].jobId=jobId;
  const contract=createAudioOutputContract({draftId:identity.draftId,draftHash:'sha256:'+identity.draftHash,releaseHash:'sha256:'+identity.releaseHash,requestHash:'sha256:'+'1'.repeat(64),sourceBindingHash:'sha256:'+'2'.repeat(64)});
  Object.assign(value.preflight!.targets[0],{provider:'fal',model:'fal-ai/stable-audio-3/medium/text-to-audio',route:'document-audio-timed-music-manual-v1',settings:{payload:{outputAudio:contract}}});
  value.grant!.disclosure=structuredClone(value.preflight!);
  value.audioCostPreview={version:'audio-mini-app-cost-v1',requestId:jobId,actorUserId:identity.actorUserId,projectId:identity.projectId,documentId:identity.documentId,draftId:identity.draftId,sourceDigest,requirementsDigest,expiresAt:value.original!.expiresAt,maximumMicrousd:1037600,maximumCalls:3,maximumTokens:128000,planningModel:'gpt-5.6-terra',maximumPlanningCalls:2,maximumOutputTokens:3000,audioModel:'fal-ai/stable-audio-3/medium/text-to-audio',maximumAudioCalls:1,durationSeconds:20,requireInstrumental:true,sourceFilesTransferred:0};
  assert.ok(decodeExperienceBinding(value,audioIdentity));
  for(const route of ['other','document-image-fal-manual-v1']){const bad=structuredClone(value);bad.preflight!.targets[0].route=route;bad.grant!.disclosure=structuredClone(bad.preflight!);assert.equal(decodeExperienceBinding(bad,audioIdentity),null);}
  const missing=structuredClone(value);missing.audioCostPreview=null;assert.equal(decodeExperienceBinding(missing,audioIdentity),null);
  const path=basePath+'/recover-result',fake=transport([response(value),response({...value,recovery:'pending'},path)]);
  const client=new ExperienceOutputBindingClient(audioIdentity,{origin,current:()=>true,request:fake.request});
  await client.read();const offered=shown(client);await client.command('run',offered);await client.command('resumeRun',offered);assert.equal(fake.calls.length,1);
  await client.command('recoverResult',offered);assert.deepEqual(fake.calls.map(c=>[c.path,c.init.method]),[[basePath,'GET'],[path,'POST']]);
  assert.equal(JSON.parse(String(fake.calls[1].init.body)).jobId,jobId);
});
test('recovery transport uses only its explicit original-job endpoint; passive GET and paid Run stay separate',async()=>{
  const value=recoverable(),path=basePath+'/recover-result',fake=transport([response(value),response({...value,recovery:'pending'},path)]);
  const client=new ExperienceOutputBindingClient(identity,{origin,current:()=>true,request:fake.request});
  await client.read();assert.equal(fake.calls.length,1);assert.equal(fake.calls[0].init.method,'GET');
  const original=shown(client);await client.command('run',original);assert.equal(fake.calls.length,1);
  await client.command('recoverResult',original);assert.equal(fake.calls.length,2);
  assert.equal(fake.calls[1].path,path);assert.equal(fake.calls[1].init.method,'POST');
  assert.deepEqual(JSON.parse(String(fake.calls[1].init.body)),{draftHash:identity.draftHash,grantId:value.original!.grantId,jobId:value.original!.jobId,explicitRecovery:true});
  assert.equal(shown(client).recovery,'pending');
});
test('recovery transport rejects widened permissions, revoked grants and unsupported output routes',()=>{
  const value=recoverable();assert.ok(decodeExperienceBinding(value,identity));
  for(const change of [(v:MutableRecord)=>{v.permitted.run=true;},(v:MutableRecord)=>{v.original.jobStatus='running';},
    (v:MutableRecord)=>{v.permitted.recoverResult='yes';},(v:MutableRecord)=>{v.grant.status='revoked';v.original.grantStatus='revoked';},
    (v:MutableRecord)=>{v.preflight.targets[0].provider='other';v.grant.disclosure=structuredClone(v.preflight);},
    (v:MutableRecord)=>{v.recovery='completed';}]){const modified=mutable(value);change(modified);assert.equal(decodeExperienceBinding(modified,identity),null);}
  assert.equal(decodeExperienceBinding({...unavailableBinding(),permitted:{...denied(),recoverResult:true}},identity),null);
});
test('unknown recovery response remains unknown and never retries or falls back to paid generation',async()=>{
  const fake=transport([response(recoverable()),new Error('response_lost')]),client=new ExperienceOutputBindingClient(identity,{origin,current:()=>true,request:fake.request});
  await client.read();const original=shown(client);await client.command('recoverResult',original);
  assert.equal(client.state.status,'unavailable');assert.equal(fake.calls.length,2);
  await client.command('recoverResult',original);assert.equal(fake.calls.length,2);
  assert.equal(fake.calls.filter(call=>call.path.endsWith('/run')).length,0);
});

test('verified completed recovery retains its result after spending permission expires',()=>{
  const value=recoverable(),now=Date.parse('2026-09-13T00:00:00.000Z');
  value.status='succeeded';value.recovery='completed';value.permitted.recoverResult=false;
  value.original!.jobStatus='completed';value.original!.slotStatus='succeeded';value.original!.grantStatus='completed';value.original!.jobExpiresAt='2026-09-14T00:00:00.000Z';
  value.grant!.status='completed';value.grant!.operations[0].status='succeeded';
  assert.ok(decodeExperienceBinding(value,identity));assert.equal(experienceResultGrantCurrent(value,now),true);
  assert.equal(value.permitted.run,false);assert.equal(value.permitted.resumeRun,false);
  assert.equal(experienceResultGrantCurrent({...value,recovery:undefined},now),true);
  const expired=structuredClone(value);expired.original!.jobExpiresAt='2026-09-12T00:00:00.000Z';assert.equal(experienceResultGrantCurrent(expired,now),false);
  const revoked=structuredClone(value);revoked.grant!.status='revoked';revoked.original!.grantStatus='revoked';revoked.original!.expiresAt='2026-09-14T00:00:00.000Z';revoked.grant!.expiresAt=revoked.original!.expiresAt;assert.equal(experienceResultGrantCurrent(revoked,now),false);assert.equal(decodeExperienceBinding(revoked,identity),null);
});

const retainedNow = Date.parse("2026-09-13T00:00:00.000Z");
// Synthetic policy/transport controls only; these records prove no real admission.
function retainedCompleted(output: ExperienceBindingIdentity["output"]): ExperienceNativeState {
  const value = state("succeeded");
  value.output = output;
  Object.assign(value.original!, { jobStatus: "completed", slotStatus: "succeeded", grantStatus: "completed",
    jobExpiresAt: "2026-09-14T00:00:00.000Z" });
  value.grant!.status = "completed";
  value.grant!.pendingCalls = 0;
  value.grant!.operations[0].status = "succeeded";
  value.grant!.operations[0].pendingCalls = 0;
  if (output === "scene") value.sceneCostPreview = {
    version: "scene-mini-app-cost-v1", requestId: value.original!.jobId, actorUserId: identity.actorUserId,
    projectId: identity.projectId, documentId: identity.documentId, contextSessionId: null, permissionEpoch: "epoch-original",
    period: "2026-09", requestHash: "a".repeat(64), sourceHash: "b".repeat(64), bindingHash: "c".repeat(64),
    provider: "openai", model: "gpt-5.6-terra", sceneMedium: "visual", productionMode: "manual", itemCount: 1,
    reusedSourceCount: 0, providerCallCount: 1, maximumProviderCallCount: 1, maximumMicrousd: 1_000_000,
    maximumInputTokens: 4096, maximumOutputTokens: 3000, maximumTokens: 128000,
    sceneContractDigest: "sha256:" + "d".repeat(64), executionContractDigest: "sha256:" + "e".repeat(64),
    expiresAt: value.original!.expiresAt,
  };
  return value;
}

for (const output of ["image", "slides", "short_story", "scene"] as const) {
  test(output + ": completed original result outlives spending expiry without creating execution permission", async () => {
    const value = retainedCompleted(output), selectedIdentity = { ...identity, output };
    assert.equal(value.recovery, undefined);
    assert.ok(decodeExperienceBinding(value, selectedIdentity));
    assert.equal(experienceResultGrantCurrent(value, retainedNow), true);
    assert.equal(experienceResultGrantCurrent(value, Date.parse(value.original!.expiresAt)), true);
    assert.equal(experienceResultGrantCurrent(value, Date.parse(value.original!.jobExpiresAt)), false);
    const before = structuredClone(value);
    const fake = transport([response(value)]), client = new ExperienceOutputBindingClient(selectedIdentity, {
      origin, current: () => true, request: fake.request,
    });
    await client.read();
    const original = shown(client);
    for (const action of ["prepare", "authorize", "run", "resumeRun", "recoverResult"] as const) {
      await client.command(action, original);
    }
    assert.deepEqual(fake.calls.map(call => [call.path, call.init.method]), [[basePath, "GET"]]);
    assert.deepEqual(value, before);
    assert.deepEqual(original.original, before.original);
    assert.deepEqual(original.grant, before.grant);
    assert.deepEqual(original.permitted, denied());
  });

  test(output + ": retained reading rejects incomplete, inconsistent, expired or widened states", () => {
    const cases: Array<[string, (v: MutableRecord) => void]> = [
      ...["authorized", "queued", "running", "failed", "cancelled", "partial", "uncertain", "unavailable"].map(
        status => [status, (v: MutableRecord) => { v.status = status; }] as [string, (v: MutableRecord) => void]),
      ["missing original", v => { setPath(v, ["original"], null); }],
      ["missing grant", v => { setPath(v, ["grant"], null); }],
      ["unrecorded disposition", v => { v.disposition = "original_authorized"; }],
      ["missing run", v => { v.original.run = null; }],
      ["invalid run", v => { v.original.run = { key: "", eventId: "" }; }],
      ["running job", v => { v.original.jobStatus = "running"; }],
      ["failed slot", v => { v.original.slotStatus = "failed"; }],
      ["inconsistent original grant", v => { v.original.grantStatus = "revoked"; }],
      ...["authorized", "active", "revoked", "exceeded"].map(
        status => ["grant " + status, (v: MutableRecord) => { v.grant.status = status; v.original.grantStatus = status; }] as [string, (v: MutableRecord) => void]),
      ["expired job", v => { v.original.jobExpiresAt = new Date(retainedNow - 1).toISOString(); }],
      ["exact job deadline", v => { v.original.jobExpiresAt = new Date(retainedNow).toISOString(); }],
      ["invalid job deadline", v => { v.original.jobExpiresAt = "invalid"; }],
      ["invalid spending deadline", v => { v.original.expiresAt = "invalid"; }],
      ...["prepare", "authorize", "run", "resumeRun", "recoverResult"].map(
        action => ["permission " + action, (v: MutableRecord) => { v.permitted[action] = true; }] as [string, (v: MutableRecord) => void]),
    ];
    for (const [label, change] of cases) {
      const value = retainedCompleted(output); change(value as unknown as MutableRecord);
      assert.equal(experienceResultGrantCurrent(value, retainedNow), false, label);
    }
    assert.equal(experienceResultGrantCurrent(retainedCompleted(output), NaN), false);
    const revoked = retainedCompleted(output);
    revoked.grant!.status = "revoked"; revoked.original!.grantStatus = "revoked";
    revoked.original!.expiresAt = "2026-09-14T00:00:00.000Z";
    assert.equal(experienceResultGrantCurrent(revoked, retainedNow), false);
  });

  test(output + ": completed-result allowance preserves decoded original identity and source joins", () => {
    const selectedIdentity = { ...identity, output };
    for (const change of [
      (v: MutableRecord) => { v.documentId = "foreign-document"; },
      (v: MutableRecord) => { v.projectId = "foreign-project"; },
      (v: MutableRecord) => { v.draftHash = "foreign-draft"; },
      (v: MutableRecord) => { v.releaseHash = "foreign-release"; },
      (v: MutableRecord) => { v.grant.actorUserId = "foreign-actor"; },
      (v: MutableRecord) => { v.current.sourceDigest = "changed-source"; },
      (v: MutableRecord) => { v.current.requirementsDigest = "changed-requirements"; },
      (v: MutableRecord) => { v.original.jobId = "foreign-job"; },
      (v: MutableRecord) => { v.original.slotId = "foreign-slot"; },
      (v: MutableRecord) => { v.original.targetContractDigest = "changed-contract"; },
    ]) {
      const value = retainedCompleted(output); change(value as unknown as MutableRecord);
      assert.equal(decodeExperienceBinding(value, selectedIdentity), null);
    }
  });
}

// Append to tests/experience-output-binding-client.test.ts.
test('Video status GET survives old header and host cutoffs without retry or POST',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 const videoIdentity={...identity,output:'video' as const};let finish!:(value:Response)=>void;
 const fake=transport([()=>new Promise<Response>(resolve=>{finish=resolve;})]);
 const client=new ExperienceOutputBindingClient(videoIdentity,{origin,current:()=>true,request:fake.request});
 const host=new ExperienceHostOperation(()=>client.dispose(),undefined,{action:'inspectResult',output:'video'});
 const pending=host.wait(client.read());
 context.mock.timers.tick(45000);assert.equal(host.current(),true);assert.equal(client.pending,true);assert.equal(fake.calls[0].init.signal!.aborted,false);
 await client.read();assert.equal(fake.calls.length,1);
 finish(response({...state('absent'),output:'video'}));assert.equal((await pending).status,'absent');host.finish();
 assert.deepEqual(fake.calls.map(call=>call.init.method),['GET']);
});
test('Video status GET header deadline stays finite and late reply cannot revive state',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});let finish!:(value:Response)=>void;
 const fake=transport([()=>new Promise<Response>(resolve=>{finish=resolve;})]);
 const client=new ExperienceOutputBindingClient({...identity,output:'video'},{origin,current:()=>true,request:fake.request});
 const pending=client.read();context.mock.timers.tick(59999);assert.equal(fake.calls[0].init.signal!.aborted,false);
 context.mock.timers.tick(1);await pending;assert.equal(fake.calls[0].init.signal!.aborted,true);assert.deepEqual(client.state,unavailableBinding('original_unavailable'));
 finish(response({...state('absent'),output:'video'}));await new Promise<void>(resolve=>setImmediate(resolve));
 assert.deepEqual(client.state,unavailableBinding('original_unavailable'));assert.equal(fake.calls.length,1);
});
test('Video status response body retains one nonrenewing twenty-second limit',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});let finish!:(value:Response)=>void,next!:(value:ReadableStreamReadResult<Uint8Array>)=>void;
 const fake=transport([()=>new Promise<Response>(resolve=>{finish=resolve;})]);
 const client=new ExperienceOutputBindingClient({...identity,output:'video'},{origin,current:()=>true,request:fake.request});
 const pending=client.read();context.mock.timers.tick(45000);const reply=response({...state('absent'),output:'video'});
 Object.defineProperty(reply.body,'getReader',{value:()=>({read:()=>new Promise<ReadableStreamReadResult<Uint8Array>>(resolve=>{next=resolve;}),cancel:async()=>{}})});
 finish(reply);await new Promise<void>(resolve=>setImmediate(resolve));context.mock.timers.tick(19000);next({done:false,value:new Uint8Array([32])});
 await new Promise<void>(resolve=>setImmediate(resolve));context.mock.timers.tick(1000);await pending;
 assert.equal(fake.calls[0].init.signal!.aborted,true);assert.deepEqual(client.state,unavailableBinding('original_unavailable'));assert.equal(fake.calls.length,1);
});
for(const reason of ['cancel','source-retire'])test(`Video longer read remains immediately withdrawable on ${reason}`,async context=>{
 context.mock.timers.enable({apis:['setTimeout']});let finish!:(value:Response)=>void,current=true;
 const fake=transport([()=>new Promise<Response>(resolve=>{finish=resolve;})]);
 const client=new ExperienceOutputBindingClient({...identity,output:'video'},{origin,current:()=>current,request:fake.request});
 const host=new ExperienceHostOperation(()=>client.dispose(),undefined,{action:'inspectResult',output:'video'});
 const pending=host.wait(client.read()),rejected=assert.rejects(pending,/operation_withdrawn/);
 context.mock.timers.tick(31000);if(reason==='source-retire')current=false;
 host.cancel();client.dispose();await rejected;
 assert.equal(fake.calls[0].init.signal!.aborted,true);assert.equal(client.pending,false);assert.deepEqual(client.state,unavailableBinding('withdrawn'));
 finish(response({...state('absent'),output:'video'}));await new Promise<void>(resolve=>setImmediate(resolve));
 context.mock.timers.tick(110000);assert.equal(host.current(),false);assert.deepEqual(client.state,unavailableBinding('withdrawn'));assert.equal(fake.calls.length,1);
});
test('Video read host remains bounded at110s and unknown actions retain generic limits',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 for(const action of ['read','inspectResult']){
  assert.equal(experienceHostTimeout({action,output:'video'}),110000);
  let timeouts=0;const host=new ExperienceHostOperation(()=>timeouts++,undefined,{action,output:'video'});
  const waiting=assert.rejects(host.wait(new Promise<never>(()=>{})),/operation_unconfirmed/);
  context.mock.timers.tick(109999);assert.equal(host.current(),true);context.mock.timers.tick(1);await waiting;assert.equal(timeouts,1);
 }
 assert.equal(experienceResponseTimeout({action:'read',output:'video'}),60000);
 assert.equal(experienceResponseTimeout({action:'unknown',output:'video'}),20000);
 assert.equal(experienceHostTimeout({action:'unknown',output:'video'}),30000);
 assert.equal(experienceResponseTimeout(),20000);assert.equal(experienceHostTimeout(),30000);
});
