import assert from "node:assert/strict";
import { writeFixture, financial, appendAuditEvent } from "./event-source-retirement-fixture.mjs";
import { createCalmFullPage } from "./calm-full-page-fixture.mjs";

// Complete current component/Store/Worker with existing in-memory SQLite and
// native ports. No browser, AT, live data, paid work, or document-job dismissal.
async function copyHost(t, locale) {
  const h = await writeFixture(t, { shared: true });
  const target = { projectId: h.worker.projectId, documentId: h.worker.documentId };
  const original = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(), session: h.store.session.get() };
  const f = await createCalmFullPage(t, { locale, storeHost: { ...h, close() {} } });
  h.store.events.set(original.events); h.store.head.set(original.head);
  h.store.content.set(original.content); h.store.session.set(original.session);
  h.store.setRoute("/studio/project"); h.store.loading.set(false); await f.settle();
  const owner = "forma-project-contents", pending = [], actualApply = h.store.applyDocumentCopy, actualCheck = h.store.checkDocumentCopy, actualDismiss = h.store.dismissDocumentCopy;
  t.mock.method(h.store, "applyDocumentCopy", function (...args) { const result = actualApply.apply(this, args); pending.push(result); return result; });
  t.mock.method(h.store, "checkDocumentCopy", function (...args) { const result = actualCheck.apply(this, args); pending.push(result); return result; });
  t.mock.method(h.store, "dismissDocumentCopy", function (...args) { const result = actualDismiss.apply(this, args); pending.push(result); return result; });
  const inOwner = node => node.owner.tag === owner;
  const byLabel = key => { const rows = f.tree().visible("button").filter(node => inOwner(node) && node.text === f.i18n.t(key)); assert.ok(rows.length <= 1, "no ambiguous copy action"); return rows[0]; };
  const source = h.store.projection.get().documents.find(row => row.id === target.documentId);
  const open = () => f.find("button", node => inOwner(node) && node.handlers.click?.toString().includes("#beginDuplicate")
    && node.attributes["aria-label"] === f.i18n.system("Duplicate") + " " + source.title);
  const title = () => f.find("input", node => inOwner(node) && node.handlers.input?.toString().includes("#title"));
  const folder = () => f.find("select", node => inOwner(node) && node.handlers.change?.toString().includes("#copyFolder"));
  const form = () => f.find("form", node => inOwner(node) && node.handlers.submit?.toString().includes("#createDocument"));
  const paragraphs = () => f.tree().visible("p").filter(inOwner);
  const calls = () => h.requests.filter(row => row.url === "/api/documents/duplicate");
  const receipts = () => h.worker.sqlite.prepare("SELECT * FROM authoring_commits WHERE operation='document-duplicate'").all();
  return { h, f, target, byLabel, open, title, folder, form, paragraphs, calls, receipts,
    async join() { await Promise.all(pending); await f.settle(); },
    async review() {
      await f.act(open());
      assert.equal(h.store.documentCopyReview(target)?.phase, "draft");
      const field = title(); field.port.value = "Exact owned copy · " + locale; await f.act(field, "input");
      const destination = folder(); destination.port.value = "root"; await f.act(destination, "change");
      await f.act(form(), "submit"); const state = h.store.documentCopyReview(target);
      assert.equal(state.phase, "review"); assert.equal(state.stale, false); assert.ok(state.preview);
      return state;
    } };
}

const copyJson = async (p, body) => {
  const response = await p.h.worker.request("/api/documents/duplicate", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
};
const exact = (p, state, action) => ({ action, ...p.target, previewId: state.previewId, approvalHash: state.approvalHash });
const duplicateRequests = p => p.calls().map(row => row.body);
function assertNoPaidWork(p, before) {
  assert.deepEqual(financial(p.h.worker), before); assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(p.h.requests.filter(row => row.url.startsWith("/api/document-jobs") && row.init.method === "POST").length, 0);
}
async function failedFolder(t, locale) {
  const p = await copyHost(t, locale), { h, f, target } = p, folderId = "recovery-folder-" + locale;
  // Explicit authored folder fixture. Its subsequent removal uses the actual
  // authorized events route while the original free request is in transit.
  await appendAuditEvent(h.worker.env, h.worker.streamId, "user:" + h.worker.owner, "CollectionCreated", {
    project_id: target.projectId, collection_id: folderId, handle: "Original destination", position: "a0",
  });
  await h.store.refreshEvents(); await f.settle(); await f.act(p.open());
  const name = p.title(); name.port.value = "Original requested copy"; await f.act(name, "input");
  const folder = p.folder(); folder.port.value = "folder:" + folderId; await f.act(folder, "change");
  let removed = false, originalReply;
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "preview") return;
    assert.equal(removed, false); removed = true;
    const removal = await h.worker.request("/api/events", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        action: "append", event: { type: "CollectionRemoved", payload: { project_id: target.projectId, collection_id: folderId } },
      }),
    });
    assert.equal(removal.status, 200, await removal.clone().text());
    const response = await h.worker.request(request.url, request.init);
    originalReply = await response.clone().json();
    assert.equal(response.status, 409); assert.equal(originalReply.status, "not-applied");
    assert.equal(originalReply.error, "document_duplicate_folder_unavailable");
    return response;
  };
  await f.act(p.form(), "submit"); h.intercept = null;
  const original = h.store.documentCopyReview(target);
  assert.equal(original.phase, "unavailable"); assert.equal(original.previewId, "");
  assert.equal(p.receipts().length, 0);
  assert.equal(h.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='authoring-preview'").get().n, 0);
  await h.store.refreshEvents(); await f.settle();
  return { ...p, original, folderId, originalReply };
}
async function enterRevision(p, title) {
  const { h, f, target } = p, before = p.calls().length;
  assert.ok(p.byLabel("document.copy.revise"), "known folder refusal exposes deliberate same-request editing");
  await f.act(p.byLabel("document.copy.revise"));
  const state = h.store.documentCopyReview(target);
  assert.equal(state.phase, "editing"); assert.equal(state.operationId, p.original.operationId);
  assert.equal(p.calls().length, before, "editing itself does not prepare a plan or replace an operation");
  const name = p.title(); assert.equal(Object.hasOwn(name.attributes, "readonly"), false);
  name.port.value = title; await f.act(name, "input");
  const folder = p.folder(); assert.equal(Object.hasOwn(folder.attributes, "disabled"), false);
  folder.port.value = "root"; await f.act(folder, "change");
  assert.ok(p.paragraphs().some(node => node.text === f.i18n.t("document.copy.reviseHint")));
  assert.equal(Boolean(p.byLabel("document.copy.apply")), false);
}

async function awaitBoundary(entered, pending, label) {
  await Promise.race([entered.promise, pending.then(() => assert.fail(label + " ended before the actual held boundary"))]);
}
export { awaitBoundary, copyHost, copyJson, exact, duplicateRequests, assertNoPaidWork, failedFolder, enterRevision };
