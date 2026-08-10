import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { exportArchive, importArchive } from "../src/model/archive.ts";
import { buildScenario } from "../src/model/scenarios.ts";
import { foldEvents } from "../src/model/events.ts";

test("uses Lit custom elements and the requested signal packages without React", async () => {
  const [pkg, main, shell, store, admin, files] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-admin-events.ts", import.meta.url), "utf8"),
    readdir(new URL("../src/components/", import.meta.url)),
  ]);
  assert.doesNotMatch(pkg, /"react"|"react-dom"|vinext|@vitejs\/plugin-react/);
  assert.match(pkg, /"lit"/); assert.match(pkg, /"signal-polyfill"/); assert.match(pkg, /"signal-utils"/);
  assert.match(main, /forma-shell/); assert.match(shell, /customElements\.define/);
  assert.match(store, /new Signal\.State/); assert.match(store, /new SignalObject/);
  assert.match(admin, /50000|50,000/); assert.match(admin, /Replay laboratory/);
  assert.ok(files.filter((file) => file.endsWith(".ts")).length >= 9);
});

test("builds and replays theoretical long streams deterministically", () => {
  const first = buildScenario("creative-loop", 10_000);
  const second = buildScenario("creative-loop", 10_000);
  assert.equal(first.length, 10_000); assert.deepEqual(first, second);
  assert.equal(first[0].sequence, 1); assert.equal(first.at(-1).sequence, 10_000);
  const halfway = foldEvents(first, 5_000); const final = foldEvents(first);
  assert.ok(final.blocks.length >= halfway.blocks.length);
  assert.ok(final.outputs.length >= halfway.outputs.length);
});

test("round-trips a lossless Forma event archive", () => {
  const events = buildScenario("promotion", 100);
  const archive = exportArchive(events);
  const imported = importArchive(JSON.parse(JSON.stringify(archive)));
  assert.deepEqual(imported.events, events);
  assert.equal(imported.format, "forma-event-archive");
});

test("packages a responsive SPA and Sites metadata", async () => {
  const [html, css, hosting] = await Promise.all([
    readFile(new URL("../dist/client/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../dist/.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Forma — An event-sourced creative studio/);
  assert.match(html, /forma-shell/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(hosting, /appgprj_/);
});

test("enforces the adopted production-pilot boundaries", async () => {
  const [policy, adapter, shares, media, shell, schema, envExample] = await Promise.all([
    readFile(new URL("../worker/pilot-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/openai-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/shares-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/media-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-shell.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(policy, /oai-authenticated-user-id/); assert.match(policy, /cf-access-authenticated-user-email/);
  assert.match(policy, /pilot_terms_required/); assert.match(policy, /reserved_tokens/); assert.match(policy, /250_000/); assert.match(policy, /2_500_000/);
  assert.match(adapter, /api\.openai\.com\/v1\/responses/); assert.match(adapter, /store: false/); assert.match(adapter, /safety_identifier/);
  assert.match(shares, /expiresHours/); assert.match(shares, /ShareLinkRevoked/); assert.match(shares, /token_hash/);
  assert.match(media, /rightsConfirmed/); assert.match(shell, /acceptTerms/); assert.match(shell, /forma-shared-view/);
  assert.match(schema, /private_content/); assert.match(schema, /budget_counters/); assert.match(envExample, /OPENAI_API_KEY=/);
});

test("records the accepted provider debt and makes the extractor gate operational", async () => {
  const [decisions, coverage, eventsApi, store, system, classification] = await Promise.all([
    readFile(new URL("../docs/decisions.ndjson", import.meta.url), "utf8"),
    readFile(new URL("../docs/plan-coverage.md", import.meta.url), "utf8"),
    readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-system.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/event-classification.csv", import.meta.url), "utf8"),
  ]);
  assert.match(decisions, /D-0019.*accepted-debt.*second adapter/);
  assert.match(coverage, /Phase 3.*executable 10% correction-rate gate/);
  assert.match(eventsApi, /evaluate_extractors/); assert.match(eventsApi, /extract_reference/);
  assert.match(store, /evaluateExtractors/); assert.match(system, /Extractor quality gate/);
  assert.match(classification, /ExtractorEvaluationCompleted,operational/);
});

test("runs the Phase 6 pilot from event-derived sessions instead of brief fixtures", async () => {
  const [eventsApi, store, sessions, briefModel] = await Promise.all([
    readFile(new URL("../worker/events-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/state/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-sessions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/model/brief.ts", import.meta.url), "utf8"),
  ]);
  assert.match(eventsApi, /open_session/); assert.match(eventsApi, /close_session/); assert.match(eventsApi, /compose_brief/); assert.match(eventsApi, /declare_intent/);
  assert.doesNotMatch(eventsApi, /brief-today/);
  assert.match(store, /composeBrief/); assert.match(sessions, /event-derived/); assert.match(sessions, /Dosage curve/);
  assert.match(briefModel, /PHASE6_MIN_CLOSED_SESSIONS/); assert.match(briefModel, /rejectedPathMemory/); assert.match(briefModel, /phase6GateMetrics/);
});
