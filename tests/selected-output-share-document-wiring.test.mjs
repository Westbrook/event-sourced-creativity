import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import ts from "typescript";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { createVideoOutputContract } from "../src/model/output-video-contract.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";

// Execute the complete, actual DocumentArtifacts module using the existing
// finite native fixture ports. Only this suite runs: accepted fixture tests are
// excluded at their first top-level test declaration, never production methods.
const fixtureUrl = new URL("./inactive-generation-dialog-fixture.mjs", import.meta.url);
const text = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstTest = tree.statements.find(node => ts.isExportAssignment(node));
assert.ok(firstTest);
const fixtureTree = ts.createSourceFile(fixtureUrl.pathname, text.slice(0, firstTest.getFullStart()), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const transformed = ts.transform(fixtureTree, [context => {
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      const name = node.moduleSpecifier.text;
      return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
        ts.factory.createStringLiteral(name.startsWith(".") ? new URL(name, fixtureUrl).href : import.meta.resolve(name)), node.attributes);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === "url")
      return ts.factory.createStringLiteral(fixtureUrl.href);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1 && ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === "specifier")
      return ts.factory.updateCallExpression(node, node.expression, node.typeArguments,
        [ts.factory.createCallExpression(ts.factory.createIdentifier("resolveFixtureModule"), undefined, [node.arguments[0]])]);
    return ts.visitEachChild(node, visit, context);
  };
  return value => ts.visitNode(value, visit);
}]);
const fixtureCode = 'import { createRequire } from "node:module"; import { pathToFileURL } from "node:url";\n'
  + `const fixtureRequire=createRequire(${JSON.stringify(fixtureUrl.href)}); const resolveFixtureModule=name=>pathToFileURL(fixtureRequire.resolve(name)).href;\n`
  + ts.createPrinter().printFile(transformed.transformed[0])
  + "\nexport { documentPort, windowPort, ElementPort, loadActual };\n";
transformed.dispose();
const { fixture, documentPort, ElementPort, loadActual } = await import("data:text/javascript;base64," + Buffer.from(fixtureCode).toString("base64"));
const mediaClient = await loadActual("src/selected-output-share-media-client.ts");
const hash = value => createHash("sha256").update(value).digest("hex");

function host(t, kind = "short_story", options = {}) {
  const f = fixture("create", { artifact: true, ...options });
  const listeners = new Set();
  f.disposals = 0;
  f.store.subscribe = listener => { listeners.add(listener); return () => { if (listeners.delete(listener)) f.disposals++; }; };
  f.notify = () => { for (const listener of [...listeners]) listener(); };
  f.listenerCount = () => listeners.size;
  installOutputNavigationFocusNative(t, f, { documentPort, ElementPort, artifactDialogOwner: f.host });
  const completion = f.state.events.find(event => event.type === "DocumentRenderCompleted");
  completion.streamId = "creative:owner"; completion.payload.artifact_kind = kind;
  f.completion = completion;
  // Pure native visibility ports; no browser/device or rendered-a11y claim.
  documentPort.visibilityState = "visible";
  f.fetch = t.mock.method(globalThis, "fetch", () => assert.fail("Document share wiring must not fetch or publish"));
  const previousLocation = documentPort.location;
  documentPort.location = { origin: "https://fixture.invalid" };
  t.after(() => { f.host.isConnected = false; f.host.disconnectedCallback(); documentPort.visibilityState = "visible"; documentPort.location = previousLocation; });
  f.share = () => {
    const match = f.renderer.markup.match(/<forma-selected-output-share-review\s+([^>]*)>/u);
    return match ? f.renderer.attrs(match[1]).properties : null;
  };
  f.openArtifact = async () => {
    assert.equal(await f.host.openArtifactById("artifact-A", kind === "slides" ? { intent: "inspect" } : {}), true);
    await f.flush();
    return f.share()?.source;
  };
  return f;
}

