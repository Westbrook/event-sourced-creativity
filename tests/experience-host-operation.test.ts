import assert from "node:assert/strict";
import test from "node:test";
import { ExperienceHostOperation } from "../src/experiences/host-operation.ts";

// Pure operation-lifetime evidence. No native reader, host, Store or provider executes.
test("operation deadline rejects a never-finishing read and calls onTimeout once", { timeout: 1000 }, async () => {
  let callbacks = 0;
  const operation = new ExperienceHostOperation(() => { callbacks++; }, 10);
  assert.equal(operation.current(), true);
  await assert.rejects(operation.wait(new Promise<never>(() => {})), /operation_unconfirmed/u);
  assert.equal(operation.current(), false); assert.equal(callbacks, 1);
  operation.cancel(); operation.finish();
  await assert.rejects(operation.wait(Promise.resolve("late")), /operation_withdrawn/u);
  assert.equal(callbacks, 1);
});

test("explicit operation cancellation rejects immediately without a timeout callback", { timeout: 1000 }, async () => {
  let callbacks = 0;
  const operation = new ExperienceHostOperation(() => { callbacks++; }, 30000);
  const waiting = operation.wait(new Promise<never>(() => {}));
  operation.cancel();
  await assert.rejects(waiting, /operation_withdrawn/u);
  assert.equal(operation.current(), false); assert.equal(callbacks, 0);
  operation.cancel(); operation.finish();
  assert.equal(callbacks, 0);
});

test("finishing after a settled read suppresses timeout and rejects future waits", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let callbacks = 0;
  const operation = new ExperienceHostOperation(() => { callbacks++; }, 10);
  assert.equal(await operation.wait(Promise.resolve("verified")), "verified");
  operation.finish();
  assert.equal(operation.current(), false);
  context.mock.timers.tick(30000);
  assert.equal(callbacks, 0);
  await assert.rejects(operation.wait(Promise.resolve("later")), /operation_withdrawn/u);
});

test("a late underlying resolution cannot revive a timed-out operation lease", { timeout: 1000 }, async () => {
  let resolveWork!: (value: string) => void, callbacks = 0;
  const work = new Promise<string>(resolve => { resolveWork = resolve; });
  const operation = new ExperienceHostOperation(() => { callbacks++; }, 10);
  let published = false;
  const waiting = operation.wait(work).then(value => { published = operation.current(); return value; });
  await assert.rejects(waiting, /operation_unconfirmed/u);
  resolveWork("late output");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(operation.current(), false); assert.equal(published, false); assert.equal(callbacks, 1);
});

test("invalid or oversized timeout seams use the thirty-second cap", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const timeoutMs of [30001, 1000000, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    let callbacks = 0;
    const operation = new ExperienceHostOperation(() => { callbacks++; }, timeoutMs);
    const rejected = assert.rejects(operation.wait(new Promise<never>(() => {})), /operation_unconfirmed/u);
    context.mock.timers.tick(29999);
    assert.equal(operation.current(), true, String(timeoutMs)); assert.equal(callbacks, 0);
    context.mock.timers.tick(1); await rejected;
    assert.equal(operation.current(), false, String(timeoutMs)); assert.equal(callbacks, 1);
    context.mock.timers.tick(30000); assert.equal(callbacks, 1);
  }
});

test("inactive waits observe supplied work rejection without reviving their lease", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const stop of ["finish", "cancel", "deadline"] as const) {
    const operation = new ExperienceHostOperation(() => {}, 10);
    if (stop === "deadline") context.mock.timers.tick(10); else operation[stop]();
    let rejectWork!: (reason: Error) => void, observed = 0;
    const work = new Promise<never>((_, reject) => { rejectWork = reject; });
    const then = work.then.bind(work);
    Object.defineProperty(work, "then", { value: (...args: Parameters<typeof work.then>) => { observed++; return then(...args); } });
    const waiting = operation.wait(work);
    await assert.rejects(waiting, /operation_withdrawn/u);
    // Assert attachment before rejecting so a broken implementation fails this
    // assertion without producing an unrelated runner-level unhandled rejection.
    assert.ok(observed > 0, `${stop}: abandoned work must still be observed`);
    rejectWork(new Error("late underlying rejection"));
    await Promise.resolve();
    await assert.rejects(operation.wait(Promise.reject(new Error("already rejected"))), /operation_withdrawn/u);
    await Promise.resolve();
    assert.equal(operation.current(), false);
  }
});
