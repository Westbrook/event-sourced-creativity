import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("uses available workspace width, not viewport width, to reflow document views", async () => {
  const [design, main] = await Promise.all([
    read("../src/design-system.css"),
    read("../src/main.ts"),
  ]);

  assert.match(main, /import "\.\/styles\.css";\s*import "\.\/design-system\.css";/);
  assert.match(design, /\.studio-main:not\(\.chat-view-main\)\s*\{\s*container:\s*studio \/ inline-size;/);
  assert.match(design, /\.chat-view-main\s*\{\s*container:\s*chat \/ inline-size;/);
  assert.match(design, /@container studio \(max-width: 62rem\)[\s\S]*?\.studio-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(design, /@container studio \(max-width: 62rem\)[\s\S]*?\.document-continuity,[\s\S]*?\.board-capture,[\s\S]*?\.adaptive-intent\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(design, /@container chat \(max-width: 62rem\)/);
});

test("keeps route shells intrinsically containable without hiding page overflow", async () => {
  const [styles, design] = await Promise.all([
    read("../src/styles.css"),
    read("../src/design-system.css"),
  ]);

  const containmentRule = design.match(/forma-shell,[\s\S]*?\.topbar > \*\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(containmentRule, /min-width:\s*0/);
  assert.match(containmentRule, /max-width:\s*100%/);
  assert.doesNotMatch(styles, /\.studio-subpage-body\s*\{[^}]*overflow-x:\s*(?:clip|hidden)/);
  assert.doesNotMatch(styles, /\.library-body\s*\{[^}]*overflow-x:\s*(?:clip|hidden)/);
  assert.doesNotMatch(design, /\.studio-subpage-body\s*\{[^}]*overflow-x:\s*(?:clip|hidden)/);
  assert.match(design, /:where\(h1, h2, h3, h4, p, dd, code, pre, small, strong\)\s*\{\s*overflow-wrap:\s*anywhere/);
});

test("gives Library and dense administrative data their own responsive contracts", async () => {
  const design = await read("../src/design-system.css");

  assert.match(design, /\.library-main\s*\{\s*container:\s*library \/ inline-size;/);
  assert.match(design, /@container library \(max-width: 62rem\)[\s\S]*?\.family-card,[\s\S]*?\.output-focus-layout\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(design, /@container library \(max-width: 48rem\)[\s\S]*?\.library-toolbar,[\s\S]*?\.page-header--library/);
  assert.match(design, /\.event-table-wrap,[\s\S]*?\.permission-table\s*\{\s*overflow-x:\s*auto/);
  assert.match(design, /\.permission-table > div\s*\{\s*min-width:\s*32rem/);
});

test("preserves usable controls when document navigation and editors get narrow", async () => {
  const [design, navigation] = await Promise.all([
    read("../src/design-system.css"),
    read("../src/components/studio-navigation.ts"),
  ]);

  assert.match(design, /@container studio \(max-width: 50rem\)[\s\S]*?\.studio-mode-action-label/);
  assert.match(design, /@container studio \(max-width: 32rem\)[\s\S]*?\.editor-toolbar\s*\{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(design, /@media \(max-width: 760px\)[\s\S]*?\.composer \.generation-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(navigation, /class="studio-mode-action-label"/);
  assert.match(navigation, /aria-label="Add reusable context"/);
  assert.match(navigation, /aria-label=\$\{this\.#focused \? "Exit focused document view" : "Enter focused document view"\}/);
  assert.match(navigation, /class="studio-mode-links"/);
  assert.match(navigation, /#revealActiveMode\(\)/);
  assert.match(navigation, /a\[aria-current="page"\]/);
  assert.match(navigation, /scroller\.scrollLeft \+= activeBounds\.(?:left|right)/);
});

test("stacks document headers without seams and reserves composer space inside Studio", async () => {
  const [styles, design, workspace, alternatives, chat] = await Promise.all([
    read("../src/styles.css"),
    read("../src/design-system.css"),
    read("../src/components/forma-workspace.ts"),
    read("../src/components/forma-studio-alternatives.ts"),
    read("../src/components/forma-chat-studio.ts"),
  ]);

  assert.doesNotMatch(styles, /\.workspace-page\s*\{[^}]*padding-bottom/);
  assert.match(styles, /\.workspace-page:has\(> \.composer-dock\) > \.studio-main\s*\{\s*padding-bottom:\s*88px/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.workspace-page:has\(> \.composer-dock\) > \.studio-main\s*\{\s*padding-bottom:\s*100px/);
  assert.match(design, /\.studio-header-stack\s*\{[^}]*position:\s*sticky;[^}]*top:\s*64px;[^}]*background:\s*var\(--paper\)/);
  assert.match(design, /\.studio-header-stack > forma-studio-mode-nav > \.studio-mode-nav\s*\{[^}]*position:\s*static;[^}]*top:\s*auto/);
  assert.match(design, /@media \(max-width: 760px\)[\s\S]*?\.studio-header-stack\s*\{\s*position:\s*static;\s*top:\s*auto;/);
  for (const component of [workspace, alternatives, chat]) assert.match(component, /class="studio-header-stack"/);
});
