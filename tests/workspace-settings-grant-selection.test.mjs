// Explicit E successors to the archived eight B3 Grant cases. Six removal
// scenarios use genuine Projects Refresh, not cross-task Revoke. Unchanged
// healthy choices, native identity/raw scope and zero Grant invariants remain.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fixture, snapshot, endpoint, method } from "./helpers/workspace-settings-grant-selection-fixture.mjs";
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
  "E current Grant native option continuity " + locale + " / " + scenario.id,
  { concurrency: false, timeout: 30_000 }, async t => {
    const { f, service, members, native } = await fixture(t, locale);
    const original = snapshot(f), session = structuredClone(service.session), selected = native.choose(members.C.user_id);
    const before = native.observation(), fallbackCount = native.fallbacks.length, requestStart = service.requests.length;
    let pending = null;
    if (scenario.remove) {
      const target=members[scenario.remove];
      const gate=service.queue(request=>method(request)==="GET"&&request.url===endpoint("A"),"body");
      // Explicit finite report change; no Revoke, Grant or permission command.
      target.status="revoked";
      f.click(f.find("button",node=>Object.hasOwn(node.attributes,"data-workspace-settings-refresh")));
      await f.until(()=>gate.used&&gate.jsonCalls===1,"The actual current Projects Refresh reaches its body");
      pending=native.observation();assert.equal(pending.value,members.C.user_id,"No replacement body has published yet");
      assert.deepEqual(service.writes,[]);
      gate.release.resolve();await f.flush(18);
      await f.until(()=>!native.current().options.some(option=>option.node.value===target.user_id&&!Object.hasOwn(option.node.attributes,"disabled")),
        "The current read makes this exact member unavailable to Grant");
      assert.equal(gate.jsonCalls,1);assert.equal(target.status,"revoked");
    } else await f.flush(18);
    const after = native.observation(), commands = service.requests.slice(requestStart).filter(request => method(request) !== "GET");
    assert.equal(native.current(), selected.record, "The exact mounted form/select owner survives this same-resource read.");
    assert.deepEqual(snapshot(f), original); assert.deepEqual(service.session, session);
    assert.equal(f.store.authorizationScopeActive(original.authorization), true);
    assert.equal(commands.length, 0); assert.equal(commands.some(request => method(request) === "POST"), false);
    assert.equal(service.tokenCount.A + service.tokenCount.B, 0); assert.equal(f.dialog(), null);
    assert.equal(after.formDataValue, after.value, "Native FormData names the current selected option, never an artificial retained raw map.");
    f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
    const record = { locale, scenario: scenario.id, before, pending, after,
      selectedOptionNodeBefore: selected.option.id, selectedNodeStillMounted: native.current().options.includes(selected.option),
      selectedValueCommits: native.commits.filter(commit => commit.optionNode === selected.option.id),
      fallbacksAfterChoice: native.fallbacks.length - fallbackCount, commands: commands.map(request => ({ method: method(request), url: request.url })),
      grantCommands: 0, providers: 0, realPermissionChanges: 0, sameSourceRoutePrincipal: true,
      evidence: "Complete actual component/Store/current Projects Refresh; finite changed member report and bounded OPTION-node selectedness; GET-only, no Revoke/Grant/ACK, installed Lit commits, no browser/AT claim" };
    observations.push(record); t.diagnostic(JSON.stringify(record));
    if (scenario.desired === "retain") assert.equal(after.value, members.C.user_id,
      "Still-eligible deliberately selected C must remain C after an unrelated current member refresh, never silently become D.");
    else assert.ok(after.value === "" || after.value === members.C.user_id && after.options.some(option => option.selected && option.disabled),
      "A removed selected member requires the existing empty Choose state or an explicit unavailable retained option, never a different person.");
  });
