import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

// Source/stylesheet contracts only. These do not measure browser geometry,
// native scrolling, assistive technology, or execute any application module.
// Reuse the existing document-artifact-dialog-layout/shared-control test seam.
const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");
const [shell, styles, design, main] = await Promise.all([
  read("src/components/forma-shell.ts"), read("src/styles.css"),
  read("src/design-system.css"), read("src/main.ts"),
]);
const sheets = [postcss.parse(styles), postcss.parse(design)];
const commandStart = shell.indexOf("  #commands() {"), commandEnd = shell.indexOf("\n  override render()", commandStart);
assert.ok(commandStart >= 0 && commandEnd > commandStart, "read the actual Shell command renderer");
const commands = shell.slice(commandStart, commandEnd);
const declarations = (sheet, selector) => {
  const result = {};
  sheet.walkRules(rule => {
    if (rule.parent.type !== "root" || !rule.selectors.includes(selector)) return;
    rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
};
const scoped = selector => declarations(sheets[1], "dialog.command-dialog " + selector);

test("command containment and listbox semantics remain an existing healthy source contract", () => {
  assert.match(main, /import "\.\/styles\.css";\s*import "\.\/design-system\.css";/u);
  assert.equal(declarations(sheets[1], "dialog.command-dialog")["max-height"], "100dvh");
  assert.equal(declarations(sheets[1], "dialog.command-dialog > :first-child")["max-height"], "100%");
  assert.equal(scoped(".command-results")["min-height"], "0");
  assert.equal(scoped(".command-results")["max-height"], "none");
  assert.equal(scoped(".command-results").overflow, "auto");
  assert.match(styles, /\.sr-only\s*\{[^}]*position:\s*absolute !important/u);
  assert.match(commands, /aria-controls="command-results" aria-describedby="command-scope"/u);
  assert.match(commands, /id="command-results"[^>]*role="listbox"/u);
  assert.match(commands, /<span dir="auto">\$\{command\.label\}<\/span><small dir="auto">\$\{command\.hint\}<\/small>/u);
  assert.ok(commands.includes("repeat(commands,command=>command.key"), "identity remains keyed, not positional");
  assert.ok(commands.includes("if(!this.#commandComposing)void this.#runCommand(this.#commandActiveKey,owner)"));
});

test("search, scope, scrolling results and footer own four explicit command tracks", () => {
  const card = declarations(sheets[1], "dialog.command-dialog > .command-card");
  assert.equal(card.display, "grid");
  assert.equal(card["grid-template-rows"], "auto auto minmax(0, 1fr) auto",
    "scope cannot take the only flexible track while results/footer become implicit rows");
  assert.equal(card["grid-template-columns"], "minmax(0, 1fr)");
  for (const [selector, track] of [[".command-search", "1"], ["#command-scope", "2"], [".command-results", "3"], [".command-card > footer", "4"]]) {
    assert.equal(scoped(selector)["grid-row"], track, selector);
    assert.notEqual(scoped(selector).display, "none");
    assert.notEqual(scoped(selector).visibility, "hidden");
  }
  assert.equal(scoped(".command-results")["min-inline-size"], "0");
});

test("empty and populated results share the bounded body without changing the listbox identity", () => {
  const body = commands.indexOf('<div class="command-results">');
  const listbox = commands.indexOf('<div id="command-results" role="listbox">');
  const rows = commands.indexOf("repeat(commands,command=>command.key");
  const emptyText = '${commands.length?nothing:html`<p>${copy.empty}</p>`}';
  const empty = commands.indexOf(emptyText), footer = commands.indexOf("<footer>");
  assert.ok(body >= 0 && body < listbox && listbox < rows && rows < empty && empty < footer,
    "one scroll body contains both the real listbox and its sibling empty state");
  assert.equal(commands.slice(body + '<div class="command-results">'.length, listbox).trim(), "");
  assert.match(commands.slice(rows, empty), /<\/button>`\)\}<\/div>\s*$/u, "the empty state is outside the listbox");
  assert.equal(commands.slice(empty + emptyText.length, footer).trim(), "</div>", "empty state closes inside the same scrolling body");
  assert.ok(commands.slice(0, body).includes('<p id="command-scope">${copy.scope}</p>'));
  assert.ok(commands.slice(0, body).includes('<p class="sr-only" role="status">'));
  assert.equal(commands.split('id="command-results"').length - 1, 1);
});

test("both command text peers wrap logically without truncating exact contextual names", () => {
  const row = scoped(".command-row"), peers = scoped(".command-row > :is(span, small)");
  assert.equal(declarations(sheets[0], ".command-row").display, "flex");
  assert.equal(row["text-align"], "start");
  assert.equal(row["min-inline-size"], "0");
  assert.equal(row["flex-wrap"], "wrap");
  assert.equal(row["min-block-size"], "var(--forma-control-min-size, 2.75rem)");
  assert.match(row.gap ?? "", /var\(--forma-space-1,[^)]+\)\) var\(--forma-space-3,/u);
  assert.equal(peers["min-inline-size"], "0");
  assert.equal(peers["max-inline-size"], "100%");
  assert.equal(peers["overflow-wrap"], "anywhere");
  for (const selector of [".command-row > span", ".command-row > small"]) {
    assert.match(scoped(selector).flex ?? "", /^[12] 1 [1-9][0-9]*ch$/u, selector + " has a useful preferred text basis");
  }
  for (const rule of [row, peers, scoped(".command-row > span"), scoped(".command-row > small")]) {
    assert.notEqual(rule.overflow, "hidden"); assert.notEqual(rule.overflow, "clip");
    assert.notEqual(rule["white-space"], "nowrap"); assert.notEqual(rule["text-overflow"], "ellipsis");
    assert.equal(rule["line-clamp"], undefined); assert.equal(rule["-webkit-line-clamp"], undefined);
    assert.equal(rule.height, undefined); assert.equal(rule["block-size"], undefined);
  }
});
