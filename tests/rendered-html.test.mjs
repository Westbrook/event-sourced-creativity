import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Forma application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Forma — An event-sourced creative studio<\/title>/i);
  assert.match(html, /Replaying the studio/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps the application event-sourced and the starter fully removed", async () => {
  const [workspace, model, route, layout, packageJson, decisions, previewFiles] = await Promise.all([
    readFile(new URL("../app/workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/event-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/events/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/decisions.ndjson", import.meta.url), "utf8"),
    readdir(new URL("../app/_sites-preview/", import.meta.url)),
  ]);

  assert.deepEqual(previewFiles, []);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|site-creator-vinext-starter/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview/);
  assert.match(layout, /Forma — An event-sourced creative studio/);

  assert.match(workspace, /Chat|Ask Forma/);
  assert.match(workspace, /CollectionTree/);
  assert.match(workspace, /ContextCompiled|action: "generate"/);
  assert.match(workspace, /ProposalAccepted/);
  assert.match(workspace, /prefers-reduced-motion|workspace/);
  assert.match(model, /foldEvents/);
  assert.match(model, /ChipEdited/);
  assert.match(model, /CollectionItemMoved/);

  assert.match(route, /actorCanAppend/);
  assert.match(route, /expectedSequence/);
  assert.match(route, /ValidationFailed/);
  assert.match(route, /compensates_event_id/);
  assert.doesNotMatch(route, /DirectionChosen/);

  const records = decisions.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(records.filter((record) => record.status === "human-required").length, 5);
  assert.equal(records.filter((record) => record.status === "accepted").length, 9);
});
