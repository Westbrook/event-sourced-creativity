// Permanent current-control regression: complete WorkspaceSettings/Store and
// existing finite HTTP/native ports. No grant/revoke is submitted, and no
// Worker authorization, operating-system picker or physical activation is claimed.
// The original four case bodies and native fixture assertions are unchanged.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Same declaration-only fixture used by the current member-identity suite.
// Import the complete fixture, not its test registrations or private methods.
const fixturePath = fileURLToPath(new URL("./workspace-settings-response-ownership.test.mjs", import.meta.url));
const fixtureSource = fs.readFileSync(fixturePath, "utf8");
const marker = 'for (const locale of ["en", "ja"]) test("workspace response ownership healthy private detail and one-time token "';
assert.equal(fixtureSource.split(marker).length, 2);
let declarations = fixtureSource.slice(0, fixtureSource.indexOf(marker));
assert.equal(declarations.includes("import.meta"), false);
let importLocations = 0;
declarations = declarations.replace(/from "(\.\/helpers\/[^"\n]+)"/gu, (_match, relative) => {
  importLocations++; return "from " + JSON.stringify(pathToFileURL(path.resolve(path.dirname(fixturePath), relative)).href);
});
assert.equal(importLocations, 3);
declarations += "\nexport { settingsFixture, endpoint, method };\n";
const { settingsFixture, endpoint, method } = await import("data:text/javascript;base64," + Buffer.from(declarations).toString("base64"));

