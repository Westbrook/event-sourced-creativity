import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { noChange } from "lit";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { copyOutputRequirement, inspectOutputRequirement } from "../src/model/output-requirements.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";
import { foldEvents } from "../src/model/events.ts";

// Reuse the full production-class/LocaleController/native-template fixture without
// registering its existing tests twice. No production method or original fixture is replaced.
const fixtureUrl = new URL("./output-contextual-names.test.mjs?document-context-fixture", import.meta.url);
const fixtureSource = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let declarations = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node) || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && ts.isIdentifier(node.expression.left) && node.expression.left.text === "moduleSource")).map(node => node.getFullText(tree)).join("\n");

// Lit's reactive property binding supplies previous values to willUpdate.
// Extend only the existing native-template port with that change map; production
// methods, setters, handlers and catalog loading remain complete and unchanged.
declarations = declarations.replace("const { fixture, loadActual, ElementPort, documentPort } =",
  "moduleSource = moduleSource.replace('Object.assign(instance, props.properties);', 'const changedProperties = new Map(Object.entries(props.properties).filter(([name, value]) => instance[name] !== value).map(([name]) => [name, instance[name]])); Object.assign(instance, props.properties);').replace('instance.willUpdate?.(new Map());', 'instance.willUpdate?.(changedProperties);');\nconst { fixture, loadActual, ElementPort, documentPort } =");

const fixtureHook = registerHooks({ load(url, context, next) {
  return url === fixtureUrl.href ? { format: "module", source: declarations + "\nexport { contextualFixture, loadActual, FormaOutputRequirements, FormaOutputRequirementCard, localizeTemplateResult, normalize, authoredName, authoredText, assertNamedPrefix, nativeFormData, ancestor, installGlobal, ElementPort, documentPort, receiptGrants };", shortCircuit: true } : next(url, context);
} });
const helpers = await import(fixtureUrl.href);
fixtureHook.deregister();
const { contextualFixture, loadActual, FormaOutputRequirements, FormaOutputRequirementCard, localizeTemplateResult, normalize, authoredName, authoredText, assertNamedPrefix, nativeFormData, ancestor, installGlobal, ElementPort, documentPort, receiptGrants } = helpers;
const { FormaDeliver } = await loadActual("src/components/forma-deliver.ts");
const documentTitle = "Same Document مستند 同じ文書";

function copySnapshot(original, documentId, projectId = original.projectId) {
  const copy = structuredClone(original);
  copy.documentId = documentId; copy.projectId = projectId;
  copy.sourceRevision = "source-" + documentId; copy.requirementRevision = "requirements-" + documentId;
  copy.requirements = original.requirements.map(row => {
    const spec = copyOutputRequirement(row.spec, documentId + ":" + row.spec.id).spec;
    assert.equal(inspectOutputRequirement(spec).status, "valid");
    assert.equal(spec.original_text, row.spec.original_text);
    return { ...row, blockId: spec.id, spec, preserved: structuredClone(spec) };
  });
  const plan = compileOutputPlan(copy.requirements.map(row => row.spec), { document_id: documentId, source_revision: copy.sourceRevision, requirement_revision: copy.requirementRevision });
  copy.confirmedPlan = { ...copy.confirmedPlan, revisionId: "plan-" + documentId, sourceDigest: copy.sourceRevision,
    requirementsDigest: copy.requirementRevision, plan, targetContractDigests: Object.fromEntries(plan.targets.map(target => [target.id, "b".repeat(64)])) };
  copy.requirementSummaries = Object.fromEntries(copy.requirements.map(row => [row.blockId, copy.summary]));
  copy.assets = original.assets.map(asset => ({ ...asset, id: documentId + ":" + asset.id, downloadUrl: "/api/output-requirements/assets/" + documentId + ":" + asset.id + "?documentId=" + documentId }));
  copy.results = original.results.map(result => {
    const target = plan.targets[original.confirmedPlan.plan.targets.findIndex(target => target.id === result.targetId)];
    return { ...result, id: documentId + ":" + result.id, assetId: documentId + ":" + result.assetId, targetId: target.id,
      resultRevision: documentId + ":" + result.resultRevision, planRevisionId: copy.confirmedPlan.revisionId,
      targetContractDigest: copy.confirmedPlan.targetContractDigests[target.id], sourceDigest: copy.sourceRevision };
  });
  return copy;
}

