import assert from "node:assert/strict";
import { FORMA_OUTPUT_REQUIREMENT_MESSAGES } from "../../src/components/design-system/locales/output-requirement-messages.ts";

/** Current actual card controls only; no saved snapshot or transport substitute. */
export function recipeCardControls(f, controller) {
  const card = () => controller.querySelector("[data-output-recipe-draft] forma-output-requirement-card") ?? undefined;
  const nodes = () => f.tree().nodes.filter(node => node.owner === card());
  const acceptInterpretation = async () => {
    for (const node of nodes().filter(node => node.tag === "details" && node.port)) node.port.open = true;
    await f.settle();
    const copy = FORMA_OUTPUT_REQUIREMENT_MESSAGES[f.locale];
    const acknowledgment = nodes().find(node => !node.hiddenBy && node.tag === "input" && node.attributes.type === "checkbox"
      && String(node.attributes["aria-label"]).startsWith(copy["output.requirement.retainedReviewAcknowledgment"]));
    assert.ok(acknowledgment); acknowledgment.port.checked = true; await f.act(acknowledgment, "change");
    const accept = nodes().find(node => !node.hiddenBy && node.tag === "button" && node.text === copy["output.requirement.acceptRetainedInterpretation"]);
    assert.ok(accept); await f.act(accept);
  };
  const observeSave = async (owner, activate) => {
    // Native dispatch ignores an async listener's return. Observe only this
    // current emitted Save binding, and keep its original Promise unchanged.
    const ActualCard = f.renderer.registry["forma-output-requirement-card"];
    assert.equal(typeof ActualCard, "function");
    assert.ok(owner instanceof ActualCard && owner.isConnected && owner.parentElement === controller && owner.store === controller.store);
    assert.equal(controller.store, f.store);
    const rows = f.tree().nodes.filter(node => node.component === owner);
    assert.equal(rows.length, 1); assert.equal(rows[0].owner, controller);
    const bindings = owner.eventBindings, name = "forma-output-save", original = bindings?.[name];
    assert.equal(typeof original, "function"); assert.equal(rows[0].handlers[name], original);
    const descriptor = Object.getOwnPropertyDescriptor(bindings, name), pending = [];
    assert.ok(descriptor && descriptor.value === original, "observe the actual own EventPart binding");
    Object.defineProperty(bindings, name, { ...descriptor, value: function(...args) {
      assert.equal(this, controller); assert.equal(args[0]?.type, name);
      const promise = Reflect.apply(original, this, args);
      assert.equal(typeof promise?.then, "function", "the original async Save handler owns completion");
      pending.push(promise);
      void promise.then(() => {}, () => {}); // Observe early rejection; the exact original is awaited below.
      return promise;
    } });
    try {
      const errors = [];
      try { await activate(); } catch (error) { errors.push(error); }
      for (const promise of pending) {
        try { await promise; } catch (error) { errors.push(error); }
      }
      if (errors.length) throw errors[0];
      assert.ok(pending.length <= 1, "one native Save action invokes at most one original Save handler");
      await f.settle();
      return pending.length;
    } finally { Object.defineProperty(bindings, name, descriptor); }
  };
  const save = async () => {
    const form = nodes().find(node => !node.hiddenBy && node.tag === "form" && node.attributes.class === "output-requirement-form");
    const button = nodes().find(node => !node.hiddenBy && node.tag === "button" && node.attributes.type === "submit");
    assert.ok(form); assert.ok(button); assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
    assert.equal(button.owner, form.owner);
    await observeSave(form.owner, () => f.act(form, "submit", { submitter: button.port }));
  };
  return { card, nodes, acceptInterpretation, save, observeSave };
}
