import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

// Rendering-identity contract only. Reuse the existing complete Library class,
// real Lit directives/localization and finite native renderer. Catalog entries
// below are explicit synthetic inputs, not Worker reads or approval authority.
const fixtureUrl = new URL("./context-controls-host.test.mjs", import.meta.url);
const fixtureSource = fs.readFileSync(fixtureUrl, "utf8");
const parsed = ts.createSourceFile(fixtureUrl.pathname, fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstTest = parsed.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(parsed) === "test");
assert.ok(firstTest, "Reuse existing full-class fixture declarations without registering their cases twice");
const moduleUrl = new URL(fixtureUrl); moduleUrl.search = "?library-review-subject-identity";
const hook = registerHooks({ load(url, context, next) {
  if (url !== moduleUrl.href) return next(url, context);
  return { format: "module", shortCircuit: true, source: fixtureSource.slice(0, firstTest.getFullStart()) + `
export { FormaLibrary };
export function reviewRenderFixture(){
  const f=fixture("en"); f.host.disconnectedCallback();
  f.state.route="/library"; activeFixture=f;
  f.host=new FormaLibrary(); f.host.tag="forma-library"; f.host.connectedCallback();
  return f;
}
` };
} });
let helpers;
try { helpers = await import(moduleUrl.href); } finally { hook.deregister(); }

const org = "finite-review-org", access = "finite-review-access";
const stamp = "2026-08-30T12:00:00.000Z";
const packageRow = (id, name, overrides = {}) => ({
  id, name, description: "Explicit finite catalog subject", status: "active",
  versionId: null, version: null, versionStatus: null, createdByUserId: "different-author",
  pendingDraftVersionId: null, pendingDraftVersion: null, pendingDraftContentSha256: null,
  canApprove: false, draftPreview: [], contentSha256: null, publishedAt: null, publishedByUserId: null,
  blockCount: 0, bindingCount: 0, createdAt: stamp, updatedAt: stamp, ...overrides,
});
const pendingRow = (id, name, draft) => packageRow(id, name, {
  pendingDraftVersionId: draft, pendingDraftVersion: 1, pendingDraftContentSha256: "a".repeat(64),
  draftPreview: [{ handle: "direction/finite-review", type: "direction", text: "Finite review evidence.",
    locked: false, intent: "include", active: true, exactText: null, exactPlacements: [],
    protectedPhrases: [], relations: [], sourceName: null, rightsExpiresAt: null }],
});
const version = (id, number) => ({ id, version: number, sourceProjectAccessId: access,
  sourceDocumentId: "document-a", blocks: [], relations: [] });
const sameIdentity = (left, right) => left.path === right.path && left.strings === right.strings;

