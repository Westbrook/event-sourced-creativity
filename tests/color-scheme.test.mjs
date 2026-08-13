import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [legacy, design] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
]);

test("the visual system follows the user agent color preference with native CSS", () => {
  assert.match(legacy, /color-scheme:\s*light dark;/);
  assert.doesNotMatch(`${legacy}\n${design}`, /prefers-color-scheme/);
  assert.ok(
    (legacy.match(/light-dark\(/g) ?? []).length >= 15,
    "core color roles should use light-dark() rather than a second theme stylesheet",
  );
});

test("semantic surfaces and foregrounds have paired light and dark values", () => {
  for (const token of [
    "ink",
    "muted",
    "line",
    "line-strong",
    "paper",
    "panel",
    "panel-2",
    "canvas",
    "orange",
    "orange-soft",
    "success",
    "warning",
    "danger",
    "on-strong",
    "on-accent",
  ]) {
    assert.match(legacy, new RegExp(`--${token}:\\s*light-dark\\(`));
  }
});

test("shared chrome consumes theme tokens while fixed dark media stages remain explicit", () => {
  assert.match(design, /\.output-column\s*\{\s*background:\s*var\(--canvas\);\s*\}/);
  assert.match(design, /\.button\.primary\s*\{[^}]*color:\s*var\(--on-strong\);[^}]*background:\s*var\(--ink\);/s);
  assert.match(design, /\.chat-line\.user\s*>\s*p\s*\{\s*color:\s*var\(--on-strong\);/);
  assert.match(design, /Media stages and the replay console intentionally keep\s*\n\s*\* their fixed dark presentation/);
});
