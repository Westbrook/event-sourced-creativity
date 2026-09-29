import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { nothing } from "lit";
import { calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";

const { NativeRetainedAudio, renderNativeRetainedAudio } = await ports.loadActual("src/components/native-retained-audio.ts");
const origin = "https://fixture.invalid";
// Small, local PCM16 mono WAV; no provider, media account or transport supplier.
const wav = Buffer.alloc(204);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let index = 0; index < 80; index++) wav.writeInt16LE(Math.round(Math.sin(index / 3) * 2000), 44 + index * 2);
const audioResult = () => ({ schemaVersion: 1, kind: "native-retained-output", output: "audio",
  selection: { documentId: "document-a", artifactId: "audio-a", revision: 0, contentSha256: "a".repeat(64) },
  title: "Listening at dawn · فجر", expiresAt: "2099-01-01T00:00:00.000Z",
  content: { content_markdown: "Exact <script>not executable</script> & text.\nKeep  two spaces.\n声と朝",
    lyrics: "[Verse]\nعتبة الضوء\nDo not trim  ", role: "voice", inputRef: "private-input-opaque",
    media: { url: "/api/media/u-6f776e6572%2Fgenerated%2Faudio-a.wav", mediaType: "audio/wav",
      sha256: createHash("sha256").update(wav).digest("hex") },
    timing: { seconds: 0.01, basis: "measured" }, synthIdWatermarked: true } });
const rawText = node => node.children.map(child => typeof child === "string" ? child : rawText(child)).join("");
function response(media, body = wav) {
  const value = new Response(body, { status: 200, headers: { "content-type": media.mediaType,
    ...(body instanceof Uint8Array ? { "content-length": String(body.byteLength) } : {}) } });
  Object.defineProperty(value, "url", { value: origin + media.url });
  return value;
}

function fixture(t, { nativeFocus = false } = {}) {
  const original = { fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL, activeElement: ports.documentPort.activeElement };
  const f = { trace: [], listeners: new Map(), changed: new Map(), requested: false,
    tick: async () => true, frames: new Map(), timers: new Map(), resizeTargets: new Map(), storage: new Map() };
  ports.bindFixture(f);
  const state = { result: audioResult(), mounted: true }, calls = [], blobs = [], revoked = [], labels = [];
  let reply = () => response(state.result.content.media);
  globalThis.fetch = async (path, init) => { calls.push({ path, init }); return reply(path, init); };
  URL.createObjectURL = blob => { blobs.push(blob); return "blob:" + origin + "/owned-" + blobs.length; };
  URL.revokeObjectURL = url => { revoked.push(url); f.trace.push("revoke:" + url); };
  const locale = { system(value) { labels.push(value); return "UI:" + value; },
    t(key, fallback, values = {}) { labels.push(key); return Object.entries(values).reduce((text, [name, value]) => text.replaceAll("{" + name + "}", String(value)), fallback); },
    number(value) { return String(value); } };
  class Parent extends ports.ElementPort {
    render() { return state.mounted ? renderNativeRetainedAudio(state.result, locale) : nothing; }
  }
  f.host = new Parent(); f.host.tag = "fixture-audio-owner"; f.host.attributes = {};
  f.renderer = new ports.RendererPort(f, { "forma-native-retained-audio": NativeRetainedAudio });
  // Existing native ports do not decode audio. Observe only native disposal
  // calls on the actual leaf's emitted node; no application method is replaced.
  const collect = f.renderer.collect.bind(f.renderer);
  const focus = node => {
    if (!node?.isConnected || Object.hasOwn(node.attributes ?? {}, "disabled")) return;
    const previous = ports.documentPort.activeElement;
    if (previous !== node) {
      const event = { type: "blur", target: previous, currentTarget: previous };
      previous?.listeners?.blur?.(event);
      // Native blur also delivers the actual template listener. It observes
      // the final activeElement in its own queued microtask after this move.
      if (typeof previous?.handlers?.blur === "function") previous.handlers.blur.call(previous.owner, event);
    }
    ports.documentPort.activeElement = node; f.trace.push("focus:" + node.tag);
  };
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length; collect(markup, owner);
    for (let index = start; index < f.renderer.nodes.length; index++) {
      let node = f.renderer.nodes[index];
      if (nativeFocus && owner instanceof NativeRetainedAudio && ["button", "audio"].includes(node.tag)) {
        // This leaf has one fixed template part for each native control. Model
        // only Lit retaining that same part within the same keyed result and
        // consecutive committed trees. Never revive removed/replaced nodes or
        // move activeElement to a newly constructed port.
        const previous = (f.renderer.previousNodes ?? []).filter(candidate => candidate.isConnected
          && candidate.owner === owner && candidate.tag === node.tag && candidate.focusResult === owner.result);
        assert.ok(previous.length <= 1);
        if (previous.length) {
          const retained = previous[0];
          for (const field of ["attributes", "properties", "propertyParts", "handlers", "full", "value", "open"])
            retained[field] = node[field];
          node = retained; f.renderer.nodes[index] = node;
        }
        node.focusResult = owner.result; node.focus = () => focus(node);
      }
      if (node.tag === "audio") {
        node.pause = () => f.trace.push("pause");
        node.removeAttribute = name => { f.trace.push("remove:" + name); delete node.attributes[name]; };
        node.load = () => f.trace.push("load");
        node.play = () => { throw Error("Audio must never start automatically"); };
      }
    }
  };
  const draw = () => {
    ports.bindFixture(f); f.renderer.draw(f.host);
    const active = ports.documentPort.activeElement;
    if (nativeFocus && active && (!active.isConnected || Object.hasOwn(active.attributes ?? {}, "disabled"))) {
      active.listeners?.blur?.({ type: "blur", target: active, currentTarget: active });
      ports.documentPort.activeElement = null;
    }
    return f.host.querySelector("forma-native-retained-audio");
  };
  if (nativeFocus) f.tick = async () => { draw(); return true; };
  const tree = () => fullPageTree(f);
  const load = child => f.renderer.handler(child, "button", () => true, "click")({ type: "click" });
  t.after(() => { state.mounted = false; draw(); ports.bindFixture(null);
    globalThis.fetch = original.fetch; URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
    ports.documentPort.activeElement = original.activeElement; });
  return { f, state, calls, blobs, revoked, labels, draw, tree, load, focus, setReply(value) { reply = value; } };
}

