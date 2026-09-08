// Detached SOURCE-ONLY candidate. Synthetic HTTP only; not browser/native Worker/D1/provider or rollout qualification.
import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentProfileClient, DocumentProfileClientError, DOCUMENT_PROFILE_CONTROL_VERSION as VERSION,
  DOCUMENT_PROFILE_POLICY as POLICY, NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE as RECIPE } from "../src/state/document-profile-client.ts";

const T = Date.parse("2026-09-04T12:00:00.000Z"), DAY = 86_400_000;
const iso = value => new Date(value).toISOString(), hash = value => value.toString(16).padStart(64, "0");
const org = () => ({ kind: "organization", organizationId: "organization", projectAccessId: "access", ownerUserId: "owner" });
const parent = (overrides = {}) => ({ enrollmentId: hash(1), enrollmentRevision: 2, expiresAt: iso(T + 30 * DAY), retentionDays: 30, ...overrides });
const scope = (overrides = {}) => ({ projectId: "project", documentId: "document", expectedCustody: org(), expectedParent: parent(), ...overrides });
const grant = (overrides = {}) => ({ grantId: hash(2), revision: 3, organizationId: "organization", projectAccessId: "access", ownerUserId: "owner",
  projectId: "project", documentId: "document", enrollmentId: hash(1), enrollmentRevision: 2, policyVersion: POLICY, recipeVersion: RECIPE,
  infer: true, inspect: true, background: false, sourceAfterSequence: 10, consentedAt: iso(T - DAY), expiresAt: iso(T + 30 * DAY), retentionDays: 30,
  revokedAt: null, ...overrides });
const settings = (overrides = {}) => ({ version: VERSION, enabled: true, policyVersion: POLICY, recipeVersion: RECIPE,
  purpose: "authored-palette-organization", backgroundSupported: false,
  scope: { projectId: "project", documentId: "document", custody: org() }, parent: parent(), grant: grant(), grantCurrent: true, ...overrides });
const draft = (overrides = {}) => ({ version: VERSION, policyVersion: POLICY, recipeVersion: RECIPE, projectId: "project", documentId: "document",
  enrollmentId: hash(1), enrollmentRevision: 2, revision: 3, expectedCustody: org(), infer: true, inspect: true, background: false,
  retentionDays: 30, expiresAt: iso(T + 30 * DAY), confirmation: "ENABLE_DOCUMENT_PALETTE_PROFILE", ...overrides });
const enabled = (overrides = {}) => ({ version: VERSION, grant: grant({ revision: 4, consentedAt: iso(T) }), historyStartsAfterSequence: 10, ...overrides });
const revoked = (overrides = {}) => ({ version: VERSION, revoked: true, grantId: hash(2), revision: 4, reEnrollmentRequired: true, ...overrides });
const suppressed = (overrides = {}) => ({ version: VERSION, suppression: { grantId: hash(2), grantRevision: 3, claimKey: hash(3), revision: 1,
  state: "active", createdAt: iso(T), expiresAt: iso(T + 30 * DAY) }, ...overrides });
const profile = (overrides = {}) => ({ version: RECIPE, treatment: "document-authored-palette-choices", inferredPreferences: false,
  independentEvidence: false, scope: { organizationId: "organization", projectAccessId: "access", projectId: "project", documentId: "document" },
  grant: { id: hash(2), revision: 3 }, lifetime: { checkedAt: iso(T), validUntil: iso(T + 60_000) },
  coverage: { bounded: true, completeHistory: false, blockLimit: 16, sourceLimit: 128, selectedBlockCount: 1, eligibleChoiceCount: 1 },
  choices: [{ claimKey: hash(3), colors: ["#123456", "#abcdef"], status: "supported", supports: [{ blockId: "block", intent: "prefer",
    lineage: "unknown", independentEvidence: false, sources: [{ eventId: "event", sequence: 11, type: "BlockCreated", recordedAt: iso(T - 1000) }] }],
  counterevidence: [] }], ...overrides });
const inspected = value => ({ version: VERSION, profile: value ?? profile() });
function fake(respond, clock = () => ({ monotonic: 100, wall: T })) {
  const calls = [], client = createDocumentProfileClient(async (url, init) => { calls.push({ url, init }); return respond(url, init); }, clock);
  return { client, calls };
}
const errorIs = (code, unknown = false, status) => error => {
  assert.ok(error instanceof DocumentProfileClientError); assert.equal(error.code, code); assert.equal(error.mutationUnknown, unknown);
  if (status !== undefined) assert.equal(error.status, status); assert.ok(!error.message.includes("PRIVATE")); return true;
};
function privateRequest(call, method, signal) {
  assert.equal(call.init.method, method); assert.equal(call.init.credentials, "same-origin"); assert.equal(call.init.mode, "same-origin");
  assert.equal(call.init.cache, "no-store"); assert.equal(call.init.redirect, "error"); assert.equal(call.init.signal, signal);
  assert.equal(call.init.headers.accept, "application/json");
}
const methods = [
  ["settings", client => client.settings(scope()), () => settings(), false],
  ["enable", client => client.enable(draft()), () => enabled(), true],
  ["revoke", client => client.revoke(grant()), () => revoked(), true],
  ["inspect", client => client.inspect(grant()), () => inspected(), false],
  ["suppress", client => client.suppress(grant(), hash(3), 0), () => suppressed(), true],
];

