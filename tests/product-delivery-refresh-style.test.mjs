import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Static cascade contract paired with native hidden/inert emission tests.
// This is not a computed-style, browser layout, or interaction certificate.
test("ProductDelivery retained hidden create form has its own author-level display override", () => {
  const css = fs.readFileSync(new URL("../src/design-system.css", import.meta.url), "utf8");
  assert.match(css, /\.delivery-decision-form,[^{]+\{\s*display:\s*grid;/u);
  assert.equal([...css.matchAll(/\.delivery-decision-form\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/gu)].length, 1);
  const main = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.ok(main.includes('import "./design-system.css";'));
  const base = fs.readFileSync(new URL("../src/components/presentational-element.ts", import.meta.url), "utf8");
  assert.ok(base.includes("protected override createRenderRoot() { return this; }"));
});
