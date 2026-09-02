import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { withSettingsShellFixture } from "./helpers/workspace-settings-shell-fixture.mjs";

// Reuse only declarations from the two separately reviewed B3 test fixtures.
// No application method, private state, authorization predicate or old test is replaced.
async function fixtureDeclarations(name, exports) {
  const url = new URL(name, import.meta.url), text = fs.readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
    || ts.isExpressionStatement(node) && /^(?:fixtureUrl\.search\s*=|hook\.deregister\(|descriptions\.delete\s*=)/u.test(node.getText(tree)))
    .map(node => node.getFullText(tree)).join("\n")
    + "\nexport {" + exports.join(",") + "};\n";
  url.search = "workspace-overview-declarations-only";
  const hook = registerHooks({ load(candidate, context, next) {
    return candidate === url.href ? { format: "module", source, shortCircuit: true } : next(candidate, context);
  } });
  try { return await import(url.href); } finally { hook.deregister(); }
}
const { settingsFixture: standaloneSettingsFixture, endpoint, path, ORG } = await fixtureDeclarations(
  "./workspace-settings-response-ownership.test.mjs", ["settingsFixture", "endpoint", "path", "ORG"]);
const { workspace: standaloneWorkspace, ACTIONS } = await fixtureDeclarations("./workspace-settings-confirmation.test.mjs", ["workspace", "ACTIONS"]);
const settingsFixture = (t, options) => withSettingsShellFixture(t, setupTest => standaloneSettingsFixture(setupTest, options));
const workspace = (t, action, locale) => withSettingsShellFixture(t, setupTest => standaloneWorkspace(setupTest, action, locale));

const verb = request => (request.init.method ?? "GET").toUpperCase();
function inside(node, attribute) {
  for (let current = node; current; current = current.parent) if (Object.hasOwn(current.attributes, attribute)) return true;
  return false;
}
const summaryLinks = f => f.tree().visible("a").filter(node => inside(node, "data-workspace-overview"));
const sectionOf = node => node.attributes.href.split("/").at(-1);
const overview = f => f.tree().visible("section").filter(node => Object.hasOwn(node.attributes, "data-workspace-overview"));
const sectionSet = f => summaryLinks(f).map(sectionOf);
function clickSummary(f, section) {
  const matches = summaryLinks(f).filter(node => sectionOf(node) === section);
  assert.equal(matches.length, 1, "One current scoped summary link for " + section);
  const link = matches[0]; assert.ok(link.port?.isConnected && !link.hiddenBy);
  link.handlers.click.call(link.owner, { target: link.port, currentTarget: link.port, button: 0, preventDefault() {} });
}
function extendUsage(f) {
  const previous = f.service.reply;
  f.service.reply = request => {
    const key = ["A", "B"].find(key => request.url === endpoint(key, "/usage"));
    if (key && verb(request) === "GET") return { status: 200, body: {
      organization: { organizationId: ORG[key], name: "Workspace " + key, role: f.service.roles[key] }, period: "2026-08",
      policy: { token_limit: 100000, microusd_limit: 60000000 },
      cost: { used_microusd: 2400, reserved_microusd: 19644000 }, tokens: { used_tokens: 12, reserved_tokens: 34 }, reservations: [],
      outcomes: { activatedCreators: 0, approvedDeliverables: 0, releasedApprovedDeliverables: 0, pendingReviews: 0,
        adoptedContextPackages: 0, settledCostPerApprovedDeliverableMicrousd: null, averageReviewMinutes: null },
    } };
    return previous(request);
  };
}
async function subject(t, locale = "en") {
  // The immutable ownership fixture verifies a real current Members form first.
  // Navigate through the actual Store afterward; do not replace that prerequisite.
  const f = await settingsFixture(t, { locale, section: "members" });
  extendUsage(f); f.navigate("A", "overview"); await f.flush(); return f;
}
function currentSettingsOwner(f) {
  const owners = [...f.renderer.instances.values()].map(record => record.instance)
    .filter(owner => owner.isConnected && owner.tag === "forma-workspace-settings");
  assert.equal(owners.length, 1, "One current Settings author in the actual Shell");
  const owner = owners[0];
  assert.ok(owner instanceof f.renderer.registry["forma-workspace-settings"]);
  assert.equal(owner.store, f.store); assert.equal(owner.parentElement?.tag, "forma-creative-application");
  assert.equal(owner.parentElement?.parentElement, f.host); return owner;
}
function assertReadOnlyOverview(f) {
  assert.equal(overview(f).length, 1, "One current organization overview summary");
  const owner = currentSettingsOwner(f);
  assert.equal(f.tree().visible("form").filter(node => node.owner === owner).length, 0, "Fully navigable Overview mounts no administrative form");
  assert.equal(f.tree().visible("section").filter(node => Object.hasOwn(node.attributes, "data-workspace-overview-preserved")).length, 0);
  assert.deepEqual(sectionSet(f), ["members", "projects", "usage", "activity"]);
  for (const link of summaryLinks(f)) {
    assert.equal(link.attributes.href, path("A", sectionOf(link)));
    assert.ok(link.attributes["aria-label"].includes("Workspace A"));
    assert.equal(link.text, f.i18n.t("workspace.admin.section." + sectionOf(link)));
  }
  assert.doesNotMatch(f.privateText(), /PRIVATE_[AB]_|fixture-token-|private-[ab]@/u,
    "Overview does not repeat member, package, identity, audit or one-time secret details");
  assert.deepEqual(f.service.writes, [], "Overview summaries/navigation do not mutate finite service state");
}

