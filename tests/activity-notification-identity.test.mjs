import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { artifactFocusOptionsFromRoute, artifactFocusRoute, libraryFocusFromRoute } from "../src/model/routes.ts";
import { artifactDeliveryFor } from "../src/state/artifact-delivery-context.ts";

// Complete current Activity + IssuePanel + real LocaleController/catalogs/models.
// Reuse existing history and template/native-control ports. This standalone
// owner has no Shell: names, model arguments and source/rendered-handler bindings
// do not observe closed-over arguments or completed navigation. Four actual-Shell
// artifact destinations live in activity-delivery-exact-destinations.test.mjs.
// No production callee is replaced. Envelopes match Worker literals, not an
// actual insert, browser or AT test.
const fixtureUrl = new URL("./delivery-identity-copy.test.mjs", import.meta.url);
const original = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstLoop = tree.statements.find(ts.isForOfStatement);
assert.ok(firstLoop);
const fixtureSource = original.slice(0, firstLoop.getFullStart())
  + "\nexport {mount,artifactActions,ancestor,normalize,loadActual};";
const virtual = new URL(fixtureUrl); virtual.search = "?activity-notification-identity-fixture";
const hook = registerHooks({ load(url, context, next) {
  return url === virtual.href ? { format: "module", source: fixtureSource, shortCircuit: true } : next(url, context);
} });
let fixtureModule;
try { fixtureModule = await import(virtual.href); } finally { hook.deregister(); }
const { mount, artifactActions, ancestor, normalize, loadActual } = fixtureModule;
const { FormaActivityIssuePanel } = await loadActual("src/components/forma-activity-issue-panel.ts");
const title = "Shared output مخرج 同じ成果";
const documentTitle = "Shared document مستند 同じ文書";
const occurredAt = "2026-08-28T17:00:00.000Z";

