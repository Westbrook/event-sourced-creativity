import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("keeps the browser root size user-controlled and the body at one rem", () => {
  const htmlRule = css.match(/html\s*\{[^}]*\}/)?.[0] ?? "";
  const bodyRule = css.match(/body\s*\{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(htmlRule, /font-size\s*:/);
  assert.match(bodyRule, /font-size:\s*var\(--type-body\)/);
  assert.match(css, /--type-body:\s*1rem/);
});

test("uses rem-backed type tokens with a ten pixel equivalent floor", () => {
  const declarations = css.match(/font(?:-size)?\s*:[^;}]+/g) ?? [];
  assert.ok(declarations.length > 50);
  assert.ok(declarations.every((declaration) => !/\d(?:\.\d+)?px\b/.test(declaration)), "font declarations must not use px");
  const tokens = [...css.matchAll(/--type-[\w-]+:\s*(\.?\d+(?:\.\d+)?)rem/g)].map((match) => Number(match[1]));
  assert.ok(tokens.length >= 8);
  assert.ok(tokens.every((value) => value >= 0.625), "type tokens must resolve to at least 10px at the browser default");
});

test("Japanese typography uses readable native fonts, spacing, and line height", () => {
  const rule = css.match(/:root:lang\(ja\),\s*forma-ui-locale:lang\(ja\)\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /"Hiragino Sans"/);
  assert.match(rule, /--forma-heading-letter-spacing:\s*0/);
  assert.match(rule, /--forma-heading-line-height:\s*1\.35/);
  assert.match(rule, /--forma-body-line-height:\s*1\.8/);
});
