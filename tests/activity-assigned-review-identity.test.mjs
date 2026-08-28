import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { registerHooks } from "node:module";

// Complete current Activity + registered IssuePanel, actual scoped models and
// LocaleController/catalogs. The existing history/DOM/Store-boundary ports are
// not browser/AT, Worker task insertion, context navigation, or server approval.
const fixtureUrl = new URL("./activity-notification-identity.test.mjs", import.meta.url);
const original = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstTest = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === "test");
assert.ok(firstTest);
const fixtureSource = original.slice(0, firstTest.getFullStart())
  + "\nexport {fixture,loadActual,ancestor,normalize,FormaActivityIssuePanel};";
const virtual = new URL(fixtureUrl); virtual.search = "?activity-assigned-review-identity-fixture";
const hook = registerHooks({ load(url, context, next) {
  return url === virtual.href ? { format: "module", source: fixtureSource, shortCircuit: true } : next(url, context);
} });
let fixtureModule;
try { fixtureModule = await import(virtual.href); } finally { hook.deregister(); }
const { fixture, ancestor, normalize, FormaActivityIssuePanel } = fixtureModule;
const title = "Shared output مخرج 同じ成果";
const documentTitle = "Shared document مستند 同じ文書";
const organizationName = "Existing organization منظمة 組織";
const summary = "Approved project template summary — نص ثابت — 同じ説明。";
const createdAt = "2026-08-28T19:00:00Z";

