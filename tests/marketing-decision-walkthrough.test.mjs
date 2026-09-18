// Public decision-change walkthrough regression; requires a current Worker build.
// Actual public Worker rendering + the current complete FormaOutputPreview class
// and shared native-dialog helper; finite native ports follow marketing-landing.
// This is not physical browser/AT, live propagation, assignment or generation proof.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { ensureNativeModalDialog } from "../src/components/design-system/native-dialog.ts";
import { marketingPath } from "../src/marketing/profiles.ts";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");
const [html, source] = await Promise.all([read("marketing.html"), read("src/marketing/main.ts")]);
const worker = (await import("../dist/server/index.js")).default;
const first = source.indexOf("class FormaOutputPreview {"), last = source.indexOf("\nclass FormaImageViewer {", first);
assert.ok(first >= 0 && last > first);
const behavior = stripTypeScriptTypes(source.slice(first, last)) + "\nglobalThis.Preview = FormaOutputPreview;";
const locales = ["en", "fr", "ar", "ja"];
const profiles = ["generic", "marketers", "hollywood-filmmakers", "indie-filmmakers"];
const keys = ["demoChangeTitle", "demoChangeDisclosure", "demoChangeBefore", "demoChangeAfter",
  "demoChangeAffected", "demoChangeReview", "demoChangeStatus"];
