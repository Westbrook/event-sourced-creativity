// SOURCE-ONLY DRAFT. Isolated fake HTTP contracts; not native Worker, access, scheduling or production qualification.
import assert from "node:assert/strict";
import test from "node:test";
import { createLiveMemoryClient, MemoryClientError, MEMORY_POLICY, MEMORY_TIMING, MEMORY_WRITE_CONTRACT } from "../src/state/live-memory-client.ts";
import { parseMemoryCustody, memoryCustodyMatches } from "../src/model/memory-custody.ts";
import { createMemoryElapsed, memoryTimestamp, parseMemoryLifetime, MEMORY_RECALL_LIFETIME, MEMORY_RECALL_MAX_AGE_MS } from "../src/model/memory-lifetime.ts";
import { rollingLiveMemoryConsumption } from "../src/model/memory-observations.ts";
import { createDocumentJobMemoryClient, DocumentJobMemoryError, DOCUMENT_JOB_MEMORY_VERSION } from "../src/state/document-job-memory-client.ts";
import { MEMORY_CONSUMPTION_V2, MEMORY_CONSUMPTION_V3, MEMORY_CONSUMPTION_V4, MEMORY_CONSUMPTION_V5, parseMemoryConsumptionV2, parseMemoryConsumptionV3, parseMemoryConsumptionV4, parseMemoryConsumptionV5, memoryConsumptionWindows } from "../src/model/memory-consumption-v2.ts";

const fixtureId = value => value.toString(16).padStart(64, "0");
const now = () => new Date().toISOString();
const future = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
const contract = () => ({ timing: MEMORY_TIMING, preferredLocalWindow: { startHour: 1, endHour: 5 },
  freshDaytimeCatchUpAllowed: true, savedPagesMayContinueOutsideWindow: true, strictlyOvernight: false, deliverySlaVerified: false });
const preferences = () => ({ projectId: "isolated-project", documentId: "isolated-document", learn: true, recall: true, background: true,
  retentionDays: 30, timeZone: "UTC", expiresAt: future(), revision: 0, confirmation: "ENABLE_PERSONAL_MEMORY",
  policyVersion: MEMORY_POLICY, reviewTiming: MEMORY_TIMING, expectedCustody: { kind: "personal" } });
const organizationCustody = () => ({ kind: "organization", organizationId: "isolated-organization", projectAccessId: "isolated-access", ownerUserId: "isolated-owner" });
const enrollment = (overrides = {}) => ({ id: fixtureId(1), projectId: "isolated-project", documentId: "isolated-document", organizationId: null,
  revision: 1, learn: true, recall: true, background: true, retentionDays: 30, timeZone: "UTC", expiresAt: future(), policyVersion: MEMORY_POLICY,
  lastAdmittedAt: null, throughSequence: 10, cutoffSequence: null, backlog: false, nextDueAt: now(), attempts: 0, status: "ready", ...overrides });
const settings = (enrollments = [], nextAfter = null) => ({ enabled: false, policyVersion: MEMORY_POLICY, reviewContract: contract(), writeContractVersion: MEMORY_WRITE_CONTRACT, enrollments, nextAfter });
const saved = draft => ({ enrollment: enrollment({ ...Object.fromEntries(["projectId", "documentId", "learn", "recall", "background", "retentionDays", "timeZone", "expiresAt", "policyVersion"].map(key => [key, draft[key]])),
  organizationId: draft.expectedCustody.kind === "personal" ? null : draft.expectedCustody.organizationId, revision: draft.revision + 1 }),
  reviewContract: contract(), historyStartsAt: now(), priorMemoryCleared: true, uiChanged: false });
const forgotten = () => ({ erased: true, reEnrollmentRequired: true, otherDevicesAndBackupsPurged: false });
function recalled(item) {
  const recordedAt = now();
  const validUntil = new Date(Date.parse(recordedAt) + 60_000).toISOString();
  return { mode: "live-reference-memory", scope: { organizationId: item.organizationId, projectId: item.projectId, documentId: item.documentId },
    lifetime: { version: MEMORY_RECALL_LIFETIME, checkedAt: recordedAt, validUntil },
    treatment: "untrusted-historical-evidence", method: "extractive-not-semantic", consumption: { conversation: 1 },
    rollingConversation: { summary: [], recent: [{ sourceEventId: "isolated-event", recordedAt, user: "Synthetic question", assistant: "Synthetic historical reply" }], completeFromStart: false },
    coverage: { since: recordedAt, throughSequence: 10, remainingThroughSequence: null, bounded: true, sourceCount: 1 },
    sources: [{ eventId: "isolated-event", type: "AssistantReasoned", blockId: null, recordedAt, validUntil }],
    note: "Observed actions are not inferred preferences; excerpts are truncated and access-filtered." };
}
function consumptionRecall(item) {
  const body = recalled(item), checkedAt = Date.parse(body.lifetime.checkedAt);
  body.coverage.since = new Date(checkedAt - 20 * 86_400_000).toISOString();
  body.sources.push({ eventId: "document-event", type: "DocumentOpened", blockId: null,
    recordedAt: new Date(checkedAt - 8 * 86_400_000).toISOString(), validUntil: body.lifetime.validUntil },
  { eventId: "block-event", type: "BlockPropertyEdited", blockId: "isolated-block",
    recordedAt: new Date(checkedAt - 86_400_000).toISOString(), validUntil: body.lifetime.validUntil });
  body.coverage.sourceCount = body.sources.length; body.consumption = { conversation: 1, encounter: 1, edit: 1 };
  body.rollingConsumption = rollingLiveMemoryConsumption(body.sources, body.lifetime, body.coverage.since, item.retentionDays);
  return body;
}

function artifactConsumptionRecall(item) {
  const body=recalled(item),{checkedAt,validUntil}=body.lifetime;
  body.consumptionEpisodes={version:MEMORY_CONSUMPTION_V2,treatment:'descriptive-consumption',validUntil,
    sources:[{eventId:'artifact-view',type:'DocumentArtifactViewed',recordedAt:checkedAt,validUntil,target:{kind:'artifact',documentId:item.documentId,artifactId:'artifact',artifactKind:'slides',revision:0,contentSha256:'a'.repeat(64)}}],
    episodes:[{episodeId:null,observations:[{sourceIndex:0,kind:'viewer-open'}],firstRecordedAt:checkedAt,lastRecordedAt:checkedAt,validUntil,independentEvidence:false}],
    coverage:{eligibleSourceCount:1,observationCount:1,unavailableArtifactSourceCount:0,completeHistory:false,bounded:true,truncated:false},
    attention:'not-measured',comprehension:'not-measured',inferredPreferences:false};
  return body;
}
test('consumption v2 negotiates its own source map without changing legacy recall or extending the parent lease',async()=>{
  const item=enrollment(),body=artifactConsumptionRecall(item),{client,calls}=fakeTransport(()=>Response.json(body));
  const result=await client.recall(item,undefined,{consumptionEpisodes:MEMORY_CONSUMPTION_V2});
  assert.deepEqual(result.value.consumptionEpisodes,body.consumptionEpisodes);assert.equal(result.value.sources[0].eventId,'isolated-event');
  assert.ok(calls[0].url.endsWith('&consumptionEpisodes='+MEMORY_CONSUMPTION_V2));
  await assert.rejects(client.recall(item),isClientError('memory_response_invalid',false,200));
  await assert.rejects(client.recall(item,undefined,{consumptionEpisodes:true}),isClientError('memory_response_invalid',false,200));
});
test('consumption v2 refuses source/target substitution, invented episodes and interpretation claims',()=>{
  const item=enrollment();
  for(const mutate of [p=>{p.sources[0].target.documentId='foreign';},p=>{p.sources[0].target.kind='block';},
    p=>{p.sources[0].target.revision=-1;},p=>{p.sources[0].target.contentSha256='missing';},p=>{p.sources[0].type='BlockViewed';},
    p=>{p.sources[0].target.attention=1;},p=>{p.episodes[0].observations[0].sourceIndex=1;},p=>{p.episodes[0].observations[0].kind='read';},
    p=>{p.episodes[0].independentEvidence=true;},p=>{p.inferredPreferences=true;},p=>{p.comprehension='measured';},
    p=>{p.sources[0].validUntil='2000-01-01T00:00:00.000Z';},p=>{p.coverage.completeHistory=true;},
    p=>{p.sources[0].validUntil=new Date(Date.parse(item.expiresAt)+1).toISOString();},
    p=>{p.sources[0].recordedAt='2000-01-01T00:00:00.000Z';},
    p=>{p.validUntil=new Date(Date.parse(p.validUntil)+1).toISOString();},p=>{p.sources.push({...p.sources[0]});},
  ]){const body=artifactConsumptionRecall(item);mutate(body.consumptionEpisodes);assert.equal(parseMemoryConsumptionV2(body.consumptionEpisodes,body.lifetime,item.documentId,{since:body.coverage.since,expiresAt:item.expiresAt}),null);}
  const accessor=artifactConsumptionRecall(item);let read=0;Object.defineProperty(accessor.consumptionEpisodes.sources[0].target,'revision',{enumerable:true,get(){read++;return 0;}});
  assert.equal(parseMemoryConsumptionV2(accessor.consumptionEpisodes,accessor.lifetime,item.documentId,{since:accessor.coverage.since,expiresAt:item.expiresAt}),null);assert.equal(read,0);
});
function assistedRecall(item) {
  const body = recalled(item), recordedAt = body.lifetime.checkedAt, validUntil = body.lifetime.validUntil;
  body.sources.push({ eventId: "decision-accepted", type: "ProposalAccepted", blockId: null, recordedAt, validUntil },
    { eventId: "decision-mutation", type: "BlockCreated", blockId: "created-block", recordedAt, validUntil },
    { eventId: "decision-rejected", type: "ProposalRejected", blockId: null, recordedAt, validUntil });
  body.coverage.sourceCount = 4; body.consumption = { conversation: 1, accept: 1, edit: 1, reject: 1 };
  body.assistedOutcomes = { version: "native-assisted-outcomes-v1", treatment: "descriptive-assisted-decisions",
    exposure: "not-measured", inferredPreferences: false,
    coverage: { selectedSourceCount: 4, selectedDecisionCount: 2, certifiedOutcomeCount: 2,
      completeHistory: false, bounded: true, freeAssistantOnly: true },
    outcomes: [{ proposalId: "accepted-proposal", turnId: "decision-turn", status: "accepted", actionKind: "context.create",
      origin: "assistant-assisted", independentEvidence: false, decision: { sourceIndex: 1 },
      mutation: { sourceIndex: 2, type: "BlockCreated", blockIds: ["created-block"], relationId: null }, recordedAt },
    { proposalId: "rejected-proposal", turnId: "decision-turn", status: "rejected", actionKind: "context.create",
      origin: "assistant-assisted", independentEvidence: false, decision: { sourceIndex: 3 }, mutation: null, recordedAt }] };
  return body;
}
function savedOutputRecall(item) {
  const body = recalled(item), recordedAt = body.lifetime.checkedAt, validUntil = body.lifetime.validUntil;
  body.sources.push(...["ObjectSaved", "ObjectPinned", "ObjectExported"].map((type, index) => ({
    eventId: `retention-${index}`, type, blockId: null, recordedAt, validUntil,
  })));
  body.coverage.sourceCount = 4; body.consumption = { conversation: 1, commit: 3 };
  body.savedOutputs = { version: "native-saved-outputs-v1", treatment: "descriptive-output-retention", inferredPreferences: false,
    coverage: { selectedSourceCount: 4, selectedRetentionActionCount: 3, certifiedOutputCount: 1,
      completeHistory: false, bounded: true, nativeImageJobsOnly: true },
    outputs: [{ sourceIndexes: [1, 2, 3], origin: "native-generated-output", independentEvidence: false,
      generatedAt: new Date(Date.parse(recordedAt) - 1000).toISOString() }] };
  return body;
}
function fakeTransport(respond, clock) {
  const calls = [];
  const client = createLiveMemoryClient(async (url, init) => { calls.push({ url, init }); return respond(url, init); }, clock);
  return { client, calls };
}
const isClientError = (code, unknown = false, status) => error => {
  assert.ok(error instanceof MemoryClientError);
  assert.equal(error.code, code); assert.equal(error.mutationUnknown, unknown);
  if (status !== undefined) assert.equal(error.status, status);
  return true;
};
function assertPrivateRequest(call, method, signal) {
  assert.equal(call.init.method, method); assert.equal(call.init.credentials, "same-origin");
  assert.equal(call.init.mode, "same-origin"); assert.equal(call.init.cache, "no-store");
  assert.equal(call.init.redirect, "error"); assert.equal(call.init.signal, signal);
  assert.equal(call.init.headers.accept, "application/json");
}

test("isolated client settings uses exact private GET and forwards cancellation", async () => {
  const signal = new AbortController().signal;
  const page = settings([enrollment({ id: fixtureId(2) })]);
  const { client, calls } = fakeTransport(() => Response.json(page));
  assert.equal(calls.length, 0, "constructing a client does not enroll or fetch");
  assert.deepEqual(await client.settings(fixtureId(1), signal), page);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "/api/memory/settings?after=" + fixtureId(1));
  assertPrivateRequest(calls[0], "GET", signal); assert.equal(calls[0].init.body, undefined);
});

test("isolated client normalizes absent write advertisement and preserves unknown versions for read and Forget", async () => {
  const item = enrollment({ policyVersion: "personal-memory-v1", learn: false, recall: false, background: false });
  for (const version of [undefined, null, "future-memory-write-contract", ""]) {
    const page = settings([item]);
    if (version === undefined) delete page.writeContractVersion;
    else page.writeContractVersion = version;
    const { client, calls } = fakeTransport(url => Response.json(url.includes("?id=") ? forgotten() : page));
    const result = await client.settings();
    assert.equal(result.writeContractVersion, version ?? null);
    assert.equal(result.enabled, false);
    assert.deepEqual(await client.forget(result.enrollments[0]), forgotten());
    assert.equal(calls.length, 2, "unknown write support does not suppress actor-owned erasure");
  }
  for (const version of [false, 1, {}, []]) {
    await assert.rejects(fakeTransport(() => Response.json({ ...settings(), writeContractVersion: version })).client.settings(),
      isClientError("memory_response_invalid", false, 200));
  }
});

test("isolated shared custody parser copies exact personal and organization assertions without granting authority", () => {
  assert.equal(MEMORY_WRITE_CONTRACT, "memory-settings-custody-v1");
  const nonWritable = Object.create(null, Object.fromEntries(Object.entries(organizationCustody())
    .map(([key, value]) => [key, { value, enumerable: true, writable: false, configurable: false }])));
  for (const source of [{ kind: "personal" }, organizationCustody(), Object.assign(Object.create(null), { kind: "personal" }),
    Object.assign(Object.create(null), organizationCustody()), nonWritable, Object.freeze(organizationCustody())]) {
    const result = parseMemoryCustody(source);
    assert.deepEqual(result, { ...source }); assert.notEqual(result, source); assert.equal(Object.isFrozen(result), true);
  }
  const exactIdentity = { ...organizationCustody(), organizationId: "  isolated-organization  " };
  assert.equal(parseMemoryCustody(exactIdentity).organizationId, exactIdentity.organizationId, "custody identity is not normalized");
});

test("isolated shared custody parser rejects missing, malformed, inherited and overbroad assertions", () => {
  const organization = organizationCustody();
  const invalid = [undefined, null, false, "personal", [], {}, { kind: "unknown" }, { kind: "personal", scope: null },
    { kind: "personal", organizationId: null }, { kind: "organization" }, Object.create({ kind: "personal" }),
    { ...organization, extra: true }, { kind: "personal", [Symbol("extra")]: true }];
  for (const key of ["organizationId", "projectAccessId", "ownerUserId"]) {
    const missing = { ...organization }; delete missing[key]; invalid.push(missing);
    for (const value of [null, undefined, "", 1, []]) invalid.push({ ...organization, [key]: value });
  }
  for (const value of invalid) assert.equal(parseMemoryCustody(value), null);
});

test("isolated shared custody parser rejects accessors without invoking stable, changing or throwing getters", () => {
  for (const valid of [{ kind: "personal" }, organizationCustody()]) {
    for (const key of Object.keys(valid)) {
      for (const mode of ["stable-getter", "changing-getter", "throwing-getter", "setter-only"]) {
        const source = { ...valid }; let getterEffects = 0, setterEffects = 0;
        const descriptor = { enumerable: true, configurable: true,
          set() { setterEffects += 1; } };
        if (mode !== "setter-only") descriptor.get = () => {
          getterEffects += 1;
          if (mode === "throwing-getter") throw new Error("SYNTHETIC GETTER MUST NOT EXECUTE");
          return mode === "changing-getter" && getterEffects > 1 ? { changed: true } : valid[key];
        };
        Object.defineProperty(source, key, descriptor);
        assert.equal(parseMemoryCustody(source), null, key + " " + mode + " is not an enumerable data field");
        assert.equal(getterEffects, 0, "parsing must not invoke even a getter returning an initially valid primitive");
        assert.equal(setterEffects, 0, "parsing must not write to the caller's record");
      }
    }
  }
});

test("isolated shared custody parser rejects each nonenumerable required field", () => {
  for (const valid of [{ kind: "personal" }, organizationCustody()]) {
    for (const key of Object.keys(valid)) {
      for (const prototype of [Object.prototype, null]) {
        const source = Object.assign(Object.create(prototype), valid);
        Object.defineProperty(source, key, { value: valid[key], enumerable: false, configurable: true, writable: true });
        assert.equal(parseMemoryCustody(source), null, key + " must be an own enumerable data field");
      }
    }
  }
});

