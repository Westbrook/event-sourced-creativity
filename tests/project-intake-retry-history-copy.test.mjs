// Permanent full-host/RAM regression from the immutable R2 observational proof.
import assert from "node:assert/strict";
import test from "node:test";
import {AUTHORED,createProjectIntakeFixture,captureUnsentIntake,assertComplete,intendedIds} from "./helpers/project-intake-fixture.mjs";
import {financial} from "./helpers/event-source-retirement-fixture.mjs";

const options = { concurrency: false, timeout: 45_000 };
const currentSource = x => x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership());
const intakePosts = x => x.h.requests.filter(row => row.url === "/api/events" && row.init.method === "POST" && row.body?.action === "project_intake");
const currentOwner = x => {
  const owners = x.f.components().filter(owner => owner.tag === "forma-projects");
  assert.equal(owners.length, 1);
  return owners[0];
};
function retainedRows(x) {
  const db = x.worker.sqlite, stream = x.worker.streamId;
  return {
    events: db.prepare("SELECT * FROM events WHERE stream_id=? ORDER BY sequence").all(stream),
    privatePayloads: db.prepare("SELECT secret.* FROM event_private_payloads secret JOIN events event ON event.event_id=secret.private_event_id WHERE event.stream_id=? ORDER BY secret.private_event_id").all(stream),
    receipts: db.prepare("SELECT * FROM event_client_receipts WHERE stream_id=? ORDER BY client_event_id").all(stream),
    financial: financial(x.worker),
  };
}

// Same actual source-denial/restoration composition as the current permanent
// project-intake-paused-original-retry/source-owner-lifetime tests. Restoring
// fixture environment policy is not a new authorizing server response.
async function retireRestoreAndResume(x, originalRows) {
  const key = "FORMA_PILOT_COHORT_ID", env = x.worker.env;
  const had = Object.hasOwn(env, key), previous = env[key], prior = x.h.intercept;
  const authority = x.h.store.captureAuthorizationScope();
  const before = { posts: intakePosts(x).length, dispatches: x.dispatches.length };
  let denial = null;
  const restorePolicy = () => { if (had) env[key] = previous; else delete env[key]; };
  env[key] = "synthetic-missing-retry-history-cohort";
  x.h.intercept = async request => {
    if (request.url.startsWith("/api/events?") && (request.init.method ?? "GET") === "GET") {
      const response = await x.worker.request(request.url, request.init);
      denial = { status: response.status, body: await response.clone().json() };
      return response;
    }
    return prior(request);
  };
  try {
    await assert.rejects(x.h.store.refreshEvents({ fromStart: true }), /Event stream returned 403/u);
    await x.f.settle();
    assert.equal(denial?.status, 403);
    assert.equal(denial?.body.error, "pilot_participant_required");
    assert.equal(currentSource(x), false);
    assert.equal(x.h.store.authorizationScopeActive(authority), true);
    for (const value of Object.values(AUTHORED)) assert.equal(x.f.renderer.markup.includes(value), false);
    assert.equal(x.f.tree().nodes.some(node => String(node.attributes.class ?? "").split(/\s+/u).includes("project-create-dialog")), false);
    assert.deepEqual(retainedRows(x), originalRows);
  } finally { x.h.intercept = prior; restorePolicy(); }

  await x.h.store.refreshSession();
  await x.h.store.refreshEvents();
  await x.f.settle();
  assert.equal(currentSource(x), true);
  assert.equal(x.h.store.authorizationScopeActive(authority), true);
  assert.equal(x.h.store.route.get(), "/projects");
  const owner = currentOwner(x);
  assert.equal(owner, x.owner, "Same original owner, not a new draft holding substituted private state");
  assert.equal(x.f.tree().visible("dialog").some(node => node.owner === owner), false);
  assert.equal(intakePosts(x).length, before.posts, "Denial/restoration never automatically commit or Check");
  assert.equal(x.dispatches.length, before.dispatches);
  assert.deepEqual(retainedRows(x), originalRows);

  const resume = x.f.find("button", node => node.owner.tag === "forma-ui-button" && node.owner.parentElement === owner
    && node.owner.label === x.f.i18n.system("Resume {title}", { title: "\u2068" + AUTHORED.name + "\u2069" }));
  assert.equal(Object.hasOwn(resume.attributes, "disabled"), false);
  await x.f.act(resume);
  assert.equal(intakePosts(x).length, before.posts, "Explicit Resume only reopens; it does not retry or Check");
  assert.equal(x.dispatches.length, before.dispatches);
  assert.deepEqual(retainedRows(x), originalRows);
  assert.deepEqual(x.visible().draft, AUTHORED);
  assert.equal(x.visible().editable, false);
  return { owner, authority, denial, before };
}

