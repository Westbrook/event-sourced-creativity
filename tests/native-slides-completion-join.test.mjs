import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";
import { nativeSlidesCompletionPath, nativeSlidesRetainedRoute } from "../src/model/native-slides-completion.ts";
import { parseNativeRetainedOutputRoute, nativeRetainedOutputRequestPath } from "../src/model/native-retained-output.ts";
import { readNativeSlidesCompletion, readNativeRetainedOutput } from "../src/model/retained-short-story-client.ts";

// Reuse the existing full component and real Store fixture without registering
// its Scene tests or replacing any production method. This remains a RAM join;
// an actual browser's Create-to-reader navigation is a separate proof.
const fixtureUrl = import.meta.resolve("./scene-cost-composer.test.mjs");
const fixtureSource = fs.readFileSync(new URL(fixtureUrl), "utf8");
const stop = fixtureSource.indexOf('for(const locale of ["en","fr","ar","ja"])');
assert.ok(stop > 0);
const virtual = fixtureUrl + "?native-slides-completion-join";
const fixtureHook = registerHooks({ load(url, context, next) {
  return url === virtual ? { format: "module", source: fixtureSource.slice(0, stop), shortCircuit: true } : next(url, context);
} });
const { createSceneComposer } = await import(virtual).finally(() => fixtureHook.deregister());