test("isolated shared custody parser rejects enumerable or hidden symbols and extra fields without evaluating them", () => {
  for (const valid of [{ kind: "personal" }, organizationCustody()]) {
    for (const key of ["extra", Symbol("extra")]) {
      for (const enumerable of [true, false]) {
        const extraData = { ...valid };
        Object.defineProperty(extraData, key, { value: "unexpected", enumerable });
        assert.equal(parseMemoryCustody(extraData), null);
        const extraAccessor = { ...valid }; let effects = 0;
        Object.defineProperty(extraAccessor, key, { enumerable, get() { effects += 1; return "unexpected"; } });
        assert.equal(parseMemoryCustody(extraAccessor), null);
        assert.equal(effects, 0, "even rejected extra fields must not be evaluated");
      }
    }
  }
});

test("isolated shared custody comparison requires personal no-scope or the exact organization tuple", () => {
  const personal = parseMemoryCustody({ kind: "personal" }), organization = parseMemoryCustody(organizationCustody());
  const resolved = { organizationId: organization.organizationId, projectAccessId: organization.projectAccessId, ownerUserId: organization.ownerUserId };
  assert.equal(memoryCustodyMatches(personal, null), true);
  assert.equal(memoryCustodyMatches(personal, resolved), false, "migration without an organization context must require fresh consent");
  assert.equal(memoryCustodyMatches(organization, null), false);
  assert.equal(memoryCustodyMatches(organization, resolved), true);
  for (const key of ["organizationId", "projectAccessId", "ownerUserId"]) {
    assert.equal(memoryCustodyMatches(organization, { ...resolved, [key]: "another-identity" }), false);
  }
});

test("isolated client accepts only a complete advancing settings cursor", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => enrollment({ id: fixtureId(i + 1) }));
  const { client } = fakeTransport(() => Response.json(settings(rows, fixtureId(50))));
  assert.equal((await client.settings()).nextAfter, fixtureId(50));
  const malformed = [settings([rows[0], rows[0]]), settings([rows[1], rows[0]]), settings([...rows, enrollment({ id: fixtureId(51) })]),
    settings([rows[0]], rows[0].id), settings(rows, fixtureId(49)), { ...settings(), policyVersion: "personal-memory-v1" },
    { ...settings(), unexpected: true }, settings([enrollment({ cutoffSequence: 9, backlog: true })]),
    settings([enrollment({ cutoffSequence: 12, backlog: false })])];
  for (const page of malformed) {
    await assert.rejects(fakeTransport(() => Response.json(page)).client.settings(), isClientError("memory_response_invalid", false, 200));
  }
  await assert.rejects(fakeTransport(() => Response.json(settings([rows[0]]))).client.settings(rows[0].id), isClientError("memory_response_invalid"));
});

test("isolated client refuses arbitrary cursor input before HTTP", async () => {
  const { client, calls } = fakeTransport(() => { throw new Error("must not dispatch"); });
  for (const cursor of ["", "../private", "a".repeat(65), "https://elsewhere.invalid", "A".repeat(64)]) {
    await assert.rejects(client.settings(cursor), isClientError("invalid_memory_request"));
  }
  assert.equal(calls.length, 0);
});

test("isolated client saves only the caller's explicit V2 preferences", async () => {
  const draft = preferences(), signal = new AbortController().signal;
  const { client, calls } = fakeTransport(() => Response.json(saved(draft)));
  const result = await client.save(draft, signal);
  assert.equal(result.enrollment.revision, 1); assert.equal(result.enrollment.documentId, draft.documentId);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "/api/memory/settings"); assertPrivateRequest(calls[0], "PUT", signal);
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), draft);
});

test("isolated client never adds background acknowledgement or widens preferences", async () => {
  const base = preferences();
  const { client, calls } = fakeTransport(() => { throw new Error("must not dispatch"); });
  for (const changed of [{ confirmation: undefined }, { policyVersion: "personal-memory-v1" }, { reviewTiming: undefined },
    { expectedCustody: undefined }, { expectedCustody: null }, { expectedCustody: { kind: "personal", organizationId: null } },
    { reviewTiming: "strictly-nightly" }, { actorUserId: "other" }, { retentionDays: 0 }, { retentionDays: 366 },
    { revision: -1 }, { learn: "true" }, { expiresAt: "2000-01-01T00:00:00.000Z" }, { timeZone: "Not/AZone" },
    { projectId: "x".repeat(121) }, { expiresAt: new Date(Date.now() + 366 * 86_400_000).toISOString() }]) {
    await assert.rejects(client.save({ ...base, ...changed }), isClientError("invalid_memory_request"));
  }
  assert.equal(calls.length, 0);
  const paused = { ...base, background: false }; delete paused.reviewTiming;
  const allowed = fakeTransport(() => Response.json(saved(paused)));
  await allowed.client.save(paused);
  assert.equal(Object.hasOwn(JSON.parse(allowed.calls[0].init.body), "reviewTiming"), false);
});

test("isolated client requires a caller-owned exact custody assertion before sending any mutation", async () => {
  const { client, calls } = fakeTransport(() => { throw new Error("must not dispatch"); });
  const missing = preferences(); delete missing.expectedCustody;
  await assert.rejects(client.save(missing), isClientError("invalid_memory_request"));
  for (const expectedCustody of [[], {}, { kind: "organization" }, { ...organizationCustody(), ownerUserId: "" },
    { ...organizationCustody(), projectId: "isolated-project" }, { ...organizationCustody(), organizationId: "x".repeat(4096) },
    Object.create({ kind: "personal" })]) {
    await assert.rejects(client.save({ ...preferences(), expectedCustody }), isClientError("invalid_memory_request"));
  }
  assert.equal(calls.length, 0);
});

test("isolated client binds a save acknowledgement to requested scope, revision and choices", async () => {
  const draft = preferences();
  for (const changed of [{ projectId: "other" }, { documentId: "other" }, { organizationId: "other" }, { revision: 7 }, { learn: false },
    { recall: false }, { background: false }, { retentionDays: 90 }, { timeZone: "America/New_York" }, { policyVersion: "personal-memory-v1" }]) {
    const response = saved(draft); Object.assign(response.enrollment, changed);
    const { client, calls } = fakeTransport(() => Response.json(response));
    await assert.rejects(client.save(draft), isClientError("memory_response_invalid", true, 200));
    assert.equal(calls.length, 1, "an invalid acknowledgement is not retried");
  }
});

test("isolated client sends exact organization custody and binds the receipt to its organization", async () => {
  const draft = { ...preferences(), expectedCustody: organizationCustody() };
  const { client, calls } = fakeTransport(() => Response.json(saved(draft)));
  assert.equal((await client.save(draft)).enrollment.organizationId, draft.expectedCustody.organizationId);
  assert.deepEqual(JSON.parse(calls[0].init.body).expectedCustody, draft.expectedCustody);
  for (const organizationId of [null, "other-organization"]) {
    const response = saved(draft); response.enrollment.organizationId = organizationId;
    const rejected = fakeTransport(() => Response.json(response));
    await assert.rejects(rejected.client.save(draft), isClientError("memory_response_invalid", true, 200));
    assert.equal(rejected.calls.length, 1);
  }
});

test("isolated client snapshots mutable preference input before awaiting transport", async () => {
  const custody = organizationCustody(), draft = { ...preferences(), expectedCustody: custody };
  const original = { ...draft, expectedCustody: { ...custody } }; let finish;
  const { client, calls } = fakeTransport(() => new Promise(resolve => { finish = resolve; }));
  const pending = client.save(draft); draft.documentId = "changed-after-dispatch"; draft.learn = false;
  custody.organizationId = "changed-organization"; custody.projectAccessId = "changed-access"; custody.ownerUserId = "changed-owner";
  draft.expectedCustody = { kind: "personal" };
  finish(Response.json(saved(original)));
  assert.equal((await pending).enrollment.documentId, original.documentId);
  assert.deepEqual(JSON.parse(calls[0].init.body), original);
});

test("isolated client can forget an older-policy enrollment while deployment admission is off", async () => {
  const item = enrollment({ policyVersion: "personal-memory-v1", learn: false, recall: false, background: false }), signal = new AbortController().signal;
  const { client, calls } = fakeTransport(url => Response.json(url.includes("?id=") ? forgotten() : settings([item])));
  assert.equal((await client.settings()).enabled, false);
  assert.deepEqual(await client.forget(item, signal), forgotten());
  assert.equal(calls[1].url, "/api/memory/settings?id=" + item.id); assertPrivateRequest(calls[1], "DELETE", signal);
  assert.deepEqual(JSON.parse(calls[1].init.body), { revision: item.revision, confirmation: "FORGET_MY_MEMORY" });
  const bad = fakeTransport(() => Response.json({ ...forgotten(), otherDevicesAndBackupsPurged: true }));
  await assert.rejects(bad.client.forget(item), isClientError("memory_response_invalid", true, 200));
});

test("isolated client recall preserves explicitly untrusted bounded excerpts", async () => {
  const item = enrollment({ organizationId: "isolated-organization" }), body = recalled(item), signal = new AbortController().signal;
  body.rollingConversation.recent[0].user = "😀".repeat(512); // SQLite substr bounds Unicode code points, not UTF-16 code units.
  const { client, calls } = fakeTransport(() => Response.json(body));
  const receipt = await client.recall(item, signal);
  assert.deepEqual(receipt.value, body); assert.ok(receipt.remaining() > 0 && receipt.remaining() <= MEMORY_RECALL_MAX_AGE_MS);
  assert.equal(calls[0].url, "/api/memory/recall?id=" + item.id + "&outcomes=native-assisted-outcomes-v1&savedOutputs=native-saved-outputs-v1"); assertPrivateRequest(calls[0], "GET", signal);
});

test("isolated client refuses foreign scope and malformed bounded recall", async () => {
  const item = enrollment({ organizationId: "isolated-organization" });
  const corruptions = [body => { body.scope.organizationId = "other"; }, body => { body.scope.projectId = "other"; },
    body => { body.scope.documentId = "other"; }, body => { body.method = "semantic"; }, body => { body.coverage.bounded = false; },
    body => { body.coverage.sourceCount = 2; }, body => { body.sources.push(body.sources[0]); },
    body => { body.rollingConversation.recent[0].sourceEventId = "foreign-event"; },
    body => { body.rollingConversation.recent[0].assistant = "x".repeat(513); },
    body => { body.rollingConversation.completeFromStart = true; }, body => { body.consumption = { arbitrary_intent: 1 }; },
    body => { body.consumption.conversation = 65; }];
  for (const corrupt of corruptions) {
    const body = recalled(item); corrupt(body);
    await assert.rejects(fakeTransport(() => Response.json(body)).client.recall(item), isClientError("memory_response_invalid", false, 200));
  }
});

test("isolated client assisted outcomes coalesce the accepted decision and mutation inside the parent window", async () => {
  const item = enrollment(), body = assistedRecall(item);
  const { client, calls } = fakeTransport(() => Response.json(body));
  const receipt = await client.recall(item);
  assert.deepEqual(receipt.value.assistedOutcomes, body.assistedOutcomes);
  assert.equal(receipt.value.assistedOutcomes.outcomes.length, 2);
  assert.equal(calls.length, 1, "outcome details do not fetch additional documents or private actions");
});
test("isolated client missing assisted outcomes is unavailable rather than an empty history", async () => {
  const item = enrollment(), receipt = await fakeTransport(() => Response.json(recalled(item))).client.recall(item);
  assert.equal(Object.hasOwn(receipt.value, "assistedOutcomes"), false);
});
test("isolated client present invalid assisted outcomes reject the entire recall", async () => {
  const item = enrollment();
  for (const edit of [body => { body.assistedOutcomes = null; },
    body => { body.assistedOutcomes.version = "unknown-version"; },
    body => { body.assistedOutcomes.outcomes[0].mutation.sourceIndex = 0; },
    body => { body.assistedOutcomes.outcomes[0].independentEvidence = true; },
    body => { body.assistedOutcomes.outcomes[0].privateAction = "PRIVATE ACTION MUST NOT ESCAPE"; }]) {
    const body = assistedRecall(item); edit(body);
    await assert.rejects(fakeTransport(() => Response.json(body)).client.recall(item), isClientError("memory_response_invalid", false, 200));
  }
});
test("isolated client assisted outcomes retire with the clipped parent lease without renewal", async () => {
  const item = enrollment(), body = assistedRecall(item); recallBudget(body, 10);
  let time = { monotonic: 100, wall: -1000 };
  const receipt = await fakeTransport(() => Response.json(body), () => time).client.recall(item);
  assert.equal(receipt.remaining(), 10);
  time = { monotonic: 110, wall: -990 }; assert.equal(receipt.remaining(), 0);
  time = { monotonic: 100, wall: -1000 }; assert.equal(receipt.remaining(), 0);
});

test("isolated client saved output provenance coalesces retention references without another fetch", async () => {
  const item = enrollment(), body = savedOutputRecall(item);
  const { client, calls } = fakeTransport(() => Response.json(body));
  const receipt = await client.recall(item);
  assert.deepEqual(receipt.value.savedOutputs, body.savedOutputs);
  assert.equal(receipt.value.savedOutputs.outputs.length, 1);
  assert.equal(calls.length, 1);
});
test("isolated client saved output provenance distinguishes unavailable from an empty selected retention window", async () => {
  const item = enrollment(), body = recalled(item);
  const unavailable = await fakeTransport(() => Response.json(body)).client.recall(item);
  assert.equal(Object.hasOwn(unavailable.value, "savedOutputs"), false);
  body.savedOutputs = { ...savedOutputRecall(item).savedOutputs,
    coverage: { selectedSourceCount: 1, selectedRetentionActionCount: 0, certifiedOutputCount: 0,
      completeHistory: false, bounded: true, nativeImageJobsOnly: true }, outputs: [] };
  const empty = await fakeTransport(() => Response.json(body)).client.recall(item);
  assert.deepEqual(empty.value.savedOutputs.outputs, []);
});
test("isolated client malformed saved output provenance rejects the whole recall", async () => {
  const item = enrollment();
  for (const edit of [body => { body.savedOutputs = null; },
    body => { body.savedOutputs.version = "unknown-version"; },
    body => { body.savedOutputs.outputs[0].sourceIndexes = [0]; },
    body => { body.savedOutputs.outputs[0].sourceIndexes = [1, 1]; },
    body => { body.savedOutputs.outputs[0].sourceIndexes = [3, 2]; },
    body => { body.savedOutputs.outputs[0].sourceIndexes = [64]; },
    body => { body.savedOutputs.outputs[0].independentEvidence = true; },
    body => { body.savedOutputs.outputs[0].generatedAt = body.lifetime.validUntil; },
    body => { body.savedOutputs.outputs[0].mediaUrl = "PRIVATE OUTPUT MUST NOT ESCAPE"; },
    body => { body.savedOutputs.coverage.certifiedOutputCount = 3; },
    body => { body.savedOutputs.coverage.completeHistory = true; },
    body => { body.savedOutputs.outputs = []; body.savedOutputs.coverage.certifiedOutputCount = 0; }]) {
    const body = savedOutputRecall(item); edit(body);
    await assert.rejects(fakeTransport(() => Response.json(body)).client.recall(item), isClientError("memory_response_invalid", false, 200));
  }
});
test("isolated client partial saved output provenance does not claim complete retention coverage", async () => {
  const item = enrollment(), body = savedOutputRecall(item);
  body.savedOutputs.outputs[0].sourceIndexes = [1];
  const receipt = await fakeTransport(() => Response.json(body)).client.recall(item);
  assert.equal(receipt.value.savedOutputs.coverage.selectedRetentionActionCount, 3);
  assert.deepEqual(receipt.value.savedOutputs.outputs[0].sourceIndexes, [1]);
  assert.equal(receipt.value.savedOutputs.coverage.completeHistory, false);
});
test("isolated client saved output provenance shares irreversible parent lease retirement", async () => {
  const item = enrollment(), body = savedOutputRecall(item); recallBudget(body, 10);
  let time = { monotonic: 100, wall: -1000 };
  const receipt = await fakeTransport(() => Response.json(body), () => time).client.recall(item);
  assert.equal(receipt.remaining(), 10);
  time = { monotonic: 110, wall: -990 }; assert.equal(receipt.remaining(), 0);
  time = { monotonic: 100, wall: -1000 }; assert.equal(receipt.remaining(), 0);
});

test("isolated client accepts independently reconstructed rolling action counts and source references", async () => {
  const item = enrollment(), body = consumptionRecall(item);
  const receipt = await fakeTransport(() => Response.json(body)).client.recall(item);
  assert.deepEqual(receipt.value, body);
  assert.deepEqual(receipt.value.rollingConsumption.windows[0].document, { actions: { edit: 1 }, sourceIndexes: [2] });
  assert.deepEqual(receipt.value.rollingConsumption.windows[1].document, { actions: { encounter: 1, edit: 1 }, sourceIndexes: [1, 2] });
  const block = receipt.value.rollingConsumption.windows[0].blocks[0];
  assert.equal(receipt.value.sources[block.sourceIndex].blockId, "isolated-block");
});

test("isolated client preserves absent rolling consumption but rejects a malformed present field", async () => {
  const item = enrollment(), legacy = recalled(item);
  const receipt = await fakeTransport(() => Response.json(legacy)).client.recall(item);
  assert.equal(Object.hasOwn(receipt.value, "rollingConsumption"), false);
  for (const value of [null, false, [], {}, "unknown"]) {
    await assert.rejects(fakeTransport(() => Response.json({ ...legacy, rollingConsumption: value })).client.recall(item),
      isClientError("memory_response_invalid", false, 200));
  }
});

