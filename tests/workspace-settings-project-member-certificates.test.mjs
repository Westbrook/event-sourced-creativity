// Root-observed current full Settings/Store + finite HTTP certificate regression.
// Portable exact12 from the immutable B3 R3 baseline; no Worker/provider claim.
import assert from "node:assert/strict";
import test from "node:test";
import { settingsFixture, endpoint, method } from "./helpers/workspace-settings-whole-read-fixture.mjs";

const MEMBER_URL = endpoint("A", "/projects/settings-access-A/members");
const MARKER = "PRIVATE_A_PROJECT_MEMBER";
const modes = ["valid", "null", "missing", "error", "wrong-user-id", "wrong-permission-type"];
const options = { concurrency: false, timeout: 30_000 };
const getMembers = request => method(request) === "GET" && request.url === MEMBER_URL;
const snapshot = f => structuredClone({ route: f.store.route.get(), session: f.store.session.get(),
  events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(),
  authorization: f.store.captureAuthorizationScope(), finiteMembers: f.service.projectMembers });

function viewMembers(f) {
  const label = f.i18n.t("workspace.admin.viewAccessNamed", "View access to {name}", { name: "PRIVATE_A_PROJECT" });
  const button = f.find("button", node => node.attributes["aria-label"] === label);
  assert.ok(button.port.isConnected && !button.hiddenBy);
  assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
  return f.click(button);
}

function observed(f) {
  return { privateMemberVisible: f.privateText().includes(MARKER),
    alerts: f.nodes("p").filter(node => node.attributes.role === "alert").map(node => node.text) };
}

function newerBody(original, mode) {
  if (mode === "null") return null;
  if (mode === "missing") return {};
  const body = structuredClone(original);
  assert.equal(body.members.length, 1);
  if (mode === "error") body.error = "finite_member_read_unavailable";
  if (mode === "wrong-user-id") body.members[0].user_id = 17;
  if (mode === "wrong-permission-type") body.members[0].canvas_access = "false";
  // Both wrong-type rows remain renderable by the current legacy code: their
  // name, membership ID, role and status stay intact. Do not use [null] to make
  // a renderer/setup exception stand in for the denial/certificate assertion.
  return body;
}

for (const locale of ["en", "ja"]) for (const mode of modes) test(
  "B3 exact project-member denial after newer " + mode + " response " + locale, options, async t => {
    const f = await settingsFixture(t, { locale, section: "projects" });
    const previous = f.storeHost.intercept;
    f.storeHost.intercept = request => {
      assert.equal(method(request), "GET", "This proof permits no command, grant, release, token or provider request");
      return previous?.(request);
    };
    const original = snapshot(f), readStart = f.service.requests.filter(getMembers).length;
    await viewMembers(f); await f.until(() => f.privateText().includes(MARKER), "the current authorized private member genuinely renders");
    await f.flush(); assert.deepEqual(observed(f), { privateMemberVisible: true, alerts: [] });
    const valid = structuredClone(f.service.reply({ url: MEMBER_URL, init: {} }).body);
    assert.equal(valid.members[0].display_name, MARKER);
    const old = f.service.queue(getMembers, "headers", { status: 403, raw: "withheld exact member denial body must not be read" });
    const newer = f.service.queue(getMembers, "body", { status: 200, body: newerBody(valid, mode) });
    let afterNewer, afterDenial, recovered;
    try {
      void viewMembers(f); await old.seen.promise;
      assert.equal(old.jsonCalls, 0);
      void viewMembers(f); await newer.bodyStarted.promise;
      assert.equal(newer.jsonCalls, 1, "The newer exact successful response is genuinely being decoded");
      newer.release.resolve(); await f.flush(18);
      afterNewer = observed(f); // No desired safety assertion can stop causal reach here.
      assert.equal(f.service.pending, 1, "Only the older exact response headers remain held");

      old.release.resolve(); await f.flush(18);
      assert.equal(f.service.pending, 0);
      assert.equal(old.jsonCalls, 0, "The old known403 is handled at headers, never by its malformed body");
      afterDenial = observed(f);

      // A fresh deliberate current read is the recovery control, never proof
      // that the earlier malformed response was authorized or complete.
      await viewMembers(f); await f.until(() => f.privateText().includes(MARKER), "fresh exact valid View access recovers");
      await f.flush(); recovered = observed(f);
      assert.deepEqual(recovered, { privateMemberVisible: true, alerts: [] });
      assert.equal(f.service.requests.filter(getMembers).length - readStart, 4,
        "Initial current read, older denial, newer response, and one deliberate recovery only");
      assert.deepEqual(snapshot(f), original, "Actual Store Source/session/scope and finite memberships remain unchanged");
      assert.equal(f.service.writes.length, 0);
      assert.ok(f.service.requests.every(request => method(request) === "GET"));
      f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
      t.diagnostic(JSON.stringify({ locale, mode, afterNewer, afterDenial, recovered,
        olderStatus: 403, oldJsonCalls: old.jsonCalls, newerJsonCalls: newer.jsonCalls,
        memberReads: 4, writes: 0, providers: 0, sourceAndFiscalProjectionsUnchanged: true,
        evidence: "actual full Settings/Store/current native View access with finite HTTP; not Worker authorization, physical input or an actual financial/permission change" }));
    } finally {
      old.release.resolve(); newer.release.resolve(); await f.flush();
      f.storeHost.intercept = previous;
    }
    assert.deepEqual(afterDenial, mode === "valid"
      ? { privateMemberVisible: true, alerts: [] }
      : { privateMemberVisible: false, alerts: [f.i18n.t("workspace.admin.unavailable", "This workspace is unavailable.")] },
      "Only a completed positive consumed member envelope may shield an older exact denial; malformed/error values cannot become that proof");
  });