const options = { concurrency: false, timeout: 30000 };
const normalize = value => String(value).replace(/[\u2066-\u2069]/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();
const descendants = node => node.children.filter(child => typeof child !== "string").flatMap(child => [child, ...descendants(child)]);
const ancestor = (node, tag) => { for (let current = node.parent; current; current = current.parent) if (current.tag === tag) return current; return null; };
const sourceSnapshot = f => structuredClone({ events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get(),
  session: f.store.session.get(), projectMembers: f.service.projectMembers });

async function currentGrantChoices(f, detail) {
  // Deliberate same-principal navigation loads a fresh authorized organization
  // detail through the existing explicit response port. The valid additional
  // current member is fixture data, never injected into component private state.
  f.navigate("B", "projects"); await f.flush();
  const gate = f.service.queue(request => method(request) === "GET" && request.url === endpoint("A"),
    "headers", { status: 200, body: detail });
  gate.release.resolve(); f.navigate("A", "projects"); await gate.seen.promise; await f.flush();
  assert.equal(gate.jsonCalls, 1);
  const select = f.find("select", node => node.attributes.name === "userId");
  assert.ok(select.port.isConnected && !select.hiddenBy); assert.equal(select.port.disabled, false);
  const label = ancestor(select, "label"), form = ancestor(select, "form"); assert.ok(label && form);
  assert.ok(label.text.includes(f.i18n.t("workspace.admin.member", "Member")));
  const submitters = descendants(form).filter(node => node.tag === "button" && node.attributes.type === "submit");
  assert.equal(submitters.length, 1); assert.equal(Object.hasOwn(submitters[0].attributes, "disabled"), false);
  assert.equal(submitters[0].text, f.i18n.t("workspace.admin.grant", "Grant access"));
  select.port.focus(); // Existing native focus port only; never force a disabled handler or submit.
  const choices = descendants(select).filter(node => node.tag === "option" && node.attributes.value)
    .map(node => ({ id: node.attributes.value, text: node.text, visibleText: normalize(node.text),
      ariaLabel: node.attributes["aria-label"] ?? null, title: node.attributes.title ?? null }));
  assert.equal(choices.length, 2); assert.equal(new Set(choices.map(choice => choice.id)).size, 2);
  assert.equal(f.nodes("table").some(node => node.text.includes(f.i18n.t("workspace.admin.memberCaption", "Organization members and invitations"))), false,
    "The separate email-bearing Members table is not rendered on this Projects section");
  return { choices, formText: normalize(form.text), associatedLabel: normalize(label.text) };
}

for (const locale of ["en", "ja"]) for (const sameName of [false, true]) test(
  "B3 current grant-member dropdown has recognizable exact choices " + locale + " " + (sameName ? "same-name" : "unique-name control"),
  options, async t => {
    const f = await settingsFixture(t, { locale, section: "projects" }), original = sourceSnapshot(f);
    const detail = structuredClone(f.service.reply({ url: endpoint("A"), init: {} }).body);
    const eligible = detail.members.find(member => member.status === "active" && member.role !== "owner"); assert.ok(eligible);
    eligible.display_name = "Alex Rowan";
    const second = { ...eligible, membership_id: eligible.membership_id + "-second", user_id: eligible.user_id + "-second",
      display_name: sameName ? "Alex Rowan" : "Jamie Rowan", email: "second-admin-A@example.invalid" };
    detail.members.push(second);
    const targets = [eligible, second]; assert.notEqual(targets[0].email, targets[1].email);
    const first = await currentGrantChoices(f, detail), byId = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(first.choices.map(choice => choice.id).sort(), targets.map(member => member.user_id).sort());
    const reordered = await currentGrantChoices(f, { ...detail, members: [...detail.members].reverse() });
    assert.deepEqual(byId(reordered.choices), byId(first.choices), "Displayed identity follows the member, not response order");
    assert.deepEqual(sourceSnapshot(f), original, "No source, actor, budget, receipt or finite project membership was changed");
    assert.equal(f.service.writes.length, 0); assert.equal(f.service.requests.every(request => method(request) === "GET"), true);
    assert.equal(f.dialog(), null); f.assertNoExternal();
    t.diagnostic(JSON.stringify({ locale, sameName, choices: first.choices, completeFormContext: first.formText,
      associatedLabel: first.associatedLabel, writes: 0, grantRequests: 0, revokeRequests: 0, externalCalls: 0,
      sourceAndFinancialStateUnchanged: true, authorityEvidence: "finite current organization detail, not Worker authorization",
      activationEvidence: "current enabled native select rendered/focused; no operating-system picker or physical input claim" }));
    assert.equal(new Set(first.choices.map(choice => choice.visibleText)).size, 2,
      "Two different eligible people require distinct complete visible option text, not only hidden exact user IDs");
  });

// Additional collision cases are separate from the immutable four above.
// Same current detail/renderer ports; all choices remain read-only.
async function supplementalGrantChoices(f, detail, targets) {
  f.navigate("B", "projects"); await f.flush();
  const gate = f.service.queue(request => method(request) === "GET" && request.url === endpoint("A"),
    "headers", { status: 200, body: detail });
  gate.release.resolve(); f.navigate("A", "projects"); await gate.seen.promise; await f.flush();
  assert.equal(gate.jsonCalls, 1);
  const select = f.find("select", node => node.attributes.name === "userId");
  assert.ok(select.port.isConnected && !select.hiddenBy); assert.equal(select.port.disabled, false);
  const form = ancestor(select, "form"), label = ancestor(select, "label"); assert.ok(form && label);
  assert.ok(label.text.includes(f.i18n.t("workspace.admin.member", "Member")));
  const submitters = descendants(form).filter(node => node.tag === "button" && node.attributes.type === "submit");
  assert.equal(submitters.length, 1); assert.equal(Object.hasOwn(submitters[0].attributes, "disabled"), false);
  assert.equal(submitters[0].text, f.i18n.t("workspace.admin.grant", "Grant access"));
  const choices = descendants(select).filter(node => node.tag === "option" && node.attributes.value)
    .map(node => ({ id: node.attributes.value, text: node.text, visibleText: normalize(node.text) }));
  assert.deepEqual(choices.map(choice => choice.id).sort(), targets.map(member => member.user_id).sort(),
    "The current chooser includes ordinary members and administrators, never the owner or inactive people");
  return choices;
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const variant of ["absent-email", "composed-alias"]) test(
  "B3 grant member identity closes " + variant + " in current eligible choices " + locale,
  options, async t => {
    const f = await settingsFixture(t, { locale, section: "projects" }), original = sourceSnapshot(f);
    const detail = structuredClone(f.service.reply({ url: endpoint("A"), init: {} }).body);
    const first = detail.members.find(member => member.status === "active" && member.role === "administrator"); assert.ok(first);
    const rawName = "Alex Rowan نور 日本語"; first.display_name = rawName;
    const second = { ...first, membership_id: first.membership_id + "-ordinary", user_id: first.user_id + "-ordinary",
      role: "member", email: "ordinary-member-A@example.invalid" };
    const targets = [first, second];
    if (variant === "absent-email") { delete first.email; delete second.email; }
    else targets.push({ ...second, membership_id: second.membership_id + "-alias", user_id: second.user_id + "-alias",
      display_name: rawName + " · " + first.email, email: "alias-member-A@example.invalid" });
    const inactive = { ...second, membership_id: "inactive-before-all", user_id: "inactive-before-all",
      status: "revoked", display_name: rawName, email: "inactive-member-A@example.invalid" };
    detail.members = [...detail.members.filter(member => member !== first), ...targets, inactive];
    const detailBefore = structuredClone(detail), before = await supplementalGrantChoices(f, detail, targets);
    const byId = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    const reversed = await supplementalGrantChoices(f, { ...detail, members: [...detail.members].reverse() }, targets);
    assert.deepEqual(byId(reversed), byId(before), "Qualification is stable through service reordering");
    for (const choice of before) {
      const record = targets.find(member => member.user_id === choice.id); assert.ok(record);
      assert.ok(choice.text.startsWith("\u2068" + record.display_name + "\u2069"), "Display qualification preserves the exact isolated authored name");
      assert.equal(choice.text.includes(inactive.email), false, "No inactive person's email is borrowed as context");
    }
    assert.equal(new Set(before.map(choice => choice.visibleText)).size, targets.length,
      "Final displayed names remain distinct after authorized email enrichment or stable fallback");
    if (variant === "absent-email") {
      const sorted = [...targets].sort((a, b) => a.membership_id.localeCompare(b.membership_id));
      for (const choice of before) {
        const rank = sorted.findIndex(member => member.user_id === choice.id) + 1;
        assert.ok(choice.text.includes(f.i18n.t("workspace.admin.memberQualifier", "Member {number}", { number: f.i18n.number(rank) })),
          "Missing human context uses the existing current-locale stable member qualifier");
        assert.equal(choice.text.includes("@example.invalid"), false, "Missing email does not invite an unrelated lookup or guess");
      }
    } else {
      assert.ok(before.find(choice => choice.id === first.user_id).text.includes(first.email));
      assert.ok(before.find(choice => choice.id === second.user_id).text.includes(second.email));
      assert.notEqual(before.find(choice => choice.id === first.user_id).visibleText,
        before.find(choice => choice.id === targets[2].user_id).visibleText,
        "An authored name that aliases an enriched label is closed by the second shared qualification pass");
    }
    assert.deepEqual(detail, detailBefore); assert.deepEqual(sourceSnapshot(f), original);
    assert.equal(f.service.writes.length, 0); assert.equal(f.service.requests.every(request => method(request) === "GET"), true);
    assert.equal(f.dialog(), null); f.assertNoExternal();
    t.diagnostic(JSON.stringify({ locale, variant, choices: before, ordinaryMemberIncluded: true, ownerAndInactiveExcluded: true,
      writes: 0, providerRequests: 0, sourceAndFinancialStateUnchanged: true, physicalActivationClaimed: false }));
  });
