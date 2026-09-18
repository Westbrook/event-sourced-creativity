import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
import { createOutputFalImageContract, readOutputFalImageContract, outputFalImageCost,
  captureOutputFalImageRequest, submitOutputFalImageRequest } from "../worker/output-fal-image-contract.ts";
import { preflightOutputImageSlidesTarget } from "../worker/output-image-slides-preflight.ts";

// Pure quote/serializer/dispatch-hook tests. No DB, paid admission, provider
// response or completed artifact is supplied. Configuration values are inert.
const fetchBefore = globalThis.fetch;
let fetches = 0;
globalThis.fetch = () => { fetches++; throw new Error("network_forbidden"); };
after(() => { globalThis.fetch = fetchBefore; assert.equal(fetches, 0); });
const contract = () => createOutputFalImageContract("ideogram/v4", "1024x1024");
const input = (prompt = "A copper lamp.") => ({ prompt, expansion_model: "Large", image_size: { width: 1024, height: 1024 },
  rendering_speed: "QUALITY", acceleration: "none", num_images: 1, sync_mode: false, enable_safety_checker: true, output_format: "png" });
const behavior = c => ({ promptMode: c.promptMode, promptAdapterVersion: c.promptAdapterVersion, captionStrategy: c.captionStrategy, adapterVersion: c.adapterVersion });
const capture = (body = input(), c = contract()) => captureOutputFalImageRequest(c, c.model, body, behavior(c), "original-call");

test("finite Fal quote uses published pixel/expansion pricing and rejects unknown contracts", () => {
  const c = contract(); assert.ok(c); assert.ok(Object.isFrozen(c));
  assert.equal(c.imageOutputMicrousd, 104858); assert.equal(c.expansionMicrousd, 30000);
  assert.equal(c.estimatedMicrousd, 134858); assert.equal(c.maximumMicrousd, 900000);
  assert.equal(outputFalImageCost(c).totalMicrousd, c.estimatedMicrousd);
  for (const model of ["ideogram/v4/fast", "ideogram/v4/image-to-image", "unknown", "ideogram/v4 "]) assert.equal(createOutputFalImageContract(model, "1024x1024"), null);
  for (const size of ["1023x1024", "0x1024", "4096x1024", "512xInfinity", "01024x1024"]) assert.equal(createOutputFalImageContract("ideogram/v4", size), null);
  for (const changed of [{ ...c, model: "other" }, { ...c, pricingVersion: "old" }, { ...c, estimatedMicrousd: 0 }, { ...c, extra: true }]) assert.equal(readOutputFalImageContract(changed), null);
});

test("request digest binds the exact adapted body, model and frozen settings", async () => {
  const c = await capture(); assert.ok(Object.isFrozen(c)); assert.ok(Object.isFrozen(c.attempt));
  assert.deepEqual(JSON.parse(c.body), input());
  const hash = createHash("sha256").update(JSON.stringify({ contract: c.contract, body: c.body })).digest("hex");
  assert.equal(c.attempt.requestDigest, hash);
  assert.equal(c.attempt.logicalCallKey, "image:initial"); assert.equal(c.attempt.clientRequestId, "original-call");
  assert.equal(c.attempt.maximumInputTokens, 0); assert.equal(c.attempt.maximumOutputTokens, 0);
  assert.equal(c.attempt.falImage, c.contract);
  assert.notEqual((await capture(input("A blue lamp."))).attempt.requestDigest, hash);
});

test("unquoted request options, references, versions and formats cannot enter the dispatch boundary", async () => {
  for (const change of [b => { b.seed = 1; }, b => { b.image_url = "data:inert"; }, b => { b.image_size.width = 1536; },
    b => { b.output_format = "jpeg"; }, b => { b.expansion_model = "None"; }, b => { b.rendering_speed = "BALANCED"; },
    b => { b.acceleration = "high"; }, b => { b.num_images = 2; }, b => { b.enable_safety_checker = false; }, b => { b.sync_mode = true; },
    b => { b.prompt = " "; }, b => { b.prompt = "x".repeat(4001); }]) {
    const b = input(); change(b); await assert.rejects(capture(b), /output_fal_request_outside_contract/);
  }
  const c = contract();
  await assert.rejects(captureOutputFalImageRequest(c, "other", input(), behavior(c), "original-call"));
  await assert.rejects(captureOutputFalImageRequest(c, c.model, input(), { ...behavior(c), promptAdapterVersion: "old" }, "original-call"));
});

