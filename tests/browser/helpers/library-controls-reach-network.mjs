import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { syntheticReadBody, SYNTHETIC_NETWORK_ORIGIN } from "./synthetic-network.mjs";

export const libraryPath = "/library?document=doc-atmosphere";
export const editorPath = "/library/blocks/editor/block-direction?document=doc-atmosphere";
export const blockId = "block-direction";
export const queryText = "project-brief-1";
export const authoredText = "Project-brief-1 preserves this complete authored paragraph. The quiet interior remains held between dusk and night, with warm reflected light and enough room for the audience to read every creative decision. Keep the original source wording, the document identity, and the reusable context together. This paragraph deliberately remains longer than the visible preview: reaching Controls must never require deleting the preview, shortening the authored copy, or choosing a different block.\n\nCafé e\u0301 العربية 日本語 — the final source sentence remains present.";
export const corpusProfiles = {
  ordinary: { label: "Project brief 1", handle: "direction/project-brief-1", previewSlug: "project-brief-1" },
  longEnglish: { label: "Project brief 1 — complete creative direction for the evening review", handle: "direction/project-brief-1", previewSlug: "project-brief-1-complete-creative-direction-for-the-evening-revi" },
  longArabic: { label: "موجز المشروع ١ — التوجيه الإبداعي الكامل لمراجعة المساء", handle: "direction/project-brief-1", previewSlug: "" },
};
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const assistantKey = route => "/api/assistant?" + new URLSearchParams({ route, projectId: "project-atmosphere" });

/** Fixed response bytes installed before navigation. The current transport still
 * owns session/provider declarations and rejects every undeclared API/write.
 * Only this test's one BlockCreated label/handle/text differ from its 24 events.
 * No page-side fetch replacement, Store setter, permission change or server API. */
