import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { outcomeDeskIntegrationCopy } from "../src/components/design-system/locales/outcome-desk-integration-messages.ts";

// Full current Shell/Canvas/Store and exact rendered controls. Saved artifacts
// are synthetic event seeds, not provider output or server-commit evidence.
// Browser/transport ports come unchanged from the existing navigation fixture.
const base = new URL("./outcome-desk-canvas-navigation.test.mjs", import.meta.url);
const original = fs.readFileSync(base, "utf8");
const tree = ts.createSourceFile(base.pathname, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstLoop = tree.statements.find(ts.isForOfStatement);
assert.ok(firstLoop);
const declarations = original.slice(0, firstLoop.getFullStart()) + "\nexport { canvasPage };\n";
const fixtureUrl = new URL(base); fixtureUrl.search = "?desk-visible-identity-repair-r2";
const loader = registerHooks({ load(url, context, next) {
  return url === fixtureUrl.href ? { format: "module", source: declarations, shortCircuit: true } : next(url, context);
} });
let canvasPage;
try { ({ canvasPage } = await import(fixtureUrl.href)); } finally { loader.deregister(); }

const hasClass = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const text = node => node.hiddenBy ? "" : node.children.map(child =>
  typeof child === "string" ? child : text(child)).join("").replace(/\s+/gu, " ").trim();
const key = node => new URL(node.attributes.href, "http://localhost").searchParams.get("outcome");
const locales = ["en", "fr", "ar", "ja"];
const titles = { en: "Same authored story", fr: "Même histoire rédigée", ar: "القصة المؤلَّفة نفسها", ja: "同じ執筆済みの物語" };
// Valid current UUID-shaped IDs share the entire prefix, not just eight chars.
const ids = ["01990298-0123-7000-8000-00000000000a", "01990298-0123-7000-8000-00000000000b"];
const thirdId = "01990298-0123-7000-8000-00000000000c";
const addSaved = (f, id, title) => {
  f.appendEvent("DocumentRenderCompleted", {
  project_id: f.store.projection.get().projectId, document_id: f.documentId,
  artifact_id: id, artifact_kind: "short_story", title, summary: "Retained synthetic saved artifact",
  provider: "synthetic-fixture", content_ref: "synthetic-content:" + id, item_count: 1,
  items: [{ id: id + "-part", title: "Part", body: "Retained body " + id, notes: "" }], settings: {},
  });
  f.appendEvent("OutputRenamed", { project_id: f.store.projection.get().projectId, document_id: f.documentId,
    output_id: id, output_kind: "artifact", artifact_id: id, old_title: title, new_title: title });
};
const inNavigation = node => {
  for (let owner = node.parent; owner; owner = owner.parent) if (hasClass(owner, "outcome-desk-objects")) return true;
  return false;
};
const linksFor = (f, wanted) => f.tree().visible("a").filter(node =>
  inNavigation(node) && node.attributes.href && wanted.some(id => key(node) === "artifact:" + id));
const capture = f => ({ events: JSON.stringify(f.store.events.get()), output: JSON.stringify(f.outputSnapshot()) });
const noWrites = (f, before) => {
  assert.equal(JSON.stringify(f.store.events.get()), before.events, "presentation/navigation cannot author or rename");
  assert.equal(JSON.stringify(f.outputSnapshot()), before.output, "canonical Output state stays unchanged");
  // Same exact recorded-read classifier as the shared canvasPage noCommands
  // oracle; synthetic bootstrap evidence, never a Worker or blanket POST exemption.
  assert.deepEqual(f.storeHost.requests.filter(row => (row.init.method ?? "GET") !== "GET" && !f.isReadOnlyResume(row)), [],
    "no command, provider, generation, matching, preflight or paid work");
};
async function selectedLabels(f, wanted, expected) {
  const contexts = new Map();
  for (const id of wanted) {
    const link = linksFor(f, [id])[0];
    assert.ok(link); assert.equal(link.port.isConnected, true);
    assert.ok(String(link.attributes["aria-label"]).includes(text(link)), "accessible name includes complete visible label");
    assert.equal(text(link), expected.get(id));
    assert.equal(link.children.filter(child => typeof child !== "string" && child.tag === "bdi").length, 1,
      "the complete visible label retains the native bidi-isolation wrapper");
    await f.act(link, "click", { button: 0 }); await f.finish();
    assert.equal(new URL(f.store.route.get(), "http://localhost").searchParams.get("outcome"), "artifact:" + id);
    const heading = f.tree().visible("h3").find(node => node.attributes.id === "canvas-outcome-desk-selected");
    assert.ok(heading); assert.equal(text(heading), expected.get(id), "selected context and exact navigation name agree");
    const section = f.tree().visible("section").find(node => hasClass(node, "outcome-desk-selected"));
    assert.ok(section); assert.equal(section.attributes["aria-labelledby"], heading.attributes.id);
    contexts.set(id, text(section));
    const selected = linksFor(f, [id])[0];
    assert.equal(selected.attributes["aria-current"], "true");
  }
  assert.equal(new Set(contexts.values()).size, wanted.length, "complete selected contexts remain distinguishable");
  return contexts;
}
function labelsFor(f, wanted) {
  const links = linksFor(f, wanted);
  assert.equal(links.length, wanted.length);
  assert.equal(new Set(links.map(link => link.attributes.href)).size, wanted.length);
  assert.equal(new Set(links.map(link => link.attributes["aria-label"])).size, wanted.length);
  return new Map(links.map(link => [key(link).slice("artifact:".length), text(link)]));
}

for (const locale of locales) {
  test("Desk visible identity / " + locale + " / same-title and full-prefix collision", async t => {
    const f = await canvasPage(t, { locale });
    for (const id of ids) addSaved(f, id, titles[locale]);
    await f.settle();
    const before = capture(f), displayed = labelsFor(f, ids);
    assert.equal(new Set(displayed.values()).size, ids.length, "duplicate titles need visible exact identity");
    for (const id of ids) {
      const link = linksFor(f, [id])[0];
      assert.equal(displayed.get(id), link.attributes["aria-label"], "reuse the full existing localized identity");
      assert.ok(displayed.get(id).includes(titles[locale]), "authored title is preserved verbatim");
      assert.ok(displayed.get(id).includes(id), "same-prefix IDs are not truncated");
      assert.equal(f.store.projection.get().libraryArtifacts.find(artifact => artifact.id === id).title, titles[locale]);
      assert.equal(f.store.projection.get().libraryArtifacts.find(artifact => artifact.id === id).titleSource, "authored");
    }
    const desk = f.tree().visible("section").find(node => hasClass(node, "outcome-desk"));
    assert.ok(desk); assert.equal(desk.attributes.dir, locale === "ar" ? "rtl" : "ltr");
    await selectedLabels(f, ids, displayed); noWrites(f, before);
    t.diagnostic(JSON.stringify({ locale, labels: Object.fromEntries(displayed), mutations: 0, providers: 0 }));
  });

  test("Desk visible identity / " + locale + " / distinct authored titles are unchanged", async t => {
    const f = await canvasPage(t, { locale });
    const names = new Map(ids.map((id, index) => [id, titles[locale] + " " + (index === 0 ? "A" : "B")]));
    for (const [id, title] of names) addSaved(f, id, title);
    await f.settle();
    const before = capture(f), displayed = labelsFor(f, ids);
    assert.deepEqual(Object.fromEntries(displayed), Object.fromEntries([...names].reverse()));
    for (const id of ids) assert.equal(displayed.get(id), names.get(id), "unique display is not needlessly qualified");
    await selectedLabels(f, ids, names); noWrites(f, before);
  });

  test("Desk visible identity / " + locale + " / composed identity cannot alias another authored title", async t => {
    const f = await canvasPage(t, { locale });
    for (const id of ids) addSaved(f, id, titles[locale]);
    await f.settle();
    const authoredAlias = linksFor(f, [ids[0]])[0].attributes["aria-label"];
    addSaved(f, thirdId, authoredAlias);
    await f.settle();
    const wanted = [...ids, thirdId], before = capture(f), displayed = labelsFor(f, wanted);
    assert.equal(new Set(displayed.values()).size, wanted.length, "recheck fully composed visible labels");
    assert.equal(f.store.projection.get().libraryArtifacts.find(artifact => artifact.id === thirdId).title, authoredAlias);
    assert.notEqual(displayed.get(thirdId), authoredAlias, "the new collision gets the existing exact identity too");
    for (const id of wanted) assert.equal(displayed.get(id), linksFor(f, [id])[0].attributes["aria-label"]);
    await selectedLabels(f, wanted, displayed); noWrites(f, before);
  });

  test("Desk visible identity / " + locale + " / reordered current rows keep the same exact labels", async t => {
    const observations = [];
    for (const order of [ids, [...ids].reverse()]) await t.test("synthetic event order " + order[0], async child => {
      const f = await canvasPage(child, { locale });
      for (const id of order) addSaved(f, id, titles[locale]);
      await f.settle();
      const before = capture(f), displayed = labelsFor(f, ids), actualOrder = [...displayed.keys()];
      assert.deepEqual(actualOrder, [...order].reverse(), "actual projection presents reverse creation order");
      assert.equal(new Set(displayed.values()).size, ids.length);
      const contexts = await selectedLabels(f, ids, displayed);
      observations.push({ order: actualOrder, labels: ids.map(id => displayed.get(id)), contexts: ids.map(id => contexts.get(id)) });
      noWrites(f, before);
    });
    assert.notDeepEqual(observations[0].order, observations[1].order);
    assert.deepEqual(observations[0].labels, observations[1].labels, "identity never depends on list position");
    assert.deepEqual(observations[0].contexts, observations[1].contexts, "selected identity stays stable across reorder");
  });
}

for (const locale of locales) for (const duplicate of [true, false]) test("Desk visible identity / " + locale + " / legacy DTO composed-name alias / " + (duplicate ? "with title collision" : "distinct raw titles"), async t => {
  const f = await canvasPage(t, { locale }), kind = outcomeDeskIntegrationCopy(locale).artifact;
  // Opaque IDs are retained DTO/presentation input. This is not an assertion
  // that provider execution or current job admission produced these records.
  const legacy = ["legacy-a", kind + " · legacy-a · legacy-tail", "legacy-tail"];
  const names = [kind, kind, kind + " · " + kind + " · legacy-a"];
  const wanted = duplicate ? legacy : legacy.slice(1);
  for (const id of wanted) addSaved(f, id, names[legacy.indexOf(id)]);
  await f.settle();
  const before = capture(f), rows = linksFor(f, wanted);
  assert.equal(rows.length, wanted.length);
  const common = kind + " · " + kind + " · " + kind + " · legacy-a · legacy-tail";
  assert.equal(kind + " · " + names[1] + " · " + legacy[1], common);
  assert.equal(kind + " · " + names[2] + " · " + legacy[2], common);
  t.diagnostic(JSON.stringify({ locale, dtoIds: legacy, authoredTitles: names,
    originalAliasedName: common, visible: rows.map(text), accessible: rows.map(row => row.attributes["aria-label"]) }));
  const displayed = labelsFor(f, wanted);
  assert.equal(new Set(displayed.values()).size, wanted.length, "even two composed identities must be visibly distinguishable");
  for (const id of legacy.slice(1)) {
    const link = linksFor(f, [id])[0];
    assert.equal(text(link), common + " · " + encodeURIComponent("artifact:" + id));
    assert.equal(link.attributes["aria-label"], text(link), "fallback is also part of the complete accessible name");
    assert.ok(text(link).startsWith(common), "retain the complete original identity as a prefix");
  }
  if (duplicate) assert.equal(displayed.get(legacy[0]), kind + " · " + kind + " · " + legacy[0], "no fallback on the non-alias");
  await selectedLabels(f, wanted, displayed); noWrites(f, before);
});

for (const locale of locales) for (const duplicate of [true, false]) {
  test("Desk visible identity / " + locale + " / " + (duplicate ? "repeated-space collision" : "distinct-title whitespace control"), async t => {
    const f = await canvasPage(t, { locale });
    const words = { en: ["Same", "story"], fr: ["Même", "histoire"], ar: ["القصة", "نفسها"], ja: ["同じ", "物語"] }[locale];
    const authored = [words.join(" ") + (duplicate ? "" : " A"), words.join("  ") + (duplicate ? "" : " B")];
    for (const [index, id] of ids.entries()) addSaved(f, id, authored[index]);
    await f.settle();
    const before = capture(f), displayed = labelsFor(f, ids), contexts = [];
    const collapse = value => String(value).replace(/\s+/gu, " ").trim();
    assert.equal(new Set(displayed.values()).size, ids.length, "HTML-collapsed titles still require distinct visible identity");
    for (const [index, id] of ids.entries()) {
      const artifact = f.store.projection.get().libraryArtifacts.find(value => value.id === id);
      assert.ok(artifact); assert.equal(artifact.title, authored[index], "raw authored whitespace stays byte-exact");
      assert.equal(artifact.titleSource, "authored");
      const link = linksFor(f, [id])[0]; assert.equal(link.port.isConnected, true);
      assert.ok(link.attributes["aria-label"].includes(authored[index]), "the existing name retains the raw authored title");
      assert.ok(collapse(link.attributes["aria-label"]).includes(text(link)), "computed accessible name includes the complete visible label");
      assert.equal(text(link), duplicate ? collapse(link.attributes["aria-label"]) : collapse(authored[index]));
      if (duplicate) assert.ok(text(link).includes(id), "qualification uses the same exact existing ID");
      await f.act(link, "click", { button: 0 }); await f.finish();
      assert.equal(new URL(f.store.route.get(), "http://localhost").searchParams.get("outcome"), "artifact:" + id);
      const heading = f.tree().visible("h3").find(node => node.attributes.id === "canvas-outcome-desk-selected");
      assert.ok(heading); assert.equal(text(heading), displayed.get(id));
      const section = f.tree().visible("section").find(node => hasClass(node, "outcome-desk-selected"));
      assert.ok(section); assert.equal(section.attributes["aria-labelledby"], heading.attributes.id);
      contexts.push(text(section));
    }
    assert.equal(new Set(contexts).size, ids.length);
    noWrites(f, before);
  });
}