async function deliverFixture(t, locale) {
  const f = await contextualFixture(t, locale);
  f.host.disconnectedCallback();
  f.output.projectId = "p";
  f.outputs = new Map([["A", f.output], ["B", copySnapshot(f.output, "B")]]);
  f.state.projectId = "p"; f.state.route = "/deliver"; f.refreshes = 0;
  f.append = (type, payload) => {
    const sequence = f.state.events.at(-1).sequence + 1;
    const event = { eventId: "document-name-event-" + sequence, streamId: "stream", sequence, actor: "user:owner",
      correlationId: "document-names-fixture", occurredAt: "2026-08-28T00:00:00Z", type, payload };
    f.state.events.push(event);
    return event;
  };
  f.append("DocumentRenamed", { document_id: "A", new_title: documentTitle });
  f.append("DocumentCreated", { project_id: "p", document_id: "B", title: documentTitle });
  f.store.projection = { get: () => foldEvents(f.state.events, Infinity, f.state.documentId, f.state.projectId) };
  f.store.route = { get: () => f.state.route };
  f.store.refreshEvents = async () => { f.refreshes++; return true; };
  f.store.outputRequirements.resource = id => ({ state: "ready", snapshot: f.outputs.get(id), error: null });
  f.store.outputRequirements.ensure = async id => f.store.outputRequirements.resource(id);
  f.renderer.registry = { "forma-output-requirements": FormaOutputRequirements, "forma-output-requirement-card": FormaOutputRequirementCard };
  f.host = new FormaDeliver(); f.host.isConnected = true; f.host.connectedCallback();
  const draw = f.draw;
  f.draw = () => { const markup = draw(); f.controllers = [...f.renderer.instances.values()].map(row => row.instance).filter(instance => instance instanceof FormaOutputRequirements); return markup; };
  f.draw();
  assert.ok(f.host instanceof FormaDeliver);
  assert.equal(f.controllers.length, 2);
  assert.equal(f.cards.length, 4);
  assert.deepEqual(new Set(f.controllers.map(controller => controller.documentId)), new Set(["A", "B"]));
  return f;
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("Document-scoped Output names " + locale + ": real Deliver has eight distinct eligible exact-result actions across same-title Documents", async t => {
    const f = await deliverFixture(t, locale), before = structuredClone([...f.outputs]);
    const accepts = f.controllers.flatMap(controller => f.nodes(controller).filter(node => node.tag === "button" && node.attributes.value === "approve"));
    const downloads = f.controllers.flatMap(controller => f.nodes(controller).filter(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.downloadReview") && ancestor(node, "section")?.attributes.class === "output-result"));
    assert.equal(accepts.length, 8); assert.ok(accepts.every(node => !node.disabled()));
    assert.equal(downloads.length, 8); assert.ok(downloads.every(node => !node.disabled()));
    assertNamedPrefix([...accepts, ...downloads]);
    assert.equal(new Set(accepts.map(node => normalize(node.name()))).size, 8);
    assert.equal(new Set(downloads.map(node => normalize(node.name()))).size, 8);
    assert.deepEqual([...f.outputs], before); assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
  });
  test("Document-scoped Output names " + locale + ": real Deliver gives all fifty-six native Name fields a distinct Document context", async t => {
    const f = await deliverFixture(t, locale), before = structuredClone([...f.outputs]);
    await f.openEditors();
    const names = f.cards.flatMap(card => f.nodes(card).filter(node => node.tag === "input" && node.attributes.name?.endsWith(":label")));
    assert.equal(names.length, 56); assertNamedPrefix(names);
    assert.equal(new Set(names.map(node => normalize(node.name()))).size, 56);
    assert.deepEqual([...f.outputs], before); assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
  });
}

function ownControllerNodes(f, controller) {
  return f.nodes(controller).filter(node => !ancestor(node, "forma-output-requirement-card"));
}
function expectedDocumentContext(f, documentId) {
  const projection = f.store.projection.get(), documents = projection.documents.filter(document => document.projectId === projection.projectId && !document.removed);
  const index = documents.findIndex(document => document.id === documentId);
  assert.ok(index >= 0);
  return f.i18n.t("output.requirement.contextDocument", "", { number: f.i18n.number(index + 1), name: "\u2068" + documents[index].title + "\u2069" });
}
function assertDocumentContext(f, node, documentId) {
  const expected = expectedDocumentContext(f, documentId), name = node.name();
  assert.ok(name.includes(expected), JSON.stringify({ expected, name }));
  assert.equal(name.split(expected).length, 2, "Composite names include Document context once.");
  assert.match(name, /\u2068/u); assert.match(name, /\u2069/u);
}
function cardField(f, card, suffix = ":label") {
  const name = card.snapshot.spec.deliverables[0].id + suffix;
  return { name, field: f.native(card, name) };
}
function typeName(f, card, value) {
  const { name, field } = cardField(f, card); assert.ok(field);
  field.value = value; field.handlers.input.call(card, { currentTarget: field, isComposing: false }); f.draw();
  assert.equal(f.value(f.native(card, name)), value);
  return { name, id: field.attributes.id };
}
for (const locale of ["en", "fr", "ar", "ja"]) {
  test("Document-scoped Output names " + locale + ": full Deliver names Document-level review, upload, rights, availability, export and Refresh controls", async t => {
    const f = await deliverFixture(t, locale);
    const labels = ["reviewPlan", "file", "ownedRights", "uploadInspect", "checkRun", "clearRunSelection", "partialExplicit", "downloadFiles", "refresh"];
    for (const key of labels) {
      const controls = f.controllers.flatMap(controller => ownControllerNodes(f, controller).filter(node =>
        ["button", "input"].includes(node.tag) && node.visibleLabel() === f.i18n.t("output.delivery." + key)).map(node => ({ node, documentId: controller.documentId })));
      assert.ok(controls.length >= 2, key + " exists in both full Document controllers");
      assert.equal(new Set(controls.map(({node}) => normalize(node.name()))).size, controls.length, key);
      for (const { node, documentId } of controls) { assertNamedPrefix([node]); assertDocumentContext(f, node, documentId); }
    }
    for (const controller of f.controllers) {
      const headings = ownControllerNodes(f, controller).filter(node => node.tag === "h2");
      assert.equal(headings.length, 1); assertDocumentContext(f, headings[0], controller.documentId);
      const groups = ownControllerNodes(f, controller).filter(node => /^(?:output-target|output-result|output-execution|output-adoption|output-export)$/u.test(node.attributes.class ?? ""));
      assert.ok(groups.length > 8);
      for (const group of groups) assertDocumentContext(f, group, controller.documentId);
    }
    assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
  });
  test("Document-scoped Output names " + locale + ": each exact-result action keeps its own Document, result, asset and submitted values", async t => {
    const f = await deliverFixture(t, locale), before = structuredClone([...f.outputs]);
    nativeFormData(t);
    for (const controller of f.controllers) for (const result of f.outputs.get(controller.documentId).results) {
      let nodes = ownControllerNodes(f, controller), section = nodes.find(node => node.attributes.class === "output-result" && node.attributes["aria-labelledby"].startsWith("output-result-" + controller.documentId + "-" + result.id + " "));
      assert.ok(section);
      const accept = nodes.find(node => node.attributes.value === "approve" && ancestor(node, "section") === section), form = ancestor(accept, "form");
      assert.ok(accept && form); assert.equal(accept.disabled(), false); assertDocumentContext(f, accept, controller.documentId);
      form.fields = { coverage: "on", rights: "on", note: authoredText };
      await form.handlers.submit.call(controller, { currentTarget: form, submitter: { value: "approve" }, preventDefault() {} }); await f.flush();
      const command = f.commands.at(-1);
      assert.equal(command.action, "review"); assert.equal(command.documentId, controller.documentId); assert.equal(command.resultId, result.id);
      assert.equal(command.decision, "approve"); assert.equal(command.reviewedCoverage, true); assert.equal(command.reviewedRights, true); assert.equal(command.note, authoredText);
      assert.equal("documentContext" in command, false); assert.equal("requirementOrdinal" in command, false);
      nodes = ownControllerNodes(f, controller); section = nodes.find(node => node.attributes.class === "output-result" && node.attributes["aria-labelledby"].startsWith("output-result-" + controller.documentId + "-" + result.id + " "));
      const download = nodes.find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.downloadReview") && ancestor(node, "section") === section);
      assert.ok(download); await f.click(download, controller);
      assert.deepEqual(f.downloads.at(-1), { documentId: controller.documentId, path: f.outputs.get(controller.documentId).assets.find(asset => asset.id === result.assetId).downloadUrl });
    }
    assert.equal(f.commands.length, 8); assert.equal(f.downloads.length, 8);
    assert.deepEqual([...f.outputs], before); assert.equal(f.state.requests.length, 0);
  });
  test("Document-scoped Output names " + locale + ": rename and DocumentCreated reorder retain dirty card, field, current names and save binding", async t => {
    const f = await deliverFixture(t, locale), before = structuredClone([...f.outputs]);
    await f.openEditors();
    const card = f.cards.find(card => card.snapshot.scope.documentId === "A"), controller = f.controllers.find(controller => controller.documentId === "A");
    const originalCardId = card.snapshot.requirementId, field = typeName(f, card, "Draft still owned by A");
    const oldName = f.nodes(card).find(node => node.attributes.name === field.name).name();
    f.append("DocumentRenamed", { document_id: "A", new_title: "Renamed Document نص — 文書" }); f.draw();
    assert.equal(f.cards.includes(card), true); assert.equal(f.native(card, field.name).attributes.id, field.id);
    assert.equal(f.value(f.native(card, field.name)), "Draft still owned by A");
    let currentName = f.nodes(card).find(node => node.attributes.name === field.name);
    assertDocumentContext(f, currentName, "A"); assert.notEqual(currentName.name(), oldName);
    f.outputs.set("C", copySnapshot(f.output, "C"));
    f.append("DocumentCreated", { project_id: "p", document_id: "C", title: documentTitle }); f.draw();
    assert.equal(f.cards.includes(card), true); assert.equal(card.isConnected, true); assert.equal(controller.documentId, "A");
    assert.equal(f.controllers.find(candidate => candidate.documentId === "A") === controller, true);
    assert.equal(card.snapshot.requirementId, originalCardId); assert.equal(f.native(card, field.name).attributes.id, field.id);
    assert.equal(f.value(f.native(card, field.name)), "Draft still owned by A");
    currentName = f.nodes(card).find(node => node.attributes.name === field.name); assertDocumentContext(f, currentName, "A");
    const controllerActions = ownControllerNodes(f, controller).filter(node => node.attributes.value === "approve");
    assert.equal(controllerActions.length, 4); controllerActions.forEach(node => assertDocumentContext(f, node, "A"));
    const form = f.nodes(card).find(node => node.tag === "form" && node.attributes.class === "output-requirement-form");
    form.handlers.submit.call(card, { currentTarget: form, preventDefault() {}, stopPropagation() {} }); await f.flush();
    assert.equal(f.commands.length, 1);
    const command = f.commands[0];
    assert.equal(command.action, "save"); assert.equal(command.documentId, "A"); assert.equal(command.blockId, originalCardId);
    assert.equal(command.spec.id, originalCardId); assert.equal(command.spec.deliverables[0].id, before[0][1].requirements[0].spec.deliverables[0].id);
    assert.equal(command.spec.deliverables[0].label, "Draft still owned by A"); assert.equal(command.spec.original_text, authoredText);
    assert.equal("documentContext" in command, false);
    assert.deepEqual(f.outputs.get("A"), before[0][1]); assert.deepEqual(f.outputs.get("B"), before[1][1]); assert.equal(f.state.requests.length, 0);
  });
  test("Document-scoped Output names " + locale + ": invalid or missing standalone hints use full isolated Document identity without leaking hinted titles", async t => {
    const f = await contextualFixture(t, locale), cards = f.cards, base = cards.map(card => structuredClone(card.snapshot));
    const documentIds = [1, 2].map(index => "same-document-prefix-" + "a".repeat(100) + ":" + index);
    const invalidHints = [undefined, { projectId: "other", documentId: "", title: "PRIVATE WRONG DOCUMENT", ordinal: 1 },
      ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(ordinal => ({ title: "PRIVATE WRONG DOCUMENT", ordinal })),
      { title: null, ordinal: 1 }, { documentId: "wrong", title: "PRIVATE WRONG DOCUMENT", ordinal: 1 }];
    for (const invalid of invalidHints) {
      for (const [index, card] of cards.entries()) {
        const scope = { ...base[index].scope, documentId: documentIds[index] };
        card.snapshot = { ...base[index], scope, requirementOrdinal: 1, requirementId: "same-local-requirement", documentContext: invalid === undefined ? undefined : { projectId: scope.projectId, documentId: scope.documentId, ...invalid } };
        card.willUpdate(new Map([["snapshot", base[index]]]));
        card.markup = f.renderer.value(localizeTemplateResult(card.render(), f.i18n), card, "standalone:" + index);
      }
      const headings = cards.map(card => f.nodes(card).find(node => node.tag === "h2"));
      assert.equal(new Set(headings.map(node => normalize(node.name()))).size, 2);
      headings.forEach((node, index) => {
        assert.ok(node.name().includes("\u2068" + documentIds[index] + "\u2069")); assert.equal(node.name().includes("PRIVATE WRONG DOCUMENT"), false);
        assert.ok(normalize(node.name()).startsWith(authoredName));
      });
    }
    assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
  });
  test("Document-scoped Output names " + locale + ": read-only and independently blocked actions remain unavailable in both Document controllers", async t => {
    const f = await deliverFixture(t, locale);
    nativeFormData(t);
    const old = f.controllers.map(controller => {
      const nodes = ownControllerNodes(f, controller), accept = nodes.find(node => node.attributes.value === "approve"), form = ancestor(accept, "form");
      form.fields = { coverage: "on", rights: "on", note: authoredText };
      return { controller, form, download: nodes.find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.downloadReview")) };
    });
    for (const output of f.outputs.values()) output.permissions = { ...output.permissions, canAuthor: false, canRequest: false, canReview: false, canDownload: false };
    f.draw();
    for (const controller of f.controllers) {
      const nodes = ownControllerNodes(f, controller); assert.equal(nodes.some(node => node.attributes.value === "approve"), false);
      const downloads = nodes.filter(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.downloadReview"));
      assert.equal(downloads.length, 4); assert.ok(downloads.every(node => node.disabled()));
      downloads.forEach(node => assertDocumentContext(f, node, controller.documentId));
    }
    assert.equal(f.cards.flatMap(card => f.nodes(card)).some(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.requirement.edit")), false);
    for (const {controller, form, download} of old) {
      await download.handlers.click.call(controller, {});
      await form.handlers.submit.call(controller, { currentTarget: form, submitter: { value: "approve" }, preventDefault() {} });
    }
    for (const output of f.outputs.values()) { output.permissions.canReview = true; output.permissions.independentReview = true; output.results.forEach(result => result.independentReviewBlocked = true); }
    f.draw();
    assert.equal(f.controllers.flatMap(controller => ownControllerNodes(f, controller)).some(node => node.attributes.value === "approve"), false);
    assert.deepEqual(f.commands, []); assert.deepEqual(f.downloads, []); assert.equal(f.state.requests.length, 0);
  });
  test("Document-scoped Output names " + locale + ": newly authorized project uses only its current Document context and closes old dirty editors", async t => {
    const f = await deliverFixture(t, locale); await f.openEditors();
    const oldCards = [...f.cards], card = oldCards[0]; typeName(f, card, "Old private draft");
    const next = copySnapshot(f.output, "C", "q"); f.outputs.set("C", next);
    f.append("ProjectCreated", { project_id: "q", name: "Other current project" });
    f.append("DocumentCreated", { project_id: "q", document_id: "C", title: "New authorized Document" });
    f.state.authorization = "scope-q"; f.state.projectId = "q"; f.state.documentId = "C"; f.draw();
    assert.equal(f.controllers.length, 1); assert.equal(f.controllers[0].documentId, "C"); assert.equal(f.cards.length, 2);
    assert.ok(oldCards.every(card => !card.isConnected)); assert.equal(f.host.markup.includes("Old private draft"), false);
    const actions = ownControllerNodes(f, f.controllers[0]).filter(node => node.attributes.value === "approve");
    assert.equal(actions.length, 4); actions.forEach(node => assertDocumentContext(f, node, "C"));
    assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("Document-scoped Output names " + locale + ": IME, keyboard save and member focus survive Document rename and insertion", async t => {
    const f = await deliverFixture(t, locale);
    class InputPort extends ElementPort {}
    installGlobal(t, "HTMLInputElement", InputPort);
    installGlobal(t, "HTMLTextAreaElement", class extends ElementPort {});
    installGlobal(t, "HTMLSelectElement", class extends ElementPort {});
    await f.openEditors();
    const card = f.cards.find(card => card.snapshot.scope.documentId === "A");
    const member = card.snapshot.spec.deliverables.find(deliverable => deliverable.series)?.series.members[1]; assert.ok(member);
    const fieldName = member.id + ":label"; let field = f.native(card, fieldName); const fieldId = field.attributes.id, formId = field.attributes.form;
    Object.setPrototypeOf(field, InputPort.prototype);
    const submits = []; field.form = { id: formId, requestSubmit: button => submits.push(button.attributes.id) };
    field.handlers.compositionstart.call(card, { currentTarget: field });
    field.value = "未確定 اسم غير مكتمل"; field.handlers.input.call(card, { currentTarget: field, isComposing: true });
    f.append("DocumentRenamed", { document_id: "A", new_title: "IME Document 文書" });
    f.outputs.set("C", copySnapshot(f.output, "C")); f.append("DocumentCreated", { project_id: "p", document_id: "C", title: documentTitle }); f.draw();
    assert.equal(f.cards.includes(card), true); assert.equal(f.native(card, fieldName).attributes.id, fieldId);
    assert.equal(f.native(card, fieldName).properties.value, noChange);
    f.nodes(card).find(node => node.attributes.class === "output-requirement-card").handlers.keydown.call(card, { key: "Enter", ctrlKey: true, isComposing: true, target: field, preventDefault() { assert.fail("IME cannot submit"); }, stopPropagation() {} });
    assert.deepEqual(submits, []);
    field.value = "確定した名前 — اسم محفوظ"; field.handlers.compositionend.call(card, { currentTarget: field }); f.draw();
    assert.equal(f.value(f.native(card, fieldName)), field.value);
    field = f.native(card, fieldName); Object.setPrototypeOf(field, InputPort.prototype); field.form = { id: formId, requestSubmit: button => submits.push(button.attributes.id) };
    f.nodes(card).find(node => node.attributes.class === "output-requirement-card").handlers.keydown.call(card, { key: "Enter", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false, target: field, preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(submits, [f.nodes(card).find(node => node.tag === "button" && node.attributes.type === "submit").attributes.id]);
    const move = f.nodes(card).find(node => node.tag === "button" && node.visibleLabel().startsWith(normalize(f.i18n.t("output.requirement.moveUp", "", { name: "確定した名前 — اسم محفوظ" }))));
    assert.ok(move); await f.click(move, card);
    assert.equal(f.native(card, fieldName).attributes.id, fieldId); assert.equal(f.value(f.native(card, fieldName)), "確定した名前 — اسم محفوظ");
    assert.ok(f.trace.includes("focus-id:" + fieldId)); assert.equal(documentPort.activeElement.attributes.id, fieldId); assertDocumentContext(f, f.nodes(card).find(node => node.attributes.name === fieldName), "A");
    assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
  });
  test("Document-scoped Output names " + locale + ": standalone controller rejects missing or mismatched projected hints and keeps full real IDs", async t => {
    const f = await contextualFixture(t, locale);
    const projection = f.store.projection.get();
    f.output.projectId = projection.projectId;
    f.host.documentName = "PRIVATE wrong projected title";
    for (const documents of [[], [{ id: "A", projectId: "different-project", title: "PRIVATE wrong projected title", removed: false }], [{ id: "A", projectId: projection.projectId, title: "PRIVATE wrong projected title", removed: true }]]) {
      f.store.projection = { get: () => ({ ...projection, documents }) }; f.draw();
      const actions = ownControllerNodes(f, f.host).filter(node => node.attributes.value === "approve");
      assert.equal(actions.length, 4);
      for (const action of actions) { assert.ok(action.name().includes("\u2068A\u2069")); assert.equal(action.name().includes("PRIVATE wrong projected title"), false); assertNamedPrefix([action]); }
    }
    f.store.projection = { get: () => ({ ...projection, projectId: "other-project", documents: [{ id: "A", projectId: "other-project", title: "PRIVATE wrong projected title", removed: false }] }) }; f.draw();
    const actions = ownControllerNodes(f, f.host).filter(node => node.attributes.value === "approve");
    assert.equal(actions.length, 4); assert.ok(actions.every(node => node.name().includes("\u2068A\u2069") && !node.name().includes("PRIVATE wrong projected title")));
    assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("Document-scoped Output names " + locale + ": repeated plan decisions and unfinished count drafts remain Document-owned", async t => {
    const f = await deliverFixture(t, locale);
    for (const controller of f.controllers) {
      const open = ownControllerNodes(f, controller).find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.reviewPlan") && !ancestor(node, "form"));
      assert.ok(open); await f.click(open, controller);
    }
    const controllers = [...f.controllers];
    for (const controller of controllers) {
      const nodes = ownControllerNodes(f, controller), section = nodes.find(node => node.attributes.class === "output-plan-review");
      assert.ok(section); assertDocumentContext(f, section, controller.documentId);
      for (const key of ["cancel", "confirm", "amendmentReason"]) {
        const control = nodes.find(node => ["button", "textarea"].includes(node.tag) && normalize(node.name()).startsWith(f.i18n.t("output.delivery." + key)) && ancestor(node, "section") === section);
        assert.ok(control, key); assertDocumentContext(f, control, controller.documentId);
      }
      const aim = nodes.find(node => node.tag === "input" && node.visibleLabel() === f.i18n.t("output.delivery.suggestedAim"));
      assert.ok(aim); aim.handlers.input.call(controller, { target: { value: "unfinished-8" } }); f.draw();
    }
    f.outputs.set("C", copySnapshot(f.output, "C")); f.append("DocumentCreated", { project_id: "p", document_id: "C", title: documentTitle });
    f.append("DocumentRenamed", { document_id: "A", new_title: "Current planning Document" }); f.draw();
    for (const controller of controllers) {
      assert.equal(f.controllers.includes(controller), true);
      const nodes = ownControllerNodes(f, controller), aim = nodes.find(node => node.tag === "input" && node.visibleLabel() === f.i18n.t("output.delivery.suggestedAim"));
      assert.ok(aim); assert.equal(aim.properties.value, "unfinished-8"); assert.equal(aim.attributes["aria-invalid"], "true"); assertDocumentContext(f, aim, controller.documentId);
      const confirm = nodes.find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.confirm"));
      assert.ok(confirm); assert.equal(confirm.disabled(), true);
    }
    assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
  });
  test("Document-scoped Output names " + locale + ": recorded native attempt retrieval keeps exact Document and original job across duplicate titles", async t => {
    const f = await deliverFixture(t, locale); receiptGrants(f);
    for (const output of f.outputs.values()) {
      const targets = output.requirements.map(row => output.confirmedPlan.plan.targets.find(target => target.requirement_id === row.blockId && target.media_kind === "image"));
      output.grants = f.output.grants.map((grant, ordinal) => ({
        ...grant, id: output.documentId + ":authorization:" + ordinal, planRevisionId: output.confirmedPlan.revisionId,
        operations: grant.operations.map((operation, index) => ({ ...operation, id: output.documentId + ":operation:" + ordinal + ":" + index,
          jobId: output.documentId + ":job:" + ordinal + ":" + index, targetId: targets[index].id, status: "succeeded", pendingCalls: 0, exposedMicrousd: 0 })),
      }));
    }
    f.store.documentJobs.set([]);
    const reads = [];
    f.store.inspectOutputNativeJob = async (documentId, jobId, current) => { assert.equal(current(), true); reads.push({documentId, jobId}); return { status: "unavailable" }; };
    f.draw();
    const shown = f.controllers.flatMap(controller => ownControllerNodes(f, controller).filter(node => node.attributes["data-output-native-inspect"]).map(node => ({controller, node})));
    assert.equal(shown.length, 8); assert.equal(new Set(shown.map(({node}) => normalize(node.name()))).size, 8);
    for (const {controller, node} of shown) {
      assertNamedPrefix([node]); assertDocumentContext(f, node, controller.documentId); assert.equal(node.disabled(), false);
      const originalId = node.attributes["data-output-native-inspect"], current = ownControllerNodes(f, controller).find(candidate => candidate.attributes["data-output-native-inspect"] === originalId);
      await f.click(current, controller); assert.deepEqual(reads.at(-1), { documentId: controller.documentId, jobId: originalId });
    }
    const operationGroups = f.controllers.flatMap(controller => ownControllerNodes(f, controller).filter(node => node.attributes.class === "output-operation"));
    assert.equal(operationGroups.length, 8); assert.equal(new Set(operationGroups.map(node => normalize(node.name()))).size, 8);
    assert.equal(reads.length, 8); assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
    assert.deepEqual(f.store.documentJobs.get(), []);
  });
}

const { _$LH: litParts } = await import(pathToFileURL(createRequire(import.meta.resolve("lit")).resolve("lit-html/private-ssr-support.js")).href);
// Actual Lit compiles these full component templates and commits the name parts.
// These checks cover HTML binding boundaries, not a browser or assistive-technology
// certificate. Keep this test Node/Lit-only; it adds no parser dependency.
for (const locale of ["en", "fr", "ar", "ja"]) test("Document-scoped Output names " + locale + ": actual Lit keeps annotations inside native start tags and preserves control types", async t => {
  const f = await deliverFixture(t, locale); await f.openEditors();
  for (const controller of f.controllers) {
    const open = ownControllerNodes(f, controller).find(node => node.tag === "button" && node.visibleLabel() === f.i18n.t("output.delivery.reviewPlan") && !ancestor(node, "form"));
    assert.ok(open); await f.click(open, controller);
  }
  const templates = [], renderValue = f.renderer.value.bind(f.renderer);
  f.renderer.value = (value, owner, ...args) => { if (value?.strings) templates.push({value, owner}); return renderValue(value, owner, ...args); };
  f.draw();
  let namesChecked = 0, buttonsChecked = 0, summariesChecked = 0;
  for (const {value} of templates) {
    const [compiled, attributeNames] = litParts.getTemplateHtml(value.strings, litParts.HTML_RESULT), markup = String(compiled);
    const nameIndexes = value.strings.slice(0, -1).flatMap((text, index) => text.endsWith("aria-label=") ? [index] : []);
    assert.equal(attributeNames.filter(name => name === "aria-label").length, nameIndexes.length, "Every intended name must be a real Lit attribute, never visible summary/body text.");
    for (const match of markup.matchAll(/(?:^|\s)aria-label\$lit\$=/gu)) {
      const after = markup.slice(match.index + match[0].length);
      assert.ok(after.startsWith(litParts.marker), "The name is one unquoted Lit value.");
      assert.match(after.slice(litParts.marker.length), /^[\t\n\f\r />]/u, "A name binding must end before the next attribute or closing bracket.");
    }
    for (const index of nameIndexes) {
      const part = new litParts.AttributePart({ tagName: "DIV" }, "aria-label", ["", ""], litParts.connectedDisconnectable({}), {});
      const committed = litParts.getAttributePartCommittedValue(part, value.values[index]);
      assert.equal(committed, value.values[index]); assert.equal(typeof committed, "string");
      assert.equal(/(?:^|\s)aria-label=/u.test(committed), false);
      namesChecked++;
    }
    for (const [tag] of markup.matchAll(/<button\b[^>]*>/gu)) {
      assert.match(tag, /\stype="(?:button|submit|reset)"(?:\s|>)/u, "An explicit native type cannot be absorbed into the previous attribute.");
      buttonsChecked++;
    }
    for (const [tag] of markup.matchAll(/<summary\b[^>]*>/gu)) {
      assert.ok(tag.includes("aria-label" + litParts.boundAttributeSuffix + "="), "Repeated disclosure names belong on the summary start tag.");
      summariesChecked++;
    }
  }
  assert.ok(namesChecked > 500); assert.ok(buttonsChecked > 50); assert.ok(summariesChecked > 20);
  const nativeFields = f.cards.flatMap(card => f.nodes(card).filter(node => ["input", "textarea", "select"].includes(node.tag)));
  for (const field of nativeFields) {
    assert.ok(field.attributes.id); assert.ok(field.attributes.name); assert.ok(field.attributes.form);
    const actualForm = f.nodes(field.owner).find(node => node.tag === "form" && node.attributes.id === field.attributes.form);
    assert.ok(actualForm, "Every explicit form binding resolves to the owning card form.");
  }
  assert.equal(f.commands.length, 0); assert.equal(f.state.requests.length, 0);
});

test("Document-scoped Output names: every source-template annotation uses a real Lit attribute boundary, including conditional disclosures", () => {
  let checked = 0, summaries = 0;
  for (const file of ["src/components/forma-output-requirements.ts", "src/components/forma-output-requirement-card.ts", "src/components/forma-deliver.ts"]) {
    const source = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = node => {
      if (ts.isTaggedTemplateExpression(node) && node.tag.getText(parsed) === "html") {
        const parts = ts.isNoSubstitutionTemplateLiteral(node.template) ? [node.template] : [node.template.head, ...node.template.templateSpans.map(span => span.literal)];
        const strings = parts.map(part => part.text);
        Object.defineProperty(strings, "raw", { value: [...strings] });
        const [compiled, attributeNames] = litParts.getTemplateHtml(strings, litParts.HTML_RESULT), markup = String(compiled);
        const declaredNames = strings.slice(0, -1).filter(text => text.endsWith("aria-label=")).length;
        assert.equal(attributeNames.filter(name => name === "aria-label").length, declaredNames, file + ": no annotation may become visible text");
        for (const match of markup.matchAll(/(?:^|\s)aria-label\$lit\$=/gu)) {
          const after = markup.slice(match.index + match[0].length);
          assert.ok(after.startsWith(litParts.marker)); assert.match(after.slice(litParts.marker.length), /^[\t\n\f\r />]/u, file + ": annotation preserves the following attribute");
          checked++;
        }
        for (const [tag] of markup.matchAll(/<button\b[^>]*>/gu)) assert.match(tag, /\stype="(?:button|submit|reset)"(?:\s|>)/u, file + ": native button type remains explicit");
        for (const [tag] of markup.matchAll(/<summary\b[^>]*>/gu)) { assert.ok(tag.includes("aria-label" + litParts.boundAttributeSuffix + "="), file + ": repeated summary context is an attribute"); summaries++; }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  assert.ok(checked > 100); assert.ok(summaries >= 10);
});
