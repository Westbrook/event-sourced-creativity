// Exact root-observed inverse2; actual whole Settings/Store/native invitation.
// Finite HTTP only: no real invitation, member mutation, SQL or provider claim.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fixtureUrl = new URL("./workspace-settings-draft-completion.test.mjs", import.meta.url);
const fixtureSource = fs.readFileSync(fixtureUrl, "utf8");
const registration = '\nfor (const locale of ["en", "fr", "ar", "ja"]) for (const entry of cases)';
const end = fixtureSource.indexOf(registration);
assert.ok(end > 0); assert.equal(fixtureSource.indexOf(registration, end + 1), -1);
const prefix = fixtureSource.slice(0, end) + "\nexport { setup, cases, originalNotice, visibleNotice, endpoint };\n";
fixtureUrl.search = "project-member-whole-refresh-fixture-only";
const loader = registerHooks({ load(url, context, next) {
  return url === fixtureUrl.href ? { format: "module", source: prefix, shortCircuit: true } : next(url, context);
} });
let fixture;
try { fixture = await import(fixtureUrl.href); } finally { loader.deregister(); }
const { setup, cases, originalNotice, visibleNotice, endpoint } = fixture;
console.log("PROJECT_MEMBER_WHOLE_REFRESH_FIXTURE " + JSON.stringify({
  source: sha(fixtureSource), prefix: sha(prefix), reused: "ordinary invitation ACK and native form lifetime", applicationMethodsChanged: false }));

const method = request => (request.init.method ?? "GET").toUpperCase();
const MEMBER_URL = endpoint("A", "/projects/settings-access-A/members");
const PACKAGE_URL = endpoint("A", "/context-packages");
const MARKER = "PRIVATE_A_PROJECT_MEMBER";
const memberRead = request => method(request) === "GET" && request.url === MEMBER_URL;
const sourceSnapshot = f => structuredClone({ route: f.store.route.get(), session: f.store.session.get(),
  events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(),
  authorization: f.store.captureAuthorizationScope() });

function view(f) {
  const label = f.i18n.t("workspace.admin.viewAccessNamed", "View access to {name}", { name: "PRIVATE_A_PROJECT" });
  return f.click(f.find("button", node => node.attributes["aria-label"] === label));
}

function observed(f) {
  return { privateMemberVisible: f.privateText().includes(MARKER),
    alerts: f.nodes("p").filter(node => node.attributes.role === "alert").map(node => node.text) };
}