test("isolated client construction has no side effects; settings is an exact private fresh scoped read", async () => {
  const signal = new AbortController().signal, body = settings(), { client, calls } = fake(() => Response.json(body));
  assert.equal(calls.length, 0); const result = await client.settings(scope(), signal);
  assert.deepEqual(result, body); assert.notEqual(result, body); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/memory/document-profile/settings?projectId=project&documentId=document");
  privateRequest(calls[0], "GET", signal); assert.equal(calls[0].init.body, undefined);
});

test("isolated settings binds exact project document custody and selected parent snapshots", async () => {
  const corruptions = [body => { body.scope.projectId = "other"; }, body => { body.scope.documentId = "other"; },
    ...["organizationId", "projectAccessId", "ownerUserId"].map(key => body => { body.scope.custody[key] = "other"; }),
    ...["enrollmentId", "enrollmentRevision", "expiresAt", "retentionDays"].map(key => body => {
      body.parent[key] = typeof body.parent[key] === "number" ? body.parent[key] + 1 : key === "expiresAt" ? iso(T + 31 * DAY) : hash(9);
    }), body => { body.parent = null; }, body => { body.scope.custody = { kind: "personal" }; }];
  for (const corrupt of corruptions) {
    const body = settings(); corrupt(body);
    await assert.rejects(fake(() => Response.json(body)).client.settings(scope()), errorIs("document_profile_response_invalid", false, 200));
  }
  const body = settings({ enabled: false, parent: null, grant: null, grantCurrent: false });
  assert.deepEqual(await fake(() => Response.json(body)).client.settings(scope({ expectedParent: null })), body);
});

test("isolated settings validates grant currentness without rewriting retained grant metadata", async () => {
  const retained = grant({ enrollmentRevision: 1, expiresAt: iso(T + 90 * DAY), retentionDays: 90 });
  for (const selectedParent of [parent(), null]) {
    const body = settings({ enabled: false, parent: selectedParent, grant: retained, grantCurrent: false });
    const { client, calls } = fake(url => Response.json(url.includes("grantId=") ? revoked() : body));
    const result = await client.settings(scope({ expectedParent: selectedParent }));
    assert.deepEqual(result.grant, retained); assert.equal(result.grant.infer, true); assert.equal(result.grantCurrent, false);
    await assert.rejects(client.inspect(result.grant), errorIs("invalid_document_profile_request"));
    await assert.rejects(client.suppress(result.grant, hash(3), 0), errorIs("invalid_document_profile_request"));
    assert.deepEqual(await client.revoke(result.grant), revoked()); assert.equal(calls.length, 2);
  }
  const corruptions = [body => { body.enabled = false; }, body => { body.parent = null; }, body => { body.grant = null; },
    body => { body.grant.enrollmentRevision = 1; }, body => { body.grant.infer = false; }, body => { body.grant.inspect = false; },
    body => { body.grant.expiresAt = iso(T + 31 * DAY); }, body => { body.grant.retentionDays = 31; },
    body => { body.grant.revokedAt = iso(T); }, body => { body.grant.consentedAt = iso(T + 1); }, body => { body.grant.expiresAt = iso(T); }];
  for (const corrupt of corruptions) {
    const body = settings(); corrupt(body);
    await assert.rejects(fake(() => Response.json(body)).client.settings(scope()), errorIs("document_profile_response_invalid", false, 200));
  }
  for (const changes of [{ enrollmentId: hash(9) }, { enrollmentRevision: 3 }, { projectId: "other" }, { documentId: "other" },
    { organizationId: "other" }, { projectAccessId: "other" }, { ownerUserId: "other" }]) {
    await assert.rejects(fake(() => Response.json(settings({ grant: grant(changes), grantCurrent: false }))).client.settings(scope()),
      errorIs("document_profile_response_invalid", false, 200));
  }
});

test("isolated control contracts reject missing extra present-malformed and wrong-version fields", async () => {
  for (const [name, invoke, response, mutation] of methods) {
    for (const key of Object.keys(response())) {
      const missing = response(); delete missing[key];
      await assert.rejects(invoke(fake(() => Response.json(missing)).client), errorIs("document_profile_response_invalid", mutation, 200), name + " missing " + key);
      for (const value of [null, [], {}]) {
        const body = response(); if (body[key] === null) continue; body[key] = value;
        await assert.rejects(invoke(fake(() => Response.json(body)).client), errorIs("document_profile_response_invalid", mutation, 200), name + " malformed " + key);
      }
    }
    for (const changes of [{ extra: true }, { version: "future-contract" }]) {
      await assert.rejects(invoke(fake(() => Response.json({ ...response(), ...changes })).client), errorIs("document_profile_response_invalid", mutation, 200));
    }
  }
  for (const path of ["scope", "scope.custody", "parent", "grant"]) {
    const body = settings(); path.split(".").reduce((row, key) => row[key], body).extra = false;
    await assert.rejects(fake(() => Response.json(body)).client.settings(scope()), errorIs("document_profile_response_invalid", false, 200));
  }
});

