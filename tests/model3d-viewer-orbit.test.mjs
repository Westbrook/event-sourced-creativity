import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Spherical, Vector3 } from "three";

// Real shared viewer methods and button template with real Three camera math.
// Native GPU/gesture/layout behavior is covered separately by the local fixture.
const source = ts.createSourceFile("model3d-viewer.ts", readFileSync(new URL("../src/components/model3d-viewer.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaModel3dViewer");
const names = new Set(["#orbit", "#keyDown", "render"]);
const members = owner.members.filter(node => names.has(node.name?.getText(source)));
assert.equal(members.length, names.size, "use the actual current orbit, keyboard and render definitions");
const compiled = ts.transpileModule(`class ViewerControls {
  #runtime; #capturing = false; #loading = false; #failure = null; #background = "#ffffff"; #helpId = "fixture"; #captureFailed = false;
  disabled = false; readonly = true; label = ""; src = "/api/media/fixture.glb"; view = { camera: "unchanged authored view" }; draws = 0;
  i18n = { t: (_key, fallback) => fallback };
  constructor(runtime, capturing) { this.#runtime = runtime; this.#capturing = capturing; }
  #draw = () => { this.draws++; };
  #reset() { throw Error("Reset outside orbit test"); } #zoom() { throw Error("Zoom outside orbit test"); }
  #preset() { throw Error("Preset outside orbit test"); } #load() { throw Error("Load forbidden"); }
  #snapshot() { throw Error("Saving forbidden"); } #applyView() { throw Error("Saved view forbidden"); }
  #capture() { throw Error("Capture forbidden"); } #errorText() { return "Unavailable"; }
  keyboard(event) { return this.#keyDown(event); }
  ${members.map(node => node.getText(source).replace(/^override\s+/u, "")).join("\n")}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const ViewerControls = new Function("html", "nothing", `${compiled}; return ViewerControls;`)((strings, ...values) => ({ strings, values }), null);
function fixture({ disabled = false, capturing = false, absent = false } = {}) {
  let updates = 0;
  const runtime = { three: { Spherical }, camera: { position: new Vector3(2, 1, 3) }, controls: { target: new Vector3(.2, .1, -.1), update() { updates++; } } };
  const viewer = new ViewerControls(absent ? null : runtime, capturing); viewer.disabled = disabled;
  const render = viewer.render(), buttons = new Map();
  for (const [index, part] of render.strings.entries()) {
    if (part.endsWith("@click=") && typeof render.values[index + 1] === "string" && render.values[index + 1].startsWith("Orbit "))
      buttons.set(render.values[index + 1], render.values[index]);
  }
  return { viewer, runtime, buttons, updates: () => updates };
}
const directions = [["Orbit left", "ArrowLeft"], ["Orbit right", "ArrowRight"], ["Orbit up", "ArrowUp"], ["Orbit down", "ArrowDown"]];
const key = name => ({ key: name, altKey: false, metaKey: false, ctrlKey: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });

test("all four labeled tap buttons apply exactly the corresponding keyboard camera step", () => {
  for (const [label, arrow] of directions) {
    const tap = fixture(), keyboard = fixture(), initial = tap.runtime.camera.position.clone();
    assert.deepEqual([...tap.buttons.keys()], directions.map(([label]) => label));
    tap.buttons.get(label)(); const event = key(arrow); keyboard.viewer.keyboard(event);
    assert.ok(tap.runtime.camera.position.distanceTo(initial) > 0);
    assert.deepEqual(tap.runtime.camera.position.toArray(), keyboard.runtime.camera.position.toArray());
    assert.ok(Math.abs(tap.runtime.camera.position.distanceTo(tap.runtime.controls.target) - initial.distanceTo(tap.runtime.controls.target)) < 1e-12);
    assert.equal(tap.updates(), 1); assert.equal(tap.viewer.draws, 1); assert.equal(event.prevented, true); assert.equal(event.stopped, true);
    assert.deepEqual(tap.viewer.view, { camera: "unchanged authored view" }); assert.equal(tap.viewer.readonly, true);
  }
});

test("disabled, capturing and retired runtimes refuse both tap and keyboard steps", () => {
  for (const options of [{ disabled: true }, { capturing: true }, { absent: true }]) {
    const f = fixture(options), initial = f.runtime.camera.position.toArray();
    for (const [label, arrow] of directions) { f.buttons.get(label)(); f.viewer.keyboard(key(arrow)); }
    assert.deepEqual(f.runtime.camera.position.toArray(), initial); assert.equal(f.updates(), 0); assert.equal(f.viewer.draws, 0);
  }
});

test("modified native arrow keys retain browser ownership and repeated vertical steps stay finite", () => {
  const f = fixture(), initial = f.runtime.camera.position.toArray();
  for (const modifier of ["altKey", "metaKey", "ctrlKey"]) {
    const event = { ...key("ArrowLeft"), [modifier]: true }; f.viewer.keyboard(event); assert.equal(event.prevented, undefined);
  }
  assert.deepEqual(f.runtime.camera.position.toArray(), initial);
  for (let count = 0; count < 100; count++) f.buttons.get("Orbit up")();
  assert.ok(f.runtime.camera.position.toArray().every(Number.isFinite));
  assert.deepEqual(f.viewer.view, { camera: "unchanged authored view" });
});