test("isolated client rejects fabricated rolling counts, coverage, targets and source indexes", async () => {
  const item = enrollment();
  const corruptions = [value => { value.version = "semantic-v1"; }, value => { value.basis = "inferred-preferences"; },
    value => { value.completeFromStart = true; }, value => { value.sourceLimit = 65; }, value => { value.sourceLimitReached = true; },
    value => { value.windows.pop(); }, value => { value.windows[0].windowDays = 14; },
    value => { value.windows[0].since = "2000-01-01T00:00:00.000Z"; },
    value => { value.windows[0].document.actions.edit = 2; }, value => { value.windows[0].document.actions.attention = 1; },
    value => { delete value.windows[0].document.actions.edit; }, value => { value.windows[0].document.sourceIndexes = [1]; },
    value => { value.windows[0].document.sourceIndexes = [2, 2]; }, value => { value.windows[0].document.sourceIndexes = [64]; },
    value => { value.windows[0].document.sourceIndexes = [2.5]; }, value => { value.windows[0].blocks[0].sourceIndex = 1; },
    value => { value.windows[0].blocks[0].actions.edit = 2; }, value => { value.windows[0].blocks[0].sourceIndexes = [0]; },
    value => { value.windows[0].blocks = []; }, value => { value.windows[0].blocks[0].blockId = "foreign-block"; },
    value => { value.authority = "complete"; }];
  for (const corrupt of corruptions) {
    const body = consumptionRecall(item); corrupt(body.rollingConsumption);
    const { client, calls } = fakeTransport(() => Response.json(body));
    await assert.rejects(client.recall(item), isClientError("memory_response_invalid", false, 200));
    assert.equal(calls.length, 1, "malformed optional results do not fall back or retry");
  }
  const retentionOverrun = consumptionRecall(item);
  retentionOverrun.sources[2].recordedAt = new Date(Date.parse(retentionOverrun.lifetime.checkedAt) - 30 * 86_400_000 + 1).toISOString();
  retentionOverrun.coverage.since = new Date(Date.parse(retentionOverrun.lifetime.checkedAt) - 40 * 86_400_000).toISOString();
  retentionOverrun.rollingConsumption.windows[0].document = { actions: {}, sourceIndexes: [] };
  retentionOverrun.rollingConsumption.windows[0].blocks = [];
  retentionOverrun.rollingConsumption.windows[1].since = new Date(Date.parse(retentionOverrun.lifetime.checkedAt) - 30 * 86_400_000).toISOString();
  await assert.rejects(fakeTransport(() => Response.json(retentionOverrun)).client.recall(item), isClientError("memory_response_invalid", false, 200));
});

test("isolated client checks retention-shortened windows and never invents complete empty history", async () => {
  const item = enrollment({ retentionDays: 2 }), body = recalled(item);
  body.coverage.since = new Date(Date.parse(body.lifetime.checkedAt) - 20 * 86_400_000).toISOString();
  body.sources = []; body.consumption = {}; body.rollingConversation.recent = []; body.coverage.sourceCount = 0;
  body.rollingConsumption = rollingLiveMemoryConsumption(body.sources, body.lifetime, body.coverage.since, item.retentionDays);
  const receipt = await fakeTransport(() => Response.json(body)).client.recall(item);
  assert.equal(receipt.value.rollingConsumption.completeFromStart, false);
  assert.ok(receipt.value.rollingConsumption.windows.every(window => Date.parse(body.lifetime.checkedAt) - Date.parse(window.since) === 2 * 86_400_000));
  body.rollingConsumption.windows[0].since = body.coverage.since;
  await assert.rejects(fakeTransport(() => Response.json(body)).client.recall(item), isClientError("memory_response_invalid", false, 200));
});

test("isolated rolling consumption expires and retires with the existing recall lease", async () => {
  const item = enrollment(), body = consumptionRecall(item); recallBudget(body, 10);
  let time = { monotonic: 100, wall: -1000 };
  const receipt = await fakeTransport(() => Response.json(body), () => time).client.recall(item);
  assert.equal(receipt.remaining(), 10);
  time = { monotonic: 110, wall: -990 }; assert.equal(receipt.remaining(), 0);
  time = { monotonic: 100, wall: -1000 }; assert.equal(receipt.remaining(), 0, "expired counts do not gain a separate lease");
  receipt.retire(); assert.equal(receipt.remaining(), 0);
});

test("isolated source-index references fit the byte limit with 64 maximum-length ASCII identifiers", async () => {
  const item = enrollment(), body = recalled(item);
  body.sources = Array.from({ length: 64 }, (_, index) => ({ eventId: String(index).padStart(512, "e"),
    type: "BlockPropertyEdited", blockId: String(index).padStart(512, "b"), recordedAt: body.lifetime.checkedAt, validUntil: body.lifetime.validUntil }));
  body.coverage.sourceCount = 64; body.consumption = { edit: 64 }; body.rollingConversation.recent = [];
  body.rollingConsumption = rollingLiveMemoryConsumption(body.sources, body.lifetime, body.coverage.since, item.retentionDays);
  assert.ok(new TextEncoder().encode(JSON.stringify(body)).byteLength < 131_072);
  const receipt = await fakeTransport(() => Response.json(body)).client.recall(item);
  assert.equal(receipt.value.rollingConsumption.sourceLimitReached, true);
  assert.equal(receipt.value.rollingConsumption.windows[0].blocks[63].sourceIndex, 63);
});

test("isolated lifetime parser captures an exact immutable bounded UTC contract", () => {
  const value = { version: MEMORY_RECALL_LIFETIME, checkedAt: "2026-09-03T12:00:00.000Z", validUntil: "2026-09-03T12:01:00.000Z" };
  for (const source of [value, Object.assign(Object.create(null), value), Object.freeze({ ...value })]) {
    const parsed = parseMemoryLifetime(source);
    assert.deepEqual(parsed, value); assert.notEqual(parsed, source); assert.equal(Object.isFrozen(parsed), true);
  }
  assert.equal(MEMORY_RECALL_MAX_AGE_MS, 60_000);
  assert.equal(memoryTimestamp(value.checkedAt), Date.parse(value.checkedAt));
  assert.ok(parseMemoryLifetime({ ...value, validUntil: "2026-09-03T12:00:00.001Z" }));
});

test("isolated lifetime parser rejects missing extra inherited accessor and noncanonical data", () => {
  const base = { version: MEMORY_RECALL_LIFETIME, checkedAt: "2026-09-03T12:00:00.000Z", validUntil: "2026-09-03T12:01:00.000Z" };
  const invalid = [undefined, null, [], {}, Object.create(base), { ...base, version: "future-lifetime" },
    { ...base, validUntil: base.checkedAt }, { ...base, validUntil: "2026-09-03T12:01:00.001Z" },
    { ...base, validUntil: "2026-09-03T11:59:59.999Z" }, { ...base, extra: 1 }, { ...base, [Symbol("extra")]: true }];
  for (const key of ["version", "checkedAt", "validUntil"]) {
    const missing = { ...base }; delete missing[key]; invalid.push(missing);
    const hidden = { ...base }; Object.defineProperty(hidden, key, { value: base[key], enumerable: false }); invalid.push(hidden);
    const accessor = { ...base }; let effects = 0;
    Object.defineProperty(accessor, key, { enumerable: true, get() { effects += 1; throw new Error("must not evaluate"); } });
    assert.equal(parseMemoryLifetime(accessor), null); assert.equal(effects, 0);
  }
  for (const timestamp of ["2026-09-03T12:00:00Z", "2026-09-03T12:00:00.000+00:00", "2026-02-30T12:00:00.000Z",
    "2026-09-03T24:00:00.000Z", "2026-09-03T12:00:00.000Z ", "+002026-09-03T12:00:00.000Z", "", 0, Infinity]) {
    assert.equal(memoryTimestamp(timestamp), null);
    invalid.push({ ...base, checkedAt: timestamp }, { ...base, validUntil: timestamp });
  }
  for (const value of invalid) assert.equal(parseMemoryLifetime(value), null);
});

test("isolated elapsed clock uses the larger full interval without depending on static wall skew", () => {
  for (const wall of [-1_000_000, 1_000_000, 9_000_000_000_000]) {
    const elapsed = createMemoryElapsed({ monotonic: 10, wall });
    assert.equal(elapsed.elapsed({ monotonic: 20, wall: wall + 3 }), 10);
    assert.equal(elapsed.elapsed({ monotonic: 21, wall: wall + 40 }), 40);
    assert.equal(elapsed.elapsed({ monotonic: 22, wall: wall + 40 }), 40);
    assert.equal(elapsed.elapsed({ monotonic: 80, wall: wall + 41 }), 70);
  }
});

test("isolated elapsed clock permanently retires on either regression nonfinite values or explicit retirement", () => {
  const start = { monotonic: 100, wall: 1000 };
  for (const invalid of [{ monotonic: 99, wall: 1001 }, { monotonic: 101, wall: 999 },
    { monotonic: NaN, wall: 1001 }, { monotonic: 101, wall: Infinity }]) {
    const elapsed = createMemoryElapsed(start);
    assert.equal(elapsed.elapsed(invalid), Infinity);
    assert.equal(elapsed.elapsed({ monotonic: 200, wall: 2000 }), Infinity);
  }
  for (const invalid of [{ monotonic: NaN, wall: 1000 }, { monotonic: -1, wall: 1000 }, { monotonic: 0, wall: Infinity }]) {
    assert.equal(createMemoryElapsed(invalid).elapsed(start), Infinity);
  }
  const elapsed = createMemoryElapsed(start);
  assert.equal(elapsed.elapsed({ monotonic: 120, wall: 1020 }), 20);
  assert.equal(elapsed.elapsed({ monotonic: 119, wall: 1030 }), Infinity, "regression is checked against the last observation, not only the start");
  const manual = createMemoryElapsed(start); manual.retire();
  assert.equal(manual.elapsed(start), Infinity);
});

function recallBudget(body, milliseconds) {
  body.lifetime.validUntil = new Date(Date.parse(body.lifetime.checkedAt) + milliseconds).toISOString();
  body.sources.forEach(source => { source.validUntil = body.lifetime.validUntil; });
  return body;
}

test("isolated client requires the coordinated lifetime contract and every source deadline", async () => {
  const item = enrollment();
  const corruptions = [body => { delete body.lifetime; }, body => { body.lifetime.version = "unknown"; },
    body => { body.lifetime.extra = true; }, body => { body.lifetime.validUntil = body.lifetime.checkedAt; },
    body => { body.lifetime.validUntil = new Date(Date.parse(body.lifetime.checkedAt) + 60_001).toISOString(); },
    body => { body.lifetime.checkedAt = body.lifetime.checkedAt.replace(".000", ""); body.lifetime.checkedAt += " "; },
    body => { delete body.sources[0].validUntil; }, body => { body.sources[0].validUntil = body.lifetime.checkedAt; },
    body => { body.sources[0].validUntil = new Date(Date.parse(body.lifetime.validUntil) - 1).toISOString(); },
    body => { body.sources[0].validUntil = new Date(Date.parse(item.expiresAt) + 1).toISOString(); },
    body => { body.sources[0].recordedAt = new Date(Date.parse(body.lifetime.checkedAt) + 1).toISOString(); },
    body => { body.sources[0].validUntil += " "; }];
  for (const corrupt of corruptions) {
    const body = recalled(item); corrupt(body);
    const { client, calls } = fakeTransport(() => Response.json(body));
    await assert.rejects(client.recall(item), isClientError("memory_response_invalid", false, 200));
    assert.equal(calls.length, 1, "invalid lifetime never triggers fallback or retry");
  }
  const body = recalled(item), nearExpiry = { ...item, expiresAt: new Date(Date.parse(body.lifetime.validUntil) - 1).toISOString() };
  await assert.rejects(fakeTransport(() => Response.json(body)).client.recall(nearExpiry), isClientError("memory_response_invalid", false, 200));
});

test("isolated client bounds an empty recall and accepts only still-positive local lifetime", async () => {
  const item = enrollment(), body = recallBudget(recalled(item), 1);
  body.sources = []; body.consumption = {}; body.coverage.sourceCount = 0; body.rollingConversation.recent = [];
  let time = { monotonic: 10, wall: -10_000 };
  const { client, calls } = fakeTransport(() => Response.json(body), () => time);
  const lease = await client.recall(item);
  assert.deepEqual(lease.value, body); assert.equal(lease.remaining(), 1);
  time = { monotonic: 11, wall: -9999 };
  assert.equal(lease.remaining(), 0); assert.equal(calls.length, 1);
});

test("isolated client subtracts delayed headers and body time with either clock dominant", { timeout: 1000 }, async () => {
  for (const dominant of ["monotonic", "wall"]) {
    const item = enrollment(), body = recallBudget(recalled(item), 1000);
    let time = { monotonic: 100, wall: -1_000_000 }, releaseHeaders, releaseBody, notifyReading;
    const reading = new Promise(resolve => { notifyReading = resolve; });
    const stream = new ReadableStream({ start(controller) {
      releaseBody = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close(); };
    }, pull() { notifyReading(); } }, { highWaterMark: 0 });
    const { client, calls } = fakeTransport(() => new Promise(resolve => { releaseHeaders = resolve; }), () => time);
    const pending = client.recall(item);
    time = dominant === "monotonic" ? { monotonic: 400, wall: -999_990 } : { monotonic: 110, wall: -999_700 };
    releaseHeaders(new Response(stream, { headers: { "content-type": "application/json" } }));
    await reading;
    time = dominant === "monotonic" ? { monotonic: 850, wall: -999_980 } : { monotonic: 120, wall: -999_250 };
    releaseBody();
    const lease = await pending;
    assert.equal(lease.remaining(), 250, "both request phases consume the same original budget");
    assert.equal(calls.length, 1);
  }
});

test("isolated client refuses a lease exhausted while headers or the body were pending", { timeout: 1000 }, async () => {
  for (const phase of ["headers", "body"]) {
    const item = enrollment(), body = recallBudget(recalled(item), 1000);
    let time = { monotonic: 0, wall: 0 }, release, notifyRead;
    const reading = new Promise(resolve => { notifyRead = resolve; });
    const { client, calls } = fakeTransport(() => phase === "headers" ? new Promise(resolve => { release = () => resolve(Response.json(body)); })
      : new Response(new ReadableStream({ start(controller) { release = () => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close();
      }; }, pull() { notifyRead(); } }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } }), () => time);
    const pending = client.recall(item);
    if (phase === "body") await reading;
    time = { monotonic: 1000, wall: 1000 }; release();
    await assert.rejects(pending, isClientError("memory_response_invalid", false, 200));
    assert.equal(calls.length, 1);
  }
});

test("isolated client samples again after JSON decoding and recall contract validation", async () => {
  const item = enrollment(), body = recallBudget(recalled(item), 1000); let reads = 0;
  const { client, calls } = fakeTransport(() => Response.json(body), () => {
    reads += 1;
    // Start, pre-transport, headers, chunk, end-of-body, then the final parsed-value lease check.
    return { monotonic: reads < 6 ? 0 : 1000, wall: reads < 6 ? 0 : 1000 };
  });
  await assert.rejects(client.recall(item), isClientError("memory_response_invalid", false, 200));
  assert.equal(reads, 6); assert.equal(calls.length, 1);
});

test("isolated client permanently retires expired regressing nonfinite and manually hidden leases", async () => {
  for (const fault of ["expiry", "monotonic-regression", "wall-regression", "nonfinite", "manual"]) {
    const item = enrollment(), body = recallBudget(recalled(item), 1000); let time = { monotonic: 100, wall: 1000 };
    const { client, calls } = fakeTransport(() => Response.json(body), () => time);
    const lease = await client.recall(item);
    assert.equal(lease.remaining(), 1000);
    time = { monotonic: 200, wall: 1400 }; assert.equal(lease.remaining(), 600);
    time = { monotonic: 201, wall: 1400 }; assert.equal(lease.remaining(), 600, "remaining never regains time");
    if (fault === "manual") lease.retire();
    else time = fault === "expiry" ? { monotonic: 1100, wall: 2000 }
      : fault === "monotonic-regression" ? { monotonic: 200, wall: 1401 }
        : fault === "wall-regression" ? { monotonic: 202, wall: 1399 } : { monotonic: NaN, wall: 1401 };
    assert.equal(lease.remaining(), 0);
    time = { monotonic: 202, wall: 1401 }; assert.equal(lease.remaining(), 0, "time recovery cannot revive an old receipt");
    assert.equal(calls.length, 1);
  }
});

test("isolated client fails closed on invalid initial or in-flight clock observations without retry", async () => {
  const item = enrollment(), body = recalled(item);
  for (const clock of [() => ({ monotonic: NaN, wall: 0 }), () => { throw new Error("PRIVATE CLOCK ERROR"); }]) {
    const { client, calls } = fakeTransport(() => Response.json(body), clock);
    await assert.rejects(client.recall(item), isClientError("memory_response_invalid", false, null));
    assert.equal(calls.length, 0);
  }
  let time = { monotonic: 100, wall: 1000 }, cancellations = 0;
  const stream = new ReadableStream({ cancel() { cancellations += 1; } });
  const { client, calls } = fakeTransport(() => {
    time = { monotonic: 99, wall: 1001 };
    return new Response(stream, { headers: { "content-type": "application/json" } });
  }, () => time);
  await assert.rejects(client.recall(item), isClientError("memory_response_invalid", false, 200));
  assert.equal(cancellations, 1); assert.equal(calls.length, 1);
});

test("isolated client sanitizes error bodies and preserves conflict status without retry", async () => {
  const draft = preferences();
  const conflict = fakeTransport(() => Response.json({ error: "memory_revision_changed", message: "PRIVATE SERVER TEXT" }, { status: 409 }));
  await assert.rejects(conflict.client.save(draft), error => {
    assert.ok(isClientError("memory_revision_changed", false, 409)(error)); assert.ok(!error.message.includes("PRIVATE")); return true;
  });
  assert.equal(conflict.calls.length, 1);
  const arbitrary = fakeTransport(() => Response.json({ error: "PRIVATE_ERROR_SECRET", message: "PRIVATE SERVER TEXT" }, { status: 403 }));
  await assert.rejects(arbitrary.client.settings(), error => {
    assert.ok(isClientError("memory_request_rejected", false, 403)(error)); assert.ok(!JSON.stringify(error).includes("PRIVATE")); return true;
  });
});

