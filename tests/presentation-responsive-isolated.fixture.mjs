import { store } from "/src/state/store.ts";
import { classifyTestRequest } from "./browser/helpers/read-only-network.mjs";

/**
 * Opt-in, synthetic renderer fixture. Not a session, share, or backend test.
 * The original responsive fixture supplies its same two authored slide items.
 * No application methods, ownership predicates, native controls, or CSS change.
 */
export async function mountIsolatedPresentation({ surface, root, items, presentation, event, documentId, projectId }) {
  const parameters = new URLSearchParams(location.search);
  if (!["shared", "document", "canvas", "library"].includes(surface)
    || [...parameters.keys()].some(key => !["isolated", "locale"].includes(key))
    || items.length !== 2 || !root || root.children.length) throw new Error("Invalid isolated renderer fixture entry");
  const artifactId = "responsive-shared-artifact", canvasId = "board-a";
  const seed = structuredClone(store.events.get());
  if (seed.length !== 3 || seed[0].type !== "ProjectCreated" || seed[1].type !== "DocumentCreated"
    || seed[2].type !== "BlockCreated") throw new Error("Original responsive source fixture changed");
  seed.push({ ...event, eventId: "fixture-completion", sequence: 4, type: "DocumentRenderCompleted", payload: {
    project_id: projectId, document_id: documentId, artifact_id: artifactId, artifact_kind: "slides",
    title: "Shared protected presentation", summary: "Approved evidence remains available across shared viewing surfaces.",
    content_ref: null, item_count: items.length, items: structuredClone(items), presentation: structuredClone(presentation),
    provider: "fixture", model_id: "fixture", latency_ms: 0, source_surface: "responsive-fixture", requested_by_user_id: "fixture",
  } });
  if (surface === "canvas") seed.push(
    { ...event, eventId: "fixture-board-a", sequence: 5, type: "CanvasCreated",
      payload: { project_id: projectId, canvas_id: canvasId, name: "Board A", slug: "board-a" } },
    { ...event, eventId: "fixture-deck-item", sequence: 6, type: "CanvasItemPlaced", payload: {
      canvas_id: canvasId, item_id: "e5-cardinality-deck", source_kind: "artifact", source_id: artifactId,
      title: "Shared protected presentation", block_type: "slides", frame: { x: 20, y: 20, w: 320, h: 240, z: "z1" },
    } },
  );
  // Declared personal fixture principal, not a real login or a role override.
  // Like the existing finite Canvas fixture, this has no permissionEpoch;
  // real presence admission therefore remains unavailable and is not tested.
  const session = surface === "shared" ? null : {
    user: { userId: "fixture", email: "fixture@example.invalid", displayName: "Responsive fixture", role: "creator",
      consentVersion: "fixture", consentedAt: event.occurredAt },
    impersonation: null, audience: "creative",
    policy: { version: "fixture", accepted: true, passiveCapture: false, externalAssetsRequireAssertion: true,
      retentionDays: 30, sharing: "fixture" },
    canvas: { version: "fixture", mode: "pilot", pilotAvailable: true, access: true, accessReason: "pilot-approved",
      blockedBy: [], requirements: [] },
    provider: { name: "fixture", model: "fixture", configured: false, plannerConfigured: false,
      videoConfigured: false, audioConfigured: false },
    budgets: { period: "fixture", user: { used: 0, reserved: 0, limit: 0 }, workspace: { used: 0, reserved: 0, limit: 0 } },
    capabilities: ["project.read", "project.canvas.use", "project.author"],
  };
  const reads = [], suppressedTelemetry = [], forbidden = [];
  const response = body => new Response(JSON.stringify(body), { status: 200, headers: {
    "content-type": "application/json", "cache-control": "private, no-store", "x-forma-isolated-fixture": "e5-renderer",
  } });
  // Installed BEFORE any owner connects. Only the exact declared synthetic
  // GETs can resolve; no API fallback and never a fabricated write/telemetry ACK.
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    const method = request.method, postData = method === "GET" || method === "HEAD" ? null : await request.clone().text();
    const disposition = classifyTestRequest({ method, url: url.href, postData, resourceType: "fetch" }, location.origin);
    const receipt = { method, origin: url.origin, path: url.pathname };
    if (disposition === "suppressed-telemetry") {
      suppressedTelemetry.push(receipt);
      throw new TypeError("Observational telemetry aborted by isolated fixture; no acknowledgment");
    }
    if (url.origin === location.origin && method === "GET") {
      if (surface === "shared" && url.pathname === "/api/shared/responsive-fixture" && !url.search && !url.hash) {
        const artifact = store.projection.get().libraryArtifacts.find(item => item.id === artifactId);
        if (!artifact) throw new Error("Synthetic artifact projection missing");
        reads.push({ ...receipt, fixture: "declared-shared-projection", status: 200 });
        return response({ projection: { projectName: "Responsive fixture", documentTitle: "Shared responsive acceptance",
          blocks: [], outputs: [], artifacts: [artifact] }, share: { expiresAt: "2030-01-01T00:00:00.000Z" } });
      }
      // The real gallery discovers actor-private preserved drafts on its first update.
      if (["document", "library"].includes(surface) && url.pathname === "/api/document-jobs/presentation-candidates"
        && url.search === `?document=${encodeURIComponent(documentId)}` && !url.hash) {
        reads.push({ ...receipt, fixture: "declared-empty-preserved-candidate-read", documentId, status: 200 });
        return response({ documentId, jobs: [] });
      }
      const head = seed.at(-1).sequence;
      if (surface === "canvas" && url.pathname === "/api/events" && !url.hash
        && [`?after=${head}&limit=5000&content=0`, "?after=0&limit=5000&content=1"].includes(url.search)) {
        const after = Number(url.searchParams.get("after"));
        reads.push({ ...receipt, fixture: "declared-canvas-event-read", after, head, status: 200 });
        return response({ events: seed.filter(item => item.sequence > after), content: {}, head, nextAfter: head, hasMore: false });
      }
    }
    forbidden.push(receipt);
    throw new TypeError("Undeclared isolated fixture request blocked before network");
  };
  store.session.set(session);
  store.events.set(structuredClone(seed));
  store.head.set(seed.at(-1).sequence);
  store.loading.set(false);
  if (surface === "canvas") store.route.set(`/canvas/${canvasId}/board-a`);
  if (surface === "library") store.route.set(`/library?document=${documentId}`);
  const source = surface === "shared" ? null : store.captureSourceOwnership();
  if (surface !== "shared" && !store.sourceOwnershipActive(source)) throw new Error("Synthetic source was not admitted by the real Store");
  let host, owner;
  if (surface === "shared") {
    await import("/src/components/forma-shared-view.ts");
    host = document.createElement("forma-shared-view"); host.token = "responsive-fixture";
  } else if (surface === "library") {
    await import("/src/components/forma-library.ts");
    host = document.createElement("forma-library");
  } else if (surface === "document") {
    await import("/src/components/document-artifacts.ts");
    host = document.createElement("forma-document-artifacts"); host.documentId = documentId;
  } else {
    const { loadCanvasRoute } = await import("/src/apps/canvas/entry.ts");
    await loadCanvasRoute(store.route.get());
    host = document.createElement("forma-canvas-application");
    // The real application component supplies its real Surface. This class
    // supplies only the existing Canvas CSS variable context, not a fake Shell.
    host.classList.add("application-canvas");
  }
  root.append(host);
  await host.updateComplete;
  owner = surface === "canvas" ? host.querySelector("forma-canvas-surface") : host;
  if (!owner || !(owner instanceof customElements.get(owner.localName))) throw new Error("Real isolated owner did not mount");
  await owner.updateComplete;
  Object.defineProperty(globalThis, "formaIsolatedPresentation", { configurable: false, value: Object.freeze({
    snapshot: () => structuredClone({
      schema: "forma-isolated-presentation-r1", scope: "synthetic-renderer-only", surface, apiIsolationBeforeOwner: true,
      owner: { tag: owner.localName, constructor: owner.constructor.name, connected: owner.isConnected,
        actualRegistryInstance: owner instanceof customElements.get(owner.localName),
        hostTag: host.localName, hostConstructor: host.constructor.name, hostContainsOwner: host.contains(owner) },
      sourceActive: surface === "shared" ? null : store.sourceOwnershipActive(source),
      custody: { route: store.route.get(), session: store.session.get(), events: store.events.get(),
        optimisticEvents: store.optimisticEvents.get(), content: store.content.get(), head: store.head.get(),
        artifacts: store.projection.get().libraryArtifacts, jobs: store.documentJobs.get() },
      authoredItems: items, reads, suppressedTelemetry, forbidden,
      limits: ["Synthetic data and declared read responses; not real account, authorization, share or provider evidence.",
        "Actual Canvas may use fresh-profile IndexedDB and localStorage; no claim of zero browser-local writes.",
        "No full Shell, guest locale chrome, populated workflow, assistive-technology or production acceptance."],
    }),
  }) });
}
