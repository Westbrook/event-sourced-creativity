import assert from "node:assert/strict";
import test from "node:test";

test("actual field metrics omit selected-link secrets and share IDs and never send recipient telemetry", async t => {
  const token = "SECRET_" + "x".repeat(25), shareId = "private-share-id", cursor = "private-cursor", callbacks = new Map();
  const events = [], logs = [], dataset = {}, path = "/share/output/" + token;
  const location = new URL("https://forma.invalid" + path);
  const main = { querySelectorAll: () => [1, 2, 3], querySelector: () => null };
  const values = {
    location,
    window: { dispatchEvent(event) { events.push(event); } },
    document: { documentElement: { dataset }, querySelector(selector) {
      return selector === "#main-content" || selector === "forma-selected-output-shared-view #main-content" ? main : null;
    } },
    requestAnimationFrame(callback) { callback(); return 1; },
    PerformanceObserver: class {
      constructor(callback) { this.callback = callback; }
      observe({ type }) { callbacks.set(type, this.callback); }
    },
  };
  for (const [key, value] of Object.entries(values)) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => prior ? Object.defineProperty(globalThis, key, prior) : delete globalThis[key]);
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("recipient telemetry must not be sent"); });
  t.mock.method(console, "info", (...args) => logs.push(args));
  const metrics = await import("../src/performance.ts?selected-output-share-redaction");
  metrics.beginRoutePopulation(path);
  const names = ["/api/selected-output-shared/" + token, "/api/selected-output-shares/" + shareId,
    "/api/selected-output-shares?documentId=PRIVATE_DOCUMENT&artifactId=PRIVATE_ARTIFACT&cursor=" + cursor,
    "/api/selected-output-shares/availability", "/api/selected-output-shares/prepare", "/api/selected-output-shares/commit"];
  callbacks.get("resource")({ getEntries: () => names.map((name, i) => ({ name: location.origin + name,
    startTime: i + 1, duration: 2, transferSize: 8, decodedBodySize: 6, serverTiming: [] })) });
  assert.equal(dataset.formaApiRequests, "6");
  assert.equal(dataset.formaApiPaths, "/api/selected-output-shared/:token,/api/selected-output-shares/:share,/api/selected-output-shares,/api/selected-output-shares/availability,/api/selected-output-shares/prepare,/api/selected-output-shares/commit");
  metrics.completeRoutePopulation(path);
  assert.equal(events.length, 1); assert.equal(logs.length, 1);
  assert.equal(events[0].detail.routeFamily, "share"); assert.equal(events[0].detail.routeSurface, "shared-output");
  const exposed = JSON.stringify({ dataset, events: events.map(event => event.detail), logs });
  for (const secret of [token, shareId, cursor, "PRIVATE_DOCUMENT", "PRIVATE_ARTIFACT"]) assert.equal(exposed.includes(secret), false, secret);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