test("isolated client preserves custody rejection codes without exposing identities or automatically retrying", async () => {
  for (const [code, status] of [["explicit_memory_custody_required", 400], ["invalid_memory_custody", 400], ["memory_custody_changed", 409]]) {
    const { client, calls } = fakeTransport(() => Response.json({ error: code, message: "PRIVATE CUSTODY TEXT", organizationId: "PRIVATE OWNER" }, { status }));
    await assert.rejects(client.save(preferences()), error => {
      assert.ok(isClientError(code, false, status)(error)); assert.ok(!error.message.includes("PRIVATE"));
      assert.ok(!JSON.stringify(error).includes("PRIVATE")); return true;
    });
    assert.equal(calls.length, 1, "a custody mismatch cannot replace the caller's consent snapshot or trigger a retry");
  }
});

test("isolated client marks transport and server failures as uncertain mutations", async () => {
  const draft = preferences();
  const transport = fakeTransport(() => { throw new Error("PRIVATE TRANSPORT TEXT"); });
  await assert.rejects(transport.client.save(draft), isClientError("memory_request_failed", true, null));
  assert.equal(transport.calls.length, 1);
  const read = fakeTransport(() => { throw new Error("synthetic failure"); });
  await assert.rejects(read.client.settings(), isClientError("memory_request_failed", false, null));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transport.client.forget(enrollment(), controller.signal), isClientError("memory_request_cancelled", true, null));
  const server = fakeTransport(() => new Response("unavailable", { status: 500 }));
  await assert.rejects(server.client.save(draft), isClientError("memory_request_rejected", true, 500));
});

test("isolated client treats malformed successful mutation receipts as unknown, never as success", async () => {
  const draft = preferences();
  for (const response of [new Response("not json", { headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify(saved(draft)), { headers: { "content-type": "text/html" } }), new Response(null, { status: 204 })]) {
    const { client, calls } = fakeTransport(() => response);
    await assert.rejects(client.save(draft), isClientError("memory_response_invalid", true, response.status));
    assert.equal(calls.length, 1);
  }
});

test("isolated client bounds and cancels oversized HTTP response streams", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(131_073)); }, cancel() { cancelled = true; } });
  const { client, calls } = fakeTransport(() => new Response(stream, { headers: { "content-type": "application/json" } }));
  await assert.rejects(client.settings(), isClientError("memory_response_invalid", false, 200));
  assert.equal(cancelled, true); assert.equal(calls.length, 1);
});

test("isolated client rejects invalid bodies without awaiting stalled cleanup", { timeout: 1000 }, async () => {
  for (const variant of ["wrong-type", "fatal-utf8", "over-cap", "unexpected-success"]) {
    let cancellations = 0;
    const chunk = variant === "fatal-utf8" ? new Uint8Array([0xc3, 0x28])
      : variant === "over-cap" ? new Uint8Array(131_073) : new TextEncoder().encode("{}");
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(chunk); },
      cancel() { cancellations += 1; return new Promise(() => {}); },
    });
    const status = variant === "unexpected-success" ? 201 : 200;
    const { client, calls } = fakeTransport(() => new Response(stream, {
      status, headers: { "content-type": variant === "wrong-type" ? "text/html" : "application/json" },
    }));
    await assert.rejects(client.save(preferences()), isClientError("memory_response_invalid", true, status));
    assert.equal(cancellations, 1, variant + " cleans up exactly once without waiting");
    assert.equal(stream.locked, false); assert.equal(calls.length, 1);
  }
});

test("isolated client suppresses cleanup failures without replacing the primary error", { timeout: 1000 }, async () => {
  for (const mode of ["throw", "reject"]) {
    let cancellations = 0;
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([0xc3, 0x28])); },
      cancel() {
        cancellations += 1;
        if (mode === "throw") throw new Error("PRIVATE CLEANUP TEXT");
        return Promise.reject(new Error("PRIVATE CLEANUP TEXT"));
      },
    });
    const { client, calls } = fakeTransport(() => new Response(stream, { headers: { "content-type": "application/json" } }));
    await assert.rejects(client.settings(), error => {
      assert.ok(isClientError("memory_response_invalid", false, 200)(error)); assert.ok(!error.message.includes("PRIVATE")); return true;
    });
    assert.equal(cancellations, 1); assert.equal(calls.length, 1);
  }
});

test("isolated client classifies cancellation already signaled after headers and abandons the body", { timeout: 1000 }, async () => {
  for (const status of [200, 409, 503]) {
    const controller = new AbortController(); let cancellations = 0;
    const stream = new ReadableStream({ cancel() { cancellations += 1; return new Promise(() => {}); } });
    const { client, calls } = fakeTransport(() => {
      const response = new Response(stream, { status, headers: { "content-type": "application/json" } });
      controller.abort(); // Headers exist; this fake transport deliberately ignores the signal.
      return response;
    });
    await assert.rejects(client.save(preferences(), controller.signal), isClientError("memory_request_cancelled", true, status));
    assert.equal(cancellations, 1); assert.equal(calls.length, 1);
  }
});

test("isolated client aborts a stalled post-header read without awaiting cancellation or retrying", { timeout: 1000 }, async () => {
  for (const method of ["settings", "save", "forget", "recall", "exportReferences"]) {
    const controller = new AbortController(); let cancellations = 0, notifyRead;
    const startedReading = new Promise(resolve => { notifyRead = resolve; });
    const stream = new ReadableStream({
      pull() { notifyRead(); },
      cancel() { cancellations += 1; return new Promise(() => {}); },
    }, { highWaterMark: 0 });
    const { client, calls } = fakeTransport(() => new Response(stream, { headers: { "content-type": "application/json" } }));
    const pending = method === "settings" ? client.settings(undefined, controller.signal)
      : method === "save" ? client.save(preferences(), controller.signal) : client[method](enrollment(), controller.signal);
    await startedReading;
    controller.abort();
    await assert.rejects(pending, isClientError("memory_request_cancelled", method === "save" || method === "forget", 200));
    assert.equal(cancellations, 1); assert.equal(stream.locked, false); assert.equal(calls.length, 1);
  }
});

const exportActions = {
  DocumentOpened: "encounter", DocumentViewVisited: "encounter", ObjectViewed: "inspect", DocumentArtifactViewed: "inspect",
  ComparisonOpened: "compare", BlockCreated: "edit", BlockPropertyEdited: "edit", ChipEdited: "edit", BlockWeightSet: "edit",
  BlockLocked: "edit", BlockUnlocked: "edit", BlockRelationAdded: "edit", BlockRelationRemoved: "edit",
  BlockRemoved: "remove", BlockRestored: "restore", ObjectSaved: "commit", ObjectPinned: "commit", ObjectExported: "commit",
  DocumentArtifactExported: "commit", ArtifactApproved: "commit", CanvasItemPlaced: "reuse", CanvasReferenceCreated: "reuse",
  ContextSetFormalized: "reuse", ObjectDiscarded: "reject", ObjectCritiqued: "critique", ArtifactChangesRequested: "critique",
  ArtifactReviewRequested: "request", GenerationRequested: "request", DocumentRenderRequested: "request", ProposalAccepted: "accept",
  ProposalRejected: "reject", ProposalDeclined: "defer", BriefItemAccepted: "accept", BriefItemIgnored: "defer", BriefDismissed: "defer",
  AssistantReasoned: "conversation",
};
function exported(item, capturedAt = now()) {
  const captured = Date.parse(capturedAt), recordedAt = new Date(captured - 86_400_000).toISOString();
  return { format: "forma-memory-reference-export-v1", capturedAt,
    enrollment: Object.fromEntries(["id", "revision", "policyVersion", "retentionDays", "expiresAt"].map(key => [key, item[key]])),
    scope: { organizationId: item.organizationId, projectId: item.projectId, documentId: item.documentId },
    treatment: "untrusted-historical-evidence", method: "descriptive-source-references",
    deadlineSemantics: "retention-upper-bounds-not-an-access-lease",
    coverage: { since: new Date(captured - item.retentionDays * 86_400_000).toISOString(), throughSequence: item.throughSequence,
      remainingThroughSequence: item.cutoffSequence, completeFromStart: false, bounded: true, sourceLimit: 64, sourceCount: 1, moreEligibleSources: false },
    sources: [{ eventId: "isolated-export-event", sequence: 1, type: "AssistantReasoned", blockId: null, recordedAt,
      retentionExpiresAt: new Date(Math.min(Date.parse(item.expiresAt), Date.parse(recordedAt) + item.retentionDays * 86_400_000)).toISOString(), action: "conversation" }],
    includes: { prose: false, vectors: false, inferredPreferences: false, completeHistory: false } };
}
function exportSources(body, count, first = 1) {
  const original = body.sources[0];
  body.sources = Array.from({ length: count }, (_, index) => ({ ...original, eventId: `isolated-export-${index}`, sequence: first + index }));
  body.coverage.sourceCount = count;
  return body;
}

test("isolated export makes one explicit private revision-bound GET and returns newly serialized reference JSON", async () => {
  for (const organizationId of [null, "isolated-organization"]) {
    const item = enrollment({ organizationId }), body = exported(item), signal = new AbortController().signal;
    const raw = " \n" + JSON.stringify(body) + " \n";
    const { client, calls } = fakeTransport(() => new Response(raw, { headers: {
      "content-type": "application/json; charset=utf-8", "content-disposition": "attachment; filename=untrusted.html",
    } }));
    assert.equal(calls.length, 0, "construction never fetches or exports");
    const result = await client.exportReferences(item, signal);
    assert.equal(typeof result, "string"); assert.notEqual(result, raw); assert.equal(result, JSON.stringify(body, null, 2) + "\n");
    assert.deepEqual(JSON.parse(result), body); assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `/api/memory/export?id=${item.id}&revision=${item.revision}`);
    assertPrivateRequest(calls[0], "GET", signal); assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[0].init.headers["content-type"], undefined);
    await client.exportReferences(item, signal);
    assert.equal(calls.length, 2, "a second explicit export makes its own request, not a cached replay");
  }
});

test("isolated export owns its enrollment snapshot before waiting for headers", async () => {
  const item = enrollment({ organizationId: "isolated-organization" }), original = { ...item }, body = exported(original); let finish;
  const { client, calls } = fakeTransport(() => new Promise(resolve => { finish = resolve; }));
  const pending = client.exportReferences(item);
  Object.assign(item, { id: fixtureId(2), revision: 7, organizationId: null, projectId: "changed-project", documentId: "changed-document",
    policyVersion: "unknown", retentionDays: 1, expiresAt: "2000-01-01T00:00:00.000Z", recall: false, throughSequence: 100, cutoffSequence: 120 });
  finish(Response.json(body));
  assert.deepEqual(JSON.parse(await pending), body);
  assert.equal(calls[0].url, `/api/memory/export?id=${original.id}&revision=${original.revision}`);
});