function quoteInput() {
  return { env: { OPENAI_API_KEY: "inert-not-a-credential", FAL_KEY: "inert-not-a-credential", FORMA_IMAGE_PROVIDER: "fal-ideogram", FAL_IMAGE_MODEL: "ideogram/v4" },
    target: { id: "target", label: "Image", selected: true, blocking_issues: [], source_scope: { kind: "document" },
      media_kind: "image", aspect_ratio: { width: 1, height: 1 }, coverage: { kind: "document_context" }, instruction_text: "1 image" },
    context: { snapshot: { facts: [{ block_id: "subject", type: "subject", active: true, properties: { text: "A copper lamp", weight: 1 } }] } } };
}
test("current Fal settings produce a finite native quote; missing key/model and pixel references refuse", async () => {
  const q = await preflightOutputImageSlidesTarget(quoteInput());
  assert.equal(q.available, true); assert.equal(q.provider, "fal"); assert.equal(q.model, "ideogram/v4");
  assert.equal(q.route, "document-image-fal-manual-v1"); assert.equal(q.maximumCalls, 2);
  assert.deepEqual(q.settings.payload.outputFalImage, contract());
  assert.equal(q.settings.calls[1].maximumMicrousd, contract().maximumMicrousd);
  assert.deepEqual(q.settings.imageRender.format.dimensions, { width: 1024, height: 1024, unit: "px" });
  for (const edit of [f => { delete f.env.FAL_KEY; }, f => { f.env.FAL_IMAGE_MODEL = "unknown"; },
    f => { f.context.snapshot.facts.push({ block_id: "reference", type: "reference", active: true, properties: { weight: 1, pixel_reference_mode: "preserve_subject" } }); }]) {
    const f = quoteInput(); edit(f); const refused = await preflightOutputImageSlidesTarget(f);
    assert.equal(refused.available, false); assert.equal(refused.maximumCalls, 0); assert.equal(refused.provider, null);
  }
});

test("paid POST follows awaited native claim and pending checkpoint, then the synchronous final gate", async () => {
  const c = await capture(), order = []; let release;
  const pending = new Promise(resolve => { release = resolve; });
  const work = submitOutputFalImageRequest(c, { beforeAttempt: async a => { assert.equal(a, c.attempt); order.push("claim"); },
    checkpoint: async retained => { assert.equal(retained, c); order.push("checkpoint"); },
    pending: async r => { assert.equal(r.clientRequestId, "original-call"); order.push("pending"); await pending; },
    beforeDispatch: id => { assert.equal(id, "original-call"); order.push("gate"); } }, async body => { assert.equal(body, c.body); order.push("submit"); });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); assert.deepEqual(order, ["claim", "checkpoint", "pending"]);
  release(); await work; assert.deepEqual(order, ["claim", "checkpoint", "pending", "gate", "submit"]);
});

test("claim, custody, cancellation and final-gate failures cannot dispatch or retry", async () => {
  const c = await capture();
  for (const failure of ["beforeAttempt", "checkpoint", "pending", "beforeDispatch"]) for (const reason of [new Error("withdrawn"), undefined]) {
    let posts = 0;
    const hooks = { beforeAttempt() {}, checkpoint() {}, pending() {}, beforeDispatch() {} }; hooks[failure] = () => { throw reason; };
    const result = await submitOutputFalImageRequest(c, hooks, async () => { posts++; }).then(() => ({ ok: true }), error => ({ error }));
    assert.deepEqual(result, { error: reason }); await Promise.resolve(); assert.equal(posts, 0);
  }
});

test("an uncertain POST settles as unknown without an automatic replacement", async () => {
  const c = await capture(); let posts = 0;
  await assert.rejects(submitOutputFalImageRequest(c, { beforeAttempt() {}, checkpoint() {}, pending() {}, beforeDispatch() {} }, async () => { posts++; throw new Error("connection_lost"); }), /connection_lost/);
  await Promise.resolve(); assert.equal(posts, 1);
});
