import { createOutputReachabilityPage } from "./output-reachability-fixture.mjs";
import { calmFullPageNativePorts } from "./calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./output-navigation-focus-native.mjs";


// Complete Shell/Workspace/ContextBlock plus the production Store and shared
// focus lease. Native updateComplete/focus/input scheduling and explicit HTTP
// acknowledgements are deterministic ports; production methods and their
// authorization checks are unchanged, and no provider is called.
async function contextFocusFixture(t, locale, reader = false, kind = "text", page = createOutputReachabilityPage) {
  const f = await page(t, { locale, state: reader ? "read-only" : "confirmed" });
  f.contextFocusKind = kind;
  if (kind === "image") f.patchProperties(0, {
    source_output_id: "existing-image", label: "Original image title", text: "Original image direction", image_caption: "Original image title",
    output_palette: ["#123456", "#abcdef"], palette: ["#123456", "#abcdef"],
  });
  if (kind === "structured") f.patchProperties(0, {
    source_artifact_id: "existing-story", source_artifact_kind: "short_story", label: "Original structured title",
    artifact_markdown: "Original manuscript", artifact_summary: "Original structured summary", artifact_structure: { items: [
      { id: "saved-story:1", title: "Original chapter one", body: "Original first body", notes: "Original first notes", image_prompt: "Original first visual" },
      { id: "saved-story:2", title: "Original chapter two", body: "Original second body", notes: "Original second notes", image_prompt: "Original second visual" },
    ] },
  });
  const selector = id => f.find("input", node => node.owner.tag === "forma-context-block" && node.owner.block.id === id && node.attributes.type === "radio");
  const toggle = () => f.find("button", node => node.owner.tag === "forma-context-block" && node.owner.block.id === "synthetic-0" && String(node.attributes.class).includes("context-controls-toggle"));
  await f.act(selector("synthetic-0"), "change");
  // Load the real lazy editor descendants before the optional full-tree native
  // selector port is installed; cold unknown custom elements are valid DOM.
  await f.act(toggle()); await f.act(toggle());
  const native = installOutputNavigationFocusNative(t, f, calmFullPageNativePorts);
  const query = f.renderer.query.bind(f.renderer);
  f.renderer.query = (owner, selector) => {
    if (selector !== ".block-editor textarea" && selector !== ".block-editor forma-ui-rich-text textarea") return query(owner, selector);
    // Real descendant selectors resolve the textarea, never its containing form.
    return f.tree().nodes.filter(row => {
      if (row.tag !== "textarea") return false;
      let form = false, rich = false, within = false;
      for (let current = row; current; current = current.parent) {
        if (current.owner === owner || current.component === owner) within = true;
        if (current.tag === "form" && String(current.attributes.class).split(/\s/u).includes("block-editor")) form = true;
        if (current.tag === "forma-ui-rich-text") rich = true;
      }
      return within && form && (!selector.includes("forma-ui-rich-text") || rich);
    }).map(row => row.port).filter(Boolean);
  };
  return { f, native, selector, toggle };
}

function contextFocusDeferred(t, block) {
  let active = Promise.withResolvers();
  const first = active, gates = [first];
  Object.defineProperty(block, "updateComplete", { configurable: true, get: () => active.promise });
  t.after(() => { delete block.updateComplete; for (const gate of gates) gate.resolve(true); });
  return {
    first,
    next() { active = Promise.withResolvers(); gates.push(active); return active; },
  };
}

export { contextFocusFixture, contextFocusDeferred };