function renderFixture(t, { publisher = false } = {}) {
  t.mock.method(globalThis, "fetch", () => assert.fail("No transport is part of a render-identity contract"));
  const f = helpers.reviewRenderFixture(), originalSession = f.store.session.get();
  assert.ok(f.host instanceof helpers.FormaLibrary);
  // Reuse, never widen, the original finite fixture's author/read capabilities.
  // Default calls expose no publisher/reviewer grant. The explicit publisher
  // option is synthetic render input only, never backend eligibility evidence.
  f.store.session = { get: () => ({ ...originalSession,
    organizations: publisher ? [{ organizationId: org, role: "administrator" }] : [], projectContext: {
    organizationId: org, projectAccessId: access, projectId: "project-a", role: "editor",
    permissions: [...originalSession.capabilities],
  } }) };
  assert.deepEqual(f.store.session.get().projectContext.permissions, originalSession.capabilities);
  assert.equal(f.store.approveOrganizationContextPackage, undefined);
  assert.equal(f.store.acceptOrganizationContextPackageUpdate, undefined);
  assert.equal(f.store.createOrganizationContextPackage, undefined);
  assert.equal(f.store.publishOrganizationContextPackageVersion, undefined);
  const before = structuredClone(f.state.events), requests = [...f.state.requests];
  const renderer = f.renderer, originalValue = renderer.value;
  let observations = [], expectedEvents = before;
  renderer.value = function (part, owner, path, caches) {
    if (owner === f.host && part?.strings) {
      const opening = part.strings[0].trimStart();
      const kind = opening.startsWith('<article class="library-organization-context-card library-context-pending-review">') ? "pending"
        : opening.startsWith('<details class="library-context-version-review">') ? "update"
          : opening.startsWith('<article class="library-organization-context-card">') ? "published"
            : opening.startsWith('<details class="library-context-next-version">') ? "next-version-selection"
              : opening.startsWith('<form class="workspace-settings-form" @submit=')
                && part.values.some(value => typeof value === "function" && String(value).includes("createOrganizationContextPackage")) ? "create-selection"
                : opening.startsWith('<label><input type="checkbox" name="packageBlock" value=') ? "block-selection" : null;
      if (kind) observations.push({ kind, path, strings: part.strings, values: [...part.values] });
    }
    return Reflect.apply(originalValue, this, [part, owner, path, caches]);
  };
  t.after(() => {
    renderer.value = originalValue;
    for (const { instance } of renderer.instances.values()) if (instance.isConnected) {
      instance.isConnected = false; instance.disconnectedCallback();
    }
    f.host.isConnected = false; f.host.disconnectedCallback(); f.i18n.hostDisconnected();
    assert.deepEqual(f.state.events, expectedEvents, "Rendering never appends or approves an event beyond the explicit finite input");
    assert.deepEqual(f.state.requests, requests, "No finite response or success was supplied");
  });
  const draw = (packages, bindings = [], versions = {}, sourceEvents = null) => {
    if (sourceEvents !== null) {
      assert.ok(publisher && Array.isArray(sourceEvents), "Only the new opt-in render cases supply explicit source-event inputs");
      expectedEvents = structuredClone(sourceEvents); f.state.events = structuredClone(sourceEvents);
    }
    f.store.organizationContextPackages.set(packages);
    f.store.organizationContextBindings.set(bindings);
    f.store.organizationContextVersions.set(versions);
    observations = []; f.draw();
    const rows = [...observations];
    assert.ok(f.host.isConnected);
    assert.deepEqual(f.state.events, expectedEvents); assert.deepEqual(f.state.requests, requests);
    const forms = renderer.ownNodes(f.host, "form");
    assert.equal(forms.some(node => String(node.handlers.submit).includes("approveOrganizationContextPackage")), false,
      "The synthetic pending catalog never grants independent approval");
    return { rows, forms, markup: renderer.markup };
  };
  const row = (snapshot, kind, name) => {
    // Name associates a currently emitted record for observation only. It never
    // changes the renderer path, retains a port, or manufactures a Lit key.
    const matches = snapshot.rows.filter(value => value.kind === kind && (name === undefined || value.values.includes(name)));
    assert.equal(matches.length, 1, "One actual emitted " + kind + " template for the observed subject");
    return matches[0];
  };
  return { f, draw, row };
}

test("Library finite pending-review render identity follows package and immutable draft, not position or copy", t => {
  const x = renderFixture(t), a = pendingRow("package-A", "Pending A", "draft-A1"), b = pendingRow("package-B", "Pending B", "draft-B1");
  const first = x.draw([a, b]), a0 = x.row(first, "pending", a.name), b0 = x.row(first, "pending", b.name);
  assert.equal(first.rows.filter(row => row.kind === "pending").length, 2);
  assert.ok(first.markup.includes("Finite review evidence."));
  const unchanged = x.draw(structuredClone([a, b]));
  assert.ok(sameIdentity(a0, x.row(unchanged, "pending", a.name)), "Healthy same exact A subject keeps its emitted identity");
  assert.ok(sameIdentity(b0, x.row(unchanged, "pending", b.name)), "Healthy same exact B subject keeps its emitted identity");
  const renamed = { ...a, name: "Renamed A, same exact draft" }, rename = x.draw([renamed, b]);
  assert.ok(sameIdentity(a0, x.row(rename, "pending", renamed.name)), "Presentation copy is not a review identity key");
  const reordered = x.draw([b, renamed]);
  const aAfterOrder = x.row(reordered, "pending", renamed.name), bAfterOrder = x.row(reordered, "pending", b.name);
  const nextA = { ...renamed, pendingDraftVersionId: "draft-A2", pendingDraftVersion: 2, pendingDraftContentSha256: "b".repeat(64) };
  const replaced = x.draw([b, nextA]);
  const matrix = {
    reorderedAStaysA: sameIdentity(a0, aAfterOrder), reorderedBStaysB: sameIdentity(b0, bAfterOrder),
    newDraftRetiresPriorSubject: !sameIdentity(aAfterOrder, x.row(replaced, "pending", nextA.name)),
    untouchedBStaysB: sameIdentity(bAfterOrder, x.row(replaced, "pending", b.name)),
  };
  t.diagnostic("LIBRARY_PENDING_REVIEW_RENDER_IDENTITY " + JSON.stringify({ ...matrix,
    originalPath: a0.path, reorderedPath: aAfterOrder.path, newDraftPath: x.row(replaced, "pending", nextA.name).path,
    evidence: "actual full-class render and existing Lit directive paths; synthetic catalog, no checked-state or backend authority claim" }));
  assert.deepEqual(matrix, { reorderedAStaysA: true, reorderedBStaysB: true, newDraftRetiresPriorSubject: true, untouchedBStaysB: true },
    "A pending review belongs to the exact package/draft subject, including across reorder and replacement");
});

