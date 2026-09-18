import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { experienceResultGrantCurrent } from "../src/experiences/output-binding-client.ts";

const source = readFileSync(new URL("../src/components/forma-experience-host.ts", import.meta.url), "utf8");
const begin = source.indexOf("  #scheduleDeadline() {"), end = source.indexOf("  #imageReady(", begin);
assert.ok(begin >= 0 && end > begin, "actual host deadline method must be found");
const method = stripTypeScriptTypes(source.slice(begin, end)
  .replace("#scheduleDeadline()", "function scheduleDeadline()").replaceAll("this.#", "this."));

// Executes the actual host method with a deterministic clock and stubbed UI
// callbacks. This is a timer/policy control, not browser or admission evidence.
function harness(output, { privateFirst = false, longRetention = false } = {}) {
  const start = Date.parse("2026-09-13T00:00:00.000Z");
  let now = start, nextId = 0;
  const timers = new Map();
  const jobDeadline = start + (longRetention ? 30 * 86_400_000 : 60_000);
  const privateDeadline = privateFirst ? start + 40_000 : jobDeadline;
  const spendingDeadline = start + 10_000;
  const iso = value => new Date(value).toISOString();
  const state = {
    output, status: "succeeded", disposition: "original_run_recorded",
    original: { run: { key: "original-run", eventId: "original-run-event" }, jobStatus: "completed",
      slotStatus: "succeeded", grantStatus: "completed", expiresAt: iso(spendingDeadline), jobExpiresAt: iso(jobDeadline) },
    grant: { status: "completed", expiresAt: iso(spendingDeadline) },
    permitted: { prepare: false, authorize: false, run: false, resumeRun: false, recoverResult: false },
    ...(output === "scene" ? { sceneCostPreview: { expiresAt: iso(start + 5_000) } } : {}),
  };
  const setTimer = (callback, delay) => {
    assert.ok(Number.isFinite(delay) && delay >= 0 && delay <= 2147483647);
    const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id;
  };
  const schedule = new Function("Date", "setTimeout", "clearTimeout", method + "; return scheduleDeadline;")(
    { parse: Date.parse, now: () => now }, setTimer, id => timers.delete(id));
  const context = {
    deadline: undefined, resets: 0, clears: 0, updates: 0,
    state: () => state,
    result: { output, candidate: { expiresAt: iso(output === "scene" ? privateDeadline : jobDeadline) },
      ...(output === "slides" ? { slides: { expiresAt: iso(privateDeadline) } } : {}),
      ...(output === "short_story" ? { story: { expiresAt: iso(privateDeadline) } } : {}),
      current: () => experienceResultGrantCurrent(state, now) && now < jobDeadline && now < privateDeadline },
    resetDecision() { this.resets++; },
    clearResult() { this.clears++; this.result = undefined; },
    requestUpdate() { this.updates++; },
    scheduleDeadline: schedule,
  };
  function advance(to) {
    let iterations = 0;
    for (;;) {
      const due = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > to) break;
      assert.ok(++iterations < 20, "deadline callback must not loop at an expired deadline");
      now = due[1].at; timers.delete(due[0]); due[1].callback();
    }
    now = to;
  }
  context.scheduleDeadline();
  return { context, state, advance, start, jobDeadline, privateDeadline, spendingDeadline, timers };
}

for (const output of ["image", "slides", "short_story", "scene"]) {
  for (const privateFirst of output === "image" ? [false] : [false, true]) {
    test("actual " + output + " host timer survives spending expiry and clears at " + (privateFirst ? "private" : "job") + " expiry", () => {
      const h = harness(output, { privateFirst }), originalResult = h.context.result;
      h.advance(h.spendingDeadline);
      assert.equal(h.context.result, originalResult);
      assert.equal(h.context.clears, 0);
      assert.ok(h.context.resets >= 1);
      assert.deepEqual(h.state.permitted, { prepare: false, authorize: false, run: false, resumeRun: false, recoverResult: false });
      assert.equal(h.timers.size, 1, "next retention deadline remains armed after spending expiry");
      assert.equal([...h.timers.values()][0].at, h.privateDeadline);
      h.advance(h.privateDeadline - 1);
      assert.equal(h.context.result, originalResult);
      h.advance(h.privateDeadline);
      assert.equal(h.context.result, undefined);
      assert.equal(h.context.clears, 1);
      assert.equal(h.timers.size, 0);
      h.advance(h.jobDeadline + 1);
      assert.equal(h.context.clears, 1);
    });
  }
}

test("actual host timer rearms across the browser timeout limit through a thirty-day result lifetime", () => {
  const h = harness("image", { longRetention: true });
  h.advance(h.spendingDeadline);
  const intermediate = [...h.timers.values()][0].at;
  assert.equal(intermediate, h.spendingDeadline + 2147483647);
  h.advance(intermediate);
  assert.ok(h.context.result);
  assert.equal([...h.timers.values()][0].at, h.jobDeadline);
  h.advance(h.jobDeadline);
  assert.equal(h.context.result, undefined);
  assert.equal(h.context.clears, 1);
  assert.equal(h.timers.size, 0);
});

