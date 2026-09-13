import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8");
const expressions = [...source.matchAll(/data-layout-intent=\$\{([^}]+)\}/gu)];
assert.equal(expressions.length, 1, "Use the actual single Shell layout expression");
const layout = new Function("isCreative", "experienceMode", "documentViewFromRoute", "path", "pathname", "return " + expressions[0][1]);

test("completed-output mini-apps retain natural page scrolling instead of inheriting clipped workbench layout", () => {
  for (const output of ["image", "slides", "short_story", "scene"]) {
    const path = "/document/original/output?experience=" + output;
    assert.equal(layout(true, true, () => "document", path, "/document/original/output"), "browse", output);
  }
});
test("ordinary Document and creation workbenches keep their bounded layout", () => {
  assert.equal(layout(true, false, () => "document", "/document/original", "/document/original"), "workbench");
  assert.equal(layout(true, false, () => null, "/creative/create", "/creative/create"), "workbench");
  assert.equal(layout(true, false, () => null, "/creative/create/new", "/creative/create/new"), "workbench");
});
test("noncreative and ordinary discovery routes keep browse layout", () => {
  assert.equal(layout(false, false, () => "document", "/document/original", "/document/original"), "browse");
  assert.equal(layout(true, false, () => null, "/library", "/library"), "browse");
});