for (const locale of ["en", "ja"]) test("B2 retry history remains truthful after explicit Retry and Source restoration " + locale, options, async t => {
  const x = await createProjectIntakeFixture(t, { locale });
  const initialSource = x.h.store.captureSourceOwnership();
  const initialAuthority = x.h.store.captureAuthorizationScope();
  const initialFinancial = financial(x.worker);

  const events = await captureUnsentIntake(x), original = intendedIds(events);
  assert.equal(x.dispatches.length, 1);
  assert.equal(x.dispatches[0].body.intakeAction, "commit");
  assert.equal(x.dispatches[0].status, null, "Initial actual form dispatch was lost before the Worker");
  assert.equal((await x.canonical()).eventClientReceipts, 0);

  await x.check();
  assert.equal(x.dispatches.length, 2);
  const checked = x.dispatches[1];
  assert.equal(checked.body.intakeAction, "check");
  assert.deepEqual(checked.body.events, events);
  assert.equal(checked.status, 409);
  assert.equal(checked.reply.status, "unknown");
  assert.equal(checked.reply.error, "project_intake_unconfirmed");
  assert.equal((await x.canonical()).eventClientReceipts, 0);

  let lostRetry = null;
  x.setBehavior(async (stage, row) => {
    if (stage === "after-worker" && row.body.intakeAction === "commit") {
      assert.equal(lostRetry, null, "Only one deliberate retry is made");
      assertComplete(row);
      lostRetry = row; row.dropped = true;
      throw Error("Synthetic loss after the deliberate same-original Retry actually committed");
    }
  });
  try {
    const retry = x.submitButton();
    assert.equal(retry.text, x.f.i18n.t("projects.retryOriginal", "Retry same creation"));
    assert.equal(Object.hasOwn(retry.attributes, "disabled"), false);
    await x.submit();
  } finally { x.setBehavior(async () => {}); }
  assert.ok(lostRetry, "The real Retry committed before its response was lost");
  assertComplete(lostRetry);
  assert.deepEqual(lostRetry.body.events, events);
  assert.deepEqual(x.dispatches.map(row => row.body.intakeAction), ["commit", "check", "commit"]);
  assert.deepEqual(x.dispatches.map(row => row.body.events), [events, events, events]);
  assert.equal(x.h.store.sourceOwnershipActive(initialSource), true);
  assert.equal(x.h.store.authorizationScopeActive(initialAuthority), true);
  assert.equal(x.h.store.route.get(), "/projects");
  assert.equal(x.visible().modal, true);
  assert.equal(x.visible().editable, false);
  const canonical = await x.canonical(), originalRows = retainedRows(x);
  assert.equal(canonical.projects.length, 1);
  assert.equal(canonical.documents.length, 1);
  assert.equal(canonical.projects[0].projectId, original.projectId);
  assert.equal(canonical.documents[0].documentId, original.documentId);
  assert.equal(canonical.eventClientReceipts, 4);
  assert.deepEqual(canonical.delta.map(row => row.eventId), lostRetry.reply.appended.map(row => row.eventId));
  assert.deepEqual(originalRows.financial, initialFinancial);

  const restoration = await retireRestoreAndResume(x, originalRows);
  const status = x.f.find("p", node => node.owner === restoration.owner && node.attributes.role === "status");
  assert.ok(status.port.isConnected);
  assert.ok(status.text.trim(), "Capture actual current status, not a manufactured replacement string");
  const check = x.f.find("button", node => node.owner === restoration.owner && node.attributes.type === "button"
    && node.text === x.f.i18n.t("projects.checkOriginal", "Check original"));
  const retry = x.submitButton();
  assert.equal(Object.hasOwn(check.attributes, "disabled"), false);
  assert.equal(Object.hasOwn(retry.attributes, "disabled"), false);
  assert.equal(retry.text, x.f.i18n.t("projects.retryOriginal", "Retry same creation"));
  assert.deepEqual(await x.canonical(), canonical);
  assert.deepEqual(retainedRows(x), originalRows);
  assert.equal(intakePosts(x).length, 3, "Only initial commit, explicit Check and explicit same-original Retry");
  assert.equal(x.dispatches.filter(row => row.body.intakeAction === "commit").length, 2);
  assert.equal(x.dispatches.filter(row => row.body.intakeAction === "commit" && row.status === 200).length, 1);
  assert.equal(x.dispatches.length, 3);

  const historicalSentence = x.f.i18n.system("The original change is unconfirmed. It has not been resubmitted.");
  const existingRecoveryCopy = x.f.i18n.t("projects.originalUnconfirmed");
  t.diagnostic(JSON.stringify({ locale, original, explicitActions: x.dispatches.map(row => row.body.intakeAction),
    actualWorkerStatuses: x.dispatches.map(row => row.status), deliberateCommitRequests: 2, committedOriginals: 1,
    canonicalEventIds: canonical.delta.map(row => row.eventId), clientReceiptCount: canonical.eventClientReceipts,
    sameCurrentOwner: restoration.owner === x.owner, authorityCurrent: x.h.store.authorizationScopeActive(restoration.authority),
    sourceCurrent: currentSource(x), actualSourceDenial: restoration.denial.status,
    actualCurrentStatus: status.text, matchesAbsoluteNotResubmittedSentence: status.text === historicalSentence,
    existingTranslatedUnresolvedCheckRetryCopy: existingRecoveryCopy,
    automaticIntakeRequestsDuringDenialRestoreResume: intakePosts(x).length - restoration.before.posts,
    exactEventsPrivateReceiptsFinancialUnchanged: true,
    evidence: "actual full host/Store/routed RAM Worker; current truthful recovery-copy contract" }));
  assert.equal(status.text, existingRecoveryCopy, "Current status must not deny the explicit original Retry already observed");
});