for (const locale of ["en", "fr", "ar", "ja"]) test("Workspace overview reuses authorized task links without repeated forms " + locale, async t => {
  const f = await subject(t, locale); assertReadOnlyOverview(f);
  assert.ok(f.text().includes(f.i18n.t("workspace.admin.role.owner")));
  assert.ok(f.text().includes(f.i18n.t("workspace.admin.settled")));
  assert.ok(f.text().includes(f.i18n.t("workspace.admin.reserved")));
  assert.equal(f.tree().visible("progress").length, 0, "No invented current-period meter from an unrequested Usage read");
  assert.equal(f.service.requests.some(request => request.url === endpoint("A", "/usage")), false);
  const roleFact = overview(f)[0].text;
  assert.ok(roleFact.includes(f.i18n.t("workspace.admin.role")));
  assert.equal(roleFact.includes("60.00"), false, "A limit is not restated as settled spending or available budget");
});

for (const section of ["members", "projects", "usage", "activity"]) test("Workspace overview exact " + section + " link reaches its existing task", async t => {
  const f = await subject(t); assertReadOnlyOverview(f); clickSummary(f, section); await f.flush();
  assert.equal(f.store.route.get(), path("A", section));
  assert.equal(overview(f).length, 0, "Only the selected existing task is mounted");
  assert.ok(f.service.requests.some(request => request.url === endpoint("A", section === "activity" ? "/audit" : "/" + section)));
  const labels = {
    members: [f.i18n.t("workspace.admin.invite"), f.i18n.system("Create one-time provisioning token"), f.i18n.system("Transfer administrative ownership")],
    projects: [f.i18n.t("workspace.admin.shareProject"), f.i18n.system("Organization context")],
    usage: [f.i18n.t("workspace.admin.savePolicy"), f.i18n.system("Save retention policy")],
    activity: [f.i18n.system("Trust & operational readiness"), f.i18n.system("Create encrypted snapshot")],
  };
  for (const label of labels[section]) assert.ok(f.text().includes(label), "Existing task remains reachable: " + label);
  assert.deepEqual(f.service.writes, []);
});

// These are finite server-issued permission combinations, not a backend grant proof.
// The current API intentionally bounds base members/projects to 50; no new total is inferred.
async function selectPermissions(f, allowed) {
  const previous = f.service.reply; f.service.roles.A = "member";
  f.service.reply = request => {
    const result = previous(request);
    if (verb(request) !== "GET" || result.status !== 200) return result;
    if (request.url === "/api/workspaces") {
      const organization = result.body.organizations.find(row => row.organizationId === ORG.A);
      if (organization) { organization.role = "member"; organization.permissions = [...allowed]; }
    }
    if (request.url === endpoint("A")) {
      result.body.organization.role = "member"; result.body.permissions = [...allowed];
      if (!allowed.includes("workspace.member.read")) { result.body.members = []; result.body.invitations = []; }
      if (!allowed.includes("workspace.project.read")) result.body.projects = [];
    }
    return result;
  };
  await f.refreshAuthority({ capabilities: ["project.read", "project.author", ...allowed] }); await f.flush();
}
const selective = [
  { id: "member reader", allowed: ["workspace.member.read"], links: ["members"], context: true, retention: false },
  { id: "project reader", allowed: ["workspace.project.read"], links: ["projects"], context: false, retention: false },
  { id: "usage reader", allowed: ["workspace.usage.read"], links: ["usage"], context: true, retention: false },
  { id: "member reader with policy grant", allowed: ["workspace.member.read", "workspace.policy.manage"], links: ["members"], context: true, retention: true },
  { id: "audit reader with policy grant", allowed: ["workspace.audit.read", "workspace.policy.manage"], links: ["activity"], context: true, retention: true },
];
for (const locale of ["en", "ja"]) for (const entry of selective) test("Workspace overview preserves selective " + entry.id + " without a new read grant " + locale, async t => {
  const f = await subject(t, locale); await selectPermissions(f, entry.allowed);
  assert.equal(overview(f).length, 1); assert.deepEqual(sectionSet(f), entry.links);
  assert.equal(f.text().includes("PRIVATE_A_PACKAGE"), entry.context, "Context remains only if Projects is not a reachable equivalent");
  const retentionForms = f.tree().visible("form").filter(node => node.text.includes(f.i18n.system("Save retention policy")));
  assert.equal(retentionForms.length, entry.retention ? 1 : 0, "Preserve the existing independently authorized policy form only when needed");
  assert.equal(f.text().includes(f.i18n.system("Create one-time provisioning token")), false, "A selective grant does not acquire owner provisioning");
  assert.equal(f.text().includes(f.i18n.system("Transfer administrative ownership")), false);
  assert.deepEqual(f.service.writes, []);
  if (entry.retention) assert.ok(f.tree().visible("section").some(node => Object.hasOwn(node.attributes, "data-workspace-overview-preserved")),
    "This preserved capability exception is not described as a universal zero-form overview");
});