// Actual component, helper and handlers through the existing finite native
// ports. These controls certify neither browser decoding nor perceived quality.
test("Audio remains cold until explicit Load and preserves exact text, timing, watermark and editing limitation", t => {
  const f = fixture(t); f.draw(); const tree = f.tree();
  assert.equal(f.calls.length, 0); assert.equal(tree.visible("audio").length, 0);
  assert.equal(rawText(tree.visible("button")[0]), "UI:Load audio");
  assert.deepEqual(tree.nodes.filter(node => node.tag === "pre").map(rawText), [f.state.result.content.content_markdown, f.state.result.content.lyrics]);
  assert.equal(tree.visible("script").length + tree.visible("textarea").length, 0);
  assert.ok(tree.visible("p").map(rawText).includes("Measured audio: 0.01s"));
  assert.ok(tree.visible("p").map(rawText).includes("Generated audio includes an embedded SynthID watermark."));
  assert.ok(tree.visible("p").map(rawText).includes("UI:Audio editing is not available in Forma."));
  assert.equal(f.f.renderer.markup.includes(f.state.result.content.inputRef), false);
  assert.ok(!f.labels.includes(f.state.result.content.content_markdown) && !f.labels.includes(f.state.result.content.lyrics));
  f.state.result = { ...audioResult(), content: { ...audioResult().content, media: null, timing: null } };
  f.draw(); assert.equal(f.tree().visible("button").length, 0);
  assert.ok(f.tree().visible("p").map(rawText).includes("Unavailable")); assert.equal(f.calls.length, 0);
});

test("explicit Load exposes only hash-verified bytes; same-key replacement synchronously disposes the owned native source", async t => {
  const f = fixture(t), child = f.draw(), operation = f.load(child);
  assert.equal(typeof operation?.then, "function");
  await operation; f.draw();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, f.state.result.content.media.url);
  assert.deepEqual({ ...f.calls[0].init, signal: undefined }, { method: "GET", signal: undefined,
    credentials: "same-origin", redirect: "error", cache: "no-store" });
  assert.equal(f.blobs.length, 1); assert.deepEqual(Buffer.from(await f.blobs[0].arrayBuffer()), wav);
  const audio = f.f.renderer.ownNodes(child, "audio")[0], url = audio.attributes.src, oldError = audio.handlers.error;
  assert.equal(url, "blob:" + origin + "/owned-1"); assert.equal(audio.attributes.preload, "none");
  assert.ok(Object.hasOwn(audio.attributes, "controls")); assert.equal(Object.hasOwn(audio.attributes, "autoplay"), false);
  f.f.trace.length = 0;
  const next = audioResult(); next.content.media.sha256 = "b".repeat(64);
  child.result = next; // Assert disposal before any renderer update, even at the same media key.
  assert.deepEqual(f.f.trace, ["pause", "remove:src", "load", "revoke:" + url]);
  assert.equal(audio.attributes.src, undefined); assert.deepEqual(f.revoked, [url]);
  f.state.result = next; f.draw(); f.f.requested = false;
  oldError({ target: audio, currentTarget: audio });
  assert.equal(f.f.requested, false); assert.equal(f.tree().visible("audio").length, 0);
  assert.ok(!f.tree().visible("p").map(rawText).includes("Unavailable")); assert.equal(f.calls.length, 1);
});