test("isolated request capture rejects accessors symbols prototypes and present undefined without invoking getters", async () => {
  for (const [value, invoke] of [[scope(), (client, item) => client.settings(item)], [draft(), (client, item) => client.enable(item)],
    [grant(), (client, item) => client.revoke(item)], [grant(), (client, item) => client.inspect(item)]]) {
    for (const key of Object.keys(value)) {
      const item = { ...value }; let reads = 0;
      Object.defineProperty(item, key, { enumerable: true, get() { reads += 1; return value[key]; } });
      const { client, calls } = fake(() => { throw new Error("PRIVATE SHOULD NOT CALL"); });
      await assert.rejects(invoke(client, item), errorIs("invalid_document_profile_request"));
      assert.equal(reads, 0); assert.equal(calls.length, 0);
    }
    for (const item of [Object.assign(Object.create({ inherited: true }), value), { ...value, [Symbol("extra")]: false }, { ...value, extra: undefined }]) {
      const { client, calls } = fake(() => { throw new Error("PRIVATE SHOULD NOT CALL"); });
      await assert.rejects(invoke(client, item), errorIs("invalid_document_profile_request")); assert.equal(calls.length, 0);
    }
  }
  for (const value of [undefined, false, [], {}, { ...parent(), expiresAt: undefined }]) {
    await assert.rejects(fake(() => Response.json(settings())).client.settings(scope({ expectedParent: value })), errorIs("invalid_document_profile_request"));
  }
});

test("isolated every grant field is mandatory and malformed identities flags revisions and dates fail closed", async () => {
  for (const key of Object.keys(grant())) {
    const body = settings(); delete body.grant[key];
    await assert.rejects(fake(() => Response.json(body)).client.settings(scope()), errorIs("document_profile_response_invalid", false, 200));
  }
  const corruptions = [{ ownerUserId: "" }, { organizationId: null }, { projectAccessId: null }, { grantId: " with-space " },
    { grantId: "a\u0000b" }, { grantId: "x".repeat(241) }, { revision: 0 }, { revision: 1.5 }, { enrollmentRevision: "2" },
    { sourceAfterSequence: -1 }, { sourceAfterSequence: Number.MAX_SAFE_INTEGER + 1 }, { infer: 1 }, { inspect: "true" },
    { background: null }, { retentionDays: 366 }, { expiresAt: "2026-10-04T12:00:00Z" }, { consentedAt: "2026-02-30T12:00:00.000Z" },
    { revokedAt: false }, { policyVersion: "personal-memory-v2" }, { recipeVersion: "other" }];
  for (const changes of corruptions) {
    const body = settings({ grant: grant(changes), grantCurrent: false });
    await assert.rejects(fake(() => Response.json(body)).client.settings(scope()), errorIs("document_profile_response_invalid", false, 200));
  }
  const personalGrant = grant({ organizationId: null, projectAccessId: null, ownerUserId: "personal-owner" });
  const body = settings({ scope: { projectId: "project", documentId: "document", custody: { kind: "personal" } }, grant: personalGrant });
  assert.deepEqual(await fake(() => Response.json(body)).client.settings(scope({ expectedCustody: { kind: "personal" } })), body);
});

test("isolated enable sends only caller's explicit separate consent, exact parent and custody", async () => {
  const item = draft(), signal = new AbortController().signal, { client, calls } = fake(() => Response.json(enabled()));
  assert.deepEqual(await client.enable(item, signal), enabled()); privateRequest(calls[0], "PUT", signal);
  assert.equal(calls[0].url, "/api/memory/document-profile/settings"); assert.deepEqual(JSON.parse(calls[0].init.body), item);
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  for (const changes of [{ infer: false }, { inspect: false }, { background: true }, { expectedCustody: undefined }, { confirmation: "ENABLE_PERSONAL_MEMORY" },
    { policyVersion: "personal-memory-v2" }, { recipeVersion: "future" }, { revision: -1 }, { revision: Number.MAX_SAFE_INTEGER },
    { expiresAt: iso(T) }, { expiresAt: iso(T + 366 * DAY) }, { retentionDays: 0 }, { enrollmentRevision: 0 }]) {
    const run = fake(() => Response.json(enabled()));
    await assert.rejects(run.client.enable(draft(changes)), errorIs("invalid_document_profile_request")); assert.equal(run.calls.length, 0);
  }
});

test("isolated enable response must exactly match consent custody parent revision lifetime and future-only source boundary", async () => {
  const changes = [{ revision: 3 }, { projectId: "other" }, { documentId: "other" }, { enrollmentId: hash(9) }, { enrollmentRevision: 3 },
    { organizationId: "other" }, { projectAccessId: "other" }, { ownerUserId: "other" }, { infer: false }, { inspect: false }, { background: true },
    { revokedAt: iso(T) }, { retentionDays: 31 }, { expiresAt: iso(T + 31 * DAY) }, { policyVersion: "future" }, { recipeVersion: "future" }];
  for (const change of changes) {
    const body = enabled(); Object.assign(body.grant, change);
    await assert.rejects(fake(() => Response.json(body)).client.enable(draft()), errorIs("document_profile_response_invalid", true, 200));
  }
  for (const historyStartsAfterSequence of [-1, 11, null, "10"]) {
    await assert.rejects(fake(() => Response.json(enabled({ historyStartsAfterSequence }))).client.enable(draft()), errorIs("document_profile_response_invalid", true, 200));
  }
});