test("Library finite update-review render identity changes for binding or pending version inside one stable published package", t => {
  const x = renderFixture(t), applied = version("published-1", 1), pending2 = version("published-2", 2), pending3 = version("published-3", 3);
  const pkg = packageRow("package-A", "Published package A", { versionId: pending2.id, version: 2,
    versionStatus: "published", contentSha256: "2".repeat(64), publishedAt: stamp, publishedByUserId: "different-reviewer", bindingCount: 1 });
  const binding = { id: "binding-A", organizationId: org, projectAccessId: access, documentId: "document-a",
    packageId: pkg.id, versionId: applied.id, pendingVersionId: pending2.id, updateMode: "follow-approved", status: "active" };
  const versions = { [applied.id]: applied, [pending2.id]: pending2, [pending3.id]: pending3 };
  const first = x.draw([pkg], [binding], versions), outer = x.row(first, "published", pkg.name), review = x.row(first, "update");
  const updateForms = first.forms.filter(node => String(node.handlers.submit).includes("acceptOrganizationContextPackageUpdate"));
  assert.equal(updateForms.length, 1, "The actual existing update-review form is emitted but never submitted");
  assert.match(first.markup, /<input type="checkbox" required>/u);
  const unchanged = x.draw(structuredClone([pkg]), structuredClone([binding]), structuredClone(versions));
  assert.ok(sameIdentity(review, x.row(unchanged, "update")), "Healthy same binding/version keeps its emitted identity");
  assert.ok(sameIdentity(outer, x.row(unchanged, "published", pkg.name)), "Healthy published authoring row stays stable");
  const newPending = { ...binding, pendingVersionId: pending3.id }, updatedPackage = { ...pkg, versionId: pending3.id, version: 3 };
  const next = x.draw([updatedPackage], [newPending], versions), newReview = x.row(next, "update");
  assert.ok(sameIdentity(outer, x.row(next, "published", pkg.name)), "A new pending version does not retire the stable package authoring row");
  const newBinding = { ...newPending, id: "binding-B" }, rebound = x.draw([updatedPackage], [newBinding], versions);
  assert.ok(sameIdentity(outer, x.row(rebound, "published", pkg.name)), "A new binding does not replace the stable outer package row");
  const matrix = { newVersionRetiresReview: !sameIdentity(review, newReview),
    newBindingRetiresReview: !sameIdentity(newReview, x.row(rebound, "update")) };
  t.diagnostic("LIBRARY_BINDING_REVIEW_RENDER_IDENTITY " + JSON.stringify({ ...matrix,
    originalPath: review.path, newVersionPath: newReview.path, newBindingPath: x.row(rebound, "update").path,
    evidence: "actual full-class render and existing Lit directive paths; synthetic binding/version inputs, no checkbox or approval dispatch" }));
  assert.deepEqual(matrix, { newVersionRetiresReview: true, newBindingRetiresReview: true },
    "Only the exact binding/pending-version pair owns this update-review subtree");
});

// Explicit synthetic read inputs, folded by the ORIGINAL finite Store projection.
// These are not append calls, Worker responses, permissions, or receipt evidence.
function publisherSourceInputs(original, changes) {
  const events = structuredClone(original);
  for (const { type, payload } of changes) {
    const sequence = events.at(-1).sequence + 1;
    events.push({ ...events.at(-1), eventId: "publisher-render-input-" + sequence, sequence, type,
      payload: { project_id: "project-a", document_id: "document-a", ...payload } });
  }
  return events;
}

