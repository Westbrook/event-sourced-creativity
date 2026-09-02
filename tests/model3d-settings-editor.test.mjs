import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { html, nothing } from "lit";
import ts from "typescript";
import * as contract from "../src/model/model3d.ts";

const source = ts.createSourceFile("model3d-settings-editor.ts", readFileSync(new URL("../src/components/model3d-settings-editor.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const editorClass = source.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "Model3dSettingsEditor");
assert.ok(editorClass, "load the actual editor class");
const compiled = ts.transpileModule(editorClass.getText(source).replace(/^export /u, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, useDefineForClassFields: false },
}).outputText;

// Exercise the actual class with real Lit templates and the shared provider contract.
// Only the application-connected host and localization port are replaced.
function fixture() {
  const emitted = [];
  class FormaElement {
    i18n = {
      t: (_key, fallback = "", values = {}) => fallback.replace(/\{(\w+)\}/gu, (_, key) => String(values[key] ?? "")),
      number: (value, options) => new Intl.NumberFormat("en", options).format(value),
      system: (value) => value,
    };
    willUpdate() {}
    updated() {}
    dispatchEvent(event) { emitted.push(event); return true; }
  }
  class CustomEvent {
    constructor(type, options) { this.type = type; Object.assign(this, options); }
  }
  const ports = { FormaElement, CustomEvent, html, nothing, ...contract, localizedModel3dValidationIssue: (issue) => issue.message };
  const Editor = new Function(...Object.keys(ports), `${compiled}\nreturn Model3dSettingsEditor;`)(...Object.values(ports));
  const editor = new Editor();
  const flush = () => {
    const changed = new Map([["settings", undefined], ["prompt", undefined], ["referenceCount", undefined]]);
    editor.willUpdate(changed);
    editor.updated(changed);
  };
  const control = (name) => namedControl(editor.render(), name);
  const change = (name, value) => {
    const field = control(name);
    const handler = field.attributes.get("@input") ?? field.attributes.get("@change");
    assert.equal(typeof handler, "function", `${name} has an actual input handler`);
    handler.call(editor, { currentTarget: { value, checked: value === true } });
    flush();
  };
  const latest = () => emitted.at(-1)?.detail;
  const echo = () => { editor.settings = structuredClone(latest().settings); flush(); };
  flush();
  return { editor, emitted, flush, control, change, latest, echo };
}

function* templates(value) {
  if (Array.isArray(value)) { for (const item of value) yield* templates(item); return; }
  if (!value || typeof value !== "object" || !Array.isArray(value.strings) || !Array.isArray(value.values)) return;
  yield value;
  for (const item of value.values) yield* templates(item);
}

/** Resolve the attributes of rendered controls, preserving callback identity and values. */
function namedControl(root, name) {
  const found = [];
  for (const template of templates(root)) {
    const markup = template.strings.map((part, index) => part + (index < template.values.length ? `__LIT_VALUE_${index}__` : "")).join("");
    for (const tag of markup.matchAll(/<(input|textarea|select)\b([^>]*)>/gu)) {
      const attributes = new Map();
      for (const attribute of tag[2].matchAll(/([@.?]?[\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)) {
        const raw = attribute[2] ?? attribute[3] ?? attribute[4] ?? true;
        const marker = typeof raw === "string" ? /^__LIT_VALUE_(\d+)__$/u.exec(raw) : null;
        attributes.set(attribute[1], marker ? template.values[Number(marker[1])] : raw);
      }
      if (attributes.get("name") === name) found.push({ tag: tag[1], attributes });
    }
  }
  assert.equal(found.length, 1, `exactly one rendered control named ${name}`);
  return found[0];
}

test("the exact prompt preserves 1,025 Unicode code points and accepts 1,024 emoji", () => {
  const h = fixture();
  const overlong = "😀".repeat(1025);
  h.change("model3d_prompt", overlong);
  assert.equal(h.editor.prompt, overlong);
  assert.equal(h.latest().prompt, overlong);
  assert.equal(h.latest().valid, false);
  assert.equal(h.control("model3d_prompt").attributes.get(".value"), overlong);
  assert.equal(h.control("model3d_prompt").attributes.has("maxlength"), false);
  const accepted = "😀".repeat(1024);
  h.change("model3d_prompt", accepted);
  assert.equal(h.latest().prompt, accepted);
  assert.equal(h.latest().valid, true);
  assert.equal(h.emitted.at(-1).type, "model3d-settings-change");
  assert.equal(h.emitted.at(-1).bubbles, true);
  assert.equal(h.emitted.at(-1).composed, true);
});

test("empty prompts are optional with images and invalid again when all references are removed", () => {
  const h = fixture();
  assert.equal(h.latest().valid, false);
  h.editor.referenceCount = 1;
  h.flush();
  assert.equal(h.latest().valid, true);
  assert.equal(h.control("model3d_prompt").attributes.get("?required"), false);
  h.editor.referenceCount = 0;
  h.flush();
  assert.equal(h.latest().valid, false);
  assert.equal(h.control("model3d_prompt").attributes.get("?required"), true);
});

test("unknown authored formats remain visible as invalid settings until explicitly changed", () => {
  const h = fixture();
  h.change("model3d_prompt", "A small ceramic vase");
  h.editor.settings = { ...h.editor.settings, geometry_file_format: "unsupported-format" };
  h.flush();
  assert.equal(h.latest().settings.geometry_file_format, "unsupported-format");
  assert.equal(h.latest().valid, false);
  assert.equal(h.control("geometry_file_format").attributes.get(".value"), "unsupported-format");
  assert.equal(h.control("geometry_file_format").attributes.get("aria-invalid"), "true");
  h.change("geometry_file_format", "glb");
  assert.equal(h.latest().valid, true);
});

test("invalid seed drafts survive parent updates and can be corrected or cleared", () => {
  const h = fixture();
  h.change("model3d_prompt", "A small ceramic vase");
  h.change("seed", "1.5");
  assert.equal(h.latest().valid, false);
  assert.equal(h.latest().settings.seed, 1.5);
  h.echo();
  assert.equal(h.control("seed").attributes.get(".value"), "1.5");
  h.change("seed", "1e");
  assert.equal(h.latest().valid, false);
  assert.ok(Number.isNaN(h.latest().settings.seed));
  h.echo();
  assert.equal(h.control("seed").attributes.get(".value"), "1e");
  h.change("seed", "42");
  assert.equal(h.latest().valid, true);
  assert.equal(h.latest().settings.seed, 42);
  h.change("seed", "");
  assert.equal(h.latest().valid, true);
  assert.equal(h.latest().settings.seed, null);
});

test("incomplete bounding-box text stays raw and invalid until all dimensions are complete", () => {
  const h = fixture();
  h.change("model3d_prompt", "A small ceramic vase");
  h.change("bbox_enabled", true);
  h.change("bbox_condition.width", "-");
  assert.equal(h.latest().valid, false);
  assert.ok(Number.isNaN(h.latest().settings.bbox_condition.width));
  h.echo();
  assert.equal(h.control("bbox_condition.width").attributes.get(".value"), "-");
  h.change("bbox_condition.width", "2");
  assert.equal(h.latest().valid, true);
  h.change("bbox_condition.height", "");
  assert.equal(h.latest().valid, false);
  h.echo();
  assert.equal(h.control("bbox_condition.height").attributes.get(".value"), "");
  h.change("bbox_enabled", false);
  assert.equal(h.latest().valid, true);
  assert.equal(h.latest().settings.bbox_condition, null);
  h.change("bbox_enabled", true);
  assert.equal(h.latest().valid, false);
  assert.equal(h.control("bbox_condition.height").attributes.get(".value"), "");
  h.change("bbox_condition.height", "3");
  assert.equal(h.latest().valid, true);
  assert.deepEqual(h.latest().settings.bbox_condition, { width: 2, height: 3, length: 1 });
});

test("disabled editor callbacks cannot mutate settings, prompt, or emit a change", () => {
  const h = fixture();
  h.change("model3d_prompt", "A small ceramic vase");
  const settings = structuredClone(h.editor.settings);
  const prompt = h.editor.prompt;
  const count = h.emitted.length;
  h.editor.disabled = true;
  h.change("model3d_prompt", "Changed while disabled");
  h.change("seed", "7");
  h.change("tier", "Gen-2.5-Low");
  h.change("enable_creative_mode", true);
  h.change("addons.high_pack", true);
  h.change("bbox_enabled", true);
  assert.equal(h.editor.prompt, prompt);
  assert.deepEqual(h.editor.settings, settings);
  assert.equal(h.control("seed").attributes.get(".value"), "");
  assert.equal(h.emitted.length, count);
});