for (const locale of ["en", "ja"]) test("Workspace overview preserves package approval and project automation until Projects is actually reachable " + locale, async t => {
  const f = await subject(t, locale), previous = f.service.reply;
  f.service.reply = request => {
    const result = previous(request);
    if (verb(request) !== "GET" || result.status !== 200) return result;
    if (request.url === "/api/workspaces") result.body.projects.push({ organizationId: ORG.A,
      projectAccessId: "settings-access-A", projectId: "settings-shared-A", projectName: "PRIVATE_A_AUTOMATION_PROJECT", role: "owner" });
    if (request.url === endpoint("A", "/context-packages")) Object.assign(result.body.packages[0], {
      pendingDraftVersionId: "exact-pending-version-A", canApprove: true,
      draftPreview: [{ handle: "PRIVATE_A_PENDING_DECISION", type: "intent", text: "Fixture decision awaiting exact review",
        locked: false, intent: "shape", active: true, exactText: null, exactPlacements: [], protectedPhrases: [], relations: [],
        sourceName: null, rightsExpiresAt: null }],
    });
    return result;
  };
  await selectPermissions(f, ["workspace.member.read", "workspace.policy.manage"]);
  assert.deepEqual(sectionSet(f), ["members"]);
  const openContextReview = () => {
    for (const node of f.tree().nodes.filter(node => node.tag === "details" && node.text.includes(f.i18n.t("workspace.context.review"))))
      if (node.port) node.port.open = true;
  };
  openContextReview();
  assert.equal(f.tree().visible("form").filter(node => node.text.includes(f.i18n.t("workspace.context.approve"))).length, 1);
  assert.equal(f.tree().visible("form").filter(node => node.text.includes(f.i18n.system("Save project automation"))).length, 1);
  assert.equal(f.service.requests.some(request => request.url === endpoint("A", "/projects")), false,
    "A preserved project task does not invent an organization-wide project read");
  await selectPermissions(f, ["workspace.member.read", "workspace.project.read", "workspace.policy.manage"]);
  assert.deepEqual(sectionSet(f), ["members", "projects"]);
  assert.equal(f.tree().nodes.some(node => node.tag === "form" && node.text.includes(f.i18n.t("workspace.context.approve"))), false);
  assert.equal(f.tree().nodes.some(node => node.tag === "form" && node.text.includes(f.i18n.system("Save project automation"))), false);
  clickSummary(f, "projects"); await f.flush(); openContextReview();
  assert.equal(f.tree().visible("form").filter(node => node.text.includes(f.i18n.t("workspace.context.approve"))).length, 1);
  assert.equal(f.tree().visible("form").filter(node => node.text.includes(f.i18n.system("Save project automation"))).length, 1);
  assert.deepEqual(f.service.writes, [], "No approval, automation mutation or generation follows from organization task navigation");
});

test("Workspace overview does not infer a total from the bounded returned member/project subset", async t => {
  const f = await subject(t), previous = f.service.reply;
  f.service.reply = request => {
    const result = previous(request);
    if (request.url === endpoint("A") && verb(request) === "GET" && result.status === 200) {
      result.body.members = Array.from({ length: 50 }, (_, index) => ({ ...result.body.members[0], membership_id: "bounded-member-" + index }));
      result.body.projects = Array.from({ length: 50 }, (_, index) => ({ ...result.body.projects[0], project_access_id: "bounded-project-" + index }));
    }
    return result;
  };
  await f.refreshAuthority(); await f.flush(); assertReadOnlyOverview(f);
  assert.equal(overview(f)[0].text.includes("50"), false, "No 50-row list length is represented as a whole-workspace total");
});

for (const boundary of ["A-B", "A-B-A"]) test("Workspace overview retains current organization identity after late detail " + boundary, async t => {
  const f = await subject(t), gate = f.service.queue(request => request.url === endpoint("A") && verb(request) === "GET", "body");
  f.navigate("A", "members"); await gate.bodyStarted.promise;
  f.navigate("B", "overview"); await f.flush();
  if (boundary === "A-B-A") { f.navigate("A", "overview"); await f.flush(); }
  const key = boundary === "A-B-A" ? "A" : "B";
  gate.release.resolve(); await f.flush();
  assert.equal(overview(f).length, 1); assert.equal(f.store.route.get(), path(key, "overview"));
  for (const link of summaryLinks(f)) {
    assert.equal(link.attributes.href, path(key, sectionOf(link)));
    assert.ok(link.attributes["aria-label"].includes("Workspace " + key));
  }
  assert.doesNotMatch(f.privateText(), /PRIVATE_[AB]_|fixture-token-/u); assert.deepEqual(f.service.writes, []);
});

