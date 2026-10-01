import assert from "node:assert/strict";
import test from "node:test";
import { captureVideoCustodySnapshot } from "../worker/video-custody-snapshot.ts";

test("custody graph retains all fields and detects mutation or replacement without serialization", () => {
  const event = { payload: { text: "original", missing: undefined }, sequence: 1 };
  const events = [event], root = { events, scope: { owner: "one" } };
  const unchanged = captureVideoCustodySnapshot(root);
  assert.equal(unchanged({ ...root }), true);
  event.payload.text = "changed"; assert.equal(unchanged(root), false);
  event.payload.text = "original"; assert.equal(unchanged(root), true);
  events.push({ ...event }); assert.equal(unchanged(root), false);
  events.pop(); assert.equal(unchanged(root), true);
  assert.equal(unchanged({ ...root, events: [...events] }), false);
  Object.defineProperty(event.payload, "text", { enumerable: false });
  assert.equal(unchanged(root), false);
  Object.defineProperty(event.payload, "text", { enumerable: true });
  Object.defineProperty(event.payload, "text", { enumerable: true, get() { assert.fail("getter must not run"); } });
  assert.equal(unchanged(root), false);
});

test("custody capture refuses exotic data and accessors without executing them", () => {
  const root = { get privateText(): never { return assert.fail("getter must not run"); } };
  assert.throws(() => captureVideoCustodySnapshot(root), /snapshot_unavailable/);
  assert.throws(() => captureVideoCustodySnapshot({ value: new Date() }), /snapshot_unavailable/);
  const values = Array(2), unchanged = captureVideoCustodySnapshot({ values });
  values.length = 3; assert.equal(unchanged({ values }), false);
  const hidden = ["first"];
  Object.defineProperty(hidden, "0", { enumerable: false, value: "first", configurable: true, writable: true });
  const same = captureVideoCustodySnapshot({ hidden });
  hidden[0] = "second"; assert.equal(same({ hidden }), false);
  Object.defineProperty(hidden, "0", { get() { assert.fail("hidden getter must not run"); } });
  assert.throws(() => captureVideoCustodySnapshot({ hidden }), /snapshot_unavailable/);
});

test("large history witness reuses payload strings and notices a late-history edit", () => {
  // About48MiB of private payloads. No production content or provider calls.
  const events = Array.from({ length: 768 }, (_, i) => {
    const bytes = Buffer.alloc(65_536, 120); bytes.write(String(i));
    return { sequence: i + 1, payload: { text: bytes.toString("utf8") } };
  });
  const root = { events }, unchanged = captureVideoCustodySnapshot(root);
  assert.equal(unchanged({ events }), true);
  events[767]!.payload.text += "changed";
  assert.equal(unchanged({ events }), false);
});

test("witness binds prototype, cycles, framing and every UTF-16 code unit", () => {
  for (const item of [[], {}]) {
    const same = captureVideoCustodySnapshot({ item });
    Object.setPrototypeOf(item, Array.isArray(item) ? Object.prototype : Array.prototype);
    assert.equal(same({ item }), false);
  }
  const cycle: { self?: unknown; text: string } = { text: "x".repeat(8191) + "\ud83d\ude00\ud800" };
  cycle.self = cycle;
  const same = captureVideoCustodySnapshot({ cycle });
  assert.equal(same({ cycle }), true);
  cycle.text = cycle.text.slice(0, -1) + "\ud801";
  assert.equal(same({ cycle }), false);
  for (const [before, after] of [["k1:ae", "k1:ah"], [0, -0], [undefined, "undefined"], [NaN, "NaN"]]) {
    const child = { value: before }, unchanged = captureVideoCustodySnapshot({ child });
    child.value = after; assert.equal(unchanged({ child }), false);
  }
});
