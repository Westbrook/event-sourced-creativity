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

test("keeps every account control reachable inside the current viewport", async () => {
  const [styles, design, shell] = await Promise.all([
    read("../src/styles.css"),
    read("../src/design-system.css"),
    read("../src/components/forma-shell.ts"),
  ]);

  const accountPopover = styles.match(/\.account-popover\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(accountPopover, /--account-popover-top:\s*52px/);
  assert.match(accountPopover, /top:\s*var\(--account-popover-top\)/);
  assert.match(accountPopover, /max-block-size:\s*calc\(100dvh - var\(--account-popover-top\) - max\(12px,env\(safe-area-inset-bottom,0px\)\)\)/);
  assert.match(accountPopover, /overflow-y:\s*auto/);
  assert.match(accountPopover, /overscroll-behavior:\s*contain/);
  assert.match(accountPopover, /scroll-padding-block:\s*12px/);
  assert.match(accountPopover, /position:\s*fixed/);
  assert.match(accountPopover, /inset:\s*auto/);
  assert.match(accountPopover, /margin:\s*0/);
  assert.match(accountPopover, /scrollbar-gutter:\s*auto/);
  assert.match(accountPopover, /scrollbar-width:\s*thin/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.account-popover\s*\{\s*--account-popover-top:\s*49px;/);
  assert.match(design, /\.account-popover\s*\{\s*max-width:\s*calc\(100vw - 1rem\)/);
  assert.match(shell, /class="account-popover" popover="auto"[\s\S]*?account\.privacy/);
});

test("keeps page-shell content on one responsive inline gutter", async () => {
  const [styles, design] = await Promise.all([
    read("../src/styles.css"),
    read("../src/design-system.css"),
  ]);

  assert.match(styles, /--page-gutter:\s*clamp\(/);
  assert.match(design, /\.page-pad\s*\{\s*padding:\s*clamp\([^;]+\)\s+var\(--page-gutter\)\s+var\(--page-bottom-space\);\s*\}/);
  assert.match(design, /\.page-header--admin\s*\{[^}]*padding-inline:\s*var\(--page-gutter\);/s);
  assert.match(design, /\.administrative-page\s*>\s*forma-area-navigation\s+\.area-navigation--administrative\s*\{[^}]*padding-inline:\s*var\(--page-gutter\);/s);
  assert.match(design, /\.app-shell > forma-ui-audience-navigation\s*,\s*\.forma-platform-shell > forma-ui-audience-navigation\s*\{[^}]*padding:\s*0;/s);
  assert.match(design, /\.ui-audience-navigation-list\s*\{[^}]*padding-inline:\s*var\(--page-gutter,[^;]+\);[^}]*overflow-x:\s*auto;[^}]*scroll-padding-inline:\s*var\(--page-gutter,/s);
  assert.doesNotMatch(design, /\.app-shell > \.global-nav\s*,\s*\.app-shell > forma-ui-audience-navigation\.global-nav/);
  assert.match(design, /\.tabbar\s*\{[^}]*padding-inline:\s*var\(--page-gutter\);/s);
  assert.match(design, /\.admin-content\s*\{\s*padding:\s*clamp\([^;]+\)\s+var\(--page-gutter\)\s+var\(--page-bottom-space\);\s*\}/);
});

test("gives Library and dense administrative data their own responsive contracts", async () => {
  const [design, styles, admin] = await Promise.all([
    read("../src/design-system.css"),
    read("../src/styles.css"),
    read("../src/components/forma-admin-events.ts"),
  ]);

  assert.match(design, /\.library-main\s*\{\s*container:\s*library \/ inline-size;/);
  assert.match(design, /@container library \(max-width: 62rem\)[\s\S]*?\.family-card,[\s\S]*?\.output-focus-layout\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(design, /@container library \(max-width: 48rem\)[\s\S]*?\.library-toolbar,[\s\S]*?\.page-header--library/);
  assert.match(design, /\.event-table-wrap,[\s\S]*?\.permission-table\s*\{\s*overflow-x:\s*auto/);
  assert.match(design, /\.permission-table > div\s*\{\s*min-width:\s*32rem/);
  assert.match(admin, /class="builder-controls"><div class="builder-control-fields">/);
  assert.match(admin, /<\/label><\/div><div class="builder-control-actions"><button/);
  assert.match(styles, /\.builder-controls\s*>\s*div\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.builder-controls,\.builder-controls\s*>\s*div\s*\{[^}]*flex-direction:\s*column;/s);
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
  assert.match(navigation, /aria-label="Add context"/);
  assert.match(navigation, /aria-label=\$\{this\.#focused \? (?:this\.i18n\.system\()?"Exit focused document view"\)? : (?:this\.i18n\.system\()?"Enter focused document view"\)?\}/);
  assert.match(navigation, /class="studio-mode-links"/);
  assert.match(navigation, /#revealActiveMode\(\)/);
  assert.match(navigation, /a\[aria-current="page"\]/);
  assert.match(navigation, /scroller\.scrollLeft \+= activeBounds\.(?:left|right)/);
});

test("keeps every prompt-fan image and its controls inside bounded generation surfaces", async () => {
  const [styles, design, chat, editor, generations, library, workspace] = await Promise.all([
    read("../src/styles.css"),
    read("../src/design-system.css"),
    read("../src/components/forma-chat-studio.ts"),
    read("../src/components/forma-creative-editor.ts"),
    read("../src/components/document-generations.ts"),
    read("../src/components/forma-library.ts"),
    read("../src/components/forma-workspace.ts"),
  ]);

  assert.match(styles, /\.prompt-fan-visual\s*\{[^}]*aspect-ratio:\s*3 \/ 2;[^}]*grid-template-rows:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.prompt-fan-visual img\s*\{[^}]*object-fit:\s*contain/);
  assert.match(styles, /\.chat-prompt-fan > \.prompt-fan-visual\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;[^}]*aspect-ratio:\s*auto/);
  assert.match(styles, /\.document-generation-embedded-media > \.prompt-fan-visual\s*\{[^}]*height:\s*100%;[^}]*aspect-ratio:\s*auto/);
  assert.match(styles, /\.prompt-fan-visual\.compact\s*\{[^}]*height:\s*100%;[^}]*aspect-ratio:\s*auto/);
  assert.match(styles, /\.prompt-fan-image\s*\{[^}]*position:\s*relative;[^}]*aspect-ratio:\s*3 \/ 2/);
  assert.match(styles, /\.prompt-fan-image forma-output-visual,[^}]*\{[^}]*position:\s*static;[^}]*inset:\s*auto;[^}]*display:\s*block/);
  assert.match(styles, /@media \(max-width: 1100px\) and \(min-width: 621px\)[\s\S]*?\.prompt-fan-grid\s*\{\s*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(design, /\.document-generation-feature\.fan \.prompt-fan-visual\s*\{[^}]*min-height:\s*0;[^}]*aspect-ratio:\s*3 \/ 2/);
  assert.match(design, /\.modal-card\.prompt-fan-card\s*\{[^}]*width:\s*min\(90rem, calc\(100% - 1rem\)\);[^}]*padding:\s*0/);
  for (const surface of [chat, editor, generations, library, workspace]) {
    assert.match(surface, /forma-prompt-fan-visual/);
    assert.match(surface, /forma-prompt-fan-review/);
  }
});

test("gives Studio filmstrip images a complete bounded cover-crop chain", async () => {
  const [styles, workspace] = await Promise.all([
    read("../src/styles.css"),
    read("../src/components/forma-workspace.ts"),
  ]);

  assert.match(styles, /\.output-filmstrip\s*\{[^}]*grid-template-columns:\s*repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.mini-output\s*\{[^}]*display:\s*block;[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*height:\s*64px;[^}]*overflow:\s*hidden;[^}]*contain:\s*layout paint/);
  assert.match(styles, /\.mini-output > :is\(forma-output-visual,forma-prompt-fan-visual\)\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*max-width:\s*100%;[^}]*max-height:\s*100%/);
  assert.match(styles, /\.mini-output > forma-output-visual > \.generated-output-image\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*cover;[^}]*object-position:\s*var\(--focal-x,50%\) var\(--focal-y,50%\)/);
  assert.match(styles, /\.mini-output > forma-prompt-fan-visual > \.prompt-fan-visual\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*aspect-ratio:\s*auto/);
  assert.match(workspace, /class="mini-output/);
  assert.match(workspace, /forma-output-visual/);
  assert.match(workspace, /forma-prompt-fan-visual/);
});