const decode = value => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'").replaceAll("&amp;", "&");
const text = value => decode(value.replace(/<[^>]*>/gu, "")).replace(/\s+/gu, " ").trim();
const attrs = value => new Map([...value.matchAll(/([\w:-]+)="([^"]*)"/gu)].map(([, key, value]) => [key, decode(value)]));
const options = { concurrency: false, timeout: 30_000 };

async function page(profile, locale) {
  const calls = [], forbidden = [];
  const env = {
    get DB() { forbidden.push("DB"); throw Error("Public read accessed DB"); },
    get MEDIA() { forbidden.push("MEDIA"); throw Error("Public read accessed private media"); },
    ASSETS: { async fetch(request) {
      calls.push({ path: new URL(request.url).pathname, method: request.method });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    } },
  };
  const response = await worker.fetch(new Request("https://forma.test" + marketingPath(profile, locale)), env, {
    waitUntil() { forbidden.push("background"); throw Error("Public read scheduled work"); },
  });
  assert.equal(response.status, 200); assert.equal(response.headers.get("x-forma-route-family"), "marketing");
  const rendered = await response.text();
  assert.deepEqual(calls, [{ path: "/marketing", method: "GET" }]); assert.deepEqual(forbidden, []);
  const base = (await import("../src/marketing/locales/" + locale + ".ts")).default;
  const overlay = profile === "generic" ? {} : (await import("../src/marketing/profiles/" + profile + "/" + locale + ".ts")).default;
  return { rendered, messages: { ...base, ...overlay }, calls, forbidden };
}

class Element {
  constructor(properties = {}) {
    Object.assign(this, { dataset: {}, hidden: false, disabled: false, children: [], listeners: new Map(),
      attributes: new Map(), focused: 0, scrollTop: 72, isConnected: true, open: false, modal: false }, properties);
  }
  get id() { return this.attributes.get("id") ?? ""; }
  set id(value) { this.attributes.set("id", value); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "open") this.open = true; }
  removeAttribute(name) { this.attributes.delete(name); if (name === "open") { this.open = false; this.modal = false; } }
  matches(selector) { return selector === ":modal" && this.modal; }
  querySelector(selector) { return this.lookup?.[selector] ?? null; }
  querySelectorAll(selector) { return selector === "[data-preview-page]" ? this.pages ?? [] : []; }
  replaceChildren(...children) {
    this.children = children;
    for (const child of children) {
      if (child.parent) child.parent.children = child.parent.children.filter(sibling => sibling !== child);
      child.parent = this;
    }
  }
  append(child) {
    if (child.parent) child.parent.children = child.parent.children.filter(sibling => sibling !== child);
    this.children.push(child); child.parent = this;
  }
  focus() { this.focused += 1; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  emit(type, properties = {}) {
    const event = { type, target: this, button: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...properties };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
}

function previewFixture(rendered, messages, { unsupported = false, fail = false, wrongTarget = false } = {}) {
  const walkthrough = rendered.match(/<details class="context-change" data-public-change-demo>([\s\S]*?)<\/details>/u)?.[1];
  assert.ok(walkthrough, "The current public document contains the ordinary inline disclosure");
  const disclosure = new Element(), summary = new Element();
  summary.parent = disclosure; disclosure.children = [summary];
  const links = [...walkthrough.matchAll(/<a\b([^>]*data-demo-preview="([^"]+)"[^>]*)>([\s\S]*?)<\/a>/gu)].map(([, attributes, kind, body]) => {
    const link = new Element({ attributes: attrs(attributes), dataset: { demoPreview: kind }, textContent: text(body), parent: disclosure });
    disclosure.children.push(link); return link;
  });
  assert.equal(links.length, 2);
  const rows = [...rendered.matchAll(/<details class="output-preview" data-output-preview="([^"]+)">([\s\S]*?)<\/details>/gu)].map(([, kind, body]) => {
    const header = body.match(/<summary\b([^>]*)>([\s\S]*?)<\/summary>/u); assert.ok(header);
    const summary = new Element({ attributes: attrs(header[1]), textContent: text(header[2]) });
    const pages = [...body.matchAll(/data-preview-page="([^"]+)"/gu)].map(([, value]) => new Element({ dataset: { previewPage: value } }));
    assert.ok(pages.length);
    const panel = new Element({ dataset: { previewPanel: kind }, pages, originalBody: body });
    const details = new Element({ dataset: { outputPreview: kind }, children: [summary, panel] });
    summary.parent = details; panel.parent = details;
    details.querySelector = selector => selector === "summary" ? summary : selector === "[data-preview-panel]" && panel.parent === details ? panel : null;
    return { kind, details, summary, panel };
  });
  assert.equal(rows.length, 4);
  if (wrongTarget) links[0].setAttribute("href", links[1].getAttribute("href"));
  const host = new Element(), heading = new Element(), close = new Element(), previous = new Element(),
    next = new Element(), status = new Element(), navigation = new Element(), announced = [], forbidden = [];
  const dialog = new Element({ attributes: new Map([["id", "marketing-preview"], ["aria-labelledby", "marketing-preview-title"]]),
    lookup: { "[data-preview-host]": host, "#marketing-preview-title": heading, "[data-preview-close]": close,
      "[data-preview-previous]": previous, "[data-preview-next]": next, "[data-preview-status]": status, "[data-preview-navigation]": navigation } });
  if (!unsupported) dialog.showModal = () => { if (fail) throw Error("Finite native top-layer refusal"); dialog.open = true; dialog.modal = true; };
  dialog.close = () => { dialog.open = false; dialog.modal = false; dialog.emit("close"); };
  const document = new Element({ documentElement: { lang: rendered.match(/<html lang="([^"]+)"/u)?.[1],
    dir: rendered.match(/<html lang="[^"]+" dir="([^"]+)"/u)?.[1], dataset: {} } });
  document.querySelectorAll = selector => selector === "[data-output-preview]" ? rows.map(row => row.details)
    : selector === "[data-demo-preview]" ? links : [];
  document.dispatchEvent = event => { announced.push(event.type); document.emit(event.type, { detail: event.detail }); };
  const owned = [disclosure, summary, ...links, host, heading, close, previous, next, status, navigation, dialog,
    ...rows.flatMap(row => [row.details, row.summary, row.panel, ...row.panel.pages])];
  for (const node of owned) node.ownerDocument = document;
  const deny = kind => () => { forbidden.push(kind); throw Error("Unexpected public side effect: " + kind); };
  const context = { document, messages, Intl, CustomEvent, ensureNativeModalDialog,
    fetch: deny("fetch"), navigator: { sendBeacon: deny("beacon") },
    localStorage: { setItem: deny("storage") }, history: { pushState: deny("history"), replaceState: deny("history") } };
  runInNewContext(behavior, context); new context.Preview(dialog);
  return { walkthrough, disclosure, links, rows, host, close, previous, next, status, dialog, document, announced, forbidden,
    open() { const event = summary.emit("click"); if (!event.defaultPrevented) disclosure.open = !disclosure.open; assert.equal(disclosure.open, true); },
    activate(link, properties) { assert.equal(disclosure.open, true); assert.ok(link.isConnected && link.parent === disclosure); return link.emit("click", properties); } };
}

