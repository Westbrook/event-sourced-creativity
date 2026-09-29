import assert from "node:assert/strict";
import nativeTest from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { calmFullPageNativePorts as ports, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { libraryBlockEditorRoute, libraryRootRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";

// Existing full-class Shell/Library/Store fixture and native focus ports only.
// These are local navigation/custody observations, not CSS, browser-paint, AT,
// server authorization, provider, or persistence evidence. No suite is imported.
const test = (name, run) => nativeTest(name, { timeout: 90_000 }, async t => {
  try { return await run(t); }
  catch (error) {
    if (typeof error?.stack === "string") error.stack = error.stack.replace(
      /data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu, "full-class-fixture");
    throw error;
  }
});
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const hasClass = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const ancestor = (node, predicate) => {
  for (let current = node.parent; current; current = current.parent) if (predicate(current)) return current;
  return null;
};

async function libraryPage(t, { view = "all", direct = false } = {}) {
  const f = await createOutputReachabilityPage(t);
  const h = f.storeHost;
  f.native = installOutputNavigationFocusNative(t, f, ports);
  const previousHistory = globalThis.history;
  globalThis.history = {
    pushState(_state, _title, route) {
      const url = new URL(route, "http://localhost");
      Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash });
    },
    replaceState(...args) { this.pushState(...args); },
  };
  t.after(() => {
    globalThis.history = previousHistory;
    assert.deepEqual(h.requests.filter(row => (row.init.method ?? "GET") !== "GET"
      && !f.isReadOnlyResume?.(row)), [], "navigation performs no command, grant, upload or provider request");
  });
  f.store.patchUi({ libraryView: view });
  const documentId = f.store.projection.get().documentId;
  const rootRoute = withProjectTaskDocumentInRoute("/library", documentId);
  const initialRoute = direct ? libraryBlockEditorRoute("synthetic-0", rootRoute) : rootRoute;
  globalThis.history.replaceState({}, "", initialRoute);
  f.store.route.set(initialRoute);
  await f.settle();
  assert.equal(f.store.projection.get().documentId, documentId, "the Library route names the actual owning Document");
  const libraries = f.components().filter(component => component.tag === "forma-library");
  assert.equal(libraries.length, 1, "one complete actual Library is mounted");
  f.library = libraries[0];
  f.root = () => libraryRootRoute(f.store.route.get());
  f.editor = (id = "synthetic-0") => libraryBlockEditorRoute(id, f.store.route.get());
  f.search = () => f.find("input", node => node.owner?.tag === "forma-ui-search"
    && node.owner.closest("forma-library") === f.library
    && ancestor(node, value => hasClass(value, "library-toolbar")));
  f.control = (id = "synthetic-0") => f.find("button", node => node.owner === f.library
    && node.attributes["data-context-controls-id"] === id);
  f.otherField = () => f.find("select", node => node.owner?.tag === "forma-ui-language-picker").port;
  f.go = async path => {
    const local = f.library.captureLocalNavigation(path);
    const before = { path, route: f.store.route.get(), current: local?.current(), blocked: local?.blocked() };
    let refusal;
    const opened = await f.host.navigateFrom(f.library, { localRoute: path }, { onRefusal: value => { refusal = value; } });
    if (!opened) t.diagnostic(JSON.stringify({ navigationRefused: before, refusal, after: f.store.route.get() }));
    await f.settle();
    return opened;
  };
  f.setSearch = async value => {
    const field = f.search(); field.port.value = value;
    await f.act(field, "input");
    assert.equal(f.search().port.value, value);
  };
  f.retireSource = async () => {
    const source = f.store.captureSourceOwnership(), prior = h.intercept;
    assert.equal(f.store.sourceOwnershipActive(source), true);
    let denied = 0;
    h.intercept = async request => {
      if (/^\/api\/events(?:\?|$)/u.test(request.url)) {
        assert.equal(request.init.method ?? "GET", "GET"); denied++;
        return Response.json({ error: "synthetic-source-denied" }, { status: 403 });
      }
      return prior?.(request);
    };
    try { await assert.rejects(f.store.refreshEvents({ fromStart: true, readOnly: true }), /403/u); }
    finally { h.intercept = prior; }
    assert.equal(denied, 1, "one actual whole-Source GET retires this existing Store generation");
    assert.equal(f.store.sourceOwnershipActive(source), false);
  };
  return f;
}

function ownMethod(t, object, key, replacement) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, { configurable: true, writable: true, value: replacement });
  const restore = () => {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else delete object[key];
  };
  t.after(restore);
  return restore;
}