test("Workspace overview retirement on current denied refresh removes task links and private details", async t => {
  const f = await subject(t); f.service.denied.add("A");
  await f.refreshAuthority(); await f.flush();
  assert.equal(overview(f).length, 0); assert.equal(summaryLinks(f).length, 0);
  assert.doesNotMatch(f.privateText(), /PRIVATE_A_|fixture-token-/u);
  assert.ok(f.tree().visible("button").some(node => node.text === f.i18n.t("action.retry", "Try again")));
  f.service.denied.delete("A");
  f.click(f.find("button", node => node.text === f.i18n.t("action.retry", "Try again"))); await f.flush();
  assertReadOnlyOverview(f);
});

test("Workspace overview cannot expose a late one-time token from the former Members opening", async t => {
  const f = await settingsFixture(t, { section: "members" });
  const gate = f.service.queue(request => request.url === endpoint("A", "/security/provisioning-credentials") && verb(request) === "POST", "body");
  f.issue(); await gate.bodyStarted.promise; f.navigate("A", "overview"); await f.flush();
  gate.release.resolve(); await f.flush();
  assert.equal(overview(f).length, 1); assert.equal(f.token("fixture-token-A-1"), false);
  assert.equal(f.service.writes.length, 1, "A prior finite receipt is not canceled or repeated by navigation");
  clickSummary(f, "members"); await f.flush(); f.issue(); await f.flush();
  assert.ok(f.token("fixture-token-A-2"), "A new deliberate current issuance remains usable");
  assert.equal(f.service.writes.length, 2);
});

test("Workspace overview keeps the original partial-deletion recovery view instead of ordinary summaries", async t => {
  const f = await subject(t), previous = f.service.reply;
  f.service.reply = request => {
    const result = previous(request);
    if (request.url === endpoint("A", "/deletion") && verb(request) === "GET" && result.status === 200)
      result.body.job = { job_id: "exact-partial-deletion", status: "partial" };
    return result;
  };
  await f.refreshAuthority(); await f.flush();
  assert.equal(overview(f).length, 0); assert.equal(summaryLinks(f).length, 0);
  assert.ok(f.tree().visible("button").some(node => node.text === f.i18n.system("Try again")));
  assert.deepEqual(f.service.writes, [], "Inspecting an original deletion receipt does not retry deletion");
});

for (const locale of ["en", "ja"]) test("Workspace native confirmation retires on Overview then reopens only from its current Members action " + locale, async t => {
  const f = await workspace(t, ACTIONS[0], locale); f.beginAction(); assert.ok(f.dialog());
  f.store.setRoute(path("A", "overview")); await f.flush();
  assert.equal(f.dialog(), null); assert.deepEqual(f.service.writes, []);
  assert.equal(overview(f).length, 1); clickSummary(f, "members"); await f.flush();
  f.beginAction(); assert.ok(f.dialog(), "A new current Members invocation owns the dialog");
  f.cancel(); await f.flush(); assert.equal(f.dialog(), null); assert.deepEqual(f.service.writes, []);
});