test("same URL with changed bytes is unavailable and never creates a native media source", async t => {
  const f = fixture(t), child = f.draw(), changed = Buffer.from(wav); changed[60] ^= 1;
  f.setReply(() => response(f.state.result.content.media, changed));
  await f.load(child); f.draw();
  assert.equal(f.calls.length, 1); assert.equal(f.blobs.length, 0); assert.equal(f.tree().visible("audio").length, 0);
  assert.ok(f.tree().visible("p").map(rawText).includes("Unavailable"));
  assert.deepEqual(f.tree().nodes.filter(node => node.tag === "pre").map(rawText), [f.state.result.content.content_markdown, f.state.result.content.lyrics]);
});

test("replaced or disconnected pending reads abort and cancel late bodies without creating Blob URLs", async t => {
  for (const retirement of ["replacement", "disconnect"]) {
    await t.test(retirement, async t => {
      const f = fixture(t), child = f.draw(); let deliver, canceled = 0;
      f.setReply(() => new Promise(resolve => { deliver = resolve; }));
      const operation = f.load(child); assert.equal(f.calls.length, 1);
      if (retirement === "replacement") { const next = audioResult(); child.result = next; f.state.result = next; }
      else { f.state.mounted = false; f.draw(); }
      assert.equal(f.calls[0].init.signal.aborted, true); await operation;
      deliver(response(f.state.result.content.media, new ReadableStream({ cancel() { canceled++; } })));
      await new Promise(setImmediate); f.draw();
      assert.equal(canceled, 1); assert.equal(f.blobs.length, 0); assert.equal(f.tree().visible("audio").length, 0);
    });
  }
});

test("native decoder failure and disconnection retire playback; detached error delivery cannot change current copy", async t => {
  const f = fixture(t), child = f.draw(); await f.load(child); f.draw();
  const audio = f.f.renderer.ownNodes(child, "audio")[0], error = audio.handlers.error;
  error({ target: audio, currentTarget: audio }); f.draw();
  assert.equal(f.tree().visible("audio").length, 0); assert.deepEqual(f.revoked, ["blob:" + origin + "/owned-1"]);
  assert.ok(f.tree().visible("p").map(rawText).includes("Unavailable"));
  await f.load(child); f.draw(); const currentAudio = f.f.renderer.ownNodes(child, "audio")[0];
  f.f.trace.length = 0; f.state.mounted = false; f.draw();
  assert.deepEqual(f.f.trace, ["pause", "remove:src", "load", "revoke:blob:" + origin + "/owned-2"]);
  f.f.requested = false; currentAudio.handlers.error({ target: currentAudio, currentTarget: currentAudio });
  assert.equal(f.f.requested, false); assert.equal(f.calls.length, 2);
});

test("expiry prevents a new explicit read and wins over a pending response before playback", async t => {
  const f = fixture(t); f.state.result.expiresAt = "2000-01-01T00:00:00.000Z";
  const child = f.draw(); await f.load(child); assert.equal(f.calls.length, 0);
  f.state.result = audioResult(); f.draw(); let deliver;
  f.setReply(() => new Promise(resolve => { deliver = resolve; }));
  const operation = f.load(child); assert.equal(f.calls.length, 1);
  // Exercise the clock boundary without changing the owned result object.
  const dateNow = Date.now; Date.now = () => Date.parse("2100-01-01T00:00:00.000Z");
  try { deliver(response(f.state.result.content.media)); await operation; }
  finally { Date.now = dateNow; }
  f.draw(); assert.equal(f.blobs.length, 0); assert.equal(f.tree().visible("audio").length, 0);
  assert.equal(f.calls[0].init.signal.aborted, true);
});


