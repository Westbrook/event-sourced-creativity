import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import typescript from "typescript";
import { suggestedSubtype } from "../src/model/block-types.ts";
import { foldEvents } from "../src/model/events.ts";
import { documentSlug } from "../src/model/routes.ts";

const source = await readFile(new URL("../src/components/forma-projects.ts", import.meta.url), "utf8");
const parsed = typescript.createSourceFile("forma-projects.ts", source, typescript.ScriptTarget.Latest, true);
const builder = parsed.statements.find((statement) =>
  typescript.isFunctionDeclaration(statement) && statement.name?.text === "projectBriefEvents");
assert.ok(builder, "project creation has one deterministic, atomically submitted event builder");
const implementation = typescript.transpileModule(builder.getText(parsed), {
  compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 },
}).outputText;
const build = runInNewContext(`${implementation}\nprojectBriefEvents`, {
  crypto: { randomUUID },
  documentSlug,
  suggestedSubtype,
});
const plan = (draft) => structuredClone(build(draft));

const draft = (overrides = {}) => ({
  projectId: "project-intake",
  documentId: "document-intake-12345678",
  name: "Forma pitch",
  documentTitle: "",
  objective: "",
  audience: "",
  message: "",
  protectedPhrase: "",
  deliverable: "",
  boundary: "",
  source: "",
  sourceRights: false,
  ...overrides,
});

const materialize = (events) => events.map((input, index) => ({
  eventId: `intake-event-${index + 1}`,
  streamId: "creative:intake-owner",
  sequence: index + 1,
  occurredAt: "2026-08-25T12:00:00.000Z",
  recordedAt: "2026-08-25T12:00:00.000Z",
  actor: "user",
  clientId: "intake-test",
  correlationId: "intake-correlation",
  causationId: null,
  compensatesEventId: null,
  schemaVersion: 1,
  ...input,
}));

test("project intake atomically preserves the authored document name, message, exact phrase, and licensed text source", () => {
  const phrase = "Your content. One context. Infinite paths to your target.";
  const result = plan(draft({
    name: "  Forma pitch  ",
    documentTitle: "  Pitch Context  ",
    objective: "  Explain why one living context beats fragmented files.  ",
    audience: "  Founders and product marketers  ",
    message: "  One authored context adapts to the moment and audience.  ",
    protectedPhrase: `  ${phrase}  `,
    deliverable: "  A persuasive nine-slide presentation  ",
    boundary: "  Do not fabricate customer proof.  ",
    source: "  Historically a story required .doc, .ppt, .mov, .mp3, and .psd files.  ",
    sourceRights: true,
  }));

  assert.ok(result);
  assert.equal(result.hasBrief, true);
  assert.equal(result.decisionCount, 6);
  assert.deepEqual(result.events.map((event) => event.type), [
    "ProjectCreated",
    "DocumentCreated",
    "EmptyCanvasChosen",
    "BlockCreated",
    "BlockCreated",
    "BlockCreated",
    "BlockCreated",
    "BlockCreated",
    "ReferenceIngested",
    "RightsAsserted",
    "BlockCreated",
  ]);

  const createdProject = result.events.find((event) => event.type === "ProjectCreated");
  const createdDocument = result.events.find((event) => event.type === "DocumentCreated");
  assert.equal(createdProject.payload.name, "Forma pitch");
  assert.equal(createdDocument.payload.title, "Pitch Context");
  assert.equal(createdDocument.payload.handle, "pitch-context");

  const decisions = result.events.filter((event) => event.type === "BlockCreated");
  assert.deepEqual(decisions.map((event) => event.payload.type), [
    "direction", "audience", "message", "format", "exclusion", "reference",
  ]);

  const message = decisions.find((event) => event.payload.type === "message");
  assert.equal(message.payload.properties.text,
    `One authored context adapts to the moment and audience.\n\nPreserve this line exactly: ${phrase}`);
  assert.equal(message.payload.properties.subtype, suggestedSubtype("message"));
  assert.equal(message.payload.properties.authority, "authored");
  assert.equal(message.payload.properties.weight, .8);
  assert.equal(message.payload.properties.exact_text, phrase);
  assert.deepEqual(message.payload.properties.exact_placements, ["opening", "closing"]);
  assert.deepEqual(message.payload.properties.protected_phrases,
    [{ text: phrase, placement: "opening_and_closing" }]);
  assert.equal(decisions.find((event) => event.payload.type === "exclusion").payload.properties.intent, "prohibit");

  const ingestion = result.events.find((event) => event.type === "ReferenceIngested");
  const rights = result.events.find((event) => event.type === "RightsAsserted");
  const reference = decisions.find((event) => event.payload.type === "reference");
  for (const properties of [ingestion.payload, reference.payload.properties]) {
    assert.equal(properties.source_type, "pasted-text");
    assert.equal(properties.source_kind, "text");
    assert.equal(properties.source_mime_type, "text/plain");
    assert.equal(properties.media_type, "text/plain");
    assert.equal(properties.reference_id, rights.payload.reference_id);
    assert.equal(Object.hasOwn(properties, "media_url"), false);
    assert.equal(Object.hasOwn(properties, "pixel_reference_mode"), false);
  }
  assert.equal(rights.payload.rights_class, "owned_or_licensed");
  assert.equal(rights.payload.assertion_method, "explicit-brief-confirmation");

  const projection = foldEvents(materialize(result.events), Number.POSITIVE_INFINITY, "document-intake-12345678");
  assert.equal(projection.documentTitle, "Pitch Context");
  assert.equal(projection.blocks.find((block) => block.type === "message").properties.exact_text, phrase);
  assert.equal(projection.blocks.find((block) => block.type === "reference").properties.source_mime_type, "text/plain");
});

