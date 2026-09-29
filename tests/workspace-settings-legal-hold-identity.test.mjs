import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

// Actual Workspace/Store/native confirmation with finite GET-only settings.
// The original eight root-run case bodies remain exact. Source freezes are owned
// by the external root runner, not a historical application hash in these tests.
const sha256 = value => createHash("sha256").update(value).digest("hex");

// Reuse the complete existing caller fixture prefix, not its registered tests.
// No application method or private state is extracted, replaced, or exposed.
const fixture = new URL("./workspace-settings-confirmation.test.mjs", import.meta.url);
const source = fs.readFileSync(fixture, "utf8");
const marker = "\nfor (const action of ACTIONS) test(";
const boundary = source.indexOf(marker);
assert.ok(boundary > 0 && source.indexOf(marker, boundary + 1) === -1);
const fixtureSource = source.slice(0, boundary) + "\nexport { workspace, ACTIONS, entries, verb, endpoint, path, ORG, PRINCIPAL, NOW };\n";
fixture.search = "b3-r2-legal-hold-cancel-only";
const hook = registerHooks({ load(url, context, next) {
  return url === fixture.href ? { format: "module", source: fixtureSource, shortCircuit: true } : next(url, context);
} });
let workspace, ACTIONS, entries, verb, endpoint, route, PRINCIPAL, NOW;
try { ({ workspace, ACTIONS, entries, verb, endpoint, path: route, PRINCIPAL, NOW } = await import(fixture.href)); }
finally { hook.deregister(); }