// The existing actual RAM Worker review fixture, not the finite Settings
// service, owns these assignments, grants, source rows and fiscal assertions.
// Load declarations only after the original cases; do not register their tests.
async function assignedOverviewSubject(t) {
  const priorFetch = globalThis.fetch, cleanups = [];
  t.after(async () => {
    try { for (const cleanup of cleanups) await cleanup(); }
    finally { globalThis.fetch = priorFetch; }
  });
  const api = await fixtureDeclarations("./workspace-settings-context-departure.test.mjs", [
    "settingsContextPage", "settingsReviewButton", "finishSettingsOpening", "until", "flushStoreFrames",
    "libraryFocusFromRoute", "artifactFocusOptionsFromRoute", "externalCount",
  ]);
  const q = await api.settingsContextPage({ mock: t.mock, after(callback) { cleanups.push(callback); } }, { organizationRole: "administrator" });
  const { h, f, w } = q, organizationId = q.task.organizationId, principal = h.store.session.get().user.userId;
  assert.equal(h.store.session.get().projectContext, undefined, "Reuse the actual personal-source entry");
  const membership = w.sqlite.prepare("SELECT membership_id,role,status FROM organization_memberships WHERE organization_id=? AND user_id=?")
    .get(organizationId, principal);
  assert.equal(membership.role, "administrator"); assert.equal(membership.status, "active");
  // The role was declared before the original Worker session and fiscal
  // baseline. Current permissions still require the real session/detail reads.
  const detailEndpoint = "/api/workspaces/" + encodeURIComponent(organizationId);
  const overviewRoute = "/settings/workspaces/" + encodeURIComponent(organizationId) + "/overview";
  const unavailableEndpoint = "/api/workspaces/unavailable-assigned-review-organization";
  const reads = [], previous = h.intercept;
  h.intercept = async request => {
    if (verb(request) !== "GET" || !["/api/session", "/api/workspaces/reviews", detailEndpoint, unavailableEndpoint].includes(request.url))
      return previous?.(request);
    const response = await q.nativeRequest(request);
    reads.push({ url: request.url, status: response.status, body: await response.clone().json() });
    return response;
  };
  await api.finishSettingsOpening(q, h.store.load());
  await h.store.syncReviewInbox(); await api.flushStoreFrames(h); await f.settle();
  assert.equal(h.store.session.get().user.userId, principal);
  assert.equal(h.store.session.get().projectContext, undefined);
  const manage = f.tree().visible("a").filter(node => node.owner === q.currentOwner() && node.attributes.href === overviewRoute);
  assert.equal(manage.length, 1, "The actual current organization has an existing Manage destination");
  q.focus.focus(manage[0].port); await f.act(manage[0], "click", { button: 0 }); await api.flushStoreFrames(h); await f.settle();
  const consumed = reads.filter(read => read.url === detailEndpoint).at(-1);
  assert.equal(consumed?.status, 200); assert.equal(consumed.body.organization.organizationId, organizationId);
  assert.equal(consumed.body.organization.role, "administrator");
  assert.ok(consumed.body.permissions.includes("workspace.project.read"), "Exercise the reachable-Projects branch, not its existing fallback");
  assert.equal(h.store.route.get(), overviewRoute); assert.equal(overview(f).length, 1);
  assert.ok(summaryLinks(f).some(node => node.attributes.href === overviewRoute.replace(/overview$/u, "projects")));
  assert.equal(f.host.tag, "forma-shell"); assert.equal(q.currentOwner().parentElement.tag, "forma-creative-application");
  assert.equal(f.tree().visible("form").filter(node => node.owner === q.currentOwner()).length, 0);
  assert.equal(q.currentOwner().captureCommandDeparture().blocked(), false);
  const current = h.store.reviewInbox.get().filter(task => task.organizationId === organizationId);
  assert.deepEqual(current.map(task => task.id).sort(), [q.task.id, q.secondTask.id, q.thirdTask.id].sort());
  assert.ok(reads.some(read => read.url === "/api/workspaces/reviews" && read.status === 200
    && read.body.tasks.some(task => task.id === q.task.id && task.contentSha256 === q.task.contentSha256)));
  assert.equal(api.externalCount(), 0);
  return { ...q, api, reads, detailEndpoint, overviewRoute, unavailableEndpoint };
}
function assignedOverviewQueue(q) {
  return q.f.tree().visible("section").filter(node => node.owner === q.currentOwner()
    && node.attributes["aria-labelledby"] === "workspace-assigned-review-heading");
}
function assignedOverviewButtons(q) {
  return q.f.tree().visible("button").filter(node => node.owner === q.currentOwner() && node.text === "Open exact output");
}

test("Workspace Overview keeps the actual exact assigned review when Projects is readable", { timeout: 45_000, concurrency: false }, async t => {
  const q = await assignedOverviewSubject(t), { h, f, api } = q;
  const tasks = h.store.reviewInbox.get().filter(task => task.organizationId === q.task.organizationId);
  t.diagnostic("E1_OVERVIEW_REVIEW_REACH " + JSON.stringify({ route: h.store.route.get(), taskIds: tasks.map(task => task.id),
    projectsReadable: summaryLinks(f).some(node => node.attributes.href === q.overviewRoute.replace(/overview$/u, "projects")),
    overviewForms: f.tree().visible("form").filter(node => node.owner === q.currentOwner()).length,
    visibleReviewQueues: assignedOverviewQueue(q).length }));
  assert.equal(assignedOverviewQueue(q).length, 1, "Current assigned work remains a next action on the task-focused Overview");
  assert.equal(assignedOverviewButtons(q).length, tasks.length);
  const original = h.store.openAssignedReview, calls = [];
  t.mock.method(h.store, "openAssignedReview", function (task, ...args) {
    for (const key of ["id", "organizationId", "projectAccessId", "projectId", "documentId", "artifactId", "revision", "contentSha256"])
      assert.equal(task[key], q.task[key], "The current Overview forwards exact " + key);
    const call = {}; calls.push(call); call.pending = original.call(this, task, ...args);
    void call.pending.then(result => { call.result = result; }, error => { call.error = String(error); }); return call.pending;
  });
  const before = h.requests.length, button = api.settingsReviewButton(q);
  q.focus.focus(button.port); await f.act(button);
  await api.finishSettingsOpening(q, Promise.all(calls.map(call => call.pending)));
  await api.until(() => q.operations.every(operation => !operation.requested || operation.finished), "The original review context operation finishes");
  await api.flushStoreFrames(h); await f.settle();
  await api.finishSettingsOpening(q, Promise.all(q.viewerCalls.map(call => call.pending))); await f.settle();
  assert.equal(calls.length, 1); assert.equal(calls[0].result, true);
  const writes = h.requests.slice(before).filter(request => !["GET", "HEAD", "OPTIONS"].includes(verb(request)));
  assert.equal(writes.length, 1); assert.equal(verb(writes[0]), "POST");
  assert.equal(writes[0].url, "/api/workspaces/" + q.task.organizationId + "/projects/" + q.task.projectAccessId + "/context");
  assert.equal(writes[0].init.body, undefined, "Only the existing context selection, not a review verdict, is submitted");
  assert.equal(h.store.session.get().projectContext.projectAccessId, q.task.projectAccessId);
  assert.deepEqual(api.libraryFocusFromRoute(h.store.route.get()), { kind: "artifact", id: q.task.artifactId });
  assert.deepEqual(api.artifactFocusOptionsFromRoute(h.store.route.get()), {
    expectedRevision: q.task.revision, expectedContentSha256: q.task.contentSha256, intent: "review",
  });
  assert.equal(q.viewerCalls.length, 1); const viewer = q.viewerCalls[0];
  assert.equal(viewer.id, q.task.artifactId); assert.equal(viewer.result, true); assert.equal(viewer.owner.documentId, q.task.documentId);
  assert.ok(viewer.owner.isConnected && viewer.owner.querySelector(".document-artifact-view")?.open);
  assert.match(f.tree().root.text, /EXACT_ASSIGNED_B_BODY/u);
  assert.ok(h.store.reviewInbox.get().some(task => task.id === q.task.id), "Opening a review is not an approval");
  assert.equal(h.store.error.get(), ""); assert.equal(api.externalCount(), 0);
  // The reused fixture's teardown verifies all nine fiscal tables, actual
  // non-navigation source/private history and zero new job admissions.
});