test("keeps the affected-area editor and its image controls inside the dialog", async () => {
  const [styles, design, editor] = await Promise.all([
    read("../src/styles.css"),
    read("../src/design-system.css"),
    read("../src/components/spatial-scope-editor.ts"),
  ]);

  assert.match(design, /\.modal-card\.spatial-scope-card\s*\{[^}]*width:\s*min\(67\.5rem, calc\(100% - 1rem\)\);[^}]*margin:\s*\.5rem auto;[^}]*padding:\s*clamp\(1\.25rem, 3vw, 2\.125rem\)/);
  assert.doesNotMatch(styles, /\.spatial-scope-card\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(styles, /\.spatial-scope-preview\s*\{[^}]*min-width:\s*0/);
  assert.match(styles, /\.spatial-direct-tools button\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*?\.spatial-scope-layout\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(styles, /\.spatial-scope-card\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto minmax\(0,1fr\) auto;[^}]*overflow:\s*hidden/);
  assert.match(styles, /\.spatial-scope-scroll\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.spatial-scope-actions\s*\{[^}]*margin-top:\s*0;[^}]*border-top:\s*1px solid var\(--line\)/);
  assert.doesNotMatch(styles, /\.spatial-scope-actions\s*\{[^}]*position:\s*sticky/);
  assert.match(styles, /\.spatial-shape-handle\s*\{[^}]*position:\s*absolute;[^}]*touch-action:\s*none;[^}]*border:\s*2px solid #26372e;[^}]*border-radius:\s*50%/);
  assert.match(styles, /\.spatial-shape-handle--n,[^}]*\{[^}]*cursor:\s*ns-resize/);
  assert.match(styles, /\.spatial-shape-handle--e,[^}]*\{[^}]*cursor:\s*ew-resize/);
  assert.match(editor, /class="spatial-scope-scroll"><div class="spatial-scope-layout"/);
});

