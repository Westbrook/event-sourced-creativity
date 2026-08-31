// Complete current SpecialistAccess through the existing ownership fixture.
// Session, URL events, template controls and HTTP replies are finite ports.
// These cases do not mount PlatformShell or certify a browser, Worker grant,
// receipt, financial effect or actual authorization change.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const digest = value => createHash("sha256").update(value).digest("hex");
const base = new URL("../", import.meta.url);
const ts = (await import(new URL("node_modules/typescript/lib/typescript.js", base))).default;
const fixtureUrl = new URL("tests/specialist-access-ownership.test.mjs", base);
const source = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstLoop = tree.statements.find(ts.isForOfStatement); assert.ok(firstLoop);
const prefix = source.slice(0, firstLoop.getFullStart());
const virtual = new URL(fixtureUrl); virtual.search = "access-fragment-fixture-r1";
const exportNames = ["access", "submit", "refresh", "locked", "has", "writes", "defer", "response"];
const loader = registerHooks({ load(url, context, next) {
  return url === virtual.href ? { format: "module", source: prefix + "\nexport {" + exportNames.join(",") + "};", shortCircuit: true }
    : next(url, context);
} });
let shared; try { shared = await import(virtual.href); } finally { loader.deregister(); }
const { access, submit, refresh, locked, has, writes, defer, response } = shared;
console.log("ACCESS_FRAGMENT_PREFIX " + JSON.stringify({ source: digest(source), prefix: digest(prefix),
  applicationMethodsReplaced: false, originalTestBodiesChanged: false }));
const shellSource = fs.readFileSync(new URL("src/components/forma-platform-shell.ts", base), "utf8");
const skipHref = shellSource.match(/class="skip-link" href="([^"]+)"/u)?.[1];
assert.equal(skipHref, "#main-content");

function currentSelects(f) {
  f.draw();
  const native = f.renderer.ownNodes(f.host, "select");
  const semantic = f.nodes().filter(node => node.tag === "select");
  assert.equal(native.length, 2); assert.equal(semantic.length, 2);
  return native.map((node, index) => ({ node, semantic: semantic[index] }));
}
function selection(f) {
  const controls = currentSelects(f);
  return { userId: controls[0].node.value, capability: controls[1].node.value };
}
async function chooseCurrent(f, index, value) {
  const control = currentSelects(f)[index];
  assert.equal(control.semantic.disabled(), false, "Only an enabled current native select is edited");
  assert.equal(control.node.isConnected, true);
  assert.ok(control.semantic.children.some(child => typeof child !== "string" && child.tag === "option" && child.attributes.value === value),
    "The selected value is an actual rendered option");
  control.node.value = value;
  await f.renderer.handler(f.host, "select", node => node === control.node, "change")({ target: control.node, currentTarget: control.node });
  await f.flush();
}
async function selectNondefault(f) {
  const original = selection(f), person = f.currentUsers.find(user => user.user_id !== original.userId);
  assert.ok(person); await chooseCurrent(f, 0, person.user_id);
  const capability = currentSelects(f)[1].semantic.children
    .find(child => typeof child !== "string" && child.tag === "option" && child.attributes.value !== original.capability)?.attributes.value;
  assert.equal(typeof capability, "string"); await chooseCurrent(f, 1, capability);
  const selected = selection(f);
  assert.notDeepEqual(selected, original);
  assert.equal(selected.userId, person.user_id); assert.equal(selected.capability, capability);
  return selected;
}
async function currentGrant(f) {
  f.draw();
  const button = f.renderer.ownNodes(f.host, "button").find(node => node.attributes.type === "submit");
  assert.ok(button?.isConnected); assert.equal(button.attributes.disabled, undefined);
  await submit(f)({ submitter: button }); await f.flush();
}
async function finiteSkip(f) {
  const before = { ...f.location };
  const url = new URL(skipHref, "https://fixture.invalid" + before.pathname + before.search + before.hash);
  assert.equal(url.pathname, before.pathname); assert.equal(url.search, before.search);
  // Existing fixture owns the location object and dispatches its current
  // popstate listeners through navigate(). Supply the native split URL fields,
  // never put '#main-content' into pathname or invoke an application method.
  f.location.hash = url.hash;
  f.navigate(url.pathname);
  for (const callback of f.listeners.get("hashchange") ?? []) callback({ type: "hashchange" });
  await f.flush();
  assert.equal(f.location.pathname, before.pathname); assert.equal(f.location.search, before.search);
  assert.equal(f.location.hash, "#main-content");
}