test("isolated caller mutations after dispatch cannot replace scope custody parent consent or grant expectations", async () => {
  for (const [kind, original, invoke, response] of [
    ["settings", scope(), (client, item) => client.settings(item), settings()],
    ["enable", draft(), (client, item) => client.enable(item), enabled()],
    ["inspect", grant(), (client, item) => client.inspect(item), inspected()],
    ["revoke", grant(), (client, item) => client.revoke(item), revoked()],
    ["suppress", grant(), (client, item) => client.suppress(item, hash(3), 0), suppressed()],
  ]) {
    let release; const { client, calls } = fake(() => new Promise(resolve => { release = resolve; }));
    const pending = invoke(client, original); const sent = calls[0].init.body;
    original.projectId = "changed"; original.documentId = "changed"; original.revision = 98; original.enrollmentRevision = 98;
    if (original.expectedCustody) original.expectedCustody.ownerUserId = "changed";
    if (original.expectedParent) original.expectedParent.enrollmentRevision = 98;
    release(Response.json(response)); const result = await pending;
    assert.equal(calls.length, 1); assert.equal(calls[0].init.body, sent); assert.ok(kind === "inspect" ? result.current() : result);
  }
});

test("isolated revoke remains callable with disabled expired or revoked original grant metadata", async () => {
  for (const changes of [{ infer: false, inspect: false }, { expiresAt: iso(T - 1) }, { revokedAt: iso(T), infer: false, inspect: false }]) {
    const expected = revoked({ revision: changes.revokedAt ? 3 : 4 });
    const signal = new AbortController().signal, { client, calls } = fake(() => Response.json(expected));
    assert.deepEqual(await client.revoke(grant(changes), signal), expected); assert.equal(calls.length, 1);
    privateRequest(calls[0], "DELETE", signal); assert.equal(calls[0].url, "/api/memory/document-profile/settings?grantId=" + hash(2));
    assert.deepEqual(JSON.parse(calls[0].init.body), { version: VERSION, revision: 3, confirmation: "REVOKE_DOCUMENT_PALETTE_PROFILE" });
  }
  const tombstone = grant({ consentedAt: iso(T), expiresAt: iso(T), revokedAt: iso(T), infer: false, inspect: false });
  assert.deepEqual(await fake(() => Response.json(revoked({ revision: 3 }))).client.revoke(tombstone), revoked({ revision: 3 }));
  for (const changes of [{ grantId: hash(8) }, { revision: 3 }, { revoked: false }, { reEnrollmentRequired: false }]) {
    await assert.rejects(fake(() => Response.json(revoked(changes))).client.revoke(grant()), errorIs("document_profile_response_invalid", true, 200));
  }
});

test("isolated suppression is claim scoped and exact; neither deletion nor an inferred dislike", async () => {
  const signal = new AbortController().signal, { client, calls } = fake(() => Response.json(suppressed()));
  assert.deepEqual(await client.suppress(grant(), hash(3), 0, signal), suppressed()); privateRequest(calls[0], "PUT", signal);
  assert.equal(calls[0].url, "/api/memory/document-profile/suppress");
  assert.deepEqual(JSON.parse(calls[0].init.body), { version: VERSION, grantId: hash(2), grantRevision: 3, claimKey: hash(3), revision: 0,
    confirmation: "SUPPRESS_DOCUMENT_PALETTE_CLAIM" });
  for (const changes of [{ grantId: hash(8) }, { grantRevision: 4 }, { claimKey: hash(8) }, { revision: 0 }, { state: "deleted" },
    { createdAt: iso(T - 2 * DAY) }, { expiresAt: iso(T + 31 * DAY) }, { expiresAt: iso(T) }, { extra: true }]) {
    const body = suppressed(); Object.assign(body.suppression, changes);
    await assert.rejects(fake(() => Response.json(body)).client.suppress(grant(), hash(3), 0), errorIs("document_profile_response_invalid", true, 200));
  }
  for (const key of ["", "red", hash(3).toUpperCase() + "x", null]) {
    const run = fake(() => Response.json(suppressed()));
    await assert.rejects(run.client.suppress(grant(), key, 0), errorIs("invalid_document_profile_request")); assert.equal(run.calls.length, 0);
  }
});

test("isolated inspect requests the exact recipe and binds scope grant consent and retention", async () => {
  const signal = new AbortController().signal, { client, calls } = fake(() => Response.json(inspected()));
  const lease = await client.inspect(grant(), signal); assert.deepEqual(lease.value, profile()); assert.equal(lease.current(), lease.value);
  privateRequest(calls[0], "GET", signal); assert.equal(calls[0].url, `/api/memory/document-profile/inspect?grantId=${hash(2)}&version=${VERSION}`);
  assert.equal(lease.remaining(), 60_000);
  const corruptions = [...["projectId", "documentId", "organizationId", "projectAccessId"].map(key => body => { body.scope[key] = "other"; }),
    body => { body.grant.id = hash(8); }, body => { body.grant.revision = 4; },
    body => { body.choices[0].supports[0].sources[0].sequence = 10; },
    body => { body.choices[0].supports[0].sources[0].recordedAt = iso(T - 2 * DAY); },
    body => { body.lifetime.checkedAt = iso(T - 2 * DAY); }, body => { body.lifetime.validUntil = iso(T + 60_001); }];
  for (const corrupt of corruptions) {
    const body = profile(); corrupt(body);
    await assert.rejects(fake(() => Response.json(inspected(body))).client.inspect(grant()), errorIs("document_profile_response_invalid", false, 200));
  }
  const body = profile(); body.lifetime.validUntil = iso(T + 1000);
  await assert.rejects(fake(() => Response.json(inspected(body))).client.inspect(grant({ expiresAt: iso(T + 999) })), errorIs("document_profile_response_invalid", false, 200));
  body.choices[0].supports[0].sources[0].recordedAt = iso(T - DAY + 500);
  await assert.rejects(fake(() => Response.json(inspected(body))).client.inspect(grant({ retentionDays: 1 })), errorIs("document_profile_response_invalid", false, 200));
});

