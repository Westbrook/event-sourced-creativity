// Portable original four-case proof. Finite HTTP is not Worker authorization,
// real credential issuance, provider execution or physical browser evidence.
import assert from "node:assert/strict";
import test from "node:test";
import { settingsFixture, endpoint, tokenPath, method } from "./helpers/workspace-settings-whole-read-fixture.mjs";

const PRIVATE = ["PRIVATE_A_MEMBER", "PRIVATE_A_PACKAGE", "PRIVATE_A_STORAGE", "PRIVATE_A_ASSURANCE"];
const TOKEN = "fixture-token-A-1";
const SAVED = "A scoped provisioning token was created and is displayed only during this authorized session.";
const options = { concurrency: false, timeout: 30_000 };
const currentSnapshot = f => structuredClone({ route: f.store.route.get(), session: f.store.session.get(),
  events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get(),
  authorization: f.store.captureAuthorizationScope() });
const visible = f => {
  const text = f.privateText();
  return { privateMarkers: PRIVATE.filter(marker => text.includes(marker)), token: f.token(TOKEN),
    savedNotice: f.text().includes(f.i18n.system(SAVED)) };
};
const expectedVisible = (privateAllowed, tokenAllowed, savedNotice = true) => ({
  privateMarkers: privateAllowed ? PRIVATE : [], token: tokenAllowed, savedNotice,
});

for (const resource of ["overview", "detail"]) for (const status of [200, 403]) test(
  "B3 whole Workspace " + resource + " post-ACK same-session " + (status === 200 ? "healthy held200" : "known held403 privacy"),
  options, async t => {
    const f = await settingsFixture(t, { locale: "en", section: "overview" }), service = f.service;
    assert.deepEqual(visible(f).privateMarkers, PRIVATE, "all existing private fields genuinely render before this operation");
    assert.equal(service.writes.length, 0); assert.equal(f.token(TOKEN), false);
    const original = currentSnapshot(f), serviceSession = structuredClone(service.session);
    const authorization = f.store.captureAuthorizationScope(), requestStart = service.requests.length;
    let authorizationEvents = 0;
    const onAuthorization = () => { authorizationEvents++; };
    f.storeHost.window.addEventListener("forma-authorization-changed", onAuthorization);
    const url = resource === "overview" ? "/api/workspaces" : endpoint("A");
    const gate = service.queue(request => method(request) === "GET" && request.url === url, "body",
      status === 200 ? null : { status: 403, body: { error: "access_denied" } });
    let headers, settled, recovered = null, jsonCallsAtHeaders = null;
    const assertOriginalOwner = () => {
      assert.deepEqual(currentSnapshot(f), original, "same actual Store session/route/Source and authorization");
      assert.deepEqual(service.session, serviceSession, "finite service did not bump, replace or revoke the session");
      assert.equal(f.store.authorizationScopeActive(authorization), true);
      assert.equal(authorizationEvents, 0, "an authorization event did not pre-clear the cache for this proof");
    };
    const assertKnownReceipt = () => {
      assert.equal(service.writes.length, 1);
      assert.deepEqual(service.writes.map(write => [write.method, write.url]), [["POST", tokenPath("A")]]);
      assert.equal(service.writes[0].receipt.token, TOKEN, "the existing finite service issued one positive201");
      assert.equal(service.tokenCount.A, 1); assert.equal(service.tokenCount.B, 0);
      const commands = service.requests.slice(requestStart).filter(request => !["GET", "HEAD"].includes(method(request)));
      assert.equal(commands.length, 1); assert.equal(commands[0].url, tokenPath("A"));
      assert.equal(service.requests.slice(requestStart).filter(request => request.url === "/api/session").length, 1,
        "the existing acknowledged command refreshes the same actual Store session once");
      f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
    };
    try {
      f.issue(); // Existing enabled native button, actual #issueProvisioningToken -> #mutate -> Store refresh -> #load.
      await f.until(() => gate.used, "the exact existing follow-up GET reaches its finite response");
      await f.flush();
      assert.equal(gate.phase, "body"); assert.equal(gate.request.url, url);
      assertKnownReceipt(); assertOriginalOwner();
      // The native Response headers have returned; the test has not released JSON.
      // A repaired denial need not consume the error body, so do not require jsonCalls1.
      headers = visible(f); jsonCallsAtHeaders = gate.jsonCalls;
      if (status === 200) assert.equal(gate.jsonCalls, 1, "healthy current read actually awaits the held body");

      gate.release.resolve(); await f.flush(18);
      assertKnownReceipt(); assertOriginalOwner();
      settled = visible(f);
      if (status === 403) {
        await f.until(() => f.nodes("button").some(node => node.text === f.i18n.t("action.retry", "Try again")),
          "completed current denial leaves the existing explicit read-only retry");
        settled = visible(f);
        const readsBefore = service.requests.length;
        f.click(f.find("button", node => node.text === f.i18n.t("action.retry", "Try again")));
        await f.until(() => PRIVATE.every(marker => f.privateText().includes(marker)),
          "fresh deliberate authorized read restores the current private view");
        await f.flush();
        assert.equal(service.requests.slice(readsBefore).every(request => method(request) === "GET"), true);
        assert.equal(service.requests.slice(readsBefore).filter(request => request.url === url).length, 1);
        recovered = visible(f);
      }
      assertKnownReceipt(); assertOriginalOwner();
      assert.equal(f.text().includes(f.i18n.system("Workspace changes could not be saved.")), false,
        "the positive receipt is not rewritten as a failed mutation");
      t.diagnostic(JSON.stringify({ resource, status, bodyWasHeldAtObservation: true, jsonCallsAtHeaders,
        headers, settled, recovered, finite201Receipts: service.writes.length, authorizationEvents,
        sameSourceRouteSession: true, paidOrHoldOrReleaseCommands: 0, realProviderCalls: 0,
        evidence: "complete actual Settings/Store/native control with finite HTTP; not real credential issuance or Worker authority" }));
    } finally {
      gate.release.resolve(); await f.flush();
      f.storeHost.window.removeEventListener("forma-authorization-changed", onAuthorization);
    }
    // Desired assertions occur after all observations, finite cleanup and fresh
    // recovery, so a privacy/copy failure is not mislabeled as a setup failure.
    assert.deepEqual({ headers, settled, recovered }, {
      headers: expectedVisible(status === 200, status === 200),
      settled: expectedVisible(status === 200, status === 200),
      recovered: status === 403 ? expectedVisible(true, false) : null,
    }, "known current denial withdraws prior private evidence/token before JSON while the saved command stays acknowledged");
  });