test("an exact phrase alone creates an authored Message without fabricating another creative decision", () => {
  const phrase = "Your content. One context. Infinite paths to your target.";
  const result = plan(draft({ protectedPhrase: phrase }));
  const blocks = result.events.filter((event) => event.type === "BlockCreated");

  assert.equal(result.hasBrief, true);
  assert.equal(result.decisionCount, 1);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].payload.type, "message");
  assert.equal(blocks[0].payload.properties.text, `Preserve this line exactly: ${phrase}`);
  assert.deepEqual(blocks[0].payload.properties.exact_placements, ["opening", "closing"]);
  assert.equal(result.events.find((event) => event.type === "DocumentCreated").payload.title, "Forma pitch brief");
});

test("blank project and authored blank document workflows never invent a Message", () => {
  for (const [documentTitle, expectedTitle, expectedHandle] of [
    ["", "Untitled document", "untitled"],
    ["  My blank canvas  ", "My blank canvas", "my-blank-canvas"],
    ["作品", "作品", "document-document"],
  ]) {
    const result = plan(draft({ documentTitle }));
    const document = result.events.find((event) => event.type === "DocumentCreated");
    assert.equal(result.hasBrief, false);
    assert.equal(result.decisionCount, 0);
    assert.equal(result.events.length, 3);
    assert.equal(document.payload.title, expectedTitle);
    assert.equal(document.payload.handle, expectedHandle);
    assert.equal(result.events.some((event) => event.type === "BlockCreated"), false);
  }
});

test("ordinary authored messages stay clean and protected instructions are never duplicated", () => {
  const phrase = "One context, infinite paths.";
  const plain = plan(draft({ message: "  Explain the idea clearly.  " }));
  const plainMessage = plain.events.find((event) => event.payload.type === "message");
  assert.equal(plainMessage.payload.properties.text, "Explain the idea clearly.");
  assert.equal(Object.hasOwn(plainMessage.payload.properties, "exact_text"), false);
  assert.equal(Object.hasOwn(plainMessage.payload.properties, "protected_phrases"), false);

  const alreadyProtected = plan(draft({
    message: `Here is the conclusion.\n\nPreserve this line exactly: ${phrase}`,
    protectedPhrase: phrase,
  }));
  const protectedMessage = alreadyProtected.events.find((event) => event.payload.type === "message");
  assert.equal(protectedMessage.payload.properties.text.split(`Preserve this line exactly: ${phrase}`).length, 2);
});

