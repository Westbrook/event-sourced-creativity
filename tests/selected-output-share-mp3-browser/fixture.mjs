import "../../src/styles.css";
import "../../src/design-system.css";
import "../../src/responsive-foundation.css";
import wavBase64 from "virtual:forma-mp3-publisher-wav";
import { parseSelectedOutputShareAnySelection, parseSelectedOutputShareAnyApproval, projectSelectedOutputShareMediaCandidate } from "../../src/model/selected-output-share.ts";
import { SELECTED_OUTPUT_SHARE_AUDIO_POLICY } from "../../src/model/selected-output-share-audio.ts";
import { SELECTED_OUTPUT_SHARE_STABLE_AUDIO_SOURCE_PROFILE, SELECTED_OUTPUT_SHARE_STABLE_AUDIO_PROJECTION_POLICY } from "../../src/model/selected-output-share-mp3-contract.ts";

const $ = selector => document.querySelector(selector);
const wav = Uint8Array.from(atob(wavBase64), value => value.charCodeAt(0));
const sourceHash = "3cfa31bd59c5f8eb92b525b5f718d6e379824f8407b45ed5e793afe2fcf6ab8d";
const publicHash = "eae13159a5b9273dee41f064db6cd44bb6e93ecf8138ebf424fbca2deb08b1a7";
const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
if (wav.length !== 3528044 || await sha(wav) !== publicHash) throw new Error("Saved fixture identity mismatch");
const descriptor = Object.freeze({ kind: "audio", mimeType: "audio/wav", sha256: publicHash, byteLength: wav.length,
  sampleRate: 44100, channels: 2, sampleCount: 882000, durationSeconds: 20, durationBasis: "pcm-samples" });
const counts = { availability: 0, list: 0, prepare: 0, commit: 0, revoke: 0, preparedFile: 0, bytesDelivered: 0,
  streamCancels: 0, requestAborts: 0, urlsCreated: 0, urlsRevoked: 0, plays: 0, forbidden: 0 };
const records = new Map(), objectUrls = new Map(), held = [], requests = [], events = [];
let publisher, source, sourceController, generation = 0, name = "A", sequence = 0;
let wallOffset = 0, elapsedOffset = 0;
const realDateNow = Date.now.bind(Date), realPerformanceNow = performance.now.bind(performance);
Date.now = () => realDateNow() + wallOffset;
Object.defineProperty(performance, "now", { configurable: true, value: () => realPerformanceNow() + elapsedOffset });
const iso = value => new Date(value).toISOString();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exact = (object, keys) => object && typeof object === "object" && !Array.isArray(object)
  && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
