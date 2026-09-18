import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { formaSystemMessageId } from "../src/components/design-system/system-message-id.ts";
import { model3dTermIsInterfaceCopy } from "../src/experiences/model3d-native-copy.ts";
const ts = createRequire(import.meta.resolve("../worker/runtime.ts"))("typescript");
const copy = [
  "3D model",
  "1 static GLB · Structure checked; visual review required",
  "1 static GLB assembly · One requested object",
  "One Rodin request for a static GLB. Static assembly checks do not prove one semantic object or visual quality. Charges may remain if validation fails. Original mesh bytes are not transferred.",
  "Approve this exact 3D request and its displayed maximum cost",
  "Create 3D model",
  "1 static GLB assembly",
  "1 Rodin request · No planner or automatic retry",
  "One requested object; structural checks do not prove semantic object count",
  "1 owned image or saved PNG view; no mesh transfer",
  "Gen-2.5-High · GLB · Auto mesh · No HD pack",
  "Static rooted assembly, not semantic-object or visual-quality acceptance",
  "GLB · Static rooted assembly",
  "Structural checks do not prove semantic object count or visual quality. Inspect the resulting model.",
  "The displayed Document-derived prompt, fixed settings and listed owned image or saved PNG view go to fal.ai / Hyper3D Rodin; original mesh bytes are not transferred",
  "Generation calls",
  "Subject",
  "Original job",
  "Exact reference SHA-256",
  "Reference bytes",
  "Reference type",
  "Submitted prompt",
  "Settings",
  "Result review",
  "After uncertain response",
  "No additional paid request",
  "Reference files",
  "Maximum spend",
  "Check status",
  "Edit in Forma",
  "Open in Forma",
  "Resume",
  "Checking Document",
  "Operation unconfirmed",
  "Document unavailable",
  "Original unavailable",
  "Recording",
  "Submission unconfirmed",
  "Checking status",
  "Result unavailable",
  "Source changed",
  "Preparation recorded",
  "Authorized",
  "Queued",
  "Creating",
  "Completed operation",
  "Partial",
  "Unconfirmed",
  "Closed",
  "Failed",
  "Cancelled",
  "Output",
  "Outputs",
  "None",
  "Source files",
  "Approval deadline"
];
const added = new Set([
  "3D model",
  "1 static GLB · Structure checked; visual review required",
  "1 static GLB assembly · One requested object",
  "One Rodin request for a static GLB. Static assembly checks do not prove one semantic object or visual quality. Charges may remain if validation fails. Original mesh bytes are not transferred.",
  "Approve this exact 3D request and its displayed maximum cost",
  "Create 3D model",
  "1 static GLB assembly",
  "1 Rodin request · No planner or automatic retry",
  "One requested object; structural checks do not prove semantic object count",
  "1 owned image or saved PNG view; no mesh transfer",
  "Gen-2.5-High · GLB · Auto mesh · No HD pack",
  "Static rooted assembly, not semantic-object or visual-quality acceptance",
  "GLB · Static rooted assembly",
  "Structural checks do not prove semantic object count or visual quality. Inspect the resulting model.",
  "The displayed Document-derived prompt, fixed settings and listed owned image or saved PNG view go to fal.ai / Hyper3D Rodin; original mesh bytes are not transferred",
  "Generation calls",
  "Original job",
  "Exact reference SHA-256",
  "Reference bytes",
  "Reference type",
  "Settings",
  "Result review",
  "After uncertain response",
  "No additional paid request",
  "Reference files",
  "Maximum spend",
  "Check status",
  "Edit in Forma",
  "Open in Forma",
  "Checking Document",
  "Operation unconfirmed",
  "Document unavailable",
  "Original unavailable",
  "Recording",
  "Submission unconfirmed",
  "Checking status",
  "Result unavailable",
  "Source changed",
  "Preparation recorded",
  "Authorized",
  "Queued",
  "Creating",
  "Completed operation",
  "Partial",
  "Unconfirmed",
  "Closed",
  "Failed",
  "Cancelled",
  "Outputs"
]);

test("Model3D interface additions have unique stable keys and exact four-locale catalog entries", () => {
  const keys = new Set(copy.map(formaSystemMessageId));
  assert.equal(keys.size, copy.length);
  for (const locale of ["en", "fr", "ar", "ja"]) {
    const source = fs.readFileSync(new URL(import.meta.resolve(`../src/components/design-system/locales/system-${locale}.ts`)), "utf8");
    const ast = ts.createSourceFile("catalog.ts", source, ts.ScriptTarget.Latest, true), entries = new Map();
    const visit = node => {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && keys.has(node.name.text)) {
        assert.ok(ts.isStringLiteral(node.initializer), "scoped catalog value is literal text");
        const values = entries.get(node.name.text) ?? [];
        values.push(node.initializer.text); entries.set(node.name.text, values);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    for (const text of copy) {
      const values = entries.get(formaSystemMessageId(text));
      assert.ok(values?.length && values.every(value => value.trim().length > 0), locale + ": " + text);
      if (added.has(text)) assert.equal(values.length, 1, "new key is not duplicated: " + locale + ": " + text);
      if (locale === "en") assert.equal(values.at(-1), text);
    }
  }
});

test("Model3D translation is confined to system rows, preserving authored and technical literals", () => {
  for (const value of ["1 static GLB assembly","1 Rodin request · No planner or automatic retry","One requested object; structural checks do not prove semantic object count","1 owned image or saved PNG view; no mesh transfer","None","Gen-2.5-High · GLB · Auto mesh · No HD pack","Static rooted assembly, not semantic-object or visual-quality acceptance","No additional paid request"]) {
    assert.equal(model3dTermIsInterfaceCopy({ label: "Submitted prompt", value }), false);
    for (const label of ["Model", "Original job", "Exact reference SHA-256", "Reference type"])
      assert.equal(model3dTermIsInterfaceCopy({ label, value }), false, label);
  }
  assert.equal(model3dTermIsInterfaceCopy({ label: "Output", value: "1 static GLB assembly" }), true);
  assert.equal(model3dTermIsInterfaceCopy({ label: "Source files", value: "None" }), true);
  for (const value of ["<b>literal</b> مرحباً 日本語", "fal-ai/hyper3d/rodin/v2", "a".repeat(64), "image/png"])
    assert.equal(model3dTermIsInterfaceCopy({ label: "Source files", value }), false);
  const host = fs.readFileSync(new URL(import.meta.resolve("../src/components/forma-experience-host.ts")), "utf8");
  assert.match(host, /return output === "model3d" \? this\.i18n\.system\(value\) : value;/u);
  assert.match(host, /model3d && model3dTermIsInterfaceCopy\(row\) \? this\.i18n\.system\(row\.value\) : row\.value/u);
  assert.ok(host.includes('this.i18n.system("Approve this exact 3D request and its displayed maximum cost")'));
  assert.ok(host.includes('this.i18n.system("Create 3D model")'));
  assert.ok(host.includes('this.#model3dText(this.#status)'));
});
