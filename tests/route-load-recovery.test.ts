import test from "node:test";
import assert from "node:assert/strict";
import { installRouteLoadRecovery, routeLoadRecoveryCopy } from "../src/route-load-recovery.ts";

test("missing route prompts one explicit refresh without replacing content or moving focus", () => {
  const listeners = new Map<string, () => void>(); let reloads = 0;
  function node() {
    return { isConnected: true, attributes: new Map(), children: [] as ReturnType<typeof node>[], textContent: "", className: "", type: "",
      events: new Map<string, () => void>(), shown: 0,
      setAttribute(key: string, value: string) { this.attributes.set(key, value); },
      removeAttribute(key: string) { this.attributes.delete(key); },
      append(...values: ReturnType<typeof node>[]) { this.children.push(...values); },
      addEventListener(key: string, callback: () => void) { this.events.set(key, callback); },
      showPopover() { this.shown++; } };
  }
  const existing = node(), body = node(); body.children.push(existing);
  const view = { addEventListener: (key: string, callback: () => void) => listeners.set(key, callback), location: { reload() { reloads++; } } };
  const owner = { body, documentElement: { lang: "en" }, createElement: node };
  installRouteLoadRecovery(view as unknown as Window, owner as unknown as Document);
  assert.equal(body.children.length, 1);
  listeners.get("vite:preloadError")!(); listeners.get("vite:preloadError")!();
  assert.equal(reloads, 0); assert.equal(body.children.length, 2); assert.equal(body.children[0], existing);
  const notice = body.children[1]!; assert.equal(notice.attributes.get("role"), "alert");
  assert.equal(notice.attributes.get("popover"), "manual"); assert.equal(notice.shown, 1);
  assert.match(notice.children[1]!.textContent, /unsaved text/);
  notice.children[2]!.events.get("click")!(); assert.equal(reloads, 1);
});
test("all supported locales explain loading failure without exposing error or URL content", () => {
  for (const locale of ["en", "fr-CA", "ar", "ja"]) {
    const copy = routeLoadRecoveryCopy(locale);
    assert.ok(copy.title.length > 5 && copy.help.length > 20 && copy.reload.length > 3);
  }
  assert.deepEqual(routeLoadRecoveryCopy("unknown"), routeLoadRecoveryCopy("en"));
});