// Hold the existing native updateComplete port, after its actual full-tree draw.
// No host method/template/ownership predicate is substituted.
function holdLibraryUpdate(t, f) {
  const entered = deferred(), release = deferred();
  const descriptor = Object.getOwnPropertyDescriptor(f.library, "updateComplete");
  Object.defineProperty(f.library, "updateComplete", { configurable: true,
    get() { return f.tick().then(() => { entered.resolve(); return release.promise; }); },
  });
  let released = false;
  const finish = () => {
    if (released) return; released = true;
    if (descriptor) Object.defineProperty(f.library, "updateComplete", descriptor);
    else delete f.library.updateComplete;
    release.resolve(true);
  };
  t.after(finish);
  return { entered: entered.promise, release: finish };
}

function returnCalls(f, start = 0) {
  return f.native.nativeFocus.slice(start).filter(row => row.node.owner === f.library
    && row.node.attributes["data-context-controls-id"] === "synthetic-0");
}

for (const view of ["all", "blocks"]) test(`admitted searched ${view} → Controls → Back restores the view, raw query and exact local action`, async t => {
  const f = await libraryPage(t, { view });
  await f.setSearch("synthetic editable direction evidence 0");
  const events = JSON.stringify(f.store.events.get());
  const original = f.control().port;
  f.native.focus(original);
  assert.equal(await f.go(f.editor()), true);
  assert.equal(f.store.ui.libraryView, view, "opening Controls preserves the originating list selection");
  const start = f.native.nativeFocus.length, scrollStart = f.native.nativeScroll.length;
  assert.equal(await f.go(f.root()), true);
  assert.equal(f.store.ui.libraryView, view);
  assert.equal(f.search().port.value, "synthetic editable direction evidence 0");
  const calls = returnCalls(f, start);
  assert.equal(calls.length, 1, "one original arrival lease performs the return focus");
  assert.equal(calls[0].node.getAttribute("data-context-controls-id"), "synthetic-0");
  assert.deepEqual(calls[0].args, [{ preventScroll: true }]);
  assert.deepEqual(f.native.nativeScroll.slice(scrollStart).filter(row => row.node === calls[0].node)
    .map(row => row.args), [[{ block: "nearest", inline: "nearest", behavior: "instant" }]]);
  assert.equal(JSON.stringify(f.store.events.get()), events, "opening and returning do not edit Source");
});

test("direct editor entry uses Blocks; editor-to-editor navigation retains the first All origin", async t => {
  await t.test("direct entry", async t => {
    const f = await libraryPage(t, { view: "all", direct: true });
    // Browser imports register these list components before a route arrives.
    // This existing lazy fixture must do the same before updateComplete's draw.
    await registerCalmFullPageComponents(f, ["forma-ui-search", "forma-ui-segmented-control"]);
    const capture = f.library.captureLocalNavigation;
    ownMethod(t, f.library, "captureLocalNavigation", function (path) {
      const local = capture.call(this, path);
      if (!local?.afterCommit) return local;
      return { ...local, afterCommit: async arrival => {
        const before = { route: f.store.route.get(), current: arrival.current(), focus: arrival.focus.current() };
        try { await local.afterCommit(arrival); }
        catch (error) { t.diagnostic(JSON.stringify({ directReturnError: String(error) })); throw error; }
        finally { t.diagnostic(JSON.stringify({ directReturn: before, after: { route: f.store.route.get(),
          current: arrival.current(), focus: arrival.focus.current(), active: f.native.document.activeElement?.tag } })); }
      } };
    });
    const transition = f.store.transitionWorkspace;
    ownMethod(t, f.store, "transitionWorkspace", async function (path, options) {
      const opened = await transition.call(this, path, options);
      t.diagnostic(JSON.stringify({ directTransition: { path, opened, route: this.route.get(), focus: options.focus.current() } }));
      return opened;
    });
    assert.equal(await f.go(f.root()), true);
    assert.equal(f.store.ui.libraryView, "blocks");
    assert.ok(f.control().port);
  });
  await t.test("two admitted editors", async t => {
    const f = await libraryPage(t);
    await f.setSearch("synthetic");
    assert.equal(await f.go(f.editor()), true);
    assert.equal(await f.go(f.editor("synthetic-1")), true);
    assert.equal(await f.go(f.root()), true);
    assert.equal(f.store.ui.libraryView, "all");
    assert.equal(f.search().port.value, "synthetic");
    assert.equal(f.native.nativeFocus.filter(row => row.node.owner === f.library
      && row.node.attributes["data-context-controls-id"] === "synthetic-1").length, 1);
  });
});

