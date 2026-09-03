import { test, expect, attachJSON, captureViewport, openForma } from "./fixtures.mjs";
import { measureFormaFocusVisibility } from "../helpers/forma-dom-focus-visibility.mjs";
import { documentPath, rawOutcome, rawSource, savedArticles, waitForExistingDocument, verifyFocus, pressTo, tabTo } from "./helpers/keyboard-journey.mjs";

test("Document recipe: review, keep, discard and explicit clear preserve keyboard and content custody", async ({ page, context, geometry }, testInfo) => {
  await openForma(page, context, geometry, documentPath, testInfo);
  const entry = page.locator(".output-recipe-entry");
  const summary = entry.locator("summary");
  const recipe = entry.getByRole("combobox", { name: "Workflow recipes", exact: true });
  const slides = entry.getByRole("checkbox", { name: "Slides", exact: true });
  const goal = entry.getByRole("textbox", { name: "What needs to be delivered?", exact: true });
  const review = entry.getByRole("button", { name: "Review editable requirements · no generation", exact: true });
  const clear = entry.getByRole("button", { name: "Clear recipe input", exact: true });
  await waitForExistingDocument(page);
  const originalArticles = await savedArticles(page);
  await attachJSON(testInfo, "saved-context-before", originalArticles);
  const observationOptions = {
    regionSelectors: [".output-recipe-entry", ".output-requirement-warning", "forma-ui-notice"],
    checkVisibleControls: true,
  };

  // Preparation uses ordinary controls; subsequent transitions are native keys only.
  await summary.click();
  await expect(entry).toHaveAttribute("open", "");
  await recipe.selectOption("executive-deck");
  await slides.check();
  await expect(slides).toBeFocused();
  await pressTo(page, "Tab", goal, testInfo, "document-00-native-entry-arrival", observationOptions);
  await goal.fill(rawOutcome);
  await expect(goal).toHaveValue(rawOutcome);
  await verifyFocus(page, goal, testInfo, "document-01-entry", observationOptions);
  await pressTo(page, "Tab", review, testInfo, "document-02-review", observationOptions);
  await page.keyboard.press("Enter");
  const draft = page.locator("[data-output-recipe-draft]");
  const card = draft.locator("forma-output-requirement-card");
  const original = card.getByRole("textbox", { name: /^Original request(?: ·|$)/ });
  const keep = card.getByRole("button", { name: /^Keep editing(?: ·|$)/ });
  const discard = card.getByRole("button", { name: /^Discard changes(?: ·|$)/ });
  await verifyFocus(page, original, testInfo, "document-03-original", observationOptions);
  const originalId = await original.getAttribute("id");
  const requirementId = await draft.getAttribute("data-output-recipe-draft");
  expect(originalId).toBeTruthy();
  expect(requirementId).toBeTruthy();
  await expect(original).toHaveValue(rawOutcome);
  // Critical field help uses the existing calibrated region observer. No Range
  // clipping extension, focus repair, scrolling or new journey is introduced.
  const helpSelector = 'forma-workspace #document-context-panel [data-output-recipe-draft] > forma-output-requirement-card > .output-requirement-card > form.output-requirement-form > label.output-requirement-field:has(> textarea[name="originalText"]) > small:not(.output-requirement-error)';
  const expectedHelp = "This local interpretation is a proposal. Inspect and edit it before confirming; no provider is contacted.";
  const editorSelector = 'forma-workspace #document-context-panel [data-output-recipe-draft] > forma-output-requirement-card > .output-requirement-card > form.output-requirement-form';
  const editorCopy = [
    { key: "proposalDraft", relative: ":scope > p.output-requirement-note:first-child", text: "Proposed requirements — not yet saved" },
    { key: "dirtyState", relative: ":scope > p.output-requirement-note:first-child + p:not([class])", text: "Local edits do not change saved completion or approval." },
    { key: "packageLabel", relative: ':scope > label.output-requirement-field:has(> input[name="packageLabel"]) > span', text: "Purpose or package name" },
    { key: "packageHelp", relative: ':scope > label.output-requirement-field:has(> input[name="packageLabel"]) > small:not(.output-requirement-error)', text: "Names can contain up to 240 characters. Original wording is preserved separately." },
    { key: "originalLabel", relative: ':scope > label.output-requirement-field:has(> textarea[name="originalText"]) > span', text: "Original request" },
  ].map(item => ({ ...item, selector: item.relative.replace(":scope", editorSelector) }));
  const helpNodes = await original.evaluateHandle((element, definitions) => {
    const label = element.parentElement, form = element.form;
    const packageInput = form?.querySelector(':scope > label.output-requirement-field > input[name="packageLabel"]') ?? null;
    return { original: element, label, form, card: element.closest("forma-output-requirement-card"),
      draft: element.closest("[data-output-recipe-draft]"), packageInput, packageLabel: packageInput?.parentElement ?? null,
      editorNodes: definitions.map(definition => ({ ...definition, node: form?.querySelector(definition.relative) ?? null })),
      help: label?.querySelector(":scope > small:not(.output-requirement-error)") ?? null };
  }, editorCopy);
  const readHelpCustody = () => helpNodes.evaluate((nodes, selector) => {
    const { original, label, form, card, draft, help, packageInput, packageLabel, editorNodes } = nodes;
    const doc = original.ownerDocument, win = doc.defaultView;
    const selected = [...doc.querySelectorAll(selector)];
    const current = selected.length === 1 ? selected[0] : null;
    const styles = help ? win.getComputedStyle(help) : null;
    const section = card?.querySelector(":scope > .output-requirement-card");
    const idCount = id => id ? doc.querySelectorAll("#" + win.CSS.escape(id)).length : 0;
    const describe = node => node ? { tag: node.tagName, id: node.id || null, className: node.getAttribute("class"), role: node.getAttribute("role") } : null;
    const packageHelp = editorNodes.find(item => item.key === "packageHelp")?.node;
    const editorStyles = editorNodes.map(({ key, node }) => {
      const s = node ? win.getComputedStyle(node) : null;
      return { key, style: s ? { display: s.display, visibility: s.visibility, opacity: s.opacity,
        overflowX: s.overflowX, overflowY: s.overflowY, textOverflow: s.textOverflow,
        lineClamp: s.getPropertyValue("-webkit-line-clamp"), color: s.color,
        hidden: node.matches("[hidden],[inert],[aria-hidden='true']") } : null };
    });
    return {
      current: { originalConnected: original.isConnected, labelConnected: Boolean(label?.isConnected),
        formConnected: Boolean(form?.isConnected), cardConnected: Boolean(card?.isConnected), draftConnected: Boolean(draft?.isConnected),
        helpConnected: Boolean(help?.isConnected), sameSelectedHelp: current === help, selectedCount: selected.length,
        sameOriginal: label?.querySelector(':scope > textarea[name="originalText"]') === original,
        sameForm: original.form === form && form?.contains(original) && label?.parentElement === form,
        sameCard: original.closest("forma-output-requirement-card") === card && form?.parentElement === section,
        sameDraft: card?.parentElement === draft && original.closest("[data-output-recipe-draft]") === draft,
        directHelp: help?.parentElement === label, labelControl: label?.control === original,
        nativeFocused: original.getRootNode().activeElement === original && original.matches(":focus"),
        uniqueOriginalId: idCount(original.id) === 1, uniqueHelpId: idCount(help?.id) === 1,
        editorNodesCurrent: editorNodes.every(item => item.node?.isConnected && form?.contains(item.node)
          && doc.querySelectorAll(item.selector).length === 1 && doc.querySelector(item.selector) === item.node
          && form.querySelectorAll(item.relative).length === 1 && form.querySelector(item.relative) === item.node),
        packageFieldCurrent: packageInput?.isConnected && packageLabel?.isConnected
          && packageInput.form === form && packageLabel.parentElement === form && packageLabel.control === packageInput
          && packageLabel.getAttribute("for") === packageInput.id && packageHelp?.parentElement === packageLabel
          && packageHelp.id === packageInput.id + "-help" && idCount(packageInput.id) === 1 && idCount(packageHelp.id) === 1
          && (packageInput.getAttribute("aria-describedby") ?? "").split(/\s+/).includes(packageHelp.id) },
      raw: { originalId: original.id, value: original.value, name: original.name,
        labelFor: label?.getAttribute("for") ?? null, labelText: label?.querySelector(":scope > span")?.textContent ?? null,
        formAttribute: original.getAttribute("form"), formId: form?.id ?? null,
        describedBy: original.getAttribute("aria-describedby"), helpId: help?.id ?? null,
        helpText: help?.textContent ?? null, helpTag: help?.tagName ?? null,
        requirementId: draft?.getAttribute("data-output-recipe-draft") ?? null,
        cardState: section?.getAttribute("data-state") ?? null,
        cardLabelledBy: section?.getAttribute("aria-labelledby") ?? null,
        cardHeader: section?.querySelector(":scope > header")?.textContent ?? null,
        packageField: { id: packageInput?.id ?? null, name: packageInput?.name ?? null, value: packageInput?.value ?? null,
          maxLength: packageInput?.maxLength ?? null, labelFor: packageLabel?.getAttribute("for") ?? null,
          formAttribute: packageInput?.getAttribute("form") ?? null, formId: packageInput?.form?.id ?? null,
          describedBy: packageInput?.getAttribute("aria-describedby") ?? null, helpId: packageHelp?.id ?? null },
        editorCopy: editorNodes.map(item => ({ key: item.key, selector: item.selector,
          element: describe(item.node), text: item.node?.textContent ?? null })) },
      editorStyles,
      helpStyle: styles ? { display: styles.display, visibility: styles.visibility, opacity: styles.opacity,
        overflowX: styles.overflowX, overflowY: styles.overflowY, textOverflow: styles.textOverflow,
        lineClamp: styles.getPropertyValue("-webkit-line-clamp"), color: styles.color,
        fontFamily: styles.fontFamily, fontSize: styles.fontSize, lineHeight: styles.lineHeight } : null,
      launcherOwners: [...doc.querySelectorAll("forma-assistant-panel")].map(panel => ({
        dataset: { ...panel.dataset }, position: win.getComputedStyle(panel).position,
        launcherCount: panel.querySelectorAll(":scope > button.forma-assistant-launcher").length })),
    };
  }, helpSelector);
  let initialHelp;
  const helpObservations = [];
  const observeHelp = async stage => {
    const samples = [];
    for (let sample = 0; sample < 2; sample += 1) {
      if (sample) await page.waitForTimeout(250); // Fixed observation interval; never retry for preferred placement.
      const custody = await readHelpCustody();
      const measurement = await original.evaluate(measureFormaFocusVisibility, {
        ...observationOptions, stage: stage + "-help-" + sample, requireFocusVisible: true,
        overlaySelectors: [".forma-assistant-launcher", ":popover-open", ":modal", ".topbar"],
        regionSelectors: [...observationOptions.regionSelectors, helpSelector, ...editorCopy.map(item => item.selector)],
      });
      const helpRegions = measurement.regions.filter(region => region.element.tag === "SMALL"
        && region.element.id === originalId + "-help");
      const region = helpRegions.length === 1 ? helpRegions[0] : null;
      const fullBox = Boolean(region?.paintedBox && region.raw.left >= region.intersection.left
        && region.raw.right <= region.intersection.right && region.raw.top >= region.intersection.top
        && region.raw.bottom <= region.intersection.bottom);
      const visibility = !region ? "PREREQUISITE FAILED: missing unique associated help region"
        : !region.paintedBox ? "UNOBSERVED: no painted visible help box; no clearance claimed"
        : fullBox ? "OBSERVED: full native help box; box/hit evidence only, not glyph ink"
          : "OBSERVED: visible help portion only; clipped/offscreen remainder UNOBSERVED";
      const editorCoverage = custody.raw.editorCopy.map(item => {
        const matches = measurement.regions.filter(candidate => item.element
          && Object.entries(item.element).every(([key, value]) => candidate.element[key] === value)
          && candidate.text === item.text?.trim().slice(0, 400));
        const measured = matches.length === 1 ? matches[0] : null;
        const full = Boolean(measured?.paintedBox && measured.raw.left >= measured.intersection.left
          && measured.raw.right <= measured.intersection.right && measured.raw.top >= measured.intersection.top
          && measured.raw.bottom <= measured.intersection.bottom);
        return { key: item.key, selector: item.selector, regionCount: matches.length, fullBox: full,
          visibility: !measured ? "PREREQUISITE FAILED: missing unique owned editor-copy region"
            : !measured.paintedBox ? "UNOBSERVED: no painted visible editor-copy box; no clearance claimed"
              : full ? "OBSERVED: full native editor-copy box; box/hit evidence only, not glyph ink"
                : "OBSERVED: visible editor-copy portion only; clipped/offscreen remainder UNOBSERVED" };
      });
      const result = { custody, measurement, helpRegionCount: helpRegions.length, fullBox, visibility, editorCoverage };
      samples.push(result);
      await attachJSON(testInfo, stage + "-help-" + sample, result);
      await captureViewport(page, testInfo, stage + "-help-" + sample);
    }
    helpObservations.push({ stage, samples });
  };
  let primaryError;
  try {
    initialHelp = await readHelpCustody();
    await observeHelp("document-03-original");
    await pressTo(page, "Escape", keep, testInfo, "document-04-keep-choice", observationOptions);
    await pressTo(page, "Enter", original, testInfo, "document-05-keep-return", observationOptions);
    await expect(original).toHaveAttribute("id", originalId);
    await expect(draft).toHaveAttribute("data-output-recipe-draft", requirementId);
    await expect(original).toHaveValue(rawOutcome);
    await observeHelp("document-05-keep-return");
    await pressTo(page, "Escape", keep, testInfo, "document-06-discard-choice", observationOptions);
    await pressTo(page, "Tab", discard, testInfo, "document-07-discard", observationOptions);
    await pressTo(page, "Enter", review, testInfo, "document-08-review-return", observationOptions);
    await expect(draft).toHaveCount(0);
    await expect(recipe).toHaveValue("executive-deck");
    await expect(slides).toBeChecked();
    await expect(goal).toHaveValue(rawOutcome);
    await pressTo(page, "Tab", clear, testInfo, "document-09-clear", observationOptions);
    await pressTo(page, "Enter", summary, testInfo, "document-10-summary-return", observationOptions);
    await expect(entry).toHaveAttribute("open", "");
    await expect(recipe).toHaveValue("");
    await expect(goal).toHaveValue("");
    await expect(entry.getByRole("checkbox")).toHaveCount(0);
    await expect(draft).toHaveCount(0);
    await pressTo(page, "Tab", recipe, testInfo, "document-11-forward-tab", observationOptions);
    await pressTo(page, "Shift+Tab", summary, testInfo, "document-12-reverse-tab", observationOptions);
    await expect(page).toHaveURL(new URL(documentPath, testInfo.project.use.baseURL).href);
    expect(await savedArticles(page)).toEqual(originalArticles);
    await attachJSON(testInfo, "saved-context-after", await savedArticles(page));
    // New copy verdict follows the complete existing native/discard/clear and
    // saved-article/route custody tail. A copy collision does not erase that tail.
    await attachJSON(testInfo, "document-associated-help-custody", {
      initial: initialHelp, observations: helpObservations,
      lifecycle: "The same help/label/form/card/draft nodes are compared only at original and Keep return; intentional Discard removes them afterward.",
    });
    expect(helpObservations.map(item => item.stage)).toEqual(["document-03-original", "document-05-keep-return"]);
    expect(initialHelp.raw).toMatchObject({ originalId, value: rawOutcome, name: "originalText", labelFor: originalId,
      helpId: originalId + "-help", helpTag: "SMALL", helpText: expectedHelp, requirementId });
    expect(initialHelp.raw.formId).toBeTruthy();
    expect(initialHelp.raw.formAttribute).toBe(initialHelp.raw.formId);
    expect(initialHelp.raw.describedBy?.split(/\s+/)).toContain(initialHelp.raw.helpId);
    expect(initialHelp.raw.packageField).toMatchObject({ name: "packageLabel", value: "Executive deck", maxLength: 240,
      formAttribute: initialHelp.raw.formId, formId: initialHelp.raw.formId });
    expect(initialHelp.raw.packageField.id).toBeTruthy();
    expect(initialHelp.raw.packageField.labelFor).toBe(initialHelp.raw.packageField.id);
    expect(initialHelp.raw.packageField.helpId).toBe(initialHelp.raw.packageField.id + "-help");
    expect(initialHelp.raw.packageField.describedBy?.split(/\s+/)).toContain(initialHelp.raw.packageField.helpId);
    expect(initialHelp.raw.editorCopy.map(item => ({ key: item.key, text: item.text })))
      .toEqual(editorCopy.map(item => ({ key: item.key, text: item.text })));
    for (const { stage, samples } of helpObservations) for (const sample of samples) {
      expect(sample.custody.raw, stage + ": full raw field/help and current draft custody").toEqual(initialHelp.raw);
      expect(sample.custody.current.selectedCount, stage + ": unique current help owner").toBe(1);
      for (const [key, value] of Object.entries(sample.custody.current)) if (key !== "selectedCount")
        expect(value, stage + ": " + key).toBe(true);
      expect(sample.custody.helpStyle).toEqual(initialHelp.helpStyle);
      expect(sample.custody.helpStyle.display).not.toBe("none");
      expect(sample.custody.helpStyle.visibility).toBe("visible");
      expect(Number(sample.custody.helpStyle.opacity)).toBe(1);
      expect(["hidden", "clip"]).not.toContain(sample.custody.helpStyle.overflowX);
      expect(["hidden", "clip"]).not.toContain(sample.custody.helpStyle.overflowY);
      expect(sample.custody.helpStyle.textOverflow).not.toBe("ellipsis");
      expect(["", "none", "0"]).toContain(sample.custody.helpStyle.lineClamp);
      expect(sample.custody.editorStyles).toEqual(initialHelp.editorStyles);
      for (const { key, style } of sample.custody.editorStyles) {
        expect(style, stage + ": " + key + " current style").not.toBeNull();
        expect(style.display).not.toBe("none"); expect(style.visibility).toBe("visible");
        expect(Number(style.opacity)).toBe(1); expect(style.hidden).toBe(false);
        expect(["hidden", "clip"]).not.toContain(style.overflowX);
        expect(["hidden", "clip"]).not.toContain(style.overflowY);
        expect(style.textOverflow).not.toBe("ellipsis"); expect(["", "none", "0"]).toContain(style.lineClamp);
      }
      expect(sample.editorCoverage.map(item => item.key)).toEqual(editorCopy.map(item => item.key));
      for (const item of sample.editorCoverage) {
        expect(item.regionCount, stage + ": " + item.key + " current unique editor-copy region").toBe(1);
        testInfo.annotations.push({ type: "Document editor-copy coverage", description: stage + ": " + item.key + ": " + item.visibility });
      }
      expect(sample.helpRegionCount, stage + ": current unique associated SMALL region").toBe(1);
      testInfo.annotations.push({ type: "Document associated-help coverage", description: stage + ": " + sample.visibility });
      expect(sample.measurement.failures, stage + ": native focus and visible critical-help overlay clearance").toEqual([]);
      expect(sample.measurement.unassessed, stage + ": unsupported geometry/paint is not a pass").toEqual([]);
    }
  } catch (error) { primaryError = error; }
  let cleanupError;
  try { await helpNodes.dispose(); } catch (error) { cleanupError = error; }
  if (primaryError && cleanupError) throw new AggregateError([primaryError, cleanupError], "Document native/help observation and handle cleanup both failed");
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
});