test("native Slides: saved Document and generic Create join one actual three-slide job to its exact retained read", async t => {
  const worker = await createSceneCostFixture(1, "visual");
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  h.store.patchUi({ instrumentation: false });
  const pending = new Set(), replies = [], providerCalls = [], forbiddenRequests = [];
  let f, declaredOutput;
  h.transport = async request => {
    const task = worker.request(request.url, request.init);
    pending.add(task);
    try {
      const response = await task;
      replies.push({ request, status: response.status, body: await response.clone().json() });
      return response;
    } finally { pending.delete(task); }
  };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).startsWith("/api/")) return h.fetch(url, init);
    if (String(url) !== "https://api.openai.com/v1/responses") {
      forbiddenRequests.push(String(url));
      throw new Error("No real network or other provider is allowed");
    }
    assert.ok(declaredOutput, "the deterministic complete result is declared before the Worker runs");
    const request = JSON.parse(init.body);
    providerCalls.push({ request, input: JSON.parse(request.input) });
    assert.equal(providerCalls.length, 1, "no provider retry or second mocked result");
    return Response.json({ id: "native-slides-join-response", model: "gpt-5.6-terra",
      output_text: JSON.stringify(declaredOutput), usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
  });
  t.after(async () => {
    while (pending.size) await Promise.allSettled([...pending]);
    await worker.drainBackground();
    if (f) { f.host.isConnected = false; f.host.disconnectedCallback(); f.i18n.hostDisconnected(); }
    await h.close();
    assert.deepEqual(forbiddenRequests, []);
  });

  const research = [
    { title: "Orchard irrigation", body: "The north orchard uses drip irrigation around the mature pear trees.", emphasis: "Water reaches the roots" },
    { title: "Archive indexing", body: "The town archive indexes handwritten maps by their original shelf marks.", emphasis: "Provenance stays legible" },
    { title: "Harbor maintenance", body: "The harbor workshop inspects wooden hulls before the fishing season.", emphasis: "Care protects the fleet" },
  ];
  const count = research.length;
  const savedText = research.map(item => `${item.body} ${item.emphasis}.`).join("\n\n");
  const jobCount = () => worker.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n;
  assert.equal(jobCount(), 0);
  const saved = await h.store.saveBlockText("scene-reuse-direction", savedText, "document-context-editor");
  assert.equal(saved.length, 1, "one actual acknowledged Document context Save");
  assert.equal(saved[0].type, "BlockPropertyEdited");
  assert.equal(saved[0].payload.new_value, savedText);
  assert.equal(h.store.projection.get().libraryBlocks.find(block => block.id === "scene-reuse-direction").properties.text, savedText);
  assert.equal(jobCount(), 0, "Save does not create a job");
  assert.equal(providerCalls.length, 0, "Save performs no provider work");

  f = await createSceneComposer(t, { storeHost: h });
  f.state.documentId = worker.documentId;
  assert.equal(await f.host.openRender("slides", worker.documentId, { current: () => f.state.canRead }), true);
  f.draw();
  await f.changeMode("manual");
  const countControl = f.renderer.ownNodes(f.host, "select").find(node => node.handlers.change);
  assert.ok(countControl, "the actual manual Slides count control");
  countControl.value = String(count);
  await countControl.handlers.change.call(f.host, { target: countControl, currentTarget: countControl });
  await f.flush();
  const create = f.renderer.ownNodes(f.host, "button").find(node => node.attributes.class === "button primary");
  assert.ok(create && !Object.hasOwn(create.attributes, "disabled"), "generic Slides Create is enabled");
  await f.submit();
  const deadline = performance.now() + 5000;
  while (!replies.some(reply => reply.request.body?.payload?.artifactKind === "slides") && performance.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  const admissions = replies.filter(reply => reply.request.url === "/api/document-jobs" && reply.request.body?.payload?.artifactKind === "slides");
  assert.equal(admissions.length, 1, "one actual generic Slides admission");
  const admission = admissions[0];
  assert.ok(admission.status === 200 || admission.status === 202, JSON.stringify(admission.body));
  const jobId = admission.body.job.jobId, submitted = admission.request.body.payload;
  assert.equal(admission.request.body.documentId, worker.documentId);
  assert.equal(admission.request.body.sourceSurface, "document");
  assert.equal(submitted.productionMode, "manual");
  assert.equal(submitted.itemCount, count);
  assert.equal(submitted.requestedSlideCount, count);
  assert.equal(submitted.slideCountPolicy, undefined);
  assert.equal(submitted.workflowId, undefined, "the fixture's Scene workflow is not used by generic Slides Create");
  const savedFact = submitted.snapshot.facts.find(fact => fact.block_id === "scene-reuse-direction");
  assert.equal(savedFact.properties.text, savedText);
  assert.ok(savedFact.source_event_refs.includes(saved[0].eventId), "the acknowledged Save is in the submitted source witness");
  assert.deepEqual(submitted.sourceBlockVersions, [{ block_id: "scene-reuse-direction", version: 2 }]);
  assert.equal(admission.body.job.documentRevision, submitted.documentRevision);
  assert.equal(jobCount(), 1);
  assert.equal(providerCalls.length, 0, "admission does not itself invoke the fixture provider");

  const contract = buildPresentationSourceContract(submitted.snapshot, { requestedSlideCount: count });
  const alias = contract.sources.find(source => source.sourceId === "scene-reuse-direction")?.alias;
  assert.ok(alias, "actual source contract supplies the local citation alias");
  const items = research.map((item, index) => ({ title: item.title, body: item.body, notes: "", image_prompt: "Native editable typography.", context_group_ids: [],
    slide: { layout: index === count - 1 ? "closing" : "statement", kicker: "", bullets: [], quote: null,
      citations: [{ source_id: alias, label: item.title, anchor: "Shared research", excerpt: item.body }], source_ids: [alias], section: null, source_order: index + 1,
      visual: { kind: "hero-type", label: "", value: item.emphasis, exact_value: null, display_value: null, unit: null, data: [] } } }));
  declaredOutput = { title: "Community stewardship", summary: "Distinct local practices support the places people share.",
    content_markdown: research.map(item => `## ${item.title}\n${item.body}\n${item.emphasis}`).join("\n\n"),
    presentation: { aspect_ratio: "16:9", theme: "Community evidence", footer_label: "Community stewardship", style_preset: "field-notes", mode: "light",
      palette: { background: "#edf1ef", foreground: "#14211d", accent: "#287260", muted: "#586b64", surface: "#d9e3df" } }, items };
  const run = await worker.run(jobId);
  assert.equal(run.response.status, 200, JSON.stringify(run.body));
  const job = worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(jobId);
  assert.equal(job.status, "completed", JSON.stringify(run.body));
  assert.equal(providerCalls.length, 1, "one declared deterministic Responses reply; no real provider");
  const recordedRequest = JSON.parse(job.request_json), result = JSON.parse(job.result_json);
  assert.equal(recordedRequest.itemCount, count);
  assert.equal(recordedRequest.requestedSlideCount, count);
  const completions = worker.sqlite.prepare("SELECT * FROM events WHERE correlation_id=? AND type='DocumentRenderCompleted'").all(job.correlation_id);
  assert.equal(completions.length, 1);
  const completed = JSON.parse(completions[0].payload);
  assert.equal(completed.artifact_kind, "slides");
  assert.equal(completed.artifact_id, result.artifactId);
  assert.equal(completed.item_count, count);
  assert.equal(completed.settings, undefined, "normal Worker events seal settings into their private payload");
  assert.equal(typeof completed._private_ref, "string", "the actual completion retains its sealed private payload reference");
  const raw = worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(completed.content_ref).content;
  const storedOutput = JSON.parse(raw), rawContentSha256 = createHash("sha256").update(raw).digest("hex");
  assert.equal(storedOutput.items.length, count);
  assert.deepEqual(storedOutput.items.map(item => [item.title, item.body]), research.map(item => [item.title, item.body]));

  const owner = worker.sqlite.prepare("SELECT user_id,email FROM users WHERE user_id=?").get(worker.owner);
  const trustedHeaders = { "oai-authenticated-user-id": owner.user_id, "oai-authenticated-user-email": owner.email };
  const jobsPath = "/api/document-jobs?document=" + encodeURIComponent(worker.documentId);
  const listBefore = await worker.request(jobsPath, { headers: trustedHeaders });
  assert.equal(listBefore.status, 200, await listBefore.clone().text());
  const observedJob = (await listBefore.json()).jobs.find(candidate => candidate.jobId === jobId);
  assert.ok(observedJob, "the actual completed original is initially present in the personal job feed");
  assert.equal(observedJob.status, "completed");
  assert.equal(observedJob.documentId, worker.documentId);
  const handle = Object.freeze({ documentId: observedJob.documentId, jobId: observedJob.jobId });
  const ack = await worker.request("/api/document-jobs/" + encodeURIComponent(jobId) + "/ack", { method: "POST", headers: trustedHeaders });
  assert.equal(ack.status, 200, await ack.clone().text());
  assert.deepEqual(await ack.json(), { ok: true });
  const listAfter = await worker.request(jobsPath, { headers: trustedHeaders });
  assert.equal(listAfter.status, 200, await listAfter.clone().text());
  assert.equal((await listAfter.json()).jobs.some(candidate => candidate.jobId === jobId), false,
    "the normal acknowledged completed render disappears from the personal feed");
  const acknowledgedJob = worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(jobId);
  assert.ok(Number.isFinite(Date.parse(acknowledgedJob.notified_at)), "the real ACK is recorded");
  assert.deepEqual({ ...acknowledgedJob, notified_at: job.notified_at, updated_at: job.updated_at }, { ...job },
    "ACK changes notification metadata, preserving the original completed request and result");
  const reads = [];
  const controls = { origin: "http://localhost", signal: new AbortController().signal, current: () => true,
    request: async (path, init) => {
      reads.push({ path, method: init.method });
      const headers = new Headers(init.headers);
      for (const [name, value] of Object.entries(trustedHeaders)) headers.set(name, value);
      const response = await worker.request(path, { ...init, headers });
      assert.equal(response.status, 200, await response.clone().text());
      // Direct Worker invocation lacks Fetch's final URL metadata; this transport
      // port supplies only that metadata, leaving response bytes and headers intact.
      Object.defineProperty(response, "url", { value: controls.origin + path });
      return response;
    } };
  const receipt = await readNativeSlidesCompletion(handle, controls);
  assert.deepEqual(receipt.handle, handle);
  const selection = { documentId: worker.documentId, artifactId: result.artifactId, revision: 0, contentSha256: rawContentSha256 };
  assert.deepEqual(receipt.selection, selection, "receipt binds revision zero and the exact saved raw bytes");
  const nativeRoute = nativeSlidesRetainedRoute(receipt, handle);
  assert.ok(nativeRoute.startsWith("/make/slides?"));
  const target = parseNativeRetainedOutputRoute(nativeRoute);
  assert.deepEqual(target, { output: "slides", selection });
  const dto = await readNativeRetainedOutput(target, controls);
  assert.equal(dto.output, "slides");
  assert.deepEqual(dto.selection, selection);
  assert.equal(dto.content.items.length, count);
  // The selection hashes the complete private source bytes; the reader returns
  // audience content without exposing private provenance or generation prompts.
  assert.deepEqual(dto.content.items.map(item => [item.title, item.body, item.notes, item.slide.layout, item.slide.visual.value]),
    research.map((item, index) => [item.title, item.body, "", index === count - 1 ? "closing" : "statement", item.emphasis]));
  for (const [index, item] of dto.content.items.entries()) {
    assert.equal(item.image_prompt, "");
    assert.equal(Object.hasOwn(item, "context_group_ids"), false);
    assert.equal(Object.hasOwn(item.slide, "sourceIds"), false);
    assert.deepEqual(item.slide.citations, [{ label: research[index].title, anchor: "Shared research", excerpt: "" }]);
  }
  assert.deepEqual(dto.content.presentation, storedOutput.presentation);
  assert.deepEqual(reads, [{ path: nativeSlidesCompletionPath(handle), method: "GET" }, { path: nativeRetainedOutputRequestPath(target), method: "GET" }]);
  assert.equal(providerCalls.length, 1, "completion and retained read perform no extra provider work");
  assert.equal(jobCount(), 1, "completion and retained read cannot create a replacement job");
  assert.deepEqual(worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(jobId), acknowledgedJob, "read path leaves the acknowledged completed original job unchanged");
  t.diagnostic(JSON.stringify({ scope: "Actual acknowledged Document Save, generic Slides composer/Create, production Store and Worker in RAM, deterministic mocked Responses reply, real completed feed observation and ACK/omission, exact completion client and retained read after ACK; native browser navigation remains unproven",
    savedEventId: saved[0].eventId, documentId: worker.documentId, jobId, jobStatus: job.status, artifactId: result.artifactId,
    completionEventId: completions[0].event_id, revision: 0, rawContentSha256, requestedSlideCount: count, returnedSlideCount: dto.content.items.length,
    actualJobCount: jobCount(), providerReplyCount: providerCalls.length, completedFeedObserved: true, acknowledgedFeedOmitted: true,
    completedReceiptValidAfterAck: true, nativeRoute, completionReceipt: receipt }));
});
