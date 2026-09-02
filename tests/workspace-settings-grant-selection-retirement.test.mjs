// E setup-only task forward: true departure/return now uses Projects.
// Original four ownership/source/selection/fiscal assertions remain exact.
// Separate regression controls: the exact-eight selectedness cases are not
// edited. Reuse their one actual Settings/native-option fixture. Finite current
// session/HTTP transitions are not real permission writes or browser/AT proof.
import assert from "node:assert/strict";
import test from "node:test";
import { fixture, snapshot, endpoint, method } from "./helpers/workspace-settings-grant-selection-fixture.mjs";

for (const [boundary, locale] of [["query", "en"], ["organization", "ja"], ["authority removal", "en"], ["disconnect", "ja"]]) test(
  "B3 Grant selected option retires on a genuine " + boundary,
  { concurrency: false, timeout: 30_000 }, async t => {
    const { f, service, members, native } = await fixture(t, locale);
    const before = snapshot(f), old = native.choose(members.C.user_id), start = service.requests.length;
    const source = () => structuredClone({ events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() });
    const fiscal = () => structuredClone({ service: { budgets: service.session.budgets, costBudgets: service.session.costBudgets },
      store: { budgets: f.store.session.get().budgets, costBudgets: f.store.session.get().costBudgets } });
    const fiscalBefore = fiscal(); let expectedSource = source(), retiredSource = null;
    assert.equal(native.observation().value, members.C.user_id);
    if (boundary === "query") {
      f.store.setRoute(before.route + "?view=another-authorized-view"); f.draw();
      assert.equal(old.record.form.isConnected, false, "A genuine query departure is not a focus fragment.");
      await f.flush();
    } else if (boundary === "organization") {
      f.navigate("B", "projects"); assert.equal(old.record.form.isConnected, false);
      await f.flush(); assert.equal(native.observation().value, "", "Another organization's chooser starts without A's selected member.");
      f.navigate("A", "projects"); await f.flush();
    } else if (boundary === "authority removal") {
      // The base selectedness fixture admits a valid A detail for its same-owner
      // cases. This negative explicitly denies it after the finite session no
      // longer includes A; do not combine removed authority with a fake200.
      const reply = service.reply; let denied = true;
      service.reply = request => denied && method(request) === "GET" && request.url.startsWith(endpoint("A"))
        ? { status: 403, body: { error: "access_denied" } } : reply(request);
      service.roles.A = "none"; await f.refreshAuthority();
      retiredSource = source();
      assert.deepEqual(retiredSource, { events: [], content: {}, head: 0 },
        "Actual Store authority retirement clears the former Source before new presentation.");
      expectedSource = retiredSource; await f.flush();
      assert.deepEqual(source(), expectedSource, "Denied metadata reads cannot revive the retired Source.");
      assert.equal(old.record.form.isConnected, false);
      assert.equal(f.nodes("select").filter(node => node.attributes.name === "userId").length, 0,
        "Known current denial removes the private Grant control, rather than preserving an old eligible person.");
      assert.equal(f.store.authorizationScopeActive(before.authorization), false);
      denied = false; service.roles.A = "owner"; await f.refreshAuthority();
      expectedSource = source();
      assert.deepEqual(expectedSource, retiredSource,
        "Restoring metadata authority is not a new Source read or permission to reinstall old event bytes.");
      await f.flush();
    } else {
      f.disconnect(); f.draw(); assert.equal(old.record.form.isConnected, false);
      f.reconnect(); await f.flush();
    }
    const current = native.current(), after = native.observation();
    assert.notEqual(current.form, old.record.form); assert.notEqual(current.select, old.record.select);
    assert.equal(old.record.form.isConnected, false); assert.equal(old.record.select.isConnected, false);
    assert.equal(after.value, "", "A new current owner uses the existing empty Choose state, not the old selected C.");
    assert.equal(after.formDataValue, "");
    assert.ok(after.options.some(option => option.value === members.C.user_id), "C is still a valid fresh choice, not removed to make clearing pass.");
    assert.equal(service.requests.slice(start).every(request => method(request) === "GET"), true);
    assert.equal(service.writes.length, 0); assert.equal(service.tokenCount.A + service.tokenCount.B, 0);
    assert.deepEqual(source(), expectedSource, boundary === "authority removal"
      ? "The recorded new-owner Source must not rebound to stale pre-retirement bytes after rendering."
      : "A non-authority presentation boundary does not alter the current Source.");
    assert.deepEqual(fiscal(), fiscalBefore, "Both actual Store and finite service accounting fields remain unchanged.");
    assert.equal(f.dialog(), null); f.assertNoExternal();
    t.diagnostic(JSON.stringify({ boundary, locale, originalForm: old.record.id, currentForm: current.id,
      currentValue: after.value, sourceDisposition: retiredSource ? "retired; no stale rebound" : "unchanged",
      retiredSource: retiredSource && { eventCount: retiredSource.events.length, contentKeys: Object.keys(retiredSource.content).length, head: retiredSource.head },
      currentSource: { eventCount: expectedSource.events.length, contentKeys: Object.keys(expectedSource.content).length, head: expectedSource.head },
      fiscalFieldsUnchanged: true, commandRequests: 0, providers: 0,
      evidence: "current public Store/HTTP ownership transitions plus finite native option ports; no physical input or actual permission mutation" }));
  });