test("isolated profile reader fails closed on fabricated traits confidence evidence independence and malformed nested contracts", async () => {
  const corruptions = [body => { body.inferredPreferences = true; }, body => { body.independentEvidence = true; },
    body => { body.confidence = 0.9; }, body => { body.traits = ["taste"]; }, body => { body.coverage.completeHistory = true; },
    body => { body.choices[0].supports[0].independentEvidence = true; }, body => { body.choices[0].supports[0].lineage = "human"; },
    body => { body.choices[0].supports[0].sources[0].type = "AssistantReasoned"; }, body => { body.choices[0].colors = ["red"]; },
    body => { body.choices[0].status = "conflicted"; }, body => { body.choices[0].supports[0].sources = []; },
    body => { body.choices[0].supports[0].sources[0].extra = true; }, body => { body.choices[0].counterevidence = undefined; },
    body => { body.lifetime.checkedAt = "2026-09-04T12:00:00Z"; }, body => { body.scope.extra = false; }];
  for (const corrupt of corruptions) {
    const body = profile(); corrupt(body);
    await assert.rejects(fake(() => Response.json(inspected(body))).client.inspect(grant()), errorIs("document_profile_response_invalid", false, 200));
  }
  const empty = profile({ choices: [], coverage: { bounded: true, completeHistory: false, blockLimit: 16, sourceLimit: 128, selectedBlockCount: 0, eligibleChoiceCount: 0 } });
  assert.equal((await fake(() => Response.json(inspected(empty))).client.inspect(grant())).value.coverage.completeHistory, false);
});

test("isolated lease is deeply immutable monotonic nonrenewable and invalid after retirement or cancellation", async () => {
  let time = { monotonic: 100, wall: T }; const controller = new AbortController();
  const { client } = fake(() => Response.json(inspected()), () => time), lease = await client.inspect(grant(), controller.signal);
  for (const mutate of [() => { lease.value.lifetime.validUntil = iso(T + DAY); }, () => { lease.value.scope.documentId = "other"; },
    () => { lease.value.choices[0].colors.push("#ffffff"); }, () => { lease.remaining = () => Infinity; }]) assert.throws(mutate, TypeError);
  time = { monotonic: 1100, wall: T + 500 }; assert.equal(lease.remaining(), 59_000);
  time = { monotonic: 1100, wall: T + 2000 }; assert.equal(lease.remaining(), 58_000);
  controller.abort(); assert.equal(lease.current(), null); assert.equal(lease.remaining(), 0);
  time = { monotonic: 100, wall: T }; assert.equal(lease.remaining(), 0);
  const other = await fake(() => Response.json(inspected())).client.inspect(grant()); other.retire(); assert.equal(other.current(), null);
});

test("isolated lease charges header body and parser time and cannot outlive absolute expiry", async () => {
  let time = { monotonic: 100, wall: T }, release;
  const { client } = fake(() => new Promise(resolve => { release = resolve; }), () => time);
  const pending = client.inspect(grant()); time = { monotonic: 10_100, wall: T + 10_000 }; release(Response.json(inspected()));
  const lease = await pending; assert.equal(lease.remaining(), 50_000);
  time = { monotonic: 60_100, wall: T + 60_000 }; assert.equal(lease.current(), null);
  for (const fault of [{ monotonic: 99, wall: T + 1 }, { monotonic: 101, wall: T - 1 }, { monotonic: NaN, wall: T }, { monotonic: 60_100, wall: T + 1 }]) {
    let moment = { monotonic: 100, wall: T };
    const run = fake(() => { moment = fault; return Response.json(inspected()); }, () => moment);
    await assert.rejects(run.client.inspect(grant()), errorIs("document_profile_response_invalid", false, 200));
  }
  let samples = 0;
  await assert.rejects(fake(() => Response.json(inspected()), () => {
    samples += 1; return samples >= 8 ? { monotonic: 60_100, wall: T + 60_000 } : { monotonic: 100, wall: T };
  }).client.inspect(grant()), errorIs("document_profile_response_invalid", false, 200));
  assert.equal(samples, 8, "final validation is included in the nonrenewable budget");
});