test("Workspace Overview retires foreign-scope and revoked review rows without hiding a current sibling", { timeout: 45_000, concurrency: false }, async t => {
  const q = await assignedOverviewSubject(t), { h, f, api } = q;
  const originalInbox = structuredClone(h.store.reviewInbox.get()), before = h.requests.length;
  async function openObservedScope(route, endpoint) {
    const responseFloor = q.reads.length, requestFloor = h.requests.length;
    h.store.setRoute(route); await api.flushStoreFrames(h); await f.settle();
    // Render ticks are not completion of the mounted owner's actual GET.
    // Observe the existing transport; do not dispatch a diagnostic substitute.
    try {
      await api.until(() => q.reads.slice(responseFloor).some(read => read.url === endpoint),
        "The mounted Settings owner receives its actual scope response: " + endpoint);
    } finally {
      t.diagnostic("E1_OVERVIEW_REVIEW_SCOPE_READ " + JSON.stringify({ expectedRoute: route, route: h.store.route.get(), endpoint,
        requests: h.requests.slice(requestFloor).map(request => ({ method: verb(request), url: request.url })),
        responses: q.reads.slice(responseFloor).map(read => ({ url: read.url, status: read.status, error: read.body?.error ?? null })) }));
    }
    await f.settle();
    return q.reads.slice(responseFloor).filter(read => read.url === endpoint).at(-1);
  }
  const denied = await openObservedScope(q.unavailableEndpoint.replace(/^\/api/u, "/settings") + "/overview", q.unavailableEndpoint);
  assert.ok([403, 404].includes(denied?.status), "The different unavailable organization is denied by the actual Worker");
  assert.equal(assignedOverviewQueue(q).length, 0); assert.equal(assignedOverviewButtons(q).length, 0);
  assert.equal(overview(f).length, 0); assert.deepEqual(h.store.reviewInbox.get(), originalInbox);
  const returned = await openObservedScope(q.overviewRoute, q.detailEndpoint);
  assert.equal(returned?.status, 200); assert.equal(returned.body.organization.organizationId, q.task.organizationId);
  assert.equal(overview(f).length, 1); assert.equal(h.store.route.get(), q.overviewRoute);
  // Existing owner-authorized RAM Worker revocation owns its one expected
  // audit and cancels B/D. Do not fabricate inbox removal or a browser grant.
  await q.revoke(); await api.finishSettingsOpening(q, h.store.load());
  await h.store.syncReviewInbox(); await api.flushStoreFrames(h); await f.settle();
  const current = h.store.reviewInbox.get().filter(task => task.organizationId === q.task.organizationId);
  assert.deepEqual(current.map(task => task.id), [q.secondTask.id]);
  assert.equal(wStatus(q, q.task.id), "canceled"); assert.equal(wStatus(q, q.thirdTask.id), "canceled");
  assert.equal(wStatus(q, q.secondTask.id), "pending");
  assert.equal(h.store.route.get(), q.overviewRoute); assert.equal(overview(f).length, 1);
  assert.equal(f.tree().visible("form").filter(node => node.owner === q.currentOwner()).length, 0);
  assert.deepEqual(h.requests.slice(before).filter(request => !["GET", "HEAD", "OPTIONS"].includes(verb(request))), []);
  assert.equal(q.viewerCalls.length, 0); assert.equal(api.externalCount(), 0);
  t.diagnostic("E1_OVERVIEW_REVIEW_RETIREMENT " + JSON.stringify({ deniedOrganizationStatus: denied.status,
    currentTaskIds: current.map(task => task.id), visibleReviewQueues: assignedOverviewQueue(q).length,
    viewerOpenings: q.viewerCalls.length, scope: "Actual RAM Worker; unavailable-organization retirement, not a second authorized organization" }));
  assert.equal(assignedOverviewQueue(q).length, 1, "The still-authorized assigned review stays reachable on Overview");
  assert.equal(assignedOverviewButtons(q).length, 1);
  assert.ok(assignedOverviewQueue(q)[0].text.includes(q.secondTask.artifactTitle));
  assert.equal(assignedOverviewQueue(q)[0].text.includes(q.task.artifactTitle), false);
  assert.equal(assignedOverviewQueue(q)[0].text.includes(q.thirdTask.artifactTitle), false);
});
function wStatus(q, taskId) {
  return q.w.sqlite.prepare("SELECT status FROM project_review_tasks WHERE task_id=?").get(taskId).status;
}

