// The original eight current-control case bodies/assertions are byte-identical
// to the root-replayed B3 R3 baseline. Reuse one native-option adapter; no Grant.
// Run with the existing no-provider preload and serial test concurrency.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fixture, snapshot, ancestor, endpoint, method } from "./helpers/workspace-settings-grant-selection-fixture.mjs";
const observations = [];
after(() => {
  assert.equal(observations.length, 8, "Every case must reach its current-control observation; prerequisite failures are not product findings.");
});

const scenarios = [
  { id: "unchanged redraw", remove: null, desired: "retain" },
  { id: "trailing D revoked healthy refresh", remove: "D", desired: "retain" },
  { id: "preceding B revoked eligible C retained", remove: "B", desired: "retain" },
  { id: "selected C revoked explicit unavailable or clear", remove: "C", desired: "unavailable" },
];
for (const locale of ["en", "ja"]) for (const scenario of scenarios) test(
  "B3 current Grant native option continuity " + locale + " / " + scenario.id,
  { concurrency: false, timeout: 30_000 }, async t => {
    const { f, service, members, native } = await fixture(t, locale);
    const original = snapshot(f), session = structuredClone(service.session), selected = native.choose(members.C.user_id);
    const before = native.observation(), fallbackCount = native.fallbacks.length, requestStart = service.requests.length;
    let pending = null;
    if (scenario.remove) {
      const target = members[scenario.remove], url = endpoint("A", "/members/" + target.membership_id);
      const gate = service.queue(request => method(request) === "GET" && request.url === endpoint("A"), "body");
      const button = f.find("button", node => String(node.handlers.click).includes("#revokeMember")
        && ancestor(node, "tr")?.text.includes(target.email));
      f.click(button); assert.ok(f.dialog(), "Current member Revoke opens the actual owned dialog before any redraw.");
      assert.equal(service.writes.length, 0); f.confirm();
      // Reuse the existing fixture's ordinary confirm-then-turn sequence. Its
      // unrelated flat button ports are not a retained native DOM; do not force
      // a redraw between confirmation and its real synchronous continuation.
      await f.flush(1);
      await f.until(() => gate.used && gate.jsonCalls === 1, "The actual command reaches its same-resource follow-up body.");
      pending = native.observation(); assert.equal(pending.value, members.C.user_id, "No replacement read has published yet.");
      assert.deepEqual(service.writes.map(write => [write.method, write.url]), [["DELETE", url]]);
      gate.release.resolve(); await f.flush(18);
      await f.until(() => !f.nodes("button").some(node => String(node.handlers.click).includes("#revokeMember")
        && ancestor(node, "tr")?.text.includes(target.email)), "The new current member status is actually published.");
      assert.equal(gate.jsonCalls, 1); assert.equal(target.status, "revoked");
    } else await f.flush(18);
    const after = native.observation(), commands = service.requests.slice(requestStart).filter(request => method(request) !== "GET");
    assert.equal(native.current(), selected.record, "The exact mounted form/select owner survives this same-resource read.");
    assert.deepEqual(snapshot(f), original); assert.deepEqual(service.session, session);
    assert.equal(f.store.authorizationScopeActive(original.authorization), true);
    assert.equal(commands.length, scenario.remove ? 1 : 0); assert.equal(commands.some(request => method(request) === "POST"), false);
    assert.equal(service.tokenCount.A + service.tokenCount.B, 0); assert.equal(f.dialog(), null);
    assert.equal(after.formDataValue, after.value, "Native FormData names the current selected option, never an artificial retained raw map.");
    f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
    const record = { locale, scenario: scenario.id, before, pending, after,
      selectedOptionNodeBefore: selected.option.id, selectedNodeStillMounted: native.current().options.includes(selected.option),
      selectedValueCommits: native.commits.filter(commit => commit.optionNode === selected.option.id),
      fallbacksAfterChoice: native.fallbacks.length - fallbackCount, commands: commands.map(request => ({ method: method(request), url: request.url })),
      grantCommands: 0, providers: 0, realPermissionChanges: 0, sameSourceRoutePrincipal: true,
      evidence: "Complete actual component/Store/current Revoke/native confirmation; finite HTTP and bounded OPTION-node selectedness; installed Lit attribute commits; no browser/AT claim" };
    observations.push(record); t.diagnostic(JSON.stringify(record));
    if (scenario.desired === "retain") assert.equal(after.value, members.C.user_id,
      "Still-eligible deliberately selected C must remain C after an unrelated current member refresh, never silently become D.");
    else assert.ok(after.value === "" || after.value === members.C.user_id && after.options.some(option => option.selected && option.disabled),
      "A removed selected member requires the existing empty Choose state or an explicit unavailable retained option, never a different person.");
  });
