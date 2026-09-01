// Actual current Workspace/Store, native OPTION identity and installed Lit parts.
// Reuse the original Grant adapter with explicit Transfer form/field parameters.
// Revoke is a finite service response only. Never dispatch an ownership transfer.
// Required-select validity below is a bounded default-action port, not a browser.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fixture, snapshot, ancestor, endpoint, method } from "./helpers/workspace-settings-grant-selection-fixture.mjs";

const transferFixture = (t, locale) => fixture(t, locale, { memberRole: "administrator", selection: {
  formHandler: "#confirmOwnershipTransfer", fieldName: "targetUserId", roleField: false, allowNoPlaceholder: true,
} });
const observations = [];
after(() => assert.equal(observations.length, 6,
  "All six cases must reach the selectedness and fresh-confirmation observations; setup failures are not product failures."));

function requiredState(native) {
  const record = native.current(), select = record.select, selected = record.options.find(option => option.node.selected);
  assert.equal(Object.hasOwn(select.attributes, "required"), true);
  assert.equal(Object.hasOwn(select.attributes, "multiple"), false);
  assert.equal(Number(select.attributes.size ?? 1), 1);
  // All options in this actual form are direct children, with no OPTGROUP.
  // The first empty option, when actually emitted, is the native placeholder.
  const placeholder = record.options[0]?.node.value === "" ? record.options[0] : null;
  return { valueMissing: !selected || selected === placeholder, selected, placeholder };
}
async function inspectCurrentTransfer(f, native) {
  const record = native.current(), state = requiredState(native);
  const source = f.find("form", node => node.port === record.form && String(node.handlers.submit).includes("#confirmOwnershipTransfer"));
  const button = f.find("button", node => node.attributes.type === "submit" && ancestor(node, "form")?.port === source.port);
  assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
  assert.equal(new FormData(record.form).get("targetUserId"), record.select.value);
  let modal = null;
  if (!state.valueMissing) {
    // A current native submit uses the selected OPTION's FormData already
    // installed by the adapter, never a hand-written targetUserId fixture map.
    button.port.focus();
    source.handlers.submit.call(source.owner, { type: "submit", target: source.port, currentTarget: source.port,
      submitter: button.port, preventDefault() {}, stopPropagation() {} });
    const dialog = f.dialog(); assert.ok(dialog, "Fresh current valid selection reaches the actual owned confirmation.");
    modal = { title: dialog.querySelector("h2").textContent, message: dialog.querySelector("p").textContent,
      locale: dialog.lang, direction: dialog.dir };
    assert.equal(dialog.getAttribute("aria-labelledby"), dialog.querySelector("h2").id);
    assert.equal(dialog.getAttribute("aria-describedby"), dialog.querySelector("p").id);
    assert.equal(modal.locale, f.locale);
    assert.ok(modal.message.endsWith(f.i18n.t("workspace.admin.selectedTarget", "Selected target: {name}",
      { name: "\u2068" + state.selected.text + "\u2069" })),
      "Counterevidence: the later modal accurately names the current selection, not a stale or fabricated target.");
    f.cancel(); await f.flush(4); assert.equal(f.dialog(), null);
  } else assert.equal(f.dialog(), null, "The explicit required empty choice has no native submit default action.");
  return { valueMissing: state.valueMissing, modal };
}
const scenarios = [
  { id: "unchanged healthy", remove: null, desired: "retain" },
  { id: "preceding B revoked eligible C retained", remove: "B", desired: "retain" },
  { id: "selected C revoked must require a new choice", remove: "C", desired: "clear" },
];
for (const locale of ["en", "ja"]) for (const scenario of scenarios) test(
  "B3 current Transfer native option continuity " + locale + " / " + scenario.id,
  { concurrency: false, timeout: 30_000 }, async t => {
    const { f, service, members, native } = await transferFixture(t, locale);
    const original = snapshot(f), session = structuredClone(service.session);
    const initial = native.observation(), initialValidity = requiredState(native).valueMissing;
    const selected = native.choose(members.C.user_id), before = native.observation();
    const fallbackCount = native.fallbacks.length, requestStart = service.requests.length;
    let pending = null;
    if (scenario.remove) {
      const target = members[scenario.remove], url = endpoint("A", "/members/" + target.membership_id);
      const gate = service.queue(request => method(request) === "GET" && request.url === endpoint("A"), "body");
      const button = f.find("button", node => String(node.handlers.click).includes("#revokeMember")
        && ancestor(node, "tr")?.text.includes(target.email));
      f.click(button); assert.ok(f.dialog()); assert.equal(service.writes.length, 0);
      f.confirm(false); // Finite positive click/submit, explicitly not trusted physical input.
      await f.flush(1);
      await f.until(() => gate.used && gate.jsonCalls === 1, "Current finite Revoke reaches its same-resource replacement body.");
      pending = native.observation(); assert.equal(pending.value, members.C.user_id);
      assert.deepEqual(service.writes.map(write => [write.method, write.url]), [["DELETE", url]]);
      gate.release.resolve(); await f.flush(18);
      await f.until(() => !f.nodes("button").some(node => String(node.handlers.click).includes("#revokeMember")
        && ancestor(node, "tr")?.text.includes(target.email)), "The current revoked status has actually published.");
      assert.equal(gate.jsonCalls, 1); assert.equal(target.status, "revoked");
    } else await f.flush(18);
    const after = native.observation();
    assert.equal(native.current(), selected.record, "Same current resource retains the exact mounted Transfer form/select.");
    const review = await inspectCurrentTransfer(f, native);
    const commands = service.requests.slice(requestStart).filter(request => method(request) !== "GET");
    assert.deepEqual(snapshot(f), original); assert.deepEqual(service.session, session);
    assert.equal(f.store.authorizationScopeActive(original.authorization), true);
    assert.equal(commands.length, scenario.remove ? 1 : 0);
    assert.equal(commands.some(request => request.url.endsWith("/ownership") || method(request) === "POST"), false);
    assert.equal(service.writes.length, scenario.remove ? 1 : 0);
    assert.equal(service.tokenCount.A + service.tokenCount.B, 0); assert.equal(f.dialog(), null);
    assert.equal(after.formDataValue, after.value);
    f.assertNoExternal(); assert.deepEqual(f.transport.external, []);
    const record = { locale, scenario: scenario.id, initial, initialValueMissing: initialValidity, before, pending, after, review,
      selectedOptionNodeBefore: selected.option.id, selectedNodeStillMounted: native.current().options.includes(selected.option),
      selectedValueCommits: native.commits.filter(commit => commit.optionNode === selected.option.id),
      fallbacksAfterChoice: native.fallbacks.length - fallbackCount,
      commands: commands.map(request => ({ method: method(request), url: request.url })),
      ownershipTransferCommands: 0, realPermissionChanges: 0, providerCalls: 0, fiscalFieldsUnchanged: true, sameSourceRoutePrincipal: true,
      evidence: "Full actual Workspace/Store/current Revoke and fresh Transfer→Cancel; finite service/default-action/OPTION ports and installed Lit parts, not Worker authority or browser/AT" };
    observations.push(record); t.diagnostic(JSON.stringify(record));
    if (scenario.desired === "retain") assert.equal(after.value, members.C.user_id,
      "Still-eligible deliberately selected C must stay C, never silently become D after preceding B is revoked.");
    else {
      assert.equal(after.value, "", "Removing selected C must require a new deliberate choice, not another actionable administrator.");
      assert.equal(review.valueMissing, true); assert.equal(review.modal, null);
    }
  });

for (const locale of ["en", "ja"]) test("B3 Transfer explicit initial choice " + locale,
  { concurrency: false, timeout: 30_000 }, async t => {
    const { f, service, members, native } = await transferFixture(t, locale);
    const source = snapshot(f), initial = native.observation(), state = requiredState(native);
    assert.equal(initial.value, "", "The deliberate new initial UX requires choosing an administrator.");
    assert.equal(initial.formDataValue, "");
    assert.equal(state.valueMissing, true);
    assert.equal(state.placeholder.text, f.i18n.t("field.choose", "Choose an option"));
    const absent = await inspectCurrentTransfer(f, native);
    assert.deepEqual(absent, { valueMissing: true, modal: null });
    native.choose(members.C.user_id);
    const chosen = await inspectCurrentTransfer(f, native);
    assert.equal(chosen.valueMissing, false);
    assert.ok(chosen.modal.message.includes(members.C.display_name));
    assert.equal(service.writes.length, 0);
    assert.equal(service.requests.every(request => method(request) === "GET"), true);
    assert.deepEqual(snapshot(f), source); f.assertNoExternal();
  });
