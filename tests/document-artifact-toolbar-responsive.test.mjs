import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const [source, artifacts] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8"),
]);
const stylesheet = postcss.parse(source, { from: "src/styles.css" });

function matchingRules(selector, container) {
  const matches = [];
  stylesheet.walkRules((rule) => {
    if (!rule.selectors?.includes(selector)) return;

    let query;
    let media;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && parent.name === "container") query = parent;
      if (parent.type === "atrule" && parent.name === "media") media = parent;
    }

    if (media || Boolean(container) !== Boolean(query)) return;
    if (container && !query.params.startsWith(`${container} `)) return;
    matches.push({ rule, query });
  });
  return matches;
}

function declaration(selector, property, container) {
  let value;
  for (const { rule } of matchingRules(selector, container)) {
    rule.walkDecls(property, (item) => { value = item.value; });
  }
  return value;
}

test("output creation responds to its actual document pane, not the desktop viewport", () => {
  assert.equal(declaration(".document-artifacts", "container"), "document-artifacts / inline-size");
  assert.equal(declaration(".document-artifacts", "min-inline-size"), "0");
  assert.equal(declaration(".document-artifacts", "max-inline-size"), "100%");

  const [responsive] = matchingRules(".document-artifacts > header", "document-artifacts");
  assert.ok(responsive, "document artifact controls must have their own named container query");
  assert.match(responsive.query.params, /^document-artifacts \(max-width:\s*32rem\)$/u);
  assert.equal(declaration(".document-artifacts > header", "flex-direction", "document-artifacts"), "column");
  assert.equal(declaration(".document-artifacts > header", "align-items", "document-artifacts"), "stretch");
  assert.equal(declaration(".document-artifacts > header > div", "flex-basis", "document-artifacts"), "auto");
  assert.equal(declaration(".document-artifacts > header > .button", "inline-size", "document-artifacts"), "100%");

  for (const paneWidth of [240, 320, 420, 512]) {
    assert.ok(paneWidth <= 32 * 16, `a ${paneWidth}px document pane wraps even in a 1280px desktop viewport`);
  }
  assert.ok(640 > 32 * 16, "a sufficiently wide document pane retains its horizontal header");
  assert.ok(640 <= 32 * 20, "the rem-based breakpoint grows with 125% text zoom");
});

test("output action remains visible, focusable, and usable with long translated labels", () => {
  const header = ".document-artifacts > header";
  const heading = ".document-artifacts > header > div";
  const action = ".document-artifacts > header > .button";

  assert.equal(declaration(header, "display"), "flex");
  assert.equal(declaration(header, "min-inline-size"), "0");
  assert.equal(declaration(header, "flex-wrap"), "wrap");
  assert.equal(declaration(heading, "min-inline-size"), "0");
  assert.equal(declaration(heading, "overflow-wrap"), "anywhere");
  assert.equal(declaration(action, "min-inline-size"), "0");
  assert.equal(declaration(action, "max-inline-size"), "100%");
  assert.equal(declaration(action, "white-space"), "normal");
  assert.equal(declaration(action, "overflow-wrap"), "anywhere");
  assert.match(declaration(action, "min-block-size") ?? "", /--forma-hit-target/u);

  for (const selector of [header, heading, action]) {
    for (const { rule } of [
      ...matchingRules(selector),
      ...matchingRules(selector, "document-artifacts"),
    ]) {
      rule.walkDecls(/^(?:overflow(?:-[xy])?|visibility|pointer-events)$/u, (item) => {
        assert.doesNotMatch(item.value, /^(?:hidden|clip|none)$/u, `${selector} must not hide a reachable control`);
      });
      rule.walkDecls(/^(?:left|right|margin-(?:left|right)|padding-(?:left|right))$/u, (item) => {
        assert.fail(`${selector} must use logical rather than directional ${item.prop}`);
      });
    }
  }

  assert.match(artifacts, /<header><div>[\s\S]*?<button type="button" class="button secondary compact"[^>]*@click=/u);
  assert.match(artifacts, /this\.querySelector<HTMLElement>\("\.document-artifacts > header > button"\)/u);
  assert.match(source, /:focus-visible\s*\{[^}]*outline:\s*2px/u);
});
