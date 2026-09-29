import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [legacy, design] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
]);

const rgb = (hex) => {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? [...value].map((part) => part + part).join("") : value;
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
};

const luminance = (hex) => rgb(hex)
  .map((channel) => channel / 255)
  .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);

const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

const themeValues = (token) => {
  const match = legacy.match(new RegExp(`--${token}:\\s*light-dark\\((#[0-9a-f]+),\\s*(#[0-9a-f]+)\\)`, "i"));
  assert.ok(match, `--${token} should define light and dark values`);
  return { light: match[1], dark: match[2] };
};

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

test("semantic content pairs remain readable in both user color preferences", () => {
  for (const [foregroundToken, backgroundToken, minimum] of [
    ["ink", "paper", 7],
    ["ink", "panel", 7],
    ["muted", "paper", 4.5],
    ["muted", "panel", 4.5],
    ["on-strong", "ink", 7],
    ["on-accent", "orange", 4.5],
  ]) {
    const foreground = themeValues(foregroundToken);
    const background = themeValues(backgroundToken);
    for (const mode of ["light", "dark"]) {
      assert.ok(
        contrast(foreground[mode], background[mode]) >= minimum,
        `${foregroundToken} on ${backgroundToken} should meet ${minimum}:1 in ${mode} mode`,
      );
    }
  }
});

test("shared chrome and replay content consume theme tokens while fixed dark media stages remain explicit", () => {
  assert.match(design, /\.output-column\s*\{\s*background:\s*var\(--canvas\);\s*\}/);
  assert.match(design, /\.button\.primary\s*\{[^}]*color:\s*var\(--on-strong\);[^}]*background:\s*var\(--ink\);/s);
  assert.match(design, /\.chat-line\.user\s*>\s*p\s*\{\s*color:\s*var\(--on-strong\);/);
  assert.match(design, /Image and spatial-inspection stages intentionally keep a\s*\n\s*\* fixed dark presentation/);
  assert.match(design, /\.replay-console\s*\{[^}]*color:\s*var\(--ink\);[^}]*background:\s*var\(--panel\);[^}]*border-color:\s*var\(--line\);/s);
  assert.match(design, /\.replay-explanation\s*\{[^}]*color:\s*var\(--ink\);[^}]*background:\s*var\(--panel-2\);[^}]*border:\s*1px solid var\(--line\);/s);
  assert.match(design, /\.replay-explanation p,[^}]*\.replay-explanation small\s*\{\s*color:\s*var\(--muted\);\s*\}/s);
});

test("legacy administrative and laboratory chrome remains readable without defining shared audience navigation", () => {
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

test("every audience receives a neutral task rail with one gutter and a restrained current underline", () => {
  assert.match(design, /\.app-shell > forma-ui-audience-navigation\s*,\s*\.forma-platform-shell > forma-ui-audience-navigation\s*\{[^}]*inline-size:\s*100%;[^}]*margin:\s*0;[^}]*padding:\s*0;[^}]*border:\s*0;/s);
  assert.match(design, /\.ui-audience-navigation\s*\{[^}]*background:\s*var\(--forma-color-surface,\s*var\(--panel\)\);[^}]*border-block-end:\s*1px solid var\(--forma-color-border,\s*var\(--line\)\);/s);
  assert.match(design, /\.ui-audience-navigation-list\s*\{[^}]*padding-inline:\s*var\(--page-gutter,[^;]+\);[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-inline:\s*contain;/s);
  assert.doesNotMatch(design, /\.ui-audience-navigation-list\s*\{[^}]*padding-block:/s);
  assert.match(design, /\.ui-audience-navigation a:focus-visible\s*\{\s*outline-offset:\s*calc\(-1\s*\*\s*var\(--forma-focus-ring-width,/);
  assert.match(design, /\.ui-audience-navigation a\[aria-current="page"\]\s*\{[^}]*color:\s*var\(--forma-color-accent-text,\s*var\(--ink\)\);[^}]*background:\s*transparent;[^}]*border-block-end-color:\s*var\(--forma-color-accent,\s*var\(--accent\)\);/s);
  assert.doesNotMatch(design, /\.app-shell > \.global-nav\s*,\s*\.app-shell > forma-ui-audience-navigation/);
});

test("creative, operations, and laboratory headers share one compact justified chrome contract", () => {
  assert.match(design, /:is\(\.page-header--hero, \.page-header--admin\)\s*\{[^}]*display:\s*flex;[^}]*max-width:\s*none;[^}]*justify-content:\s*space-between;[^}]*color:\s*var\(--on-dark\);/s);
  assert.match(design, /\.page-header--hero\s*\{[^}]*margin:\s*0 calc\(-1 \* var\(--page-gutter\)\)[^;]*;[^}]*padding-inline:\s*var\(--page-gutter\);[^}]*background:\s*var\(--admin-chrome\);/s);
  assert.match(design, /\.page-header--admin\s*\{[^}]*padding-inline:\s*var\(--page-gutter\);[^}]*background:\s*var\(--admin-chrome\);/s);
  assert.match(design, /:is\(\.page-header--hero, \.page-header--admin\) h1\s*\{[^}]*font-size:\s*clamp\(2\.4rem, 5vw, 4\.75rem\);/s);
  assert.match(design, /:is\(\.page-header--hero, \.page-header--admin\) \.page-header-actions\s*\{[^}]*justify-content:\s*flex-end;[^}]*margin-top:\s*0;/s);
  assert.doesNotMatch(design, /\.page-header--admin h1\s*\{[^}]*6\.5rem/s);
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
  assert.match(design, /\.actor-token\.worker\s*\{[^}]*color:\s*var\(--warning\);[^}]*var\(--panel\)/s);
  assert.match(design, /\.actor-token\.model\s*\{[^}]*color:\s*var\(--blue\);[^}]*var\(--panel\)/s);
  assert.match(design, /\.actual-replay-status\s*\{[^}]*color:\s*var\(--success\);[^}]*var\(--panel\)/s);
  assert.match(design, /\.permission-table em\s*\{[^}]*color:\s*var\(--success\);[^}]*var\(--panel\)/s);
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