export async function installLibraryControlsReachNetwork(context, variant) {
  const profile = corpusProfiles[variant];
  if (!profile) throw new Error("Undeclared Library controls corpus variant");
  const first = JSON.parse(syntheticReadBody("/api/events?after=0&limit=5000&content=0"));
  if (first.head !== 24 || first.events.length !== 24) throw new Error("Original finite corpus changed; review the new source before adapting this test");
  const bodies = new Map(), derivations = [];
  for (const after of [0, first.head]) for (const content of ["0", "1"]) for (const scope of ["full", "workspace", "projects"]) {
    const path = `/api/events?after=${after}&limit=${scope === "full" ? 5000 : 6500}&content=${content}${scope === "full" ? "" : "&profile=" + scope}`;
    const original = syntheticReadBody(path), value = JSON.parse(original);
    for (const event of value.events) if (event.type === "BlockCreated" && event.payload.block_id === blockId) {
      event.payload.handle = profile.handle;
      event.payload.properties = { ...event.payload.properties, label: profile.label, text: authoredText };
    }
    const body = JSON.stringify(value);
    bodies.set(path, body);
    derivations.push({ path, originalSha256: sha256(original), variantSha256: sha256(body) });
  }
  // Library and its editor both request the actual workspace profile. Its
  // retained response has 23 complete event records while stream head stays 24;
  // the full catalogue's ComparisonOpened receipt is intentionally excluded.
  // Derive this exact expectation from declared response bytes, never by
  // filtering or normalizing the observed Store events to make them match.
  const storeEventsPath = "/api/events?after=0&limit=6500&content=0&profile=workspace";
  const fullEvents = JSON.parse(bodies.get("/api/events?after=0&limit=5000&content=0")).events;
  const expectedStoreEvents = JSON.parse(bodies.get(storeEventsPath)).events;
  const retainedIds = new Set(expectedStoreEvents.map(event => event.eventId));
  const excluded = fullEvents.filter(event => !retainedIds.has(event.eventId));
  if (expectedStoreEvents.length !== 23 || excluded.length !== 1
    || excluded[0].eventId !== "e6-network-event-22" || excluded[0].sequence !== 22 || excluded[0].type !== "ComparisonOpened"
    || JSON.stringify(expectedStoreEvents) !== JSON.stringify(fullEvents.filter(event => event.eventId !== "e6-network-event-22")))
    throw new Error("Declared Library workspace event profile changed; review admission before updating custody expectations");
  // The current Library editor uses the same library surface/context with an
  // exact new route. It has no private source, turn, task or provider declaration.
  const originalAssistant = JSON.parse(syntheticReadBody(assistantKey(libraryPath)));
  const editorAssistant = structuredClone(originalAssistant);
  if (editorAssistant.context.surface.page !== "library" || editorAssistant.context.decisionAtoms.length !== 0)
    throw new Error("Original Library assistant declaration changed");
  editorAssistant.context.surface.route = editorPath;
  bodies.set(assistantKey(editorPath), JSON.stringify(editorAssistant));

  const fonts = JSON.parse(await readFile(new URL("../data/shared-reader-fonts.json", import.meta.url), "utf8"));
  const fontResponses = new Map(fonts.responses.map(response => {
    const body = Buffer.from(response.bodyBase64, "base64");
    if (body.length !== response.bytes || sha256(body) !== response.sha256) throw new Error("Retained offline font bytes changed");
    return [response.url, { ...response, body }];
  }));
  const receipt = { schema: "forma-library-controls-reach-network-r1", variant, profile,
    scope: "Actual Shell/Library/Store; current finite 24-event renderer corpus with one explicitly synthetic long-copy decision variant",
    sourceChanges: ["block-direction: handle, properties.label and properties.text only"],
    unchanged: ["24 event identities/sequences/types", "all other event payloads", "session", "authorization", "provider", "budgets"],
    storeAdmission: { routeProfile: "workspace", declaredFullEventCount: 24, expectedRetainedEventCount: 23,
      streamHead: first.head, exactResponsePath: storeEventsPath,
      excludedFromWorkspace: excluded.map(event => ({ eventId: event.eventId, sequence: event.sequence, type: event.type })),
      source: ["src/state/route-capabilities.ts:routeCapabilities", "src/state/store.ts:#profileForRoute/#readEventStream/load",
        "src/model/event-profiles.ts:PROFILE_EXCLUDED_EVENT_TYPES.workspace", "tests/browser/helpers/synthetic-network.mjs:eventPages"],
      custody: "Compare all 23 retained records, in original order with complete payloads, and head 24; never filter observed Store bytes." },
    derivations, explicitEditorAssistantPath: assistantKey(editorPath),
    fonts: { provenance: fonts.provenance, fulfilled: [] }, responses: [], forbidden: [],
    limit: "Offline renderer and native navigation regression; not the live C14 record, live role admission, provider, C04/C10, whole Library or production acceptance" };
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const path = url.pathname + url.search;
    if (url.origin === SYNTHETIC_NETWORK_ORIGIN && request.method() === "GET" && bodies.has(path)) {
      receipt.responses.push({ method: "GET", path, sha256: sha256(bodies.get(path)) });
      await route.fulfill({ status: 200, contentType: "application/json; charset=utf-8",
        headers: { "cache-control": "private, no-store", "x-forma-synthetic-network": "library-controls-reach-r1" }, body: bodies.get(path) });
      return;
    }
    const font = fontResponses.get(url.href);
    if (font && request.method() === "GET" && request.resourceType() === font.resourceType) {
      receipt.fonts.fulfilled.push({ url: url.href, sha256: font.sha256, bytes: font.bytes });
      await route.fulfill({ status: 200, contentType: font.contentType, body: font.body });
      return;
    }
    if (url.origin !== SYNTHETIC_NETWORK_ORIGIN && !["data:", "blob:", "chrome-extension:"].includes(url.protocol)) {
      receipt.forbidden.push({ method: request.method(), origin: url.origin, path: url.pathname, resourceType: request.resourceType() });
      await route.abort("blockedbyclient"); return;
    }
    await route.fallback();
  });
  return { receipt, profile, expectedStoreEvents };
}