test("isolated later reads mutations and inactive settings retire prior leases without renewal", async () => {
  for (const next of ["settings", "inspect", "revoke", "suppress", "enable", "invalid-inspect", "failed-revoke"]) {
    let count = 0; const { client } = fake(() => {
      count += 1; if (count === 1) return Response.json(inspected());
      return next === "settings" ? Response.json(settings({ enabled: false, grantCurrent: false }))
        : next === "inspect" ? Response.json(inspected()) : next === "invalid-inspect" ? Response.json({})
          : next === "failed-revoke" ? Promise.reject(new Error("PRIVATE")) : Response.json(next === "revoke" ? revoked() : next === "enable" ? enabled() : suppressed());
    });
    const lease = await client.inspect(grant());
    const action = next === "settings" ? client.settings(scope()) : next.endsWith("inspect") ? client.inspect(grant())
      : next.endsWith("revoke") ? client.revoke(grant()) : next === "enable" ? client.enable(draft()) : client.suppress(grant(), hash(3), 0);
    if (next === "invalid-inspect" || next === "failed-revoke") await assert.rejects(action); else await action;
    assert.equal(lease.current(), null, next);
  }
  for (const next of ["missing-grant", "new-revision"]) {
    let count = 0; const { client, calls } = fake(() => {
      count += 1; if (count === 1) return Response.json(inspected());
      return next === "missing-grant" ? Response.json(settings({ enabled: false, grant: null, grantCurrent: false })) : Response.json(enabled());
    });
    await client.inspect(grant());
    if (next === "missing-grant") await client.settings(scope()); else await client.enable(draft());
    await assert.rejects(client.inspect(grant()), errorIs("invalid_document_profile_request"));
    await assert.rejects(client.suppress(grant(), hash(3), 0), errorIs("invalid_document_profile_request"));
    assert.equal(calls.length, 2, "a known absent or replaced grant cannot be reused for processing");
  }
});

test("isolated in-flight old profiles cannot reappear after a newer read or mutation epoch", async () => {
  for (const action of ["inspect", "settings", "enable", "revoke", "suppress", "failed-revoke"]) {
    let count = 0, release;
    const { client, calls } = fake(() => {
      count += 1; if (count === 1) return new Promise(resolve => { release = resolve; });
      return action === "inspect" ? Response.json(inspected()) : action === "settings" ? Response.json(settings())
        : action === "enable" ? Response.json(enabled()) : action === "revoke" ? Response.json(revoked())
          : action === "failed-revoke" ? Promise.reject(new Error("PRIVATE")) : Response.json(suppressed());
    });
    const stale = client.inspect(grant());
    const followup = action === "inspect" ? client.inspect(grant()) : action === "settings" ? client.settings(scope())
      : action === "enable" ? client.enable(draft()) : action.endsWith("revoke") ? client.revoke(grant()) : client.suppress(grant(), hash(3), 0);
    let fresh; if (action === "failed-revoke") await assert.rejects(followup); else fresh = await followup;
    release(Response.json(inspected())); await assert.rejects(stale, errorIs("document_profile_response_invalid", false, 200));
    if (action === "inspect") assert.notEqual(fresh.current(), null, "a superseded response does not retire the newer lease");
    assert.equal(calls.length, 2);
  }
});

test("isolated control ordering rejects old settings without tombstoning a newer enabled grant", async () => {
  let release, count = 0;
  const nextGrant = enabled().grant, nextProfile = profile({ grant: { id: nextGrant.grantId, revision: nextGrant.revision } });
  nextProfile.choices[0].supports[0].sources[0].recordedAt = iso(T);
  const nextSuppression = suppressed(); nextSuppression.suppression.grantRevision = nextGrant.revision;
  const { client, calls } = fake(() => {
    count += 1;
    if (count === 1) return new Promise(resolve => { release = resolve; });
    return Response.json(count === 2 ? enabled() : count === 3 ? settings({ grant: nextGrant })
      : count === 4 ? inspected(nextProfile) : nextSuppression);
  });
  const stale = client.settings(scope());
  assert.equal((await client.enable(draft())).grant.revision, 4);
  release(Response.json(settings()));
  await assert.rejects(stale, errorIs("document_profile_response_invalid", false, 200));
  const current = await client.settings(scope());
  assert.equal(current.grant.revision, 4); assert.equal(current.grantCurrent, true);
  const lease = await client.inspect(current.grant); assert.equal(lease.current().grant.revision, 4);
  assert.deepEqual(await client.suppress(current.grant, hash(3), 0), nextSuppression);
  assert.equal(lease.current(), null); assert.equal(calls.length, 5, "no implicit retry or re-enrollment");
});

test("isolated control ordering supersedes earlier same-scope reads but not other document scopes", async () => {
  for (const sameScope of [true, false]) {
    let release, count = 0;
    const secondScope = scope({ documentId: sameScope ? "document" : "other-document" });
    const nextGrant = grant({ revision: 4, documentId: secondScope.documentId });
    const secondBody = settings({ scope: { projectId: secondScope.projectId, documentId: secondScope.documentId, custody: org() }, grant: nextGrant });
    const { client, calls } = fake(() => {
      count += 1; if (count === 1) return new Promise(resolve => { release = resolve; });
      if (count === 2) return Response.json(secondBody);
      return Response.json(inspected(profile({ grant: { id: nextGrant.grantId, revision: 4 },
        scope: { organizationId: nextGrant.organizationId, projectAccessId: nextGrant.projectAccessId,
          projectId: nextGrant.projectId, documentId: nextGrant.documentId } })));
    });
    const stale = client.settings(scope());
    assert.deepEqual(await client.settings(secondScope), secondBody);
    release(Response.json(settings()));
    if (sameScope) await assert.rejects(stale, errorIs("document_profile_response_invalid", false, 200));
    else assert.deepEqual(await stale, settings(), "a different document has an independent control order");
    assert.notEqual((await client.inspect(nextGrant)).current(), null); assert.equal(calls.length, 3);
  }
});