function publisherBlockRows(x, snapshot, kind, selected) {
  const parent = x.row(snapshot, kind), blocks = x.f.store.projection.get().blocks;
  const rows = snapshot.rows.filter(row => row.kind === "block-selection" && row.path.startsWith(parent.path + "/"));
  assert.equal(rows.length, blocks.length, "Every current projected decision has one actual emitted selection row in this form");
  assert.deepEqual(rows.map(row => row.values[0]), blocks.map(block => block.id), "Observed row order is the actual folded projection order");
  assert.equal(new Set(rows.map(row => row.values[0])).size, rows.length);
  for (const [index, row] of rows.entries()) {
    assert.equal(typeof row.values[1], "boolean", "Observe the actual ?checked expression, not a browser checked property");
    assert.equal(row.values[1], kind === "create-selection" ? index < 20 : selected.has(blocks[index].id),
      "Keep the existing create first-20 or next-version sourceIds.has default exactly");
    assert.equal(row.values[2], blocks[index].handle, "Each current row still presents its own exact authored handle");
  }
  if (kind === "create-selection") assert.equal(rows.filter(row => row.values[1]).length, Math.min(20, rows.length));
  return { parent, rows, byId: new Map(rows.map(row => [row.values[0], row])) };
}

for (const kind of ["next-version-selection", "create-selection"]) test(
  "Library finite publisher block identity / " + kind + " / same IDs, reorder, insertion and rename",
  t => {
    const x = renderFixture(t, { publisher: true });
    const extra = Array.from({ length: 7 }, (_, index) => ({ type: "BlockCreated", payload: {
      block_id: "publisher-extra-" + index, type: "direction", handle: "direction/publisher-extra-" + index,
      position: "p" + String(14 + index).padStart(3, "0"), properties: { text: "Finite additional direction " + index, authority: "authored", weight: 0.7 },
    } }));
    const initialEvents = publisherSourceInputs(x.f.state.events, extra);
    const selected = new Set(["decision-0", "publisher-extra-6"]);
    const latest = { ...version("published-block-selection", 1), blocks: [...selected].map(sourceBlockId => ({
      sourceBlockId, type: "direction", handle: "direction/" + sourceBlockId, contentSha256: "a".repeat(64), locked: false,
    })) };
    const pkg = packageRow("package-block-selection", "Published source decisions", { versionId: latest.id,
      version: 1, versionStatus: "published", contentSha256: "a".repeat(64), blockCount: selected.size,
      publishedAt: stamp, publishedByUserId: "different-reviewer" });
    const packages = kind === "next-version-selection" ? [pkg] : [], versions = { [latest.id]: latest };
    const render = events => publisherBlockRows(x, x.draw(packages, [], versions, events), kind, selected);
    const original = render(initialEvents), ids = original.rows.map(row => row.values[0]);
    assert.equal(ids.length, 21, "The create default is exercised on both sides of its unchanged 20-decision boundary");
    const unchanged = render(structuredClone(initialEvents));
    assert.ok(ids.every(id => sameIdentity(original.byId.get(id), unchanged.byId.get(id))), "Healthy identical ordered IDs retain every actual row identity");
    assert.ok(sameIdentity(original.parent, unchanged.parent), "The original form or disclosure remains the same subject");
    const movedId = ids.at(-1), move = { type: "BlockPropertyEdited", payload: {
      block_id: movedId, property_path: "position", old_value: "p020", new_value: "a000",
    } };
    const movedEvents = publisherSourceInputs(initialEvents, [move]), reordered = render(movedEvents);
    assert.deepEqual(reordered.rows.map(row => row.values[0]), [movedId, ...ids.slice(0, -1)], "Actual foldEvents consumes the same-scope position edit");
    const insertedId = "publisher-new-between", insertion = { type: "BlockCreated", payload: {
      block_id: insertedId, type: "direction", handle: "direction/new-between", position: "a001",
      properties: { text: "A newly read finite decision.", authority: "authored", weight: 0.7 },
    } };
    const insertedEvents = publisherSourceInputs(movedEvents, [insertion]), inserted = render(insertedEvents);
    assert.deepEqual(inserted.rows.map(row => row.values[0]), [movedId, insertedId, ...ids.slice(0, -1)]);
    const renamedId = ids[0], renamedHandle = "direction/renamed-only-同じ識別子";
    const renamedEvents = publisherSourceInputs(insertedEvents, [{ type: "BlockRenamed", payload: {
      block_id: renamedId, old_handle: "direction/decision-0", new_handle: renamedHandle,
    } }]), renamed = render(renamedEvents);
    assert.equal(renamed.byId.get(renamedId).values[2], renamedHandle);
    assert.ok([...inserted.byId.keys()].every(id => sameIdentity(inserted.byId.get(id), renamed.byId.get(id))),
      "A handle-only change neither replaces its decision row nor another row");
    for (const state of [reordered, inserted, renamed]) assert.ok(sameIdentity(original.parent, state.parent), "Decision input changes never replace the publisher form subject");
    const matrix = {
      reorderedOriginalRowsStayOwned: ids.every(id => sameIdentity(original.byId.get(id), reordered.byId.get(id))),
      insertedOriginalRowsStayOwned: ids.every(id => sameIdentity(reordered.byId.get(id), inserted.byId.get(id))),
      insertedRowHasNewIdentity: !reordered.rows.some(row => sameIdentity(row, inserted.byId.get(insertedId))),
    };
    t.diagnostic("LIBRARY_PUBLISHER_BLOCK_RENDER_IDENTITY " + JSON.stringify({ kind, ...matrix,
      originalPath: original.byId.get(renamedId).path, reorderedPath: reordered.byId.get(renamedId).path,
      insertedPath: inserted.byId.get(renamedId).path, originalRows: 21, insertedRows: 22,
      defaults: kind === "create-selection" ? "index < 20" : "sourceIds.has(block.id)",
      evidence: "actual full-class render, original foldEvents and Lit paths; synthetic role/catalog/source inputs, no native checked-state or backend command claim" }));
    assert.deepEqual(matrix, { reorderedOriginalRowsStayOwned: true, insertedOriginalRowsStayOwned: true, insertedRowHasNewIdentity: true },
      "Publisher selection rows belong to exact block IDs, not their current position or visible handle");
  },
);