test("project creation refuses unlicensed passages and keeps every intake control optional except the project name", () => {
  assert.equal(plan(draft({ source: "Unlicensed evidence", sourceRights: false })), null);
  assert.equal(plan(draft({ name: "   " })), null);

  {
    const owner = parsed.statements.find(node => typescript.isClassDeclaration(node) && node.name?.text === "FormaProjects");
    const intake = owner?.members.find(node => typescript.isMethodDeclaration(node) && node.name.getText(parsed) === "#runIntake");
    const statements = intake?.body?.statements.find(typescript.isTryStatement)?.tryBlock.statements;
    assert.ok(statements, "the original intake method owns the guarded Store call");
    const [controlStatement, resultStatement, ownGuard, receiptStatement] = statements;
    for (const [statement, name] of [[controlStatement, "controls"], [resultStatement, "result"], [receiptStatement, "complete"]]) {
      assert.ok(statement && typescript.isVariableStatement(statement)
        && Boolean(statement.declarationList.flags & typescript.NodeFlags.Const)
        && statement.declarationList.declarations.length === 1, "one local constant owns " + name);
      assert.equal(statement.declarationList.declarations[0].name.getText(parsed), name);
    }
    const controls = controlStatement.declarationList.declarations[0].initializer;
    assert.ok(controls && typescript.isObjectLiteralExpression(controls) && controls.properties.length === 1);
    const current = controls.properties[0];
    assert.ok(typescript.isPropertyAssignment(current) && current.name.getText(parsed) === "current"
      && typescript.isArrowFunction(current.initializer) && current.initializer.parameters.length === 0);
    const conjunction = current.initializer.body;
    assert.ok(typescript.isBinaryExpression(conjunction)
      && conjunction.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken,
    "Store custody requires both the original attempt and this admission");
    for (const [call, expression] of [[conjunction.left, "current"], [conjunction.right, "admission.current"]]) {
      assert.ok(typescript.isCallExpression(call) && call.arguments.length === 0);
      assert.equal(call.expression.getText(parsed), expression);
    }
    const awaited = resultStatement.declarationList.declarations[0].initializer;
    assert.ok(awaited && typescript.isAwaitExpression(awaited));
    const finalizer = awaited.expression;
    assert.ok(typescript.isCallExpression(finalizer) && typescript.isPropertyAccessExpression(finalizer.expression)
      && finalizer.expression.name.text === "finally" && finalizer.arguments.length === 1);
    const disposal = finalizer.arguments[0];
    assert.ok(typescript.isArrowFunction(disposal) && disposal.parameters.length === 0
      && typescript.isCallExpression(disposal.body) && disposal.body.arguments.length === 0);
    assert.equal(disposal.body.expression.getText(parsed), "admission.dispose",
      "the original Store Promise disposes admission before receipt handling");
    const selected = finalizer.expression.expression;
    assert.ok(typescript.isParenthesizedExpression(selected) && typescript.isConditionalExpression(selected.expression));
    const request = selected.expression;
    assert.equal(request.condition.getText(parsed), 'mode==="check"');
    for (const [call, expression] of [[request.whenTrue, "this.store.checkProjectIntake"], [request.whenFalse, "this.store.commitProjectIntake"]]) {
      assert.ok(typescript.isCallExpression(call));
      assert.equal(call.expression.getText(parsed), expression);
      assert.deepEqual([...call.arguments].map(argument => argument.getText(parsed)), ["attempt.brief.events", "controls"],
        "both modes retain the original event batch and the same conjoined controls");
    }
    assert.ok(typescript.isIfStatement(ownGuard) && typescript.isReturnStatement(ownGuard.thenStatement)
      && ownGuard.thenStatement.expression === undefined && ownGuard.elseStatement === undefined);
    assert.equal(ownGuard.expression.getText(parsed), "!current()",
      "only the retained own-current guard follows Store settlement, before the existing complete receipt");
  }
  assert.match(source, /\.label=\$\{this\.i18n\.system\("Document name"\)\}/);
  assert.match(source, /this\.i18n\.system\("What should remain with them\?"\)/);
  assert.match(source, /textarea rows="4" maxlength="12000"/);
  assert.match(source, /<fieldset \?disabled=\$\{Boolean\(this\.#intake\)\|\|this\.#submitting\}>/, "the advanced authored fields remain disabled for an original intake");
  assert.match(source, /this\.i18n\.system\("Exact value"\)/);
  assert.match(source, /max-length="500" \.value=\$\{this\.#intakeComposing\?noChange:this\.#protectedPhrase\}/);
  assert.match(source, /Boolean\(this\.#briefValues\(\)\.source\.trim\(\)&&!this\.#briefValues\(\)\.sourceRights\)/,
    "the current explicit brief or blank values retain the original source-rights admission");
  assert.match(source,/if\(this\.#submitting\|\|!this\.#creating\|\|this\.#intake\?\.confirmed\)return;/,"concurrent submissions and confirmed originals cannot create duplicate projects");
  const projects=parsed.statements.find(statement=>typescript.isClassDeclaration(statement)&&statement.name?.text==="FormaProjects");
  const method=name=>{const member=projects?.members.find(member=>member.name?.getText(parsed)===name);assert.ok(member);return member.getText(parsed);};
  assert.match(method("render"), /\$\{this\.#intake\?\.confirmed\?nothing:html`<button type="submit" class="button primary" \?disabled=\$\{this\.#submitting\|\|this\.#intakeComposing\|\|this\.#reviewOutcomeMissing\(\)\|\|!this\.#intake&&\(!this\.#name\.trim\(\)\|\|Boolean\(this\.#briefValues\(\)\.source\.trim\(\)&&!this\.#briefValues\(\)\.sourceRights\)\)\}>/,
    "the rendered Create/Retry button retains the complete submission, composition, missing-outcome, new-name and source-rights disabled guard");
  assert.equal(method("#reviewOutcomeMissing"), '#reviewOutcomeMissing(){return !this.#intake&&this.#intakePosture==="review"&&this.#intakeChoice==="brief"&&!this.#intakeComposing&&!this.#objective.trim();}',
    "only a new non-composing brief review requires an outcome; an original retry and the explicit blank path keep their own admission");
  const opening=method("#openCreate");
  assert.match(opening,/const opening=\{\};this\.#intakeOpening=opening;this\.#creating=true;/,"reopening preserves the draft under a fresh presentation owner");
  assert.match(opening,/this\.requestUpdate\(\);this\.#focusIntake\(false\);\n {2}\}$/,"the opening synchronously reuses the owned lease and retains normal native focus reveal");
  const openingFocus=method("#focusIntake");
  assert.equal(openingFocus, [
    '#focusIntake(preventScroll=true){',
    '    const opening=this.#intakeOpening,scope=this.#draftScopeKey(),source=this.store.captureSourceOwnership(),posture=this.#intakePosture;',
    '    const current=()=>this.isConnected&&this.#creating&&opening!==null&&this.#intakeOpening===opening&&this.#intakePosture===posture',
    '      &&Boolean(scope)&&this.#draftScope===scope&&this.#draftScopeKey()===scope&&this.store.sourceOwnershipActive(source);',
    '    const focus=captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus:element=>{',
    '      const dialog=this.querySelector<HTMLDialogElement>(".project-create-dialog");',
    '      const form=dialog?.querySelector<HTMLFormElement>("form.project-intake");',
    '      return current()&&Boolean(dialog?.contains(element))&&(element.matches(".modal-close")||element.matches("[data-intake-outcome]")',
    '        ||element===form&&element.closest("dialog")===dialog&&element.closest("forma-projects")===this);',
    '    }});',
    '    void this.updateComplete.then(()=>{',
    '      if(!current()||!focus.current())return;',
    '      const target=this.querySelector<HTMLElement>(this.#intake?".modal-close":posture==="intent"?"[data-intake-outcome]":"[data-intake-name] input");',
    '      if(target&&!target.matches(":disabled"))focus.run(target,()=>{target.focus({preventScroll});return true;});',
    '    }).finally(()=>focus.dispose());',
    '  }',
  ].join("\n"),"the reused method retains exact opening/posture/principal-scope/Source and newer-focus custody, modal-owned native allowance, enabled target and final disposal");
  const intake=method("#runIntake"),completeGuard="if(!complete){this.#intakeIssue=true;return;}",cleanup="this.#submitting=false;this.#intake=null;this.#draftScope=\"\";this.#clearDraft();";
  assert.ok(intake.includes(completeGuard)&&intake.includes(cleanup)&&intake.indexOf(completeGuard)<intake.indexOf(cleanup),"successful creation clears its retained draft only after the complete original receipt; separate custody retirement may discard private drafts");
});

test("the visible organization-package selection limit and the actual authoring guard both support 128 decisions",async()=>{
  const [store,library]=await Promise.all([
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/forma-library.ts",import.meta.url),"utf8"),
  ]);
  assert.match(store,/selection\.length>128/,"a legitimate 21st through 128th selected decision reaches the server");
  assert.doesNotMatch(store,/selection\.length>20/,"the former undisclosed 20-decision authoring ceiling never returns");
  assert.match(library,/workspace\.context\.selectionLimit","",\{count:this\.i18n\.number\(128\)\}/,
    "authors see the same localized limit that the creator and server actually enforce");
});
