import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { ExperienceDisplay, experienceLocale, EXPERIENCE_LOCALE_STORAGE_KEY } from "../src/experiences/display-locale.ts";
import { experienceEnglishMessages, experienceTranslations, experienceMessage } from "../src/experiences/display-messages.ts";
import { FORMA_SUPPORTED_LOCALES } from "../src/components/design-system/language-options.ts";
import { canonicalJson } from "../src/experiences/compiler.ts";
import { definitions } from "../src/experiences/catalog.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import { Model3dReferencePicker, VideoReferencePicker, VideoReferencePreview } from "../src/experiences/model3d-reference-picker.ts";
import { experienceNavigationAdapter } from "../src/experiences/navigation-adapter.ts";
import { parseExperienceHostRoute } from "../src/experiences/host-route.ts";

// Complete production modules with explicit DOM/focus/decode and HTTP ports.
// These checks are not browser layout, physical-device, IME, or assistive-technology acceptance.
class Element extends EventTarget {
  children = []; parentElement = null; attributes = new Map(); hidden = false;
  value = ""; checked = false; selectionStart = 0; selectionEnd = 0; text = "";
  constructor(tag, ownerDocument) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  append(...children) {
    for (const child of children) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
      child.parentElement = this; this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) {
      if (child.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
      child.parentElement = null;
    }
    this.children = []; this.text = ""; this.append(...children);
  }
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
  querySelectorAll(selector) { assert.equal(selector, "*"); return this.children.flatMap(child => [child, ...child.querySelectorAll("*")]); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { if (this.isConnected) this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  async decode() {} // Synthetic successful decode, never an image-decoder claim.
}
function documentFixture(t) {
  const prior = globalThis.document;
  const document = { created: 0, activeElement: null, createElement(tag) { this.created++; return new Element(tag, this); } };
  document.body = document.createElement("body"); document.activeElement = document.body;
  globalThis.document = document;
  t.after(() => { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; });
  return document;
}
const descendants = element => [element, ...element.querySelectorAll("*")];
const flush = async () => { for (let count = 0; count < 12; count++) await new Promise(resolve => setImmediate(resolve)); };

test("display locale uses supported saved preference, then browser order, then document language", () => {
  assert.equal(EXPERIENCE_LOCALE_STORAGE_KEY, "forma:locale");
  assert.deepEqual(FORMA_SUPPORTED_LOCALES.map(item => item.locale).sort(), ["ar", "en", "fr", "ja"]);
  for (const [saved, languages, documentLanguage, expected] of [
    ["fr-CA", ["ja-JP"], "ar", "fr"], [" AR-eg ", ["fr"], "en", "ar"],
    ["en-GB", ["ja"], "fr", "en"], ["de-DE", ["fr"], "ja", "en"],
    ["not_a_locale", ["fr"], "ja", "en"], [null, ["de-DE", "ja-JP", "fr"], "ar", "ja"],
    ["", ["invalid_locale", "ar-EG"], "fr", "ar"], [undefined, [], "fr-FR", "fr"],
    [null, ["de-DE"], "unsupported", "en"],
  ]) assert.equal(experienceLocale(saved, languages, documentLanguage), expected);
});

test("locale changes are bounded, notify once, and expose matching number formatting and direction", () => {
  const display = new ExperienceDisplay(); let changes = 0;
  const unsubscribe = display.subscribe(() => { changes++; });
  assert.equal(display.locale, "en"); assert.equal(display.direction, "ltr");
  for (const locale of ["en", "de", "invalid_locale", null, {}]) assert.equal(display.setLocale(locale), false);
  assert.equal(changes, 0);
  assert.equal(display.setLocale("ar-EG"), true); assert.equal(display.locale, "ar"); assert.equal(display.direction, "rtl");
  assert.equal(display.number(1234.5), new Intl.NumberFormat("ar").format(1234.5));
  assert.equal(changes, 1); assert.equal(display.setLocale("ar"), false);
  unsubscribe(); assert.equal(display.setLocale("ja-JP"), true); assert.equal(changes, 1); assert.equal(display.direction, "ltr");
});

test("display catalogs have exact source and placeholder parity and interpolate labels literally", () => {
  const sources = Object.keys(experienceEnglishMessages).sort();
  const placeholders = text => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]).sort();
  for (const [locale, translations] of Object.entries(experienceTranslations)) {
    assert.deepEqual(Object.keys(translations).sort(), sources, locale);
    for (const source of sources) {
      assert.equal(experienceEnglishMessages[source], source);
      assert.equal(typeof translations[source], "string"); assert.ok(translations[source].trim(), source);
      assert.deepEqual(placeholders(translations[source]), placeholders(source), `${locale}: ${source}`);
      assert.equal(experienceMessage("en", source), source);
    }
    for (const source of ["{label} · Image", "{label} · Saved 3D view"]) {
      assert.ok(Object.hasOwn(translations, source));
      const label = 'Selected image <img src=x> 日本語 {hash} $&';
      assert.equal(experienceMessage(locale, source, { label }), translations[source].replace("{label}", () => label));
    }
    assert.equal(experienceMessage(locale, "Unknown authored label"), "Unknown authored label");
    assert.equal(experienceMessage(locale, "{label}", { label: "Selected image" }), "Selected image");
    assert.equal(experienceMessage(locale, ""), "");
  }
});

