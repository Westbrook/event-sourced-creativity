import { installProfileFocusTransport, PROFILE_FOCUS_CASES } from "./profile-focus.transport.mjs";

// Same public Store/source-module seam as e6-noncanvas.fixture.mjs. No copied
// controller, finite focus port, forced DOM state, test clock or app routing.
const parameters = new URLSearchParams(location.search), caseId = parameters.get("case");
if (!PROFILE_FOCUS_CASES.includes(caseId) || parameters.size !== 1 || globalThis.formaProfileFocusFixture) {
  throw new Error("Invalid or repeated Profile focus fixture");
}
const transport = installProfileFocusTransport(caseId);
// The sink is already installed before any actual Store/client/component code.
const { store } = await import("/src/state/store.ts");
const { setFormaLocale } = await import("/src/components/design-system/localization.ts");
const { withDocumentInRoute } = await import("/src/model/routes.ts");
const at = transport.at, actor = transport.actor, projectId = transport.projectId, documentId = transport.documentId;
const session = {
  user: { userId: actor, email: "profile-focus@example.invalid", displayName: "Synthetic Profile principal",
    role: "creator", consentVersion: "fixture", consentedAt: at },
  impersonation: null, audience: "creative", permissionEpoch: "profile-focus-" + transport.scopeId,
  capabilities: ["project.read", "project.author"], organizations: [], projects: [],
  policy: { version: "fixture", accepted: true, passiveCapture: false, externalAssetsRequireAssertion: true,
    retentionDays: 30, sharing: "fixture-only" },
  canvas: { version: "fixture", mode: "internal", pilotAvailable: false, access: false,
    accessReason: "fixture-not-enabled", blockedBy: [], requirements: [] },
  provider: { name: "No provider", model: "fixture", configured: false, plannerConfigured: false, videoConfigured: false, audioConfigured: false },
  budgets: { period: "fixture", user: { used: 0, reserved: 0, limit: 0 }, workspace: { used: 0, reserved: 0, limit: 0 } },
};
const seed = [];
const append = (type, payload) => seed.push({ type, payload, eventId: "profile-focus-event-" + (seed.length + 1),
  streamId: "creative:" + actor, sequence: seed.length + 1, occurredAt: at, recordedAt: at,
  actor: "user:" + actor, clientId: "profile-focus-fixture", correlationId: "profile-focus-fixture",
  causationId: null, compensatesEventId: null, schemaVersion: 1 });
append("ProjectCreated", { project_id: projectId, name: "Synthetic Profile project", state: "active" });
append("DocumentCreated", { project_id: projectId, document_id: documentId, title: "Synthetic Profile document" });
append("DocumentOpened", { project_id: projectId, document_id: documentId });
append("BlockCreated", { project_id: projectId, document_id: documentId, block_id: "profile-focus-source", type: "direction",
  handle: "direction/profile-focus", properties: { label: "Synthetic retained source", text: "  Preserve this synthetic source exactly.  " } });
await setFormaLocale("en-US", { persist: false });
store.session.set(session); store.events.set(structuredClone(seed)); store.head.set(seed.length); store.loading.set(false);
store.route.set(withDocumentInRoute("/", documentId, "Synthetic Profile document"));
const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope();
if (!store.sourceOwnershipActive(source) || !store.authorizationScopeActive(authorization)) {
  transport.dispose(); throw new Error("Synthetic Profile source not admitted by actual Store");
}
const root = document.querySelector("#profile-focus-root");
const { FormaPersonalMemory } = await import("/src/components/forma-personal-memory.ts");
const owner = document.createElement("forma-personal-memory");
if (!(owner instanceof FormaPersonalMemory)) { transport.dispose(); throw new Error("Actual Profile component not registered"); }
const ownedEvents = store.events.get(), ownedContent = store.content.get(), ownedRoute = store.route.get();
const focusEvents = [];
let focusOverflow = 0, closed = false;
const describe = node => node ? { tag: node.tagName, id: node.id || null,
  profileAction: node.getAttribute("data-memory-profile-action"), memoryAction: node.getAttribute("data-memory-action"),
  heading: node.getAttribute("data-memory-focus") === "heading", name: node.getAttribute("name"),
  inOwner: node.closest("forma-personal-memory") === owner,
  inView: Boolean(node.closest("[data-memory-profile-view]")), connected: node.isConnected } : null;
const observeFocus = event => {
  if (focusEvents.length < 128) focusEvents.push({ at: performance.now(), target: describe(event.target) }); else focusOverflow++;
};
document.addEventListener("focusin", observeFocus, true); // Passive evidence; no focus or event mutation.
root.append(owner); await owner.updateComplete;
const snapshot = () => structuredClone({
  schema: "forma-profile-focus-native-r1", caseId, scopeId: transport.scopeId, closed,
  apiIsolationBeforeOwner: true, actualRegistryInstance: owner instanceof FormaPersonalMemory
    && owner instanceof customElements.get("forma-personal-memory"), connected: owner.isConnected,
  actualStore: owner.store === store, sourceActive: store.sourceOwnershipActive(source),
  authorizationActive: store.authorizationScopeActive(authorization),
  stableSources: store.events.get() === ownedEvents && store.content.get() === ownedContent && store.route.get() === ownedRoute,
  transport: transport.snapshot(), focusEvents, focusOverflow, active: describe(document.activeElement),
  departureBlocked: !closed && owner.captureCommandDeparture().blocked(),
  custody: { session: store.session.get(), route: store.route.get(), events: store.events.get(),
    optimisticEvents: store.optimisticEvents.get(), content: store.content.get(), head: store.head.get(), jobs: store.documentJobs.get() },
  limits: ["Synthetic data and component-only native behavior; no genuine authority, account, API persistence, whole-app or AT acceptance.",
    "The actual component, Store, clients and output-navigation-focus implementation are not replaced.",
    "Fresh disposable browser state only; no enrollment, scheduler, provider or production action."],
});
Object.defineProperty(globalThis, "formaProfileFocusFixture", { value: Object.freeze({
  snapshot,
  releaseSuppression: () => transport.releaseSuppression(),
  dispose() {
    if (closed) return snapshot();
    closed = true; owner.remove(); transport.dispose(); document.removeEventListener("focusin", observeFocus, true);
    return snapshot();
  },
}) });