for (const kind of ["short_story", "scene", "slides"]) {
  test(`${kind} supplies only the exact current retained JSON selection and a fresh viewer lease`, async t => {
    const f = host(t, kind), source = await f.openArtifact();
    assert.ok(source); assert.equal(source.isCurrent(), true); assert.equal(source.signal.aborted, false);
    assert.deepEqual(source.selection, { output: kind, documentId: "A", artifactId: "artifact-A", revision: 0,
      contentSha256: hash(f.state.content["content-A"]) });
    assert.deepEqual(Object.keys(source).sort(), ["isCurrent", "selection", "signal"]);
    assert.deepEqual(Object.keys(f.share()).sort(), ["enabled", "source"]); assert.equal(f.share().enabled, true);
    assert.ok(Object.isFrozen(source)); assert.ok(Object.isFrozen(source.selection));
    const subscriptions = f.listenerCount(); assert.ok(subscriptions >= 1);
    f.draw(); assert.strictEqual(f.share().source, source, "ordinary parent render preserves input lifetime");
    assert.equal(f.listenerCount(), subscriptions, "rerender does not accumulate subscriptions");
    assert.match(f.renderer.markup, /Edit finished output/u);
    if (kind !== "slides") assert.match(f.renderer.markup, /Download Markdown/u);
    assert.equal(f.state.requests.length, 0);
  });
}

test("unsupported media, project, impersonation and noncanonical completions do not expose the action", async t => {
  for (const scenario of ["audio", "video", "storyboard", "model3d", "project", "impersonation", "owner", "stream", "sponsor"]) {
    await t.test(scenario, async child => {
      const f = host(child, ["audio", "video", "storyboard", "model3d"].includes(scenario) ? scenario : "short_story");
      const originalSession = f.store.session.get;
      if (scenario === "project") f.store.session.get = () => ({ ...originalSession(), projectContext: { permissions: ["project.read"], organizationId: "org", projectAccessId: "project" } });
      if (scenario === "impersonation") f.store.session.get = () => ({ ...originalSession(), impersonation: { userId: "other" } });
      if (scenario === "owner") f.completion.payload.requested_by_user_id = "other";
      if (scenario === "stream") f.completion.streamId = "creative:other";
      if (scenario === "sponsor") f.completion.payload.sponsor_consumption_id = "sponsor-id";
      await f.openArtifact(); assert.equal(f.share(), null);
    });
  }
});

for (const mutation of ["route", "content", "revision", "authorization", "source", "actor", "owner", "kind", "sponsor"]) {
  test(`${mutation} A → B → A notifications abort immediately and cannot revive a source`, async t => {
    const f = host(t), source = await f.openArtifact();
    assert.ok(source); let restore; const disposals = f.disposals;
    if (mutation === "route") { const original = f.store.route.get; f.store.route.get = () => "/other"; restore = () => { f.store.route.get = original; }; }
    if (mutation === "content") { const original = f.state.content["content-A"]; f.state.content["content-A"] = original + " "; restore = () => { f.state.content["content-A"] = original; }; }
    if (mutation === "revision") { f.state.events.push({ ...f.completion, eventId: "revision-1", sequence: 90, type: "DocumentArtifactEdited", payload: { artifact_id: "artifact-A", document_id: "A", revision: 1 } }); restore = () => { f.state.events.pop(); }; }
    if (mutation === "authorization") { const original = f.state.authorization; f.state.authorization = "other"; restore = () => { f.state.authorization = original; }; }
    if (mutation === "source") { const original = f.store.sourceOwnershipActive; f.store.sourceOwnershipActive = () => false; restore = () => { f.store.sourceOwnershipActive = original; }; }
    if (mutation === "actor") { const original = f.store.session.get; f.store.session.get = () => ({ ...original(), user: { userId: "other", role: "user" } }); restore = () => { f.store.session.get = original; }; }
    if (mutation === "owner") { f.completion.payload.requested_by_user_id = "other"; restore = () => { f.completion.payload.requested_by_user_id = "owner"; }; }
    if (mutation === "kind") { f.completion.payload.artifact_kind = "scene"; restore = () => { f.completion.payload.artifact_kind = "short_story"; }; }
    if (mutation === "sponsor") { f.completion.payload.sponsor_consumption_id = "new-sponsor"; restore = () => { delete f.completion.payload.sponsor_consumption_id; }; }
    f.notify(); assert.equal(source.signal.aborted, true, "notification retires before any render or promise");
    assert.ok(f.disposals > disposals, "retirement releases its Store subscription"); restore(); f.notify(); assert.equal(source.isCurrent(), false);
    const next = await f.openArtifact(); assert.ok(next); assert.notStrictEqual(next, source);
    assert.equal(next.isCurrent(), true); assert.equal(source.signal.aborted, true);
  });
}