for (const locale of ["en", "ja"]) for (const posture of ["raw", "unknown"]) for (const navigation of ["none", "skip"])
  test("Access current-resource fragment continuity " + JSON.stringify({ locale, posture, navigation }),
    { concurrency: false, timeout: 30000 }, async t => {
      const f = await access(t, locale, { transport: (call, _f, next) => {
        if (call.method === "POST") {
          assert.equal(call.url, "/api/platform/access");
          // Intentionally unknown finite transport; no server grant/receipt
          // is simulated and no real request or permission change occurs.
          throw new Error("Finite original grant acknowledgement unavailable");
        }
        assert.equal(call.method, "GET"); return next(call);
      } });
      const host = f.host, session = f.currentSession, originalRows = structuredClone(f.currentGrants);
      const originalUsers = structuredClone(f.currentUsers), originalEvents = structuredClone(f.state.events);
      const originalRequests = structuredClone(f.state.requests);
      const selected = await selectNondefault(f);
      if (posture === "unknown") {
        await currentGrant(f);
        assert.equal(writes(f).length, 1);
        assert.deepEqual(writes(f)[0], { url: "/api/platform/access", method: "POST", body: selected });
        assert.ok(has(f, "access.changeUnknown")); assert.ok(has(f, "access.unknownReadOnly")); assert.ok(locked(f));
        await refresh(f); // Existing healthy control: list absence/presence is not an unused-write receipt.
        assert.equal(writes(f).length, 1); assert.ok(has(f, "access.changeUnknown")); assert.ok(locked(f));
      }
      const requestCount = f.calls.length, originalWrites = structuredClone(writes(f));
      if (navigation === "skip") await finiteSkip(f); else await f.flush();
      const observed = { locale, posture, navigation, sameHost: f.host === host, connected: f.host.isConnected,
        sameSession: f.currentSession === session, route: { ...f.location }, selected: selection(f),
        unknownVisible: has(f, "access.changeUnknown"), unknownGuidanceVisible: has(f, "access.unknownReadOnly"),
        locked: locked(f), additionalReads: f.calls.slice(requestCount).filter(call => call.method === "GET").length,
        originalWrites: writes(f), currentRowsUnchanged: JSON.stringify(f.currentGrants) === JSON.stringify(originalRows) };
      console.log("ACCESS_FRAGMENT_OBSERVATION " + JSON.stringify(observed));
      assert.equal(observed.sameHost && observed.connected && observed.sameSession, true);
      assert.deepEqual(writes(f), originalWrites, "No automatic retry, second grant or revoke occurs");
      assert.deepEqual(f.currentGrants, originalRows); assert.deepEqual(f.currentUsers, originalUsers);
      assert.deepEqual(f.state.events, originalEvents); assert.deepEqual(f.state.requests, originalRequests);
      assert.ok(f.calls.every(call => (call.method === "GET" && ["/api/admin/users", "/api/platform/access"].includes(call.url))
        || (call.method === "POST" && call.url === "/api/platform/access")));
      assert.equal(f.unexpected.length, posture === "unknown" ? 1 : 0, "Only the named finite transport loss is induced");
      // All observations are recorded before the desired continuity assertion.
      // Do not dispatch a second current Grant merely to demonstrate exposure.
      assert.deepEqual({ selected: observed.selected, unknown: observed.unknownVisible, guidance: observed.unknownGuidanceVisible,
        locked: observed.locked, additionalReads: observed.additionalReads },
        { selected, unknown: posture === "unknown", guidance: posture === "unknown", locked: posture === "unknown", additionalReads: 0 },
        "Same-resource Skip preserves current selection and original-unknown read-only posture without reopening the owner");
    });

