// Current actual-host/Worker choice fixture. E adds only explicit exact-ID
// current Edit entry before inspecting a disclosed selector; all prior choice,
// authority, raw-name and command assertions remain unchanged.
import assert from "node:assert/strict";
import { money, receipts, updates, enterCurrentDeliveryEditor } from "./product-delivery-update-draft-fixture.mjs";
import { calmFullPageNativePorts as ports, fullPageTree } from "./calm-full-page-fixture.mjs";

const normalize = value => String(value).replace(/[\u2066-\u2069]/gu, "").normalize("NFC").replace(/\s+/gu, " ").trim();
const descendants = node => node.children.filter(child => typeof child !== "string").flatMap(child => [child, ...descendants(child)]);
const ancestor = (node, tag) => { for (let item = node.parent; item; item = item.parent) if (item.tag === tag) return item; return null; };
const sqlRows = (f, sql) => f.storeHost.worker.sqlite.prepare(sql).all();
function snapshot(f) {
  return structuredClone({ route: f.store.route.get(), session: f.store.session.get(),
    platformSession: f.platformSession.get(), authorization: f.store.captureAuthorizationScope(),
    source: { events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() },
    users: sqlRows(f, "SELECT * FROM users ORDER BY user_id"),
    grants: sqlRows(f, "SELECT * FROM capability_grants ORDER BY grant_id"),
    decisions: f.decisions(), creates: f.creationEvents(), updates: updates(f), receipts: receipts(f), money: money(f) });
}
function setLocale(f, locale) {
  f.i18n.hostDisconnected(); f.locale = locale;
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC",
      messages: { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[locale] }, revision: 1 }, () => {});
    return true;
  } });
  f.i18n.hostConnected(); f.host.i18n = f.i18n;
}
function seedExistingFixtureHistory(f, locale, colliding) {
  const db = f.storeHost.worker.sqlite, owner = db.prepare("SELECT * FROM users WHERE user_id=?").get(f.storeHost.worker.owner);
  assert.ok(owner); assert.equal(owner.role, "admin");
  const rawName = "Alex Rowan نور 日本語";
  const qualifierShaped = rawName + " · " + f.i18n.t("delivery.owner", "Owner") + " " + f.i18n.number(1);
  const people = [
    { userId: "owner-choice-a-" + locale, name: rawName, email: "owner-a@example.invalid" },
    { userId: "owner-choice-b-" + locale, name: colliding ? rawName : "Jamie Rowan نور 日本語", email: "owner-b@example.invalid" },
    { userId: "owner-choice-c-" + locale, name: qualifierShaped, email: "owner-c@example.invalid" },
  ];
  const insert = db.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'admin',?,?,?,?)");
  for (const person of people) insert.run(person.userId, person.email, person.name, owner.consent_version,
    owner.consented_at, owner.created_at, owner.updated_at);
  const decisionId = "owner-choice-existing-" + locale, title = "Existing Delivery decision · نور 日本語";
  db.prepare("INSERT INTO delivery_decisions(decision_id,title,audience,status,owner_user_id,owner_display_name,evidence,dependency_ids_json,created_by_user_id,created_at,updated_at) VALUES(?,?,'product','planned',?,?,?,'[]',?,?,?)")
    .run(decisionId, title, owner.user_id, owner.display_name, "Already saved fixture evidence", owner.user_id, owner.created_at, owner.updated_at);
  // No application authoring/grant operation is used to construct this fixture.
  return { people, decisionId, title, qualifierShaped, currentOwner: owner.user_id };
}
function enterOwnerChoiceEditor(f, seeded) {
  const rows = f.updateRows().filter(record => record.form.getAttribute("data-delivery-decision-id") === seeded.decisionId);
  assert.equal(rows.length, 1, "One current exact decision for the explicit E Edit entry.");
  enterCurrentDeliveryEditor(f, rows[0]);
}
function choices(f, seeded, authoritativeOwners) {
  enterOwnerChoiceEditor(f, seeded);
  const markup = f.draw(), tree = fullPageTree(f, markup);
  const selects = tree.visible("select").filter(node => node.attributes.name === "ownerUserId");
  assert.equal(selects.length, 2, "The actual create and exact existing-update owner selectors are both present.");
  const surfaces = selects.map(select => {
    const form = ancestor(select, "form"), label = ancestor(select, "label"); assert.ok(form && label);
    assert.ok(select.port?.isConnected && f.host.contains(select.port));
    assert.equal(Object.hasOwn(select.attributes, "disabled"), false);
    assert.equal(select.hiddenBy, null);
    for (let item = select; item; item = item.parent) assert.equal(Object.hasOwn(item.attributes, "inert"), false);
    const kind = form.attributes["data-delivery-decision-id"] ? "update" : "create";
    assert.ok(form.handlers.submit?.toString().includes(kind === "update" ? "#update" : "#create"));
    if (kind === "update") assert.equal(form.attributes["data-delivery-decision-id"], seeded.decisionId);
    const optionNodes = descendants(select).filter(node => node.tag === "option");
    const actual = optionNodes.filter(node => node.attributes.value).map(node => ({ userId: node.attributes.value,
      text: node.text, visibleText: normalize(node.text), disabled: Object.hasOwn(node.attributes, "disabled"),
      ariaLabel: node.attributes["aria-label"] ?? null, title: node.attributes.title ?? null }));
    assert.deepEqual(actual.map(item => item.userId).sort(), authoritativeOwners.map(item => item.userId).sort(),
      "Exact option values are the actual authorized Worker owner IDs; text is inspected separately.");
    assert.equal(new Set(actual.map(item => item.userId)).size, authoritativeOwners.length);
    for (const person of authoritativeOwners) {
      const option = actual.find(item => item.userId === person.userId); assert.ok(option);
      assert.ok(option.text.includes(person.displayName), "The raw authorized display name remains inspectable.");
      assert.equal(option.disabled, false);
    }
    const submitters = descendants(form).filter(node => node.tag === "button" && node.attributes.type === "submit");
    assert.equal(submitters.length, 1); assert.equal(Object.hasOwn(submitters[0].attributes, "disabled"), false);
    assert.ok(label.text.startsWith(f.i18n.t("delivery.owner", "Owner")));
    const article = ancestor(select, "article");
    if (kind === "update") {
      assert.ok(article && descendants(article).some(node => node.tag === "h2" && node.text === seeded.title));
      assert.equal(select.properties.value, seeded.currentOwner, "Existing current exact owner binding is unchanged.");
    } else {
      assert.equal(optionNodes.filter(node => node.attributes.value === "").length, 1);
      assert.equal(optionNodes.find(node => node.attributes.value === "").text, f.i18n.t("delivery.owner.me", "Assign to me"));
    }
    // Only the explicit current Edit action precedes inspection. No owner
    // selection or submit is synthesized; this is not a physical OS picker.
    return { kind, decisionId: form.attributes["data-delivery-decision-id"] ?? null,
      associatedLabel: normalize(label.text), formContext: normalize(form.text),
      surroundingContext: normalize(article?.text ?? form.text), completePageContext: normalize(tree.root.text),
      submitterText: submitters[0].text, choices: actual };
  });
  assert.deepEqual(surfaces.map(item => item.kind).sort(), ["create", "update"]);
  return surfaces;
}

export { snapshot, setLocale, seedExistingFixtureHistory, enterOwnerChoiceEditor, choices, normalize, descendants, ancestor };