test("isolated export refuses malformed inactive expired and canceled enrollment input before HTTP", async () => {
  const base = enrollment(), { client, calls } = fakeTransport(() => { throw new Error("must not dispatch"); });
  for (const changed of [{ id: "invalid" }, { revision: 0 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { recall: false },
    { policyVersion: "personal-memory-v1" }, { expiresAt: now() }, { expiresAt: "2000-01-01T00:00:00.000Z" },
    { retentionDays: 366 }, { organizationId: {} }, { documentId: "" }, { throughSequence: -1 }, { cutoffSequence: 9, backlog: true },
    { unexpected: "PRIVATE INPUT" }]) {
    await assert.rejects(client.exportReferences({ ...base, ...changed }), isClientError("invalid_memory_request", false, null));
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.exportReferences(base, controller.signal), isClientError("memory_request_cancelled", false, null));
  assert.equal(calls.length, 0);
  for (const clock of [() => ({ monotonic: NaN, wall: Date.now() }), () => { throw new Error("PRIVATE CLOCK"); }]) {
    const invalidClock = fakeTransport(() => Response.json(exported(base)), clock);
    await assert.rejects(invalidClock.client.exportReferences(base), isClientError("invalid_memory_request", false, null));
    assert.equal(invalidClock.calls.length, 0);
  }
});

test("isolated export binds every enrollment and scope field to the captured request", async () => {
  const item = enrollment({ organizationId: "isolated-organization" });
  for (const [group, key, value] of [["enrollment", "id", fixtureId(2)], ["enrollment", "revision", 2],
    ["enrollment", "policyVersion", "unknown"], ["enrollment", "retentionDays", 31], ["enrollment", "expiresAt", future() + " "],
    ["scope", "organizationId", null], ["scope", "projectId", "other"], ["scope", "documentId", "other"]]) {
    const body = exported(item); body[group][key] = value;
    const { client, calls } = fakeTransport(() => Response.json(body));
    await assert.rejects(client.exportReferences(item), isClientError("memory_response_invalid", false, 200));
    assert.equal(calls.length, 1);
  }
});

test("isolated export requires every exact schema key and rejects all unknown private fields", async () => {
  const item = enrollment();
  const select = [body => body, body => body.enrollment, body => body.scope, body => body.coverage, body => body.sources[0], body => body.includes];
  for (const pick of select) {
    const keys = Object.keys(pick(exported(item)));
    for (const key of keys) {
      const body = exported(item); delete pick(body)[key];
      await assert.rejects(fakeTransport(() => Response.json(body)).client.exportReferences(item), isClientError("memory_response_invalid", false, 200));
    }
    for (const key of ["unknown", "prose", "vectors", "user", "assistant", "payload", "lifetime", "validUntil"]) {
      if (keys.includes(key)) continue;
      const body = exported(item); pick(body)[key] = "PRIVATE CONTENT MUST NOT BE RETURNED";
      await assert.rejects(fakeTransport(() => Response.json(body)).client.exportReferences(item), error => {
        assert.ok(isClientError("memory_response_invalid", false, 200)(error)); assert.ok(!JSON.stringify(error).includes("PRIVATE")); return true;
      });
    }
  }
  for (const field of ["enrollment", "scope", "coverage", "sources", "includes"]) {
    for (const value of [null, "PRIVATE CONTENT", 1, false, {}]) {
      const body = exported(item); body[field] = value;
      await assert.rejects(fakeTransport(() => Response.json(body)).client.exportReferences(item), isClientError("memory_response_invalid", false, 200));
    }
  }
});

test("isolated export accepts only the exact sealed live-source type to action mapping", async () => {
  const item = enrollment({ throughSequence: 100 }), body = exportSources(exported(item), Object.keys(exportActions).length);
  body.sources.forEach((source, index) => { source.type = Object.keys(exportActions)[index]; source.action = exportActions[source.type]; });
  assert.deepEqual(JSON.parse(await fakeTransport(() => Response.json(body)).client.exportReferences(item)), body);
  for (const [type, action] of Object.entries(exportActions)) {
    const invalid = exported(item); invalid.sources[0].type = type; invalid.sources[0].action = action === "edit" ? "commit" : "edit";
    await assert.rejects(fakeTransport(() => Response.json(invalid)).client.exportReferences(item), isClientError("memory_response_invalid", false, 200));
  }
  for (const type of ["UnknownEvent", "AttentionEpisodeObserved", "ApplicationViewVisited", "ChatMessageSent", "CanvasTextApplied",
    "DocumentArtifactEdited", "ObjectUnpinned", "AddedToLibrary", "RemovedFromLibrary", "PromptFanOutputPromoted", "IdeationPromoted",
    "constructor", "__proto__", "toString", "", null, {}]) {
    const invalid = exported(item); invalid.sources[0].type = type;
    await assert.rejects(fakeTransport(() => Response.json(invalid)).client.exportReferences(item), isClientError("memory_response_invalid", false, 200));
  }
});

test("isolated export accepts background cursor progress and partial empty coverage without claiming completeness", async () => {
  const item = enrollment({ cutoffSequence: 20, backlog: true }), body = exported(item);
  body.coverage.throughSequence = 30; body.coverage.remainingThroughSequence = 40; body.sources[0].sequence = 25;
  assert.deepEqual(JSON.parse(await fakeTransport(() => Response.json(body)).client.exportReferences(item)), body);
  body.coverage.remainingThroughSequence = null;
  assert.deepEqual(JSON.parse(await fakeTransport(() => Response.json(body)).client.exportReferences(item)), body);
  exportSources(body, 0);
  assert.deepEqual(JSON.parse(await fakeTransport(() => Response.json(body)).client.exportReferences(item)), body);
  const emptyItem = enrollment({ throughSequence: 0 }), empty = exportSources(exported(emptyItem), 0);
  assert.equal(JSON.parse(await fakeTransport(() => Response.json(empty)).client.exportReferences(emptyItem)).coverage.completeFromStart, false);
  const cappedItem = enrollment({ throughSequence: 100 }), capped = exportSources(exported(cappedItem), 64, 2);
  for (const moreEligibleSources of [false, true]) {
    capped.coverage.moreEligibleSources = moreEligibleSources;
    assert.deepEqual(JSON.parse(await fakeTransport(() => Response.json(capped)).client.exportReferences({ ...cappedItem, throughSequence: 10 })), capped);
  }
});

test("isolated export rejects inconsistent coverage flags cutoffs dates and source limits", async () => {
  const item = enrollment({ throughSequence: 100 });
  const corruptions = [body => { body.format = "other"; }, body => { body.treatment = "trusted"; }, body => { body.method = "semantic"; },
    body => { body.deadlineSemantics = "access-lease"; }, body => { body.capturedAt = item.expiresAt; },
    body => { body.coverage.since = new Date(Date.parse(body.capturedAt) + 1).toISOString(); },
    body => { body.coverage.since = new Date(Date.parse(body.capturedAt) - item.retentionDays * 86_400_000 - 1).toISOString(); },
    body => { body.coverage.throughSequence = 99; }, body => { body.coverage.throughSequence = -1; },
    body => { body.coverage.throughSequence = 1.5; }, body => { body.coverage.throughSequence = Number.MAX_SAFE_INTEGER + 1; },
    body => { body.coverage.remainingThroughSequence = 99; }, body => { body.coverage.remainingThroughSequence = "100"; },
    body => { body.coverage.remainingThroughSequence = Number.MAX_SAFE_INTEGER + 1; },
    body => { body.coverage.bounded = false; }, body => { body.coverage.completeFromStart = true; }, body => { body.coverage.sourceLimit = 65; },
    body => { body.coverage.sourceCount = 0; }, body => { body.coverage.sourceCount = "1"; }, body => { body.coverage.moreEligibleSources = true; },
    body => { body.coverage.moreEligibleSources = "false"; }, body => { exportSources(body, 65); },
    body => { exportSources(body, 64); body.coverage.moreEligibleSources = true; },
    ...["prose", "vectors", "inferredPreferences", "completeHistory"].map(key => body => { body.includes[key] = true; })];
  for (const corrupt of corruptions) {
    const body = exported(item); corrupt(body);
    await assert.rejects(fakeTransport(() => Response.json(body)).client.exportReferences(item), isClientError("memory_response_invalid", false, 200));
  }
});

test("isolated export rejects duplicate unordered out-of-range and malformed source references", async () => {
  const item = enrollment();
  const corruptions = [body => { body.sources[0].eventId = ""; }, body => { body.sources[0].eventId = "e".repeat(513); },
    body => { body.sources[0].blockId = ""; }, body => { body.sources[0].blockId = "b".repeat(513); }, body => { body.sources[0].blockId = {}; },
    body => { body.sources[0].sequence = 0; }, body => { body.sources[0].sequence = 1.5; }, body => { body.sources[0].sequence = 11; },
    body => { body.sources[0].sequence = Number.MAX_SAFE_INTEGER + 1; }, body => { body.sources[0].sequence = "1"; },
    body => { exportSources(body, 2); body.sources[1].eventId = body.sources[0].eventId; },
    body => { exportSources(body, 2); body.sources[1].sequence = body.sources[0].sequence; },
    body => { exportSources(body, 2); body.sources.reverse(); }, body => { body.sources[0] = null; }];
  for (const corrupt of corruptions) {
    const body = exported(item); corrupt(body);
    await assert.rejects(fakeTransport(() => Response.json(body)).client.exportReferences(item), isClientError("memory_response_invalid", false, 200));
  }
});

test("isolated export validates canonical source dates and retention upper bounds at capture", async () => {
  const item = enrollment();
  const corruptions = [body => { body.sources[0].recordedAt = new Date(Date.parse(body.coverage.since) - 1).toISOString(); },
    body => { body.sources[0].recordedAt = new Date(Date.parse(body.capturedAt) + 1).toISOString(); },
    body => { body.sources[0].retentionExpiresAt = body.capturedAt; },
    body => { body.sources[0].retentionExpiresAt = new Date(Date.parse(item.expiresAt) + 1).toISOString(); },
    body => { body.sources[0].retentionExpiresAt = new Date(Date.parse(body.sources[0].recordedAt) + item.retentionDays * 86_400_000 + 1).toISOString(); }];
  for (const field of ["capturedAt", "coverage.since", "sources.0.recordedAt", "sources.0.retentionExpiresAt"]) {
    for (const value of ["2026-09-04T12:00:00Z", "2026-09-04T12:00:00.000+00:00", "2026-02-30T12:00:00.000Z",
      "+002026-09-04T12:00:00.000Z", "2026-09-04T12:00:00.000Z ", "", null, 0]) {
      corruptions.push(body => { const parts = field.split("."), last = parts.pop(); parts.reduce((part, key) => part[key], body)[last] = value; });
    }
  }
  for (const corrupt of corruptions) {
    const body = exported(item); corrupt(body);
    await assert.rejects(fakeTransport(() => Response.json(body)).client.exportReferences(item), isClientError("memory_response_invalid", false, 200));
  }
  const captured = Date.now(), body = exported(item, new Date(captured).toISOString());
  body.sources[0].retentionExpiresAt = new Date(captured + 1).toISOString();
  const result = await fakeTransport(() => Response.json(body), () => ({ monotonic: 100, wall: captured + 2 })).client.exportReferences(item);
  assert.equal(typeof result, "string", "the completed point-in-time export is not a reusable source-access lease");
  assert.deepEqual(JSON.parse(result), body);
});

test("isolated export enforces the 65536 response byte cap while streaming regardless of declared length", { timeout: 2000 }, async () => {
  const item = enrollment(), body = exported(item), raw = JSON.stringify(body), bytes = new TextEncoder().encode(raw).byteLength;
  const exact = raw + " ".repeat(65_536 - bytes);
  assert.deepEqual(JSON.parse(await fakeTransport(() => new Response(exact, { headers: {
    "content-type": "application/json", "content-length": "1",
  } })).client.exportReferences(item)), body);
  for (const status of [200, 403, 503]) {
    let cancellations = 0, pulls = 0;
    const stream = new ReadableStream({ pull(controller) {
      pulls += 1; controller.enqueue(new TextEncoder().encode(pulls === 1 ? exact : " "));
    }, cancel() { cancellations += 1; return new Promise(() => {}); } }, { highWaterMark: 0 });
    const { client, calls } = fakeTransport(() => new Response(stream, { status, headers: {
      "content-type": "application/json", "content-length": "1",
    } }));
    await assert.rejects(client.exportReferences(item), isClientError(status === 200 ? "memory_response_invalid" : "memory_request_rejected", false, status));
    assert.equal(pulls, 2); assert.equal(cancellations, 1); assert.equal(stream.locked, false); assert.equal(calls.length, 1);
  }
});

test("isolated export handles split UTF8 and rejects malformed bodies or oversized rebuilt JSON", async () => {
  const item = enrollment(), body = exported(item); body.sources[0].eventId = "é".repeat(512); body.sources[0].blockId = "b".repeat(512);
  const bytes = new TextEncoder().encode(JSON.stringify(body)), boundary = bytes.indexOf(0xc3) + 1;
  const split = new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, boundary)); controller.enqueue(bytes.slice(boundary)); controller.close();
  } });
  assert.deepEqual(JSON.parse(await fakeTransport(() => new Response(split, { headers: { "content-type": "application/json" } })).client.exportReferences(item)), body);
  for (const response of [new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "text/html" } }), new Response("not json", { headers: { "content-type": "application/json" } }),
    new Response(null, { status: 204 }), new Response(JSON.stringify(body), { status: 201, headers: { "content-type": "application/json" } })]) {
    await assert.rejects(fakeTransport(() => response).client.exportReferences(item), isClientError("memory_response_invalid", false, response.status));
  }
  const cappedItem = enrollment({ throughSequence: 100 }), large = exportSources(exported(cappedItem), 64);
  large.sources.forEach((source, index) => { source.eventId = String(index).padStart(410, "e"); source.blockId = "b".repeat(410); });
  assert.ok(new TextEncoder().encode(JSON.stringify(large)).byteLength <= 65_536);
  assert.ok(new TextEncoder().encode(JSON.stringify(large, null, 2) + "\n").byteLength > 65_536);
  await assert.rejects(fakeTransport(() => Response.json(large)).client.exportReferences(cappedItem), isClientError("memory_response_invalid", false, 200));
});

test("isolated export preserves route rejection codes and safe status without retries or private messages", async () => {
  for (const [code, status] of [["memory_export_unavailable", 403], ["memory_revision_changed", 409], ["memory_disabled", 503],
    ["memory_schema_unavailable", 503], ["memory_revision_required", 400], ["memory_not_found", 404], ["PRIVATE ERROR", 403]]) {
    const { client, calls } = fakeTransport(() => Response.json({ error: code, message: "PRIVATE SERVER TEXT", prose: "PRIVATE PROSE" }, { status }));
    await assert.rejects(client.exportReferences(enrollment()), error => {
      assert.ok(isClientError(code === "PRIVATE ERROR" ? "memory_request_rejected" : code, false, status)(error));
      assert.ok(!error.message.includes("PRIVATE")); assert.ok(!JSON.stringify(error).includes("PRIVATE")); return true;
    });
    assert.equal(calls.length, 1);
  }
  const failed = fakeTransport(() => { throw new Error("PRIVATE TRANSPORT"); });
  await assert.rejects(failed.client.exportReferences(enrollment()), isClientError("memory_request_failed", false, null));
  assert.equal(failed.calls.length, 1);
});

test("isolated export rejects enrollment expiry crossed during headers body or final validation", { timeout: 2000 }, async () => {
  for (const phase of ["headers", "body", "validation"]) {
    const startedAt = Date.now(), item = enrollment({ expiresAt: new Date(startedAt + 1000).toISOString() }), body = exported(item, new Date(startedAt).toISOString());
    let time = { monotonic: 100, wall: startedAt }, release, notifyRead, samples = 0;
    const reading = new Promise(resolve => { notifyRead = resolve; });
    const { client, calls } = fakeTransport(() => phase === "headers" ? new Promise(resolve => { release = () => resolve(Response.json(body)); })
      : phase === "validation" ? Response.json(body)
        : new Response(new ReadableStream({ start(controller) { release = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close();
        }; }, pull() { notifyRead(); } }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } }), () => {
      samples += 1; return phase === "validation" && samples === 6 ? { monotonic: 1100, wall: startedAt + 1000 } : time;
    });
    const pending = client.exportReferences(item);
    if (phase === "body") await reading;
    if (phase !== "validation") { time = { monotonic: 1100, wall: startedAt + 1000 }; release(); }
    await assert.rejects(pending, isClientError("memory_response_invalid", false, 200));
    assert.equal(calls.length, 1); if (phase === "validation") assert.equal(samples, 6);
  }
});

test("isolated export fails closed on regressing nonfinite and monotonic-expired in-flight clocks", async () => {
  const startedAt = Date.now(), item = enrollment({ expiresAt: new Date(startedAt + 1000).toISOString() }), body = exported(item, new Date(startedAt).toISOString());
  for (const fault of [{ monotonic: 99, wall: startedAt + 1 }, { monotonic: 101, wall: startedAt - 1 },
    { monotonic: NaN, wall: startedAt + 1 }, { monotonic: 1100, wall: startedAt + 1 }]) {
    let time = { monotonic: 100, wall: startedAt }, cancellations = 0;
    const stream = new ReadableStream({ cancel() { cancellations += 1; } });
    const { client, calls } = fakeTransport(() => { time = fault; return new Response(stream, { headers: { "content-type": "application/json" } }); }, () => time);
    await assert.rejects(client.exportReferences(item), isClientError("memory_response_invalid", false, 200));
    assert.equal(cancellations, 1); assert.equal(calls.length, 1);
  }
  let time = { monotonic: 100, wall: startedAt };
  const valid = fakeTransport(() => { time = { monotonic: 1099, wall: startedAt + 999 }; return Response.json(body); }, () => time);
  assert.deepEqual(JSON.parse(await valid.client.exportReferences(item)), body);
});

test("isolated export observes cancellation after headers for success and route rejections", { timeout: 2000 }, async () => {
  for (const status of [200, 403, 409, 503]) {
    const controller = new AbortController(); let cancellations = 0;
    const stream = new ReadableStream({ cancel() { cancellations += 1; return new Promise(() => {}); } });
    const { client, calls } = fakeTransport(() => { controller.abort(); return new Response(stream, { status, headers: { "content-type": "application/json" } }); });
    await assert.rejects(client.exportReferences(enrollment(), controller.signal), isClientError("memory_request_cancelled", false, status));
    assert.equal(cancellations, 1); assert.equal(calls.length, 1);
  }
  const item = enrollment(), body = exported(item), controller = new AbortController(); let samples = 0;
  const { client } = fakeTransport(() => Response.json(body), () => {
    samples += 1; if (samples === 6) controller.abort();
    return { monotonic: 100, wall: Date.now() };
  });
  await assert.rejects(client.exportReferences(item, controller.signal), isClientError("memory_request_cancelled", false, 200));
  assert.equal(samples, 6);
});

// Optional recorded-navigation attachment. All earlier complete cases remain above.
const { MEMORY_CONSUMPTION_EPISODES_VERSION, parseMemoryConsumptionEpisodes } = await import("../src/model/memory-consumption-episodes.ts");
const visitOption = () => ({ consumptionEpisodes: true });
function visitRecall(item, count = 2, body = recalled(item)) {
  const first = body.sources.length;
  for (let index = 0; index < count; index++) body.sources.push({ eventId: "recorded-visit-" + index,
    type: "DocumentViewVisited", blockId: null, recordedAt: body.lifetime.checkedAt, validUntil: body.lifetime.validUntil });
  body.coverage.sourceCount = body.sources.length;
  if (count) body.consumption.encounter = (body.consumption.encounter ?? 0) + count;
  body.consumptionEpisodes = { version: MEMORY_CONSUMPTION_EPISODES_VERSION, treatment: "descriptive-consumption",
    validUntil: body.lifetime.validUntil, episodes: body.sources.slice(first).map((source, offset) => ({
      episodeId: null, documentId: item.documentId, blockId: null, resourceRevision: null,
      observations: [{ sourceIndex: first + offset, kind: "visit", copiedFrom: null }], origins: ["unknown"], provenanceSourceIndexes: [],
      firstRecordedAt: source.recordedAt, lastRecordedAt: source.recordedAt, validUntil: source.validUntil, independentEvidence: false,
    })), coverage: { eligibleSourceCount: body.sources.length, observationCount: count, compensatedObservationCount: 0,
      unresolvedCompensationCount: 0, incompleteLineageCount: count, completeHistory: false, bounded: true },
    attention: "not-measured", comprehension: "not-measured", inferredPreferences: false };
  return body;
}
function parseVisits(body, item) {
  return parseMemoryConsumptionEpisodes(body.consumptionEpisodes, body.sources, body.lifetime, item.documentId);
}
function visitSubset(body, indexes) {
  body.consumptionEpisodes.episodes = body.consumptionEpisodes.episodes.filter((_, index) => indexes.includes(index));
  body.consumptionEpisodes.coverage.observationCount = indexes.length;
  body.consumptionEpisodes.coverage.incompleteLineageCount = indexes.length;
  return body;
}

test("isolated visit opt-in preserves the exact default recall URL for absent empty and false options", async () => {
  const item = enrollment(), url = `/api/memory/recall?id=${item.id}&outcomes=native-assisted-outcomes-v1&savedOutputs=native-saved-outputs-v1`;
  for (const options of [undefined, {}, { consumptionEpisodes: false }]) {
    const { client, calls } = fakeTransport(() => Response.json(recalled(item)));
    const lease = await client.recall(item, undefined, options);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, url);
    assert.equal(Object.hasOwn(lease.value, "consumptionEpisodes"), false);
  }
});
test("isolated visit opt-in adds only the exact version to one private cancellable GET", async () => {
  const item = enrollment(), body = visitRecall(item), signal = new AbortController().signal;
  const { client, calls } = fakeTransport(() => Response.json(body));
  const lease = await client.recall(item, signal, visitOption());
  assert.equal(calls.length, 1); assertPrivateRequest(calls[0], "GET", signal);
  assert.equal(calls[0].url, `/api/memory/recall?id=${item.id}&outcomes=native-assisted-outcomes-v1&savedOutputs=native-saved-outputs-v1&consumptionEpisodes=memory-consumption-episodes-v1`);
  assert.deepEqual(lease.value.consumptionEpisodes, body.consumptionEpisodes);
});
test("isolated visit opt-in snapshots the explicit option before awaiting headers", async () => {
  const item = enrollment(), options = visitOption(); let release;
  const { client, calls } = fakeTransport(() => new Promise(resolve => { release = resolve; }));
  const pending = client.recall(item, undefined, options);
  options.consumptionEpisodes = false;
  Object.defineProperty(options, "consumptionEpisodes", { get() { throw new Error("option reread"); } });
  release(Response.json(visitRecall(item)));
  const lease = await pending;
  assert.equal(lease.value.consumptionEpisodes.episodes.length, 2); assert.equal(calls.length, 1);
});
test("isolated visit opt-in rejects malformed options before HTTP without executing accessors", async () => {
  let getterReads = 0;
  const getter = Object.defineProperty({}, "consumptionEpisodes", { enumerable: true, get() { getterReads++; return true; } });
  const hidden = Object.defineProperty({}, "consumptionEpisodes", { value: true });
  for (const options of [null, true, "true", [], { consumptionEpisodes: undefined }, { consumptionEpisodes: 1 },
    { consumptionEpisodes: "true" }, { consumptionEpisodes: true, extra: false }, getter, hidden,
    { [Symbol("extra")]: true }, Object.create({ consumptionEpisodes: true }), Object.assign(Object.create(null), visitOption())]) {
    const { client, calls } = fakeTransport(() => { throw new Error("must not dispatch"); });
    await assert.rejects(client.recall(enrollment(), undefined, options), isClientError("invalid_memory_request", false));
    assert.equal(calls.length, 0);
  }
  assert.equal(getterReads, 0);
});
test("isolated visit opt-in rejects every unsolicited projection without retry", async () => {
  const item = enrollment();
  for (const options of [undefined, {}, { consumptionEpisodes: false }]) for (const value of [null, {}, visitRecall(item).consumptionEpisodes]) {
    const body = recalled(item); body.consumptionEpisodes = value;
    const { client, calls } = fakeTransport(() => Response.json(body));
    await assert.rejects(client.recall(item, undefined, options), isClientError("memory_response_invalid", false, 200));
    assert.equal(calls.length, 1);
  }
});
test("isolated visit opt-in keeps old-server absence distinct from valid empty and partial subsets", async () => {
  const item = enrollment();
  const absent = await fakeTransport(() => Response.json(recalled(item))).client.recall(item, undefined, visitOption());
  assert.equal(Object.hasOwn(absent.value, "consumptionEpisodes"), false);
  for (const indexes of [[], [1]]) {
    const body = visitSubset(visitRecall(item), indexes);
    const lease = await fakeTransport(() => Response.json(body)).client.recall(item, undefined, visitOption());
    assert.equal(lease.value.consumptionEpisodes.episodes.length, indexes.length);
    assert.equal(lease.value.consumptionEpisodes.coverage.eligibleSourceCount, 3);
    assert.equal(lease.value.consumptionEpisodes.coverage.completeHistory, false);
  }
});
test("isolated visit parser accepts empty parent and empty projection without claiming complete history", () => {
  const item = enrollment(), body = visitRecall(item, 0);
  body.sources = []; body.consumptionEpisodes.coverage.eligibleSourceCount = 0;
  const result = parseVisits(body, item);
  assert.deepEqual(result.episodes, []); assert.equal(result.coverage.completeHistory, false);
});
test("isolated visit parser reconstructs independent data without retaining caller arrays or objects", () => {
  const item = enrollment(), body = visitRecall(item), expected = structuredClone(body.consumptionEpisodes);
  const result = parseVisits(body, item); assert.deepEqual(result, expected);
  body.consumptionEpisodes.episodes[0].origins[0] = "assistant-assisted";
  body.consumptionEpisodes.episodes[0].observations[0].sourceIndex = 0;
  body.consumptionEpisodes.coverage.observationCount = 900;
  body.sources[1].recordedAt = "bad";
  assert.deepEqual(result, expected);
});
test("isolated visit parser allows a later episode deadline but never a child lease shorter than the parent", () => {
  const item = enrollment(), body = visitRecall(item);
  const later = new Date(Date.parse(body.lifetime.validUntil) + 1000).toISOString();
  body.sources[1].validUntil = later; body.consumptionEpisodes.episodes[0].validUntil = later;
  assert.ok(parseVisits(body, item));
  body.consumptionEpisodes.episodes[0].validUntil = new Date(Date.parse(body.lifetime.validUntil) - 1).toISOString();
  assert.equal(parseVisits(body, item), null);
});

