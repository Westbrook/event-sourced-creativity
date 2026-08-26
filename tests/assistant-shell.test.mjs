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
  assert.match(host, /location\.assign\(destination\.route\)/u);
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

test("the visible assistant exposes governed model choice, explicit premium approval, task progress, and safe recovery", async () => {
  const [panel, host, policy, composer] = await Promise.all([
    read("src/components/design-system/assistant-panel.ts"),
    read("src/components/forma-creative-assistant.ts"),
    read("worker/pilot-policy.ts"),
    read("src/components/design-system/conversation-composer.ts"),
  ]);
  assert.match(panel, /class="forma-assistant-model"/u);
  assert.match(panel, /assistant\.model\.automatic/u);
  assert.match(panel, /premiumApprovalRequired/u);
  assert.match(panel, /type="checkbox"/u);
  assert.match(panel, /premiumApproval:\s*true/u);
  assert.match(panel, /#premiumApproved\s*=\s*false/u);
  assert.match(panel, /\.submitDisabled=\$\{Boolean\(selectedModel\?\.premiumApprovalRequired && !this\.#premiumApproved \|\| this\.#?busyModes\.includes\(this\.#activeMode\)\)\}/u);
  assert.match(composer, /\?disabled=\$\{this\.disabled \|\| this\.submitDisabled \|\| this\.busy \|\| !this\.value\.trim\(\)\}/u);
  assert.match(panel, /class="forma-assistant-task"/u);
  assert.match(panel, /assistant\.task\.estimatedCost/u);
  assert.match(panel, /assistant\.task\.cancel/u);
  assert.match(panel, /\["needs-review", "reconciling"\]\.includes\(task\.status\) && this\.canReconcile/u);
  assert.match(panel, /\["needs-review", "reconciling"\]\.includes\(task\.status\) && !this\.canReconcile/u);
  assert.match(panel, /task\.status === "needs-review" \|\| task\.status === "reconciling" \? "needsReview"/u);
  assert.match(panel, /assistant\.task\.contactAdministrator/u);
  assert.match(panel, /assistant\.task\.reviewReference/u);
  assert.match(host, /premiumApproval:\s*true/u);
  assert.match(host, /\/api\/assistant\/tasks\//u);
  assert.match(host, /confirmedNoProviderCharge:\s*true/u);
  assert.match(host, /task\.status === "queued" \|\| task\.status === "running" \|\| task\.status === "reconciling"/u);
  assert.match(host, /@forma-assistant-task=/u);
  assert.match(policy, /assistantPremiumUsers/u);
  assert.match(panel,/assistant\.coverage\.visible/u,"on-screen context is honestly distinguished from provider-visible evidence");
  assert.match(panel,/assistant\.coverage\.readable/u);
  assert.match(panel,/assistant\.coverage\.withheld/u);
  assert.match(panel,/assistant\.coverage\.protectedOverflow/u);
  assert.match(panel,/item\.providerEligible&&\(!item\.immutable\|\|item\.providerVisibility==="governed"\)/u);
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
