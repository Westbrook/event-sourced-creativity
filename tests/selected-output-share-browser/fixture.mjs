// Isolated browser instrumentation, never application activation or backend
// authorization evidence. Actual components, parsers, projector, localization
// and CSS run unchanged. The only mutable records below are synthetic memory.
import "../../src/styles.css";
import "../../src/design-system.css";
import "../../src/responsive-foundation.css";
import { parseSelectedOutputShareSelection, parseSelectedOutputShareApproval,
  projectSelectedOutputShareCandidate } from "../../src/model/selected-output-share.ts";
import { projectNativeRetainedOutput } from "../../src/model/native-retained-output.ts";

const $ = selector => document.querySelector(selector);
const counts = { availability: 0, list: 0, prepare: 0, commit: 0, revoke: 0, recipient: 0, forbidden: 0 };
const records = new Map(), intents = new Map(), held = [], events = [];
const realDateNow = Date.now.bind(Date), realPerformanceNow = performance.now.bind(performance);
let wallOffset = 0, elapsedOffset = 0, generation = 0, sequence = 0, sourceName = "A", sourceController;
let source, publisher, recipient, latestToken = "", available = false;
Date.now = () => realDateNow() + wallOffset;
Object.defineProperty(performance, "now", { configurable: true, value: () => realPerformanceNow() + elapsedOffset });
const iso = value => new Date(value).toISOString();
const outputKind = () => $("#fixture-kind").value;
const currentSelection = () => Object.freeze({ output: outputKind(), documentId: `fixture-document-${sourceName}`,
  artifactId: `fixture-artifact-${sourceName}-${outputKind()}`, revision: 1, contentSha256: (sourceName === "A" ? "a" : "b").repeat(64) });
