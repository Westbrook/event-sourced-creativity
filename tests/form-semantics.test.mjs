import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  architecture: "../ARCHITECTURE.md",
  canvas: "../src/canvas/canvas-application.ts",
  context: "../src/components/context-block.ts",
  guided: "../src/components/forma-studio-alternatives.ts",
  spatial: "../src/components/spatial-scope-editor.ts",
  chat: "../src/components/forma-chat-studio.ts",
  workspace: "../src/components/forma-workspace.ts",
  shell: "../src/components/forma-shell.ts",
  governance: "../src/apps/operations/canvas-governance.ts",
  admin: "../src/components/forma-admin-events.ts",
  creative: "../src/components/forma-creative-editor.ts",
  library: "../src/components/forma-library.ts",
  analytics: "../src/components/forma-analytics.ts",
  sessions: "../src/components/forma-sessions.ts",
  scout: "../src/components/forma-scout.ts",
  projects: "../src/components/forma-project-contents.ts",
  findings: "../src/components/reference-findings.ts",
  pixelPolicy: "../src/components/reference-pixel-policy.ts",
  presentation: "../src/components/presentation-deck.ts",
  fanReview: "../src/components/prompt-fan-review.ts",
  navigation: "../src/components/studio-navigation.ts",
  system: "../src/components/forma-system.ts",
  catalog: "../src/components/design-system/component-catalog.ts",
  lab: "../src/components/forma-design-system-lab.ts",
};

const sources = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([key, path]) => [key, await readFile(new URL(path, import.meta.url), "utf8")]),
));

test("Canvas creation, source selection, membership, and view settings each own their action", () => {
  assert.match(sources.canvas, /<form class="modal-card canvas-compact-dialog" @submit=/);
  assert.match(sources.canvas, /<form class="canvas-context-create-form" @submit=/);
  assert.match(sources.canvas, /<form class="canvas-context-source-form" @submit=/);
  assert.match(sources.canvas, /<form class="modal-card canvas-compact-dialog canvas-combine-dialog" @submit=/);
  assert.match(sources.canvas, /<form class="modal-card canvas-compact-dialog canvas-document-dialog" @submit=/);
  assert.match(sources.canvas, /<form class="canvas-member-form" @submit=/);
  assert.match(sources.canvas, /<form class="canvas-view-preferences" @submit=/);
  assert.match(sources.canvas, /type="submit"[^>]*>Create board/);
  assert.match(sources.canvas, /type="submit"[^>]*>Add \$\{selected\.length\|\|""\} to canvas/);
  assert.match(sources.canvas, /<form class="canvas-context-create-form"[\s\S]*?<\/form>\s*<form class="canvas-context-source-form"/);
});

