// Actual complete Projects/Shell/Store and routed RAM Worker. The original
// positive response is lost only after its complete commit. Native ports are
// finite; this is not a browser, paid-provider or durable cross-route proof.
import assert from "node:assert/strict";
import test from "node:test";
import { AUTHORED, createProjectIntakeFixture, assertComplete, readWorkspaceEvents } from "./helpers/project-intake-fixture.mjs";

test("C recovery lifetime copy / Projects Close retains the hint and a fresh owner has none / en",
  { concurrency: false, timeout: 60000 }, async t => {
    const x = await createProjectIntakeFixture(t, { locale: "en" }), { f, h, owner, worker } = x;
    const hint = "You can close and resume here. Leaving this Projects page removes the local recovery controls; it does not cancel the creation.";
    const description = f.i18n.t("projects.description", "Choose the project that contains your documents, collections, creative context, outputs, and boards.");
    const close = () => f.find("button", node => node.owner === owner && node.attributes.class === "icon-button modal-close"
      && node.attributes["aria-label"] === f.i18n.t("action.close", "Close"));
    const headerText = current => f.find("p", node => node.owner === current && node.parent?.attributes.class === "page-header-copy").text;
    const opener = label => f.find("button", node => node.owner.tag === "forma-ui-button" && node.owner.parentElement === owner && node.owner.label === label);
    const receiptRows = () => worker.sqlite.prepare("SELECT * FROM event_client_receipts WHERE stream_id=? ORDER BY client_event_id").all(worker.streamId);
    const source = h.store.captureSourceOwnership(), receiptOwner = { authorizationKey: source.authorization.key,
      actorUserId: h.store.session.get().user.userId, projectId: h.store.projection.get().projectId, sourceGeneration: source.generation };

    const initialRequests = h.requests.length;
    await f.act(close());
    assert.ok(owner.isConnected); assert.equal(x.visible().modal, false);
    assert.equal(headerText(owner), description, "Before an original exists, ordinary Projects description remains exact");
    assert.equal(f.tree().visible("p").some(node => node.owner === owner && node.text === hint), false);
    await f.act(opener(f.i18n.t("projects.new", "New project")));
    assert.deepEqual(x.visible().draft, AUTHORED); assert.equal(h.requests.length, initialRequests);
    let lost = null;
    x.setBehavior(async (stage, row) => {
      if (stage !== "after-worker" || lost) return;
      assertComplete(row); lost = row; row.dropped = true;
      throw new Error("Finite lost delivery after the actual complete original intake commit");
    });
    await x.submit(); x.setBehavior(async () => {});
    assert.ok(lost); const originalIds = assertComplete(lost);
    assert.equal(x.dispatches.length, 1); assert.equal(lost.body.intakeAction, "commit");
    assert.deepEqual(x.visible().draft, AUTHORED); assert.equal(x.visible().editable, false);
    const acknowledgments = h.store.eventWriteAcknowledgments(receiptOwner);
    assert.equal(acknowledgments.length, 1); assert.equal(acknowledgments[0].outcome, "unconfirmed");
    const originalStatus = f.find("p", node => node.owner === owner && node.attributes.role === "status"
      && node.parent?.tag === "form" && node.parent.parent?.tag === "dialog");
    assert.equal(originalStatus.text, f.i18n.t("projects.originalUnconfirmed"));
    const before = { requests: h.requests.length, history: await readWorkspaceEvents(worker.env, worker.streamId),
      receipts: receiptRows(), canonical: await x.canonical() };
    assert.equal(before.canonical.projects.length, 1); assert.equal(before.canonical.documents.length, 1);
    assert.equal(before.canonical.projects[0].projectId, originalIds.projectId);
    assert.equal(before.canonical.documents[0].documentId, originalIds.documentId);

    await f.act(close());
    assert.ok(owner.isConnected); assert.equal(x.visible().modal, false); assert.equal(h.store.route.get(), "/projects");
    const afterClose = headerText(owner);
    const resume = opener(f.i18n.system("Resume {title}", { title: "\u2068" + AUTHORED.name + "\u2069" }));
    assert.ok(resume.port.isConnected); await f.act(resume);
    assert.deepEqual(x.visible().draft, AUTHORED); assert.equal(x.visible().editable, false);
    await f.act(close());
    assert.equal(headerText(owner), afterClose); assert.equal(h.requests.length, before.requests, "Close/Resume/hint rendering never automatically checks or resends");
    assert.deepEqual(h.store.eventWriteAcknowledgments(receiptOwner), acknowledgments);

    // Public route setup retires the real host; no synthetic private reset or
    // command facade is used to manufacture the fresh-owner countercontrol.
    h.store.setRoute("/activity"); await f.settle(); assert.equal(owner.isConnected, false);
    h.store.setRoute("/projects"); await f.settle(); assert.equal(h.store.route.get(), "/projects");
    const fresh = f.components().filter(component => component.tag === "forma-projects");
    assert.equal(fresh.length, 1); assert.notEqual(fresh[0], owner); assert.ok(fresh[0].isConnected);
    assert.equal(headerText(fresh[0]), description);
    assert.equal(f.tree().visible("p").some(node => node.owner === fresh[0] && node.text === hint), false);
    assert.equal(f.tree().visible("dialog").some(node => node.owner === fresh[0]), false);
    assert.equal(x.dispatches.length, 1);
    assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), before.history);
    assert.deepEqual(receiptRows(), before.receipts); assert.deepEqual(await x.canonical(), before.canonical);
    assert.deepEqual(h.requests.slice(before.requests).filter(request => (request.init.method ?? "GET") !== "GET"), [],
      "The fresh-owner comparison never creates, cancels, retries or checks the original");
    t.diagnostic("C_RECOVERY_LIFETIME_PROJECTS " + JSON.stringify({ originalCommitted: true, acknowledgment: "unconfirmed",
      sameOwnerAfterClose: true, afterClose, freshOwnerHintAbsent: true, originalIntakeRequests: x.dispatches.length,
      originalHistoryAndReceiptRowsUnchanged: true, evidence: "actual classes/RAM Worker; finite native Close and public route setup, not browser" }));
    assert.equal(afterClose, hint, "The recovery lifetime must remain visible outside the closed original dialog");
    assert.equal(f.i18n.t("next.projects.recoveryLifetime"), hint);
  });