test("contains every dialog within the viewport and keeps page scrolling locked", async () => {
  const design = await read("../src/design-system.css");

  assert.match(design, /html:has\(dialog\[open\]\),\s*body:has\(dialog\[open\]\)\s*\{\s*overflow:\s*hidden/);
  assert.match(design, /dialog\s*\{[^}]*max-width:\s*calc\(100vw - var\(--dialog-viewport-gap\) - var\(--dialog-viewport-gap\)\);[^}]*max-height:\s*calc\(100dvh - var\(--dialog-viewport-gap\) - var\(--dialog-viewport-gap\)\);[^}]*overscroll-behavior:\s*contain/s);
  assert.match(design, /dialog\.modal,\s*dialog\.command-dialog\s*\{[^}]*height:\s*100dvh;[^}]*max-height:\s*100dvh;[^}]*overflow:\s*hidden/s);
  assert.match(design, /dialog\.modal\[open\],\s*dialog\.command-dialog\[open\]\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center/s);
  assert.match(design, /dialog\.modal > :first-child,\s*dialog\.command-dialog > :first-child\s*\{[^}]*max-width:\s*100%;[^}]*max-height:\s*100%;[^}]*margin:\s*0;[^}]*overscroll-behavior:\s*contain/s);
  assert.match(design, /dialog\.command-dialog \.command-results\s*\{[^}]*min-height:\s*0;[^}]*max-height:\s*none;[^}]*overflow:\s*auto/s);
});