const corruptVisit = [
  ["unknown version", body => { body.consumptionEpisodes.version = "future"; }],
  ["extra private key", body => { body.consumptionEpisodes.privateProse = "DO NOT EXPOSE"; }],
  ["wrong treatment", body => { body.consumptionEpisodes.treatment = "preference"; }],
  ["attention", body => { body.consumptionEpisodes.attention = "measured"; }],
  ["comprehension", body => { body.consumptionEpisodes.comprehension = "measured"; }],
  ["preferences", body => { body.consumptionEpisodes.inferredPreferences = true; }],
  ["complete history", body => { body.consumptionEpisodes.coverage.completeHistory = true; }],
  ["unbounded", body => { body.consumptionEpisodes.coverage.bounded = false; }],
  ["visit-only eligible count", body => { body.consumptionEpisodes.coverage.eligibleSourceCount = 2; }],
  ["wrong observation count", body => { body.consumptionEpisodes.coverage.observationCount = 1; }],
  ["known lineage", body => { body.consumptionEpisodes.coverage.incompleteLineageCount = 0; }],
  ["unsupported compensation count", body => { body.consumptionEpisodes.coverage.compensatedObservationCount = 1; }],
  ["unsupported unresolved count", body => { body.consumptionEpisodes.coverage.unresolvedCompensationCount = 1; }],
  ["string count", body => { body.consumptionEpisodes.coverage.observationCount = "2"; }],
  ["episode identity", body => { body.consumptionEpisodes.episodes[0].episodeId = "session"; }],
  ["foreign document", body => { body.consumptionEpisodes.episodes[0].documentId = "foreign"; }],
  ["block attribution", body => { body.consumptionEpisodes.episodes[0].blockId = "block"; }],
  ["content revision", body => { body.consumptionEpisodes.episodes[0].resourceRevision = "revision"; }],
  ["independence", body => { body.consumptionEpisodes.episodes[0].independentEvidence = true; }],
  ["origin", body => { body.consumptionEpisodes.episodes[0].origins = ["assistant-assisted"]; }],
  ["provenance", body => { body.consumptionEpisodes.episodes[0].provenanceSourceIndexes = [0]; }],
  ["inspection", body => { body.consumptionEpisodes.episodes[0].observations[0].kind = "inspection"; }],
  ["reuse", body => { body.consumptionEpisodes.episodes[0].observations[0].kind = "reuse"; }],
  ["copy", body => { body.consumptionEpisodes.episodes[0].observations[0].copiedFrom = { sourceIndex: 0, revision: null }; }],
  ["missing observation", body => { body.consumptionEpisodes.episodes[0].observations = []; }],
  ["multiple observations", body => { body.consumptionEpisodes.episodes[0].observations.push({ sourceIndex: 2, kind: "visit", copiedFrom: null }); }],
  ["negative index", body => { body.consumptionEpisodes.episodes[0].observations[0].sourceIndex = -1; }],
  ["fractional index", body => { body.consumptionEpisodes.episodes[0].observations[0].sourceIndex = 1.5; }],
  ["out of window", body => { body.consumptionEpisodes.episodes[0].observations[0].sourceIndex = 64; }],
  ["nonvisit source", body => { body.consumptionEpisodes.episodes[0].observations[0].sourceIndex = 0; }],
  ["duplicate reference", body => { body.consumptionEpisodes.episodes[1] = structuredClone(body.consumptionEpisodes.episodes[0]); }],
  ["reordered references", body => { body.consumptionEpisodes.episodes.reverse(); }],
  ["wrong first time", body => { body.consumptionEpisodes.episodes[0].firstRecordedAt = body.lifetime.validUntil; }],
  ["wrong last time", body => { body.consumptionEpisodes.episodes[0].lastRecordedAt = body.lifetime.validUntil; }],
  ["projection lease widening", body => { body.consumptionEpisodes.validUntil = new Date(Date.parse(body.lifetime.validUntil) + 1).toISOString(); }],
  ["projection lease shortening", body => { body.consumptionEpisodes.validUntil = new Date(Date.parse(body.lifetime.validUntil) - 1).toISOString(); }],
  ["episode exceeds source", body => { body.consumptionEpisodes.episodes[0].validUntil = new Date(Date.parse(body.sources[1].validUntil) + 1).toISOString(); }],
  ["episode below parent", body => { body.consumptionEpisodes.episodes[0].validUntil = new Date(Date.parse(body.lifetime.validUntil) - 1).toISOString(); }],
];
test("isolated visit parser and HTTP client reject malformed present subset contracts completely", async () => {
  const item = enrollment();
  for (const [label, corrupt] of corruptVisit) {
    const body = visitRecall(item); corrupt(body);
    assert.equal(parseVisits(body, item), null, label);
    const { client, calls } = fakeTransport(() => Response.json(body));
    await assert.rejects(client.recall(item, undefined, visitOption()), isClientError("memory_response_invalid", false, 200), label);
    assert.equal(calls.length, 1, label);
  }
  for (const value of [null, false, [], {}, 1, "visit"]) {
    const body = visitRecall(item); body.consumptionEpisodes = value;
    await assert.rejects(fakeTransport(() => Response.json(body)).client.recall(item, undefined, visitOption()), isClientError("memory_response_invalid", false, 200));
  }
});
test("isolated visit parser independently rejects malformed supplied sources scope and lifetime", () => {
  const item = enrollment();
  for (const corrupt of [
    body => { body.sources[1].eventId = body.sources[0].eventId; },
    body => { body.sources[1].eventId = " "; },
    body => { body.sources[1].type = "DocumentOpened"; },
    body => { body.sources[1].blockId = "block"; },
    body => { body.sources[1].recordedAt = body.lifetime.validUntil; },
    body => { body.sources[1].validUntil = body.lifetime.checkedAt; },
    body => { body.sources[0].validUntil = body.lifetime.checkedAt; },
    body => { body.sources[1].privatePayload = "DO NOT EXPOSE"; },
    body => { body.lifetime.checkedAt = "2026-02-30T00:00:00.000Z"; },
    body => { body.lifetime.validUntil = body.lifetime.checkedAt; },
    body => { body.lifetime.version = "future"; },
    body => { body.lifetime.extra = true; },
  ]) { const body = visitRecall(item); corrupt(body); assert.equal(parseVisits(body, item), null); }
  const body = visitRecall(item);
  assert.equal(parseMemoryConsumptionEpisodes(body.consumptionEpisodes, body.sources, body.lifetime, "foreign"), null);
  assert.equal(parseMemoryConsumptionEpisodes(body.consumptionEpisodes, body.sources, body.lifetime, ""), null);
});
test("isolated visit parser never invokes data getters at any supported input depth", () => {
  const item = enrollment(); let reads = 0;
  for (const locate of [body => [body.consumptionEpisodes, "version"], body => [body.consumptionEpisodes.coverage, "observationCount"],
    body => [body.consumptionEpisodes.episodes, "0"], body => [body.consumptionEpisodes.episodes[0], "documentId"],
    body => [body.consumptionEpisodes.episodes[0].observations[0], "kind"], body => [body.sources[1], "eventId"],
    body => [body.sources, "0"], body => [body.lifetime, "checkedAt"]]) {
    const body = visitRecall(item), [target, key] = locate(body);
    Object.defineProperty(target, key, { enumerable: true, get() { reads++; throw new Error("getter must not execute"); } });
    assert.equal(parseVisits(body, item), null);
  }
  assert.equal(reads, 0);
});
test("isolated visit parser rejects hidden symbol inherited sparse cyclic and exotic shapes", () => {
  const item = enrollment();
  for (const corrupt of [
    body => { Object.defineProperty(body.consumptionEpisodes, "private", { value: "hidden" }); },
    body => { Object.defineProperty(body.consumptionEpisodes.coverage, "observationCount", { value: 2, enumerable: false }); },
    body => { body.consumptionEpisodes.episodes[Symbol("private")] = true; },
    body => { body.sources[1][Symbol("private")] = true; },
    body => { Object.setPrototypeOf(body.consumptionEpisodes, { inherited: true }); },
    body => { Object.setPrototypeOf(body.sources[1], { inherited: true }); },
    body => { Object.setPrototypeOf(body.consumptionEpisodes.episodes, Object.create(Array.prototype)); },
    body => { delete body.consumptionEpisodes.episodes[0]; },
    body => { Object.defineProperty(body.sources, "0", { value: body.sources[0], enumerable: false }); },
    body => { body.consumptionEpisodes.episodes.extra = true; },
    body => { body.consumptionEpisodes.self = body.consumptionEpisodes; },
    body => { body.consumptionEpisodes.episodes[0].origins = new Set(["unknown"]); },
    body => { body.consumptionEpisodes.coverage.observationCount = NaN; },
    body => { body.consumptionEpisodes.coverage.observationCount = Infinity; },
  ]) { const body = visitRecall(item); corrupt(body); assert.equal(parseVisits(body, item), null); }
});
test("isolated visit parser rejects oversized arrays before enumeration or property getters", () => {
  const item = enrollment(); let keys = 0, gets = 0;
  const large = new Proxy(new Array(65), { ownKeys(target) { keys++; return Reflect.ownKeys(target); },
    get(target, key, receiver) { gets++; return Reflect.get(target, key, receiver); } });
  const body = visitRecall(item); body.consumptionEpisodes.episodes = large;
  assert.equal(parseVisits(body, item), null); assert.equal(keys, 0); assert.equal(gets, 0);
  body.consumptionEpisodes.episodes = []; body.sources = large;
  assert.equal(parseVisits(body, item), null); assert.equal(keys, 0); assert.equal(gets, 0);
});
test("isolated visit parser accepts the bounded maximum parent source window and well-formed Unicode IDs", () => {
  const item = enrollment({ documentId: "文".repeat(120) }), body = visitRecall(item, 63);
  for (let index = 0; index < body.sources.length; index++) body.sources[index].eventId = `${index}` + "界".repeat(238);
  const result = parseVisits(body, item);
  assert.equal(result.episodes.length, 63); assert.equal(result.coverage.eligibleSourceCount, 64);
  body.sources.push({ ...body.sources[0], eventId: "extra" });
  body.consumptionEpisodes.coverage.eligibleSourceCount = 65;
  assert.equal(parseVisits(body, item), null);
});
test("isolated visit opt-in coexists with saved-output provenance and retires with the same parent", async () => {
  const item = enrollment(), body = visitRecall(item, 1, savedOutputRecall(item));
  // The existing saved-output coverage includes the newly selected visit too.
  body.savedOutputs.coverage.selectedSourceCount = body.sources.length;
  let time = { monotonic: 0, wall: 0 };
  const { client, calls } = fakeTransport(() => Response.json(body), () => time);
  const lease = await client.recall(item, undefined, visitOption());
  assert.deepEqual(lease.value.savedOutputs, body.savedOutputs); assert.deepEqual(lease.value.consumptionEpisodes, body.consumptionEpisodes);
  lease.retire(); assert.equal(lease.remaining(), 0);
  time = { monotonic: -1, wall: -1 }; assert.equal(lease.remaining(), 0); assert.equal(calls.length, 1);
});
test("isolated visit opt-in delayed headers consume the original lease and never trigger a fallback", async () => {
  const item = enrollment(), body = visitRecall(item); let release, time = { monotonic: 0, wall: 0 };
  const budget = Date.parse(body.lifetime.validUntil) - Date.parse(body.lifetime.checkedAt);
  const { client, calls } = fakeTransport(() => new Promise(resolve => { release = resolve; }), () => time);
  const pending = client.recall(item, undefined, visitOption());
  time = { monotonic: budget, wall: budget }; release(Response.json(body));
  await assert.rejects(pending, isClientError("memory_response_invalid", false, 200)); assert.equal(calls.length, 1);
});
test("isolated visit opt-in aborts stalled response bodies without awaiting cleanup or retrying", { timeout: 1000 }, async () => {
  const item = enrollment(), controller = new AbortController(); let cancellations = 0, notifyRead;
  const reading = new Promise(resolve => { notifyRead = resolve; });
  const stream = new ReadableStream({ pull() { notifyRead(); }, cancel() { cancellations++; return new Promise(() => {}); } }, { highWaterMark: 0 });
  const { client, calls } = fakeTransport(() => new Response(stream, { headers: { "content-type": "application/json" } }));
  const pending = client.recall(item, controller.signal, visitOption()); await reading; controller.abort();
  await assert.rejects(pending, isClientError("memory_request_cancelled", false, 200));
  assert.equal(cancellations, 1); assert.equal(stream.locked, false); assert.equal(calls.length, 1);
});
test("isolated visit opt-in preserves the whole streamed response byte cap including UTF8", { timeout: 1000 }, async () => {
  const item = enrollment({ documentId: "文".repeat(120) }), body = visitRecall(item, 63);
  const json = JSON.stringify(body), bytes = new TextEncoder().encode(json);
  assert.ok(bytes.byteLength < 131_072 && bytes.byteLength > json.length);
  for (const over of [false, true]) {
    let cancellations = 0;
    const padded = new TextEncoder().encode(json + " ".repeat(131_072 - bytes.byteLength + Number(over)));
    const stream = new ReadableStream({ start(controller) { controller.enqueue(padded); if (!over) controller.close(); },
      cancel() { cancellations++; return new Promise(() => {}); } });
    const { client, calls } = fakeTransport(() => new Response(stream, { headers: { "content-type": "application/json" } }));
    if (over) await assert.rejects(client.recall(item, undefined, visitOption()), isClientError("memory_response_invalid", false, 200));
    else assert.equal((await client.recall(item, undefined, visitOption())).value.consumptionEpisodes.episodes.length, 63);
    assert.equal(cancellations, Number(over)); assert.equal(calls.length, 1);
  }
});
test("isolated visit opt-in preserves only the sanitized unsupported-version error code", async () => {
  const { client, calls } = fakeTransport(() => Response.json({ error: "memory_consumption_version_unsupported", message: "PRIVATE DIAGNOSTIC" }, { status: 400 }));
  await assert.rejects(client.recall(enrollment(), undefined, visitOption()), error => {
    isClientError("memory_consumption_version_unsupported", false, 400)(error);
    assert.doesNotMatch(error.message, /PRIVATE DIAGNOSTIC/u); return true;
  });
  assert.equal(calls.length, 1);
});
// S4 detached source-only HTTP privacy contracts; no native transaction or browser qualification.
const structuredCleanupFixture = (state = "pending", scopeKey = fixtureId(701)) => ({ scopeKey: state === "unreported" ? null : scopeKey, state });
const pendingForgetFixture = () => ({ erased: false, memoryWithdrawn: true, physicalCleanupPending: true,
  reEnrollmentRequired: true, otherDevicesAndBackupsPurged: false });

test("isolated structured privacy client distinguishes observed states and missing legacy status", async () => {
  for (const state of [undefined, "unreported", "absent", "active", "pending", "complete"]) {
    const item = enrollment(state === undefined ? {} : { structuredCleanup: structuredCleanupFixture(state) });
    const page = settings([item]), { client, calls } = fakeTransport(() => Response.json(page));
    const result = await client.settings();
    assert.deepEqual(result, page);
    assert.equal(Object.hasOwn(result.enrollments[0], "structuredCleanup"), state !== undefined);
    if (state !== undefined) assert.notEqual(result.enrollments[0].structuredCleanup, item.structuredCleanup);
    assert.equal(calls.length, 1, "inspection does not enroll, change preferences or retry");
  }
});