test("visibility, pagehide, authorization events, native close, edit and disconnect synchronously retire", async t => {
  for (const action of ["visibilitychange", "pagehide", "forma-authorization-changed", "forma-event-source-retired", "close", "edit", "disconnect"]) {
    await t.test(action, async child => {
      const f = host(child), source = await f.openArtifact(); assert.ok(source); const disposals = f.disposals;
      if (action === "visibilitychange") documentPort.visibilityState = "hidden";
      if (["visibilitychange", "pagehide", "forma-authorization-changed"].includes(action))
        for (const listener of [...(f.listeners.get(action) ?? [])]) listener();
      if (action === "forma-event-source-retired")
        for (const listener of [...(f.listeners.get(action) ?? [])]) listener({ detail: { source: f.store.captureSourceOwnership() } });
      if (action === "close") f.renderer.ownNodes(f.host, "dialog").find(node => node.classList.contains("document-artifact-view")).close();
      if (action === "edit") await f.renderer.handler(f.host, "button", node => node.handlers.click?.toString().includes("#startArtifactEdit"))();
      if (action === "disconnect") { f.host.isConnected = false; f.host.disconnectedCallback(); }
      assert.equal(source.signal.aborted, true); assert.equal(source.isCurrent(), false); assert.ok(f.disposals > disposals);
    });
  }
});

test("a source read detects hidden ancestors and retires rather than restoring after visibility returns", async t => {
  const f = host(t), source = await f.openArtifact(), originalClosest = f.host.closest;
  f.host.closest = selector => selector === "[hidden],[inert]" ? {} : originalClosest.call(f.host, selector);
  assert.equal(source.isCurrent(), false); assert.equal(source.signal.aborted, true);
  f.host.closest = originalClosest; assert.equal(source.isCurrent(), false);
});

test("missing retained bytes do not trigger a new share fetch or substitute selection", async t => {
  const f = host(t), source = await f.openArtifact(); delete f.state.content["content-A"]; f.notify();
  assert.equal(source.signal.aborted, true); f.draw(); assert.equal(f.share(), null);
});