test("isolated stale enable success is mutationUnknown and cannot replace a newer settings grant", async () => {
  let release, count = 0;
  const nextGrant = grant({ revision: 5 });
  const { client, calls } = fake(() => {
    count += 1;
    if (count === 1) return Response.json(inspected());
    if (count === 2) return new Promise(resolve => { release = resolve; });
    return Response.json(count === 3 ? settings({ grant: nextGrant }) : inspected(profile({ grant: { id: nextGrant.grantId, revision: 5 } })));
  });
  const oldLease = await client.inspect(grant()), stale = client.enable(draft());
  assert.equal(oldLease.current(), null, "mutation dispatch retires displayed source bytes before delivery is known");
  assert.equal((await client.settings(scope())).grant.revision, 5);
  release(Response.json(enabled()));
  await assert.rejects(stale, errorIs("document_profile_response_invalid", true, 200));
  await assert.rejects(client.inspect(grant()), errorIs("invalid_document_profile_request"));
  assert.equal((await client.inspect(nextGrant)).current().grant.revision, 5);
  assert.equal(calls.length, 4, "an ambiguous mutation never starts reconciliation or enrollment automatically");
});

test("isolated later mutations invalidate older settings while preserving known retirement and ambiguity", async () => {
  for (const action of ["suppress", "revoke", "failed-enable", "failed-suppress"]) {
    let release, count = 0;
    const { client, calls } = fake(() => {
      count += 1;
      if (count === 1) return Response.json(inspected());
      if (count === 2) return new Promise(resolve => { release = resolve; });
      if (count === 3) return action.startsWith("failed-")
        ? Response.json({ version: VERSION, error: "document_profile_commit_delivery_unconfirmed" }, { status: 503 })
        : Response.json(action === "revoke" ? revoked() : suppressed());
      return Response.json(count === 4 ? settings() : inspected());
    });
    const lease = await client.inspect(grant()), stale = client.settings(scope());
    assert.equal(lease.current(), null);
    const mutation = action.endsWith("enable") ? client.enable(draft()) : action === "revoke" ? client.revoke(grant()) : client.suppress(grant(), hash(3), 0);
    if (action.startsWith("failed-")) await assert.rejects(mutation, errorIs("document_profile_commit_delivery_unconfirmed", true, 503));
    else await mutation;
    release(Response.json(settings({ enabled: false, grantCurrent: false })));
    await assert.rejects(stale, errorIs("document_profile_response_invalid", false, 200));
    assert.equal(calls.length, 3, "the client does not retry a rejected or ambiguous mutation");
    await client.settings(scope());
    if (action === "revoke") {
      await assert.rejects(client.inspect(grant()), errorIs("invalid_document_profile_request"));
      await assert.rejects(client.suppress(grant(), hash(3), 0), errorIs("invalid_document_profile_request"));
      assert.equal(calls.length, 4, "fresh-looking settings cannot clear a legitimate permanent retirement tombstone");
    } else {
      assert.notEqual((await client.inspect(grant())).current(), null, "stale inactive settings did not permanently retire a still-current grant");
      assert.equal(calls.length, 5);
    }
    assert.equal(lease.current(), null, "reconciliation cannot renew an already-retired source lease");
  }
});

test("isolated rejected or inactive grant flags and short in-flight expiries fail closed", async () => {
  for (const changes of [{ infer: false }, { inspect: false }, { revokedAt: iso(T) }, { expiresAt: iso(T) }]) {
    const { client, calls } = fake(() => Response.json(inspected()));
    await assert.rejects(client.inspect(grant(changes)), errorIs("invalid_document_profile_request")); assert.equal(calls.length, 0);
  }
  for (const fault of [{ monotonic: 1100, wall: T + 1 }, { monotonic: 101, wall: T + 1000 }]) {
    let time = { monotonic: 100, wall: T };
    const body = profile({ lifetime: { checkedAt: iso(T), validUntil: iso(T + 500) } });
    const { client } = fake(() => { time = fault; return Response.json(inspected(body)); }, () => time);
    await assert.rejects(client.inspect(grant({ expiresAt: iso(T + 1000) })), errorIs("document_profile_response_invalid", false, 200));
  }
  let samples = 0; const controller = new AbortController();
  await assert.rejects(fake(() => Response.json(inspected()), () => {
    samples += 1; if (samples === 8) controller.abort(); return { monotonic: 100, wall: T };
  }).client.inspect(grant(), controller.signal), errorIs("document_profile_request_cancelled", false, 200));
});

