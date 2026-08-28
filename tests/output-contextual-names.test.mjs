import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { noChange } from "lit";
import { snapshot as outputSnapshot } from "./output-ui-source-harness.mjs";
import { inspectOutputRequirement, confirmOutputRequirementInterpretation } from "../src/model/output-requirements.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";

// Reuse the complete production classes, real LocaleController/catalogs and
// existing template/native ports. No production method is replaced. These are
// deterministic component semantics, not browser, screen-reader or geometry certification.
const fixtureUrl = new URL("./presentation-guidance-accessibility.test.mjs", import.meta.url);
const source = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let moduleSource = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node) || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)
  || ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === "registerHooks").map(node => node.getFullText(tree)).join("\n");
moduleSource = moduleSource.replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu, (_match, prefix, _quote, specifier) => prefix + JSON.stringify(specifier.startsWith(".") ? new URL(specifier, fixtureUrl).href : specifier.startsWith("node:") ? specifier : import.meta.resolve(specifier)));
moduleSource = moduleSource.replaceAll('import.meta.resolve("vite")', JSON.stringify(import.meta.resolve("vite"))).replaceAll("import.meta.url", JSON.stringify(fixtureUrl.href));
moduleSource = moduleSource.replace("await import(specifier)", 'await import(specifier==="lit/directives/live.js"?' + JSON.stringify(import.meta.resolve("lit/directives/live.js")) + ":specifier)");
moduleSource += "\nexport {fixture,loadActual,ElementPort,documentPort};\n//# sourceURL=output-contextual-fixture.mjs\n";
const { fixture, loadActual, ElementPort, documentPort } = await import("data:text/javascript;base64," + Buffer.from(moduleSource).toString("base64"));
const { FormaOutputRequirements } = await loadActual("src/components/forma-output-requirements.ts");
const { FormaOutputRequirementCard } = await loadActual("src/components/forma-output-requirement-card.ts");
const { localizeTemplateResult } = await loadActual("src/components/design-system/localized-template.ts");