function tasksFor(f) {
  const projection = f.store.projection.get(), context = f.session.projectContext;
  return projection.libraryArtifacts.map(artifact => ({
    id: "assigned-task:" + artifact.id, organizationId: context.organizationId, organizationName,
    projectAccessId: context.projectAccessId, projectId: context.projectId, projectName: projection.projectName,
    documentId: artifact.documentId, documentTitle: projection.documents.find(doc => doc.id === artifact.documentId).title,
    artifactId: artifact.id, artifactTitle: artifact.title, artifactKind: artifact.kind, revision: 0,
    contentSha256: f.hashes.get(artifact.id), status: "pending", dueAt: null, createdAt,
    requestedByUserId: "assigner", requestedByName: "Existing project author",
  }));
}
function setup(t, locale, scenario = "same-document") {
  const f = fixture(t, locale); f.addDocument("B", documentTitle);
  for (const [index, doc] of (scenario === "same-document" ? ["A", "A"] : ["A", "B"]).entries())
    f.addArtifact("assigned-output:" + index, doc, "short_story", scenario === "healthy-distinct-context" ? title + " " + (index + 1) : title, "review");
  for (const event of f.state.events) if (event.type === "DocumentRenderCompleted") event.payload.summary = summary;
  const tasks = tasksFor(f); f.store.reviewInbox.set(tasks);
  f.forwarded = [];
  f.store.openAssignedReview = async task => { f.forwarded.push(task); return true; };
  return f;
}
function snapshot(f) { return structuredClone({ events: f.state.events, content: f.store.content.get(), tasks: f.store.reviewInbox.get() }); }
function noCalls(f) { assert.deepEqual(f.state.requests, []); assert.deepEqual(f.state.loads, []); }
function rows(f, nodes = f.draw()) {
  return nodes.filter(node => node.tag === "forma-activity-issue-panel" && node.properties.review).map(node => {
    const task = node.properties.review, card = ancestor(node, "article");
    const owned = nodes.filter(candidate => ancestor(candidate, "article") === card);
    const open = owned.find(candidate => candidate.tag === "button" && candidate.attributes.class === "button primary");
    assert.ok(open, "the original Open assigned review control is still present");
    const panel = [...f.renderer.instances.values()].map(row => row.instance)
      .find(instance => instance instanceof FormaActivityIssuePanel && instance.review === task);
    assert.ok(panel, "the full real IssuePanel is actually mounted for the exact task");
    return { task, card, open, panel, nodes: owned,
      section: owned.find(candidate => candidate.tag === "section" && candidate.attributes.class === "forma-activity-issue-panel forma-activity-issue-review"),
      heading: owned.find(candidate => candidate.tag === "h4"), form: owned.find(candidate => candidate.tag === "form"),
      note: owned.find(candidate => candidate.tag === "textarea"),
      approve: owned.find(candidate => candidate.tag === "button" && candidate.attributes.class === "button primary compact"),
      changes: owned.find(candidate => candidate.tag === "button" && candidate.attributes.type === "submit"),
    };
  });
}
function openOriginal(f, current) {
  for (const row of current) {
    const count = f.forwarded.length;
    row.open.handlers.click.call(f.host, { currentTarget: row.open, target: row.open });
    assert.equal(f.forwarded.length, count + 1);
    assert.strictEqual(f.forwarded.at(-1), row.task, "forward the unchanged original task object, not its presentation adapter");
    assert.ok(f.store.reviewInbox.get().includes(row.task));
  }
}
function named(f, label, context) { return f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", { action: label, name: context }); }
function assertIdentities(f, current, inline = true) {
  assert.equal(new Set(current.map(row => normalize(row.card.name()))).size, current.length, "complete cards have unique programmatic identities");
  assert.equal(new Set(current.map(row => normalize(row.card.visibleLabel()))).size, current.length, "complete visible cards distinguish exact assigned outputs");
  assert.equal(new Set(current.map(row => normalize(row.open.name()))).size, current.length, "the existing open actions have distinct exact-task names");
  for (const row of current) {
    const label = f.i18n.t("activity.openReview", "Open assigned review"), context = row.card.attributes["aria-label"];
    assert.equal(normalize(row.open.visibleLabel()), normalize(label));
    assert.equal(row.open.name(), named(f, label, context));
    assert.equal(row.open.attributes.type, "button"); assert.equal(row.open.disabled(), false);
    assert.match(context, /\u2068[^\u2069]+\u2069/u, "authored context is bidi-isolated");
    assert.ok(context.includes(f.i18n.t("activity.reviewRevision", "Review revision {revision}", { revision: String(row.task.revision) })));
    assert.equal(row.panel.reviewContext.name, context);
    const heading = row.nodes.find(node => node.tag === "h3");
    assert.ok(heading.visibleLabel().includes(row.task.artifactTitle), "visible authored title remains exact, including NFD/Unicode");
    for (const value of [row.task.organizationName, row.task.projectName, row.task.documentTitle].filter(Boolean))
      assert.ok(row.card.visibleLabel().includes(value), "already-authorized task context stays visible");
    assert.equal(context.includes(f.i18n.t("output.take", "Take {number}", { number: f.i18n.number(1) })), false, "no generation-take inference from a review inbox");
    if (!inline) {
      assert.equal(row.section, undefined); assert.equal(row.note, undefined); assert.equal(row.approve, undefined);
      assert.equal(row.panel.markup, "", "metadata-only all-assignments does not grant private inline review access");
      continue;
    }
    for (const [control, key, fallback] of [
      [row.section, "activity.issue.reviewHere", "Review this exact output here"],
      [row.heading, "activity.issue.reviewHere", "Review this exact output here"],
      [row.form, "activity.issue.requestChanges", "Request changes"],
      [row.approve, "activity.issue.approve", "Approve output"],
      [row.note, "activity.issue.reviewNote", "Describe the required changes"],
      [row.changes, "activity.issue.requestChanges", "Request changes"],
    ]) {
      assert.ok(control);
      assert.equal(control.name(), named(f, f.i18n.t(key, fallback), context), "the real inline group/heading/field/action uses the current exact-task context");
      if (["button", "textarea"].includes(control.tag)) {
        assert.ok(normalize(control.name()).startsWith(normalize(control.visibleLabel())));
        assert.equal(control.disabled(), false);
      }
    }
    assert.equal(row.note.attributes.required, ""); assert.equal(row.note.attributes.maxlength, "500"); assert.equal(row.note.attributes.rows, "2");
    assert.equal(row.changes.attributes.type, "submit"); assert.equal(row.approve.attributes.type, "button");
    assert.ok(row.panel.markup.includes(summary), "the actual authored preview child remains rendered unchanged");
  }
  if (inline) for (const key of ["section", "heading", "form", "approve", "note", "changes"])
    assert.equal(new Set(current.map(row => normalize(row[key].name()))).size, current.length, key + " contexts must not collapse across tasks");
}
function allAssignments(f, crossOrganization = false) {
  const originalTasks = f.store.reviewInbox.get();
  const tasks = originalTasks.map((task, index) => ({
    ...task, organizationId: crossOrganization ? "org:" + index : task.organizationId,
    projectAccessId: "access:" + index, projectId: "project:" + index,
    projectName: "Shared project مشروع 同じ計画", documentId: "same-document", documentTitle,
    artifactId: "same-artifact", artifactTitle: title, revision: index + 2,
  }));
  f.session = { ...f.session, projectContext: null, projects: tasks.map(task => ({
    organizationId: task.organizationId, projectAccessId: task.projectAccessId, projectId: task.projectId,
  })) };
  const projection = f.store.projection.get();
  f.store.projection = { get: () => ({ ...projection, projectId: "", documentId: "", projectName: "", documents: [], libraryArtifacts: [], libraryOutputs: [], libraryBlocks: [] }) };
  f.state.events = []; f.store.content.set({});
  f.store.reviewInbox.set(tasks);
  return tasks;
}

test("assigned-review identity fixtures use the actual authorized Worker task envelope", () => {
  const worker = fs.readFileSync(new URL("../worker/review-automation-api.ts", import.meta.url), "utf8");
  for (const phrase of ["id: String(row.task_id)", "organizationId: String(row.organization_id)", "projectId: String(row.project_id)",
    "documentId: String(row.document_id)", "artifactId: String(row.artifact_id)", "revision: Number(row.artifact_revision)",
    "contentSha256: String(row.content_sha256)", "status: String(row.status)", "requestedByName: String(row.requested_by_name)"])
    assert.ok(worker.includes(phrase), phrase);
});

for (const locale of ["en", "fr", "ar", "ja"]) {
  for (const scenario of ["same-document", "duplicate-documents"]) {
    test("assigned review full card and inline names: " + locale + "/" + scenario, t => {
      const f = setup(t, locale, scenario), before = snapshot(f), current = rows(f);
      assert.equal(current.length, 2); assertIdentities(f, current); openOriginal(f, current);
      assert.deepEqual(snapshot(f), before); noCalls(f);
    });
  }

  test("assigned review healthy distinct-card and exact-forwarding control: " + locale, t => {
    const f = setup(t, locale, "healthy-distinct-context"), before = snapshot(f), current = rows(f);
    assert.equal(current.length, 2); assert.equal(new Set(current.map(row => normalize(row.card.visibleLabel()))).size, 2);
    assert.ok(current.every(row => row.section && row.note && row.approve && row.changes));
    openOriginal(f, current);
    for (const row of current) {
      assert.equal(row.task.revision, 0); assert.equal(row.task.contentSha256, f.hashes.get(row.task.artifactId));
      assert.equal(row.note.attributes.required, ""); assert.equal(row.note.attributes.maxlength, "500");
    }
    assert.deepEqual(snapshot(f), before); noCalls(f);
  });

  for (const crossOrganization of [false, true]) {
    test("assigned review private projection absent: " + locale + "/" + (crossOrganization ? "cross-organization" : "cross-project"), t => {
      const f = setup(t, locale, "duplicate-documents"); allAssignments(f, crossOrganization);
      const before = snapshot(f), current = rows(f);
      assert.equal(current.length, 2); assertIdentities(f, current, false); openOriginal(f, current);
      assert.equal(new Set(f.forwarded.map(task => task.projectAccessId)).size, 2);
      assert.deepEqual(snapshot(f), before); noCalls(f);
    });
  }

  test("assigned review composed authored label aliases remain distinct: " + locale, t => {
    const f = setup(t, locale, "duplicate-documents"), tasks = f.store.reviewInbox.get();
    const prefix = [organizationName, tasks[0].projectName].filter(Boolean).join(" · ");
    const renamed = tasks.map((task, index) => ({
      ...task, artifactTitle: index ? "Start" : "Start · " + prefix + " · Mid",
      documentTitle: index ? "Mid · " + prefix + " · End" : "End",
    }));
    f.store.reviewInbox.set(renamed);
    const before = snapshot(f), current = rows(f);
    assertIdentities(f, current);
    for (const row of current) assert.ok([1, 2].some(number => row.card.visibleLabel().includes(
      f.i18n.t("artifact.delivery.resultQualifier", "Result {number}", { number: f.i18n.number(number) }))));
    openOriginal(f, current); assert.deepEqual(snapshot(f), before); noCalls(f);
  });

  test("assigned review authored Unicode remains visible and unmodified: " + locale, t => {
    const f = setup(t, locale, "duplicate-documents");
    f.store.reviewInbox.set(f.store.reviewInbox.get().map(task => ({
      ...task, artifactTitle: "Cafe\u0301 — مخرج 👩🏽‍💻 — 同じ成果", documentTitle: "Cafe\u0301 · مستند · 同じ文書",
      projectName: "Cafe\u0301 · مشروع · 同じ計画", organizationName: "Cafe\u0301 · مؤسسة · 同じ組織",
    })));
    const before = snapshot(f), current = rows(f);
    assertIdentities(f, current); openOriginal(f, current);
    assert.deepEqual(snapshot(f), before); noCalls(f);
  });

  test("assigned review names follow equivalent refresh, reorder, rename and locale: " + locale, t => {
    const f = setup(t, locale, "duplicate-documents");
    const initial = new Map(rows(f).map(row => [row.task.id, normalize(row.open.name())]));
    f.store.reviewInbox.set([...f.store.reviewInbox.get()].reverse().map(task => ({ ...task })));
    let current = rows(f); assertIdentities(f, current);
    assert.deepEqual(new Map(current.map(row => [row.task.id, normalize(row.open.name())])), initial);
    f.store.reviewInbox.set(f.store.reviewInbox.get().map((task, index) => ({ ...task, artifactTitle: "Renamed مخرج 成果 " + index })));
    for (const next of ["en", "fr", "ar", "ja"]) {
      f.changeLocale(next); current = rows(f); assertIdentities(f, current); openOriginal(f, current);
      assert.equal(f.i18n.locale, next); assert.equal(f.i18n.direction, next === "ar" ? "rtl" : "ltr");
    }
    noCalls(f);
  });

  test("assigned review stale child context cannot name a replacement task: " + locale, t => {
    const f = setup(t, locale, "same-document"), parent = f.host;
    const [first, second] = rows(f); assertIdentities(f, [first, second]);
    const originalContext = first.panel.reviewContext;
    assert.ok(originalContext);
    for (const [field, value] of [
      ["id", "replacement-task"], ["revision", 1], ["contentSha256", "e".repeat(64)],
      ["artifactTitle", "Replacement output"], ["documentTitle", "Replacement document"],
      ["projectName", "Replacement project"], ["organizationName", "Replacement organization"],
    ]) {
      first.panel.review = { ...first.task, [field]: value };
      first.panel.reviewContext = originalContext;
      f.host = first.panel;
      const nodes = f.draw();
      assert.ok(nodes.some(node => node.tag === "section" && node.attributes.class === "forma-activity-issue-panel forma-activity-issue-review"));
      for (const node of nodes.filter(node => ["section", "h4", "form", "textarea", "button"].includes(node.tag)))
        assert.equal(node.name().includes(originalContext.name), false, "a changed " + field + " cannot borrow the old label");
    }
    first.panel.review = second.task; first.panel.reviewContext = second.panel.reviewContext;
    const restored = f.draw();
    assert.ok(restored.some(node => node.tag === "button" && node.name() === named(f, f.i18n.t("activity.issue.approve", "Approve output"), second.panel.reviewContext.name)));
    f.host = parent; noCalls(f);
  });

  test("assigned review exact inline native form and approval bindings: " + locale, async t => {
    const f = setup(t, locale, "duplicate-documents");
    const before = snapshot(f), current = rows(f); assertIdentities(f, current);
    const reads = [], writes = [];
    f.store.ensurePrivateContent = async ref => { reads.push(ref); return f.store.content.get()[ref] ?? null; };
    let observe;
    f.store.append = async input => { writes.push(input); observe?.(); return []; }; // No positive or fake server ACK.
    for (const [index, row] of current.entries()) {
      let prevented = 0;
      const attempted = new Promise(resolve => { observe = resolve; });
      if (index) {
        const note = "Exact correction — نص — 修正 " + row.task.id;
        row.note.handlers.input.call(row.panel, { currentTarget: { value: note } });
        row.form.handlers.submit.call(row.panel, { currentTarget: row.form, preventDefault() { prevented++; } });
        await attempted;
        assert.equal(writes.at(-1).type, "ArtifactChangesRequested"); assert.equal(writes.at(-1).payload.review_note, note);
        assert.equal(prevented, 1);
      } else {
        row.approve.handlers.click.call(row.panel, { currentTarget: row.approve, target: row.approve });
        await attempted;
        assert.equal(writes.at(-1).type, "ArtifactApproved"); assert.equal(writes.at(-1).payload.review_note, undefined);
      }
      const payload = writes.at(-1).payload;
      assert.equal(payload.document_id, row.task.documentId); assert.equal(payload.artifact_id, row.task.artifactId);
      assert.equal(payload.artifact_kind, row.task.artifactKind); assert.equal(payload.artifact_revision, row.task.revision);
      assert.equal(payload.content_sha256, row.task.contentSha256); assert.equal(payload.source_surface, "activity-inline-review");
    }
    assert.equal(reads.length, 2); assert.equal(writes.length, 2);
    assert.deepEqual(snapshot(f), before, "no-ack action ports never invent saved approvals or mutate author bytes");
    noCalls(f);
  });

  test("assigned review naming cannot grant review access or private context: " + locale, t => {
    const f = setup(t, locale, "duplicate-documents"), session = f.session, before = snapshot(f);
    assert.equal(rows(f).length, 2);
    f.session = { ...session, projectContext: { ...session.projectContext, permissions: ["project.read"] } };
    assert.equal(rows(f).length, 0);
    f.session = { ...session, projectContext: { ...session.projectContext, projectId: "foreign" } };
    assert.equal(rows(f).length, 0);
    f.session = session; allAssignments(f);
    assert.equal(rows(f).length, 2);
    f.session = { ...f.session, projects: f.session.projects.slice(0, 1) };
    assert.equal(rows(f).length, 1);
    f.session = { ...f.session, impersonation: { userId: "other" } };
    assert.equal(rows(f).length, 0);
    f.session = null; assert.equal(rows(f).length, 0);
    assert.deepEqual(before.tasks.map(task => task.contentSha256), f.store.reviewInbox.get().map(task => task.contentSha256));
    noCalls(f);
  });
}
