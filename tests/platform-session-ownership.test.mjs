import assert from "node:assert/strict";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Exercise the complete production singleton and its real one-shot bootstrap
// consumer. Only document and fetch/body delivery are finite ports. This is not
// a session endpoint, host rendering, browser, permission or provider certificate.
const sourceRoot = process.env.FORMA_SOURCE_ROOT
  ? pathToFileURL(resolve(process.env.FORMA_SOURCE_ROOT) + "/")
  : new URL("../", import.meta.url);
const moduleURL = new URL("src/platform/session-controller.ts", sourceRoot);
const sourceImports = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../state/session-bootstrap" &&
        context.parentURL && new URL(context.parentURL).pathname === moduleURL.pathname) {
      return nextResolve(new URL("../state/session-bootstrap.ts", context.parentURL).href, context);
    }
    return nextResolve(specifier, context);
  },
});
after(() => sourceImports.deregister());

const turn = () => new Promise((done) => setImmediate(done));
const selector = 'script#forma-session-bootstrap[type="application/json"]';
let serial = 0;
function session(audience, label = audience) {
  return {
    user: { userId: "fixture-user-" + label, email: label + "@example.invalid", displayName: label, role: "viewer" },
    audience, capabilities: [], permissionEpoch: "fixture-epoch-" + label,
    organizations: [],
  };
}
function assertRetired(observed) {
  assert.equal(observed.status, "rejected", "a retired caller must settle before its old transport completes");
  assert.equal(observed.error.name, "PlatformSessionRequestRetiredError");
  assert.equal(observed.error.message, "The workspace session changed before this request finished.");
}
async function fixture(t) {
  const saved = new Map(["document", "fetch", "__formaInitialSession"].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const requests = [], gates = [], loads = [], notices = [], unsubscriptions = [];
  let script = null;
  function gate(cleanupValue = () => undefined) {
    let resolvePromise, rejectPromise;
    const result = { settled: false, promise: new Promise((done, failed) => { resolvePromise = done; rejectPromise = failed; }) };
    result.resolve = (value) => { if (!result.settled) { result.settled = true; resolvePromise(value); } };
    result.reject = (error) => { if (!result.settled) { result.settled = true; rejectPromise(error); } };
    result.cleanup = () => result.resolve(cleanupValue());
    gates.push(result);
    return result;
  }
  const document = {
    querySelector(value) { assert.equal(value, selector); return script?.removed ? null : script; },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: document });
  delete globalThis.__formaInitialSession;
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value(input, init) {
    assert.equal(typeof input, "string");
    const url = new URL(input, "https://fixture.invalid");
    assert.equal(url.origin, "https://fixture.invalid");
    assert.equal(url.pathname, "/api/session");
    assert.deepEqual([...url.searchParams.keys()], ["audience"]);
    assert.deepEqual(init, { credentials: "same-origin" });
    const audience = url.searchParams.get("audience");
    assert.ok(["operations", "product", "knowledge"].includes(audience));
    const pending = gate(() => Response.json(session(audience, "cleanup")));
    const row = { input, init, audience, pending,
      respond(value = session(audience), status = 200) { pending.resolve(Response.json(value, { status })); },
      fail(error) { pending.reject(error); },
    };
    requests.push(row);
    return pending.promise;
  } });
  const url = new URL(moduleURL);
  url.searchParams.set("sessionOwnershipCase", String(++serial));
  const { platformSession: controller } = await import(url.href);
  unsubscriptions.push(controller.subscribe(() => notices.push(controller.get())));
  function load(audience) {
    const record = { status: "pending", value: undefined, error: undefined };
    record.done = controller.load(audience).then(
      (value) => { record.status = "fulfilled"; record.value = value; },
      (error) => { record.status = "rejected"; record.error = error; },
    );
    loads.push(record);
    return record;
  }
  function bootstrap(value, raw = false) {
    const node = { textContent: raw ? value : JSON.stringify(value), removed: false, removes: 0,
      remove() { this.removed = true; this.removes += 1; },
    };
    script = node;
    return node;
  }
  function prefetch() {
    const pending = gate(() => null);
    Object.defineProperty(globalThis, "__formaInitialSession", {
      configurable: true, writable: true, value: pending.promise,
    });
    return pending;
  }
  function heldBody(value) {
    const response = Response.json(value);
    const json = response.json.bind(response), pending = gate(), entered = gate();
    let calls = 0;
    response.json = async () => {
      calls += 1;
      entered.resolve();
      await pending.promise;
      return json();
    };
    return { response, pending, entered, get calls() { return calls; } };
  }
  function request(index, audience) {
    const row = requests[index];
    assert.ok(row, "expected actual fetch at index " + index);
    assert.equal(row.input, "/api/session?audience=" + audience);
    return row;
  }
  function listen(callback) {
    const stop = controller.subscribe(callback);
    unsubscriptions.push(stop);
    return stop;
  }
  t.after(async () => {
    try {
      for (const stop of unsubscriptions) stop();
      controller.reset();
      // Settle finite leftovers after a failing baseline assertion, so subsequent
      // cases cannot inherit a global fetch or an unresolved old caller.
      for (let pass = 0; pass < 8; pass += 1) {
        for (const pending of [...gates]) if (!pending.settled) pending.cleanup();
        await turn();
        if (loads.every((row) => row.status !== "pending") && gates.every((row) => row.settled)) break;
      }
      assert.ok(loads.every((row) => row.status !== "pending"), "finite cleanup must settle every observed caller");
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
  return { controller, load, requests, request, notices, bootstrap, prefetch, heldBody, listen };
}

test("same-audience pending callers coalesce, publish once, and reuse the cached object", async (t) => {
  const f = await fixture(t), a = f.load("operations"), b = f.load("operations");
  assert.equal(f.requests.length, 1);
  f.request(0, "operations").respond(session("operations", "current"));
  await Promise.all([a.done, b.done]);
  assert.equal(a.status, "fulfilled"); assert.equal(b.status, "fulfilled");
  assert.equal(a.value, b.value); assert.equal(f.controller.get(), a.value);
  assert.deepEqual(f.notices, [a.value]);
  const cached = f.load("operations"); await cached.done;
  assert.equal(cached.value, a.value); assert.equal(f.requests.length, 1); assert.equal(f.notices.length, 1);
});

for (const kind of ["http", "wrong-audience", "invalid-json", "transport"]) {
  test("current " + kind + " failure does not publish and permits a fresh same-audience read", async (t) => {
    const f = await fixture(t), first = f.load("operations"), row = f.request(0, "operations");
    if (kind === "http") row.respond({ error: "fixture access unavailable" }, 403);
    else if (kind === "wrong-audience") row.respond(session("knowledge", "wrong"));
    else if (kind === "invalid-json") row.pending.resolve(new Response("{", { headers: { "content-type": "application/json" } }));
    else row.fail(new Error("fixture transport failure"));
    await first.done;
    assert.equal(first.status, "rejected"); assert.notEqual(first.error.name, "PlatformSessionRequestRetiredError");
    assert.equal(f.controller.get(), null); assert.deepEqual(f.notices, []);
    const retry = f.load("operations");
    f.request(1, "operations").respond(session("operations", "recovered"));
    await retry.done;
    assert.equal(retry.status, "fulfilled"); assert.equal(f.controller.get(), retry.value);
    assert.deepEqual(f.notices, [retry.value]); assert.equal(f.requests.length, 2);
  });
}

test("reset promptly retires every coalesced fetch caller and late success cannot republish", async (t) => {
  const f = await fixture(t), first = f.load("operations"), joined = f.load("operations");
  const old = f.request(0, "operations");
  f.controller.reset(); await turn();
  assertRetired(first); assertRetired(joined); assert.equal(f.controller.get(), null); assert.deepEqual(f.notices, [null]);
  const fresh = f.load("operations");
  f.request(1, "operations").respond(session("operations", "fresh"));
  await fresh.done;
  old.respond(session("operations", "retired")); await turn();
  assert.equal(f.controller.get(), fresh.value); assert.deepEqual(f.notices, [null, fresh.value]);
});

test("reset during the original Response body read retires its caller before that body settles", async (t) => {
  const f = await fixture(t), body = f.heldBody(session("operations", "old-body")), first = f.load("operations");
  f.request(0, "operations").pending.resolve(body.response);
  await body.entered.promise; assert.equal(body.calls, 1);
  f.controller.reset(); await turn(); assertRetired(first); assert.equal(f.controller.get(), null);
  const fresh = f.load("operations");
  f.request(1, "operations").respond(session("operations", "fresh-body"));
  await fresh.done; body.pending.resolve(); await turn();
  assert.equal(f.controller.get(), fresh.value); assert.deepEqual(f.notices, [null, fresh.value]);
});

test("a different audience retires the pending caller and starts its own exact session request", async (t) => {
  const f = await fixture(t), a = f.load("operations"), b = f.load("product");
  await turn(); assertRetired(a); assert.equal(f.requests.length, 2);
  f.request(1, "product").respond(session("product", "current-b")); await b.done;
  f.request(0, "operations").respond(session("operations", "old-a")); await turn();
  assert.equal(b.status, "fulfilled"); assert.equal(f.controller.get(), b.value); assert.deepEqual(f.notices, [b.value]);
});

test("A to B to A cannot revive either retired request despite matching the final audience", async (t) => {
  const f = await fixture(t), a = f.load("operations"), b = f.load("product"), latest = f.load("operations");
  await turn(); assertRetired(a); assertRetired(b); assert.equal(f.requests.length, 3);
  f.request(0, "operations").respond(session("operations", "old-a"));
  f.request(1, "product").fail(new Error("old b transport")); await turn();
  assert.equal(f.controller.get(), null); assert.deepEqual(f.notices, []);
  f.request(2, "operations").respond(session("operations", "latest-a")); await latest.done;
  assert.equal(f.controller.get(), latest.value); assert.deepEqual(f.notices, [latest.value]);
});

for (const outcome of ["success", "failure"]) {
  test("old " + outcome + " finalization cannot clear a newer audience's coalesced request", async (t) => {
    const f = await fixture(t), a = f.load("operations"), b = f.load("product");
    if (outcome === "success") f.request(0, "operations").respond(session("operations", "stale"));
    else f.request(0, "operations").fail(new Error("late original failure"));
    await turn(); assertRetired(a); assert.equal(b.status, "pending");
    const joined = f.load("product");
    assert.equal(f.requests.length, 2, "a stale finally must not cause a duplicate newer fetch");
    f.request(1, "product").respond(session("product", "winner"));
    await Promise.all([b.done, joined.done]);
    assert.equal(b.status, "fulfilled"); assert.equal(joined.value, b.value);
    assert.equal(f.controller.get(), b.value); assert.deepEqual(f.notices, [b.value]);
  });
}

test("returning to cached A retires pending B instead of letting it overwrite that deliberate choice", async (t) => {
  const f = await fixture(t), a = f.load("operations");
  f.request(0, "operations").respond(session("operations", "cached-a")); await a.done;
  const b = f.load("product"), back = f.load("operations");
  await back.done; await turn(); assertRetired(b);
  assert.equal(back.value, a.value); assert.equal(f.requests.length, 2);
  f.request(1, "product").respond(session("product", "late-b")); await turn();
  assert.equal(f.controller.get(), a.value); assert.deepEqual(f.notices, [a.value]);
});

test("reset clears a completed cached session and the next same-audience caller reads anew", async (t) => {
  const f = await fixture(t), first = f.load("operations");
  f.request(0, "operations").respond(session("operations", "before-reset")); await first.done;
  f.controller.reset(); assert.equal(f.controller.get(), null);
  const fresh = f.load("operations"); f.request(1, "operations").respond(session("operations", "after-reset")); await fresh.done;
  assert.notEqual(fresh.value, first.value); assert.deepEqual(f.notices, [first.value, null, fresh.value]);
});

test("repeated reset never revives the old caller and still permits one fresh owner", async (t) => {
  const f = await fixture(t), first = f.load("operations");
  f.controller.reset(); f.controller.reset(); await turn(); assertRetired(first);
  const error = first.error, fresh = f.load("operations");
  f.request(0, "operations").fail(new Error("retired transport fault")); await turn();
  assert.equal(first.error, error); assert.equal(fresh.status, "pending");
  f.request(1, "operations").respond(session("operations", "after-resets")); await fresh.done;
  assert.equal(f.controller.get(), fresh.value); assert.deepEqual(f.notices, [null, null, fresh.value]);
});

test("the exact authenticated HTML bootstrap is consumed once and healthy callers share it", async (t) => {
  const f = await fixture(t), value = session("knowledge", "bootstrap"), script = f.bootstrap(value);
  const a = f.load("knowledge"), b = f.load("knowledge");
  await Promise.all([a.done, b.done]);
  assert.equal(a.status, "fulfilled"); assert.equal(b.value, a.value); assert.deepEqual(a.value, value);
  assert.equal(script.removes, 1); assert.equal(f.requests.length, 0); assert.deepEqual(f.notices, [a.value]);
});

test("reset before the bootstrap publication microtask retires that already-consumed value", async (t) => {
  const f = await fixture(t), script = f.bootstrap(session("knowledge", "retired-bootstrap"));
  const first = f.load("knowledge"); assert.equal(script.removes, 1);
  f.controller.reset(); await turn(); assertRetired(first);
  assert.equal(f.controller.get(), null); assert.deepEqual(f.notices, [null]);
  const fresh = f.load("knowledge"); f.request(0, "knowledge").respond(session("knowledge", "fresh")); await fresh.done;
  assert.equal(f.controller.get(), fresh.value); assert.deepEqual(f.notices, [null, fresh.value]);
});

test("reset discards unconsumed HTML and prefetch handles instead of adopting the prior session later", async (t) => {
  const f = await fixture(t), script = f.bootstrap(session("knowledge", "pre-reset")), prefetch = f.prefetch();
  f.controller.reset();
  assert.equal(script.removes, 1);
  assert.equal(Object.hasOwn(globalThis, "__formaInitialSession"), false);
  const fresh = f.load("knowledge");
  f.request(0, "knowledge").respond(session("knowledge", "post-reset")); await fresh.done;
  prefetch.resolve(Response.json(session("knowledge", "obsolete-prefetch"))); await turn();
  assert.equal(f.requests.length, 1); assert.equal(f.controller.get(), fresh.value);
  assert.deepEqual(f.notices, [null, fresh.value]);
});

for (const kind of ["wrong-audience", "malformed"]) {
  test(kind + " bootstrap is not admitted and the current exact fetch remains usable", async (t) => {
    const f = await fixture(t);
    if (kind === "wrong-audience") f.bootstrap(session("product", "wrong"));
    else f.bootstrap("{", true);
    const current = f.load("knowledge");
    f.request(0, "knowledge").respond(session("knowledge", "authorized")); await current.done;
    assert.equal(current.status, "fulfilled"); assert.equal(f.controller.get(), current.value);
    assert.deepEqual(f.notices, [current.value]); assert.equal(f.requests.length, 1);
  });
}

test("the real one-shot prefetch consumer supplies coalesced healthy callers without another fetch", async (t) => {
  const f = await fixture(t), prefetch = f.prefetch(), a = f.load("knowledge"), b = f.load("knowledge");
  assert.equal(Object.hasOwn(globalThis, "__formaInitialSession"), false); assert.equal(f.requests.length, 0);
  prefetch.resolve(Response.json(session("knowledge", "prefetched")));
  await Promise.all([a.done, b.done]);
  assert.equal(a.status, "fulfilled"); assert.equal(b.value, a.value);
  assert.equal(f.controller.get(), a.value); assert.equal(f.requests.length, 0); assert.deepEqual(f.notices, [a.value]);
});

test("reset while prefetch is pending prevents its late empty result from starting an old fallback fetch", async (t) => {
  const f = await fixture(t), prefetch = f.prefetch(), first = f.load("knowledge");
  assert.equal(f.requests.length, 0); f.controller.reset(); await turn(); assertRetired(first);
  const fresh = f.load("knowledge");
  f.request(0, "knowledge").respond(session("knowledge", "fresh")); await fresh.done;
  prefetch.resolve(null); await turn();
  assert.equal(f.requests.length, 1); assert.equal(f.controller.get(), fresh.value);
  assert.deepEqual(f.notices, [null, fresh.value]);
});

test("a retired prefetch failure is consumed without clearing the new audience's pending owner", async (t) => {
  const f = await fixture(t), prefetch = f.prefetch(), a = f.load("knowledge"), b = f.load("product");
  await turn(); assertRetired(a); f.request(0, "product");
  prefetch.reject(new Error("retired prefetch unavailable")); await turn();
  assert.equal(b.status, "pending");
  const joined = f.load("product"); assert.equal(f.requests.length, 1);
  f.request(0, "product").respond(session("product", "prefetch-successor"));
  await Promise.all([b.done, joined.done]);
  assert.equal(joined.value, b.value); assert.equal(f.controller.get(), b.value); assert.deepEqual(f.notices, [b.value]);
});

test("a subscriber reset during publication retires the still-pending caller and leaves no current session", async (t) => {
  const f = await fixture(t); let reset = false;
  f.listen(() => { if (!reset && f.controller.get()) { reset = true; f.controller.reset(); } });
  const first = f.load("operations");
  f.request(0, "operations").respond(session("operations", "withdrawn-on-notify")); await first.done;
  assertRetired(first); assert.equal(f.controller.get(), null); assert.equal(f.notices.length, 2);
  assert.equal(f.notices[0].audience, "operations"); assert.equal(f.notices[1], null);
  const fresh = f.load("operations"); f.request(1, "operations").respond(session("operations", "after-notify-reset")); await fresh.done;
  assert.equal(fresh.status, "fulfilled"); assert.equal(f.controller.get(), fresh.value);
});

test("a subscriber's new audience keeps its own pending record when the old publication finishes", async (t) => {
  const f = await fixture(t); let successor;
  f.listen(() => { if (!successor && f.controller.get()?.audience === "operations") successor = f.load("product"); });
  const first = f.load("operations");
  f.request(0, "operations").respond(session("operations", "before-switch")); await first.done;
  assertRetired(first); assert.ok(successor); assert.equal(successor.status, "pending");
  const joined = f.load("product"); assert.equal(f.requests.length, 2);
  f.request(1, "product").respond(session("product", "after-switch"));
  await Promise.all([successor.done, joined.done]);
  assert.equal(successor.status, "fulfilled"); assert.equal(joined.value, successor.value);
  assert.equal(f.controller.get(), successor.value);
  assert.deepEqual(f.notices.map((row) => row?.audience), ["operations", "product"]);
});