test("bound copy and ARIA refresh in place without recreating or modifying an authored textarea", t => {
  const document = documentFixture(t), display = new ExperienceDisplay();
  const root = document.createElement("main"), label = document.createElement("label"), input = document.createElement("textarea");
  const caption = document.createElement("p"), image = document.createElement("img"), status = document.createElement("p");
  root.append(label, input, caption, image, status); document.body.append(root);
  const authored = 'Selected image · 日本語 <script> {number}'; input.value = authored; input.focus(); input.setSelectionRange(4, 12);
  let number = 1;
  display.bindText(label, "Object description"); display.bindAttribute(input, "aria-label", "Object description");
  display.bindText(caption, "Evidence {number}", () => ({ number: display.number(number) }));
  display.bindAttribute(image, "alt", "Selected image"); display.bindText(status, "Image unavailable");
  const nodes = [...root.children], count = document.created, unsubscribe = display.subscribe(() => display.refresh(root));
  t.after(unsubscribe);
  for (const locale of ["fr", "ja", "ar", "en"]) {
    number++; display.setLocale(locale);
    assert.equal(label.textContent, display.translate("Object description"));
    assert.equal(input.getAttribute("aria-label"), display.translate("Object description"));
    assert.equal(caption.textContent, display.translate("Evidence {number}", { number: display.number(number) }));
    assert.equal(image.getAttribute("alt"), display.translate("Selected image"));
    assert.deepEqual(root.children, nodes); assert.equal(document.created, count); assert.equal(document.activeElement, input);
    assert.equal(input.value, authored); assert.equal(input.selectionStart, 4); assert.equal(input.selectionEnd, 12);
  }
  display.bindText(status, ""); display.setLocale("fr"); assert.equal(status.textContent, "", "old error must not reappear");
  display.bindText(caption, "{label}", { label: "Selected image" }); display.setLocale("ar"); assert.equal(caption.textContent, "Selected image");
  assert.throws(() => display.bindAttribute(input, "value", "Subject"), /experience_display_attribute_invalid/u);
  assert.throws(() => display.bindAttribute(image, "src", "Image"), /experience_display_attribute_invalid/u);
  assert.equal(input.value, authored); assert.equal(image.getAttribute("src"), null);
});

test("display switching preserves every canonical definition, release hash, option value and English output contract", async () => {
  const releases = await Promise.all(definitions.map(definition => registeredExperience(definition.id)));
  const before = canonicalJson({ definitions, releases });
  for (const locale of ["fr", "ja", "ar", "en"]) {
    const display = new ExperienceDisplay(locale);
    for (const release of releases) {
      assert.ok(Object.hasOwn(experienceEnglishMessages, release.output.label), `${release.definition.id}: output label`);
      assert.ok(Object.hasOwn(experienceEnglishMessages, release.output.result), `${release.definition.id}: output result`);
      display.translate(release.output.label); display.translate(release.output.result);
      for (const decision of release.definition.decisions) {
        assert.ok(Object.hasOwn(experienceEnglishMessages, release.copy[decision.labelKey]), `${release.definition.id}: ${decision.id} label`);
        display.translate(release.copy[decision.labelKey]);
        // Numeric ratio labels are invariant; named option labels require display copy.
        for (const option of release.interactions[decision.id].options ?? []) {
          assert.ok(Object.hasOwn(experienceEnglishMessages, option.label), `${release.definition.id}: ${decision.id} option ${option.value}`);
          display.translate(option.label);
        }
      }
    }
    assert.equal(canonicalJson({ definitions, releases }), before);
  }
  assert.equal(canonicalJson({ definitions, releases: await Promise.all(definitions.map(definition => registeredExperience(definition.id))) }), before);
  assert.equal(releases.find(release => release.output.output === "video").output.result, "1 clip · 4 seconds · 480p · Silent");
});

