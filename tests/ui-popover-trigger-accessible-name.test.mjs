import assert from "node:assert/strict";
import test from "node:test";
import { fixture, documentPort } from "./helpers/canvas-focus-repair-host.mjs";

// Complete existing Popover + unchanged default Canvas consumer. The finite
// native/template ports certify emitted naming and ownership, not browser/AT
// accessible-name computation, physical geometry or provider behavior.
function current(f) {
  const menus = f.renderer.query(f.host, "forma-ui-popover")
    .filter(menu => menu.attributes.class === "canvas-view-menu");
  assert.equal(menus.length, 1);
  const menu = menus[0];
  assert.equal(menu.constructor.name, "FormaUiPopover");
  const panels = f.renderer.ownNodes(menu, "section").filter(node => node.attributes.popover === "auto");
  assert.equal(panels.length, 1);
  const panel = panels[0], triggers = f.renderer.ownNodes(menu, "button")
    .filter(node => node.attributes.popovertarget === panel.attributes.id);
  assert.equal(triggers.length, 1);
  const trigger = triggers[0], start = menu.markup.indexOf(trigger.full) + trigger.full.length;
  assert.ok(start >= trigger.full.length, "the actual native invoker occurs in this owner's markup");
  const visible = menu.markup.slice(start, menu.markup.indexOf("</button>", start));
  assert.equal(trigger.attributes["aria-controls"], panel.attributes.id);
  return { menu, panel, trigger, visible };
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("native Popover separates optional trigger name without changing default consumer / " + locale, t => {
    const network = t.mock.method(globalThis, "fetch", async () => assert.fail("No network is allowed in the primitive naming control."));
    const f = fixture({ populated: true, documentCount: 1, chosen: "document-0", locale });
    documentPort.activeElement = documentPort.body;
    t.after(() => {
      f.host.isConnected = false; f.host.disconnectedCallback();
      for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) {
        instance.isConnected = false; instance.disconnectedCallback();
      }
      f.i18n.hostDisconnected();
      assert.equal(network.mock.callCount(), 0);
    });
    const before = structuredClone(f.state.events), initial = current(f);
    const visible = initial.menu.label, panelName = initial.panel.attributes["aria-label"];
    const triggerId = initial.trigger.attributes.id, panelId = initial.panel.attributes.id;
    assert.ok(visible);
    assert.equal(initial.visible, visible);
    assert.equal(Object.hasOwn(initial.trigger.attributes, "aria-label"), false,
      "an unchanged default consumer uses its existing visible native name");
    assert.equal(initial.trigger.attributes["aria-expanded"], "false");
    const exact = f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", {
      action: visible, name: "\u2068Exact café العربية 日本語\u2069 · \u2068Document context\u2069",
    });
    initial.menu.triggerAccessibleName = exact; initial.menu.requestUpdate(); f.draw();
    let owned = current(f);
    assert.equal(owned.menu, initial.menu);
    assert.equal(owned.visible, visible, "context does not lengthen the visible trigger");
    assert.equal(owned.trigger.attributes["aria-label"], exact, "the override belongs to the actual native button");
    assert.ok(owned.trigger.attributes["aria-label"].startsWith(visible));
    assert.equal(owned.panel.attributes["aria-label"], panelName, "trigger naming does not rename the panel");
    assert.equal(owned.trigger.attributes.id, triggerId); assert.equal(owned.panel.attributes.id, panelId);
    owned.trigger.focus();
    owned.trigger.handlers.click.call(owned.menu, { currentTarget: owned.trigger });
    owned.panel.showPopover(); // Existing finite declarative-popover default.
    f.draw(); owned = current(f);
    assert.equal(owned.panel.matches(":popover-open"), true);
    assert.equal(owned.trigger.attributes["aria-expanded"], "true");
    owned.menu.close(true);
    assert.equal(documentPort.activeElement, owned.trigger);
    f.draw(); owned = current(f);
    assert.equal(owned.panel.matches(":popover-open"), false);
    assert.equal(owned.trigger.attributes["aria-expanded"], "false");
    for (const empty of ["", " \t "]) {
      owned.menu.triggerAccessibleName = empty; owned.menu.requestUpdate(); f.draw();
      owned = current(f);
      assert.equal(owned.visible, visible);
      assert.equal(Object.hasOwn(owned.trigger.attributes, "aria-label"), false,
        "empty or whitespace override restores the original native text name");
      assert.equal(owned.panel.attributes["aria-label"], panelName);
      assert.equal(owned.trigger.attributes.id, triggerId); assert.equal(owned.panel.attributes.id, panelId);
    }
    assert.deepEqual(f.state.events, before);
    assert.equal(f.state.requests.length, 0); assert.equal(f.state.batches.length, 0);
  });
}