test("verified Audio transfers the exact current Load focus while source ownership survives", async t => {
  for (const mode of ["current", "moved", "returned", "retired"]) {
    await t.test(mode, async t => {
      const f = fixture(t, { nativeFocus: true }), child = f.draw();
      const origin = f.f.renderer.ownNodes(child, "button")[0]; origin.focus();
      assert.equal(ports.documentPort.activeElement, origin);
      let deliver; f.setReply(() => new Promise(resolve => { deliver = resolve; }));
      const operation = f.load(child); f.draw();
      assert.equal(f.f.renderer.ownNodes(child, "button")[0], origin, "same keyed native Load part remains rendered");
      const loadingDisabled = Object.hasOwn(origin.attributes, "disabled");
      const loadingAriaDisabled = origin.attributes["aria-disabled"];
      const outside = ports.documentPort.createElement("button"); outside.isConnected = true;
      if (mode === "moved" || mode === "returned") { f.focus(outside); if (mode === "returned") origin.focus(); }
      if (mode === "retired") { const next = audioResult(); child.result = next; f.state.result = next; f.draw(); }
      deliver(response(f.state.result.content.media)); await operation; f.draw();
      const audio = f.f.renderer.ownNodes(child, "audio")[0];
      if (mode === "current" || mode === "returned") {
        assert.ok(audio, "verified native player rendered");
        assert.equal(ports.documentPort.activeElement, audio, "Load focus transfers to current native audio");
        assert.equal(audio.isConnected, true, "focus cannot be left on a removed control or cleared to null");
        assert.equal(loadingDisabled, false, "busy state cannot trigger native disabled-button blur");
        assert.equal(loadingAriaDisabled, "true");
        assert.equal(audio.attributes.tabindex, "0");
      } else if (mode === "moved") assert.equal(ports.documentPort.activeElement, outside, "new user focus wins");
      else { assert.equal(audio, undefined); assert.equal(f.calls[0].init.signal.aborted, true); }
      assert.equal(f.calls.length, 1); assert.equal(f.tree().visible("audio").length, mode === "retired" ? 0 : 1);
    });
  }
});


test("focused Audio decoder failure hands off only the current source's focus to its connected replacement Load", async t => {
  for (const mode of ["current", "moved", "returned-during-transition", "source-retired"]) {
    await t.test(mode, async t => {
      const f = fixture(t, { nativeFocus: true }), child = f.draw();
      const originalLoad = f.f.renderer.ownNodes(child, "button")[0]; originalLoad.focus();
      await f.load(child); f.draw();
      const audio = f.f.renderer.ownNodes(child, "audio")[0];
      assert.ok(audio); assert.equal(ports.documentPort.activeElement, audio); assert.equal(audio.isConnected, true);
      const error = audio.handlers.error, url = audio.attributes.src;
      const outside = ports.documentPort.createElement("button"); outside.isConnected = true;
      const nativeTick = f.f.tick;
      let releaseTransition;
      // Hold the existing updateComplete port after its committed tree. This
      // gives a user focus change or source retirement a real transition slot.
      f.f.tick = () => { f.draw(); return new Promise(resolve => { releaseTransition = () => resolve(true); }); };
      let operation, transitionHadConnectedFocus, returnedToAudio = false, retirementFocusCount;
      try {
        operation = error({ type: "error", target: audio, currentTarget: audio });
        f.draw();
        const replacement = f.f.renderer.ownNodes(child, "button")[0], active = ports.documentPort.activeElement;
        transitionHadConnectedFocus = Boolean(active?.isConnected && (active === audio || active === replacement));
        if (mode === "moved" || mode === "returned-during-transition") {
          f.focus(outside);
          if (mode === "returned-during-transition") {
            audio.focus(); returnedToAudio = ports.documentPort.activeElement === audio && audio.isConnected;
          }
        }
        if (mode === "source-retired") {
          f.focus(outside);
          retirementFocusCount = f.f.trace.filter(value => value.startsWith("focus:")).length;
          const next = audioResult(); child.result = next; f.state.result = next; f.draw();
        }
      } finally {
        f.f.tick = nativeTick; releaseTransition?.();
      }
      await operation; await new Promise(setImmediate); f.draw();
      const replacement = f.f.renderer.ownNodes(child, "button")[0];
      assert.ok(replacement); assert.equal(replacement.isConnected, true);
      assert.equal(audio.isConnected, false); assert.equal(f.tree().visible("audio").length, 0);
      assert.equal(audio.attributes.src, undefined); assert.deepEqual(f.revoked, [url]);
      assert.equal(f.calls.length, 1, "decoder failure does not start another media read");
      if (mode === "current" || mode === "returned-during-transition") {
        assert.equal(transitionHadConnectedFocus, true, "the transition must not first discard the focused native control");
        if (mode === "returned-during-transition") assert.equal(returnedToAudio, true, "the exact current audio remains available for the user's return before handoff");
        assert.equal(ports.documentPort.activeElement, replacement, "focused failed audio reaches the current connected Load button");
        assert.equal(Object.hasOwn(replacement.attributes, "disabled"), false);
        assert.ok(f.tree().visible("p").map(rawText).includes("Unavailable"));
      } else {
        assert.equal(ports.documentPort.activeElement, outside, "new user focus or retired source must never be overwritten");
        assert.equal(outside.isConnected, true);
        if (mode === "source-retired") {
          assert.equal(f.f.trace.filter(value => value.startsWith("focus:")).length, retirementFocusCount, "source retirement is silent");
          assert.ok(!f.tree().visible("p").map(rawText).includes("Unavailable"), "an old decoder error cannot mark the replacement source failed");
        }
      }
    });
  }
});


