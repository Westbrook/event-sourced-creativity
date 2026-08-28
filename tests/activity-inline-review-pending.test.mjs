// Complete current Activity/IssuePanel/Store and routed in-memory Worker.
// Pending native fields are read-only; no successful response is synthesized.
import assert from "node:assert/strict";
import test from "node:test";
import { createReviewHost, loadActual, openGallery, promote, reviewControl, click, settle, currentReview, currentArtifact } from "./helpers/artifact-review-host.mjs";
import { sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
const { FormaActivity } = await loadActual("src/components/forma-activity.ts");
const { FormaActivityIssuePanel } = await loadActual("src/components/forma-activity-issue-panel.ts");
const financialTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"];
const noteA = "Original review note A.";
const noteB = "Newer unsent review note B.";

for (const locale of ["en", "fr", "ar", "ja"]) {
  for (const scenario of ["unchanged", "pending-lock", "rejected-unlocks"]) {
    test("current inline review " + locale + "/" + scenario, async t => {
      const release = sceneDeferred(), releaseInbox = sceneDeferred();
      t.after(() => { release.resolve(); releaseInbox.resolve(); });
      const { f, h, worker, switchActor } = await createReviewHost(t, { shared: true, locale });
      const finance = () => Object.fromEntries(financialTables.map(table => [table,
        worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all(),
      ]));
      const beforeFinance = finance();

      // Real current Document assignment, real second synthetic principal and
      // current Worker inbox. The assigned task is not injected into the view.
      await openGallery(f);
      await promote(f);
      click(f, reviewControl(f, "ArtifactReviewRequested"));
      await settle(f, () => currentReview(f).status === "in-review");
      await switchActor("reviewer");
      await h.store.syncReviewInbox();
      const task = h.store.reviewInbox.get().find(row => row.artifactId === f.artifactId);
      assert.ok(task);

      // Mount complete Activity through the existing native/template ports,
      // including the actual IssuePanel child. No renderer-method substitution.
      f.host.disconnectedCallback();
      f.host.isConnected = false;
      f.host = new FormaActivity();
      f.host.store = h.store;
      f.host.i18n = f.i18n;
      f.host.isConnected = true;
      f.host.tag = "forma-activity";
      f.renderer.registry["forma-activity-issue-panel"] = FormaActivityIssuePanel;
      h.store.route.set("/activity?document=" + worker.documentId);
      f.draw();
      const issue = () => [...f.renderer.instances.values()].map(row => row.instance)
        .find(instance => instance instanceof FormaActivityIssuePanel && instance.review?.id === task.id);
      const panel = issue();
      assert.ok(panel?.isConnected);
      const own = tag => f.renderer.ownNodes(panel, tag);
      const editor = () => own("textarea").find(node => node.handlers.input?.toString().includes("#reviewNote"));
      const type = value => {
        const node = editor();
        assert.ok(node?.isConnected && f.renderer.nodes.includes(node));
        assert.equal(Object.hasOwn(node.attributes, "disabled"), false);
        assert.equal(Object.hasOwn(node.attributes, "readonly"), false);
        node.value = value;
        node.handlers.input.call(panel, { target: node, currentTarget: node });
        f.draw();
      };

      const entered = sceneDeferred();
      const inbox = sceneDeferred();
      let wire = null, appendPromise = null, afterAck = false;
      const originalAppend = h.store.append.bind(h.store);
      t.mock.method(h.store, "append", (...args) => {
        // Pass-through promise observation only; the real executor remains.
        const pending = originalAppend(...args);
        appendPromise = pending;
        return pending;
      });
      h.intercept = async request => {
        if (request.url === "/api/events" && request.init.method === "POST"
          && (request.body?.events ?? []).some(event => event.type === "ArtifactChangesRequested")) {
          if (scenario === "rejected-unlocks") {
            // Explicit transport-negative setup reused from the existing review
            // fixture: valid JSON but changed retained bytes. The current Worker
            // itself returns a real 409; this is not an ordinary peer-edit claim.
            worker.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?")
              .run(currentArtifact(f).contentRef);
          }
          const response = await worker.request(request.url, request.init);
          wire = { request: structuredClone(request.body), status: response.status,
            body: await response.clone().json() };
          entered.resolve();
          await release.promise;
          afterAck = true;
          return response;
        }
        if (afterAck && request.url === "/api/workspaces/reviews") {
          const response = await worker.request(request.url, request.init);
          assert.equal(response.status, 200);
          inbox.resolve();
          // Hold the genuine follow-up read just long enough to observe the
          // SAME connected field, then allow actual task removal to finish.
          await releaseInbox.promise;
          return response;
        }
      };

      type(noteA);
      const form = own("form").find(node => node.handlers.submit?.toString().includes("#resolveReview"));
      const button = own("button").find(node => node.attributes.type === "submit");
      assert.ok(form?.isConnected && button?.isConnected);
      assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
      form.handlers.submit.call(panel, { target: form, currentTarget: form, preventDefault() {} });
      await entered.promise;
      assert.ok(appendPromise);
      const rejected = scenario === "rejected-unlocks";
      assert.equal(wire.status, rejected ? 409 : 200, JSON.stringify(wire.body));
      if (rejected) assert.equal(wire.body.error, "stale_review_context");
      f.draw();
      assert.ok(issue() === panel);
      const pendingReadOnly = Object.hasOwn(editor().attributes, "readonly");
      if (scenario !== "unchanged" && !pendingReadOnly) type(noteB);
      const before = editor().value;

      release.resolve();
      const appended = await appendPromise;
      if (!rejected) await inbox.promise;
      else await Promise.resolve();
      f.draw();
      assert.ok(issue() === panel);
      assert.ok(editor()?.isConnected);
      const after = editor().value;
      const notes = worker.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id IN(SELECT event_id FROM events WHERE type='ArtifactChangesRequested') ORDER BY rowid").all();
      const request = wire.request.events.find(event => event.type === "ArtifactChangesRequested");
      assert.equal(request.payload.review_note, noteA);
      const requests = h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST"
        && (request.body?.events ?? []).some(event => event.type === "ArtifactChangesRequested"));
      assert.equal(requests.length, 1);
      assert.deepEqual(finance(), beforeFinance);
      assert.equal(JSON.stringify(notes).includes(noteB), false);
      if (rejected) {
        assert.equal(appended.length, 0);
        assert.equal(notes.length, 0);
      } else {
        assert.equal(notes.length, 1);
        assert.equal(JSON.parse(notes[0].private_json).review_note, noteA);
      }
      releaseInbox.resolve();
      if (!rejected) await settle(f, () => !h.store.reviewInbox.get().some(row => row.id === task.id));
      const taskRemoved = !h.store.reviewInbox.get().some(row => row.id === task.id);
      t.diagnostic(JSON.stringify({ locale, scenario, before, after, wireStatus: wire.status,
        wireError: wire.body.error ?? null, taskId: task.id, sameConnectedPanelBeforeInbox: true, pendingReadOnly,
        oneReviewWrite: requests.length, financeUnchanged: true, externalProviderCalls: 0,
        canonicalNotes: notes.map(row => JSON.parse(row.private_json).review_note), taskRemoved,
        physicalNativeOrATClaim: false }));
      if (scenario !== "unchanged") assert.equal(pendingReadOnly, true,
        "the current field explicitly refuses a second unsent note while its original review is pending");
      if (rejected) {
        assert.equal(after, noteA, "a rejected review retains the original submitted note");
        await settle(f, () => !Object.hasOwn(own("button").find(node => node.attributes.type === "submit").attributes, "disabled"));
        assert.equal(Object.hasOwn(editor().attributes, "readonly"), false);
        type(noteB); assert.equal(editor().value, noteB, "the current field is editable again after rejection");
        assert.equal(requests.length, 1, "unlocking or typing cannot retry the review");
      } else assert.equal(after, "");
    });
  }
}