test("3D and Video pickers refresh authored labels without changing selected sources or making locale-triggered requests", async t => {
  const document = documentFixture(t), bytes = new Uint8Array([1, 2, 3]), sha256 = createHash("sha256").update(bytes).digest("hex");
  for (const [Picker, output, browseText] of [[Model3dReferencePicker, "model3d", "Browse Document references"], [VideoReferencePicker, "video", "Browse images"]]) {
    const display = new ExperienceDisplay("fr"), requests = [], changes = [];
    const source = { version: 1, ...(output === "model3d" ? { kind: "image" } : {}), sourceProjectId: "project", sourceDocumentId: "document", sourceBlockId: "block", referenceId: "reference", sha256 };
    const candidate = { source, label: "Selected image", preview: "/api/media/u-6f776e6572/image.png" };
    const fetcher = async (path, init) => {
      requests.push({ path, method: init?.method ?? "GET" });
      assert.equal(init?.method, undefined, "locale display must not introduce inspection, save or generation");
      if (path === `/api/experiences/${output}/references`) return Response.json({ version: 1, scope: "personal-document-references", qualification: "discovery-only", head: 1, candidates: [candidate], next: null });
      assert.equal(path, candidate.preview); return new Response(bytes, { headers: { "content-type": "image/png" } });
    };
    const picker = new Picker((selection, ready) => changes.push({ selection, ready }), undefined, fetcher, display);
    document.body.append(picker.element);
    try {
      assert.equal(requests.length, 0);
      descendants(picker.element).find(element => element.tagName === "BUTTON" && element.textContent === display.translate(browseText)).dispatchEvent(new Event("click"));
      await flush();
      const radio = descendants(picker.element).find(element => element.tagName === "INPUT" && element.value === "block");
      radio.checked = true; radio.dispatchEvent(new Event("change")); await flush();
      const caption = descendants(picker.element).find(element => element.tagName === "P" && element.textContent === display.translate("{label} · Image", { label: candidate.label }));
      const permission = descendants(picker.element).find(element => element.type === "checkbox"), image = descendants(picker.element).find(element => element.tagName === "IMG");
      assert.ok(caption); assert.equal(radio.parentElement.textContent, "Selected image");
      const beforeChanges = structuredClone(changes), beforeRequests = structuredClone(requests), nodes = descendants(picker.element);
      permission.focus(); display.setLocale("ar"); display.refresh(picker.element);
      assert.equal(caption.textContent, display.translate("{label} · Image", { label: "Selected image" }));
      assert.equal(radio.parentElement.textContent, "Selected image"); assert.equal(radio.value, "block"); assert.equal(radio.checked, true);
      assert.equal(permission.checked, false); assert.equal(document.activeElement, permission);
      assert.equal(image.getAttribute("alt"), display.translate(output === "model3d" ? "Selected reference" : "Selected image"));
      assert.deepEqual(descendants(picker.element), nodes); assert.deepEqual(changes, beforeChanges); assert.deepEqual(requests, beforeRequests);
      assert.equal(requests.length, 2); assert.ok(requests.every(request => request.method === "GET"));
    } finally { picker.dispose(); picker.element.parentElement.replaceChildren(); }
  }
});

test("retained Video preview localizes its fallback caption but preserves an identically spelled authored label", async t => {
  const document = documentFixture(t), bytes = new Uint8Array([4, 5, 6]), sha256 = createHash("sha256").update(bytes).digest("hex");
  for (const authoredLabel of [undefined, "Selected image"]) {
    const display = new ExperienceDisplay("fr"), requests = [];
    const selection = { version: 1, sourceProjectId: "project", sourceDocumentId: "document", sourceBlockId: "block", referenceId: "reference", sha256, permissionAttestation: "i-own-or-have-permission" };
    const plan = { version: 1, selection, sourceDigest: "b".repeat(64), properties: { ...(authoredLabel === undefined ? {} : { label: authoredLabel }), reference_id: "reference", source_content_hash: sha256, media_url: "/api/media/u-6f776e6572/image.png", media_type: "image/png" } };
    const before = canonicalJson(plan), preview = new VideoReferencePreview(plan, async (path, init) => {
      requests.push({ path, method: init?.method ?? "GET" }); assert.equal(path, plan.properties.media_url); assert.equal(init?.method, undefined);
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    }, display);
    document.body.append(preview.element);
    try {
      await flush();
      const caption = descendants(preview.element).find(element => element.tagName === "FIGCAPTION"), status = descendants(preview.element).find(element => element.getAttribute("role") === "status");
      assert.equal(caption.textContent, authoredLabel ?? display.translate("Selected image")); assert.equal(status.textContent, "");
      display.setLocale("ja"); display.refresh(preview.element);
      assert.equal(caption.textContent, authoredLabel ?? display.translate("Selected image")); assert.equal(status.textContent, "");
      assert.equal(requests.length, 1); assert.equal(canonicalJson(plan), before);
    } finally { preview.dispose(); preview.element.parentElement.replaceChildren(); }
  }
});

test("Continue localization keeps the same focused link and exact saved Document route", async t => {
  const document = documentFixture(t), display = new ExperienceDisplay("fr"), target = document.createElement("section"); document.body.append(target);
  const release = await registeredExperience("video"), draftId = "experience-draft-" + "a".repeat(64);
  const context = { plan: { release, draftId }, receipt: { documentId: "saved-document", documentRoute: "/document/saved-document" } };
  const controller = new AbortController(), adapter = experienceNavigationAdapter("/experiences/video?progress-report", display);
  const session = await adapter.mount(target, context, controller.signal);
  try {
    const link = target.children[0], href = link.href; link.focus(); assert.equal(link.textContent, "Continuer");
    assert.deepEqual(parseExperienceHostRoute(href), { output: "video", draftId, documentId: "saved-document", documentRoute: "/document/saved-document?progress-report=" });
    display.setLocale("ar"); display.refresh(target);
    assert.equal(link.textContent, display.translate("Continue")); assert.equal(target.children[0], link); assert.equal(link.href, href); assert.equal(document.activeElement, link);
  } finally { session.dispose(); }
});
