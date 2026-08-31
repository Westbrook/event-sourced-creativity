import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ASSISTANT_MESSAGES } from "../src/components/design-system/locales/assistant-messages.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the Creator/Canvas host mounts after primary content and never crosses public or platform boundaries", async () => {
  const [creator, platform, shared, panel] = await Promise.all([
    read("src/components/forma-shell.ts"),
    read("src/components/forma-platform-shell.ts"),
    read("src/apps/public-share/entry.ts"),
    read("src/components/design-system/assistant-panel.ts"),
  ]);
  assert.match(creator, /<main id="main-content"[\s\S]*?<\/main>\s*\$\{session\?\.assistant\?\.enabled[\s\S]*?<forma-creative-assistant/u);
  assert.match(creator, /pathname==="\/share"\|\|pathname\.startsWith\("\/share\/"\)\)return/u);
  assert.doesNotMatch(platform, /forma-creative-assistant|state\/store|\.\/forma-element/u);
  assert.doesNotMatch(shared, /assistant|api\/session|state\/store/u);
  assert.doesNotMatch(panel, /state\/store|forma-element|\/api\/events|\/api\/document-jobs/u);
});

test("every privileged page gets an independent accessible platform host with no Creator store or mutation transport", async () => {
  const [shell, host, panel, authorization] = await Promise.all([
    read("src/components/forma-platform-shell.ts"),
    read("src/components/forma-platform-assistant.ts"),
    read("src/components/design-system/assistant-panel.ts"),
    read("worker/platform-assistant-api.ts"),
  ]);
  assert.match(shell, /<main id="main-content"[\s\S]*?<\/main>\s*\$\{[\s\S]*?<forma-platform-assistant/u);
  assert.match(shell, /session\.assistant\.host === "platform"/u);
  assert.match(shell, /visualViewport\?\.addEventListener\("resize", this\.#syncKeyboard\)/u);
  assert.match(shell, /visualViewport\?\.removeEventListener\("resize", this\.#syncKeyboard\)/u);
  assert.match(host, /extends FormaPresentationalElement/u);
  assert.match(host, /\/api\/platform\/assistant/u);
  assert.match(host, /x-forma-platform-permission-epoch/u);
  assert.match(host, /\.readOnly=\$\{false\}/u);
  assert.match(host, /\.guidanceOnly=\$\{true\}/u);
  assert.match(host, /\.models=\$\{\[\]\}/u);
  assert.match(host, /\.pageLabel=\$\{this\.#pageLabel\(\)\}/u);
  assert.match(host, /destination\.application !== session\.audience/u);
  assert.match(host, /if \(!host\?\.navigateFrom\(this, destination\.route\)\) return;/u);
  assert.match(shell, /applicationIdFromRoute\(path\) !== applicationIdFromRoute\(location\.pathname\)[\s\S]*?location\.assign\(path\)/u);
  assert.doesNotMatch(host, /history\.pushState|location\.assign/u);
  assert.match(host, /session\.availableApplications\?\.some/u);
  assert.match(host, /platformSession\.subscribe\(\(\) => \{ this\.#sessionChanged\(\); \}\)/u);
  assert.match(host, /this\.#unsubscribe\?\.\(\)/u);
  assert.match(host, /this\.#pending\.clear\(\)/u);
  assert.match(host, /values:\s*turn\.reply\.values/u);
  assert.match(host, /values:\s*payload\.turn\.reply\.values/u);
  assert.match(host, /assistant\.platform\.page\.\$\{specific\}/u);
  assert.doesNotMatch(host, /state\/store|FormaElement|forma-creative-assistant|\/api\/events|\/api\/document-jobs/u);
  assert.doesNotMatch(authorization, /foldEvents|readProjectRequestContext|requestAssistantProvider|OPENAI_API_KEY|\/api\/document-jobs/u);
  assert.match(panel, /proposal\.summaryKey \? this\.i18n\.t\(proposal\.summaryKey\)/u);
  assert.match(panel, /this\.guidanceOnly(?: && this\.#activeMode === "guidance")? \? html`<p[^`]*assistant\.guidanceOnly/u);
});

test("free guidance separates exact specialist approval, durable task recovery and legacy financial controls", async () => {
  const [panel, host, policy, composer, assistantApi] = await Promise.all([
    read("src/components/design-system/assistant-panel.ts"),
    read("src/components/forma-creative-assistant.ts"),
    read("worker/pilot-policy.ts"),
    read("src/components/design-system/conversation-composer.ts"),
    read("worker/assistant-api.ts"),
  ]);
  assert.match(panel, /#specialistView\(\)/u);
  assert.match(panel, /consequentialPreview\(quote, this\.i18n\)/u);
  assert.match(panel, /ensureNativeModalDialog/u);
  assert.match(panel, /premiumApprovalRequired/u);
  assert.doesNotMatch(panel, /type="checkbox"|premiumApproval:\s*true|#premiumApproved/u);
  const submit = panel.slice(panel.indexOf("  #submit("), panel.indexOf("  #contextName("));
  assert.doesNotMatch(submit, /model:|premiumApproval/u);
  assert.match(submit, /retainGuidanceDraft/u);
  assert.match(composer, /\?disabled=\$\{this\.disabled \|\| this\.submitDisabled \|\| this\.busy \|\| !this\.value\.trim\(\)\}/u);
  assert.match(panel, /class="forma-assistant-task"/u);
  assert.match(panel, /assistant\.specialist\.retrieve/u);
  assert.match(panel, /!task\.executionId && task\.status === "queued"/u);
  assert.match(panel, /assistant\.task\.estimatedCost/u);
  assert.match(panel, /assistant\.task\.contactAdministrator/u);
  assert.match(host, /\/api\/assistant\/specialist/u);
  assert.match(host, /approvedBindingHash: approvedHash/u);
  assert.match(host, /request\.turnId, message: request\.message, locale: request\.locale/u);
  assert.doesNotMatch(host, /premiumApproval:\s*true/u);
  assert.match(host, /if \(detail\.action !== "cancel"\) return;/u);
  assert.match(host, /\.canReconcile=\$\{false\}/u);
  assert.doesNotMatch(host, /confirmedNoProviderCharge|\/reconcile/u);
  const actorTask = assistantApi.slice(assistantApi.indexOf("export async function handleAssistantTask("), assistantApi.indexOf("/** The historical no-charge attestation"));
  assert.match(actorTask, /if \(operation === "reconcile"\) \{[\s\S]*?return json\(\{ error: "assistant_independent_reviewer_required" \}, 403\);/u);
  const billing = assistantApi.slice(assistantApi.indexOf("export async function handleAssistantBillingReconciliation("));
  assert.match(billing, /actorUserId === reviewer\.userId/u);
  assert.match(billing, /body\.confirmedNoProviderCharge !== true/u);
  assert.match(host, /if \(detail\.task\.executionId\) \{[\s\S]*assistantApprovedRequestCanStop/u);
  assert.match(panel, /assistant\.specialist\.stopLabel/u);
  assert.match(host, /action === "stop" \? undefined : \{ action/u);
  assert.match(host, /@forma-assistant-task=/u);
  assert.match(policy, /assistantPremiumUsers/u);
  for (const key of ["visible", "readable", "withheld", "protectedOverflow"]) {
    assert.ok(panel.includes("assistant.coverage." + key));
  }
  assert.match(panel, /item\.providerEligible&&\(!item\.immutable\|\|item\.providerVisibility==="governed"\)/u);
});

test("the assistant keeps all four locales and exact interpolation placeholders aligned", () => {
  const ids = Object.keys(ASSISTANT_MESSAGES.en).sort();
  const placeholders = (value) => [...value.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]).sort();
  for (const [locale, messages] of Object.entries(ASSISTANT_MESSAGES)) {
    assert.deepEqual(Object.keys(messages).sort(), ids, locale);
    for (const id of ids) {
      assert.ok(messages[id].trim(), `${locale}: ${id}`);
      assert.deepEqual(placeholders(messages[id]), placeholders(ASSISTANT_MESSAGES.en[id]), `${locale}: ${id}`);
    }
  }
});

test("composer remains enabled for overlapping work, respects IME, and restores keyboard focus", async () => {
  const [panel, host, styles, composer] = await Promise.all([
    read("src/components/design-system/assistant-panel.ts"),
    read("src/components/forma-creative-assistant.ts"),
    read("src/components/design-system/assistant-panel.css"),
    read("src/components/design-system/conversation-composer.ts"),
  ]);
  assert.match(composer, /event\.isComposing/u);
  assert.match(composer, /submitter\.form\.requestSubmit\(submitter\)/u);
  assert.match(panel, /<forma-ui-conversation-composer/u);
  assert.match(panel, /this\.querySelector<HTMLButtonElement>\("\.forma-assistant-launcher"\)\?\.focus\(\)/u);
  assert.match(host, /#pending = new Set/u);
  assert.doesNotMatch(panel, /disabled=\$\{this\.pending/u);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/u);
  assert.match(styles, /forced-colors:\s*active/u);
  assert.match(styles, /--forma-keyboard-offset/u);
  assert.match(styles, /min-(?:inline|block)-size:\s*2\.75rem/u);
});

test("specialized assistants preserve exact scope, truthful readiness, reviewed actions, and reachable compact previews",async()=>{
  const [host,panel,chat,adaptive,canvas,styles,panelStyles,worker]=await Promise.all([
    read("src/components/forma-creative-assistant.ts"),read("src/components/design-system/assistant-panel.ts"),
    read("src/components/forma-chat-studio.ts"),read("src/components/forma-studio-editor-alternatives.ts"),
    read("src/canvas/canvas-application.ts"),read("src/responsive-foundation.css"),
    read("src/components/design-system/assistant-panel.css"),read("worker/document-jobs-api.ts"),
  ]);
  assert.match(host,/#localToolMessages: AssistantDisplayedMessage\[\] = \[\]/u);
  assert.match(host,/\.\.\.this\.#localToolMessages/u);
  assert.match(host,/this\.#localToolMessages = \[\]/u);
  assert.doesNotMatch(host,/scope !== this\.#scope\(\)\) \{ panel\.resolveToolRequest\(false, input\.message\)/u);
  assert.match(host,/adaptiveSuggestionSetsFor\(documentId,surface\.canvasId\)/u);
  for(const source of [host,chat,adaptive,canvas])assert.match(source,/plannerConfigured/u);
  assert.match(chat,/this\.#livePreview&&Boolean\(this\.store\.session\.get\(\)\?\.provider\.configured\)/u);
  assert.match(chat,/assistant\.previewUnavailable/u);
  assert.match(chat,/chat-budget-disclosure/u);
  assert.match(chat,/chat-result-close/u);
  assert.match(panel,/\.help=\$\{this\.i18n\.t\("assistant\.composer\.help"\)\}/u);
  assert.match(chat,/\.help=\$\{this\.i18n\.t\("assistant\.composer\.help"\)\}/u);
  assert.match(panel,/assistant\.mode\.guidanceBudget/u);
  assert.match(styles,/\.chat-result-toggle,\s*\.chat-result-close\s*\{\s*display:\s*none/u);
  assert.match(styles,/\.chat-generation > footer\s*\{\s*min-block-size:\s*0;\s*overflow-y:\s*auto/u);
  assert.match(styles,/\.chat-composer-help:not\(\.chat-budget-disclosure\)/u);
  assert.match(panelStyles,/z-index:\s*53/u);
  assert.match(panelStyles,/grid-template-rows:\s*auto minmax\(0, 1fr\) auto/u);
  assert.match(worker,/error:"canvas_context_required"/u);
  assert.match(worker,/error:"project_context_required"/u);
});
