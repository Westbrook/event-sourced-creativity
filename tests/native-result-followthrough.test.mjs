import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// Execute the donor host's command -> timer -> check -> image-read methods.
// This is deterministic controller evidence, not trusted-click or browser evidence.
const source = readFileSync(process.env.FORMA_HOST_SOURCE ?? new URL("../src/components/forma-experience-host.ts", import.meta.url), "utf8");
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const methods = [
  section("  #beginOperation()", "  #resetDecision()"),
  section("  async #command(", "  #snapshotMatches("),
  section("  async #check()", "  #scheduleDeadline()"),
  section("  #visibility =", "  #pagehide ="),
  section("  #retire()", "  #baseCurrent("),
  section("  #preserveFocus()", "  protected override willUpdate()"),
].join("\n").replaceAll(/#([A-Za-z]\w*)/g, "$1");
const compiled = stripTypeScriptTypes("class Host {\n" + methods + "\n}") + "\nreturn Host;";
const operations = readFileSync(new URL("../src/experiences/host-operation.ts", import.meta.url), "utf8");
const operationCompiled = stripTypeScriptTypes(operations.replace("export class ", "class ")) + "\nreturn ExperienceHostOperation;";
const focusSource = readFileSync(new URL("../src/components/output-navigation-focus.ts", import.meta.url), "utf8");
const focusStart = focusSource.indexOf("export function captureOutputNavigationFocus("), focusEnd = focusSource.indexOf("/** Only the actual", focusStart);
const captureFocus = new Function(stripTypeScriptTypes(focusSource.slice(focusStart, focusEnd).replace("export function ", "function ")) + ";return captureOutputNavigationFocus;")();
class FocusElement {
  constructor(host) { this.host = host; this.isConnected = true; this.scrolls = []; this.dataset = {}; }
  closest(selector) { return selector.startsWith("form[") ? null : this.host; }
  contains(node) { return node === this; }
  getBoundingClientRect() { return { left: 50, top: -500, right: 300, bottom: -460, width: 250, height: 40 }; }
  scrollIntoView(options) { this.scrolls.push(options); }
  focus() { assert.fail("visibility continuation must not focus"); }
}
class FocusButton extends FocusElement {}
class FocusInput extends FocusElement {}
function harness({ responseStatus = "queued", states = ["running", "succeeded"], failRead = false, unknown = false, expiry = 60000 } = {}) {
  let now = 0, id = 0, focused = "user-selected-control";
  const timers = new Map(), retiredTimers = [];
  const clock = { now: () => now, parse: Date.parse };
  const setTimer = (callback, delay) => { const key = ++id; timers.set(key, { callback, at: now + delay }); return key; };
  const clearTimer = key => { const entry = timers.get(key); if (entry) retiredTimers.push(entry.callback); timers.delete(key); };
  const Operation = new Function("setTimeout", "clearTimeout", operationCompiled)(setTimer, clearTimer);
  const Host = new Function("setTimeout", "clearTimeout", "Date", "ExperienceHostOperation", "bindingJson",
    "experienceResultGrantCurrent", "captureOutputNavigationFocus", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", compiled)(setTimer, clearTimer, clock, Operation, JSON.stringify, () => true, captureFocus, FocusElement, FocusButton, FocusInput);
  const host = new Host();
  const iso = value => new Date(value).toISOString();
  const makeState = status => ({ draftId: "draft", output: "image", documentId: "document", projectId: "project", status,
    disposition: "original_run_recorded", permitted: {}, original: { run: { key: "run", eventId: "run-event" },
      jobId: "job", slotId: "slot", grantId: "grant", expiresAt: iso(expiry), jobStatus: status === "succeeded" ? "completed" : status, jobExpiresAt: iso(expiry) } });
  let state = makeState("authorized"), reads = 0, images = 0, posts = 0, inspections = 0, wakes = 0;
  const candidate = { output: "image", outputId: "output", documentId: "document", projectId: "project", generationId: "generation",
    eventId: "event", contentRef: "content", mediaUrl: "/image.png", expiresAt: iso(expiry) };
  const image = { status: "current", revision: 0, editEventId: null, ownerId: "owner", projectId: "project", documentId: "document",
    outputId: "output", generationId: "generation", sourceEventId: "event", contentRef: "content",
    media: { url: "/image.png", mediaType: "image/png", width: 100, height: 100 } };
  const gates = { session: true, source: true, route: true, connected: true, visible: true, current: true };
  const binding = { ownerId: "owner", client: {
    dispose() { gates.current = false; },
    async command(action) { posts++; assert.ok(["run", "resumeRun", "recoverResult", "prepare", "authorize"].includes(action));
      return unknown ? { status: "unavailable" } : { ...makeState(responseStatus), ...(action === "recoverResult" ? { recovery: responseStatus === "succeeded" ? "completed" : "pending" } : {}) }; },
  } };
  Object.assign(host, {
    binding, busy: false, loading: false, refreshing: false, retired: false, epoch: 0, navigationEpoch: 0,
    sourceLifetime: { retire() {} }, ownerDocument: { visibilityState: "visible" },
    i18n: { system: text => text }, requestUpdate() {},
    state: () => state, baseCurrent: () => !host.retired && Object.values(gates).every(Boolean),
    visible: value => value === binding && host.baseCurrent() && host.ownerDocument.visibilityState !== "hidden",
    readable: value => host.visible(value), resetDecision() {},
    clearResult() { host.result = undefined; },
    async refreshAndRead() { reads++; if (failRead && reads > 1) throw Error("read-failed");
      state = makeState(reads === 1 ? responseStatus : states.shift() ?? "succeeded"); host.status = host.statusLabel(state); },
    snapshotMatches: () => gates.current, candidate: () => candidate,
    imageFormat: () => ({ dimensions: { width: 100, height: 100 } }),
    statusLabel: value => value.status, scheduleDeadline() {},
    store: {
      syncDocumentJobs: async options => { assert.deepEqual(options, { freshAfterActive: true }); wakes++; },
      outputRequirements: { ensure: async () => {} },
      inspectOutputNativeJob: async (doc, job, current) => {
        assert.equal(doc, "document"); assert.equal(job, "job"); inspections++;
        return { status: "found", job: { status: state.original.jobStatus }, current };
      },
      loadGeneratedImageEdit: async (output, { current }) => { assert.equal(output, "output"); assert.equal(current(), true); images++; return image; },
    },
  });
  binding.store = host.store;
  // Any attempted programmatic focus/navigation is a test failure.
  host.focus = host.navigate = () => { focused = "stolen"; throw Error("Unexpected focus or navigation"); };
  async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
  async function nextTimer() {
    const next = [...timers.entries()].sort((a,b) => a[1].at - b[1].at)[0];
    assert.ok(next, "expected a read timer"); now = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
  }
  return { host, gates, binding, timers, retiredTimers, nextTimer, settle,
    start: action => host.command(action, state),
    setNow: value => { now = value; }, setState: value => { state = value; }, makeState,
    counts: () => ({ reads, images, posts, inspections }), wakes: () => wakes, focus: () => focused };
}
for (const action of ["run", "resumeRun"]) test(action + " follows queued -> running -> completed and displays original image without another command", async () => {
  const h = harness();
  await h.start(action);
  assert.deepEqual(h.counts(), { reads: 1, images: 0, posts: 1, inspections: 0 });
  assert.equal(h.timers.size, 1);
  await h.nextTimer();
  assert.equal(h.host.status, "running"); assert.equal(h.timers.size, 1);
  await h.nextTimer();
  assert.equal(h.host.status, "1 image"); assert.equal(h.host.result.output, "image");
  assert.deepEqual(h.counts(), { reads: 3, images: 1, posts: 1, inspections: 1 });
  assert.equal(h.timers.size, 0); assert.equal(h.focus(), "user-selected-control");
});

for (const action of ["run", "resumeRun"]) for (const status of ["queued", "running"]) test(action + " " + status + " immediately wakes the existing scoped job read/driver once", async () => {
  const h=harness({responseStatus:status});await h.start(action);assert.equal(h.wakes(),1);
  await h.nextTimer();assert.equal(h.wakes(),1,"passive result checks never repeat the wake");assert.equal(h.counts().posts,1);
});
for (const action of ["prepare", "authorize", "recoverResult"]) test(action + " never wakes generation", async () => {
  const h=harness();await h.start(action);assert.equal(h.wakes(),0);
});
for (const status of ["succeeded", "failed", "cancelled", "uncertain", "unavailable", "authorized"]) test("non-pending " + status + " never wakes generation", async () => {
  const h=harness({responseStatus:status});await h.start("run");assert.equal(h.wakes(),0);
});
test("unknown command response never wakes generation",async()=>{const h=harness({unknown:true});await h.start("run");assert.equal(h.wakes(),0);});
for (const field of ["jobId","slotId","grantId","run","jobStatus","expiresAt","jobExpiresAt"]) test("changed post-read original "+field+" cannot wake a driver",async()=>{
  const h=harness(),read=h.host.refreshAndRead;h.host.refreshAndRead=async()=>{await read();const value=h.makeState("queued");value.original[field]=field==="run"?{key:"other",eventId:"other"}:field.endsWith("At")?new Date(0).toISOString():"other";h.setState(value);};
  await h.start("run");assert.equal(h.wakes(),0);
});
for (const gate of ["session","source","route","connected","visible","current"]) test("withdrawn "+gate+" after the verified read prevents wake",async()=>{
  const h=harness(),read=h.host.refreshAndRead;h.host.refreshAndRead=async()=>{await read();h.gates[gate]=false;};await h.start("run");assert.equal(h.wakes(),0);
});
test("existing driver read failure does not admit or dispatch a replacement",async()=>{
  const h=harness();let attempts=0;h.host.store.syncDocumentJobs=async()=>{attempts++;throw Error("read failed");};await h.start("run");assert.equal(attempts,1);assert.equal(h.counts().posts,1);assert.equal(h.host.status,"Original unavailable");
});
test("host wake uses only the existing Store method after a verified explicit action",()=>{
  const command=section("  async #command(","  #captureCommandFocusVisibility(");assert.match(command,/binding\.store\.syncDocumentJobs\(\{ freshAfterActive: true \}\)/);assert.doesNotMatch(command,/fetch\(|\/api\/document-jobs|requestDocumentJob|\.dispatch\(/);
  assert.doesNotMatch(section("  async #check()","  #scheduleDeadline()"),/syncDocumentJobs/);
});
for (const action of ["run", "resumeRun", "recoverResult"]) test(action + " immediately completed response reads the result", async () => {
  const h = harness({ responseStatus: "succeeded", states: ["succeeded"] });
  await h.start(action); await h.settle();
  assert.equal(h.host.result.output, "image");
  assert.equal(h.counts().posts, 1); assert.equal(h.counts().images, 1); assert.equal(h.timers.size, 0);
});
function commandFocus(h) {
  const status = new FocusElement(h.host), control = new FocusElement(h.host), listeners = new Map();
  const emit = (type, event) => { for (const callback of [...(listeners.get(type) ?? [])]) callback(event); };
  Object.assign(h.host.ownerDocument, { activeElement: control, defaultView: { innerWidth: 1280, innerHeight: 900, getComputedStyle: () => ({ outlineWidth: "2px", outlineOffset: "2px" }) }, elementFromPoint: () => status,
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); }, removeEventListener(type, callback) { const entries = listeners.get(type); entries?.delete(callback); if (!entries?.size) listeners.delete(type); } });
  h.host.querySelector = () => status;
  let render;
  h.host.updateComplete = new Promise(resolve => { render = resolve; });
  h.host.requestUpdate = () => { if (!h.host.busy) { h.host.ownerDocument.activeElement = status; emit("focusin", { target: status }); } };
  return { status, render, listeners, emit };
}
for (const action of ["run", "resumeRun", "recoverResult"]) test(action + " immediate completion reveals command status after layout before result read", async () => {
  const h = harness({ responseStatus: "succeeded", states: ["succeeded"] }), focus = commandFocus(h), command = h.start(action);
  await h.settle(); assert.equal(h.counts().reads, 1); assert.equal(focus.status.scrolls.length, 0);
  focus.render(); await command; await h.settle();
  assert.equal(focus.status.scrolls.length, 1); assert.equal(h.host.result.output, "image"); assert.equal(h.counts().images, 1); assert.equal(focus.listeners.size, 0);
});
for (const mode of ["epoch", "binding", "hidden"]) test("command result continuation cannot resume after " + mode + " changes during layout", async () => {
  const h = harness({ responseStatus: "succeeded", states: ["succeeded"] }), focus = commandFocus(h), command = h.start("run");
  await h.settle();
  if (mode === "epoch") { const next = h.host.beginOperation(); h.host.finishOperation(next); }
  if (mode === "binding") h.host.binding = {};
  if (mode === "hidden") h.host.ownerDocument.visibilityState = "hidden";
  focus.render(); await command; await h.settle();
  assert.equal(focus.status.scrolls.length, 0); assert.equal(h.counts().reads, 1); assert.equal(h.counts().images, 0); assert.equal(focus.listeners.size, 0);
});
function heldTransfer(h) {
  const focus = commandFocus(h), control = new FocusButton(h.host); control.dataset.experienceAction = "run";
  h.host.ownerDocument.activeElement = control; h.host.requestUpdate = () => {};
  let resolveCommand, focusCalls = 0; const gate = new Promise(resolve => { resolveCommand = resolve; }), command = h.binding.client.command;
  h.binding.client.command = async (...args) => { await gate; return command(...args); };
  focus.status.focus = () => { focusCalls++; h.host.ownerDocument.activeElement = focus.status; focus.emit("focusin", { target: focus.status }); };
  return { ...focus, resolveCommand, focusCalls: () => focusCalls };
}
test("actual preserveFocus transfer reveals after committed layout while command response remains held", async () => {
  const h = harness(), focus = heldTransfer(h), command = h.start("run"); await h.settle();
  h.host.preserveFocus(); assert.equal(focus.focusCalls(), 1); assert.equal(focus.status.scrolls.length, 0); assert.equal(h.host.busy, true);
  focus.render(); await h.settle(); assert.equal(focus.status.scrolls.length, 1); assert.equal(h.host.busy, true); assert.equal(h.counts().reads, 0);
  focus.resolveCommand(); await command; assert.equal(focus.status.scrolls.length, 1, "final fallback cannot scroll again"); assert.equal(h.host.commandFocusReveal, null); assert.equal(focus.listeners.size, 0);
});
for (const mode of ["keydown", "pointerdown", "outside-focus", "epoch", "binding", "hidden"]) test(mode + " cancels a held transfer reveal before layout", async () => {
  const h = harness(), focus = heldTransfer(h), command = h.start("run"); await h.settle(); h.host.preserveFocus();
  if (["keydown", "pointerdown"].includes(mode)) focus.emit(mode, { target: focus.status });
  if (mode === "outside-focus") { const outside = new FocusElement({}); h.host.ownerDocument.activeElement = outside; focus.emit("focusin", { target: outside }); }
  if (mode === "epoch") h.host.navigationEpoch++;
  if (mode === "binding") h.host.binding = {};
  if (mode === "hidden") h.host.ownerDocument.visibilityState = "hidden";
  focus.render(); await h.settle(); assert.equal(focus.status.scrolls.length, 0); focus.resolveCommand(); await command; assert.equal(focus.status.scrolls.length, 0); assert.equal(focus.listeners.size, 0);
});
test("ordinary preserveFocus with no user command never schedules visibility scrolling", async () => {
  const h = harness(), focus = heldTransfer(h); h.host.busy = true; h.host.preserveFocus(); focus.render(); await h.settle();
  assert.equal(focus.focusCalls(), 1); assert.equal(focus.status.scrolls.length, 0); assert.equal(h.host.commandFocusReveal, undefined);
});
test("overlapping transfer and completed-command reveals scroll once before immediate result check", async () => {
  const h = harness({ responseStatus: "succeeded", states: ["succeeded"] }), focus = heldTransfer(h), command = h.start("run");
  await h.settle(); h.host.preserveFocus(); focus.resolveCommand(); await h.settle();
  assert.equal(h.counts().reads, 1); assert.equal(h.counts().images, 0); assert.equal(focus.status.scrolls.length, 0);
  focus.render(); await command; await h.settle(); assert.equal(focus.status.scrolls.length, 1); assert.equal(h.counts().images, 1); assert.equal(focus.listeners.size, 0);
});
test("old command cleanup cannot clear a replacement command visibility callback", async () => {
  const h = harness(), focus = heldTransfer(h), command = h.start("run"); await h.settle(); h.host.preserveFocus();
  const replacement = async () => {}; h.host.navigationEpoch++; h.host.commandFocusReveal = replacement;
  focus.render(); focus.resolveCommand(); await command; assert.equal(h.host.commandFocusReveal, replacement); assert.equal(focus.status.scrolls.length, 0); assert.equal(focus.listeners.size, 0);
});
test("unknown submission does not schedule reads or commands", async () => {
  const h = harness({ unknown: true }); await h.start("run");
  assert.equal(h.host.status, "Submission unconfirmed");
  assert.deepEqual(h.counts(), { reads: 0, images: 0, posts: 1, inspections: 0 }); assert.equal(h.timers.size, 0);
});
for (const status of ["failed", "cancelled", "partial", "uncertain", "unavailable", "authorized"]) test("does not follow terminal/non-running status " + status, async () => {
  const h = harness({ responseStatus: status }); await h.start("run"); assert.equal(h.timers.size, 0);
});
test("pending recovery stays explicit", async () => {
  const h = harness({ responseStatus: "failed" }); await h.start("recoverResult"); assert.equal(h.timers.size, 0); assert.equal(h.counts().posts, 1);
});
for (const gate of ["session", "source", "route", "connected", "visible", "current"]) test(gate + " withdrawal before the scheduled read stops it", async () => {
  const h = harness(); await h.start("run"); h.gates[gate] = false; await h.nextTimer();
  assert.equal(h.counts().reads, 1); assert.equal(h.counts().images, 0); assert.equal(h.timers.size, 0);
});
test("hidden view clears pending timer, disposes client, and stale callback cannot restart it", async () => {
  const h = harness(); await h.start("run");
  const stale = [...h.timers.values()][0].callback;
  h.host.ownerDocument.visibilityState = "hidden"; h.host.visibility();
  h.host.ownerDocument.visibilityState = "visible"; h.gates.current = true;
  stale(); await h.settle(); assert.equal(h.timers.size, 0); assert.equal(h.counts().reads, 1);
});
test("retirement clears pending continuation", async () => {
  const h = harness(); await h.start("run"); h.host.retire();
  assert.equal(h.timers.size, 0); assert.equal(h.host.retired, true);
});
test("new operation clears old timer and stale callback cannot interfere", async () => {
  const h = harness(); await h.start("run"); const stale = [...h.timers.values()][0].callback;
  const operation = h.host.beginOperation(); stale(); await h.settle();
  assert.equal(h.counts().reads, 1); h.host.finishOperation(operation); assert.equal(h.timers.size, 0);
});
test("read failure stops continuation", async () => {
  const h = harness({ failRead: true }); await h.start("run"); await h.nextTimer();
  assert.equal(h.host.status, "Result unavailable"); assert.equal(h.timers.size, 0); assert.equal(h.counts().posts, 1);
});
test("expired job is never polled", async () => {
  const h = harness({ expiry: 1000 }); await h.start("run"); await h.nextTimer();
  assert.equal(h.counts().reads, 1); assert.equal(h.timers.size, 0);
});
test("changed state cannot be followed by stale read", async () => {
  const h = harness(); await h.start("run"); h.setState(h.makeState("running")); await h.nextTimer();
  assert.equal(h.counts().reads, 1);
});
test("mount and source invalidation connect to the read-only continuation", () => {
  assert.match(section("  async #load()", "  /** Expected"), /else if \(loadedBinding\) this\.#scheduleResultRead\(\)/);
  assert.match(section("  protected override willUpdate()", "  #rows("), /this\.#stopResultRead\(\)/);
  const follow = section("  #stopResultRead()", "  #scheduleDeadline()");
  assert.doesNotMatch(follow, /\.command\(|\.focus\(|navigateInApp/);
});

test("hidden view cancels an active read and ignores its late success", async () => {
  const h = harness({ states: ["succeeded"] }); await h.start("run");
  let resolve;
  h.host.store.inspectOutputNativeJob = () => new Promise(done => { resolve = done; });
  await h.nextTimer(); assert.equal(h.host.busy, true);
  h.host.ownerDocument.visibilityState = "hidden"; h.host.visibility();
  resolve({ status: "found", job: { status: "completed" }, current: () => true });
  await h.settle();
  assert.equal(h.host.result, undefined); assert.equal(h.host.busy, false);
  assert.equal(h.counts().images, 0); assert.equal(h.timers.size, 0);
});
test("operation timeout cancels an active read and never resumes on late completion", async () => {
  const h = harness({ states: ["succeeded"] }); await h.start("run");
  let resolve;
  h.host.store.inspectOutputNativeJob = () => new Promise(done => { resolve = done; });
  await h.nextTimer(); assert.equal(h.host.busy, true);
  await h.nextTimer(); assert.equal(h.host.status, "Operation unconfirmed");
  resolve({ status: "found", job: { status: "completed" }, current: () => true });
  await h.settle();
  assert.equal(h.host.result, undefined); assert.equal(h.host.busy, false);
  assert.equal(h.counts().images, 0); assert.equal(h.timers.size, 0);
});
for (const status of ["failed", "cancelled", "partial", "uncertain", "unavailable"]) test("terminal state discovered by a continuation stops: " + status, async () => {
  const h = harness({ states: [status] }); await h.start("run"); await h.nextTimer();
  assert.equal(h.host.status, status); assert.equal(h.timers.size, 0); assert.equal(h.counts().images, 0);
});