test("Projects intake: Tab/Space/Back/Escape preserve a draft until explicit discard", async ({ page, context, geometry }, testInfo) => {
  await openForma(page, context, geometry, "/projects", testInfo);
  const opener = page.getByRole("button", { name: "New project", exact: true });
  await expect(page.locator(".project-card").first()).toBeVisible();
  const projectCount = await page.locator(".project-card").count();
  await tabTo(page, opener);
  await verifyFocus(page, opener, testInfo, "projects-01-opener");
  await page.keyboard.press("Enter");
  const dialog = page.locator("dialog.project-create-dialog:modal");
  const outcome = dialog.locator("[data-intake-outcome]");
  const sourceSummary = dialog.locator("details > summary").filter({ hasText: "Add a licensed source passage" });
  const source = dialog.getByRole("textbox", { name: /^Owned or licensed source excerpt/ });
  const rights = dialog.getByRole("checkbox", { name: "I own this passage or have permission to use it.", exact: true });
  const recipeSummary = dialog.locator("[data-intake-recipe] > summary");
  const recipe = dialog.getByRole("combobox", { name: "Workflow recipes", exact: true });
  const slides = dialog.getByRole("checkbox", { name: "Slides", exact: true });
  const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
  const discard = dialog.getByRole("button", { name: "Discard draft and close", exact: true });
  const blank = dialog.getByRole("button", { name: "Start blank", exact: true });
  const next = dialog.getByRole("button", { name: "Continue", exact: true });
  await verifyFocus(page, outcome, testInfo, "projects-02-outcome");
  await outcome.fill(rawOutcome);
  await pressTo(page, "Tab", sourceSummary, testInfo, "projects-03-source-disclosure");
  await page.keyboard.press("Enter");
  await expect(sourceSummary.locator("..")).toHaveAttribute("open", "");
  await pressTo(page, "Tab", source, testInfo, "projects-04-source");
  await source.fill(rawSource);
  await pressTo(page, "Tab", rights, testInfo, "projects-05-rights");
  await expect(rights).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(rights).toBeChecked();
  await page.keyboard.press("Space");
  await expect(rights).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(rights).toBeChecked();
  await pressTo(page, "Tab", recipeSummary, testInfo, "projects-06-recipe-disclosure");
  await page.keyboard.press("Space");
  await expect(dialog.locator("[data-intake-recipe]")).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(dialog.locator("[data-intake-recipe]")).not.toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await pressTo(page, "Tab", recipe, testInfo, "projects-07-recipe");
  await recipe.selectOption("executive-deck");
  await pressTo(page, "Tab", slides, testInfo, "projects-08-slides");
  await page.keyboard.press("Space");
  await expect(slides).toBeChecked();
  await pressTo(page, "Tab", cancel, testInfo, "projects-09-cancel");
  await pressTo(page, "Tab", discard, testInfo, "projects-10-discard");
  await pressTo(page, "Tab", blank, testInfo, "projects-11-blank");
  await pressTo(page, "Tab", next, testInfo, "projects-12-continue");
  await page.keyboard.press("Enter");
  const name = dialog.getByRole("textbox", { name: "Project name", exact: true });
  await verifyFocus(page, name, testInfo, "projects-13-name");
  await expect(name).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "Create project", exact: true })).toBeDisabled();
  await expect(dialog.locator("[data-intake-outcome-review]")).toHaveJSProperty("textContent", rawOutcome);
  const details = dialog.locator("details > summary").filter({ hasText: "More brief details" });
  await pressTo(page, "Tab", details, testInfo, "projects-14-details");
  await pressTo(page, "Tab", cancel, testInfo, "projects-15-review-cancel");
  await pressTo(page, "Tab", discard, testInfo, "projects-16-review-discard");
  const back = dialog.getByRole("button", { name: "Back to the outcome", exact: true });
  await pressTo(page, "Tab", back, testInfo, "projects-17-back");
  await pressTo(page, "Enter", outcome, testInfo, "projects-18-restored-outcome");
  await expect(outcome).toHaveValue(rawOutcome);
  await expect(source).toHaveValue(rawSource);
  await expect(rights).toBeChecked();
  await expect(recipe).toHaveValue("executive-deck");
  await expect(slides).toBeChecked();
  await pressTo(page, "Escape", opener, testInfo, "projects-19-escape-return");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Enter");
  await verifyFocus(page, outcome, testInfo, "projects-20-reopened-outcome");
  await expect(outcome).toHaveValue(rawOutcome);
  await expect(source).toHaveValue(rawSource);
  await expect(rights).toBeChecked();
  await expect(recipe).toHaveValue("executive-deck");
  await expect(slides).toBeChecked();
  await tabTo(page, discard, 12);
  await pressTo(page, "Enter", opener, testInfo, "projects-21-discard-return");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Enter");
  await verifyFocus(page, outcome, testInfo, "projects-22-cleared-outcome");
  await expect(outcome).toHaveValue("");
  await expect(sourceSummary.locator("..")).not.toHaveAttribute("open", "");
  await pressTo(page, "Tab", sourceSummary, testInfo, "projects-23-cleared-source-disclosure");
  await page.keyboard.press("Enter");
  await pressTo(page, "Tab", source, testInfo, "projects-24-cleared-source");
  await expect(source).toHaveValue("");
  await expect(rights).toHaveCount(0);
  await pressTo(page, "Tab", recipeSummary, testInfo, "projects-25-cleared-recipe-disclosure");
  await page.keyboard.press("Enter");
  await pressTo(page, "Tab", recipe, testInfo, "projects-26-cleared-recipe");
  await expect(recipe).toHaveValue("");
  await expect(dialog.getByRole("checkbox", { name: "Slides", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".project-card")).toHaveCount(projectCount);
});