function fixture(t, locale) {
  const f = mount(t, locale, "activity");
  f.renderer.registry["forma-activity-issue-panel"] = FormaActivityIssuePanel;
  f.marked = [];
  // Existing external Store port records the exact requested ID; no server ACK,
  // read-state mutation, private fetch, or authority is manufactured here.
  f.store.acknowledgeProjectNotification = id => { f.marked.push(id); };
  return f;
}
function notify(f, artifacts, stage = "review", read = false) {
  f.store.projectNotifications.set(artifacts.map(artifact => ({
    id: "notice:" + artifact.id, kind: stage === "review" ? "output_ready" : "output_approved",
    artifactId: artifact.id, documentId: artifact.documentId,
    message: stage === "review" ? "A new finished output is ready for the project." : "A finished output was independently approved.",
    createdAt: occurredAt, readAt: read ? occurredAt : null,
  })));
}
function rows(f, nodes = f.draw()) {
  return nodes.filter(node => node.tag === "forma-activity-issue-panel" && node.properties.notification).map(panel => {
    const card = ancestor(panel, "article"), buttons = nodes.filter(node => node.tag === "button" && ancestor(node, "article") === card);
    const action = buttons.find(node => node.attributes.class === "button secondary");
    assert.ok(action, "The existing original-artifact action remains reachable");
    return { notification: panel.properties.notification, card, action,
      mark: buttons.find(node => node.attributes.class === "button ghost"), nodes };
  });
}
function assertNamed(f, current) {
  assert.equal(new Set(current.map(row => normalize(row.action.name()))).size, current.length, "exact-target action names are distinct");
  assert.equal(new Set(current.map(row => normalize(row.card.name()))).size, current.length, "whole notification cards have distinct programmatic identities");
  assert.equal(new Set(current.map(row => normalize(row.card.visibleLabel()))).size, current.length, "the visible cards, not only ARIA, distinguish the outputs");
  for (const { action, card, mark } of current) {
    assert.equal(action.attributes.type, "button");
    assert.equal(action.disabled(), false);
    assert.ok(normalize(action.name()).startsWith(normalize(action.visibleLabel())), "retain the complete visible action phrase");
    assert.match(action.name(), /\u2068[^\u2069]+\u2069/u, "authored identity is bidi-isolated");
    assert.equal(action.name(), f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", {
      action: action.visibleLabel(), name: card.attributes["aria-label"],
    }));
    const metadata = current[0].nodes.find(node => node.tag === "p" && ancestor(node, "article") === card);
    assert.ok(metadata);
    assert.equal(metadata.attributes.dir, "auto");
    assert.ok(normalize(metadata.visibleLabel()).includes(normalize(card.name())), "visible metadata contains the same exact output context");
    assert.ok(metadata.visibleLabel().includes(new Date(occurredAt).toLocaleString(f.i18n.locale)), "keep the original notification time");
    if (mark) {
      assert.equal(mark.attributes.type, "button");
      assert.equal(mark.visibleLabel(), f.i18n.t("activity.markRead", "Mark as read"));
      assert.equal(mark.name(), f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", {
        action: mark.visibleLabel(), name: card.attributes["aria-label"],
      }));
    }
  }
}
function assertPanels(f, expected) {
  const panels = [...f.renderer.instances.values()].map(row => row.instance).filter(instance => instance instanceof FormaActivityIssuePanel);
  assert.equal(panels.length, expected.length, "the actual current IssuePanel child is mounted for each notification");
  assert.deepEqual(new Set(panels.map(panel => panel.notification.id)), new Set(expected.map(row => row.notification.id)));
  for (const panel of panels) assert.equal(panel.markup, "", "these actual Worker notification kinds have no hidden omitted identity");
}
function assertArtifactBinding(f, row, expectedAction) {
  const artifact = f.store.projection.get().libraryArtifacts.find(candidate => candidate.id === row.notification.artifactId);
  assert.ok(artifact);
  const delivery = artifactDeliveryFor(f.store, artifact);
  if (expectedAction) assert.equal(delivery.action, expectedAction);
  assert.equal(row.action.visibleLabel(), f.i18n.t("artifact.delivery.action." + delivery.action));
  // Model arguments plus exact source/rendered-handler binding, not an observed closure or dispatched route.
  const expected = artifactFocusRoute(artifact.id, artifact.title, {
    expectedRevision: delivery.revision, ...(delivery.contentSha256 ? { expectedContentSha256: delivery.contentSha256 } : {}), intent: delivery.intent,
  });
  const source = fs.readFileSync(new URL("../src/components/forma-activity.ts", import.meta.url), "utf8");
  const start = source.indexOf("  #notification(notification:"), end = source.indexOf("  #planningRecovery(", start);
  assert.ok(start >= 0 && end > start, "inspect the actual notification-owned renderer");
  const notificationSource = source.slice(start, end);
  assert.match(source, /import \{ navigateInApp, type CommandDeparture \} from "\.\/command-departure";/);
  assert.ok(notificationSource.includes('const artifact = notification.artifactId ? projection.libraryArtifacts.find((entry) => entry.id === notification.artifactId) : undefined;'));
  assert.ok(notificationSource.includes('const delivery=artifact?artifactDeliveryFor(this.store,artifact):null;'));
  assert.equal(notificationSource.split('.notification=${notification}').length, 2, "the actual inline child binds the same notification");
  assert.equal(notificationSource.split('const artifactHref=artifact&&delivery?artifactFocusRoute(artifact.id,artifact.title,{expectedRevision:delivery.revision,...(delivery.contentSha256?{expectedContentSha256:delivery.contentSha256}:{}),intent:delivery.intent}):"";').length, 2,
    "one exact current artifact/title/revision/hash/intent construction");
  assert.equal(notificationSource.split('@click=${() => this.#open(artifactHref)}').length, 2, "the current action binds that exact route");
  assert.equal(row.action.handlers.click.toString().replace(/\s+/gu, ""), "()=>this.#open(artifactHref)", "actual emitted handler, not a substituted navigator");
  assert.ok(source.includes('  #open(path:string){\n    if(path===this.store.route.get())return true;\n    return navigateInApp(this,navigation=>navigation.route(path));\n  }'));
  assert.ok(f.store.projectNotifications.get().includes(row.notification), "the rendered child exposes this current notification, not a test-authored route inventory");
  assert.equal(f.host.closest("forma-shell"), null, "this presentation owner has no actual Shell admission");
  row.action.handlers.click.call(f.host, { currentTarget: row.action, target: row.action });
  assert.deepEqual(f.routes, [], "the real guarded handler cannot dispatch through a missing Shell; exact arrival is a separate complete-host gate");
  const target = libraryFocusFromRoute(expected), options = artifactFocusOptionsFromRoute(expected);
  assert.equal(target.kind, "artifact"); assert.equal(target.id, artifact.id);
  assert.equal(options.expectedRevision, delivery.revision); assert.equal(options.intent, delivery.intent);
  assert.equal(options.expectedContentSha256, delivery.contentSha256 ?? null);
  return options;
}
function authored(f) {
  return structuredClone({ events: f.state.events, content: f.store.content.get(), notifications: f.store.projectNotifications.get() });
}
function noCommands(f) { assert.deepEqual(f.state.requests, []); assert.deepEqual(f.state.loads, []); assert.deepEqual(f.routes, [], "the standalone naming owner does not claim Shell navigation"); }
function identities(current) { return new Map(current.map(row => [row.notification.artifactId, normalize(row.action.name())])); }