test("isolated structured privacy client retains a stable pending scope across fresh clients and replacement enrollments", async () => {
  const cleanup = structuredCleanupFixture(), old = enrollment({ learn: false, recall: false, background: false,
    status: "forgotten", structuredCleanup: cleanup });
  const replacement = enrollment({ id: fixtureId(2), revision: 2, learn: true, recall: true, background: false,
    structuredCleanup: cleanup });
  const before = fakeTransport(() => Response.json(settings([old])));
  const first = (await before.client.settings()).enrollments[0];
  const remounted = fakeTransport(() => Response.json(settings([replacement])));
  const second = (await remounted.client.settings()).enrollments[0];
  assert.notEqual(first.id, second.id); assert.notEqual(first.revision, second.revision);
  assert.deepEqual(first.structuredCleanup, second.structuredCleanup);
  assert.equal(first.learn, false); assert.equal(first.recall, false);
  assert.equal(second.learn, true); assert.equal(second.recall, true, "earlier cleanup does not rewrite current consent");
  assert.equal(before.calls.length, 1); assert.equal(remounted.calls.length, 1);
});

test("isolated structured privacy client rejects malformed and contradictory observed scope states", async () => {
  const valid = structuredCleanupFixture();
  const invalid = [null, false, [], {}, { scopeKey: valid.scopeKey }, { state: "pending" },
    { ...valid, state: "future-state" }, { ...valid, state: "unreported" }, { scopeKey: null, state: "complete" },
    { scopeKey: "a".repeat(63), state: "pending" }, { scopeKey: "A".repeat(64), state: "pending" },
    { ...valid, scopeKey: 701 }, { ...valid, holdReason: "PRIVATE HOLD" }, { ...valid, erased: true }];
  for (const structuredCleanup of invalid) {
    const { client, calls } = fakeTransport(() => Response.json(settings([enrollment({ structuredCleanup })])));
    await assert.rejects(client.settings(), error => {
      assert.ok(isClientError("memory_response_invalid", false, 200)(error));
      assert.ok(!JSON.stringify(error).includes("PRIVATE")); return true;
    });
    assert.equal(calls.length, 1);
  }
  const conflicting = [enrollment({ structuredCleanup: valid }),
    enrollment({ id: fixtureId(2), structuredCleanup: { ...valid, state: "complete" } })];
  await assert.rejects(fakeTransport(() => Response.json(settings(conflicting))).client.settings(),
    isClientError("memory_response_invalid", false, 200));
  conflicting[1].structuredCleanup = { ...valid };
  assert.deepEqual((await fakeTransport(() => Response.json(settings(conflicting))).client.settings()).enrollments, conflicting);
});

test("isolated structured privacy client acknowledges pending withdrawal separately from complete physical erasure", async () => {
  for (const receipt of [pendingForgetFixture(), forgotten()]) {
    const item = enrollment({ structuredCleanup: structuredCleanupFixture("active") }), signal = new AbortController().signal;
    const { client, calls } = fakeTransport(() => Response.json(receipt));
    const result = await client.forget(item, signal);
    assert.deepEqual(result, receipt); assert.equal(result.reEnrollmentRequired, true);
    assert.equal(result.otherDevicesAndBackupsPurged, false);
    if (!result.erased) { assert.equal(result.memoryWithdrawn, true); assert.equal(result.physicalCleanupPending, true); }
    assert.equal(item.learn, true); assert.equal(item.recall, true, "a receipt never mutates the caller's enrollment snapshot");
    assert.equal(calls.length, 1, "no automatic retry, status fetch or re-enrollment");
    assertPrivateRequest(calls[0], "DELETE", signal);
    assert.deepEqual(JSON.parse(calls[0].init.body), { revision: item.revision, confirmation: "FORGET_MY_MEMORY" });
  }
});

test("isolated structured privacy client rejects every incomplete or contradictory Forget tuple as unconfirmed", async () => {
  const pending = pendingForgetFixture(), invalid = [
    { ...pending, erased: true }, { ...pending, memoryWithdrawn: false }, { ...pending, physicalCleanupPending: false },
    { ...pending, reEnrollmentRequired: false }, { ...pending, otherDevicesAndBackupsPurged: true },
    { ...pending, scopeKey: fixtureId(701) }, { ...forgotten(), physicalCleanupPending: true },
    { ...forgotten(), memoryWithdrawn: false }, { ...pending, error: "memory_cleanup_pending" },
  ];
  for (const key of Object.keys(pending)) { const incomplete = { ...pending }; delete incomplete[key]; invalid.push(incomplete); }
  for (const body of invalid) {
    const { client, calls } = fakeTransport(() => Response.json(body));
    await assert.rejects(client.forget(enrollment()), isClientError("memory_response_invalid", true, 200));
    assert.equal(calls.length, 1);
  }
  for (const status of [201, 202, 409]) {
    const { client, calls } = fakeTransport(() => Response.json(pending, { status }));
    await assert.rejects(client.forget(enrollment()),
      isClientError(status === 409 ? "memory_request_rejected" : "memory_response_invalid", true, status));
    assert.equal(calls.length, 1, "a pending-looking body at another status is not acknowledged withdrawal");
  }
});

test("isolated structured privacy client treats uncertain mutation errors as unknown without exposing private details", async () => {
  for (const method of ["save", "forget"]) {
    for (const [body, code] of [[{ error: "memory_write_unconfirmed" }, "memory_write_unconfirmed"],
      [{ error: "memory_cleanup_pending", ...pendingForgetFixture() }, "memory_request_rejected"],
      [{ error: "memory_revision_changed", memoryWithdrawn: true }, "memory_revision_changed"],
      [{ error: "FUTURE PRIVATE ERROR", message: "PRIVATE PAYLOAD" }, "memory_request_rejected"],
      [{}, "memory_request_rejected"]]) {
      const { client, calls } = fakeTransport(() => Response.json(body, { status: 409 }));
      await assert.rejects(client[method](method === "save" ? preferences() : enrollment()), error => {
        assert.ok(isClientError(code, true, 409)(error)); assert.ok(!JSON.stringify(error).includes("PRIVATE")); return true;
      });
      assert.equal(calls.length, 1);
    }
    const malformed = fakeTransport(() => new Response("{", { status: 409, headers: { "content-type": "application/json" } }));
    await assert.rejects(malformed.client[method](method === "save" ? preferences() : enrollment()),
      isClientError("memory_request_rejected", true, 409));
    const rejected = fakeTransport(() => Response.json({ error: "memory_revision_changed" }, { status: 409 }));
    await assert.rejects(rejected.client[method](method === "save" ? preferences() : enrollment()),
      isClientError("memory_revision_changed", false, 409));
  }
});

test("isolated structured privacy client refresh observes current pending state without confirming a lost mutation acknowledgement", async () => {
  const observed = enrollment({ learn: false, recall: false, background: false, status: "forgotten",
    structuredCleanup: structuredCleanupFixture() });
  const { client, calls } = fakeTransport((_url, init) => {
    if (init.method === "DELETE") throw new Error("SYNTHETIC ACK LOST");
    return Response.json(settings([observed]));
  });
  let uncertainty;
  await assert.rejects(client.forget(enrollment()), error => {
    assert.ok(isClientError("memory_request_failed", true, null)(error)); uncertainty = error; return true;
  });
  assert.equal(calls.length, 1, "the client does not reconcile automatically");
  const fresh = await client.settings();
  assert.equal(fresh.enrollments[0].structuredCleanup.state, "pending");
  assert.equal(uncertainty.mutationUnknown, true, "a later observed state does not repair the missing acknowledgement");
  assert.equal(calls.length, 2); assert.equal(calls[1].init.method, "GET");
});

test("isolated structured privacy client keeps saved active settings and Stop-learning recall distinct from earlier pending cleanup", async () => {
  for (const learn of [true, false]) {
    const draft = { ...preferences(), learn, recall: true, background: false }, body = saved(draft);
    body.priorMemoryCleared = false; body.enrollment.structuredCleanup = structuredCleanupFixture();
    const { client, calls } = fakeTransport(() => Response.json(body));
    const result = await client.save(draft);
    assert.equal(result.enrollment.learn, learn); assert.equal(result.enrollment.recall, true);
    assert.equal(result.enrollment.structuredCleanup.state, "pending"); assert.equal(result.priorMemoryCleared, false);
    assert.equal(Object.hasOwn(result, "memoryWithdrawn"), false); assert.equal(calls.length, 1);
    const contradictory = { ...body, priorMemoryCleared: true };
    await assert.rejects(fakeTransport(() => Response.json(contradictory)).client.save(draft),
      isClientError("memory_response_invalid", true, 200));
  }
});

test("isolated structured privacy client rejects a pending receipt after cancellation and snapshots its Forget revision", async () => {
  let finish;
  const controller = new AbortController(), item = enrollment();
  const { client, calls } = fakeTransport(() => new Promise(resolve => { finish = resolve; }));
  const pending = client.forget(item, controller.signal), revision = item.revision;
  item.revision += 1; controller.abort(); finish(Response.json(pendingForgetFixture()));
  await assert.rejects(pending, isClientError("memory_request_cancelled", true, 200));
  assert.deepEqual(JSON.parse(calls[0].init.body), { revision, confirmation: "FORGET_MY_MEMORY" });
  assert.equal(calls.length, 1, "a late receipt cannot initiate another request");
});

test("isolated structured privacy client rejects one scope key reused for different observed scope identities", async () => {
  for (const changed of [{ projectId: "different-project" }, { documentId: "different-document" }, { organizationId: "different-organization" }]) {
    const cleanup = structuredCleanupFixture(), rows = [enrollment({ structuredCleanup: cleanup }),
      enrollment({ id: fixtureId(2), structuredCleanup: cleanup, ...changed })];
    const { client, calls } = fakeTransport(() => Response.json(settings(rows)));
    await assert.rejects(client.settings(), isClientError("memory_response_invalid", false, 200));
    assert.equal(calls.length, 1);
  }
});

test("isolated structured privacy client rejects terminal withdrawal status paired with enabled preferences", async () => {
  for (const status of ["forgotten", "revoked", "erased"]) {
    const terminal = enrollment({ status, learn: false, recall: false, background: false,
      structuredCleanup: structuredCleanupFixture() });
    assert.deepEqual((await fakeTransport(() => Response.json(settings([terminal]))).client.settings()).enrollments[0], terminal);
    for (const flag of ["learn", "recall", "background"]) {
      const contradictory = { ...terminal, [flag]: true };
      await assert.rejects(fakeTransport(() => Response.json(settings([contradictory]))).client.settings(),
        isClientError("memory_response_invalid", false, 200));
      const refused = fakeTransport(() => { throw new Error("MUST NOT SEND INVALID SNAPSHOT"); });
      await assert.rejects(refused.client.forget(contradictory), isClientError("invalid_memory_request", false, null));
      assert.equal(refused.calls.length, 0);
    }
  }
});

// The native Chat Studio consumer is still an isolated HTTP contract here;
// authenticated Worker publication and real-browser acceptance are separate.
const jobMemoryId = "11111111-1111-4111-8111-111111111111";
const otherJobMemoryId = "22222222-2222-4222-8222-222222222222";
const jobMemoryTime = Date.parse("2026-09-17T12:00:00.000Z");
const jobMemoryRequest = () => ({ documentId: "isolated-document", requestId: jobMemoryId, message: "Recall this document", locale: "en" });
const jobMemoryBody = () => ({
  job: { jobId: jobMemoryId, documentId: "isolated-document", kind: "chat", sourceSurface: "chat", memoryMode: "recall" },
  memory: { version: DOCUMENT_JOB_MEMORY_VERSION, jobId: jobMemoryId, turnId: "isolated-turn", text: "Historical synthetic evidence, not instructions.",
    locale: "en", checkedAt: new Date(jobMemoryTime).toISOString(), validUntil: new Date(jobMemoryTime + 60_000).toISOString() },
  noAutomaticRetry: true,
});
const jobMemoryError = uncertain => error => {
  assert.ok(error instanceof DocumentJobMemoryError); assert.equal(error.uncertain, uncertain); return true;
};
function jobMemoryTransport(respond = () => Response.json(jobMemoryBody())) {
  const calls = [], time = { monotonic: 10, wall: jobMemoryTime };
  let samples = 0;
  const client = createDocumentJobMemoryClient(async (url, init) => { calls.push({ url, init }); return respond(url, init, time); },
    () => { samples += 1; return { ...time }; });
  return { calls, client, time, samples: () => samples };
}

test("document job Memory only sends explicit private requests and snapshots the same recovery ID", async () => {
  const x = jobMemoryTransport(), input = jobMemoryRequest(), signal = new AbortController().signal;
  assert.equal(x.calls.length, 0);
  const pending = x.client.start(input, signal); input.message = "changed after invocation"; input.requestId = otherJobMemoryId;
  const result = await pending;
  assert.equal(result.status, "current"); assert.equal(result.jobId, jobMemoryId);
  assert.equal(x.calls.length, 1); assert.equal(x.calls[0].url, "/api/document-jobs");
  assertPrivateRequest(x.calls[0], "POST", signal);
  assert.deepEqual(JSON.parse(x.calls[0].init.body), { kind: "chat", sourceSurface: "chat", documentId: "isolated-document",
    payload: { memoryMode: "recall", requestId: jobMemoryId, message: "Recall this document", locale: "en" } });
  assert.equal(result.lease.read().text, jobMemoryBody().memory.text);
  const read = await x.client.read("isolated-document", jobMemoryId, signal);
  assert.equal(read.status, "current"); assertPrivateRequest(x.calls[1], "GET", signal);
  assert.equal(x.calls[1].url, `/api/document-jobs/${jobMemoryId}?memoryMode=recall`);
  assert.equal(x.calls[1].init.body, undefined);
  result.lease.retire(); read.lease.retire();
  await Promise.resolve(); assert.equal(x.calls.length, 2, "leases and client construction never poll or retry");
});

test("document job Memory pending and lost ACK preserve the original ID for manual recovery only", async () => {
  for (const body of [
    { job: jobMemoryBody().job, pending: true, noAutomaticRetry: true },
    { error: "memory_job_submission_unconfirmed", jobId: jobMemoryId, noAutomaticRetry: true },
  ]) {
    const x = jobMemoryTransport(() => Response.json(body, { status: 202 }));
    assert.deepEqual(await x.client.start(jobMemoryRequest()), { jobId: jobMemoryId, status: "pending", lease: null });
    await Promise.resolve(); assert.equal(x.calls.length, 1);
    await x.client.start(jobMemoryRequest());
    assert.equal(x.calls.length, 2); assert.equal(x.calls[0].init.body, x.calls[1].init.body);
  }
});

test("document job Memory rejects malformed status, scope, identity and text contracts without fallback", async () => {
  const mutations = [
    body => { body.noAutomaticRetry = false; }, body => { body.job.documentId = "another-document"; },
    body => { body.job.jobId = otherJobMemoryId; body.memory.jobId = otherJobMemoryId; },
    body => { body.job.kind = "preview"; }, body => { body.job.sourceSurface = "assistant"; },
    body => { delete body.job.memoryMode; }, body => { body.memory.jobId = otherJobMemoryId; },
    body => { body.memory.version = "unknown"; }, body => { body.memory.turnId = ""; },
    body => { body.memory.locale = "de"; }, body => { body.memory.text = "\ud800"; },
    body => { body.memory.text = "界".repeat(2_731); }, body => { body.memory.text = "  "; },
    body => { body.pending = true; }, body => { body.error = "unavailable"; },
    body => { body.memory.validUntil = new Date(jobMemoryTime + 60_001).toISOString(); },
    body => { body.memory.validUntil = body.memory.checkedAt; },
    body => { body.memory.checkedAt = "2026-09-17T12:00:00Z"; },
  ];
  for (const mutate of mutations) {
    const body = jobMemoryBody(); mutate(body);
    const x = jobMemoryTransport(() => Response.json(body));
    await assert.rejects(x.client.start(jobMemoryRequest()), jobMemoryError(true));
    assert.equal(x.calls.length, 1);
  }
  for (const status of [201, 202]) {
    const x = jobMemoryTransport(() => Response.json(jobMemoryBody(), { status }));
    await assert.rejects(x.client.start(jobMemoryRequest()), jobMemoryError(true)); assert.equal(x.calls.length, 1);
  }
  for (const body of [
    { job: jobMemoryBody().job, noAutomaticRetry: true },
    { error: "memory_job_submission_unconfirmed", jobId: otherJobMemoryId, noAutomaticRetry: true },
    { error: "memory_job_submission_unconfirmed", jobId: jobMemoryId, noAutomaticRetry: true, memory: jobMemoryBody().memory },
  ]) {
    const x = jobMemoryTransport(() => Response.json(body, { status: 202 }));
    await assert.rejects(x.client.start(jobMemoryRequest()), jobMemoryError(true)); assert.equal(x.calls.length, 1);
  }
  const get = jobMemoryTransport(() => Response.json({ error: "memory_job_submission_unconfirmed", jobId: jobMemoryId, noAutomaticRetry: true }, { status: 202 }));
  await assert.rejects(get.client.read("isolated-document", jobMemoryId), jobMemoryError(false));
});

test("document job Memory validates input before dispatch and has no paid or automatic error path", async () => {
  for (const changes of [{ requestId: "invalid" }, { documentId: "" }, { message: " " }, { message: "x".repeat(4_001) }, { locale: "de" }]) {
    const x = jobMemoryTransport();
    await assert.rejects(x.client.start({ ...jobMemoryRequest(), ...changes }), jobMemoryError(false)); assert.equal(x.calls.length, 0);
  }
  const aborted = jobMemoryTransport(), controller = new AbortController(); controller.abort();
  await assert.rejects(aborted.client.start(jobMemoryRequest(), controller.signal), jobMemoryError(false));
  assert.equal(aborted.calls.length, 0);
  for (const status of [401, 403, 404, 409, 429, 500, 503]) {
    const x = jobMemoryTransport(() => Response.json({ error: "unavailable" }, { status }));
    await assert.rejects(x.client.start(jobMemoryRequest()), jobMemoryError(status >= 500)); assert.equal(x.calls.length, 1);
  }
  const network = jobMemoryTransport(() => { throw new Error("synthetic network failure"); });
  await assert.rejects(network.client.start(jobMemoryRequest()), jobMemoryError(true)); assert.equal(network.calls.length, 1);
});