// These media bytes qualify only the host's exact transport/hash binding. The
// independently tested server container gates establish format qualification.
function mediaHost(t, output, { converted = false } = {}) {
  const f = host(t, output), payload = f.completion.payload;
  f.bytes = new Uint8Array(output === "audio" ? 52 : 80).fill(output === "audio" ? 1 : 2);
  f.mediaHash = hash(f.bytes);
  const raw = JSON.parse(f.state.content["content-A"]);
  payload.source_surface = "document";
  if (output === "audio") {
    payload.media_url = "/api/media/original-audio"; payload.media_type = converted ? "audio/mpeg" : "audio/wav";
    payload.settings = { source_media_sha256: "a".repeat(64) };
    const revision = { schemaVersion: 1, operation: converted ? "client-converted-trim" : "trim",
      ...(converted ? { conversion: { method: "browser-decode-pcm16-v1", provenance: "client-local", sourceMediaType: "audio/mpeg",
        sourceByteLength: 100, decodedMediaSha256: "d".repeat(64), decodedByteLength: 60, sampleRate: 8000, channels: 1, frameCount: 8 } } : {}),
      media: { url: "/api/media/current-audio", mediaType: "audio/wav", sha256: f.mediaHash, byteLength: f.bytes.length },
      source: { url: payload.media_url, sha256: "a".repeat(64), revision: 0, contentSha256: hash(f.state.content["content-A"]), frameCount: 8 },
      startFrame: 0, endFrame: 4, sampleRate: 8000, channels: 1, bitsPerSample: 16, frameCount: 4, durationSeconds: 4 / 8000 };
    raw.audio_revision = revision; f.state.content["content-A"] = JSON.stringify(raw);
    f.edit = { ...f.completion, eventId: "authored-wav-1", sequence: 90, type: "DocumentArtifactEdited", payload: {
      artifact_id: "artifact-A", document_id: "A", project_id: "p", content_ref: "content-A", revision: 1,
      content_sha256: hash(f.state.content["content-A"]), edited_by_user_id: "owner", source_surface: "document-artifact-audio-trim", audio_revision: revision } };
    f.state.events.push(f.edit); f.mediaUrl = revision.media.url; f.mimeType = "audio/wav";
  } else if (output === "video") {
    const contract = createVideoOutputContract({ source: { draftId: "experience-draft-" + "a".repeat(64), draftHash: "sha256:" + "b".repeat(64),
      releaseHash: "sha256:" + "c".repeat(64), requestHash: "sha256:" + "d".repeat(64), sourceBindingHash: "sha256:" + "e".repeat(64) },
      reference: { version: 1, sourceProjectId: "p", sourceDocumentId: "A", sourceBlockId: "b", referenceId: "r", sha256: "a".repeat(64),
        permissionAttestation: "i-own-or-have-permission" }, frameSize: "1280x720" });
    assert.ok(contract);
    f.mediaUrl = "/api/media/" + encodeURIComponent(`${ownerMediaNamespace("owner")}/generated/artifact-A.mp4`); f.mimeType = "video/mp4";
    payload.source_surface = "outputs"; payload.media_url = f.mediaUrl; payload.media_type = f.mimeType;
    payload.items = [{ id: "artifact-A-item-1", media_url: f.mediaUrl, media_type: f.mimeType }]; payload.item_count = 1;
    const receipt = { version: "output-video-completion-v1", contract, jobId: "job", slotId: "slot", artifactId: "artifact-A", actorUserId: "owner",
      documentId: "A", streamId: "creative:owner", correlationId: "correlation", attempt: 1, grantId: "grant", targetId: "target",
      planRevisionId: "plan", targetContractDigest: "target", sourceDigest: "source", plannerRequestDigest: "a".repeat(64),
      plannerResponseId: "response", planSha256: hash(f.state.content["content-A"]), providerCallCount: 2,
      media: { artifactId: "artifact-A", mediaUrl: f.mediaUrl, mediaType: f.mimeType, sha256: f.mediaHash, byteLength: f.bytes.length,
        clientRequestId: "client", providerRequestId: "provider", model: "bytedance/seedance-2.0/reference-to-video", requestDigest: "a".repeat(64),
        width: 864, height: 496, durationSeconds: 4, audioTracks: 0, codec: "avc1", rotationDegrees: 0 }, visualReview: "required" };
    payload.settings = { source_media_sha256: f.mediaHash, output_video: receipt,
      video_content_sha256: hash(f.state.content["content-A"]), video_input_sha256: "f".repeat(64) };
  } else {
    f.mediaUrl = "/api/media/original-model.glb"; f.mimeType = "model/gltf-binary";
    payload.media_url = f.mediaUrl; payload.media_type = f.mimeType;
    payload.settings = { model3d_files: [{ url: f.mediaUrl, mimeType: f.mimeType, fileName: "original-model.glb",
      fileSize: f.bytes.length, format: "glb", role: "mesh", sha256: f.mediaHash, previewSupported: true }] };
  }
  f.output = { schemaVersion: 1, kind: "selected-output-read", output, title: "Reviewed output",
    expiresAt: new Date(Date.now() + 60_000).toISOString(), attribution: "Forma", content: {
      media: { kind: output, mimeType: f.mimeType, sha256: f.mediaHash, byteLength: f.bytes.length,
        ...(output === "audio" ? { sampleRate: 8000, channels: 1, sampleCount: 4, durationSeconds: 4 / 8000, durationBasis: "pcm-samples" }
          : output === "video" ? { width: 864, height: 496, durationSeconds: 4 } : {}) },
      disclosure: output === "audio" ? { watermark: "not-declared" } : output === "video" ? { encoderDeclaration: "x264-163-r3060" } : {} } };
  f.controls = () => ({ signal: new AbortController().signal, isCurrent: () => true });
  f.response = (url, bytes = f.bytes) => {
    const response = new Response(bytes, { headers: { "content-type": f.mimeType, "content-length": String(bytes.length) } });
    Object.defineProperty(response, "url", { value: url }); return response;
  };
  return f;
}