const visibleText = value => String(value).replace(/[\u2066-\u2069]/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();
const literalText = node => [node.textContent ?? "", ...(node.children ?? []).map(literalText)].join(" ");
const reason = "Preserve licensed project evidence اسم 同じ理由";

async function holds(t, count, locale) {
  const action = ACTIONS.find(candidate => candidate.id === "hold"); assert.ok(action);
  const f = await workspace(t, action, locale), original = f.service.reply;
  const rows = Array.from({ length: count }, (_, index) => ({ hold_id: "finite-hold-" + (index + 1),
    scope_kind: "project", resource_id: "finite-authorized-project-access-" + (index + 1), reason,
    status: "active", created_by_user_id: PRINCIPAL, created_at: NOW, released_at: null }));
  let reads = 0;
  f.service.reply = request => {
    assert.equal(verb(request), "GET", "Cancel-only fixture refuses every release or other mutation before the existing finite service");
    const response = original(request), name = new URL(request.url, "http://localhost").pathname;
    if (name === endpoint("A", "/holds") && response.status === 200) {
      response.body.holds = structuredClone(rows); reads++;
    }
    return response;
  };
  f.store.setRoute("/settings/workspaces"); await f.flush();
  f.store.setRoute(route("A", action.section)); await f.flush();
  assert.ok(reads > 0, "the actual current Workspace consumed this selected organization's finite authorized hold collection");
  assert.equal(f.service.roles.A, "owner");
  assert.ok(f.store.session.get().capabilities.includes("workspace.policy.manage"));
  assert.equal(new Set(rows.map(row => row.hold_id)).size, count);
  assert.equal(new Set(rows.map(row => row.resource_id)).size, count);
  const before = JSON.stringify({ events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get(),
    budgets: f.store.session.get().budgets, costBudgets: f.store.session.get().costBudgets });
  t.after(() => {
    assert.deepEqual(f.service.writes, []);
    assert.equal(f.service.requests.some(request => verb(request) !== "GET"), false);
    assert.deepEqual(f.transport.external, []);
    assert.equal(JSON.stringify({ events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get(),
      budgets: f.store.session.get().budgets, costBudgets: f.store.session.get().costBudgets }), before);
  });
  return { f, action, rows };
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const count of [1, 2]) test(
  "B3 R2 legal-hold visible identity " + locale + " " + (count === 1 ? "healthy single-target Cancel" : "same-scope same-reason distinct-resource collision"),
  { timeout: 15000 }, async t => {
    const { f, action, rows } = await holds(t, count, locale), observations = [];
    for (let index = 0; index < count; index++) {
      f.draw(); const tree = f.tree(), choices = tree.visible("button").filter(node => node.text === f.label());
      assert.equal(choices.length, count, "each currently listed active hold has its ordinary visible Release control");
      const choice = choices[index]; let row = choice.parent;
      while (row && row.tag !== "li") row = row.parent;
      assert.ok(row && choice.port?.isConnected && !choice.hiddenBy && !Object.hasOwn(choice.attributes, "disabled"));
      assert.ok(row.text.includes(reason), "the complete existing resource row contains the actual retained hold reason");
      const rowText = visibleText(row.text), programmaticName = visibleText(choice.attributes["aria-label"] ?? choice.text);
      choice.port.focus();
      choice.handlers.click.call(choice.owner, { target: choice.port, currentTarget: choice.port, preventDefault() {} });
      try {
        const dialog = f.dialog(); assert.ok(dialog, "the existing native confirmation opens for this selected current hold");
        assert.equal(dialog.lang, locale); assert.equal(dialog.dir, locale === "ar" ? "rtl" : "ltr");
        assert.equal(dialog.getAttribute("aria-labelledby"), dialog.querySelector("h2").id);
        assert.equal(dialog.getAttribute("aria-describedby"), dialog.querySelector("p").id);
        assert.ok(dialog.querySelector("h2").textContent.includes("Workspace A"));
        assert.equal(f.buttons()[1].textContent, f.label()); assert.equal(f.doc.activeElement, f.buttons()[0]);
        const modalText = visibleText(literalText(dialog));
        observations.push({ holdId: rows[index].hold_id, resourceId: rows[index].resource_id, rowText, programmaticName, modalText,
          completeContext: visibleText(tree.root.text + " | " + rowText + " | " + modalText) });
        assert.deepEqual(f.service.writes, [], "opening a target review never releases the hold");
      } finally {
        if (f.dialog()) f.cancel(); await f.flush();
      }
      assert.equal(f.dialog(), null); assert.deepEqual(f.service.writes, []);
    }
    assert.equal(f.store.route.get(), route("A", action.section));
    const distinctRows = new Set(observations.map(value => value.rowText)).size;
    const distinctModals = new Set(observations.map(value => value.modalText)).size;
    const distinctFullContexts = new Set(observations.map(value => value.completeContext)).size;
    t.diagnostic(JSON.stringify({ locale, observations: observations.map(({ completeContext, ...value }) => ({ ...value, completeContextSha: sha256(completeContext) })),
      distinctRows, distinctModals, distinctFullContexts, releaseRequests: 0, providerRequests: 0,
      evidence: "actual Workspace/Store/native helper; finite current authorized GET schema, Cancel only; not backend authorization, live holds, physical AT or financial settlement" }));
    assert.equal(distinctRows, count, "different held resources must be distinguishable in the complete current visible rows, not only captured DELETE IDs");
    assert.equal(distinctModals, count, "the final review must visibly identify which same-context hold would be released");
    assert.equal(distinctFullContexts, count, "even the complete page plus selected row and modal cannot collapse two distinct exact resources");
  });

for (const locale of ["en", "fr", "ar", "ja"]) test("Workspace legal-hold current labels remain exact after reordered or changed metadata / " + locale,
  { timeout: 15000 }, async t => {
    const { f, action, rows } = await holds(t, 2, locale);
    const reload = async () => {
      f.store.setRoute("/settings/workspaces"); await f.flush();
      f.store.setRoute(route("A", action.section)); await f.flush();
    };
    const choices = () => {
      f.draw();
      const buttons = f.tree().visible("button").filter(node => node.text === f.label());
      assert.equal(buttons.length, rows.length);
      return buttons.map((node, index) => {
        let row = node.parent; while (row && row.tag !== "li") row = row.parent;
        assert.ok(row);
        const label = entries(row).find(child => child.tag === "bdi")?.text;
        assert.ok(label, "the complete current identity is visible, not only a hidden callback ID");
        assert.ok(visibleText(label).includes(visibleText(rows[index].reason)));
        assert.ok(visibleText(label).includes("[" + encodeURIComponent(rows[index].resource_id) + "]"));
        assert.equal(node.attributes["aria-label"], f.i18n.t("artifact.delivery.namedAction", "{action} — {name}",
          { action: f.label(), name: "\u2068" + label + "\u2069" }));
        return { id: rows[index].hold_id, label, node };
      });
    };
    const inspect = async () => {
      const current = choices(), labels = new Map(current.map(choice => [choice.id, choice.label]));
      assert.equal(new Set([...labels.values()].map(visibleText)).size, rows.length);
      for (const id of rows.map(row => row.hold_id)) {
        const choice = choices().find(value => value.id === id); assert.ok(choice);
        choice.node.port.focus();
        choice.node.handlers.click.call(choice.node.owner, { target: choice.node.port, currentTarget: choice.node.port, preventDefault() {} });
        try {
          const dialog = f.dialog(); assert.ok(dialog);
          assert.equal(dialog.querySelector("p").textContent, f.i18n.system("Release this legal hold? Eligible expired evidence can then be removed.")
            + "\n" + f.i18n.t("workspace.admin.selectedTarget", "Selected target: {name}", { name: "\u2068" + choice.label + "\u2069" }));
          assert.equal(dialog.lang, locale); assert.equal(dialog.dir, locale === "ar" ? "rtl" : "ltr");
          assert.equal(f.buttons()[1].textContent, f.label(), "the destructive action label itself is unchanged");
          assert.equal(f.doc.activeElement, f.buttons()[0]);
          assert.deepEqual(f.service.writes, []);
        } finally { if (f.dialog()) f.cancel(); await f.flush(); }
      }
      return labels;
    };
    const original = await inspect();
    rows.reverse(); await reload();
    assert.deepEqual(await inspect(), original, "server collection order cannot reassign an exact hold's visible identity");
    rows[1].resource_id = rows[0].resource_id; await reload();
    const sameResource = await inspect();
    rows.reverse(); await reload();
    assert.deepEqual(await inspect(), sameResource, "separate holds even on one resource keep stable collision qualifiers");
    const changedId = rows[0].hold_id;
    rows[0].resource_id = "current-authorized-replacement-resource";
    rows[0].reason = "Current retained reason 日本語";
    await reload(); const changed = await inspect();
    assert.notEqual(changed.get(changedId), sameResource.get(changedId), "a new current metadata read is not mislabeled with an older target");
    assert.deepEqual(f.service.writes, []); assert.deepEqual(f.transport.external, []);
    t.diagnostic(JSON.stringify({ locale, reordered: true, sameResourceDistinctHolds: true, changedCurrentMetadata: true,
      releaseRequests: 0, providerRequests: 0, evidence: "current full component/native helper with finite reads and Cancel only; no queued-native, live authorization or release claim" }));
  });
