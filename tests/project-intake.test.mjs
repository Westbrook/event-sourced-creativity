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

  assert.match(source, /this\.store\.commitProjectIntake\(attempt\.brief\.events,\{current\}\)/);
  assert.match(source, /this\.store\.checkProjectIntake\(attempt\.brief\.events,\{current\}\)/);
  assert.match(source, /\.label=\$\{this\.i18n\.system\("Document name"\)\}/);
  assert.match(source, /this\.i18n\.system\("What should remain with them\?"\)/);
  assert.match(source, /textarea \?disabled=\$\{Boolean\(this\.#intake\)\} rows="4" maxlength="12000"/);
  assert.match(source, /this\.i18n\.system\("Exact value"\)/);
  assert.match(source, /max-length="500" \.value=\$\{this\.#protectedPhrase\}/);
  assert.match(source, /\?disabled=\$\{this\.#submitting\|\|!this\.#name\.trim\(\)\|\|Boolean\(this\.#source\.trim\(\)&&!this\.#sourceRights\)\}/);
  assert.match(source,/if\(this\.#submitting\|\|!this\.#creating\|\|this\.#intake\?\.confirmed\)return;/,"concurrent submissions and confirmed originals cannot create duplicate projects");
  const projects=parsed.statements.find(statement=>typescript.isClassDeclaration(statement)&&statement.name?.text==="FormaProjects");
  const method=name=>{const member=projects?.members.find(member=>member.name?.getText(parsed)===name);assert.ok(member);return member.getText(parsed);};
  const opening=method("#openCreate");
  assert.match(opening,/const opening=\{\};this\.#intakeOpening=opening;this\.#creating=true;/,"reopening preserves the draft under a fresh presentation owner");
  assert.match(opening,/captureOutputNavigationFocus\(this\.ownerDocument\)/,"the opening owns focus before render yields");
  assert.match(opening,/this\.#intakeOpening!==opening\|\|this\.#draftScopeKey\(\)!==scope/,"a later opening or changed custody cannot inherit focus");
  assert.match(opening,/!this\.store\.sourceOwnershipActive\(source\)/,"current Source remains required after render");
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