const authoredName = "Shared title اسم مشترك 同じ名前";
const authoredText = "Keep exactly {customer} — نص المؤلف — 著者の文言.";
const normalize = value => String(value ?? "").replace(/[\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim();
const decode = value => String(value).replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const voidTags = new Set(["input", "img", "br", "hr", "meta", "link", "source", "wbr"]);

function semanticNodes(f, owner) {
  const root = { tag: "root", children: [], parent: null, attributes: {} }, stack = [root], nodes = [];
  for (const match of owner.markup.matchAll(/<\/?[\w-]+\b[^>]*>|[^<]+/gu)) {
    const token = match[0];
    if (token.startsWith("</")) { const tag = token.match(/^<\/([\w-]+)/u)[1]; while (stack.length > 1 && stack.pop().tag !== tag) { /* Close the matching native ancestor. */ } continue; }
    if (!token.startsWith("<")) { stack.at(-1).children.push(decode(token)); continue; }
    const [, tag, raw] = token.match(/^<([\w-]+)\b([^>]*)>/u);
    const node = { tag, ...f.renderer.attrs(raw), parent: stack.at(-1), children: [], owner };
    stack.at(-1).children.push(node); nodes.push(node);
    if (!voidTags.has(tag)) stack.push(node);
  }
  const text = (node, visible = false, descriptions = new Set()) => typeof node === "string" ? node
    : (visible && (node.attributes.class?.split(/\s+/u).includes("sr-only") || node.attributes.hidden !== undefined || descriptions.has(node.attributes.id)) ? ""
      : node.children.filter(child => typeof child === "string" || !["input", "select", "textarea", "small"].includes(child.tag)).map(child => text(child, visible, descriptions)).join(""));
  const name = (node, seen = new Set()) => {
    if (seen.has(node)) return ""; seen.add(node);
    if (node.attributes["aria-labelledby"]) return String(node.attributes["aria-labelledby"]).split(/\s+/u).map(id => {
      const heading = nodes.find(candidate => candidate.attributes.id === id); assert.ok(heading, "Every label reference resolves: " + id); return name(heading, new Set(seen));
    }).join(" ").trim();
    if (typeof node.attributes["aria-label"] === "string") return node.attributes["aria-label"];
    if (["input", "select", "textarea"].includes(node.tag)) {
      let label = node.parent; while (label && label.tag !== "label") label = label.parent;
      label ??= nodes.find(candidate => candidate.tag === "label" && candidate.attributes.for && candidate.attributes.for === node.attributes.id);
      return label ? text(label).trim() : "";
    }
    return text(node).trim();
  };
  for (const node of nodes) {
    node.name = () => name(node);
    node.visibleLabel = () => { if (node.attributes["aria-labelledby"]) return normalize(String(node.attributes["aria-labelledby"]).split(/\s+/u).map(id => nodes.find(candidate => candidate.attributes.id === id)).filter(Boolean).map(label => text(label, true)).join(" ")); let label = node; if (["input", "select", "textarea"].includes(node.tag)) { label = node.parent; while (label && label.tag !== "label") label = label.parent; } return label ? normalize(text(label, true, new Set(String(node.attributes["aria-describedby"] ?? "").split(/\s+/u)))) : ""; };
    node.disabled = () => { let current = node; while (current) { if (current.attributes.disabled !== undefined) return true; current = current.parent; } return false; };
  }
  return nodes;
}

function specs({ colonIds = false } = {}) {
  return [1, 2].map(requirement => {
    const id = "requirement-" + requirement;
    const deliverable = (number, medium = "image") => ({
      id: id + "-deliverable-" + number, label: authoredName, media_kind: medium, required: number !== 2,
      quantity: { kind: "exact", unit: medium === "slides" ? "presentation" : medium, value: 1 },
      source_scope: { kind: "blocks", block_ids: ["source-one"] }, coverage: { kind: "topics", topics: ["Original topic"] },
      original_text: authoredText, value_origins: {},
    });
    const images = [1, 2].map(number => {
      const row = deliverable(number);
      if (colonIds) row.id = id + ":image:" + number;
      row.format_variants = [1, 2].map(variant => ({
        id: colonIds ? row.id + (variant === 1 ? ":label" : ":quantity") : row.id + "-variant-" + variant, label: authoredName, required: variant === 1,
        aspect_ratio: { width: 1, height: 1 }, quantity: { kind: "exact", unit: "image", value: 1 },
        placements: ["Original placement"], original_text: authoredText, value_origins: {},
      }));
      return row;
    });
    const videos = [3, 4].map(number => {
      const row = deliverable(number, "video");
      if (colonIds) row.id = id + ":video:" + number;
      row.quantity.value = 2;
      row.series = { state: "resolved", description: authoredText, members: [1, 2].map(member => ({
        id: colonIds ? row.id + (member === 1 ? ":label" : ":source") : row.id + "-member-" + member, label: authoredName, required: member === 1,
        source_scope: { kind: "blocks", block_ids: ["source-one"] }, coverage: { kind: "topics", topics: ["Original topic"] },
        quantity: { kind: "exact", unit: "video", value: 1 }, original_text: authoredText, value_origins: {},
      })) };
      return row;
    });
    const slides = [5, 6].map(number => ({ ...deliverable(number, "slides"), content_quantity: { kind: "range", unit: "slide", min: 5, max: 15 } }));
    const spec = confirmOutputRequirementInterpretation({ schema_version: 1, id, label: authoredName, original_text: authoredText, deliverables: [...images, ...videos, ...slides], value_origins: {} });
    assert.equal(inspectOutputRequirement(spec).status, "valid", JSON.stringify(inspectOutputRequirement(spec).issues));
    return spec;
  });
}

async function contextualFixture(t, locale, options = {}) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No real API or provider"));
  const f = fixture(t, { locale, facts: [
    { id: "source-one", type: "direction", text: authoredText }, { id: "source-two", type: "direction", text: authoredText },
  ] });
  f.host.disconnectedCallback(); f.trace.length = 0;
  const snapshot = outputSnapshot("A"), requirements = specs(options);
  snapshot.requirements = requirements.map(spec => ({ blockId: spec.id, subtype: authoredName, content: spec.original_text, status: "valid", locked: false, spec, preserved: spec, issues: [] }));
  const plan = compileOutputPlan(requirements, { document_id: "A", source_revision: snapshot.sourceRevision, requirement_revision: snapshot.requirementRevision });
  snapshot.confirmedPlan.plan = plan;
  snapshot.confirmedPlan.targetContractDigests = Object.fromEntries(plan.targets.map(target => [target.id, "a".repeat(64)]));
  snapshot.requirementSummaries = Object.fromEntries(requirements.map(spec => [spec.id, snapshot.summary]));
  snapshot.permissions.canReview = true;
  snapshot.results = []; snapshot.assets = [];
  for (const [targetIndex, target] of plan.targets.filter(target => target.media_kind === "image").slice(0, 2).entries()) for (const candidate of [1, 2]) {
    const ordinal = targetIndex * 2 + candidate, assetId = "asset-" + ordinal;
    snapshot.assets.push({ id: assetId, name: authoredName, mediaKind: "image", mimeType: "image/png", byteLength: 3,
      sha256: String(ordinal).repeat(64), available: true, createdByUserId: "producer",
      inspection: { status: "inspected", sha256: String(ordinal).repeat(64), facts: {}, checks: [], limitations: [] },
      downloadUrl: "/api/output-requirements/assets/" + assetId + "?documentId=A" });
    snapshot.results.push({ id: "result-" + ordinal, targetId: target.id, assetId, planRevisionId: snapshot.confirmedPlan.revisionId,
      resultRevision: "revision-" + ordinal, createdByUserId: "producer", checksStatus: "passed", review: "pending", problems: [],
      reviewAllowed: true, targetContractDigest: "a".repeat(64), sourceDigest: snapshot.sourceRevision, sha256: String(ordinal).repeat(64) });
  }
  f.output = snapshot; f.commands = []; f.downloads = [];
  // SIMULATED resource facade: no OutputRequirementsClient transport owner is installed.
  f.store.outputRequirements = { retainedWrite: () => null, resource: () => ({ state: "ready", snapshot: f.output, error: null }), ensure: async () => ({ state: "ready", snapshot: f.output, error: null }),
    download: async (documentId, path) => { f.downloads.push({ documentId, path }); return { status: "unavailable", error: "output_client_response_lost" }; } };
  f.store.outputRequirementCommand = async command => { f.commands.push(command); return { status: "saved", body: { command: {} } }; };
  f.host = new FormaOutputRequirements(); f.host.documentId = "A"; f.host.documentName = authoredName; f.host.surface = "deliver";
  f.host.isConnected = true; f.host.connectedCallback();
  f.renderer.registry = { "forma-output-requirement-card": FormaOutputRequirementCard };
  f.draw = () => {
    const markup = f.renderer.draw(f.host, () => localizeTemplateResult(f.host.render(), f.i18n));
    f.cards = [...f.renderer.instances.values()].map(row => row.instance).filter(instance => instance instanceof FormaOutputRequirementCard);
    for (const card of f.cards) if (!card.fixtureInitialized) { card.fixtureInitialized = true; card.willUpdate(new Map([["snapshot", null]])); }
    return markup;
  };

  const query = f.renderer.query.bind(f.renderer);
  f.renderer.query = (owner, selector) => {
    if (!/^#[^ ,]+$/u.test(selector)) return query(owner, selector);
    const nodes = f.renderer.nodes.filter(node => node.owner === owner && node.attributes.id === selector.slice(1));
    for (const node of nodes) node.focus = () => { documentPort.activeElement = node; f.trace.push("focus-id:" + node.attributes.id); };
    return nodes;
  };
  f.nodes = owner => semanticNodes(f, owner ?? f.host);
  f.native = (owner, name) => f.renderer.nodes.find(node => node.owner === owner && node.attributes.name === name);
  f.value = node => node.properties.value?.values?.[0] ?? node.properties.value;

  f.click = async (node, owner = f.host) => { assert.equal(node.disabled(), false); assert.equal(typeof node.handlers.click, "function"); await node.handlers.click.call(owner, { currentTarget: node, target: node, preventDefault() {}, stopPropagation() {} }); await f.flush(); };
  f.openEditors = async () => {
    for (const card of f.cards) {
      const edit = f.nodes(card).find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.requirement.edit"));
      assert.ok(edit); await f.click(edit, card);
    }
  };
  f.draw();
  return f;
}

function assertNamedPrefix(nodes) {
  for (const node of nodes) {
    const visible = node.visibleLabel(), name = normalize(node.name());
    assert.ok(name.startsWith(visible), JSON.stringify({ visible, name, tag: node.tag }));
    assert.ok(name.length > visible.length, "Repeated controls need contextual names: " + visible);
  }
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("Output contextual names " + locale + ": duplicate authored deliverables and nested rows have distinct actual field/action names", async t => {
    const f = await contextualFixture(t, locale), before = structuredClone(f.output);
    await f.openEditors();
    const controls = f.cards.flatMap(card => f.nodes(card).filter(node => ["input", "select", "textarea", "button"].includes(node.tag)));
    assert.ok(controls.length > 150);
    assertNamedPrefix(controls);
    const keys = controls.map(node => [node.tag === "button" ? "button" : node.tag === "input" && node.attributes.type === "checkbox" ? "checkbox" : node.tag, normalize(node.name())].join(":"));
    assert.equal(new Set(keys).size, keys.length, "Names stay unique across duplicate requirements, deliverables, variants, members and source labels.");
    assert.deepEqual(f.output, before); assert.deepEqual(f.commands, []); assert.deepEqual(f.downloads, []); assert.equal(f.state.requests.length, 0);
  });
  test("Output contextual names " + locale + ": exact result and target actions distinguish duplicate titles and multiple candidates", async t => {
    const f = await contextualFixture(t, locale), before = structuredClone(f.output);
    const controls = f.nodes().filter(node => node.tag === "button" && [f.i18n.t("output.delivery.acceptExact"), f.i18n.t("output.delivery.downloadReview"), f.i18n.t("output.delivery.checkFile")].includes(node.visibleLabel()));
    assert.ok(controls.filter(node => node.visibleLabel() === f.i18n.t("output.delivery.acceptExact")).length >= 4);
    assert.ok(controls.filter(node => node.visibleLabel() === f.i18n.t("output.delivery.acceptExact")).every(node => !node.disabled()), "The positive fixtures are eligible actual controls.");
    assertNamedPrefix(controls);
    assert.equal(new Set(controls.map(node => normalize(node.name()))).size, controls.length);
    assert.deepEqual(f.output, before); assert.deepEqual(f.commands, []); assert.deepEqual(f.downloads, []); assert.equal(f.state.requests.length, 0);
  });
}


function ancestor(node, tag) { let current = node.parent; while (current && current.tag !== tag) current = current.parent; return current; }
function installGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name]; });
}
function nativeFormData(t) {
  installGlobal(t, "FormData", class FormDataPort { constructor(form) { this.fields = form.fields; } get(key) { return this.fields[key] ?? null; } });
}
function receiptGrants(f) {
  const accounting = { usedMicrousd: 35_001, exposedMicrousd: 70_000, maximumMicrousd: 150_000, usedCalls: 1, pendingCalls: 1, maximumCalls: 2 };
  f.output.grants = [1, 2].map(ordinal => ({
    id: "authorization-" + ordinal, planRevisionId: f.output.confirmedPlan.revisionId, actorUserId: f.output.scope.actorUserId,
    status: "active", expiresAt: "2099-01-01T00:00:00Z", ...accounting, disclosure: null,
    operations: [1, 2].map(attempt => ({ id: "operation-" + ordinal + "-" + attempt, jobId: "job-" + ordinal + "-" + attempt,
      targetId: f.output.confirmedPlan.plan.targets[0].id, targetLabel: authoredName, status: "failed", ...accounting })),
  }));
  f.store.documentJobs.set(f.output.grants.flatMap(grant => grant.operations.map(operation => ({
    jobId: operation.jobId, documentId: "A", status: "failed", updatedAt: "2026-08-28T00:00:00Z",
    errorDetail: { code: "output_execution_time_limit" }, result: {},
  }))));
}
for (const locale of ["en", "fr", "ar", "ja"]) {
  test("Output contextual names " + locale + ": explicit render owners distinguish valid prefix and colon identities", async t => {
    const f = await contextualFixture(t, locale, { colonIds: true }), before = structuredClone(f.output);
    assert.ok(f.output.requirements.every(row => inspectOutputRequirement(row.spec).status === "valid"));
    await f.openEditors();
    const controls = f.cards.flatMap(card => f.nodes(card).filter(node => ["input", "select", "textarea", "button"].includes(node.tag)));
    assertNamedPrefix(controls);
    const keys = controls.map(node => node.tag + ":" + normalize(node.name()));
    assert.equal(new Set(keys).size, keys.length);
    const card = f.cards[0], fields = f.nodes(card);
    const parent = fields.find(node => node.attributes.name === "requirement-1:image:1:label");
    const nested = fields.find(node => node.attributes.name === "requirement-1:image:1:label:label");
    assert.ok(parent && nested); assert.notEqual(normalize(parent.name()), normalize(nested.name()));
    assert.equal(parent.attributes.name, "requirement-1:image:1:label");
    assert.equal(nested.attributes.name, "requirement-1:image:1:label:label");
    assert.deepEqual(f.output, before); assert.equal(f.commands.length, 0);
  });
  test("Output contextual names " + locale + ": named groups resolve their existing headings and isolate authored text", async t => {
    const f = await contextualFixture(t, locale);
    await f.openEditors();
    const groups = f.nodes().filter(node => /^(?:output-target|output-result)$/u.test(node.attributes.class ?? ""));
    assert.ok(groups.length > 4);
    assert.equal(new Set(groups.map(node => normalize(node.name()))).size, groups.length);
    for (const node of groups) {
      assert.ok(node.attributes["aria-labelledby"]); assert.match(node.name(), /\u2068/u);
      assert.ok(normalize(node.name()).includes(authoredName));
    }
    const ownerGroups = f.cards.flatMap(card => f.nodes(card).filter(node => node.attributes["data-output-deliverable"] || node.attributes["data-output-variant"] || node.attributes["data-output-member"]));
    assert.equal(ownerGroups.length, 28);
    assert.equal(new Set(ownerGroups.map(node => normalize(node.name()))).size, ownerGroups.length);
    for (const card of f.cards) {
      const nodes = f.nodes(card), references = nodes.filter(node => node.attributes["aria-labelledby"]);
      for (const node of references) assert.ok(node.name().length > authoredName.length);
      for (const node of nodes.filter(node => ["button", "input", "textarea", "select"].includes(node.tag))) assert.match(node.name(), /\u2068.*\u2069/u);
      const heading = nodes.find(node => node.tag === "h2");
      assert.ok(normalize(heading.name()).startsWith(authoredName));
    }
    const firstName = normalize(f.nodes(f.cards[0]).find(node => node.attributes.name === "requirement-1-deliverable-1:label").name());
    const expected = f.i18n.t("output.requirement.contextRequirement", "", { number: f.i18n.number(1), name: authoredName });
    assert.ok(firstName.includes(normalize(expected)), expected);
    assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
  });
  test("Output contextual names " + locale + ": each named exact result keeps its original review and download binding", async t => {
    const f = await contextualFixture(t, locale), before = structuredClone(f.output);
    nativeFormData(t);
    for (const result of f.output.results) {
      const nodes = f.nodes(), section = nodes.find(node => node.attributes.class === "output-result" && node.attributes["aria-labelledby"]?.includes("output-result-A-" + result.id));
      assert.ok(section);
      const controls = nodes.filter(node => ancestor(node, "section") === section);
      const accept = controls.find(node => node.tag === "button" && node.attributes.value === "approve");
      assert.ok(accept && !accept.disabled());
      const form = ancestor(accept, "form");
      form.fields = { coverage: "on", rights: "on", note: authoredText };
      await form.handlers.submit.call(f.host, { currentTarget: form, submitter: { value: "approve" }, preventDefault() {} });
      await f.flush();
      assert.equal(f.commands.at(-1).action, "review"); assert.equal(f.commands.at(-1).resultId, result.id);
      assert.deepEqual([f.commands.at(-1).reviewedCoverage, f.commands.at(-1).reviewedRights, f.commands.at(-1).note], [true, true, authoredText]);
      const download = f.nodes().find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.downloadReview") && normalize(node.name()).includes(normalize(f.i18n.t("output.delivery.contextResult", "", { number: f.i18n.number(f.output.results.indexOf(result) + 1), name: authoredName }))));
      await f.click(download);
      assert.equal(f.downloads.at(-1).path, f.output.assets.find(asset => asset.id === result.assetId).downloadUrl);
    }
    assert.equal(f.commands.length, 4); assert.equal(f.downloads.length, 4);
    assert.deepEqual(f.output, before); assert.equal(f.state.requests.length, 0);
  });
  test("Output contextual names " + locale + ": contextual names do not expose ineligible actions or bypass current permissions", async t => {
    const f = await contextualFixture(t, locale);
    nativeFormData(t);
    const oldDownload = f.nodes().find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.downloadReview"));
    const oldAccept = f.nodes().find(node => node.tag === "button" && node.attributes.value === "approve"), oldForm = ancestor(oldAccept, "form");
    oldForm.fields = { coverage: "on", rights: "on", note: authoredText };
    f.output.permissions = { ...f.output.permissions, canAuthor: false, canRequest: false, canReview: false, canDownload: false };
    f.draw();
    assert.equal(f.nodes().filter(node => node.tag === "button" && node.attributes.value === "approve").length, 0);
    assert.ok(f.nodes().filter(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.downloadReview")).every(node => node.disabled()));
    assert.equal(f.cards.flatMap(card => f.nodes(card)).filter(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.requirement.edit")).length, 0);
    await oldDownload.handlers.click.call(f.host, {});
    await oldForm.handlers.submit.call(f.host, { currentTarget: oldForm, submitter: { value: "approve" }, preventDefault() {} });
    assert.deepEqual(f.commands, []); assert.deepEqual(f.downloads, []);
    f.output.permissions = { ...f.output.permissions, canAuthor: true, canRequest: true, canReview: true, canDownload: true, independentReview: true };
    f.output.results.forEach(result => { result.independentReviewBlocked = true; });
    f.draw();
    assert.equal(f.nodes().filter(node => node.tag === "button" && node.attributes.value === "approve").length, 0);
    f.output.results.forEach(result => { result.independentReviewBlocked = false; result.reviewAllowed = false; });
    f.draw();
    assert.equal(f.nodes().filter(node => node.tag === "button" && node.attributes.value === "approve").length, 0);
    assert.equal(f.state.requests.length, 0);
  });
  test("Output contextual names " + locale + ": native composition, keyboard submit and member focus keep stable field identities", async t => {
    const f = await contextualFixture(t, locale), before = structuredClone(f.output);
    class InputPort extends ElementPort {}
    installGlobal(t, "HTMLInputElement", InputPort);
    installGlobal(t, "HTMLTextAreaElement", class extends ElementPort {});
    installGlobal(t, "HTMLSelectElement", class extends ElementPort {});
    await f.openEditors();
    const card = f.cards[0], fieldName = "requirement-1-deliverable-3-member-2:label";
    let field = f.native(card, fieldName), fieldId = field.attributes.id;
    assert.ok(field); Object.setPrototypeOf(field, InputPort.prototype);
    const formId = field.attributes.form, submits = [];
    field.form = { id: formId, requestSubmit: button => submits.push(button.attributes.id) };
    field.handlers.compositionstart.call(card, { currentTarget: field });
    field.value = "未確定の名前 اسم غير مكتمل";
    field.handlers.input.call(card, { currentTarget: field, isComposing: true });
    f.draw();
    assert.equal(f.native(card, fieldName).properties.value, noChange);
    const composingSection = f.nodes(card).find(node => node.attributes.class === "output-requirement-card");
    composingSection.handlers.keydown.call(card, { key: "Enter", ctrlKey: true, isComposing: true, target: field, preventDefault() { assert.fail("Composition cannot submit"); }, stopPropagation() {} });
    assert.deepEqual(submits, []);
    field.value = "確定した名前 — اسم محفوظ";
    field.handlers.compositionend.call(card, { currentTarget: field });
    f.draw();
    assert.strictEqual(f.cards[0], card); assert.equal(f.native(card, fieldName).attributes.id, fieldId);
    assert.equal(f.value(f.native(card, fieldName)), field.value);
    field = f.native(card, fieldName); Object.setPrototypeOf(field, InputPort.prototype);
    field.form = { id: formId, requestSubmit: button => submits.push(button.attributes.id) };
    const currentSection = f.nodes(card).find(node => node.attributes.class === "output-requirement-card");
    currentSection.handlers.keydown.call(card, { key: "Enter", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false, target: field, preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(submits, [f.nodes(card).find(node => node.tag === "button" && node.attributes.type === "submit").attributes.id]);
    const memberName = "requirement-1-deliverable-3-member-2";
    const move = f.nodes(card).find(node => node.tag === "button" && node.visibleLabel().startsWith(normalize(f.i18n.t("output.requirement.moveUp", "", { name: "確定した名前 — اسم محفوظ" }))));
    assert.ok(move); await f.click(move, card);
    assert.equal(f.native(card, fieldName).attributes.id, fieldId); assert.equal(f.value(f.native(card, fieldName)), "確定した名前 — اسم محفوظ");
    assert.ok(f.trace.includes("focus-id:" + fieldId));
    const reordered = f.nodes(card).filter(node => node.attributes["data-output-member"]).map(node => node.attributes["data-output-member"]);
    assert.equal(reordered[0], memberName);
    assert.deepEqual(f.output, before); assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
  });
  test("Output contextual names " + locale + ": repeated planning, target selections and retained attempts stay distinct", async t => {
    const f = await contextualFixture(t, locale);
    const review = f.nodes(f.cards[0]).find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.requirement.reviewPlan"));
    await f.click(review, f.cards[0]);
    let nodes = f.nodes(), plan = nodes.find(node => node.attributes.class === "output-plan-review");
    assert.ok(plan);
    const planControls = nodes.filter(node => (["input", "select"].includes(node.tag) && ancestor(node, "section") === plan && node.attributes.type !== "checkbox") || (node.tag === "input" && ancestor(node, "fieldset")?.children.some(child => typeof child !== "string" && child.tag === "legend" && child.visibleLabel() === f.i18n.t("output.delivery.optionalSelection"))));
    assert.ok(planControls.length >= 12); assertNamedPrefix(planControls);
    assert.equal(new Set(planControls.map(node => normalize(node.name()))).size, planControls.length);
    const runSelections = nodes.filter(node => node.tag === "input" && node.attributes.type === "checkbox" && ancestor(node, "section")?.attributes.class === "output-execution");
    assert.ok(runSelections.length > 4); assertNamedPrefix(runSelections);
    assert.equal(new Set(runSelections.map(node => normalize(node.name()))).size, runSelections.length);
    receiptGrants(f); const before = structuredClone(f.output.grants); f.draw(); nodes = f.nodes();
    const names = [f.i18n.t("output.delivery.checkSavedReceipt"), f.i18n.t("output.delivery.copyOperationReceipt"), f.i18n.t("output.delivery.prepareAlternative"), f.i18n.t("output.delivery.recoverAuthorized")];
    const receiptControls = nodes.filter(node => node.tag === "button" && names.includes(node.visibleLabel()));
    assert.ok(receiptControls.length >= 12); assertNamedPrefix(receiptControls);
    assert.equal(new Set(receiptControls.map(node => normalize(node.name()))).size, receiptControls.length);
    const receipts = nodes.filter(node => node.tag === "textarea" && node.attributes.readonly !== undefined);
    assert.equal(receipts.length, 4); assertNamedPrefix(receipts);
    assert.equal(new Set(receipts.map(node => normalize(node.name()))).size, 4);
    assert.deepEqual(f.output.grants, before); assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
  });
  test("Output contextual names " + locale + ": standalone cards retain complete colliding-prefix identities when no ordinal is provided", async t => {
    const f = await contextualFixture(t, locale);
    const cards = f.cards;
    for (const [index, card] of cards.entries()) {
      card.snapshot = { ...card.snapshot, requirementOrdinal: undefined, requirementId: "same-prefix-" + "a".repeat(100) + "-" + (index + 1) };
      card.markup = f.renderer.value(localizeTemplateResult(card.render(), f.i18n), card, "standalone:" + index);
    }
    const headings = cards.map(card => f.nodes(card).find(node => node.tag === "h2"));
    assert.equal(new Set(headings.map(node => normalize(node.name()))).size, 2);
    headings.forEach((heading, index) => { assert.ok(normalize(heading.name()).startsWith(authoredName)); assert.ok(heading.name().includes(cards[index].snapshot.requirementId)); });
    assert.equal(f.commands.length, 0);
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) test("Output contextual names " + locale + ": retained planning comparison names identify the correct version and target", async t => {
  const f = await contextualFixture(t, locale);
  const review = f.nodes(f.cards[0]).find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.requirement.reviewPlan"));
  await f.click(review, f.cards[0]);
  const aim = f.nodes().find(node => node.tag === "input" && node.visibleLabel() === f.i18n.t("output.delivery.suggestedAim"));
  assert.ok(aim); aim.handlers.input.call(f.host, { target: { value: "8" } }); f.draw();
  f.output.requirements[0].content += " New authored wording.";
  f.output.requirementRevision = "changed-authored-revision"; f.output.revision = "2"; f.draw();
  const nodes = f.nodes(), summaries = nodes.filter(node => node.tag === "summary" && node.attributes["aria-label"]?.includes(authoredName));
  assert.ok(summaries.length > f.output.confirmedPlan.plan.targets.length);
  assertNamedPrefix(summaries); assert.equal(new Set(summaries.map(node => normalize(node.name()))).size, summaries.length);
  for (const key of ["planPreviouslyReviewed", "planLatest", "planLocal"]) assert.ok(summaries.some(node => normalize(node.name()).includes(f.i18n.t("output.delivery." + key))));
  assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("Output contextual names " + locale + ": matching fields and actions retain exact target and file values", async t => {
  const f = await contextualFixture(t, locale); nativeFormData(t);
  const targets = f.output.confirmedPlan.plan.targets.filter(target => target.media_kind === "image").slice(0, 2);
  for (const [position, target] of targets.entries()) {
    const nodes = f.nodes(), article = nodes.find(node => node.attributes["data-output-target"] === target.id);
    const form = nodes.find(node => node.attributes.class === "output-bind-form" && ancestor(node, "article") === article);
    assert.ok(form);
    const select = nodes.find(node => node.tag === "select" && ancestor(node, "form") === form);
    const options = select.children.filter(child => typeof child !== "string" && child.tag === "option" && child.attributes.value);
    assert.equal(options.length, 4);
    assert.equal(new Set(options.map(option => normalize(option.name()))).size, 4);
    assert.deepEqual(options.map(option => option.attributes.value), f.output.assets.map(asset => asset.id));
    const button = nodes.find(node => node.tag === "button" && ancestor(node, "form") === form);
    assertNamedPrefix([select, button]); assert.equal(button.disabled(), false);
    form.fields = { assetId: f.output.assets[position].id };
    await form.handlers.submit.call(f.host, { currentTarget: form, preventDefault() {} }); await f.flush();
    assert.equal(f.commands.at(-1).action, "bind");
    assert.equal(f.commands.at(-1).targetId, target.id); assert.equal(f.commands.at(-1).assetId, f.output.assets[position].id);
  }
  assert.equal(f.commands.length, 2); assert.equal(f.state.requests.length, 0);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("Output contextual names " + locale + ": omitted completed attempts with duplicate target titles retain exact retrieval identities", async t => {
  const f = await contextualFixture(t, locale);
  receiptGrants(f);
  const targets = f.output.requirements.map(row => f.output.confirmedPlan.plan.targets.find(target => target.requirement_id === row.blockId && target.media_kind === "image"));
  for (const grant of f.output.grants) for (const [index, operation] of grant.operations.entries()) Object.assign(operation, {
    targetId: targets[index].id, status: "succeeded", pendingCalls: 0, exposedMicrousd: 0,
  });
  f.store.documentJobs.set([]);
  const reads = [];
  f.store.inspectOutputNativeJob = async (documentId, jobId, current) => {
    assert.equal(current(), true); reads.push({ documentId, jobId }); return { status: "unavailable" };
  };
  f.draw();
  const buttons = f.nodes().filter(node => node.tag === "button" && node.attributes["data-output-native-inspect"]);
  assert.equal(buttons.length, 4); assertNamedPrefix(buttons);
  assert.equal(new Set(buttons.map(node => normalize(node.name()))).size, 4);
  assert.ok(buttons.every(node => !node.disabled()));
  const before = structuredClone(f.output);
  for (const shown of buttons) {
    const originalId = shown.attributes["data-output-native-inspect"];
    const current = f.nodes().find(node => node.attributes["data-output-native-inspect"] === originalId);
    assert.ok(current); await f.click(current);
    assert.deepEqual(reads.at(-1), { documentId: "A", jobId: originalId });
  }
  assert.equal(reads.length, 4); assert.deepEqual(f.output, before);
  assert.deepEqual(f.commands, []); assert.equal(f.state.requests.length, 0);
});