test("an admitted Back whose Store transition refuses does not consume the first All origin", async t => {
  const f = await libraryPage(t);
  await f.setSearch("synthetic");
  assert.equal(await f.go(f.editor()), true);
  const editorRoute = f.store.route.get(), root = f.root();
  const originalTransition = f.store.transitionWorkspace;
  let refused = 0;
  const restore = ownMethod(t, f.store, "transitionWorkspace", async function (path, options) {
    assert.equal(this, f.store); assert.equal(path, root);
    assert.equal(options.current(), true, "Shell admitted and prepared the actual original Back");
    assert.equal(this.ui.libraryView, "all", "the actual Back preparation already selected its origin");
    assert.equal(this.route.get(), editorRoute);
    refused++;
    return false; // A finite Store boundary refusal, not a refused pre-admission gesture.
  });
  assert.equal(await f.go(root), false);
  assert.equal(refused, 1);
  assert.equal(f.store.route.get(), editorRoute);
  restore();
  assert.equal(f.store.transitionWorkspace, originalTransition);
  const start = f.native.nativeFocus.length;
  assert.equal(await f.go(root), true);
  assert.equal(f.store.ui.libraryView, "all", "the first origin survives a prepared but uncommitted attempt");
  assert.equal(f.search().port.value, "synthetic");
  assert.equal(returnCalls(f, start).length, 1, "the abandoned pending return does not suppress its successor");
});

test("a refused admitted Controls entry leaves the actual All list unchanged before a successful retry and Back", async t => {
  const f = await libraryPage(t);
  await f.setSearch("synthetic");
  const editor = f.editor(), root = f.store.route.get();
  let refused = 0;
  const restore = ownMethod(t, f.store, "transitionWorkspace", async function (path, options) {
    assert.equal(this, f.store); assert.equal(path, editor);
    assert.equal(options.current(), true, "actual Controls preparation completed before this refusal");
    assert.equal(this.route.get(), root);
    assert.equal(this.ui.libraryView, "all", "uncommitted entry does not rewrite the originating list");
    refused++; return false;
  });
  assert.equal(await f.go(editor), false);
  assert.equal(refused, 1);
  assert.equal(f.store.route.get(), root);
  assert.equal(f.store.ui.libraryView, "all");
  assert.equal(f.search().port.value, "synthetic");
  assert.ok(f.control().port, "the actual All list rendered again after the refused entry");
  restore();
  assert.equal(await f.go(editor), true);
  const start = f.native.nativeFocus.length;
  assert.equal(await f.go(f.root()), true);
  assert.equal(f.store.ui.libraryView, "all");
  assert.equal(returnCalls(f, start).length, 1);
});

test("a captured actual LocalNavigation refuses retired Source, authorization, Store, document and missing target before preparation", async t => {
  for (const change of ["source", "authorization", "store", "document", "removed"]) await t.test(change, async t => {
    const f = await libraryPage(t);
    const originalStore = f.store, route = f.store.route.get(), view = f.store.ui.libraryView;
    const local = f.library.captureLocalNavigation(f.editor());
    assert.ok(local); assert.equal(local.current(), true); assert.equal(local.blocked(), false);
    if (change === "source") await f.retireSource();
    if (change === "authorization") f.store.session.set({ ...f.store.session.get(), permissionEpoch: "changed-library-authority" });
    if (change === "store") { f.library.store = Object.create(f.store); t.after(() => { f.library.store = originalStore; }); }
    if (change === "document") {
      const other = f.store.projection.get().documents.find(document => document.id !== f.store.projection.get().documentId);
      assert.ok(other); f.store.route.set("/document/" + other.id + "/other-document");
      assert.equal(f.store.projection.get().documentId, other.id);
    }
    if (change === "removed") f.appendEvent("BlockRemoved", { block_id: "synthetic-0" });
    assert.equal(local.current(), false);
    assert.equal(local.prepare(), false);
    assert.equal(f.store.ui.libraryView, view, "refused preparation cannot set Blocks");
    if (change !== "document") assert.equal(f.store.route.get(), route);
    f.library.store = originalStore;
  });
});

