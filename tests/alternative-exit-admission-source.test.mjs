import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Source admission contracts only: these do not certify native focus, route
// arrival, layout, Worker behavior or an exercised direct-exit gesture.
const source = fs.readFileSync(new URL("../src/components/forma-studio-alternatives.ts", import.meta.url), "utf8");
function region(start, end) {
  const at = source.indexOf(start); assert.ok(at >= 0, "Actual source region starts at " + start);
  assert.equal(source.indexOf(start, at + start.length), -1, "The intended owner region is unique");
  const stop = source.indexOf(end, at + start.length); assert.ok(stop > at);
  return source.slice(at, stop);
}
test("Alternative exit admission source / Board Shape influence reuses the existing owner admission", () => {
  assert.match(source, /import\s*\{[^}]*\bnavigateInApp\b[^}]*\}\s*from\s*"\.\/command-departure"/u);
  const board = region("export class FormaContextBoard extends AlternativeStudio {", "type BriefField =");
  const line = board.split("\n").filter(value => value.includes(">Shape influence "));
  assert.equal(line.length, 1, "The actual rendered Shape influence callback is unique");
  assert.match(line[0], /@click=\$\{\(\) => void navigateInApp\(this, navigation => navigation\.route\("\/studio\/layers"\)\)\}>Shape influence/u);
  assert.equal(line[0].includes("this.store.setRoute"), false, "No parallel raw Store route in this current callback");
  assert.match(line[0], /@click=\$\{\(\) => this\.#prepare\(nextLane\.starter\)\}>Prepare this decision/u,
    "The same-owner Prepare branch stays local rather than acquiring departure admission");
});
test("Alternative exit admission source / Guided gates only the actual fallback exit", () => {
  const guided = region("export class FormaGuidedBrief extends AlternativeStudio {", 'if (!customElements.get("forma-context-board"))');
  const lines = guided.split("\n").filter(value => value.includes("<button @click=") && value.includes("fieldSection >= 0"));
  assert.equal(lines.length, 1, "The actual whole-document map callback is unique");
  assert.match(lines[0], /@click=\$\{\(\) => fieldSection >= 0 \? this\.#goToStep\(fieldSection\) : void navigateInApp\(this, navigation => navigation\.route\("\/"\)\)\}>/u);
  assert.equal(lines[0].includes("this.store.setRoute"), false);
  const step = guided.slice(guided.indexOf("  #goToStep(step: number) {"), guided.indexOf("  async #saveSection(event: SubmitEvent) {"));
  assert.ok(step.includes("this.requestUpdate()")); assert.ok(step.includes("window.scrollTo"));
  assert.equal(step.includes("navigateInApp"), false, "Genuine same-owner section changes remain local");
});