test("Account overlay uses native popover activation and restores its keyboard invoker", async ({ page, context, geometry }, testInfo) => {
  await openForma(page, context, geometry, "/projects", testInfo);
  const trigger = page.getByRole("button", { name: "Account and settings", exact: true });
  await expect(trigger).toHaveAttribute("popovertarget", "account-popover");
  const popover = page.locator("#account-popover");
  await expect(popover).toHaveAttribute("popover", "auto");
  await expect(popover).not.toHaveAttribute("role", "menu");
  await tabTo(page, trigger);
  await verifyFocus(page, trigger, testInfo, "account-01-invoker");
  await page.keyboard.press("Enter");
  await expect(page.locator("#account-popover:popover-open")).toHaveCount(1);
  const firstControl = popover.locator("a[href], button:enabled, input:enabled, select:enabled").first();
  await verifyFocus(page, firstControl, testInfo, "account-02-first-native-control");
  await pressTo(page, "Escape", trigger, testInfo, "account-03-escape-return");
  await expect(page.locator("#account-popover:popover-open")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(page.locator("#account-popover:popover-open")).toHaveCount(1);
  await pressTo(page, "Escape", trigger, testInfo, "account-04-space-escape-return");
  await expect(page.locator("#account-popover:popover-open")).toHaveCount(0);
});