test("foreign-project and noncanonical editor destinations are not admitted", async t => {
  const f = await libraryPage(t);
  f.appendEvent("ProjectCreated", { project_id: "foreign-library-project", name: "Foreign" });
  f.appendEvent("DocumentCreated", { project_id: "foreign-library-project", document_id: "foreign-library-document", title: "Foreign" });
  f.appendEvent("BlockCreated", { project_id: "foreign-library-project", document_id: "foreign-library-document",
    block_id: "foreign-library-block", type: "direction", handle: "direction/foreign", position: "a",
    properties: { text: "A separate project source", authority: "authored" } });
  await f.settle();
  assert.equal(f.store.projection.get().libraryBlocks.some(block => block.id === "foreign-library-block"), false);
  for (const path of [f.editor("foreign-library-block"), f.editor("absent-library-block"),
    f.editor() + "?unowned=1", "//example.invalid/library", "/canvas/library/blocks/synthetic-0"]) {
    assert.equal(f.library.captureLocalNavigation(path), null, path);
  }
  assert.equal(f.store.ui.libraryView, "all");
});

test("new user focus before the actual afterCommit and during updateComplete is never renewed into a return lease", async t => {
  for (const boundary of ["before-afterCommit", "during-updateComplete"]) await t.test(boundary, async t => {
    const f = await libraryPage(t);
    await f.setSearch("synthetic");
    assert.equal(await f.go(f.editor()), true);
    const start = f.native.nativeFocus.length, scrollStart = f.native.nativeScroll.length;
    let newer, observed = 0;
    if (boundary === "before-afterCommit") {
      const capture = f.library.captureLocalNavigation;
      ownMethod(t, f.library, "captureLocalNavigation", function (path) {
        const local = capture.call(this, path);
        assert.ok(local?.afterCommit);
        return { ...local, afterCommit: async arrival => {
          assert.equal(arrival.current(), true, "original Shell arrival was current before new intent");
          newer = f.otherField(); f.native.focus(newer); observed++;
          assert.equal(arrival.current(), false);
          await local.afterCommit(arrival);
        } };
      });
      assert.equal(await f.go(f.root()), true, "the route may commit without reclaiming focus");
    } else {
      const held = holdLibraryUpdate(t, f);
      const pending = f.host.navigateFrom(f.library, { localRoute: f.root() });
      await held.entered;
      newer = f.otherField(); f.native.focus(newer); observed++;
      held.release();
      assert.equal(await pending, true);
      await f.settle();
    }
    assert.equal(observed, 1);
    assert.equal(returnCalls(f, start).length, 0);
    assert.equal(f.native.nativeScroll.slice(scrollStart).some(row => row.node.owner === f.library), false);
    assert.equal(f.native.document.activeElement, newer, "no later Library update takes the user's new field");
    assert.equal(f.store.ui.libraryView, "all");
  });
});

test("a pending actual return cannot focus a removed, foreign, disabled or ambiguous Controls port", async t => {
  for (const change of ["removed", "foreign", "disabled", "duplicate"]) await t.test(change, async t => {
    const f = await libraryPage(t);
    await f.setSearch("synthetic");
    assert.equal(await f.go(f.editor()), true);
    const held = holdLibraryUpdate(t, f), start = f.native.nativeFocus.length;
    const pending = f.host.navigateFrom(f.library, { localRoute: f.root() });
    await held.entered;
    const target = f.control().port;
    if (change === "removed") target.isConnected = false;
    if (change === "foreign") Object.defineProperty(target, "ownerDocument", { configurable: true, value: {} });
    if (change === "disabled") target.setAttribute("disabled", "");
    if (change === "duplicate") {
      const other = f.control("synthetic-1").port;
      other.setAttribute("data-context-controls-id", "synthetic-0");
    }
    held.release();
    assert.equal(await pending, true, "a committed route does not imply an eligible focus target");
    assert.equal(returnCalls(f, start).length, 0);
    assert.equal(f.native.nativeScroll.some(row => row.node === target), false);
  });
});

test("source or authorization retirement during the original return update prevents focus and reveal", async t => {
  for (const change of ["source", "authorization"]) await t.test(change, async t => {
    const f = await libraryPage(t);
    await f.setSearch("synthetic");
    assert.equal(await f.go(f.editor()), true);
    const held = holdLibraryUpdate(t, f), start = f.native.nativeFocus.length;
    const pending = f.host.navigateFrom(f.library, { localRoute: f.root() });
    await held.entered;
    const target = f.control().port;
    if (change === "source") await f.retireSource();
    else f.store.session.set({ ...f.store.session.get(), permissionEpoch: "retired-during-return" });
    held.release();
    assert.equal(await pending, false, "the original arrival cannot claim a now-different Source/authority");
    assert.equal(returnCalls(f, start).length, 0);
    assert.equal(f.native.nativeScroll.some(row => row.node === target), false);
  });
});