test("guided document submission and nested spatial editing use separate native form owners", () => {
  assert.match(sources.guided, /const guidedFormId = `guided-brief-\$\{projection\.documentId\}`/);
  assert.match(sources.guided, /<form id=\$\{guidedFormId\} @submit=\$\{this\.#saveSection\}><\/form>/);
  assert.match(sources.guided, /<section class="guided-brief guided-brief--focused">/);
  assert.match(sources.guided, /<select form=\$\{guidedFormId\}/);
  assert.match(sources.guided, /<textarea[^>]* form=\$\{guidedFormId\}/);
  assert.match(sources.guided, /<button type="submit" form=\$\{guidedFormId\}/);
  assert.doesNotMatch(sources.guided, /<form class="guided-brief/);
  assert.match(sources.spatial, /<form class="modal-card spatial-scope-card" @submit=/);
  assert.match(sources.spatial, /<button type="submit" class="button primary"/);
});

test("context editors submit their own decision while classifiers, groups, and influence stay isolated", () => {
  assert.match(sources.context, /<form class="block-editor" @submit=/);
  assert.match(sources.context, /event\.isComposing/);
  assert.match(sources.context, /HTMLTextAreaElement\)\.form\?\.requestSubmit\(\)/);
  assert.match(sources.context, /<button type="button" class="button ghost"/);
  assert.match(sources.context, /<button type="submit" class="button primary"/);
  assert.match(sources.context, /<form class="block-classifiers" @submit=/);
  assert.match(sources.context, /<form class="block-combined-context" @submit=/);
  assert.match(sources.context, /<form class="block-influence-form" @submit=/);
  assert.match(sources.context, /<forma-spatial-scope-editor/);
});

test("multiline composers preserve composition, disabled submitters, and native requestSubmit", () => {
  for (const source of [sources.chat, sources.workspace]) {
    assert.match(source, /(?:event|e)\.isComposing/);
    assert.match(source, /submitter&&!submitter\.disabled/);
    assert.match(source, /submitter\.form\?\.requestSubmit\(submitter\)/);
  }
  assert.match(sources.chat, /<form class="chat-composer" @submit=/);
  assert.match(sources.chat, /<button type="submit"/);
  assert.match(sources.workspace, /<form class="composer-command" @submit=/);
});

test("shell dialogs isolate localization, consent, sharing, preferences, and command execution", () => {
  for (const className of ["locale-picker-form", "share-link-builder", "consent-form", "command-card", "account-preferences"]) {
    assert.match(sources.shell, new RegExp(`<form class="${className}" @submit=`));
  }
  assert.match(sources.shell, /const editingField =/);
  assert.match(sources.shell, /!editingField/);
  assert.match(sources.shell, /type="submit" class="sr-only"/);
  assert.match(sources.shell, /<button type="button"[^>]*class="command-row"/);
});

test("governance approval workflows validate and submit their own evidence", () => {
  assert.match(sources.governance, /<form class="canvas-governance-approval" @submit=/);
  assert.match(sources.governance, /<form class="canvas-adapter-approval" @submit=/);
  assert.match(sources.governance, /this\.requestUpdate\(\)/);
  assert.match(sources.governance, /type="submit"/);
});

test("paid replay configuration never implicitly submits the privileged approval action", () => {
  assert.match(sources.admin, /<form id="actual-replay-configuration" @submit=/);
  assert.match(sources.admin, /<form id="actual-replay-approval" @submit=\$\{this\.#runActual\}><\/form>/);
  assert.match(sources.admin, /form="actual-replay-configuration"/);
  assert.match(sources.admin, /form="actual-replay-approval"/);
  assert.match(sources.admin, /<button type="submit" form="actual-replay-approval"/);
  assert.match(sources.admin, /async #runActual\(event:SubmitEvent\)\{\s*event\.preventDefault\(\)/);
  assert.match(sources.admin, /const trustedActivation=this\.#trustedPaidActivation;this\.#trustedPaidActivation=false/);
  assert.match(sources.admin, /!event\.isTrusted\|\|!trustedActivation\|\|navigator\.userActivation/);
  assert.match(sources.admin, /this\.#trustedPaidActivation=event\.isTrusted/);
  assert.match(sources.admin, /this\.#approvalPhrase!==live\.approvalPhrase/);
  assert.match(sources.admin, /!this\.#costAcknowledged\|\|!this\.#directApproval/);
  assert.doesNotMatch(sources.admin, /requestSubmit\(/);
});

test("free replay and fictional-account actions remain separate from paid generation", () => {
  assert.match(sources.admin, /<form id="theoretical-replay-form" @submit=/);
  assert.match(sources.admin, /form="theoretical-replay-form"/);
  assert.match(sources.admin, /<form class="replay-builder reverse-workflow-builder"[^>]*@submit=/);
  assert.match(sources.admin, /<form class="replay-persona-panel" @submit=\$\{this\.#experienceReplay\}>/);
  assert.match(sources.admin, /async #experienceReplay\(event:SubmitEvent\)\{event\.preventDefault\(\)/);
  assert.match(sources.admin, /const trustedActivation=this\.#trustedPersonaActivation;this\.#trustedPersonaActivation=false/);
  assert.match(sources.admin, /this\.#trustedPersonaActivation=event\.isTrusted/);
  for (const className of ["filterbar", "replay-playback-options", "replay-scrubber"]) {
    assert.match(sources.admin, new RegExp(`<form class="${className}" @submit=`));
  }
});

test("reference uploads require rights confirmation within their own submit boundary", () => {
  assert.match(sources.workspace, /<form class="reference-picker-form" @submit=/);
  assert.match(sources.workspace, /<form class="modal-card reference-upload-card" @submit=/);
  assert.match(sources.workspace, /this\.#rightsConfirmed&&!this\.#uploading/);
  assert.match(sources.creative, /<form class="modal-card creative-reference-card" @submit=/);
  assert.match(sources.creative, /type="submit"/);
});

test("library, project, analytics, scout, and session actions have appropriately scoped forms", () => {
  assert.match(sources.library, /<form class="library-toolbar" @submit=/);
  assert.match(sources.library, /<form class="corpus-filters" @submit=/);
  assert.match(sources.projects, /<form class="project-contents-toolbar" @submit=/);
  assert.match(sources.analytics, /<form class="analytics-controls" @submit=/);
  assert.match(sources.scout, /<form class="scout-run-panel" @submit=/);
  assert.match(sources.sessions, /<form class="intent-card" @submit=/);
  assert.match(sources.sessions, /this\.requestUpdate\(\)/);
});

test("reference analysis and preferences use stable explicit form association", () => {
  assert.match(sources.findings, /const analysisFormId = `reference-analysis-\$\{this\.block\.id\}`/);
  assert.match(sources.findings, /<form id=\$\{analysisFormId\} @submit=/);
  assert.match(sources.findings, /form=\$\{analysisFormId\}/);
  assert.match(sources.findings, /<button type="submit" form=\$\{analysisFormId\}/);
  assert.match(sources.pixelPolicy, /const inheritedForm = this\.closest\("form"\)/);
  assert.match(sources.pixelPolicy, /inheritedForm \? nothing : html`<form id=\$\{policyFormId\}/);
  assert.match(sources.presentation, /<form id=\$\{preferenceFormId\} hidden @submit=/);
  assert.match(sources.presentation, /form=\$\{preferenceFormId\}/);
});

test("live preference controls never acquire nearby destructive or navigation actions", () => {
  assert.match(sources.fanReview, /<form class="prompt-fan-preference-bar" @submit=/);
  assert.equal((sources.navigation.match(/<form class="studio-navigation-form"/g) ?? []).length, 2);
  assert.match(sources.system, /<form class="attention-governance-form" @submit=/);
  assert.match(sources.system, /<\/form>\$\{this\.store\.ui\.attentionCapture\?html`<button/);
});

test("component previews give every editable demo its own nonvalidating native form", () => {
  assert.ok((sources.catalog.match(/<form novalidate @submit=/g) ?? []).length >= 9);
  assert.equal((sources.lab.match(/<form novalidate @submit=/g) ?? []).length, 3);
  assert.match(sources.catalog, /<form class="component-library-search" @submit=/);
  assert.match(sources.catalog, /<form class="component-theme-settings" @submit=/);
});

test("architecture records repeatable native ownership, nesting, keyboard, and authorization rules", () => {
  assert.match(sources.architecture, /## Native form ownership and submission/);
  assert.match(sources.architecture, /Native forms never nest/);
  assert.match(sources.architecture, /requestSubmit\(\)/);
  assert.match(sources.architecture, /trusted direct submit-button activation/);
});
