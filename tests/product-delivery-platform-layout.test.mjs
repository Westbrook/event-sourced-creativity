// Separate E fixture-context check. Original Platform10 bodies remain untouched.
// Full current Platform/Product/Delivery and actual light-DOM Cluster; finite
// native controls and one real nonfinancial RAM Worker Create, not a browser.
import assert from "node:assert/strict";
import test from "node:test";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { originalDraft, canonical, currentDelivery, currentCreate, submitCurrent,
  platformDeliveryFixture } from "./helpers/product-platform-fragment-fixture.mjs";

const within = (node, parent) => { for (let current = node.parent; current; current = current.parent) if (current === parent) return true; return false; };
test("E nested Platform uses actual Cluster and preserves current Delivery-owned Edit/Hide/Save controls",
  { concurrency: false, timeout: 45000 }, async t => {
    const f = await platformDeliveryFixture(t), owner = currentDelivery(f), create = currentCreate(f).form;
    f.fill(create, originalDraft); await submitCurrent(f);
    assert.equal(f.decisions().length, 1); assert.equal(f.creationEvents().length, 1);
    assert.equal(f.committed.length, 1); assert.equal(f.committed[0].status, 201);
    const id = f.decisions()[0].decision_id, before = canonical(f), calls = f.calls.length, money = f.financial();
    const { FormaUiCluster } = await ports.loadActual("src/components/design-system/layout.ts");
    assert.equal(f.renderer.registry["forma-ui-cluster"], FormaUiCluster, "The nested registry replaces, rather than inherits, the standalone registry.");
    const inspect = () => {
      f.draw(); const tree = f.tree();
      const forms = tree.nodes.filter(node => node.tag === "form" && node.owner === owner && node.attributes["data-delivery-decision-id"] === id);
      assert.equal(forms.length, 1);
      const clusters = tree.nodes.filter(node => node.tag === "forma-ui-cluster" && within(node, forms[0]));
      assert.equal(clusters.length, 1); assert.ok(clusters[0].component instanceof FormaUiCluster);
      assert.equal(clusters[0].component.isConnected, true); assert.equal(clusters[0].attributes.alignment, "stretch");
      const save = tree.nodes.filter(node => node.tag === "button" && node.attributes.type === "submit" && within(node, clusters[0]));
      assert.equal(save.length, 1); assert.equal(save[0].owner, owner); assert.equal(save[0].port.owner, owner);
      assert.equal(save[0].parent, clusters[0], "The current Save remains an authored direct light-DOM action peer.");
      const toggles = tree.visible("button").filter(node => node.owner === owner && node.attributes["data-delivery-editor-toggle"] === id);
      assert.equal(toggles.length, 1); assert.equal(Object.hasOwn(toggles[0].attributes, "disabled"), false);
      assert.ok(toggles[0].port.isConnected && owner.contains(toggles[0].port));
      return { form: forms[0], cluster: clusters[0], save: save[0], toggle: toggles[0] };
    };
    const resting = inspect(); assert.ok(resting.form.hiddenBy); assert.equal(resting.toggle.attributes["aria-expanded"], "false");
    const click = node => node.handlers.click.call(node.owner, { type: "click", currentTarget: node.port, target: node.port, preventDefault() {}, stopPropagation() {} });
    click(resting.toggle); await f.flush();
    const editing = inspect(); assert.equal(editing.form.hiddenBy, null); assert.equal(editing.save.hiddenBy, null);
    assert.equal(editing.toggle.attributes["aria-expanded"], "true"); assert.equal(Object.hasOwn(editing.save.attributes, "disabled"), false);
    assert.equal(editing.form.port.owner, owner, "The shared layout does not take ownership of the native form's handlers.");
    click(editing.toggle); await f.flush(); const hidden = inspect();
    assert.ok(hidden.form.hiddenBy); assert.equal(hidden.toggle.attributes["aria-expanded"], "false");
    assert.equal(currentDelivery(f), owner); assert.deepEqual(canonical(f), before); assert.deepEqual(f.financial(), money);
    assert.equal(f.calls.length, calls, "Edit/Hide/inspection do not request, save, or generate."); assert.deepEqual(f.external, []);
    t.diagnostic("DELIVERY_PLATFORM_LAYOUT " + JSON.stringify({ decisionId: id, actualCluster: true, nativeActionOwner: "current Delivery",
      hiddenAtRest: true, explicitEditVisible: true, explicitHide: true, extraRequests: 0, extraCommands: 0,
      limits: "Actual nested classes and current finite native controls; no geometry, physical focus, browser or AT certification." }));
  });