test("Activity notification fixture uses the current Worker output notification envelopes", () => {
  const worker = fs.readFileSync(new URL("../worker/runtime.ts", import.meta.url), "utf8");
  for (const phrase of [
    "WHEN 'DocumentRenderCompleted' THEN 'output_ready'",
    "WHEN 'ArtifactApproved' THEN 'output_approved'",
    "WHEN 'DocumentRenderCompleted' THEN 'A new finished output is ready for the project.'",
    "WHEN 'ArtifactApproved' THEN 'A finished output was independently approved.'",
  ]) assert.ok(worker.includes(phrase), phrase);
});

for (const locale of ["en", "fr", "ar", "ja"]) {
  for (const stage of ["review", "export"]) for (const read of [false, true]) {
    test("Activity notification exact names: " + locale + "/" + stage + "/" + (read ? "read" : "unread"), t => {
      const f = fixture(t, locale); f.addDocument("B", documentTitle);
      for (const doc of ["A", "B"]) f.addArtifact("notification:" + doc, doc, "short_story", title, stage);
      notify(f, f.store.projection.get().libraryArtifacts, stage, read);
      const before = authored(f), nodes = f.draw(), current = rows(f, nodes);
      assert.equal(current.length, 2); assertNamed(f, current); assertPanels(f, current);
      const ready = artifactActions(f, nodes);
      assert.equal(ready.length, 2); assert.equal(new Set(ready.map(node => normalize(node.name()))).size, 2);
      for (const row of current) {
        assert.equal(normalize(row.action.name()), normalize(ready.find(node => libraryFocusFromRoute(node.attributes.href).id === row.notification.artifactId).name()));
        assert.ok(row.card.visibleLabel().includes(title)); assert.ok(row.card.visibleLabel().includes(documentTitle));
        assert.equal(Boolean(row.mark), !read);
        assert.equal(row.card.attributes.class.includes("forma-activity-card--unread"), !read);
        assertArtifactBinding(f, row, stage);
        if (!read) {
          row.mark.handlers.click.call(f.host, { currentTarget: row.mark, target: row.mark });
          assert.equal(f.marked.at(-1), row.notification.id, "Mark as read keeps the exact notification ID");
        }
      }
      assert.equal(new Set(current.map(row => row.notification.artifactId)).size, 2, "the actual rendered notification inventory spans both artifacts"); assert.equal(f.marked.length, read ? 0 : 2);
      assert.deepEqual(authored(f), before, "naming and bound destinations never rewrite authored or notification data");
      noCommands(f);
    });
  }

  for (const stage of ["review", "export"]) {
    test("Activity notification outside six Ready cards: " + locale + "/" + stage, t => {
      const f = fixture(t, locale);
      for (let index = 1; index <= 8; index++) {
        const doc = index === 1 ? "A" : "doc:" + index;
        if (index !== 1) f.addDocument(doc, documentTitle);
        f.addArtifact("capacity:" + index, doc, "short_story", title, stage);
      }
      const artifacts = f.store.projection.get().libraryArtifacts, outside = artifacts.slice(6);
      assert.equal(outside.length, 2);
      notify(f, outside, stage);
      const before = authored(f), nodes = f.draw(), current = rows(f, nodes), ready = artifactActions(f, nodes);
      assert.equal(current.length, 2); assert.equal(ready.length, 6, "Ready's existing display bound is unchanged");
      assert.ok(current.every(row => !ready.some(node => libraryFocusFromRoute(node.attributes.href).id === row.notification.artifactId)));
      assertNamed(f, current); assertPanels(f, current);
      const originalNames = identities(current);
      for (const row of current) assertArtifactBinding(f, row, stage);
      f.order = projection => ({ ...projection, libraryArtifacts: [...projection.libraryArtifacts].reverse(), documents: [...projection.documents].reverse() });
      const promotedNodes = f.draw(), promoted = rows(f, promotedNodes), readyAfter = artifactActions(f, promotedNodes);
      assert.equal(readyAfter.length, 6); assert.deepEqual(identities(promoted), originalNames);
      for (const row of promoted) assert.equal(normalize(row.action.name()), normalize(readyAfter.find(node => libraryFocusFromRoute(node.attributes.href).id === row.notification.artifactId).name()));
      assert.deepEqual(authored(f), before); noCommands(f);
    });
  }

  test("Activity notification same-document takes, kinds and authored Unicode: " + locale, t => {
    const f = fixture(t, locale), unicodeTitle = "Cafe\u0301 — مخرج 👩🏽‍💻 — 同じ成果";
    for (const [index, kind] of ["short_story", "short_story", "slides", "scene"].entries())
      f.addArtifact("unicode:" + index, "A", kind, unicodeTitle, "export");
    notify(f, f.store.projection.get().libraryArtifacts, "export");
    const before = authored(f), current = rows(f);
    assert.equal(current.length, 4); assertNamed(f, current); assertPanels(f, current);
    for (const row of current) {
      assert.ok(row.card.visibleLabel().includes(unicodeTitle.normalize("NFC")), "the existing display normalization is reused, not written back");
      const { expectedContentSha256 } = assertArtifactBinding(f, row, "export");
      assert.equal(expectedContentSha256, f.hashes.get(row.notification.artifactId));
    }
    assert.deepEqual(authored(f), before); noCommands(f);
  });

  test("Activity notification composed title/document aliases: " + locale, t => {
    const f = fixture(t, locale);
    f.state.events.find(event => event.type === "DocumentCreated").payload.title = "End";
    f.addDocument("B", "Mid · End");
    f.addArtifact("alias:A", "A", "short_story", "Start · Mid", "review");
    f.addArtifact("alias:B", "B", "short_story", "Start", "review");
    notify(f, f.store.projection.get().libraryArtifacts);
    const before = authored(f), current = rows(f);
    assert.equal(current.length, 2); assertNamed(f, current);
    for (const row of current) {
      assert.ok([1, 2].some(number => row.card.visibleLabel().includes(
        f.i18n.t("artifact.delivery.resultQualifier", "", { number: f.i18n.number(number) }))), "the existing alias collision resolver remains visible");
      assertArtifactBinding(f, row, "review");
    }
    assert.deepEqual(authored(f), before); noCommands(f);
  });

  test("Activity notification identity survives read transition, reorder, rename and locale: " + locale, t => {
    const f = fixture(t, locale); f.addDocument("B", documentTitle);
    for (const doc of ["A", "B"]) f.addArtifact("current:" + doc, doc, "short_story", title, "review");
    notify(f, f.store.projection.get().libraryArtifacts);
    const initial = identities(rows(f));
    f.order = projection => ({ ...projection, libraryArtifacts: [...projection.libraryArtifacts].reverse(), documents: [...projection.documents].reverse() });
    f.store.projectNotifications.set([...f.store.projectNotifications.get()].reverse().map(row => ({ ...row, readAt: occurredAt })));
    assert.deepEqual(identities(rows(f)), initial, "read/unread and feed order do not redefine target identity");
    assert.ok(rows(f).every(row => !row.mark));
    f.addDocument("unrelated", "Different document");
    f.addArtifact("unrelated", "unrelated", "short_story", "Different output", "export");
    assert.deepEqual(identities(rows(f)), initial, "unrelated additions do not renumber the exact target");
    f.append("DocumentRenamed", { document_id: "B", old_title: documentTitle, new_title: "Renamed مستند 文書" });
    const renamed = rows(f);
    assert.ok(renamed.find(row => row.notification.documentId === "B").card.visibleLabel().includes("Renamed مستند 文書"));
    const before = authored(f);
    for (const next of ["en", "fr", "ar", "ja"]) {
      f.changeLocale(next);
      const current = rows(f); assertNamed(f, current);
      assert.equal(f.i18n.locale, next); assert.equal(f.i18n.direction, next === "ar" ? "rtl" : "ltr");
      for (const row of current) assertArtifactBinding(f, row, "review");
    }
    assert.deepEqual(authored(f), before); noCommands(f);
  });

  test("Activity notification current revision, source and review permission stay authoritative: " + locale, t => {
    const f = fixture(t, locale); f.addArtifact("bound", "A", "short_story", title, "review");
    const content = JSON.stringify({ title, content_markdown: "Current edited author bytes — نص", items: [] });
    const sha = createHash("sha256").update(content).digest("hex");
    f.store.content.set({ ...f.store.content.get(), "content:bound": content });
    f.append("DocumentArtifactEdited", { document_id: "A", artifact_id: "bound", artifact_revision: 1, content_sha256: sha, content_ref: "content:bound" });
    f.append("ArtifactReviewRequested", { document_id: "A", artifact_id: "bound", artifact_revision: 1, content_sha256: sha, assigned_reviewer_user_id: "owner" }, "user:assigner");
    f.append("ArtifactApproved", { document_id: "A", artifact_id: "bound", artifact_revision: 1, content_sha256: sha }, "user:owner");
    notify(f, f.store.projection.get().libraryArtifacts, "export");
    let current = rows(f); assertNamed(f, current);
    const binding = assertArtifactBinding(f, current[0], "export");
    assert.equal(binding.expectedRevision, 1); assert.equal(binding.expectedContentSha256, sha);
    f.append("BlockPropertyEdited", { document_id: "A", block_id: "source-A", key: "text", old_value: "Current author-owned source.", new_value: "New source content" });
    current = rows(f); assertNamed(f, current); assertArtifactBinding(f, current[0], "sources");
    f.session = { ...f.session, projectContext: { ...f.session.projectContext, permissions: ["project.read"] } };
    const before = authored(f); current = rows(f); assertNamed(f, current);
    assertArtifactBinding(f, current[0], "sources");
    assert.deepEqual(authored(f), before); noCommands(f);
  });

  test("Activity notification denied scopes keep no contextual output controls: " + locale, t => {
    const f = fixture(t, locale); f.addDocument("B", documentTitle);
    for (const doc of ["A", "B"]) f.addArtifact("scope:" + doc, doc, "short_story", title, "review");
    notify(f, f.store.projection.get().libraryArtifacts);
    const before = authored(f);
    assert.equal(rows(f).length, 2, "healthy current scope starts with two reachable original actions");
    const session = f.session;
    f.session = { ...session, projectContext: { ...session.projectContext, permissions: ["project.read"] } };
    const readOnly = rows(f);
    assert.equal(readOnly.length, 2);
    for (const row of readOnly) assertArtifactBinding(f, row, "inspect");
    f.session = { ...session, projectContext: { ...session.projectContext, projectId: "foreign" } };
    assert.equal(rows(f).length, 0); assert.equal(artifactActions(f).length, 0);
    f.session = null;
    assert.equal(rows(f).length, 0); assert.equal(artifactActions(f).length, 0);
    assert.deepEqual(authored(f), before); noCommands(f);
  });
}