test("document job Memory immutable display lease includes transport time and samples clocks once", async () => {
  const x = jobMemoryTransport((_url, _init, time) => {
    time.monotonic += 5_000; time.wall += 5_000; return Response.json(jobMemoryBody());
  });
  const { lease } = await x.client.start(jobMemoryRequest());
  assert.equal(lease.remainingMs(), 55_000);
  const before = x.samples(); assert.equal(lease.remainingMs(), 55_000); assert.equal(x.samples() - before, 1);
  x.time.monotonic += 54_999; x.time.wall += 54_999;
  assert.equal(lease.remainingMs(), 1); assert.ok(lease.read());
  x.time.monotonic += 1; x.time.wall += 1; assert.equal(lease.read(), null);
  x.time.monotonic -= 30_000; x.time.wall -= 30_000; assert.equal(lease.read(), null, "backward clocks cannot renew an expired lease");
  assert.equal(x.calls.length, 1);
});

test("document job Memory retires on invalid clocks and permits only an explicit fresh certified GET", async () => {
  for (const mutate of [time => { time.wall -= 1; }, time => { time.monotonic -= 1; }, time => { time.wall = NaN; }]) {
    const x = jobMemoryTransport(), { lease } = await x.client.start(jobMemoryRequest());
    mutate(x.time); assert.equal(lease.remainingMs(), 0); assert.equal(lease.read(), null);
    x.time.wall = jobMemoryTime; x.time.monotonic = 10; assert.equal(lease.read(), null);
  }
  const x = jobMemoryTransport((_url, _init, time) => {
    const body = jobMemoryBody(); body.memory.checkedAt = new Date(time.wall).toISOString();
    body.memory.validUntil = new Date(time.wall + 60_000).toISOString(); return Response.json(body);
  });
  const first = await x.client.start(jobMemoryRequest()); x.time.monotonic += 60_001; x.time.wall += 60_001;
  assert.equal(first.lease.read(), null); assert.equal(x.calls.length, 1);
  const fresh = await x.client.read("isolated-document", jobMemoryId);
  assert.equal(fresh.lease.remainingMs(), 60_000); assert.equal(first.lease.read(), null);
  fresh.lease.retire(); assert.equal(fresh.lease.read(), null);
});

test("document job Memory bounds and cancels response streams without retaining an unsafe view", async () => {
  for (const response of [
    new Response("{}", { headers: { "content-type": "text/html" } }),
    new Response("{".repeat(262_145), { headers: { "content-type": "application/json" } }),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
  ]) {
    const x = jobMemoryTransport(() => response);
    await assert.rejects(x.client.start(jobMemoryRequest()), jobMemoryError(true)); assert.equal(x.calls.length, 1);
  }
  let cancelCount = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  const controller = new AbortController();
  const x = jobMemoryTransport(() => new Response(new ReadableStream({
    pull() { started(); return new Promise(() => {}); }, cancel() { cancelCount += 1; },
  }), { headers: { "content-type": "application/json" } }));
  const pending = x.client.start(jobMemoryRequest(), controller.signal); await ready; controller.abort();
  await assert.rejects(pending, jobMemoryError(true)); assert.equal(cancelCount, 1); assert.equal(x.calls.length, 1);
});


test('consumption v3 explicitly negotiates historical views without widening v1/v2 or the parent lease',async()=>{
  const item=enrollment(),body=artifactConsumptionRecall(item);body.consumptionEpisodes.version=MEMORY_CONSUMPTION_V3;
  const {client,calls}=fakeTransport(()=>Response.json(body));const result=await client.recall(item,undefined,{consumptionEpisodes:MEMORY_CONSUMPTION_V3});
  assert.deepEqual(result.value.consumptionEpisodes,body.consumptionEpisodes);assert.deepEqual(result.value.lifetime,body.lifetime);
  assert.ok(calls[0].url.endsWith('&consumptionEpisodes='+MEMORY_CONSUMPTION_V3));
  for(const option of [undefined,{consumptionEpisodes:true},{consumptionEpisodes:MEMORY_CONSUMPTION_V2}])await assert.rejects(client.recall(item,undefined,option),isClientError('memory_response_invalid',false,200));
  body.consumptionEpisodes.version=MEMORY_CONSUMPTION_V2;await assert.rejects(client.recall(item,undefined,{consumptionEpisodes:MEMORY_CONSUMPTION_V3}),isClientError('memory_response_invalid',false,200));
});
test('consumption v3 retains strict original identity, privacy and interpretation bounds',()=>{
  const item=enrollment();
  for(const mutate of [p=>{p.sources[0].target.documentId='foreign';},p=>{p.sources[0].target.revision=-1;},
    p=>{p.sources[0].target.contentSha256='missing';},p=>{p.inferredPreferences=true;},p=>{p.comprehension='measured';},
    p=>{p.coverage.completeHistory=true;},p=>{p.episodes[0].independentEvidence=true;},p=>{p.episodes[0].observations[0].kind='read';},
    p=>{p.sources[0].validUntil=new Date(Date.parse(item.expiresAt)+1).toISOString();},p=>{p.sources.push({...p.sources[0]});},
    p=>{p.version='memory-consumption-episodes-v4';}]){
    const body=artifactConsumptionRecall(item);body.consumptionEpisodes.version=MEMORY_CONSUMPTION_V3;mutate(body.consumptionEpisodes);
    assert.equal(parseMemoryConsumptionV3(body.consumptionEpisodes,body.lifetime,item.documentId,{since:body.coverage.since,expiresAt:item.expiresAt}),null);
  }
  const body=artifactConsumptionRecall(item);body.consumptionEpisodes.version=MEMORY_CONSUMPTION_V3;let invoked=0;
  Object.defineProperty(body.consumptionEpisodes.sources[0].target,'revision',{enumerable:true,get(){invoked++;return 0;}});
  assert.equal(parseMemoryConsumptionV3(body.consumptionEpisodes,body.lifetime,item.documentId,{since:body.coverage.since,expiresAt:item.expiresAt}),null);assert.equal(invoked,0);
});

for(const [version,parse] of [[MEMORY_CONSUMPTION_V3,parseMemoryConsumptionV3],[MEMORY_CONSUMPTION_V4,parseMemoryConsumptionV4]])test(version+' requires exact negotiation and preserves original/privacy limits',async()=>{
  const item=enrollment(),body=artifactConsumptionRecall(item);body.consumptionEpisodes.version=version;
  const {client,calls}=fakeTransport(()=>Response.json(body));const result=await client.recall(item,undefined,{consumptionEpisodes:version});
  assert.deepEqual(result.value.consumptionEpisodes,body.consumptionEpisodes);assert.deepEqual(result.value.lifetime,body.lifetime);assert.ok(calls[0].url.endsWith('&consumptionEpisodes='+version));
  for(const other of [MEMORY_CONSUMPTION_V2,MEMORY_CONSUMPTION_V3,MEMORY_CONSUMPTION_V4].filter(other=>other!==version))await assert.rejects(client.recall(item,undefined,{consumptionEpisodes:other}),isClientError('memory_response_invalid',false,200));
  for(const mutate of [p=>{p.sources[0].target.documentId='foreign';},p=>{p.sources[0].target.revision=-1;},p=>{p.sources[0].target.contentSha256='missing';},
    p=>{p.inferredPreferences=true;},p=>{p.comprehension='measured';},p=>{p.coverage.completeHistory=true;},p=>{p.episodes[0].independentEvidence=true;},
    p=>{p.episodes[0].observations[0].kind='read';},p=>{p.sources[0].validUntil=new Date(Date.parse(item.expiresAt)+1).toISOString();},p=>{p.sources.push({...p.sources[0]});}]){
    const value=structuredClone(body.consumptionEpisodes);mutate(value);assert.equal(parse(value,body.lifetime,item.documentId,{since:body.coverage.since,expiresAt:item.expiresAt}),null);
  }
  let invoked=0;Object.defineProperty(body.consumptionEpisodes.sources[0].target,'revision',{enumerable:true,get(){invoked++;return 0;}});
  assert.equal(parse(body.consumptionEpisodes,body.lifetime,item.documentId,{since:body.coverage.since,expiresAt:item.expiresAt}),null);assert.equal(invoked,0);
});

function blockConsumptionRecall(item){
  const body=artifactConsumptionRecall(item),p=body.consumptionEpisodes;p.version=MEMORY_CONSUMPTION_V5;p.coverage.unavailableBlockSourceCount=0;
  p.sources[0]={...p.sources[0],type:'BlockInspected',target:{kind:'block',documentId:item.documentId,blockId:'native-block',revision:7,stateSha256:'b'.repeat(64)}};p.episodes[0].observations[0].kind='inspector-open';return body;
}
test('consumption v5 strictly negotiates block source versions and keeps their own source map',async()=>{
  const item=enrollment(),body=blockConsumptionRecall(item),{client,calls}=fakeTransport(()=>Response.json(body));
  const result=await client.recall(item,undefined,{consumptionEpisodes:MEMORY_CONSUMPTION_V5});assert.deepEqual(result.value.consumptionEpisodes,body.consumptionEpisodes);assert.deepEqual(result.value.lifetime,body.lifetime);assert.ok(calls[0].url.endsWith('&consumptionEpisodes='+MEMORY_CONSUMPTION_V5));
  for(const version of [MEMORY_CONSUMPTION_V2,MEMORY_CONSUMPTION_V3,MEMORY_CONSUMPTION_V4])await assert.rejects(client.recall(item,undefined,{consumptionEpisodes:version}),isClientError('memory_response_invalid',false,200));
});
for(const fault of ['kind','document','block','revision','hash','sourceIndex','attention','meaning','coverage','extra','expired','accessor'])test('consumption v5 refuses '+fault,()=>{
  const item=enrollment(),body=blockConsumptionRecall(item),p=body.consumptionEpisodes,target=p.sources[0].target;let calls=0;
  if(fault==='kind')target.kind='document';if(fault==='document')target.documentId='foreign';if(fault==='block')target.blockId='';if(fault==='revision')target.revision=0;if(fault==='hash')target.stateSha256='missing';
  if(fault==='sourceIndex')p.episodes[0].observations[0].sourceIndex=1;if(fault==='attention')p.attention='measured';if(fault==='meaning')p.episodes[0].observations[0].kind='read';if(fault==='coverage')delete p.coverage.unavailableBlockSourceCount;
  if(fault==='extra')target.text='Forbidden block body';if(fault==='expired')p.sources[0].validUntil='2000-01-01T00:00:00.000Z';if(fault==='accessor')Object.defineProperty(target,'revision',{enumerable:true,get(){calls++;return 7;}});
  assert.equal(parseMemoryConsumptionV5(p,body.lifetime,item.documentId,{since:body.coverage.since,expiresAt:item.expiresAt}),null);assert.equal(calls,0);
});

function consumptionWindowFixture(){
  const item=enrollment(),body=blockConsumptionRecall(item),p=body.consumptionEpisodes,checked=Date.parse(body.lifetime.checkedAt);body.coverage.since=new Date(checked-30*86400000).toISOString();
  const definitions=[['document',0,'doc',0],['artifact',5,'artifact',0],['artifact',8,'artifact',1],['block',0,'block',3],['block',7,'block',4],['block',7+1/86400000,'block',5],['block',29,'other-block',1]];
  p.sources=definitions.map(([kind,days,id,revision],index)=>({eventId:'observed-'+index,type:kind==='document'?'DocumentViewVisited':kind==='artifact'?'DocumentArtifactViewed':'BlockInspected',recordedAt:new Date(checked-days*86400000).toISOString(),validUntil:p.validUntil,target:{kind,documentId:item.documentId,...(kind==='artifact'?{artifactId:id,artifactKind:'slides',revision,contentSha256:'a'.repeat(64)}:kind==='block'?{blockId:id,revision,stateSha256:'b'.repeat(64)}:{})}}));
  p.episodes=p.sources.map((source,index)=>({episodeId:null,observations:[{sourceIndex:index,kind:source.type==='DocumentViewVisited'?'visit':source.type==='DocumentArtifactViewed'?'viewer-open':'inspector-open'}],firstRecordedAt:source.recordedAt,lastRecordedAt:source.recordedAt,validUntil:source.validUntil,independentEvidence:false}));p.coverage.eligibleSourceCount=7;p.coverage.observationCount=7;
  const input=()=>[p,body.lifetime,item.documentId,{since:body.coverage.since,expiresAt:item.expiresAt}];return {item,body,p,input};
}
test('consumption windows: exact day boundaries, repeated openings and distinct resource versions',()=>{
  const f=consumptionWindowFixture(),view=memoryConsumptionWindows(...f.input());assert.ok(view);assert.equal(view.validUntil,f.body.lifetime.validUntil);assert.equal(view.completeHistory,false);
  assert.deepEqual(view.windows.map(({days,sourceIndexes,documentVisits,artifactOpenings,blockOpenings,distinctArtifacts,distinctBlocks})=>({days,sourceIndexes,documentVisits,artifactOpenings,blockOpenings,distinctArtifacts,distinctBlocks})),[
    {days:7,sourceIndexes:[0,1,3,4],documentVisits:1,artifactOpenings:1,blockOpenings:2,distinctArtifacts:1,distinctBlocks:1},
    {days:30,sourceIndexes:[0,1,2,3,4,5,6],documentVisits:1,artifactOpenings:2,blockOpenings:4,distinctArtifacts:1,distinctBlocks:2}]);
  const serial=JSON.stringify(view);for(const source of f.p.sources)assert.equal(serial.includes(source.eventId),false);assert.equal(serial.includes('other-block'),false);
  f.p.sources[0].eventId='mutated-after';assert.equal(JSON.stringify(view),serial,'No mutable input graph is retained');
});
test('consumption windows: empty inspected selection is not complete history and clamps to enrollment',()=>{
  const f=consumptionWindowFixture();f.p.sources=[];f.p.episodes=[];f.p.coverage.eligibleSourceCount=0;f.p.coverage.observationCount=0;f.p.coverage.truncated=true;f.body.coverage.since=new Date(Date.parse(f.body.lifetime.checkedAt)-1000).toISOString();
  const view=memoryConsumptionWindows(...f.input());assert.equal(view.completeHistory,false);assert.ok(view.windows.every(window=>window.since===f.body.coverage.since&&window.sourceIndexes.length===0&&window.documentVisits===0&&window.artifactOpenings===0&&window.blockOpenings===0));
});
for(const fault of ['foreign-scope','unsupported-version','future','duplicate','meaning','expiry','getter','extra'])test('consumption windows: reject unverified '+fault,()=>{
  const f=consumptionWindowFixture();let invoked=0;
  if(fault==='foreign-scope')f.p.sources[0].target.documentId='foreign';if(fault==='unsupported-version')f.p.version=MEMORY_CONSUMPTION_V4;if(fault==='future')f.p.sources[0].recordedAt=new Date(Date.parse(f.body.lifetime.checkedAt)+1).toISOString();
  if(fault==='duplicate')f.p.sources[1].eventId=f.p.sources[0].eventId;if(fault==='meaning')f.p.attention='measured';if(fault==='expiry')f.p.sources[0].validUntil=new Date(Date.parse(f.body.lifetime.validUntil)-1).toISOString();if(fault==='extra')f.p.completeHistory=true;
  if(fault==='getter')Object.defineProperty(f.body.lifetime,'checkedAt',{enumerable:true,get(){invoked++;return new Date().toISOString();}});
  assert.equal(memoryConsumptionWindows(...f.input()),null);assert.equal(invoked,0);
});

const {MEMORY_CONSUMPTION_V6,parseMemoryConsumptionV6}=await import('../src/model/memory-consumption-v2.ts');
function pageConsumptionRecall(){const f=consumptionWindowFixture();f.p.version=MEMORY_CONSUMPTION_V6;f.p.sources[0].target={kind:'page',documentId:f.item.documentId,view:'editor'};return f;}
test('consumption v6 negotiates canonical pages and preserves the old v5 shape',async()=>{
 const f=pageConsumptionRecall(),{client,calls}=fakeTransport(()=>Response.json(f.body));
 const result=await client.recall(f.item,undefined,{consumptionEpisodes:MEMORY_CONSUMPTION_V6});assert.deepEqual(result.value.consumptionEpisodes,f.p);assert.ok(calls[0].url.endsWith('&consumptionEpisodes='+MEMORY_CONSUMPTION_V6));
 assert.equal(parseMemoryConsumptionV5(...f.input()),null);assert.equal(parseMemoryConsumptionV6(...consumptionWindowFixture().input()),null);
 const windows=memoryConsumptionWindows(...f.input());assert.ok(windows);assert.equal(windows.windows[0].documentVisits,1);assert.deepEqual(windows.windows[0].pageVisits,[{view:'editor',count:1}]);
 assert.equal(Object.hasOwn(memoryConsumptionWindows(...consumptionWindowFixture().input()).windows[0],'pageVisits'),false);
});
for(const fault of ['view','url','kind','document','extra','getter','expired','meaning','sourceIndex'])test('consumption v6 refuses '+fault,()=>{
 const f=pageConsumptionRecall(),target=f.p.sources[0].target;let evaluated=0;
 if(fault==='view')target.view='unknown';if(fault==='url')target.view='/document/private?draft=secret';if(fault==='kind')target.kind='document';if(fault==='document')target.documentId='another';if(fault==='extra')target.focused=true;
 if(fault==='getter')Object.defineProperty(target,'view',{enumerable:true,get(){evaluated++;return 'editor';}});
 if(fault==='expired')f.p.sources[0].validUntil='2000-01-01T00:00:00.000Z';if(fault==='meaning')f.p.inferredPreferences=true;if(fault==='sourceIndex')f.p.episodes[0].observations[0].sourceIndex=1;
 assert.equal(parseMemoryConsumptionV6(...f.input()),null);assert.equal(evaluated,0);
});