for (const changedAuthority of [false, true]) test(
  "B3 project-member denial across invitation whole refresh " + (changedAuthority ? "genuine authority retirement control" : "same owner, no exact member certificate"),
  { concurrency: false, timeout: 45_000 }, async t => {
    // Overview is an existing ordinary route containing both the invitation
    // form and current View access. Only the fixture entry's section changes.
    const invitation = cases.find(entry => entry.id === "invitation"); assert.ok(invitation);
    const entry = { ...invitation, section: "overview" };
    const { f, service, native, finite } = await setup(t, entry, { locale: "en" });
    const previous = f.storeHost.intercept;
    f.storeHost.intercept = request => {
      if (method(request) !== "GET") {
        assert.equal(method(request), "POST"); assert.equal(request.url, entry.url);
        assert.deepEqual(request.body, entry.a, "Only the existing finite original invitation command is allowed");
      }
      return previous?.(request);
    };
    const original = sourceSnapshot(f), authority = f.store.captureAuthorizationScope();
    const originalMembers = structuredClone(service.projectMembers), memberStart = service.requests.filter(memberRead).length;
    let old, whole, submitted, duringWhole, afterDenial, afterWhole, recovered, retiredSource;
    try {
      view(f); await f.until(() => f.privateText().includes(MARKER), "initial current private membership renders");
      await f.flush(); assert.deepEqual(observed(f), { privateMemberVisible: true, alerts: [] });
      old = service.queue(memberRead, "headers", { status: 403, raw: "old exact member denial JSON is unnecessary" });
      whole = service.queue(request => method(request) === "GET" && request.url === PACKAGE_URL, "body");
      view(f); await old.seen.promise;
      assert.equal(old.jsonCalls, 0);
      native.fill(entry.a);
      if (changedAuthority) {
        // Existing finite session producer advances its permission epoch.
        // The real Store applies it and emits its normal retirement event;
        // no source/authorization signal or component state is assigned here.
        service.beforeSession = () => service.bump();
      }
      submitted = native.submit();
      await whole.bodyStarted.promise; await f.flush(16);
      assert.equal(service.writes.length, 1); assert.deepEqual(service.writes[0].body, entry.a);
      assert.equal(finite.invitations.length, 1);
      assert.equal(visibleNotice(f).includes(originalNotice(f, entry)), true,
        "The original finite201 is positively acknowledged before the whole read is held");
      assert.equal(service.requests.filter(memberRead).length - memberStart, 2,
        "The newer whole collection has not read or certified this exact membership resource");
      assert.equal(f.store.authorizationScopeActive(authority), !changedAuthority);
      retiredSource = sourceSnapshot(f);
      if (!changedAuthority) assert.deepEqual(retiredSource, original);
      else assert.deepEqual(f.store.events.get(), [], "The actual Store genuinely retired the previous Source on authority change");
      duringWhole = observed(f);

      old.release.resolve(); await f.flush(16);
      assert.equal(old.jsonCalls, 0, "Old denied bytes are never consumed in either ownership case");
      afterDenial = observed(f);
      whole.release.resolve(); if (submitted?.then) await submitted; await f.flush(24);
      assert.equal(service.pending, 0);
      afterWhole = observed(f);
      assert.equal(visibleNotice(f).includes(originalNotice(f, entry)), true,
        "A member-read failure or retirement does not falsify the acknowledged invitation");

      view(f); await f.until(() => f.privateText().includes(MARKER), "one fresh exact authorized View access recovers");
      await f.flush(); recovered = observed(f);
      assert.deepEqual(recovered, { privateMemberVisible: true, alerts: [] });
      assert.deepEqual(sourceSnapshot(f), retiredSource, "Denial/fresh member read neither mutate nor recertify Store Source");
      assert.deepEqual(service.projectMembers, originalMembers);
      assert.equal(service.requests.filter(memberRead).length - memberStart, 3);
      assert.equal(service.writes.length, 1); assert.equal(service.requests.filter(request => method(request) !== "GET").length, 1);
      f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
      t.diagnostic(JSON.stringify({ changedAuthority, duringWhole, afterDenial, afterWhole, recovered,
        oldJsonCalls: old.jsonCalls, wholeJsonCalls: whole.jsonCalls, memberReads: 3,
        finiteInvitationCommands: 1, actualInvitationsOrGrants: 0, memberWrites: 0, providers: 0,
        sourceRetirement: changedAuthority ? "actual Store after finite session epoch publication" : "same original authority and Source",
        evidence: "actual full Settings/Store, current native invitation submit and View access, finite HTTP only; not Worker authorization, SQL or physical browser" }));
    } finally {
      old?.release.resolve(); whole?.release.resolve(); await f.flush(); f.storeHost.intercept = previous;
    }
    assert.equal(duringWhole.privateMemberVisible, !changedAuthority,
      "Control distinguishes a mere whole refresh from actual authority retirement");
    const expected = { privateMemberVisible: false, alerts: changedAuthority ? [] : [f.i18n.t("workspace.admin.unavailable", "This workspace is unavailable.")] };
    assert.deepEqual(afterDenial, expected,
      "Only a completed exact member proof, not an unrelated whole revision, can suppress same-owner member denial");
    assert.deepEqual(afterWhole, expected, "Completing the sibling whole collection does not restore the denied member resource");
  });
