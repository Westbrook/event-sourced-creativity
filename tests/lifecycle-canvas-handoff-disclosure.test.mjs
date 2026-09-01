// Actual current Shell/Canvas/Projects/Library/Workspace and Store; finite native
// event/focus ports, not physical browser or assistive-technology certification.
// The existing lifecycle fixture's authored projection is synthetic. Canvas
// authority is always the original successful RAM Worker's audience response.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { lifecyclePage, activateLifecycle } from "./helpers/creative-next-action-navigation-fixture.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { documentIdFromRoute, libraryBaseRoute } from "../src/model/routes.ts";

const originalFetch = globalThis.fetch; let external = 0;
globalThis.fetch = async () => { external++; throw Error("No external/provider transport in Canvas lifecycle handoff"); };
after(() => { assert.equal(external, 0); globalThis.fetch = originalFetch; });

const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, ancestor) => { for (let at = node; at; at = at.parent) if (at === ancestor) return true; return false; };
const one = (values, message) => { assert.equal(values.length, 1, message); return values[0]; };
const opened = (f, kind) => f.tree().visible("dialog").filter(node => node.port?.open
  && classed(node, kind === "context" ? "block-composer-dialog" : "next-format-dialog"));

for (const locale of ["en", "ja"]) for (const surface of ["projects", "library"])
for (const kind of ["context", "configure"]) for (const canvas of [false, true]) {
  test("lifecycle handoff / " + locale + " / " + (canvas ? "Canvas " : "Creator ") + surface + " / " + kind,
    { concurrency: false, timeout: 45000 }, async t => {
      const f = await lifecyclePage(t, { locale, route: "/" + surface, mode: kind });
      const h = f.storeHost, store = f.store, session = store.session.get();
      assert.ok(session?.capabilities.includes("project.author"), "Real initial session can author");
      assert.ok(session.capabilities.includes("project.canvas.use"), "Existing real account has Canvas capability");
      assert.equal(session.canvas.access, true, "No fabricated Canvas access flag");
      const resume = observeActualSceneResumeReads(h);
      t.after(() => resume.restore());
      const firstRequest = h.requests.length, sessions = [], priorIntercept = h.intercept;
      h.intercept = async request => {
        if (["/api/session?audience=canvas", "/api/session?audience=creative"].includes(request.url)) {
          const response = await h.worker.request(request.url, request.init), body = await response.clone().json();
          sessions.push({ request, status: response.status, body });
          return response; // Same actual response, not a substituted success.
        }
        return priorIntercept?.(request);
      };
      t.after(() => { h.intercept = priorIntercept; });

      if (canvas) {
        assert.equal(await store.transitionWorkspace("/canvas/" + surface), true, "Actual cross-audience entry succeeds");
        await f.settle();
        const receipt = one(sessions.filter(row => row.request.url === "/api/session?audience=canvas"), "One actual Canvas audience receipt");
        assert.equal(receipt.status, 200);
        assert.equal(receipt.body.canvas.access, true);
        assert.ok(receipt.body.capabilities.includes("project.canvas.use"));
        assert.equal(receipt.body.user.userId, session.user.userId);
      }
      const owners = f.components().filter(value => value.tag === "forma-" + surface);
      const owner = one(owners, "One actual current shared page component");
      assert.ok(owner.isConnected);
      if (canvas) {
        const application = one(f.components().filter(value => value.tag === "forma-canvas-application"), "Actual Canvas application is mounted");
        assert.strictEqual(owner.closest("forma-canvas-application"), application);
        assert.equal(new URL(store.route.get(), "http://localhost").pathname, "/canvas/" + surface);
        if (surface === "library") assert.equal(libraryBaseRoute(store.route.get()), "/canvas/library");
      } else {
        assert.equal(f.components().some(value => value.tag === "forma-canvas-application"), false);
        assert.equal(new URL(store.route.get(), "http://localhost").pathname, "/" + surface);
      }

      const action = one(f.actions().filter(value => value.target.kind === kind), "Actual current resolver offers this exact preparation");
      assert.equal(action.target.projectId, f.projectId); assert.equal(action.target.documentId, f.documentId);
      assert.equal(action.target.canvasId, null, "Shared Document continuation is not an invented board action");
      const authority = store.captureAuthorizationScope(), source = store.captureSourceOwnership();
      assert.ok(authority && store.authorizationScopeActive(authority) && source && store.sourceOwnershipActive(source));
      assert.equal(action.target.authorityKey, authority.key);
      assert.equal(action.target.sourceGeneration, source.generation);
      const tree = f.tree();
      const section = one(tree.visible("section").filter(node => node.owner === owner && classed(node, "lifecycle-next-actions")), "One connected scoped continuation");
      const button = one(tree.visible("button").filter(node => inside(node, section)
        && node.attributes["data-choice-value"] === action.id), "One native current choice button");
      const strong = one(tree.visible("strong").filter(node => inside(node, button)), "Complete visible action label");
      const visibleLabel = strong.text, nativeName = button.attributes["aria-label"] ?? button.text;
      assert.equal(button.owner.tag, "forma-ui-choice-card");
      assert.equal(button.owner.label, visibleLabel);
      assert.ok(nativeName.includes(visibleLabel), "Native name includes the same complete visible label");
      assert.ok(button.port?.isConnected && !button.hiddenBy && !Object.hasOwn(button.attributes, "disabled"));
      const originalSource = JSON.stringify(store.events.get()), selected = store.ui.selectedOutputId;

      activateLifecycle(f, button); // Existing native choice -> host -> guarded current handoff.
      for (let attempt = 0; attempt < 16; attempt++) {
        await f.settle();
        for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
        await resume.settleOriginalRequests();
        if (opened(f, kind).length) break;
      }
      await f.settle(); await resume.settleOriginalRequests();
      const dialog = one(opened(f, kind), "Exact original existing Creator preparation dialog opens");
      assert.equal(dialog.owner.tag, "forma-workspace");
      assert.equal(documentIdFromRoute(store.route.get()), f.documentId);
      assert.equal(store.projection.get().projectId, f.projectId);
      assert.equal(store.projection.get().documentId, f.documentId);
      assert.equal(store.ui.selectedOutputId, selected);
      assert.equal(JSON.stringify(store.events.get()), originalSource, "No source or result mutation");
      f.sourceUnchanged();
      if (canvas) {
        const receipt = one(sessions.filter(row => row.request.url === "/api/session?audience=creative"), "Actual receiving Creator authority is rechecked");
        assert.equal(receipt.status, 200); assert.equal(receipt.body.user.userId, session.user.userId);
      }
      assert.deepEqual(h.requests.slice(firstRequest).filter(row => (row.init.method ?? "GET") !== "GET"
        && !resume.isReadOnlyResume(row)), [], "Only the original exact 200/none zero-SQL-change Resume read may use POST");
      for (const proof of resume.observations()) {
        assert.equal(proof.classified, true); assert.equal(proof.dispatchOwned, true);
        assert.equal(proof.sqliteUnchanged, true); assert.equal(proof.clonedOuterRowClassified, false);
      }
      t.diagnostic(JSON.stringify({ visibleLabel, nativeName, origin: (canvas ? "/canvas/" : "/") + surface,
        targetKind: kind, documentId: f.documentId, destination: store.route.get(), actualDialog: dialog.attributes.class,
        audienceReads: sessions.map(row => ({ path: row.request.url, status: row.status })) }));
      const suffix = " · " + f.i18n.t("next.exact.creatorWorkspace", "Creator Workspace");
      assert.equal(visibleLabel.endsWith(suffix), canvas,
        canvas ? "Canvas-origin Creator-only preparation announces its application handoff before activation"
          : "Ordinary Creator preparation stays concise without a redundant cross-app suffix");
      assert.equal(nativeName.includes(suffix), canvas, "Same destination disclosure in the native button name");
    });
}