// E1 bounded presentation follow-up. Reuse the original complete Settings
// fixture with its current real-Shell assembly; these are finite read contracts,
// not Worker grants, pilot activation, physical layout or provider evidence.
// Requires the explicitly staged W4 currentSettingsOwner helper successor.
// The Shell remains the real root; it is never treated as the Settings author.
const e1CurrentTaskNodes = (f, tag) => {
  const owner = currentSettingsOwner(f);
  return f.tree().visible(tag).filter(node => node.owner === owner);
};
const e1OverviewCustody = f => structuredClone({ route: f.store.route.get(), session: f.store.session.get(),
  events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get(),
  inbox: f.store.reviewInbox.get(), credentials: f.service.credentials, tokens: f.service.tokenCount });
function e1OverviewReadsOnly(f, before) {
  assert.deepEqual(e1OverviewCustody(f), before);
  assert.ok(f.service.requests.every(request => verb(request) === "GET"));
  assert.deepEqual(f.service.writes, []); assert.equal(f.service.pending, 0);
  f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
}
function e1OverviewDescription(f, section) {
  const tree = f.tree(), rows = tree.visible("li").filter(node => node.attributes["data-workspace-overview-section"] === section);
  assert.equal(rows.length, 1, "One actual current directory row for " + section);
  const copy = tree.visible("span").filter(node => node.parent?.tag === "div" && node.parent.parent === rows[0]);
  assert.equal(copy.length, 1, "Read the actual description, not its link or a task heading");
  return copy[0].text;
}
function e1PreservedLayout(f) {
  const tree = f.tree(), regions = tree.visible("section").filter(node => Object.hasOwn(node.attributes, "data-workspace-overview-preserved"));
  assert.equal(regions.length, 1, "The independently granted current tasks remain in their labeled region");
  const region = regions[0], cards = tree.visible("section").filter(node => node !== region && inside(node, "data-workspace-overview-preserved"));
  assert.ok(region.owner?.isConnected); assert.equal(region.owner.tag, "forma-workspace-settings");
  assert.equal(region.owner, currentSettingsOwner(f));
  assert.equal(region.owner.parentElement?.tag, "forma-creative-application");
  assert.equal(region.owner.parentElement.parentElement, f.host, "The current Settings author belongs to the actual Shell");
  assert.ok(cards.length > 0, "Actual existing capability cards are present before checking layout");
  assert.equal(region.attributes["aria-label"], f.i18n.t("navigation.actions"));
  for (const form of tree.visible("form").filter(node => inside(node, "data-workspace-overview-preserved"))) {
    assert.ok(form.port?.isConnected); assert.equal(form.owner, region.owner, "The original Settings author still owns each native form");
    assert.equal(typeof form.handlers.submit, "function");
  }
  const stacks = tree.visible("forma-ui-stack").filter(node => node.parent === region), stack = stacks[0];
  return { count: stacks.length, gap: stack?.attributes.gap ?? null,
    actualComponent: Boolean(stack?.component), allCardsDirect: Boolean(stack && cards.every(card => card.parent === stack)) };
}

for (const locale of ["en", "fr", "ar", "ja"]) test("E1 Overview names the existing owner policy and pilot destinations " + locale, async t => {
  const f = await subject(t, locale); assertReadOnlyOverview(f);
  const before = e1OverviewCustody(f), descriptions = {
    members: e1OverviewDescription(f, "members"), usage: e1OverviewDescription(f, "usage"),
  };
  for (const section of ["members", "usage"]) {
    clickSummary(f, section); await f.flush(24);
    assert.equal(f.store.route.get(), path("A", section));
    assert.equal(e1CurrentTaskNodes(f, "form").filter(node => String(node.handlers.submit).includes("#configurePilot")).length, 1,
      "The current owner's actual existing pilot task is reachable without invoking it");
    assert.equal(e1CurrentTaskNodes(f, "form").filter(node => node.attributes["data-workspace-policy"] === "retention").length,
      section === "usage" ? 1 : 0, "Normal retention and scoped legal holds belong to Usage");
    if (section === "usage") assert.ok(e1CurrentTaskNodes(f, "h2").some(node => node.text === f.i18n.system("Retention & scoped legal holds")));
    f.navigate("A", "overview"); await f.flush(24); assertReadOnlyOverview(f);
  }
  assert.deepEqual({ members: e1OverviewDescription(f, "members"), usage: e1OverviewDescription(f, "usage") }, descriptions);
  e1OverviewReadsOnly(f, before);
  // Desired copy is checked only after real task reach, return and full custody.
  assert.deepEqual({ membersPilot: descriptions.members.includes(f.i18n.system("Controlled pilot")),
    usagePilot: descriptions.usage.includes(f.i18n.system("Controlled pilot")),
    usageRetention: descriptions.usage.includes(f.i18n.system("Retention & scoped legal holds")) },
  { membersPilot: true, usagePilot: true, usageRetention: true });
});

