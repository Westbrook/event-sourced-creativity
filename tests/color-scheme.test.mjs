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

test("operations and laboratory navigation share readable fixed-dark chrome in either color scheme", () => {
  for (const token of ["admin-chrome", "admin-chrome-hover", "admin-chrome-line", "admin-chrome-muted", "admin-chrome-subtle"]) {
    assert.match(legacy, new RegExp(`--${token}:`));
  }
  assert.match(design, /\.area-navigation--administrative\s*\{[^}]*background:\s*var\(--admin-chrome\);[^}]*border-color:\s*var\(--admin-chrome-line\);/s);
  assert.match(design, /\.area-navigation--administrative a\.active\s*\{[^}]*color:\s*var\(--on-accent\);[^}]*background:\s*var\(--orange\);/s);
  assert.match(design, /\.administrative-page\s*>\s*forma-area-navigation\s+\.area-navigation--administrative\s*\{[^}]*border-radius:\s*0;/s);
  assert.doesNotMatch(design, /\.area-navigation--laboratory\s*\{[^}]*background:/s);
  assert.match(design, /\.tabbar\s*\{[^}]*color:\s*var\(--admin-chrome-muted\);[^}]*background:\s*var\(--admin-chrome\);/s);
  assert.match(design, /\.tabbar a\.active::after\s*\{\s*background:\s*var\(--orange\);\s*\}/);
});

test("Projects derives its page wash from theme surfaces instead of a light-only canvas", () => {
  const projects = design.match(/\.projects-page\s*\{[^}]+\}/s)?.[0] ?? "";
  assert.match(projects, /color-mix\(in srgb,\s*var\(--orange-soft\) 18%,\s*var\(--paper\)\)/);
  assert.match(projects, /var\(--paper\) 22\.5rem/);
  assert.doesNotMatch(projects, /#f4f1e8|#fbfaf6/);
});

test("shared navigation and common content surfaces remain preference reactive", () => {
  assert.match(design, /\.area-navigation\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--panel\) 82%,\s*transparent\);[^}]*border-color:\s*var\(--line\);/s);
  assert.match(design, /\.area-navigation a\.active\s*\{\s*color:\s*var\(--on-strong\);\s*background:\s*var\(--ink\);\s*\}/);
  assert.match(design, /\.continuity-receipt,[\s\S]*\.document-generation-embedded[\s\S]*background:\s*var\(--panel\);/);
  assert.match(design, /\.creative-editor-canvas\s*\{\s*background:\s*var\(--canvas\);\s*\}/);
  assert.match(design, /\.output-quality\.full\s*\{[^}]*color:\s*var\(--success\);[^}]*var\(--panel\)/s);
  assert.match(design, /\.output-quality\.draft\s*\{[^}]*color:\s*var\(--warning\);[^}]*var\(--panel\)/s);
  assert.match(design, /\.capability-audit\s*\{\s*color:\s*var\(--ink\);\s*\}/);
  assert.match(design, /\.capability-audit b\s*\{\s*color:\s*var\(--orange\);\s*\}/);
});

test("fixed-dark inspection surfaces use a non-reactive readable foreground palette", () => {
  for (const token of ["fixed-dark", "fixed-dark-ink", "fixed-dark-muted", "fixed-dark-accent"]) {
    assert.match(legacy, new RegExp(`--${token}:`));
  }
  assert.match(design, /\.gate-metrics b,[\s\S]*\.extractor-metrics b[\s\S]*color:\s*var\(--fixed-dark-accent\);/);
  assert.match(design, /\.gate-card > p,[\s\S]*\.envelope-card p[\s\S]*color:\s*var\(--fixed-dark-muted\);/);
  assert.match(design, /\.reality-tools button > span,[\s\S]*\.creative-inspector-empty > span[\s\S]*color:\s*var\(--on-accent\);[\s\S]*background:\s*var\(--orange\);/);
  assert.match(design, /\.creative-editor-toolbar \.button\.primary,[\s\S]*\.reality-stage > footer \.button[\s\S]*color:\s*var\(--on-accent\);[\s\S]*background:\s*var\(--orange\);/);
  assert.match(design, /\.canvas-context button\.selected span\s*\{\s*color:\s*inherit;\s*\}/);
  assert.match(design, /\.spatial-kind-picker input:checked \+ span\s*\{[^}]*color:\s*var\(--on-accent\);[^}]*background:\s*var\(--orange\);/s);
  assert.match(design, /\.spatial-direct-tools button\[aria-pressed="true"\],[^}]*background:\s*var\(--orange\);/s);
  assert.match(design, /\.actual-replay-warning > span\s*\{\s*color:\s*var\(--on-accent\);\s*background:\s*var\(--warning\);\s*\}/);
});