for (const output of ["audio", "video", "model3d"]) {
  test(`${output} exposes an exact media lease without a read until requested`, async t => {
    const f = mediaHost(t, output), source = await f.openArtifact(); assert.ok(source);
    assert.equal(f.fetch.mock.callCount(), 0);
    assert.equal(source.selection.mediaSha256, f.mediaHash);
    assert.equal(source.selection.contentSha256, hash(f.state.content["content-A"]));
    assert.equal(source.selection.revision, output === "audio" ? 1 : 0);
    assert.equal(source.selection.policy, output === "audio" ? "selected-output-share-audio-v1"
      : output === "video" ? "selected-output-share-avc-mp4-x264-163-r3060-v1" : "selected-output-share-glb-png-textures-v1");
    assert.equal(source.selection.projectionPolicy, "selected-output-media-exact-bytes-v1");
    assert.deepEqual(Object.keys(source).sort(), ["isCurrent", "readMedia", "selection", "signal"]);
    f.fetch.mock.mockImplementation(async (url, init) => {
      assert.equal(url, "https://fixture.invalid" + f.mediaUrl); assert.equal(init.method, "GET");
      assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error"); assert.equal(init.referrerPolicy, "no-referrer");
      return f.response(url);
    });
    const verified = await source.readMedia(f.output, f.controls());
    const access = mediaClient.accessVerifiedSelectedOutputShareMedia(verified, f.output); assert.ok(access);
    assert.equal(hash(new Uint8Array(await access.blob.arrayBuffer())), f.mediaHash);
    assert.equal(f.fetch.mock.callCount(), 1); assert.equal(f.state.requests.length, 0);
    f.host.isConnected = false; f.host.disconnectedCallback();
    assert.equal(mediaClient.accessVerifiedSelectedOutputShareMedia(verified, f.output), null);
    mediaClient.disposeVerifiedSelectedOutputShareMedia(verified);
  });
}

test("caller abort after a successful media read invalidates the verified handle", async t => {
  const f = mediaHost(t, "audio"), source = await f.openArtifact(); assert.ok(source);
  const caller = new AbortController(), controls = { signal: caller.signal, isCurrent: () => true };
  f.fetch.mock.mockImplementation(async url => {
    assert.equal(url, "https://fixture.invalid" + f.mediaUrl);
    return f.response(url);
  });
  const verified = await source.readMedia(f.output, controls);
  t.after(() => mediaClient.disposeVerifiedSelectedOutputShareMedia(verified));
  const access = mediaClient.accessVerifiedSelectedOutputShareMedia(verified, f.output); assert.ok(access);
  assert.equal(hash(new Uint8Array(await access.blob.arrayBuffer())), f.mediaHash);
  caller.abort();
  assert.equal(source.isCurrent(), true); assert.equal(source.signal.aborted, false);
  assert.equal(controls.isCurrent(), true);
  assert.equal(mediaClient.accessVerifiedSelectedOutputShareMedia(verified, f.output), null);
  assert.equal(f.fetch.mock.callCount(), 1); assert.equal(f.state.requests.length, 0);
});

test("current adopted client-converted WAV keeps its revision and exact bytes", async t => {
  const f = mediaHost(t, "audio", { converted: true }), source = await f.openArtifact(); assert.ok(source);
  assert.equal(source.selection.revision, 1); assert.equal(source.selection.mediaSha256, f.edit.payload.audio_revision.media.sha256);
  assert.equal(f.fetch.mock.callCount(), 0);
});