test("keeps the account menu inside the dynamic viewport with accessible internal scrolling and focus return", async () => {
  const [design,shell]=await Promise.all([read("../src/design-system.css"),read("../src/components/forma-shell.ts")]);
  assert.match(design,/\.account-popover\s*\{[^}]*box-sizing:\s*border-box;[^}]*inline-size:\s*min\(22rem,[^;]*100dvw[^;]*safe-area-inset-left[^;]*safe-area-inset-right[^;]*\);[^}]*max-block-size:\s*calc\(100dvh\s*-\s*var\(--account-popover-top,\s*52px\)\s*-\s*max\([^;]*safe-area-inset-bottom[^;]*\)\);[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*scrollbar-gutter:\s*auto;/s);
  assert.match(design,/\.account-popover bdi\s*\{\s*overflow-wrap:\s*anywhere/);
  assert.match(shell,/popovertarget="account-popover" aria-controls="account-popover" aria-expanded=\$\{this\.store\.ui\.accountOpen\}/);
  assert.match(shell,/<div id="account-popover" class="account-popover" popover="auto" @beforetoggle=\$\{this\.#accountBeforeToggle\} @toggle=\$\{this\.#accountToggle\}>/);
  assert.match(shell,/#accountToggle = \(event: ToggleEvent\) => \{[\s\S]*?event\.newState === "open"[\s\S]*?this\.store\.patchUi\(\{ accountOpen: open \}\)/);
  assert.match(shell,/if\(!this\.store\.ui\.accountOpen&&accountPopover\?\.matches\(":popover-open"\)\)accountPopover\.hidePopover\(\)/);
  assert.match(shell,/this\.#accountReturnFocus=Boolean\(this\.querySelector<HTMLElement>\("#account-popover"\)\?\.matches\(":popover-open"\)\)/);
  assert.match(shell,/#accountBeforeToggle[\s\S]*?this\.#captureShellFocus\([\s\S]*?panel\.isConnected&&panel===this\.querySelector\("#account-popover"\)/);
  assert.match(shell,/:this\.#accountReturnFocus\?this\.querySelector<HTMLButtonElement>\("\.avatar"\):null/);
  assert.match(shell,/if\(target\)focus\.owner\.focus\.run\(target,\(\)=>\{target\.focus\(\);return true;\}\)/);
});

test("keeps document sharing reachable through the auto-dismissing account menu on narrow screens",async()=>{
  const [shell,design,responsive]=await Promise.all([read("../src/components/forma-shell.ts"),read("../src/design-system.css"),read("../src/responsive-foundation.css")]);
  assert.match(shell,/isCreative&&this\.store\.canManageProjectShares\(\)&&isDocumentViewRoute\(path\)&&projection\.documentId\?html`<button type="button" class="button secondary compact account-share-action"/);
  assert.match(shell,/@click=\$\{\(\)=>this\.#openShare\(true\)\}/);
  assert.match(shell,/#openShare\(closeAccount=false\)[\s\S]*accountOpen:false[\s\S]*shareOpen:true/);
  assert.match(shell,/class="command-trigger forma-global-search"/);
  assert.match(responsive,/\.topbar \.command-trigger\.forma-global-search\s*\{[^}]*display:\s*inline-flex/);
  assert.doesNotMatch(design,/\.account-share-action\s*\{[^}]*display:\s*none/);
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
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.workspace-page:has\(> \.composer-dock\) > \.studio-main\s*\{\s*padding-bottom:\s*128px/);
  assert.match(design, /\.studio-header-stack\s*\{[^}]*position:\s*sticky;[^}]*top:\s*64px;[^}]*background:\s*var\(--paper\)/);
  assert.match(design, /\.studio-header-stack > forma-studio-mode-nav > \.studio-mode-nav\s*\{[^}]*position:\s*static;[^}]*top:\s*auto/);
  assert.match(design, /@media \(max-width: 760px\)[\s\S]*?\.studio-header-stack\s*\{\s*position:\s*static;\s*top:\s*auto;/);
  for (const component of [workspace, alternatives, chat]) assert.match(component, /class="studio-header-stack"/);
});

test("keeps the fixed document composer task-focused while disclosing generation detail in a bounded dialog", async () => {
  const [styles,workspace,actions,formatEditor] = await Promise.all([
    read("../src/styles.css"),
    read("../src/components/forma-workspace.ts"),
    read("../src/components/generation-actions.ts"),
    read("../src/components/image-format-editor.ts"),
  ]);

  assert.match(workspace,/class="composer-command"/);
  assert.match(workspace,/forma-generation-actions source="document"[\s\S]*?compact/);
  assert.match(actions,/generation-details-trigger/);
  assert.match(actions,/Image options, (?:\$\{ratio\}|\{ratio\}) frame, (?:\$\{statusLabel\}|\{statusLabel\})/);
  assert.match(actions,/this\.compact&&this\.#detailsOpen&&\(!this\.#configurationCurrent\|\|this\.#configurationCurrent\(\)\)\?html`<dialog class="modal generation-details-dialog"/);
  assert.match(actions,/Output frame/);assert.match(actions,/Generation choices/);assert.match(actions,/Readiness and recovery/);assert.match(actions,/Compare prompt fans/);
  assert.match(styles,/\.modal-card\.generation-details-card\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,1fr\) auto;[^}]*overflow:\s*hidden/);
  assert.match(styles,/\.generation-details-body\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto/);
  assert.match(formatEditor,/\?selected=\$\{item\.id===preset\}/);
});
