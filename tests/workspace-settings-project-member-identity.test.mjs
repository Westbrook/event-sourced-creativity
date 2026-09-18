import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { registerHooks } from "node:module";

// Reuse only declarations from the current complete Settings host fixture.
// No old tests are imported/executed, no app/private method is replaced, and no
// extra member email is added. The service/native-event ports are finite, not
// browser, Worker authorization, physical layout or assistive-technology proof.
const fixtureUrl = new URL("./workspace-settings-response-ownership.test.mjs", import.meta.url);
const fixtureSource = fs.readFileSync(fixtureUrl, "utf8");
const fixtureTree = ts.createSourceFile(fixtureUrl.pathname, fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fixtureCode = fixtureTree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
  || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)).map(node => node.getFullText(fixtureTree)).join("\n")
  + "\nexport { settingsFixture, member, membersPath, endpoint };\n";
const virtual = new URL(fixtureUrl); virtual.search = "project-member-visible-identity-fixture";
const hook = registerHooks({ load(url, context, next) {
  return url === virtual.href ? { format: "module", source: fixtureCode, shortCircuit: true } : next(url, context);
} });
let shared;
try { shared = await import(virtual.href); } finally { hook.deregister(); }
const { settingsFixture, member, membersPath, endpoint } = shared;
const normalize = value => String(value).replace(/[\u2066-\u2069]/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();
const descendants = node => node.children.filter(child => typeof child !== "string").flatMap(child => [child, ...descendants(child)]);
const ancestor = (node, tag) => { for (let current = node.parent; current; current = current.parent) if (current.tag === tag) return current; return null; };
const method = request => (request.init.method ?? "GET").toUpperCase();

function currentMemberRows(f, ids) {
  const tree = f.tree(), switches = tree.visible("forma-ui-switch");
  assert.equal(switches.length, 4, "Both actual member rows mount Canvas and Review child controls");
  return ids.map(id => {
    const canvas = switches.filter(node => node.attributes["data-membership-id"] === id && node.attributes["data-permission"] === "canvasAccess");
    const review = switches.filter(node => node.attributes["data-membership-id"] === id && node.attributes["data-permission"] === "reviewAccess");
    assert.equal(canvas.length, 1); assert.equal(review.length, 1);
    const row = ancestor(canvas[0], "li"); assert.ok(row && row === ancestor(review[0], "li") && !row.hiddenBy);
    const own = descendants(row), role = own.filter(node => node.tag === "select"), revoke = own.filter(node => node.tag === "button");
    assert.equal(role.length, 1); assert.equal(revoke.length, 1);
    for (const node of [role[0], revoke[0]]) assert.equal(Object.hasOwn(node.attributes, "disabled"), false);
    const switchLabel = node => {
      assert.ok(node.component?.isConnected, "The real registered Switch child is mounted");
      const inputs = descendants(node).filter(child => child.tag === "input" && child.attributes.role === "switch");
      assert.equal(inputs.length, 1);
      assert.equal(Object.hasOwn(inputs[0].attributes, "disabled"), false);
      const label = ancestor(inputs[0], "label");
      assert.equal(label.attributes.for, inputs[0].attributes.id, "Actual associated native label, not an aria-only surrogate");
      return normalize(label.text);
    };
    return { id, row, revoke: revoke[0], snapshot: {
      id, fullRow: normalize(row.text), roleName: normalize(role[0].attributes["aria-label"]),
      canvasName: switchLabel(canvas[0]), reviewName: switchLabel(review[0]),
      revokeName: normalize(revoke[0].attributes["aria-label"]),
    } };
  });
}

for (const sameName of [false, true]) test(
  "Workspace project member choice uses current complete identity: " + (sameName ? "same-name pair" : "distinct-name healthy control"),
  async t => {
    const f = await settingsFixture(t, { section: "projects" }), service = f.service;
    const existing = structuredClone(service.projectMembers.A[0]), ids = [member("A"), member("A") + "-second"];
    const organizationMembers = service.reply({ url: endpoint("A"), init: {} }).body.members;
    const secondUser = organizationMembers.find(value => value.user_id !== existing.user_id);
    assert.ok(secondUser, "The second exact user is already present in this authorized finite organization detail");
    const records = [
      { ...existing, membership_id: ids[0], display_name: "Alex Rowan" },
      { ...existing, membership_id: ids[1], user_id: secondUser.user_id,
        display_name: sameName ? "Alex Rowan" : "Jamie Rowan" },
    ];
    // Exact current GET schema: IDs, authored display name, role, flags and date.
    // Do not import organization-member email into this project-member response.
    assert.ok(records.every(record => !Object.hasOwn(record, "email")));
    assert.notEqual(records[0].user_id, records[1].user_id);
    assert.equal(records[0].role, "editor"); assert.equal(records[1].role, "editor");
    assert.equal(records[0].canvas_access, records[1].canvas_access);
    assert.equal(records[0].review_access, records[1].review_access);
    service.projectMembers.A = records;
    const session = structuredClone(f.store.session.get()), route = f.store.route.get();
    const events = structuredClone(f.store.events.get()), before = service.requests.length;
    const readMembers = async () => {
      const view = f.find("button", node => node.text === f.i18n.t("workspace.admin.viewAccess", "View access"));
      f.click(view); await f.flush();
    };
    await readMembers();
    assert.deepEqual(service.requests.slice(before).map(request => [method(request), request.url]), [["GET", membersPath("A")]]);
    const first = currentMemberRows(f, ids).map(value => value.snapshot);
    assert.equal(new Set(first.map(value => value.id)).size, 2, "Correct exact identities exist despite a possible visual collision");

    // Ordinary current Revoke opens the real shared dialog. Cancel, not approval:
    // no destructive command is needed to assess which person the user can choose.
    for (const id of ids) {
      const target = currentMemberRows(f, ids).find(value => value.id === id);
      f.click(target.revoke);
      const dialog = f.dialog(); assert.ok(dialog);
      assert.ok(dialog.querySelector("h2").textContent.includes("Workspace A"));
      assert.ok(dialog.querySelector("p").textContent.includes(records.find(record => record.membership_id === id).display_name));
      assert.equal(service.writes.length, 0);
      f.cancel(); await f.flush(); assert.equal(f.dialog(), null); assert.equal(service.writes.length, 0);
    }

    service.projectMembers.A = [...records].reverse();
    await readMembers();
    const reordered = currentMemberRows(f, ids).map(value => value.snapshot);
    assert.deepEqual(reordered, first, "Identity context must stay with the same ID when service order changes");
    assert.deepEqual(service.requests.slice(before).map(request => [method(request), request.url]),
      [["GET", membersPath("A")], ["GET", membersPath("A")]]);
    assert.equal(service.writes.length, 0); assert.deepEqual(f.store.events.get(), events);
    assert.deepEqual(f.store.session.get(), session); assert.equal(f.store.route.get(), route); f.assertNoExternal();
    t.diagnostic(JSON.stringify({ sameName, rows: first, requests: service.requests.slice(before).map(request => request.url),
      writes: service.writes.length, noAddedEmail: records.every(record => !Object.hasOwn(record, "email")) }));
    assert.equal(new Set(first.map(value => value.fullRow)).size, 2,
      "Two different people need distinguishable complete visible member rows, not only opaque hidden IDs");
    for (const field of ["roleName", "canvasName", "reviewName", "revokeName"])
      assert.equal(new Set(first.map(value => value[field])).size, 2, "Current contextual control names distinguish the exact person: " + field);
  });


// Stronger current-render controls: normalization/composed aliases in all four
// real catalogs, unchanged authored text, current dialog identity and reordering.
function expandedMemberRows(f, ids) {
  const tree = f.tree();
  return ids.map(id => {
    const canvas = tree.visible("forma-ui-switch").filter(node => node.attributes["data-membership-id"] === id
      && node.attributes["data-permission"] === "canvasAccess");
    assert.equal(canvas.length, 1); assert.ok(canvas[0].component?.isConnected);
    const row = ancestor(canvas[0], "li"), own = descendants(row);
    const title = own.find(node => node.tag === "b"), role = own.find(node => node.tag === "select");
    const revoke = own.find(node => node.tag === "button");
    const labels = own.filter(node => node.tag === "label" && descendants(node).some(child => child.tag === "input" && child.attributes.role === "switch"));
    assert.ok(title && role && revoke && !row.hiddenBy); assert.equal(labels.length, 2);
    const rawName = title.children.filter(child => typeof child === "string").join("");
    return { id, row, revoke, rawName, snapshot: { id, rawName, fullRow: normalize(row.text),
      roleName: normalize(role.attributes["aria-label"]), canvasName: normalize(labels[0].text),
      reviewName: normalize(labels[1].text), revokeName: normalize(revoke.attributes["aria-label"]) } };
  });
}
async function readCurrentProjectMembers(f) {
  f.click(f.find("button", node => node.text === f.i18n.t("workspace.admin.viewAccess", "View access")));
  await f.flush();
}
async function confirmCurrentMemberTextThenCancel(f, row) {
  f.click(row.revoke); const dialog = f.dialog(); assert.ok(dialog);
  assert.equal(dialog.lang, f.locale); assert.equal(dialog.dir, f.locale === "ar" ? "rtl" : "ltr");
  assert.ok(normalize(dialog.querySelector("p").textContent).includes(normalize(row.rawName)),
    "The existing confirmation repeats the same complete visible current target");
  assert.equal(f.service.writes.length, 0); f.cancel(); await f.flush();
  assert.equal(f.dialog(), null); assert.equal(f.service.writes.length, 0);
}
const identityRows = f => {
  const first = structuredClone(f.service.projectMembers.A[0]);
  const next = f.service.reply({ url: endpoint("A"), init: {} }).body.members.find(value => value.user_id !== first.user_id);
  assert.ok(next);
  return [first, { ...first, membership_id: first.membership_id + "-second", user_id: next.user_id }];
};

for (const locale of ["en", "fr", "ar", "ja"]) test("Workspace member identities preserve raw text and close normalized/composed aliases " + locale, async t => {
  const f = await settingsFixture(t, { locale, section: "projects" }), service = f.service;
  const pair = identityRows(f), first = pair[0];
  pair[0].display_name = "Ame\u0301lie  نور";
  pair[1].display_name = "Am\u00e9lie نور";
  const qualifier = f.i18n.t("workspace.admin.memberQualifier", "Member {number}", { number: f.i18n.number(1) });
  // An additional legitimate finite current-GET row; no email or new transport.
  const records = [...pair, { ...first, membership_id: first.membership_id + "-third",
    user_id: "settings-third-project-member-A", display_name: normalize(pair[0].display_name) + " · " + qualifier }];
  const original = structuredClone(records), ids = records.map(record => record.membership_id);
  assert.ok(records.every(record => !Object.hasOwn(record, "email")));
  service.projectMembers.A = records; const requestStart = service.requests.length;
  const session = structuredClone(f.store.session.get()), events = structuredClone(f.store.events.get()), route = f.store.route.get();
  await readCurrentProjectMembers(f);
  const before = expandedMemberRows(f, ids);
  for (const row of before) assert.ok(row.rawName.startsWith(records.find(record => record.membership_id === row.id).display_name),
    "The authored raw spelling/whitespace is not rewritten by display-only qualification");
  for (const field of ["fullRow", "roleName", "canvasName", "reviewName", "revokeName"])
    assert.equal(new Set(before.map(row => row.snapshot[field])).size, records.length, "Final current labels remain distinct: " + field);
  for (const id of ids) await confirmCurrentMemberTextThenCancel(f, expandedMemberRows(f, ids).find(row => row.id === id));
  service.projectMembers.A = [...records].reverse(); await readCurrentProjectMembers(f);
  assert.deepEqual(expandedMemberRows(f, ids).map(row => row.snapshot), before.map(row => row.snapshot),
    "Qualification follows exact identity rather than the current response order");
  assert.deepEqual(records, original, "No authored name, ID, status or role was modified by the UI");

  service.projectMembers.A = records.map((record, index) => ({ ...record, display_name: "Distinct " + index + " مستند 日本語" }));
  await readCurrentProjectMembers(f);
  const unique = expandedMemberRows(f, ids);
  for (const row of unique) assert.equal(row.rawName, service.projectMembers.A.find(record => record.membership_id === row.id).display_name,
    "Unique human names remain exactly unchanged, with no unconditional opaque identifier");
  assert.deepEqual(service.requests.slice(requestStart).map(request => [method(request), request.url]),
    Array.from({ length: 3 }, () => ["GET", membersPath("A")]));
  assert.equal(service.writes.length, 0); assert.deepEqual(f.store.session.get(), session);
  assert.deepEqual(f.store.events.get(), events); assert.equal(f.store.route.get(), route); f.assertNoExternal();
});

test("Workspace qualified member approval still revokes only the exact originally selected membership", async t => {
  const f = await settingsFixture(t, { section: "projects" }), records = identityRows(f);
  for (const record of records) record.display_name = "Alex Rowan";
  f.service.projectMembers.A = records; await readCurrentProjectMembers(f);
  const ids = records.map(record => record.membership_id), selected = expandedMemberRows(f, ids)[0];
  const before = structuredClone(records[1]);
  f.click(selected.revoke); assert.ok(f.dialog());
  assert.ok(normalize(f.dialog().querySelector("p").textContent).includes(normalize(selected.rawName)));
  f.confirm(); await f.flush();
  assert.equal(f.service.writes.length, 1);
  assert.deepEqual(f.service.writes[0], { method: "DELETE", url: membersPath("A") + "/" + encodeURIComponent(ids[0]),
    body: null, receipt: { ok: true } });
  assert.equal(f.service.projectMembers.A.find(record => record.membership_id === ids[0]).status, "revoked");
  assert.deepEqual(f.service.projectMembers.A.find(record => record.membership_id === ids[1]), before,
    "The label never substitutes another person's target or broadens the command");
  assert.equal(f.dialog(), null); f.assertNoExternal();
});

test("Workspace pending member refresh retires an old qualified confirmation and leaves fresh current targets usable ar", async t => {
  const f = await settingsFixture(t, { locale: "ar", section: "projects" }), records = identityRows(f);
  for (const record of records) record.display_name = "Alex Rowan";
  f.service.projectMembers.A = records; await readCurrentProjectMembers(f);
  const ids = records.map(record => record.membership_id);
  // Begin a current background read before opening the dialog. Never activate
  // an inert background control while native modality is already present.
  f.service.projectMembers.A = records.map((record, index) => ({ ...record, display_name: "Current " + index + " نور" }));
  const gate = f.service.queue(request => method(request) === "GET" && request.url === membersPath("A"), "headers");
  f.click(f.find("button", node => node.text === f.i18n.t("workspace.admin.viewAccess", "View access")));
  await gate.seen.promise;
  f.click(expandedMemberRows(f, ids)[0].revoke); const oldDialog = f.dialog(); assert.ok(oldDialog);
  try {
    gate.release.resolve(); await f.flush();
    assert.equal(oldDialog.isConnected, false); assert.equal(f.dialog(), null);
    assert.equal(f.service.writes.length, 0);
    await confirmCurrentMemberTextThenCancel(f, expandedMemberRows(f, ids)[0]);
    assert.equal(f.service.writes.length, 0); f.assertNoExternal();
  } finally { gate.release.resolve(); }
});


// Collision-only human context must be recognizable when the current authorized
// organization detail already supplies it. Never fetch or add project-member
// email, and never borrow a different exact user's organization identity.
for (const locale of ["en", "fr", "ar", "ja"]) for (const context of ["present", "absent"])
  test("Workspace member collision reuses only current authorized human context " + locale + " " + context, async t => {
    const f = await settingsFixture(t, { locale, section: "projects" }), service = f.service;
    const records = identityRows(f);
    const organizationMembers = service.reply({ url: endpoint("A"), init: {} }).body.members;
    const emailFor = record => organizationMembers.find(candidate => candidate.user_id === record.user_id && candidate.status === "active")?.email;
    for (const record of records) record.display_name = "Alex Rowan نور";
    if (context === "absent") {
      // A current project membership need not occur in the bounded organization
      // member page. Only absence from that already-read context is simulated.
      records.forEach((record, index) => { record.user_id = "outside-current-organization-page-" + index; });
      assert.ok(records.every(record => emailFor(record) === undefined));
    } else {
      assert.ok(records.every(record => typeof emailFor(record) === "string"));
      assert.equal(new Set(records.map(emailFor)).size, 2);
    }
    assert.ok(records.every(record => !Object.hasOwn(record, "email")));
    service.projectMembers.A = records;
    const ids = records.map(record => record.membership_id), original = structuredClone(records);
    const session = structuredClone(f.store.session.get()), events = structuredClone(f.store.events.get()), route = f.store.route.get();
    const requestStart = service.requests.length;
    await readCurrentProjectMembers(f);
    const before = expandedMemberRows(f, ids);
    for (const row of before) {
      const record = records.find(value => value.membership_id === row.id);
      assert.ok(row.rawName.startsWith(record.display_name), "Preserve exact authored name before any qualifier");
      if (context === "present") {
        const email = emailFor(record);
        assert.equal(row.rawName, record.display_name + " · \u2068" + email + "\u2069",
          "Use recognizable authorized email, not an unnecessary opaque ordinal");
        assert.equal(descendants(row.row).find(node => node.tag === "b").attributes.dir, "auto");
        for (const field of ["fullRow", "roleName", "canvasName", "reviewName", "revokeName"])
          assert.ok(row.snapshot[field].includes(email), "The visible row and associated control keep the same exact person: " + field);
        const otherEmail = emailFor(records.find(value => value.membership_id !== row.id));
        assert.equal(row.snapshot.fullRow.includes(otherEmail), false, "Exact user_id join, never the neighboring member's email");
      } else {
        const qualifier = f.i18n.t("workspace.admin.memberQualifier", "Member {number}", { number: f.i18n.number(ids.indexOf(row.id) + 1) });
        assert.ok(row.rawName.includes(qualifier), "When human context is absent, retain the stable localized fallback");
        for (const member of organizationMembers) if (member.email)
          assert.equal(row.snapshot.fullRow.includes(member.email), false, "Do not guess or disclose an unrelated existing email");
      }
    }
    for (const field of ["fullRow", "roleName", "canvasName", "reviewName", "revokeName"])
      assert.equal(new Set(before.map(row => row.snapshot[field])).size, records.length, "Complete person context is distinct: " + field);
    for (const id of ids) await confirmCurrentMemberTextThenCancel(f, expandedMemberRows(f, ids).find(row => row.id === id));
    service.projectMembers.A = [...records].reverse(); await readCurrentProjectMembers(f);
    assert.deepEqual(expandedMemberRows(f, ids).map(row => row.snapshot), before.map(row => row.snapshot),
      "Authorized context and fallback rank stay with exact membership through response reordering");
    assert.deepEqual(records, original);

    service.projectMembers.A = records.map((record, index) => ({ ...record, display_name: "Distinct person " + index + " 日本語" }));
    await readCurrentProjectMembers(f);
    for (const row of expandedMemberRows(f, ids)) assert.equal(row.rawName,
      service.projectMembers.A.find(record => record.membership_id === row.id).display_name,
      "Unique names remain concise even when authorized email is available");
    assert.deepEqual(service.requests.slice(requestStart).map(request => [method(request), request.url]),
      Array.from({ length: 3 }, () => ["GET", membersPath("A")]));
    assert.equal(service.writes.length, 0); assert.deepEqual(f.store.session.get(), session);
    assert.deepEqual(f.store.events.get(), events); assert.equal(f.store.route.get(), route); f.assertNoExternal();
  });

for (const locale of ["en", "ar"]) test("Workspace member human-context aliases still close without changing authored identity " + locale, async t => {
  const f = await settingsFixture(t, { locale, section: "projects" }), service = f.service, pair = identityRows(f);
  const organizationMembers = service.reply({ url: endpoint("A"), init: {} }).body.members;
  const emails = pair.map(record => organizationMembers.find(candidate => candidate.user_id === record.user_id)?.email);
  assert.ok(emails.every(email => typeof email === "string")); assert.notEqual(emails[0], emails[1]);
  for (const record of pair) record.display_name = "Alex Rowan";
  const records = [...pair, { ...pair[0], membership_id: pair[0].membership_id + "-third",
    user_id: "outside-current-organization-page-alias", display_name: pair[0].display_name + " · " + emails[0] }];
  assert.ok(records.every(record => !Object.hasOwn(record, "email")));
  service.projectMembers.A = records; const original = structuredClone(records), ids = records.map(record => record.membership_id);
  const requestStart = service.requests.length;
  await readCurrentProjectMembers(f);
  const before = expandedMemberRows(f, ids);
  for (const row of before) assert.ok(row.rawName.startsWith(records.find(record => record.membership_id === row.id).display_name),
    "The saved raw name is not changed even when it aliases another member's composed human context");
  assert.ok(before[0].snapshot.fullRow.includes(emails[0]));
  assert.ok(before[1].snapshot.fullRow.includes(emails[1]));
  assert.notEqual(normalize(before[0].rawName), normalize(before[2].rawName),
    "Recheck after email enrichment; raw-name-only collision closure is insufficient");
  for (const field of ["fullRow", "roleName", "canvasName", "reviewName", "revokeName"])
    assert.equal(new Set(before.map(row => row.snapshot[field])).size, records.length, "Current complete names remain distinct: " + field);
  for (const id of ids) await confirmCurrentMemberTextThenCancel(f, expandedMemberRows(f, ids).find(row => row.id === id));
  service.projectMembers.A = [...records].reverse(); await readCurrentProjectMembers(f);
  assert.deepEqual(expandedMemberRows(f, ids).map(row => row.snapshot), before.map(row => row.snapshot));
  assert.deepEqual(records, original); assert.equal(service.writes.length, 0);
  assert.deepEqual(service.requests.slice(requestStart).map(request => [method(request), request.url]),
    [["GET", membersPath("A")], ["GET", membersPath("A")]]);
  f.assertNoExternal();
});