test("isolated all methods reject pre-aborted signals before dispatch", async () => {
  const controller = new AbortController(); controller.abort();
  for (const invoke of [client => client.settings(scope(), controller.signal), client => client.enable(draft(), controller.signal),
    client => client.revoke(grant(), controller.signal), client => client.inspect(grant(), controller.signal),
    client => client.suppress(grant(), hash(3), 0, controller.signal)]) {
    const { client, calls } = fake(() => { throw new Error("PRIVATE SHOULD NOT CALL"); });
    await assert.rejects(invoke(client), errorIs("document_profile_request_cancelled", false, null)); assert.equal(calls.length, 0);
  }
});

test("isolated cancellation during ignored transport settles and cancels a late response body", { timeout: 2000 }, async () => {
  const controller = new AbortController(); let release, cancelled = 0;
  const { client, calls } = fake(() => new Promise(resolve => { release = resolve; }));
  const pending = client.enable(draft(), controller.signal); controller.abort();
  await assert.rejects(pending, errorIs("document_profile_request_cancelled", true, null));
  release(new Response(new ReadableStream({ cancel() { cancelled += 1; return new Promise(() => {}); } }), { headers: { "content-type": "application/json" } }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, 1); assert.equal(calls.length, 1);
});

test("isolated cancellation during body and after headers never leaks or reports a successful mutation", { timeout: 2000 }, async () => {
  for (const phase of ["headers", "body"]) for (const status of [200, 403, 503]) {
    const controller = new AbortController(); let cancelled = 0, reading;
    const observed = new Promise(resolve => { reading = resolve; });
    const stream = new ReadableStream({ pull() { reading(); }, cancel() { cancelled += 1; return new Promise(() => {}); } }, { highWaterMark: 0 });
    const { client } = fake(() => { if (phase === "headers") controller.abort(); return new Response(stream, { status, headers: { "content-type": "application/json" } }); });
    const pending = client.enable(draft(), controller.signal);
    if (phase === "body") { await observed; controller.abort(); }
    await assert.rejects(pending, errorIs("document_profile_request_cancelled", true)); assert.equal(cancelled, 1);
  }
});

test("isolated bounded wire reader counts bytes despite lying headers and never waits for cancellation", { timeout: 2000 }, async () => {
  const limit = 65_536 + 128, raw = JSON.stringify(settings()), bytes = new TextEncoder().encode(raw).byteLength;
  const exact = raw + " ".repeat(limit - bytes);
  assert.deepEqual(await fake(() => new Response(exact, { headers: { "content-type": "application/json", "content-length": "1" } })).client.settings(scope()), settings());
  for (const status of [200, 403, 503]) {
    let pulls = 0, cancelled = 0;
    const stream = new ReadableStream({ pull(controller) { pulls += 1; controller.enqueue(new TextEncoder().encode(pulls === 1 ? exact : " ")); },
      cancel() { cancelled += 1; return new Promise(() => {}); } }, { highWaterMark: 0 });
    const { client, calls } = fake(() => new Response(stream, { status, headers: { "content-type": "application/json", "content-length": "1" } }));
    await assert.rejects(client.enable(draft()), errorIs(status === 200 ? "document_profile_response_invalid" : "document_profile_request_rejected", status !== 403, status));
    assert.equal(pulls, 2); assert.equal(cancelled, 1); assert.equal(stream.locked, false); assert.equal(calls.length, 1);
  }
});

test("isolated wire reader handles split UTF8 but rejects malformed UTF8 media JSON and status", async () => {
  const body = settings(); body.grant.ownerUserId = "é"; body.scope.custody.ownerUserId = "é";
  const bytes = new TextEncoder().encode(JSON.stringify(body)), split = bytes.indexOf(0xc3) + 1;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close(); } });
  assert.deepEqual(await fake(() => new Response(stream, { headers: { "content-type": "application/json; charset=utf-8" } })).client.settings(scope({ expectedCustody: { ...org(), ownerUserId: "é" } })), body);
  for (const response of [new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "text/html" } }), new Response("PRIVATE", { headers: { "content-type": "application/json" } }),
    new Response(null, { status: 204 }), new Response(JSON.stringify(enabled()), { status: 201, headers: { "content-type": "application/json" } })]) {
    await assert.rejects(fake(() => response).client.enable(draft()), errorIs("document_profile_response_invalid", true, response.status));
  }
});

test("isolated failures expose only safe codes and ambiguous mutations require reconciliation without retry", async () => {
  for (const [name, invoke, , mutation] of methods) {
    for (const [status, code] of [[403, "document_profile_disabled"], [409, "document_profile_revision_changed"], [503, "document_profile_schema_unavailable"],
      [503, "document_profile_commit_delivery_unconfirmed"],
      [400, "PRIVATE ERROR"], [503, "PRIVATE ERROR"]]) {
      const { client, calls } = fake(() => Response.json({ error: code, message: "PRIVATE SERVER BODY", extra: "PRIVATE" }, { status }));
      await assert.rejects(invoke(client), error => {
        errorIs(code === "PRIVATE ERROR" ? "document_profile_request_rejected" : code, mutation && status >= 500, status)(error);
        assert.ok(!JSON.stringify(error).includes("PRIVATE")); return true;
      }, name); assert.equal(calls.length, 1);
    }
    const { client, calls } = fake(() => { throw new Error("PRIVATE TRANSPORT"); });
    await assert.rejects(invoke(client), errorIs("document_profile_request_failed", mutation, null)); assert.equal(calls.length, 1);
  }
});
