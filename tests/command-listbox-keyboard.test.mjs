import assert from "node:assert/strict";
import test, { after } from "node:test";
import { lifecyclePage } from "./helpers/creative-next-action-navigation-fixture.mjs";

// Complete current Shell/Store and the existing native ports. Assertions cover
// emitted native semantics and actual handlers, not OS Tab traversal or AT.
const originalFetch = globalThis.fetch;
let external = 0;
globalThis.fetch = async () => { external++; throw Error("No external/provider transport in command keyboard contracts"); };
after(() => { assert.equal(external, 0); globalThis.fetch = originalFetch; });
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s/u).includes(name);
const rows = f => f.tree().visible("button").filter(node => node.attributes.role === "option");
const search = f => f.find("input", node => node.attributes.id === "command-search");
const form = f => f.find("form", node => classed(node, "command-card"));
async function open(f) {
  await f.act(f.find("button", node => node.owner.tag === "forma-shell" && classed(node, "command-trigger")));
  assert.equal(f.store.ui.commandOpen, true);
}
function selected(f) {
  const input = search(f), options = rows(f);
  const selected = options.filter(node => String(node.attributes["aria-selected"]) === "true");
  assert.equal(selected.length, 1);
  assert.equal(input.attributes["aria-activedescendant"], selected[0].attributes.id);
  return selected[0];
}
async function drain(f) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await f.settle();
    for (const [id, timer] of [...f.storeHost.timers]) if (timer.delay === 16) {
      f.storeHost.timers.delete(id); timer.callback(0);
    }
  }
}

test("C19 command combobox has one keyboard owner and excludes popup options from sequential Tab",
  { concurrency: false, timeout: 30_000 }, async t => {
    const f = await lifecyclePage(t); await open(f);
    const input = search(f), options = rows(f);
    assert.equal(input.attributes.role, "combobox");
    assert.equal(input.attributes["aria-expanded"], "true");
    assert.equal(input.attributes["aria-controls"], "command-results");
    assert.equal(f.find("div", node => node.attributes.id === "command-results").attributes.role, "listbox");
    const label = f.find("label", node => node.attributes.for === input.attributes.id);
    assert.ok(label.text.trim(), "the actual combobox retains its associated localized label");
    assert.ok(options.length > 2); selected(f);
    for (const option of options) {
      assert.equal(option.attributes.type, "button");
      assert.equal(typeof option.handlers.click, "function", "pointer activation remains the actual current choice handler");
    }
    t.diagnostic("C19_COMMAND_TAB_CONTRACT " + JSON.stringify({
      activeDescendant: input.attributes["aria-activedescendant"],
      options: options.map(node => ({ id: node.attributes.id, tabindex: node.attributes.tabindex ?? null })), external,
    }));
    assert.ok(options.every(option => String(option.attributes.tabindex) === "-1"),
      "aria-activedescendant keeps keyboard ownership on the input; native popup buttons must not add Tab stops");
    f.sourceUnchanged();
  });

test("C19 current combobox arrows, IME guard, deliberate form submission and option click preserve exact choices",
  { concurrency: false, timeout: 30_000 }, async t => {
    const f = await lifecyclePage(t); await open(f);
    const initial = selected(f).attributes.id;
    let prevented = false;
    await f.act(search(f), "keydown", { key: "ArrowDown", preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(selected(f).attributes.id, "command-option-1");
    await f.act(search(f), "keydown", { key: "ArrowUp" });
    assert.equal(selected(f).attributes.id, initial);
    const route = f.store.route.get();
    await f.act(search(f), "compositionstart");
    await f.act(search(f), "keydown", { key: "ArrowDown", isComposing: true });
    assert.equal(selected(f).attributes.id, initial, "an unfinished IME composition does not move the selected command");
    await f.act(form(f), "submit");
    assert.equal(f.store.route.get(), route);
    assert.equal(f.store.ui.commandOpen, true, "IME submission is not an execution gesture");
    await f.act(search(f), "compositionend");
    const libraryLabel = f.i18n.t("command.openLibrary", "Open reusable library");
    const input = search(f); input.port.value = libraryLabel; await f.act(input, "input");
    assert.equal(rows(f).length, 1);
    assert.ok(selected(f).children.some(child => typeof child !== "string" && child.tag === "span" && child.text === libraryLabel));
    const submitter = f.find("button", node => node.owner.tag === "forma-shell" && node.attributes.type === "submit"
      && classed(node, "sr-only"));
    assert.equal(Object.hasOwn(submitter.attributes, "disabled"), false);
    // This is the actual native form submit handler, not a claimed OS Enter event.
    await f.act(form(f), "submit", { submitter: submitter.port }); await drain(f);
    const destination = new URL(f.store.route.get(), "http://localhost");
    assert.equal(destination.pathname, "/library");
    assert.equal(destination.searchParams.get("document"), f.documentId);
    assert.equal(f.store.ui.commandOpen, false);
    assert.equal(f.store.projection.get().projectId, f.projectId);
    assert.equal(f.store.projection.get().documentId, f.documentId);
    await open(f);
    const projectsLabel = f.i18n.t("command.openNavigation", "Open {name}", {
      name: f.i18n.t("shell.navigation.projects", "Projects"),
    });
    const projects = f.find("button", node => node.attributes.role === "option"
      && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === projectsLabel));
    await f.act(projects); await drain(f);
    assert.equal(new URL(f.store.route.get(), "http://localhost").pathname, "/projects");
    assert.equal(f.store.ui.commandOpen, false);
    assert.equal(f.store.projection.get().projectId, f.projectId);
    assert.equal(f.store.projection.get().documentId, f.documentId);
    f.sourceUnchanged();
  });