function receipt(event) {
  if (event) events.push(event);
  $("#fixture-status").textContent = `Ready · synthetic source ${name} · ${held.length} held · ${counts.forbidden} forbidden`;
  $("#fixture-receipt").textContent = JSON.stringify({ syntheticOnly: true, productionCreation: false, source: name, generation,
    sourceHash, publicHash, counts, held: held.length, activeObjectUrls: objectUrls.size,
    objectUrls: [...objectUrls.values()], requests, candidates: [...records.values()].map(({ id, candidate, issued, revoked }) =>
      ({ id, sha256: candidate.candidateSha256, title: candidate.publicOutput.title, expiresAt: candidate.publicOutput.expiresAt, issued, revoked })),
    events: events.slice(-30) }, null, 2);
}
const forbidden = request => { counts.forbidden++; receipt("Forbidden " + request.method + " " + new URL(request.url).pathname); throw new Error("No synthetic transport fallback"); };
function responseUrl(response, request) { Object.defineProperty(response, "url", { value: request.url }); return response; }
function json(request, value, status = 200) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return responseUrl(new Response(bytes, { status, headers: { "content-type": "application/json", "content-length": String(bytes.length),
    "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } }), request);
}
const nativeCreate = URL.createObjectURL.bind(URL), nativeRevoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = blob => {
  const url = nativeCreate(blob), entry = { size: blob.size, type: blob.type, sha256: null };
  objectUrls.set(url, entry); counts.urlsCreated++; receipt();
  void blob.arrayBuffer().then(sha).then(value => { entry.sha256 = value; receipt(); }); return url;
};
URL.revokeObjectURL = url => { if (objectUrls.delete(url)) counts.urlsRevoked++; nativeRevoke(url); receipt(); };
document.addEventListener("play", event => { if (event.target instanceof HTMLMediaElement) { counts.plays++; receipt(); } }, true);

function file(request) {
  const mode = $("#fixture-mode").value; $("#fixture-mode").value = "normal";
  const bytes = wav.slice(); if (mode === "wrong-hash") bytes[bytes.length - 1] ^= 1;
  const headers = { "content-type": "audio/wav", "content-disposition": 'attachment; filename="forma-audio.wav"',
    "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
    ...(mode === "absent-length" ? {} : { "content-length": String(bytes.length) }) };
  let cancelled = false;
  const body = new ReadableStream({ start(controller) {
    const emit = chunk => { if (!cancelled) { counts.bytesDelivered += chunk.length; controller.enqueue(chunk); } };
    const finish = () => { if (!cancelled) { emit(bytes.subarray(mode === "hold-tail" ? 32768 : 0)); controller.close(); }
      else bytes.fill(0); receipt("Synthetic file release settled"); };
    if (mode === "hold-tail") { emit(bytes.subarray(0, 32768)); held.push(finish); }
    else finish();
  }, cancel() { cancelled = true; bytes.fill(0); counts.streamCancels++; receipt("Synthetic stream cancelled"); } });
  request.signal.addEventListener("abort", () => { counts.requestAborts++; receipt(); }, { once: true });
  const response = responseUrl(new Response(body, { headers }), request);
  if (mode === "hold-response") return new Promise(resolve => { held.push(() => { resolve(response); receipt("Late response released"); }); receipt(); });
  receipt(); return response;
}

// Every application fetch ends here. No real fetch, source asset, public-token
// route, provider URL or API backend can be reached from these controls.
window.fetch = async (input, init) => {
  const request = input instanceof Request ? new Request(input, init) : new Request(new URL(input, location.origin), init);
  const url = new URL(request.url), path = url.pathname;
  requests.push({ path, method: request.method, credentials: request.credentials, cache: request.cache, redirect: request.redirect,
    referrerPolicy: request.referrerPolicy, accept: request.headers.get("accept") });
  if (url.origin !== location.origin || url.search && path !== "/api/selected-output-shares" || url.hash || request.signal.aborted) return forbidden(request);
  if (path === "/api/selected-output-shares/availability" && request.method === "GET") { counts.availability++; receipt(); return json(request, { creationAvailable: true }); }
  if (path === "/api/selected-output-shares" && request.method === "GET") {
    if (url.searchParams.getAll("documentId").length !== 1 || url.searchParams.getAll("artifactId").length !== 1
      || [...url.searchParams.keys()].some(key => !["documentId", "artifactId"].includes(key))) return forbidden(request);
    counts.list++; receipt(); return json(request, { shares: [], nextCursor: null });
  }
  if (path === "/api/selected-output-shares/prepare" && request.method === "POST") {
    counts.prepare++; const body = await request.json(), selection = parseSelectedOutputShareAnySelection(body.selection);
    if (!exact(body, ["intentKey", "selection", "review"]) || !exact(body.review, ["title", "expiresAt"])
      || !selection || !source?.isCurrent() || !same(selection, source.selection)) return forbidden(request);
    const candidate = await projectSelectedOutputShareMediaCandidate(selection, { descriptor, sourceExpiresAt: iso(Date.now() + 86_400_000),
      disclosure: { watermark: "not-declared" } }, body.review);
    if (!candidate) throw new Error("Actual MP3 candidate projector refused fixture");
    const id = "fixture-mp3-candidate-" + ++sequence; records.set(id, { id, candidate, issued: false, revoked: false }); receipt();
    return json(request, { candidateId: id, candidate, replayed: false });
  }
  const prepared = path.match(/^\/api\/selected-output-shares\/(fixture-mp3-candidate-\d+)\/file$/u);
  if (prepared && request.method === "GET") {
    const record = records.get(prepared[1]);
    if (!record || record.issued || record.revoked || !source?.isCurrent() || !same(record.candidate.selection, source.selection)
      || Date.parse(record.candidate.publicOutput.expiresAt) <= Date.now() || request.headers.has("range")
      || request.credentials !== "same-origin" || request.cache !== "no-store" || request.redirect !== "error"
      || request.referrerPolicy !== "no-referrer" || request.headers.get("accept") !== "audio/wav") return forbidden(request);
    counts.preparedFile++; receipt(); return file(request);
  }
  if (path === "/api/selected-output-shares/commit" && request.method === "POST") {
    const body = await request.json(), record = records.get(body.candidateId);
    if (!exact(body, ["candidateId", "approval"]) || !record || record.issued || record.revoked
      || !parseSelectedOutputShareAnyApproval(body.approval, record.candidate) || !source?.isCurrent()
      || !same(source.selection, record.candidate.selection)) return forbidden(request);
    counts.commit++; record.issued = true; receipt();
    return json(request, { share: { shareId: record.id, expiresAt: record.candidate.publicOutput.expiresAt, active: true, token: "S".repeat(32) }, replayed: false });
  }
  const revoke = path.match(/^\/api\/selected-output-shares\/(fixture-mp3-candidate-\d+)$/u);
  if (revoke && request.method === "DELETE" && records.has(revoke[1])) { counts.revoke++; records.get(revoke[1]).revoked = true; receipt(); return json(request, { ok: true }); }
  return forbidden(request);
};

await import("../../src/components/design-system/locale-bootstrap.ts");
const { currentFormaLocale, setFormaLocale } = await import("../../src/components/design-system/localization.ts");
await import("../../src/components/forma-selected-output-share-review.ts");
publisher = document.createElement("forma-selected-output-share-review"); $("#fixture-publisher").append(publisher);
function renewSource(next = name) {
  sourceController?.abort(); sourceController = new AbortController(); name = next; const epoch = ++generation, controller = sourceController;
  const selection = parseSelectedOutputShareAnySelection({ output: "audio", documentId: "synthetic-mp3-document-" + name,
    artifactId: "synthetic-mp3-artifact-" + name, revision: 0, contentSha256: (name === "A" ? "a" : "b").repeat(64),
    mediaSha256: sourceHash, policy: SELECTED_OUTPUT_SHARE_AUDIO_POLICY, sourceProfile: SELECTED_OUTPUT_SHARE_STABLE_AUDIO_SOURCE_PROFILE,
    projectionPolicy: SELECTED_OUTPUT_SHARE_STABLE_AUDIO_PROJECTION_POLICY });
  source = Object.freeze({ selection, signal: controller.signal, isCurrent: () => generation === epoch && !controller.signal.aborted });
  publisher.enabled = true; publisher.source = source; receipt("Fresh source " + name);
}
renewSource();
$("#fixture-source-a").addEventListener("click", () => renewSource("A"));
$("#fixture-source-b").addEventListener("click", () => renewSource("B"));
$("#fixture-release").addEventListener("click", () => { for (const release of held.splice(0)) release(); receipt(); });
function expire(rollback) {
  const remaining = Math.max(0, ...[...records.values()].map(record => Date.parse(record.candidate.publicOutput.expiresAt) - Date.now())) + 1000;
  elapsedOffset += remaining; wallOffset += rollback ? -86_400_000 : remaining; document.dispatchEvent(new Event("visibilitychange")); receipt("Expiry advanced");
}
$("#fixture-expire").addEventListener("click", () => expire(false));
$("#fixture-rollback").addEventListener("click", () => expire(true));
$("#fixture-locale").addEventListener("click", async () => { await setFormaLocale(currentFormaLocale().locale.startsWith("ja") ? "en" : "ja"); receipt("Locale changed"); });
$("#fixture-disconnect").addEventListener("click", () => { publisher.remove(); receipt("Publisher disconnected"); });
$("#fixture-reconnect").addEventListener("click", () => { $("#fixture-publisher").append(publisher); receipt("Publisher reconnected"); });
receipt("Actual MP3 publisher ready; synthetic transport only");