const sameSelection = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function receipt(message) {
  if (message) events.push(message);
  $("#fixture-status").textContent = `${available ? "Synthetic creation enabled" : "Creation disabled"} · Source ${sourceName} · ${outputKind()} · ${counts.forbidden} forbidden requests · ${held.length} held replies`;
  $("#fixture-receipt").textContent = JSON.stringify({ syntheticOnly: true, serverActivation: false, source: sourceName,
    kind: outputKind(), generation, creationAvailable: available, counts, held: held.length,
    wallOffsetMs: wallOffset, elapsedOffsetMs: elapsedOffset, issued: [...records.values()].filter(record => record.issued && !record.revoked).length,
    events: events.slice(-25) }, null, 2);
}
function json(request, body, status = 200) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const response = new Response(bytes, { status, headers: { "content-type": "application/json; charset=utf-8",
    "content-length": String(bytes.length), "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
  Object.defineProperty(response, "url", { value: request.url });
  return response;
}
const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const forbidden = request => { ++counts.forbidden; receipt(`REFUSED ${request.method} ${new URL(request.url).pathname}`); throw new Error("Synthetic fixture forbids this request"); };
const token = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replaceAll("+", "-").replaceAll("/", "_");
function nativeDto(selection) {
  const { output, ...identity } = selection;
  const base = { schemaVersion: 1, selection: identity, title: "SYNTHETIC PRIVATE TITLE — NEVER A SHARE DEFAULT", expiresAt: iso(Date.now() + 86_400_000) };
  if (output === "short_story") return { ...base, kind: "native-retained-short-story", contentMarkdown:
    "The lantern keeper opened the blue door.\n\n日本語の物語。 العربية: قصة قصيرة.\n\nLiteral text: <img src='https://never-fetch.invalid/pixel'> [private link](/api/private/never)." };
  if (output === "scene") return { ...base, kind: "native-retained-output", output, content: { medium: "visual", content_markdown:
    "INT. OBSERVATORY — EVENING\n\nMIRA sets a notebook beside the telescope.\n\nMIRA\nThe light arrived before the explanation.\n\n日本語の台詞。 حوار عربي.\n\n<script>literal, not executable</script>" } };
  const raw = { title: base.title,
    presentation: { aspectRatio: "16:9", theme: "Report", footerLabel: "Synthetic audience footer", stylePreset: "editorial", mode: "light",
      palette: { background: "#f2efe8", foreground: "#171714", accent: "#b8422f", muted: "#625e56", surface: "#ded8ca" } },
    items: [
      { title: "A clear result", body: "Synthetic result: 75%\n日本語とالعربية", notes: "PRIVATE NOTES NOT IN PUBLIC PROJECTION", image_prompt: "PRIVATE IMAGE PROMPT NOT IN PUBLIC PROJECTION", slide: {
        layout: "scorecard", kicker: "Synthetic evidence", bullets: ["Exact audience copy", "No external media"],
        quote: { text: "A measured result", speaker: "Fixture author", role: "Researcher", citation: "Synthetic report" },
        citations: [{ label: "Synthetic report", anchor: "p. 1", excerpt: "PRIVATE SOURCE EXCERPT NOT IN PUBLIC PROJECTION" }],
        visual: { kind: "scorecard", label: "Result", value: "75%", data: [{ label: "Completion", value: "75%", weight: 0.75 }] },
      } },
      { title: "A second finding", body: "All content here is synthetic.\nLiteral <script>text</script> stays text.", notes: "", image_prompt: "", slide: null },
    ],
  };
  // The retained DTO is already an audience projection. Use the real native
  // projector first so private notes/prompts/source excerpts cannot be treated
  // as valid audience DTO fields by this browser fixture.
  return projectNativeRetainedOutput({ output, selection: identity }, raw, base.expiresAt);
}
async function newRecord(selection, review, intentKey) {
  const candidate = await projectSelectedOutputShareCandidate(selection, nativeDto(selection), review);
  if (!candidate) throw new Error("The real pure projector rejected the synthetic fixture");
  const id = `fixture-candidate-${++sequence}`;
  const record = { id, candidate, intentKey, issued: false, revoked: false, token: "", issuedAt: "" };
  records.set(id, record); if (intentKey) intents.set(intentKey, record);
  return record;
}
function issue(record) {
  const replayed = record.issued;
  if (!replayed) { record.issued = true; record.issuedAt = iso(Date.now()); record.token = token(); latestToken = record.token; }
  return { share: { shareId: record.id, expiresAt: record.candidate.publicOutput.expiresAt, active: true,
    ...(replayed ? {} : { token: record.token }) }, replayed };
}
async function maybeHold(operation, response) {
  const mode = $("#fixture-response").value;
  if (mode === operation || operation === "commit" && mode === "lost-commit") {
    $("#fixture-response").value = "normal";
    if (mode === "lost-commit") { receipt("Synthetic commit completed; acknowledgement deliberately lost"); throw new Error("Synthetic lost acknowledgement"); }
    return new Promise(resolve => { held.push(() => resolve(response)); receipt(`Holding ${operation} response; source changes may now retire it`); });
  }
  return response;
}

// No fallback to real fetch exists. Static ES module/CSS loads remain Vite
// resources, and CSP independently blocks external font/CSS/media requests.
window.fetch = async (input, init) => {
  const request = new Request(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin), init);
  const url = new URL(request.url), path = url.pathname;
  if (url.origin !== location.origin || url.hash) return forbidden(request);
  if (path === "/api/selected-output-shares/availability" && request.method === "GET" && !url.search) {
    ++counts.availability; receipt(); return json(request, { creationAvailable: available });
  }
  if (path === "/api/selected-output-shares" && request.method === "GET") {
    ++counts.list;
    if ([...url.searchParams.keys()].some(key => !["documentId", "artifactId"].includes(key))
      || url.searchParams.getAll("documentId").length !== 1 || url.searchParams.getAll("artifactId").length !== 1) return forbidden(request);
    if ($("#fixture-response").value === "list-failure") { $("#fixture-response").value = "normal"; receipt("Synthetic metadata read deliberately failed"); throw new Error("Synthetic list failure"); }
    const shares = [...records.values()].filter(record => record.issued && !record.revoked
      && record.candidate.selection.documentId === url.searchParams.get("documentId") && record.candidate.selection.artifactId === url.searchParams.get("artifactId"))
      .map(record => ({ shareId: record.id, title: record.candidate.publicOutput.title, output: record.candidate.selection.output,
        revision: record.candidate.selection.revision, expiresAt: record.candidate.publicOutput.expiresAt, issuedAt: record.issuedAt }));
    receipt(); return json(request, { shares, nextCursor: null });
  }
  if (path === "/api/selected-output-shares/prepare" && request.method === "POST" && !url.search) {
    ++counts.prepare; const body = await request.json();
    if (!exact(body, ["intentKey", "selection", "review"]) || typeof body.intentKey !== "string"
      || !exact(body.review, ["title", "expiresAt"])) return forbidden(request);
    const selection = parseSelectedOutputShareSelection(body.selection);
    if (!available || !selection || !source || source.signal.aborted || !sameSelection(selection, source.selection)) return json(request, { error: "unavailable" }, 409);
    const previous = intents.get(body.intentKey), record = previous ?? await newRecord(selection, body.review, body.intentKey);
    if (record.revoked || record.issued || !sameSelection(record.candidate.selection, selection)
      || record.candidate.publicOutput.title !== body.review.title || record.candidate.publicOutput.expiresAt !== body.review.expiresAt) return json(request, { error: "unavailable" }, 409);
    receipt("Synthetic preparation projected with the actual model; no token issued");
    return maybeHold("prepare", json(request, { candidateId: record.id, candidate: record.candidate, replayed: Boolean(previous) }));
  }
  if (path === "/api/selected-output-shares/commit" && request.method === "POST" && !url.search) {
    ++counts.commit; const body = await request.json();
    if (!exact(body, ["candidateId", "approval"])) return forbidden(request);
    const record = records.get(body.candidateId);
    if (!available || !record || record.revoked || !source || source.signal.aborted
      || !sameSelection(record.candidate.selection, source.selection) || Date.parse(record.candidate.publicOutput.expiresAt) <= Date.now()
      || !parseSelectedOutputShareApproval(body.approval, record.candidate)) return json(request, { error: "unavailable" }, 409);
    const result = issue(record); receipt("Synthetic publication approved; in-memory token only");
    return maybeHold("commit", json(request, result));
  }
  const revoke = path.match(/^\/api\/selected-output-shares\/(fixture-candidate-\d+)$/u);
  if (revoke && request.method === "DELETE" && !url.search) {
    ++counts.revoke; const record = records.get(revoke[1]); if (record) record.revoked = true;
    receipt("Synthetic link revoked"); return json(request, { ok: true });
  }
  const read = path.match(/^\/api\/selected-output-shared\/([A-Za-z0-9_-]{32})$/u);
  if (read && request.method === "GET" && !url.search) {
    ++counts.recipient; const record = [...records.values()].find(value => value.token === read[1] && value.issued && !value.revoked);
    receipt(); return record && Date.parse(record.candidate.publicOutput.expiresAt) > Date.now()
      ? json(request, record.candidate.publicOutput) : json(request, { error: "unavailable" }, 404);
  }
  return forbidden(request);
};

// Same saved-locale initialization used by main.ts; it finishes before any
// component connects. Dynamic locale chunks are static modules, not API calls.
await import("../../src/components/design-system/locale-bootstrap.ts");
const { currentFormaLocale, setFormaLocale } = await import("../../src/components/design-system/localization.ts");
await import("../../src/components/design-system/language-picker.ts");
await import("../../src/components/forma-selected-output-share-review.ts");
await import("../../src/components/forma-selected-output-shared-view.ts");
publisher = document.createElement("forma-selected-output-share-review");
recipient = document.createElement("forma-selected-output-shared-view");
$("#fixture-publisher").append(publisher); $("#fixture-recipient").append(recipient);
function renewSource(name = sourceName) {
  sourceController?.abort(); sourceName = name; const epoch = ++generation;
  sourceController = new AbortController();
  source = Object.freeze({ selection: currentSelection(), signal: sourceController.signal,
    isCurrent: () => generation === epoch && !sourceController.signal.aborted });
  publisher.enabled = true; publisher.source = source;
  receipt(`Fresh synthetic source ${sourceName}, lifetime ${generation}`);
}
renewSource();
const picker = $("#fixture-locale");
const syncLocale = () => { const locale = currentFormaLocale(); picker.value = locale.locale.split("-")[0]; picker.label = locale.messages["language.label"] || "Language"; picker.dir = locale.direction; };
syncLocale(); document.addEventListener("forma-locale-change", syncLocale);
picker.addEventListener("forma-change", async event => { await setFormaLocale(event.detail.value); receipt("Saved locale changed; authored controls remain mounted"); });
$("#fixture-kind").addEventListener("change", () => renewSource());
$("#fixture-availability").addEventListener("change", () => { available = $("#fixture-availability").value === "true"; renewSource(); });
$("#fixture-source-a").addEventListener("click", () => renewSource("A"));
$("#fixture-source-b").addEventListener("click", () => renewSource("B"));
$("#fixture-abort").addEventListener("click", () => { sourceController.abort(); receipt("Source aborted; candidate/token must retire immediately"); });
$("#fixture-release").addEventListener("click", () => { for (const release of held.splice(0)) release(); receipt("Released held synthetic responses"); });
$("#fixture-seed").addEventListener("click", async () => {
  const record = await newRecord(currentSelection(), { title: `Synthetic existing ${outputKind()} link`, expiresAt: iso(Date.now() + 3_600_000) });
  issue(record); renewSource(); receipt("Seeded one synthetic existing link; open Share output to list it");
});
$("#fixture-expiry-input").addEventListener("click", () => {
  const input = publisher.querySelector('input[name="share-expiry"]');
  if (!input || input.disabled) { receipt("Open Share output before choosing a fixture expiry"); return; }
  const date = new Date(Date.now() + 120_000), pad = number => String(number).padStart(2, "0");
  input.value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  input.dispatchEvent(new Event("input", { bubbles: true })); receipt("Explicit fixture expiry choice: about two minutes; title remains user-authored");
});
function openRecipient(value = latestToken) {
  recipient.token = ""; recipient.token = value;
  receipt(value ? "Opened exact synthetic recipient token" : "No synthetic token exists");
}
$("#fixture-show-recipient").addEventListener("click", () => openRecipient());
document.addEventListener("click", event => {
  const anchor = event.target.closest?.("a[href]"); if (!anchor) return;
  const url = new URL(anchor.href); const match = url.pathname.match(/^\/share\/output\/([A-Za-z0-9_-]{32})$/u);
  if (url.origin === location.origin && match) { event.preventDefault(); openRecipient(match[1]); }
});
function expire(rollback) {
  const remaining = Math.max(0, ...[...records.values()].map(record => Date.parse(record.candidate.publicOutput.expiresAt) - Date.now())) + 1000;
  elapsedOffset += remaining; wallOffset += rollback ? -86_400_000 : remaining;
  document.dispatchEvent(new Event("visibilitychange")); receipt(rollback ? "Elapsed lifetime expired with wall-clock rollback" : "Controlled clock advanced past synthetic receipts");
}
$("#fixture-expire").addEventListener("click", () => expire(false));
$("#fixture-rollback").addEventListener("click", () => expire(true));
$("#fixture-clock-reset").addEventListener("click", () => {
  wallOffset = elapsedOffset = 0; recipient.token = ""; latestToken = ""; records.clear(); intents.clear(); renewSource();
  receipt("Clock reset; synthetic in-memory shares cleared; fresh source");
});
const initialToken = location.pathname.match(/^\/share\/output\/([A-Za-z0-9_-]{32})\/?$/u)?.[1];
if (initialToken) openRecipient(initialToken);
receipt("Ready: actual native components, closed default capability, strict synthetic API transport");
