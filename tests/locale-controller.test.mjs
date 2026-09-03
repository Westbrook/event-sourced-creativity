import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { FormaLocaleController, installFormaLocaleRoot, LOCALE_CONTEXT } from "../src/components/design-system/locale-controller.ts";

class Host extends EventTarget {
  updates = 0;
  addController(controller) { this.controller = controller; }
  requestUpdate() { this.updates++; }
}
const snapshot = (locale = "en", messages = {}) => ({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC", messages, revision: 1 });
test("rootless controls retain explicit fallbacks, late roots and scoped subscriptions", () => {
  const host = new Host(), controller = new FormaLocaleController(host);
  controller.hostConnected();
  assert.equal(controller.t("action.default", "Action"), "Action");
  assert.equal(controller.system("Authored value"), "Authored value");
  let current = snapshot("fr", { "action.default": "Action française" });
  const callbacks = new Set();
  installFormaLocaleRoot({ current: () => current, subscribe: callback => { callbacks.add(callback); return () => callbacks.delete(callback); }, defaults: () => ({ "field.text": "Text" }), defaultMessageId: source => source === "Text" ? "field.text" : undefined });
  assert.equal(controller.locale, "fr"); assert.equal(controller.t("action.default"), "Action française");
  assert.equal(controller.t("field.text"), "Text");
  assert.equal(controller.number(1234), new Intl.NumberFormat("fr").format(1234));
  assert.equal(controller.firstGrapheme("👨‍👩‍👦Hello"), "👨‍👩‍👦");
  const scopedHost = new Host(), scoped = new FormaLocaleController(scopedHost);
  let disconnected = 0;
  scopedHost.addEventListener("context-request", event => { assert.equal(event.context, LOCALE_CONTEXT); event.callback(snapshot("ja", { "field.text": "テキスト" }), () => { disconnected++; }); });
  scoped.hostConnected(); assert.equal(scoped.locale, "ja");
  current = snapshot("ar"); for (const callback of callbacks) callback(current);
  assert.equal(controller.direction, "rtl"); assert.equal(scoped.locale, "ja");
  controller.hostDisconnected(); const updates = host.updates;
  current = snapshot("en"); for (const callback of callbacks) callback(current);
  assert.equal(host.updates, updates);
  controller.hostConnected(); assert.equal(controller.locale, "en");
  scoped.hostDisconnected(); assert.equal(disconnected, 1);
  installFormaLocaleRoot({ current: () => snapshot("ja"), subscribe: () => () => {}, defaults: () => ({}), defaultMessageId: () => undefined });
  assert.equal(controller.locale, "ja"); assert.equal(callbacks.size, 0);
  controller.hostDisconnected();
});

// Native event/attribute ports only; this checks the actual shared controller and
// locale façade, not browser geometry, focus, accessibility or rendered pixels.
test("old and new imports share one root through all languages and nested scope lifetimes", async () => {
  class Element extends EventTarget {
    attributes = new Map(); isConnected = true; parentElement = null;
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { const old = this.getAttribute(name); this.attributes.set(name, String(value)); if (this.constructor.observedAttributes?.includes(name)) this.attributeChangedCallback(name, old, String(value)); }
    matches(selector) { return selector === ":dir(rtl)" && this.getAttribute("dir") === "rtl"; }
    dispatchEvent(event) { const result = super.dispatchEvent(event); if (event.bubbles && !event.cancelBubble && this.parentElement) this.parentElement.dispatchEvent(event); return result; }
  }
  const originals = new Map(["HTMLElement", "customElements", "document", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const registry = new Map(), document = new EventTarget(); document.documentElement = new Element();
  Object.assign(globalThis, { HTMLElement: Element, document, localStorage: { setItem() {}, getItem() { return null; } }, customElements: { get: name => registry.get(name), define(name, constructor) { assert.equal(registry.has(name), false); registry.set(name, constructor); } } });
  const root = new URL("../", import.meta.url).href;
  const resolver = registerHooks({ resolve(specifier, context, next) { return next(context.parentURL?.startsWith(root) && specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + ".ts" : specifier, context); } });
  try {
    const facade = await import("../src/components/design-system/localization.ts");
    assert.equal(facade.FormaLocaleController, FormaLocaleController);
    const host = new Host(), controller = new facade.FormaLocaleController(host); controller.hostConnected();
    for (const locale of ["en", "fr", "ar", "ja"]) {
      const active = await facade.setFormaLocale(locale, { persist: false, formatLocale: "en-GB", timeZone: "Europe/London" });
      assert.equal(controller.locale, locale); assert.equal(controller.messages, active.messages);
      assert.equal(controller.direction, locale === "ar" ? "rtl" : "ltr");
      assert.equal(controller.timeZone, "Europe/London"); assert.equal(controller.number(1234.5), new Intl.NumberFormat("en-GB").format(1234.5));
      assert.equal(controller.system("Action"), controller.t("action.default"));
    }
    await Promise.all([facade.setFormaLocale("fr", { persist: false }), facade.setFormaLocale("ar", { persist: false }), facade.setFormaLocale("ja", { persist: false })]);
    assert.equal(controller.locale, "ja"); assert.equal(document.documentElement.lang, "ja");
    const outer = new facade.FormaUiLocale(); outer.setAttribute("lang", "fr"); outer.connectedCallback();
    const inner = new facade.FormaUiLocale(); inner.parentElement = outer; inner.setAttribute("lang", "ar"); inner.timeZone = "Asia/Tokyo"; inner.formatLocale = "ja-JP"; inner.messages = { "test.message": "Scoped" }; inner.connectedCallback();
    const child = new Host(); child.dispatchEvent = event => inner.dispatchEvent(event);
    const scoped = new FormaLocaleController(child); scoped.hostConnected();
    assert.equal(scoped.locale, "ar"); assert.equal(scoped.direction, "rtl"); assert.equal(scoped.timeZone, "Asia/Tokyo"); assert.equal(scoped.t("test.message"), "Scoped");
    await facade.setFormaLocale("en", { persist: false }); assert.equal(scoped.locale, "ar");
    scoped.hostDisconnected(); const updates = child.updates;
    inner.messages = { "test.message": "Changed" }; assert.equal(child.updates, updates);
    child.dispatchEvent = event => outer.dispatchEvent(event); scoped.hostConnected(); assert.equal(scoped.locale, "fr");
    scoped.hostDisconnected(); inner.disconnectedCallback(); outer.disconnectedCallback();
    controller.hostDisconnected(); const stopped = host.updates; await facade.setFormaLocale("fr", { persist: false }); assert.equal(host.updates, stopped);
    controller.hostConnected(); assert.equal(controller.locale, "fr");
    await facade.setFormaLocale("xx-XX", { persist: false }); assert.equal(controller.locale, "en");
    controller.hostDisconnected(); assert.equal(registry.get("forma-ui-locale"), facade.FormaUiLocale); assert.equal(registry.size, 1);
  } finally {
    resolver.deregister();
    for (const [key, original] of originals) { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; }
  }
});