const e1SelectiveDescriptions = [
  { id: "no cohort without policy", locale: "en", allowed: ["workspace.member.read", "workspace.usage.read"], cohort: null, pilot: false, retention: false, links: ["members", "usage"] },
  { id: "closed cohort reader", locale: "fr", allowed: ["workspace.member.read", "workspace.usage.read"], cohort: "closed", pilot: true, retention: false, links: ["members", "usage"] },
  { id: "policy without Usage read", locale: "ar", allowed: ["workspace.member.read", "workspace.policy.manage"], cohort: "active", pilot: true, retention: true, links: ["members"] },
  { id: "no pilot read grant", locale: "ja", allowed: ["workspace.member.read"], cohort: "active", pilot: false, retention: false, links: ["members"] },
];
for (const entry of e1SelectiveDescriptions) test("E1 Overview keeps exact selective task descriptions and preserved-card spacing: " + entry.id, async t => {
  const f = await subject(t, entry.locale), previous = f.service.reply;
  f.service.reply = request => {
    const result = previous(request);
    if (verb(request) === "GET" && request.url === endpoint("A", "/pilot") && result.status === 200) {
      // Same existing finite cohort shape as workspace-policy-native-fixture.
      // The read payload is never an activation, enrollment or spending command.
      result.body.cohort = entry.cohort ? { cohort_id: "finite-existing-pilot", status: entry.cohort,
        starts_at: "2026-08-29T12:00:00.000Z", ends_at: "2026-09-28T12:00:00.000Z", max_participants: 10,
        participant_cap_microusd: 15000000, organization_cap_microusd: 150000000,
        source_classification: "non-sensitive-licensed" } : null;
    }
    return result;
  };
  const permissionReadStart = f.service.requests.length;
  await selectPermissions(f, entry.allowed);
  assert.deepEqual(sectionSet(f), entry.links); assert.equal(overview(f).length, 1);
  const before = e1OverviewCustody(f), descriptions = Object.fromEntries(entry.links.map(section => [section, e1OverviewDescription(f, section)]));
  const retained = e1CurrentTaskNodes(f, "form").filter(node => node.attributes["data-workspace-policy"] === "retention");
  assert.equal(retained.length, entry.retention ? 1 : 0, "Only the actual independent policy grant preserves the normal retention form");
  if (entry.retention) {
    assert.ok(inside(retained[0], "data-workspace-overview-preserved"));
    assert.ok(String(retained[0].handlers.submit).includes("#saveRetention"));
    assert.ok(f.tree().visible("section").filter(node => node.attributes.class?.split(/\s+/u).includes("workspace-settings-card")
      && inside(node, "data-workspace-overview-preserved")).length >= 2, "The spacing case contains multiple real capability cards");
  }
  const layout = e1PreservedLayout(f);
  for (const section of entry.links) {
    clickSummary(f, section); await f.flush(24);
    assert.equal(f.store.route.get(), path("A", section));
    assert.equal(e1CurrentTaskNodes(f, "h2").some(node => node.text.startsWith(f.i18n.system("Controlled pilot"))), entry.pilot,
      "The descriptor follows the actual existing helper, including a closed-cohort reader");
    assert.equal(e1CurrentTaskNodes(f, "form").filter(node => String(node.handlers.submit).includes("#configurePilot")).length, 0,
      "A selective grant does not silently acquire owner pilot activation");
    f.navigate("A", "overview"); await f.flush(24);
  }
  assert.deepEqual(sectionSet(f), entry.links); assert.deepEqual(e1PreservedLayout(f), layout);
  assert.equal(f.service.requests.slice(permissionReadStart).some(request => request.url === endpoint("A", "/pilot")),
    entry.allowed.includes("workspace.usage.read") || entry.allowed.includes("workspace.policy.manage"));
  assert.equal(f.service.requests.slice(permissionReadStart).some(request => request.url === endpoint("A", "/usage")), entry.links.includes("usage"));
  e1OverviewReadsOnly(f, before);
  // All original task/permission/custody prerequisites precede this aggregate
  // desired-copy/actual-Stack assertion. It makes no computed-geometry claim.
  assert.deepEqual({ pilots: Object.fromEntries(Object.entries(descriptions).map(([section, copy]) => [section, copy.includes(f.i18n.system("Controlled pilot"))])),
    retentionInUsage: descriptions.usage?.includes(f.i18n.system("Retention & scoped legal holds")) ?? false, layout },
  { pilots: Object.fromEntries(entry.links.map(section => [section, entry.pilot])), retentionInUsage: false,
    layout: { count: 1, gap: "large", actualComponent: true, allCardsDirect: true } });
});