// One emitted-name contract only. It neither dispatches/reset forms nor models
// browser accessibility navigation, native checked state or backend authority.
test("Library finite publisher Discard names retain exact scope through display collisions and reorder", t => {
  const x = renderFixture(t, { publisher: true }), renderer = x.f.renderer;
  const discard = x.f.i18n.t("output.requirement.discard"), projection = x.f.store.projection.get();
  const createScope = x.f.i18n.system("Publish decisions from the current document") + " · " + projection.documentTitle;
  const rows = [
    ["discard-contract-package-A", "Shared package direction", "First explicit finite source"],
    ["discard-contract-package-B", "Shared package direction", "Second explicit finite source"],
    ["discard-contract-package-C", createScope, "Explicit create-label collision"],
  ];
  const versions = Object.fromEntries(rows.map(([id]) => [id + "-version", version(id + "-version", 1)]));
  const packages = rows.map(([id, name, description]) => packageRow(id, name, {
    description, versionId: id + "-version", version: 1, versionStatus: "published",
    contentSha256: "a".repeat(64), publishedAt: stamp, publishedByUserId: "different-reviewer",
  }));
  const emitted = new Map(), originalValue = renderer.value;
  // Observe the identical returned subtree, after the existing renderer has
  // resolved actual Lit/localization bindings. No key/name is manufactured here.
  renderer.value = function (part, owner, path, caches) {
    const result = Reflect.apply(originalValue, this, [part, owner, path, caches]);
    if (owner === x.f.host && part?.strings) emitted.set(path, result);
    return result;
  };
  try {
    const observe = currentPackages => {
      emitted.clear(); const snapshot = x.draw(currentPackages, [], versions), names = new Map();
      const resetName = row => {
        const markup = emitted.get(row.path); assert.equal(typeof markup, "string");
        const resets = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)]
          .map(([, raw, text]) => ({ ...renderer.attrs(raw), text: text.trim() }))
          .filter(node => node.attributes.type === "reset");
        assert.equal(resets.length, 1, "One actual native reset is emitted inside this exact publishing subtree");
        const reset = resets[0];
        assert.equal(reset.text, discard, "The visible action remains the existing localized Discard changes label");
        assert.equal(reset.attributes["aria-labelledby"], undefined);
        assert.equal(reset.attributes.form, undefined, "The new name does not retarget native form ownership");
        assert.equal(reset.handlers.click, undefined, "No action is supplied or invoked by this naming contract");
        return String(reset.attributes["aria-label"] || reset.text);
      };
      for (const pkg of currentPackages) {
        // Unique synthetic descriptions locate observations only, never drive
        // rendering identity or provide the expected accessible name.
        const outer = x.row(snapshot, "published", pkg.description);
        const forms = snapshot.rows.filter(row => row.kind === "next-version-selection" && row.path.startsWith(outer.path + "/"));
        assert.equal(forms.length, 1); names.set(pkg.id, resetName(forms[0]));
      }
      names.set("create", resetName(x.row(snapshot, "create-selection")));
      const native = renderer.ownNodes(x.f.host, "button").filter(node => node.attributes.type === "reset");
      assert.equal(native.length, packages.length + 1);
      assert.deepEqual(native.map(node => String(node.attributes["aria-label"] || discard)).sort(), [...names.values()].sort(),
        "Scoped observations match the actual full-host emitted native reset attributes");
      return names;
    };
    const first = observe(packages), unchanged = observe(structuredClone(packages));
    const reordered = observe([packages[2], packages[1], packages[0]]);
    for (const [id, name] of first) {
      assert.equal(unchanged.get(id), name, "Identical current inputs keep the same emitted name");
      assert.equal(reordered.get(id), name, "Catalog order does not change an exact form's name");
    }
    t.diagnostic("LIBRARY_DISCARD_RENDER_NAMES " + JSON.stringify({ names: Object.fromEntries(first),
      evidence: "actual full-class/Lit/localization render; explicit synthetic publisher/catalog, no reset, network, AT or backend authority claim" }));
    assert.equal(new Set(first.values()).size, packages.length + 1,
      "Colliding package labels and a package matching the create label must still name distinct reset scopes");
    for (const pkg of packages) assert.ok(first.get(pkg.id).includes(pkg.name), "Each reset retains its own human package context");
    assert.ok(first.get("create").includes(createScope), "Creation remains explicitly scoped to the current Document publishing form");
    for (const name of first.values()) {
      assert.ok(name.startsWith(discard), "The visible label is retained at the start of the accessible name");
      assert.match(name, /\u2068[^\u2068\u2069]+\u2069$/u, "Human scope is bidi-isolated without a physical RTL claim");
      assert.ok(rows.every(([id]) => !name.includes(id)), "Ordinary collisions do not expose opaque fallback IDs");
    }
  } finally { renderer.value = originalValue; }
});


