import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { documentJobCompletionBindings } from "../../worker/document-job-sql.ts";
import { MODEL3D_PRIVATE_CHECKPOINT_KEYS, MODEL3D_TERMINAL_RESULT_SQL, model3dNativeCheckpoint } from "../../worker/output-model3d-terminal.ts";

// Execute the actual terminal/outcome SQL without importing the application's
// HTTP/bootstrap graph. Only unrelated serialization presentation ports are stubbed.
const ts = createRequire(import.meta.resolve("../../worker/runtime.ts"))("typescript");
const jobSource = fs.readFileSync(new URL(import.meta.resolve("../../worker/document-jobs-api.ts")), "utf8");
const controlSource = fs.readFileSync(new URL(import.meta.resolve("../../worker/output-execution-control.ts")), "utf8");
function declarations(source, names) {
  const ast = ts.createSourceFile("module.ts", source, ts.ScriptTarget.Latest, true), found = new Map();
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.set(node.name.text, node.getText(ast).replace(/^export\s+/u, ""));
    if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations)
      if (ts.isIdentifier(d.name) && names.includes(d.name.text)) found.set(d.name.text, "const " + d.getText(ast) + ";");
  }
  assert.equal(found.size, names.length, "exact existing source declarations");
  return [...found.values()].join("\n");
}
export function terminalSource({ withoutModel3dPreservation = false } = {}) {
  let source = declarations(jobSource, ["parseRequest", "parentJobIdFromRequest", "finishDocumentJob", "PRESERVE_ADAPTIVE_RECEIPT_SQL", "OUTPUT_STORYBOARD_RETAINED_CHECKPOINT_KEYS", "OUTPUT_VIDEO_RETAINED_CHECKPOINT_KEYS"])
    + "\n" + declarations(controlSource, ["prepareOutputJobOutcomeStatements"]);
  if (withoutModel3dPreservation) {
    const branch = "row.output_slot_id&&model3dNativeCheckpoint(parseRequest(row))?MODEL3D_TERMINAL_RESULT_SQL:";
    assert.equal(source.split(branch).length, 2);
    source = source.replace(branch, ""); // Explicit before-fix counterfactual; not a second runtime.
  }
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("documentJobCompletionBindings", "MODEL3D_TERMINAL_RESULT_SQL", "model3dNativeCheckpoint", compiled + "\nreturn finishDocumentJob;")(
    documentJobCompletionBindings, MODEL3D_TERMINAL_RESULT_SQL, model3dNativeCheckpoint);
}
export function serializeTerminalSource(row) {
  const source = declarations(jobSource, ["parseRequest", "parseResult", "parentJobIdFromRequest", "serializeJob"]);
  const ports = { MODEL3D_PRIVATE_CHECKPOINT_KEYS, model3dNativeCheckpoint,
    OUTPUT_STORYBOARD_RETAINED_CHECKPOINT_KEYS: [], OUTPUT_VIDEO_RETAINED_CHECKPOINT_KEYS: [], generationRequestIdentity: () => ({}), sceneConfigurationFromRequest: () => null,
    queueRecoveryPresentation: () => null, errorDetailFromResult: () => null, model3dRecoveryProviderReceipt: () => { throw Error("Private original must not be reintroduced"); },
    consentedAdaptiveJob: () => false, certifiedAdaptiveRows: new WeakSet(), fanKindFromRequest: () => null };
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(ports), compiled + "\nreturn serializeJob;")(...Object.values(ports))(row, null, true);
}

export function referenceContinuationSource(ports) {
  const source = fs.readFileSync(new URL(import.meta.resolve("../../worker/experience-model3d-reference-source.ts")), "utf8");
  const selected = declarations(source, ["fail", "prepareExperienceModel3dReference"]);
  const compiled = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(ports), compiled + "\nreturn prepareExperienceModel3dReference;")(...Object.values(ports));
}

export function emittedModel3dCompletionSource(ports, { omitNativeMode = false } = {}) {
  const source = fs.readFileSync(new URL(import.meta.resolve("../../worker/model3d-render.ts")), "utf8");
  const ast = ts.createSourceFile("renderer.ts", source, ts.ScriptTarget.Latest, true), matches = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "completed"
      && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "makeEvent"
      && node.initializer.arguments[5]?.getText(ast) === '"DocumentRenderCompleted"') matches.push(node.initializer.arguments[6].getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(matches.length, 1, "actual emitted Model3D completion body");
  let expression = matches[0];
  if (omitNativeMode) {
    const marker = 'production_mode: "manual", output_model3d: nativeCompletion';
    assert.equal(expression.split(marker).length, 2); expression = expression.replace(marker, "output_model3d: nativeCompletion");
  }
  const compiled = ts.transpileModule("const payload = " + expression + ";", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(ports), compiled + "\nreturn payload;")(...Object.values(ports));
}