for (const scenario of ["audio-restored", "audio-unknown-edit", "audio-content-hash", "audio-owner", "video-no-length", "video-unknown-receipt",
  "video-content-hash", "video-edited", "video-restored", "model3d-no-length", "model3d-no-sha", "model3d-primary-only", "model3d-edited", "model3d-restored"]) {
  test(`${scenario} cannot offer an unsupported or ambiguous media source`, async t => {
    const output = scenario.split("-")[0], f = mediaHost(t, output), payload = f.completion.payload;
    if (scenario === "audio-restored") f.edit.payload.revision_action = "restore";
    if (scenario === "audio-unknown-edit") f.edit.payload.source_surface = "unknown";
    if (scenario === "audio-content-hash") f.edit.payload.content_sha256 = "0".repeat(64);
    if (scenario === "audio-owner") f.edit.payload.edited_by_user_id = "other";
    if (scenario === "video-no-length") delete payload.settings.output_video.media.byteLength;
    if (scenario === "video-unknown-receipt") delete payload.settings.output_video;
    if (scenario === "video-content-hash") { payload.settings.video_content_sha256 = "0".repeat(64); payload.settings.output_video.planSha256 = "0".repeat(64); }
    if (scenario === "model3d-no-length") delete payload.settings.model3d_files[0].fileSize;
    if (scenario === "model3d-no-sha") delete payload.settings.model3d_files[0].sha256;
    if (scenario === "model3d-primary-only") delete payload.settings.model3d_files;
    if (["video-edited", "video-restored", "model3d-edited", "model3d-restored"].includes(scenario))
      f.state.events.push({ ...f.completion, eventId: "changed", sequence: 90, type: "DocumentArtifactEdited",
        payload: { artifact_id: "artifact-A", document_id: "A", revision: 1, ...(scenario.endsWith("restored") ? { revision_action: "restore" } : {}) } });
    await f.openArtifact(); assert.equal(f.share(), null); assert.equal(f.fetch.mock.callCount(), 0);
  });
}

for (const output of ["audio", "video", "model3d"]) {
  test(`${output} retires media metadata A → B → A independently of retained JSON`, async t => {
    const f = mediaHost(t, output), source = await f.openArtifact(); assert.ok(source);
    let target, key;
    if (output === "audio") { target = f.edit.payload.audio_revision.media; key = "url"; }
    if (output === "video") { target = f.completion.payload.settings.output_video.media; key = "byteLength"; }
    if (output === "model3d") { target = f.completion.payload.settings.model3d_files[0]; key = "sha256"; }
    const original = target[key]; target[key] = typeof original === "number" ? original + 1 : original + "different";
    f.notify(); assert.equal(source.signal.aborted, true); target[key] = original; f.notify();
    assert.equal(source.isCurrent(), false); assert.equal(f.fetch.mock.callCount(), 0);
  });
}

test("Document source reader rejects a different prepared descriptor before any read", async t => {
  const f = mediaHost(t, "audio"), source = await f.openArtifact();
  for (const field of ["sha256", "byteLength", "mimeType"]) {
    const output = structuredClone(f.output);
    output.content.media[field] = field === "sha256" ? "f".repeat(64) : field === "byteLength" ? 54 : "audio/mpeg";
    await assert.rejects(source.readMedia(output, f.controls()), /selected_output_media_unavailable/);
  }
  assert.equal(f.fetch.mock.callCount(), 0);
});

for (const boundary of ["source", "review"]) {
  test(`${boundary} retirement aborts an in-flight exact Document media read`, async t => {
    const f = mediaHost(t, "audio"), source = await f.openArtifact(), controller = new AbortController();
    let requestSignal, started;
    const requested = new Promise(resolve => { started = resolve; });
    f.fetch.mock.mockImplementation((_url, init) => { requestSignal = init.signal; started(); return new Promise(() => {}); });
    const reading = source.readMedia(f.output, { signal: controller.signal, isCurrent: () => true });
    const refused = assert.rejects(reading, /selected_output_media_unavailable/); await requested;
    if (boundary === "source") { f.host.isConnected = false; f.host.disconnectedCallback(); } else controller.abort();
    assert.equal(requestSignal.aborted, true); await refused;
    assert.equal(f.fetch.mock.callCount(), 1); assert.equal(f.state.requests.length, 0);
  });
}

test("Document origin A → B → A retires the media reader before another fetch", async t => {
  const f = mediaHost(t, "audio"), source = await f.openArtifact(), original = documentPort.location.origin;
  documentPort.location.origin = "https://other.invalid"; f.notify();
  assert.equal(source.signal.aborted, true);
  documentPort.location.origin = original; f.notify(); assert.equal(source.isCurrent(), false);
  await assert.rejects(source.readMedia(f.output, f.controls()), /selected_output_media_unavailable/);
  assert.equal(f.fetch.mock.callCount(), 0);
});