for (const profile of profiles) for (const locale of locales) test("E fixed public change uses exact current previews: " + profile + "/" + locale, options, async () => {
  const p = await page(profile, locale), f = previewFixture(p.rendered, p.messages);
  for (const key of keys) assert.ok(f.walkthrough.includes(p.messages[key].replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")), key);
  assert.ok(text(f.walkthrough).includes(p.messages.creativeBoundaryValue), "The profile's exact existing boundary stays authored");
  assert.equal(f.disclosure.open, false); f.open();
  const initialBodies = f.rows.map(row => row.panel.originalBody);
  for (const [kind, title] of [["story", p.messages.storyHeading], ["presentation", p.messages.slideTitle]]) {
    const link = f.links.find(link => link.dataset.demoPreview === kind), row = f.rows.find(row => row.kind === kind);
    assert.ok(link.textContent.includes(title)); assert.equal(link.getAttribute("href"), "#" + row.summary.id);
    assert.equal(link.getAttribute("aria-haspopup"), "dialog"); assert.equal(link.getAttribute("aria-controls"), f.dialog.id);
    assert.equal(f.activate(link).defaultPrevented, true);
    assert.equal(f.dialog.open, true); assert.equal(row.panel.parent, f.host);
    assert.ok(f.rows.filter(other => other !== row).every(other => other.panel.parent === other.details));
    assert.equal(row.panel.pages.filter(page => !page.hidden).length, 1); assert.equal(f.document.activeElement, f.close);
    f.next.emit("click"); assert.equal(row.panel.pages[1].hidden, false);
    f.dialog.close();
    assert.equal(row.panel.parent, row.details); assert.ok(row.panel.pages.every(page => !page.hidden));
    assert.equal(f.document.activeElement, link); assert.equal(f.dialog.open, false); assert.equal(f.host.children.length, 0);
  }
  assert.deepEqual(f.rows.map(row => row.panel.originalBody), initialBodies);
  assert.equal(text(f.walkthrough).includes(p.messages.demoChangeStatus), true);
  assert.deepEqual(f.forbidden, []); assert.deepEqual(p.forbidden, []);
  assert.deepEqual(f.announced, ["forma-marketing-preview-open", "forma-marketing-preview-close",
    "forma-marketing-preview-open", "forma-marketing-preview-close"]);
});

for (const mode of ["unsupported", "failed"]) test("E exact public link retains readable native fallback: " + mode, options, async () => {
  const p = await page("marketers", "ja"), f = previewFixture(p.rendered, p.messages, { unsupported: mode === "unsupported", fail: mode === "failed" });
  f.open();
  for (const link of f.links) {
    const row = f.rows.find(row => row.kind === link.dataset.demoPreview);
    assert.equal(f.activate(link).defaultPrevented, false, "Native fragment navigation still reaches the exact summary");
    assert.equal(f.dialog.open, false); assert.equal(row.details.open, true); assert.equal(row.panel.parent, row.details);
    assert.ok(row.panel.pages.every(page => !page.hidden));
    if (mode === "unsupported") assert.equal(row.summary.attributes.has("aria-haspopup"), false);
  }
  assert.deepEqual(f.announced, []); assert.deepEqual(f.forbidden, []);
});

test("E current public preview anchors preserve modified-link intent", options, async () => {
  const p = await page("generic", "en"), f = previewFixture(p.rendered, p.messages); f.open();
  for (const gesture of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])
    assert.equal(f.activate(f.links[0], gesture).defaultPrevented, false);
  assert.equal(f.dialog.open, false); assert.ok(f.rows.every(row => row.panel.parent === row.details));
  assert.deepEqual(f.announced, []); assert.deepEqual(f.forbidden, []);
});

test("E a mismatched example identity never falls back to the first preview", options, async () => {
  const p = await page("generic", "en"), f = previewFixture(p.rendered, p.messages, { wrongTarget: true }); f.open();
  assert.equal(f.links[0].attributes.has("aria-controls"), false);
  assert.equal(f.activate(f.links[0]).defaultPrevented, false); assert.equal(f.dialog.open, false);
  assert.ok(f.rows.every(row => row.panel.parent === row.details)); assert.deepEqual(f.forbidden, []);
});

test("E retired public anchor delivery does not promote a preview (defensive contract)", options, async () => {
  const p = await page("generic", "en"), f = previewFixture(p.rendered, p.messages); f.open();
  const old = f.links[0]; old.isConnected = false;
  // Deliberate stale-event delivery, not an ordinary disconnected-control incident.
  old.emit("click"); assert.equal(f.dialog.open, false); assert.deepEqual(f.announced, []); assert.deepEqual(f.forbidden, []);
});

test("E public illustration keeps the existing studies, preview corpus and public isolation", () => {
  const block = html.match(/<details class="context-change" data-public-change-demo>([\s\S]*?)<\/details>/u)?.[1]; assert.ok(block);
  assert.doesNotMatch(block, /<(?:img|video|audio|dialog|form|input|button)\b|popover=|data-context=/u);
  assert.equal([...html.matchAll(/class="context-choice"/gu)].length, 4);
  assert.equal([...html.matchAll(/<dialog class="marketing-preview-dialog"/gu)].length, 1);
  assert.equal([...html.matchAll(/<details class="output-preview" data-output-preview=/gu)].length, 4);
  assert.doesNotMatch(source, /fetch\(|navigator\.sendBeacon|FormaStore|\/api\/(?:session|media|jobs)/u);
  assert.match(block, /href="#example-story-preview" data-demo-preview="story"/u);
  assert.match(block, /href="#example-presentation-preview" data-demo-preview="presentation"/u);
});