test("failed Load-to-Audio focus transfer retains usable original Load and an explicit verified retry", async t => {
  for (const fault of ["rejected-update", "throwing-focus"]) await t.test(fault, async t => {
    const f = fixture(t, { nativeFocus: true }), child = f.draw();
    const load = f.f.renderer.ownNodes(child, "button")[0]; load.focus();
    const nativeTick = f.f.tick; let injected = false, focusThrows = 0;
    f.f.tick = async () => {
      if (injected) return nativeTick();
      injected = true;
      if (fault === "rejected-update") throw Error("Fixture updateComplete rejected before focus transfer");
      await nativeTick();
      const target = f.f.renderer.ownNodes(child, "audio")[0]; assert.ok(target);
      target.focus = () => { focusThrows++; throw Error("Fixture native audio focus failed"); };
      return true;
    };
    try { await f.load(child); } finally { f.f.tick = nativeTick; }
    f.draw();
    assert.equal(injected, true); assert.equal(focusThrows, fault === "throwing-focus" ? 1 : 0);
    assert.equal(f.f.renderer.ownNodes(child, "button")[0] === load, true, "the original Load part survives failed transfer");
    assert.equal(load.isConnected, true); assert.equal(ports.documentPort.activeElement === load, true);
    assert.equal(Object.hasOwn(load.attributes, "disabled"), false); assert.equal(load.attributes["aria-disabled"], "false");
    assert.equal(f.calls.length, 1); assert.equal(f.blobs.length, 1);
    assert.deepEqual(f.revoked, ["blob:" + origin + "/owned-1"]);
    assert.equal(f.f.renderer.ownNodes(child, "audio").some(node => Boolean(node.attributes.src)), false);
    await f.load(child); f.draw();
    assert.equal(f.calls.length, 2, "Retry performs a new read instead of returning through a stale ready URL");
    assert.equal(f.calls[1].path, f.state.result.content.media.url); assert.equal(f.blobs.length, 2);
    assert.deepEqual(Buffer.from(await f.blobs[1].arrayBuffer()), wav);
    const audio = f.f.renderer.ownNodes(child, "audio")[0]; assert.ok(audio);
    assert.equal(audio.isConnected, true); assert.equal(ports.documentPort.activeElement === audio, true);
    assert.equal(audio.attributes.src, "blob:" + origin + "/owned-2");
    assert.deepEqual(f.revoked, ["blob:" + origin + "/owned-1"]);
  });
});