// One complete-card presentation contract. Both package names, descriptions,
// source metadata and native defaults intentionally coincide. Actual emitted
// package paths only associate observations; they are not visible identity.
test("Library finite published package cards visibly distinguish equal human context", t => {
  const x = renderFixture(t, { publisher: true }), renderer = x.f.renderer;
  const authored = "Shared package direction", discard = x.f.i18n.t("output.requirement.discard");
  const source = x.f.store.projection.get().blocks[0];
  assert.ok(source && source.id);
  const rows = ["visible-package-A", "visible-package-B"].map(id => packageRow(id, authored, {
    description: "", versionId: id + "-version", version: 1, versionStatus: "published",
    contentSha256: "a".repeat(64), publishedAt: stamp, publishedByUserId: "different-reviewer",
    blockCount: 1, bindingCount: 0,
  }));
  const versions = Object.fromEntries(rows.map(pkg => [pkg.versionId, {
    ...version(pkg.versionId, 1),
    blocks: [{ sourceBlockId: source.id, type: source.type, handle: source.handle,
      contentSha256: "a".repeat(64), locked: false }],
  }]));
  const emitted = new Map(), originalValue = renderer.value;
  renderer.value = function (part, owner, path, caches) {
    const result = Reflect.apply(originalValue, this, [part, owner, path, caches]);
    if (owner === x.f.host && part?.strings) emitted.set(path, result);
    return result;
  };
  // The current card has no hidden alternate name. Include ALL emitted body
  // copy, even text inside a closed details, as a generous context upper bound.
  // Attribute-only aria names/IDs are deliberately not visual text evidence.
  const bodyCopy = markup => markup.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
  const observe = packages => {
    emitted.clear(); const snapshot = x.draw(packages, [], versions);
    const cards = snapshot.rows.filter(row => row.kind === "published");
    assert.equal(cards.length, 2, "Both actual published package cards render");
    const observed = new Map();
    for (const [index, pkg] of packages.entries()) {
      const card = cards[index], markup = emitted.get(card.path);
      assert.ok(card.path.endsWith("/repeat:" + pkg.id),
        "Association uses the existing application's exact package-keyed render path");
      assert.equal(typeof markup, "string");
      assert.match(markup, /^<article class="library-organization-context-card">/u);
      const headings = [...markup.matchAll(/<h3\b([^>]*)>([\s\S]*?)<\/h3>/gu)];
      assert.equal(headings.length, 1);
      assert.equal(renderer.attrs(headings[0][1]).attributes.dir, "auto");
      const title = bodyCopy(headings[0][2]);
      const forms = snapshot.rows.filter(row => row.kind === "next-version-selection"
        && row.path.startsWith(card.path + "/"));
      assert.equal(forms.length, 1, "This visible card owns one current publisher form");
      const resets = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)]
        .map(([, attributes, text]) => ({ ...renderer.attrs(attributes), text: bodyCopy(text) }))
        .filter(node => node.attributes.type === "reset");
      assert.equal(resets.length, 1); assert.equal(resets[0].text, discard);
      assert.equal(resets[0].attributes.form, undefined);
      assert.equal(resets[0].handlers.click, undefined, "No substitute action handler");
      observed.set(pkg.id, { path: card.path, formPath: forms[0].path, title,
        allCopy: bodyCopy(markup), otherCopy: bodyCopy(markup.replace(headings[0][0], "")),
        resetName: String(resets[0].attributes["aria-label"] || resets[0].text) });
    }
    return observed;
  };
  try {
    const healthyRows = rows.map((pkg, index) => ({ ...pkg, name: "Distinct visible package " + (index + 1) }));
    const healthy = observe(healthyRows);
    assert.deepEqual([...healthy.values()].map(row => row.title), healthyRows.map(pkg => pkg.name),
      "Unique human names remain concise; unrelated cards are not globally numbered");
    assert.equal(new Set([...healthy.values()].map(row => row.allCopy)).size, 2);
    const first = observe(rows), unchanged = observe(structuredClone(rows));
    const reordered = observe([rows[1], rows[0]]);
    for (const pkg of rows) for (const current of [unchanged, reordered]) {
      assert.equal(current.get(pkg.id).path, first.get(pkg.id).path);
      assert.equal(current.get(pkg.id).formPath, first.get(pkg.id).formPath);
      assert.equal(current.get(pkg.id).title, first.get(pkg.id).title);
      assert.equal(current.get(pkg.id).allCopy, first.get(pkg.id).allCopy);
      assert.equal(current.get(pkg.id).resetName, first.get(pkg.id).resetName);
    }
    const observed = [...first.values()];
    assert.equal(new Set(observed.map(row => row.otherCopy)).size, 1,
      "Description, source decisions, version, binding count and complete other card copy provide no distinguishing context");
    assert.equal(new Set(observed.map(row => row.resetName)).size, 2,
      "The installed accessible-name repair is a healthy prerequisite, not visual evidence");
    assert.ok(observed.every(row => row.title.startsWith(authored)));
    t.diagnostic("LIBRARY_VISIBLE_PACKAGE_CONTEXT " + JSON.stringify({
      titles: observed.map(row => row.title), completeCardCopies: observed.map(row => row.allCopy),
      distinctTitles: new Set(observed.map(row => row.title)).size,
      distinctCompleteCopies: new Set(observed.map(row => row.allCopy)).size,
      distinctResetNames: new Set(observed.map(row => row.resetName)).size,
      exactApplicationPackageAndFormPathsRetained: true,
      evidence: "actual full-class/Lit/localization output; equal synthetic package metadata, no reset, approval, backend write, AT or physical geometry proof",
    }));
    assert.equal(new Set(observed.map(row => row.title)).size, 2,
      "Equal-context published packages need distinct visible headings, not only distinct aria labels");
    assert.equal(new Set(observed.map(row => row.allCopy)).size, 2);
    for (const row of observed) {
      assert.equal(row.resetName, x.f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", {
        action: discard, name: "\u2068" + row.title + "\u2069",
      }), "Visible title and accessible Discard scope reuse one current label");
      assert.ok(rows.every(pkg => !row.allCopy.includes(pkg.id)), "Ordinary collisions do not expose opaque IDs");
    }
  } finally { renderer.value = originalValue; }
});
