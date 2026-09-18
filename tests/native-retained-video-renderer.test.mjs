import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { html, nothing, noChange } from "lit";
import { live } from "lit/directives/live.js";
import { PartType } from "lit/directive.js";
import ts from "typescript";
import { calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";
import { artifactFocusOptionsFromRoute, libraryFocusFromRoute, projectTaskDocumentIdFromRoute } from "../src/model/routes.ts";

// Adapt the existing retained media-reader synchronous DOM/render ports. These
// execute complete actual modules; they do not establish browser decoding,
// native keyboard playback, media-byte identity, layout or live authorization.
const sources = new Map(await Promise.all(["src/components/video-reel.ts", "src/components/native-retained-video.ts"].map(async path => [path,
  ts.transpileModule(await readFile(new URL("../" + path, import.meta.url), "utf8"), {
    fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText])));
function load(path, imports) {
  const module = { exports: {} };
  new Function("require", "module", "exports", sources.get(path))(name => {
    assert.ok(Object.hasOwn(imports, name), "Unexpected runtime dependency: " + name); return imports[name];
  }, module, module.exports);
  return module.exports;
}
const reelSource = load("src/components/video-reel.ts", { lit: { html, nothing }, "lit/directives/live.js": { live } });
const templates = value => Array.isArray(value) ? value.flatMap(templates) : value?.strings ? [value, ...value.values.flatMap(templates)] : [];
function binding(value, name) {
  const index = value.strings.findIndex(part => part.endsWith(name + "="));
  assert.ok(index >= 0, "Missing binding: " + name); return value.values[index];
}
function deepFreeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function videoResult(suffix = "a") {
  return deepFreeze({ schemaVersion: 1, kind: "native-retained-output", output: "video",
    selection: { documentId: "document-a", artifactId: "video-" + suffix, revision: 0, contentSha256: "a".repeat(64) },
    title: "  Literal <title> & عنوان  ", expiresAt: "2099-01-01T00:00:00.000Z",
    content: { primaryMedia: null, content_markdown: "\ufeff  Retained <script>copy</script>\r\n", clips: [1, 2, 3].map(index => ({
      id: "clip-" + index, title: "  Clip " + index + " · العربية", body: "Body\n<em>literal</em> " + index,
      notes: "  Note " + index + "\r\n", media: index === 3 ? null : {
        url: "/api/media/u-owner%2Fgenerated%2F" + suffix + "-" + index + ".mp4", mediaType: "video/mp4",
      },
    })) } });
}
function fixture(t, value = videoResult(), settings = {}) {
  let selected = value;
  const log = [], rendered = [];
  t.mock.method(globalThis, "fetch", () => { log.push(["forbidden-fetch"]); throw Error("No renderer transport"); });
  const document = {
    activeElement: null, hasFocus: () => true,
    createTextNode(data) { return { nodeType: 3, data, get textContent() { return this.data; } }; },
    createDocumentFragment() { return { nodeType: 11, childNodes: [], append(node) { this.childNodes.push(node); },
      get textContent() { return this.childNodes.map(node => node.textContent).join(""); } }; },
    createElement(tag) {
      assert.equal(tag, "article");
      const root = { parentNode: null, media: [], view: null, origin: null,
        get isConnected() { return Boolean(this.parentNode?.isConnected); },
        contains(element) { return this.media.includes(element) || element === this.origin && element.isConnected; },
        querySelectorAll(selector) { assert.equal(selector, "video"); return [...this.media]; },
        querySelector(selector) { assert.equal(selector, ".forma-video-reel-player"); return this.media.find(player => player.kind === "reel") ?? null; },
        remove() {
          log.push(["remove-root", root]); if (settings.fail?.has("remove-root")) throw Error("remove-root-failed");
          if (root.parentNode) root.parentNode.children = root.parentNode.children.filter(child => child !== root);
          root.parentNode = null;
        },
      };
      return root;
    },
  };
  const host = { isConnected: true, children: [], ownerDocument: document, append(root) { this.children.push(root); root.parentNode = this; } };
  const render = (view, root) => {
    rendered.push(view); root.view = view;
    const all = templates(view), playerTemplates = all.filter(entry => /<video\s/u.test(entry.strings.join("")));
    const open = all.some(entry => entry.strings.some(part => part.endsWith("@click=")));
    if (open && !root.origin) root.origin = { isConnected: true };
    if (root.origin) root.origin.isConnected = open;
    if (!playerTemplates.length) { root.media = []; return; }
    // Preserve the distinct native primary and reel parts across unchanged Lit
    // redraws. This does not assign focus to either replacement or new nodes.
    const prior = root.media;
    root.picker ??= { value: "1", closest: () => root.reel };
    root.status ??= { textContent: "" };
    root.reel = { querySelector(selector) { return selector.includes("select") ? root.picker : selector.includes("data-scene-status") ? root.status : root.reelPlayer; } };
    root.media = playerTemplates.map(template => {
      const kind = template.strings.join("").includes("native-video-primary-player") ? "primary" : "reel";
      let element = prior.find(candidate => candidate.kind === kind);
      if (!element) {
        element = { kind, src: "", currentTime: 0, dataset: { sceneIndex: "0" }, paused: true,
          setAttribute(name, value) { this[name] = value; },
          getAttribute(name) { return this[name] ?? null; },
          pause() { log.push(["pause", element]); if (settings.fail?.has("pause")) throw Error("pause-failed"); element.paused = true; },
          removeAttribute(name) { assert.equal(name, "src"); log.push(["remove-source", element]); if (settings.fail?.has("remove-source")) throw Error("remove-source-failed"); element.src = ""; },
          load() { log.push(["reset-resource", element]); if (settings.fail?.has("reset-resource")) throw Error("reset-resource-failed"); },
          play() { log.push(["play", element]); element.paused = false; return Promise.resolve(); },
          focus(options) { log.push(["focus", element, options]); if (settings.focusThrow) throw Error("focus-failed"); if (!settings.focusNoop) document.activeElement = element; },
          closest(selector) { assert.equal(selector, ".forma-video-reel"); return root.reel; },
        };
      }
      const source = binding(template, "src");
      if (source?._$litDirective$ === live("")._$litDirective$) {
        const part = { type: PartType.ATTRIBUTE, name: "src", element, strings: undefined };
        const directive = new source._$litDirective$(part), next = directive.update(part, source.values);
        if (next !== noChange) { log.push(["render-source", element, next]); element.src = next; }
      } else if (source !== element.committedSource) {
        log.push(["render-source", element, source]); element.src = source; element.committedSource = source;
      }
      const videoStart = template.strings.findIndex(part => /<video\s/u.test(part));
      const videoLabel = template.strings.findIndex((part, index) => index >= videoStart && part.endsWith("aria-label="));
      assert.ok(videoStart >= 0 && videoLabel >= videoStart, "exact native video aria binding");
      element.setAttribute("aria-label", template.values[videoLabel]);
      const sceneIndex = template.strings.findIndex(part => part.endsWith("data-scene-index="));
      if (sceneIndex >= 0) element.dataset.sceneIndex = String(template.values[sceneIndex]);
      if (kind === "reel") { root.playerTemplate = template; root.reelPlayer = element; }
      else root.primaryTemplate = template;
      return element;
    });
    for (const entry of all) {
      const statusIndex = entry.strings.findIndex(part => part.endsWith(".textContent="));
      if (statusIndex >= 0) root.status.textContent = entry.values[statusIndex];
      const pickerIndex = entry.strings.findIndex(part => part.endsWith(".value="));
      if (pickerIndex >= 0) root.picker.value = entry.values[pickerIndex];
    }
  };

  const reader = load("src/components/native-retained-video.ts", {
    lit: { html, nothing, render }, "./video-reel.ts": reelSource, "./native-retained-video.css": {},
  });
  const locale = { locale: "en", number: String, t: (_id, fallback, values = {}) => fallback.replace(/\{(\w+)\}/gu, (_, key) => String(values[key] ?? "")) };
  const options = { locale, isCurrent(actual, actualHost) {
    assert.equal(actualHost, host); return settings.check ? settings.check(actual, actualHost) : actual === selected;
  } };
  const owners = [];
  const mount = next => { const owned = reader.mountNativeRetainedVideo(host, next, options); owners.push(owned); return owned; };
  const owner = mount(value), root = host.children[0] ?? log.find(([operation]) => operation === "remove-root")?.[1];
  const activate = (target = root) => {
    const button = templates(target.view).find(entry => entry.strings.some(part => part.endsWith("@click=")));
    assert.ok(button); document.activeElement = settings.focusElsewhere ? { elsewhere: true } : target.origin;
    binding(button, "@click")({ currentTarget: target.origin });
  };
  t.after(() => {
    try { for (const owned of owners) owned.dispose(); }
    finally { assert.equal(log.some(([operation]) => operation === "forbidden-fetch"), false); }
  });
  return { owner, root, host, document, log, rendered, mount, activate, options, select(next) { selected = next; } };
}

test("native Video literal clip order and missing media remain visible before explicit Open", t => {
  const value = videoResult(), before = structuredClone(value), f = fixture(t, value);
  const all = templates(f.root.view), markup = all.map(entry => entry.strings.join("EXPRESSION")).join("\n");
  assert.equal(f.root.media.length, 0); assert.doesNotMatch(markup, /<(video|audio|source|img|script)\b/u);
  assert.ok(all.some(entry => entry.values.includes(value.title)));
  assert.ok(all.some(entry => entry.values.includes(value.content.content_markdown)));
  assert.deepEqual(all.filter(entry => entry.strings.some(part => part.endsWith("data-video-clip="))).map(entry => binding(entry, "data-video-clip")), value.content.clips.map(clip => clip.id));
  for (const clip of value.content.clips) for (const field of ["title", "body", "notes"]) assert.ok(all.some(entry => entry.values.includes(clip[field])));
  assert.equal(all.filter(entry => entry.strings.join("").includes("native-video-unavailable")).length, 1);
  f.activate(); assert.equal(f.root.media.length, 1); assert.equal(f.root.media[0].src, value.content.clips[0].media.url);
  assert.equal(binding(f.root.playerTemplate, "preload"), "none");
  assert.equal(f.log.filter(([operation]) => operation === "focus").length, 1);
  assert.equal(f.log.filter(([operation]) => operation === "play").length, 0);
  assert.deepEqual(value, before);
});

test("native Video root-only file is separate from unrendered clips and mixed files retain distinct player ownership", async t => {
  for (const mixed of [false, true]) await t.test(mixed ? "primary plus clips" : "primary only", child => {
    const value = structuredClone(videoResult());
    value.content.primaryMedia = { url: "/api/media/u-owner%2Fgenerated%2Fprimary.mp4", mediaType: "video/mp4" };
    if (!mixed) value.content.clips.forEach(clip => clip.media = null);
    deepFreeze(value); const f = fixture(child, value);
    assert.equal(f.root.media.length, 0); f.activate();
    assert.equal(f.root.media.length, mixed ? 2 : 1);
    assert.equal(f.root.media[0].kind, "primary"); assert.equal(f.root.media[0].src, value.content.primaryMedia.url);
    assert.match(f.root.primaryTemplate.strings.join(""), /preload="none"/u);
    assert.equal(f.document.activeElement, f.root.media[0]);
    assert.equal(f.log.some(([operation]) => operation === "play"), false);
    const all = templates(f.root.view);
    assert.equal(all.filter(entry => entry.strings.join("").includes("native-video-unavailable")).length, mixed ? 1 : 3);
    if (mixed) assert.equal(f.root.media[1].src, value.content.clips[0].media.url);
    const owned = [...f.root.media], report = f.owner.dispose();
    assert.equal(report.filter(entry => entry.operation === "pause").length, owned.length);
    assert.equal(report.filter(entry => entry.operation === "remove-source").length, owned.length);
    assert.equal(report.filter(entry => entry.operation === "reset-resource").length, owned.length);
    assert.ok(owned.every(player => player.src === "")); assert.equal(f.host.children.length, 0);
  });
});

test("native Video manual next selection pauses but never starts playback or advances on ended", t => {
  const f = fixture(t); f.activate(); const player = f.root.media[0];
  binding(f.root.playerTemplate, "@ended")({ currentTarget: player });
  assert.equal(player.dataset.sceneIndex, "0");
  const pickerTemplate = templates(f.root.view).find(entry => entry.strings.some(part => part.endsWith("@change=")));
  player.paused = false; binding(pickerTemplate, "@change")({ currentTarget: f.root.picker });
  assert.equal(player.dataset.sceneIndex, "1"); assert.equal(player.src, videoResult().content.clips[1].media.url);
  assert.equal(player.paused, true); assert.equal(f.log.some(([operation]) => operation === "play"), false);
});

test("native Video locale refresh preserves selected clip, native playback state and current-only ownership", t => {
  const value = videoResult(), f = fixture(t, value); f.activate();
  const player = f.root.media[0], picker = f.root.picker;
  binding(templates(f.root.view).find(entry => entry.strings.some(part => part.endsWith("@change="))), "@change")({ currentTarget: picker });
  assert.equal(player.dataset.sceneIndex, "1"); assert.equal(player.src, value.content.clips[1].media.url);
  player.paused = false; player.currentTime = 1.25;
  const before = { node: player, src: player.src, time: player.currentTime, focus: f.document.activeElement, log: f.log.length };
  const locale = f.options.locale; locale.locale = "fr";
  locale.t = (_id, fallback, values = {}) => "FR:" + fallback.replace(/\{(\w+)\}/gu, (_, key) => String(values[key] ?? ""));
  assert.equal(typeof f.owner.refresh, "function"); f.owner.refresh();
  assert.equal(f.root.media[0], before.node); assert.equal(player.src, before.src); assert.equal(player.currentTime, before.time);
  assert.equal(player.paused, false); assert.equal(f.document.activeElement, before.focus);
  assert.equal(player.dataset.sceneIndex, "1"); assert.equal(picker.value, "1");
  assert.deepEqual(f.log.slice(before.log).filter(([operation]) => ["pause", "play", "focus", "render-source", "remove-source", "reset-resource"].includes(operation)), []);
  assert.equal(player["aria-label"], "FR:Scene 2 of 2: " + value.content.clips[1].title);
  assert.equal(f.root.status.textContent, "FR:Scene 2 of 2: " + value.content.clips[1].title);
  const all = templates(f.root.view);
  assert.ok(all.some(entry => entry.values.includes("FR:Choose a scene")));
  assert.ok(all.some(entry => entry.values.includes(value.content.content_markdown)));
  for (const clip of value.content.clips) for (const field of ["title", "body", "notes"]) assert.ok(all.some(entry => entry.values.includes(clip[field])));
  f.select(videoResult("replacement")); const rendered = f.rendered.length; f.owner.refresh();
  assert.equal(f.rendered.length, rendered); assert.equal(f.host.children.length, 0); assert.equal(player.src, "");
  const report = f.owner.dispose(), closedLog = f.log.length; f.owner.refresh();
  assert.equal(f.owner.dispose(), report); assert.equal(f.log.length, closedLog);
});

test("the existing four-argument reel still advances and resumes playback", () => {
  const value = videoResult(), view = reelSource.renderVideoReel(value.content.clips.slice(0, 2).map(clip => ({ id: clip.id, title: clip.title, mediaUrl: clip.media.url, mediaType: clip.media.mediaType })), null, value.title, { locale: "en", number: String, t: (_id, fallback, values = {}) => fallback.replace(/\{(\w+)\}/gu, (_, key) => String(values[key] ?? "")) });
  const template = templates(view).find(entry => /<video\s/u.test(entry.strings.join("")));
  let plays = 0; const player = { dataset: { sceneIndex: "0" }, src: value.content.clips[0].media.url,
    setAttribute() {}, closest: () => null, play() { plays++; return Promise.resolve(); } };
  assert.equal(binding(template, "preload"), "metadata");
  binding(template, "@ended")({ currentTarget: player });
  assert.equal(player.dataset.sceneIndex, "1"); assert.equal(player.src, value.content.clips[1].media.url); assert.equal(plays, 1);
});

test("retired Video callbacks cannot act on a replacement and all cleanup operations are attempted", t => {
  const a = videoResult(), b = videoResult("b"), f = fixture(t, a); f.activate();
  const oldPlayer = f.root.media[0], oldPicker = f.root.picker;
  const oldChange = binding(templates(f.root.view).find(entry => entry.strings.some(part => part.endsWith("@change="))), "@change");
  const report = f.owner.dispose();
  assert.deepEqual(report.map(entry => entry.operation), ["pause", "remove-source", "reset-resource", "remove-root"]);
  assert.ok(report.every(entry => entry.outcome === "returned")); assert.ok(Object.isFrozen(report));
  f.select(b); f.mount(b); const nextRoot = f.host.children[0]; f.activate(nextRoot);
  const nextPlayer = nextRoot.media[0], before = f.log.length; oldChange({ currentTarget: oldPicker });
  assert.equal(f.log.length, before); assert.equal(nextPlayer.src, b.content.clips[0].media.url);
  assert.equal(oldPlayer.src, ""); assert.notEqual(oldPlayer, nextPlayer); assert.equal(f.owner.dispose(), report);
});

test("Video currentness is exact, captured and rechecked after native pause", async t => {
  for (const response of [false, undefined, 1, {}, "true"]) await t.test(String(response), child => {
    const f = fixture(child, videoResult(), { check: () => response }); assert.equal(f.host.children.length, 0); assert.equal(f.rendered.length, 0);
  });
  await t.test("captured callback", child => { const f = fixture(child); f.select(videoResult("b")); f.options.isCurrent = () => true; f.activate(); assert.equal(f.host.children.length, 0); });
  await t.test("pause retirement", child => {
    const f = fixture(child); f.activate(); const player = f.root.media[0];
    player.pause = () => f.owner.dispose();
    binding(templates(f.root.view).find(entry => entry.strings.some(part => part.endsWith("@change="))), "@change")({ currentTarget: f.root.picker });
    assert.equal(player.src, ""); assert.equal(player.dataset.sceneIndex, "0"); assert.equal(f.host.children.length, 0);
  });
});

test("Video Open retains native focus ownership on failed transfer and never steals moved focus", async t => {
  for (const setting of ["focusThrow", "focusNoop", "focusElsewhere"]) await t.test(setting, child => {
    const f = fixture(child, videoResult(), { [setting]: true }); f.activate();
    assert.equal(f.log.some(([operation]) => operation === "play"), false);
    if (setting === "focusElsewhere") { assert.equal(f.log.some(([operation]) => operation === "focus"), false); assert.equal(f.document.activeElement.elsewhere, true); }
    else { assert.equal(f.document.activeElement, f.root.origin); assert.equal(f.root.origin.isConnected, true); assert.equal(f.root.media.length, 0); }
  });
});

test("Video cleanup failures remain individually observable without a false stopped-playback claim", t => {
  const fail = new Set(["pause", "remove-source", "reset-resource", "remove-root"]), f = fixture(t, videoResult(), { fail }); f.activate();
  const player = f.root.media[0], report = f.owner.dispose();
  assert.deepEqual(report.map(entry => [entry.operation, entry.outcome]), [...fail].map(operation => [operation, "threw"]));
  assert.ok(report.every(entry => entry.error instanceof Error)); assert.ok(player.src.endsWith(".mp4")); assert.equal(f.owner.dispose(), report);
});

const classed = (tree, name) => tree.nodes.filter(node => node.attributes.class === name);
const rawText = node => node.children.map(child => typeof child === "string" ? child : rawText(child)).join("");
const { FormaRetainedShortStory } = await ports.loadActual("src/components/forma-retained-short-story.ts",
  new Map([["./native-retained-video.ts", { mountNativeRetainedVideo() { throw Error("Toolbar controls do not mount the leaf"); } }]]));

// The actual Host and decoder run against the existing finite ports. Observe
// its public toolbar template without invoking updated() or Lit's DOM mount.
function retainedHostFixture(t, initialFragment = "") {
  const result = videoResult(), selected = result.selection, listeners = new Set();
  const route = `/make/video?document=${selected.documentId}&artifact=${selected.artifactId}&revision=0&sha256=${selected.contentSha256}`;
  const cell = value => ({ get: () => value, set(next) { value = next; } });
  const authorization = { key: "synthetic-retained-reader", shared: false }, source = { generation: 1 };
  const authority = { active: true, sourceActive: true };
  const requests = [], handoffs = [];
  const store = {
    route: cell(route + initialFragment), loading: cell(false), events: cell([]),
    session: cell({ user: { userId: "synthetic-reader", role: "creator" } }),
    projection: cell({ documentId: selected.documentId, projectId: "project-a", libraryArtifacts: [{
      id: selected.artifactId, documentId: selected.documentId, kind: "video", sourceEventId: "completion-a",
      contentRef: "private-content-a", sequence: 2,
    }] }),
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    captureAuthorizationScope: () => authorization,
    authorizationScopeActive: captured => captured === authorization && authority.active,
    captureSourceOwnership: () => source,
    sourceOwnershipActive: captured => captured === source && authority.sourceActive,
    setRoute(path, controls) { handoffs.push({ path, controls }); },
    guardedFetch(path, init, operation, controls) {
      let resolve;
      const promise = new Promise(complete => { resolve = complete; });
      const request = { path, init, operation, current: controls.current, aborts: 0, settled: false,
        fulfill(value = result) {
          assert.equal(this.settled, false); this.settled = true;
          const response = new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
          Object.defineProperty(response, "url", { value: new URL(path, "https://fixture.invalid").href });
          resolve(response);
        } };
      init.signal.addEventListener("abort", () => { request.aborts++; }, { once: true });
      requests.push(request);
      return promise;
    },
  };
  const f = { store, trace: [], listeners: new Map(), changed: new Map(), requested: false,
    i18n: { locale: "en", t: (_key, fallback) => fallback, system: value => value }, tick: async () => true,
    frames: new Map(), timers: new Map(), timerSequence: 0, resizeTargets: new Map(), storage: new Map() };
  ports.bindFixture(f);
  f.host = new FormaRetainedShortStory(); f.host.tag = "forma-retained-short-story"; f.host.attributes = {};
  Object.defineProperty(f.host, "ownerDocument", { value: { location: { origin: "https://fixture.invalid" } } });
  f.renderer = new ports.RendererPort(f, {});
  const notify = () => { ports.bindFixture(f); for (const callback of [...listeners]) callback(); };
  const tree = () => { ports.bindFixture(f); return fullPageTree(f, f.renderer.value(f.host.render(), f.host, "retained-host")); };
  const changeRoute = next => { store.route.set(next); notify(); };
  const retire = event => {
    if (event === "forma-authorization-changed") authority.active = false;
    else authority.sourceActive = false;
    ports.bindFixture(f);
    for (const callback of [...(f.listeners.get(event) ?? [])]) callback({ type: event });
    notify();
  };
  f.host.isConnected = true;
  f.host.connectedCallback();
  t.after(async () => {
    ports.bindFixture(f); f.host.isConnected = false; f.host.disconnectedCallback();
    for (const request of requests) if (!request.settled) request.fulfill();
    await new Promise(resolve => setImmediate(resolve));
    ports.bindFixture(null);
  });
  return { f, route, store, requests, tree, changeRoute, retire, handoffs };
}

test("native Video Host preserves one owner through initial, pending and ready URL fragments", async t => {
  for (const initialFragment of ["", "#main-content"]) await t.test(initialFragment || "without initial fragment", async child => {
    const f = retainedHostFixture(child, initialFragment);
    assert.equal(f.requests.length, 1, "an initial fragment still starts the exact retained read");
    const request = f.requests[0];
    assert.equal(request.current(), true); assert.equal(request.init.signal.aborted, false);
    assert.equal(request.init.method, "GET"); assert.equal(request.init.cache, "no-store");
    assert.equal(request.path.includes("#"), false, "the actual decoder receives the literal fragment-free API path");
    assert.equal(f.tree().visible("a").length, 0);
    f.changeRoute(f.route + "#pending-reader");
    assert.equal(f.requests.length, 1); assert.equal(request.current(), true); assert.equal(request.aborts, 0);
    request.fulfill();
    await new Promise(resolve => setImmediate(resolve));
    const ready = f.tree(), handoff = ready.visible("a");
    assert.equal(handoff.length, 1, "the original response reaches the ready Host through the actual decoder");
    assert.equal(rawText(handoff[0]), "Edit in Forma");
    const href = handoff[0].attributes.href;
    assert.equal(rawText(classed(ready, "retained-story-status")[0]), "");
    for (const fragment of ["#main-content", "#other-section", ""]) {
      f.changeRoute(f.route + fragment);
      const current = f.tree();
      assert.equal(f.requests.length, 1); assert.equal(request.current(), true);
      assert.equal(request.init.signal.aborted, false); assert.equal(request.aborts, 0);
      assert.equal(current.visible("a")[0]?.attributes.href, href);
      assert.equal(rawText(classed(current, "retained-story-status")[0]), "");
    }
  });
});

test("native Video Host still withdraws ready output for changed selection, authorization or source retirement", async t => {
  for (const cause of ["selection", "forma-authorization-changed", "forma-event-source-retired"]) await t.test(cause, async child => {
    const f = retainedHostFixture(child, "#main-content"), request = f.requests[0];
    assert.ok(request); request.fulfill();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.tree().visible("a").length, 1);
    if (cause === "selection") f.changeRoute(f.route.replace("artifact=video-a", "artifact=video-b") + "#main-content");
    else f.retire(cause);
    assert.equal(request.init.signal.aborted, true); assert.equal(request.current(), false); assert.equal(request.aborts, 1);
    assert.equal(f.tree().visible("a").length, 0);
    assert.equal(rawText(classed(f.tree(), "retained-story-status")[0]), "Unavailable");
    assert.equal(f.requests.length, 1, "the withdrawn owner never requests a replacement result");
  });
});

test("native Video actual Host handoff captures the exact current Document/output revision and retires its guard", async t => {
  const f = retainedHostFixture(t), request = f.requests[0]; request.fulfill();
  await new Promise(resolve => setImmediate(resolve));
  const value = f.f.host.render(), linkTemplate = templates(value).find(entry => entry.strings.join("").includes("href="));
  assert.ok(linkTemplate); const click = binding(linkTemplate, "@click");
  const event = () => ({ button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    preventDefault() { this.defaultPrevented = true; } });
  const current = event(); click.call(f.f.host, current);
  assert.equal(current.defaultPrevented, true); assert.equal(f.handoffs.length, 1);
  const handoff = f.handoffs[0]; assert.equal(handoff.controls.documentId, "document-a"); assert.equal(handoff.controls.current(), true);
  assert.equal(projectTaskDocumentIdFromRoute(handoff.path), "document-a");
  assert.deepEqual(libraryFocusFromRoute(handoff.path), { kind: "artifact", id: "video-a" });
  assert.deepEqual(artifactFocusOptionsFromRoute(handoff.path), { expectedRevision: 0, expectedContentSha256: "a".repeat(64), intent: "inspect" });
  f.retire("forma-event-source-retired"); assert.equal(handoff.controls.current(), false);
  const stale = event(); click.call(f.f.host, stale);
  assert.equal(stale.defaultPrevented, true); assert.equal(f.handoffs.length, 1); assert.equal(f.tree().visible("a").length, 0);
});
