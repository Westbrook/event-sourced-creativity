import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, attachJSON, captureViewport, openForma } from "./fixtures.mjs";
import { verifyFocus, pressTo, tabTo } from "./helpers/keyboard-journey.mjs";
import { measureModalLayout } from "./helpers/modal-layout.mjs";

const path = "/library?document=doc-atmosphere";
const copy = {
  en: { direction: "ltr", heading: "Import one document as a copy?", close: "Close preview", accept: "Import document copy",
    importLabel: "Import as document", exportLabel: "Export project event archive",
    labels: ["context blocks copied", "outputs not copied", "media files not copied"] },
  fr: { direction: "ltr", heading: "Importer un document en tant que copie ?", close: "Fermer l’aperçu", accept: "Importer une copie du document",
    importLabel: "Importer comme document", exportLabel: "Exporter l’archive des événements du projet",
    labels: ["blocs de contexte copiés", "résultats non copiés", "fichiers multimédias non copiés"] },
  ar: { direction: "rtl", heading: "هل تريد استيراد مستند واحد كنسخة؟", close: "إغلاق المعاينة", accept: "استيراد نسخة من المستند",
    importLabel: "استيراد كمستند", exportLabel: "تصدير أرشيف أحداث المشروع",
    labels: ["كتل السياق المنسوخة", "لم تُنسخ المخرجات", "لم تُنسخ ملفات الوسائط"] },
};
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