for (const locale of ["en", "ja"]) for (const navigation of ["none", "skip", "query", "path"])
  test("Access pending original keeps only its current resource " + JSON.stringify({ locale, navigation }),
    { concurrency: false, timeout: 30000 }, async t => {
      const acknowledgement = defer();
      const f = await access(t, locale, { transport: (call, _f, next) => {
        if (call.method === "POST") {
          assert.equal(call.url, "/api/platform/access");
          return acknowledgement.promise;
        }
        assert.equal(call.method, "GET"); return next(call);
      } });
      const host = f.host, session = f.currentSession;
      const rows = structuredClone(f.currentGrants), people = structuredClone(f.currentUsers);
      const events = structuredClone(f.state.events), requests = structuredClone(f.state.requests);
      const selected = await selectNondefault(f);
      const original = currentGrant(f);
      const finish = () => acknowledgement.resolve(response({ ok: true, grantId: "finite-original-A" }, 201));
      try {
        await f.flush();
        assert.deepEqual(writes(f), [{ url: "/api/platform/access", method: "POST", body: selected }]);
        assert.ok(has(f, "access.grantPending")); assert.ok(locked(f));
        const before = f.calls.length;
        if (navigation === "skip") await finiteSkip(f);
        else if (navigation === "query") {
          f.location.search = "?review=recent"; f.navigate("/operations/access"); await f.flush();
        } else if (navigation === "path") {
          f.navigate("/operations/providers"); await f.flush();
        } else await f.flush();
        const sameResource = navigation === "none" || navigation === "skip";
        const pendingObserved = { locale, navigation, route: { ...f.location },
          sameHost: f.host === host && f.host.isConnected, sameSession: f.currentSession === session,
          pendingVisible: has(f, "access.grantPending"), acknowledgedVisible: has(f, "access.grantAcknowledged"),
          formCount: f.renderer.ownNodes(f.host, "form").length, locked: locked(f),
          selection: navigation === "path" ? null : selection(f),
          readsSinceNavigation: f.calls.slice(before).filter(call => call.method === "GET").length };
        console.log("ACCESS_FRAGMENT_PENDING_OBSERVATION " + JSON.stringify(pendingObserved));
        assert.equal(pendingObserved.sameHost && pendingObserved.sameSession, true);
        assert.equal(pendingObserved.acknowledgedVisible, false);
        assert.equal(writes(f).length, 1, "Focus or resource departure must never resend A");
        if (sameResource) {
          assert.equal(pendingObserved.pendingVisible, true); assert.equal(pendingObserved.locked, true);
          assert.deepEqual(pendingObserved.selection, selected);
          assert.equal(pendingObserved.readsSinceNavigation, 0);
        } else {
          assert.equal(pendingObserved.pendingVisible, false, "A real departure retires the old presentation owner");
          assert.equal(pendingObserved.readsSinceNavigation, navigation === "query" ? 2 : 0);
          if (navigation === "query") assert.notDeepEqual(pendingObserved.selection, selected);
          else { assert.equal(pendingObserved.formCount, 0); assert.ok(has(f, "access.unavailable")); }
        }
        const afterBoundary = f.calls.length;
        // This is the existing fixture's exact finite positive HTTP shape.
        // No server grant/receipt or changed supplied grant list is synthesized.
        finish(); await original; await f.flush();
        const completion = { locale, navigation, sameResource, route: { ...f.location },
          acknowledgedVisible: has(f, "access.grantAcknowledged"), pendingVisible: has(f, "access.grantPending"),
          unknownVisible: has(f, "access.changeUnknown"),
          readsFromCompletion: f.calls.slice(afterBoundary).filter(call => call.method === "GET").length,
          writes: writes(f) };
        console.log("ACCESS_FRAGMENT_COMPLETION_OBSERVATION " + JSON.stringify(completion));
        assert.equal(completion.pendingVisible, false); assert.equal(completion.unknownVisible, false);
        if (sameResource) {
          assert.equal(completion.acknowledgedVisible, true); assert.equal(completion.readsFromCompletion, 2);
          assert.deepEqual(selection(f), selected); assert.equal(locked(f), false);
        } else {
          assert.equal(completion.acknowledgedVisible, false); assert.equal(f.calls.length, afterBoundary,
            "An old successful response cannot refresh or acknowledge a new resource owner");
          if (navigation === "path") {
            f.navigate("/operations/access"); await f.flush();
            assert.notDeepEqual(selection(f), selected);
            assert.equal(has(f, "access.grantAcknowledged"), false);
            assert.equal(f.calls.length, afterBoundary + 2, "Only explicit current reentry loads the current list");
          }
        }
        assert.deepEqual(writes(f), [{ url: "/api/platform/access", method: "POST", body: selected }]);
        assert.deepEqual(f.currentGrants, rows); assert.deepEqual(f.currentUsers, people);
        assert.deepEqual(f.state.events, events); assert.deepEqual(f.state.requests, requests);
        assert.deepEqual(f.unexpected, []);
        assert.ok(f.calls.every(call => (call.method === "GET" && ["/api/admin/users", "/api/platform/access"].includes(call.url))
          || (call.method === "POST" && call.url === "/api/platform/access")));
      } finally {
        finish(); await original; await f.flush();
      }
    });