test("failed Audio-to-Load focus transfer retains source-less focused audio and permits explicit retry", async t => {
  for (const fault of ["rejected-update", "throwing-focus"]) await t.test(fault, async t => {
    const f = fixture(t, { nativeFocus: true }), child = f.draw();
    f.f.renderer.ownNodes(child, "button")[0].focus(); await f.load(child); f.draw();
    const audio = f.f.renderer.ownNodes(child, "audio")[0], error = audio.handlers.error, url = audio.attributes.src;
    assert.equal(ports.documentPort.activeElement === audio, true);
    const nativeTick = f.f.tick; let injected = false, focusThrows = 0;
    f.f.tick = async () => {
      if (injected) return nativeTick();
      injected = true;
      if (fault === "rejected-update") throw Error("Fixture error recovery updateComplete rejected");
      await nativeTick();
      const target = f.f.renderer.ownNodes(child, "button")[0]; assert.ok(target);
      target.focus = () => { focusThrows++; throw Error("Fixture replacement Load focus failed"); };
      return true;
    };
    try { await error({ type: "error", target: audio, currentTarget: audio }); }
    finally { f.f.tick = nativeTick; }
    f.draw();
    assert.equal(injected, true); assert.equal(focusThrows, fault === "throwing-focus" ? 1 : 0);
    assert.equal(f.f.renderer.ownNodes(child, "audio")[0] === audio, true, "failed handoff keeps the exact native audio part");
    assert.equal(audio.isConnected, true); assert.equal(ports.documentPort.activeElement === audio, true);
    assert.equal(audio.attributes.src, undefined); assert.deepEqual(f.revoked, [url]); assert.equal(f.calls.length, 1);
    const load = f.f.renderer.ownNodes(child, "button")[0]; assert.ok(load);
    assert.equal(load.isConnected, true); assert.equal(Object.hasOwn(load.attributes, "disabled"), false);
    assert.equal(load.attributes["aria-disabled"], "false");
    load.focus();
    const focusCount = f.f.trace.filter(value => value.startsWith("focus:")).length;
    await new Promise(setImmediate); f.draw();
    assert.equal(ports.documentPort.activeElement === load, true); assert.equal(load.isConnected, true);
    assert.equal(audio.isConnected, false, "leaving the failed audio retires its source-less part");
    assert.equal(f.f.trace.filter(value => value.startsWith("focus:")).length, focusCount, "blur cleanup never moves focus");
    assert.equal(f.calls.length, 1, "focusing Retry alone never reads media");
    await f.load(child); f.draw();
    assert.equal(f.calls.length, 2); assert.equal(f.blobs.length, 2);
    assert.deepEqual(Buffer.from(await f.blobs[1].arrayBuffer()), wav);
    const retryAudio = f.f.renderer.ownNodes(child, "audio")[0]; assert.ok(retryAudio);
    assert.equal(retryAudio.isConnected, true); assert.equal(ports.documentPort.activeElement === retryAudio, true);
    assert.equal(retryAudio.attributes.src, "blob:" + origin + "/owned-2"); assert.deepEqual(f.revoked, [url]);
  });
});

test("rejected Audio transition updates never steal moved focus or revive a replaced or disconnected source", async t => {
  for (const transition of ["load", "decoder-error"]) for (const retirement of ["moved", "replacement", "disconnect"]) {
    await t.test(`${transition}: ${retirement}`, async t => {
      const f = fixture(t, { nativeFocus: true }), child = f.draw();
      f.f.renderer.ownNodes(child, "button")[0].focus();
      let audio, error;
      if (transition === "decoder-error") { await f.load(child); f.draw(); audio = f.f.renderer.ownNodes(child, "audio")[0]; error = audio.handlers.error; }
      const outside = ports.documentPort.createElement("button"); outside.isConnected = true;
      const nativeTick = f.f.tick; let injected = false, movedFocusCount;
      f.f.tick = async () => {
        await nativeTick();
        if (injected) return true;
        injected = true; f.focus(outside);
        movedFocusCount = f.f.trace.filter(value => value.startsWith("focus:")).length;
        if (retirement === "replacement") { const next = audioResult(); child.result = next; f.state.result = next; f.draw(); }
        else if (retirement === "disconnect") { f.state.mounted = false; f.draw(); }
        throw Error("Fixture update failed after ownership changed");
      };
      try {
        if (transition === "load") await f.load(child);
        else await error({ type: "error", target: audio, currentTarget: audio });
      } finally { f.f.tick = nativeTick; }
      await new Promise(setImmediate); f.draw();
      assert.equal(injected, true); assert.equal(ports.documentPort.activeElement === outside, true); assert.equal(outside.isConnected, true);
      assert.equal(f.f.trace.filter(value => value.startsWith("focus:")).length, movedFocusCount, "failure cleanup never makes a focus call after the user leaves");
      assert.equal(f.calls.length, 1, "failure cleanup never starts a replacement read");
      if (retirement !== "moved") {
        assert.equal(f.tree().visible("audio").length, 0);
        assert.deepEqual(f.revoked, ["blob:" + origin + "/owned-1"]);
        assert.ok(!f.tree().visible("p").map(rawText).includes("Unavailable"), "a retired transition does not poison current copy");
      }
    });
  }
});