test("Library: a genuine retained archive can be inspected and dismissed without importing", async ({ page, context, geometry }, testInfo) => {
  // Integrate this spec only after root has retained an authorized real archive
  // and its provenance outside the checkout. Missing setup is NOT a skipped pass.
  const suppliedPath = process.env.FORMA_A11Y_IMPORT_ARCHIVE;
  const expectedHash = process.env.FORMA_A11Y_IMPORT_ARCHIVE_SHA256;
  expect(typeof suppliedPath === "string" && isAbsolute(suppliedPath), "Provide a genuine retained archive's absolute path").toBe(true);
  expect(expectedHash, "Pin the independently recorded archive bytes; never export inside this test").toMatch(/^[a-f0-9]{64}$/);
  const archivePath = await realpath(suppliedPath);
  const checkout = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const relation = relative(checkout, archivePath);
  expect(relation.startsWith(".." + sep) || isAbsolute(relation), "Keep private archive payload outside the checkout").toBe(true);
  const bytes = await readFile(archivePath);
  expect(sha256(bytes)).toBe(expectedHash);
  const archive = JSON.parse(bytes.toString("utf8"));
  expect(archive).toMatchObject({ format: "forma-event-archive", version: 1 });
  expect(Array.isArray(archive.events) && archive.events.length > 0).toBe(true);
  expect(Array.isArray(archive.mediaManifest)).toBe(true);
  await attachJSON(testInfo, "retained-archive", { sha256: expectedHash, bytes: bytes.length,
    format: archive.format, version: archive.version, eventCount: archive.events.length,
    mediaCount: archive.mediaManifest.length, exportedAt: archive.exportedAt,
    setup: "Root-retained genuine authorized export; no payload committed, no export or import acceptance in this test." });

  const locale = geometry.locale ?? "en-US", expected = copy[locale.split("-")[0]];
  expect(expected).toBeTruthy();
  await openForma(page, context, geometry, path, testInfo);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("html")).toHaveAttribute("dir", expected.direction);
  await expect(page.locator("forma-ui-language-picker select:visible")).toHaveValue(locale.split("-")[0]);
  const owner = page.locator("forma-library");
  const file = owner.locator(".page-header-actions .file-button > input[type=file]");
  const exportButton = owner.locator(".page-header--library > .page-header-actions > button.secondary");
  const dialog = owner.locator("dialog.library-import-dialog:modal");
  const close = dialog.locator(".modal-card > button.modal-close");
  const accept = dialog.locator(".modal-card > button.primary");
  const catalog = () => owner.locator(".library-content").evaluate(element => ({
    text: element.textContent, links: [...element.querySelectorAll("a[href]")].map(link => link.getAttribute("href")),
    contextIds: [...element.querySelectorAll("[data-context-controls-id]")].map(control => control.getAttribute("data-context-controls-id")),
  }));
  await expect(owner.locator(".library-content .asset-card").first()).toBeVisible();
  await expect(file).toHaveCount(1);
  await expect(file).toHaveAccessibleName(expected.importLabel);
  await expect(exportButton).toHaveCount(1);
  await expect(exportButton).toHaveAccessibleName(expected.exportLabel);
  await expect(exportButton).toBeEnabled();
  const before = await catalog(), beforeURL = page.url();
  await attachJSON(testInfo, "library-before", before);
  const layout = async (stage, focusObservation, headingMustBeVisible) => {
    const observation = await dialog.evaluate(measureModalLayout, { focusClip: focusObservation.focus.intersection, headingMustBeVisible });
    await attachJSON(testInfo, stage, observation);
    expect(observation.language).toBe(locale);
    expect(observation.direction).toBe(expected.direction);
    expect(observation.dialogDirection).toBe(expected.direction);
    expect(observation.cardDirection).toBe(expected.direction);
    expect(observation.headingText).toBe(expected.heading);
    expect(observation.sameRowPairs, "Ordinary preview has no footer peer group; do not invent recovery coverage").toEqual([]);
    expect(observation.failures, stage).toEqual([]);
  };
  const observeActive = async stage => {
    // Record the native outcome; no self-selected focus target becomes a pass.
    await attachJSON(testInfo, stage, await page.evaluate(() => {
      const active = document.activeElement, file = document.querySelector("forma-library .file-button > input[type=file]");
      return { tag: active?.tagName, id: active?.id, className: active?.getAttribute("class"),
        connected: active?.isConnected, focusVisible: active?.matches(":focus-visible"), isImportInput: active === file,
        inLibrary: Boolean(active?.closest("forma-library")), modalCount: document.querySelectorAll("dialog:modal").length };
    }));
    await captureViewport(page, testInfo, stage);
  };
  const openPreview = async prefix => {
    await tabTo(page, file);
    await expect(file).toBeFocused();
    await verifyFocus(page, file, testInfo, prefix + "-input-label", { nativeFileLabel:true });
    // Native file-dialog chrome is not certified: Playwright supplies only the
    // already-existing file to the real input; Forma does its real local parse.
    await file.setInputFiles([]);
    await file.setInputFiles(archivePath);
    expect(await file.evaluate(async input => {
      const selected = input.files?.[0];
      if (!selected) return null;
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await selected.arrayBuffer()))]
        .map(value => value.toString(16).padStart(2, "0")).join("");
    })).toBe(expectedHash);
    await expect(dialog).toHaveCount(1);
    await expect(dialog.locator("#import-title")).toHaveJSProperty("textContent", expected.heading);
    await expect(close).toHaveAccessibleName(expected.close);
    await expect(accept).toHaveJSProperty("textContent", expected.accept);
    await expect(accept).toBeEnabled();
    await expect(accept).toHaveAttribute("aria-busy", "false");
    await expect(dialog.locator(".metric-grid > div > span")).toHaveText(expected.labels);
    await expect(dialog.locator(".metric-grid > div").nth(2).locator("b")).toHaveText(String(archive.mediaManifest.length));
    await expect(owner.locator(".library-import-recovery")).toHaveCount(0);
    await observeActive(prefix + "-initial-native-focus");
    await tabTo(page, close, 4);
    await verifyFocus(page, close, testInfo, prefix + "-close").then(observation => layout(prefix + "-heading-layout", observation, true));
    await pressTo(page, "Tab", accept, testInfo, prefix + "-accept-unactivated")
      .then(observation => layout(prefix + "-copy-and-metrics", observation, false));
    expect(await catalog()).toEqual(before);
  };
  await openPreview("library-01");
  await pressTo(page, "Shift+Tab", close, testInfo, "library-02-close-return");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await observeActive("library-03-dismiss-native-outcome");
  await verifyFocus(page, file, testInfo, "library-03-restored-input-label", { nativeFileLabel:true });
  expect(await catalog()).toEqual(before);
  expect(page.url()).toBe(beforeURL);
  await page.keyboard.press("Tab");
  await observeActive("library-04-next-native-tab");
  await verifyFocus(page, exportButton, testInfo, "library-04-next-export-unactivated");
  await openPreview("library-05");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await observeActive("library-06-escape-native-outcome");
  await verifyFocus(page, file, testInfo, "library-06-restored-input-label", { nativeFileLabel:true });
  expect(await catalog()).toEqual(before);
  expect(page.url()).toBe(beforeURL);
  await page.keyboard.press("Tab");
  await observeActive("library-07-next-native-tab");
  await verifyFocus(page, exportButton, testInfo, "library-07-next-export-unactivated");
  expect(await catalog()).toEqual(before);
  expect(page.url()).toBe(beforeURL);
  expect(sha256(await readFile(archivePath))).toBe(expectedHash);
  await expect(owner.locator(".library-import-recovery")).toHaveCount(0);
  await attachJSON(testInfo, "library-after", { catalog: await catalog(), url: page.url(), archiveSha256: expectedHash,
    originalOperationRecovery: "UNOBSERVED: no original import was submitted, so Check/Open/Discard-newer/lifetime branches are not represented.",
    dismissalFocus: "Close/Enter and Escape must restore the actual native file INPUT with its unique direct LABEL paint; one next native Tab must reach the existing Export button without activating it." });
});
