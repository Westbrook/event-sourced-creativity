import { MODEL_PATH, FIRST_IMAGE_PATH, SECOND_IMAGE_PATH, syntheticMedia } from "./assets.mjs";

const query = new URLSearchParams(location.search), surface = query.get("surface"), locale = query.get("locale");
if (!["viewer", "composition", "workspace", "workspace-populated", "artifact"].includes(surface) || !["en", "ar"].includes(locale)
  || [...query.keys()].some(key => !["surface", "locale"].includes(key))) throw new Error("Invalid finite native3D fixture entry");
const projectId = "72222222-2222-4222-8222-222222222222";
const documentId = "71111111-1111-4111-8111-111111111111";
const artifactId = "native3d-artifact", compositionId = "native3d-composition", contentRef = "native3d-artifact-content";
const principal = "native3d-synthetic", media = syntheticMedia();
const workspaceSurface = ["workspace", "workspace-populated"].includes(surface);
// Declared metadata for the finite synthetic document, never a backend receipt.
// Shape follows buildSnapshot in worker/output-requirements-api.ts; the real
// Store's snapshot validator and authorization/source ownership remain active.
const emptyWorkspaceOutput = workspaceSurface ? {
  schemaVersion: 1, documentId, projectId,
  scope: { kind: "personal", organizationId: null, projectAccessId: null, actorUserId: principal },
  revision: "output:" + (surface === "workspace-populated" ? 3 : 2),
  requirementRevision: "native3d-empty-output-requirements", sourceRevision: "native3d-" + surface + "-source",
  sourceVerification: { status: "verified", reasonCodes: [], capacity: { referenceCount: 0,
    distinctObjectCount: 0, countsComplete: true, ownedReadLimit: 4, nativeLimit: 1, sources: [], sourcesComplete: true } },
  requirements: [], confirmedPlan: null, targetStates: [], summary: null,
  requirementSummaries: {}, requirementFileCounts: {}, scopeAmendments: [], assets: [], results: [], grants: [],
  permissions: { canAuthor: true, canRequest: true, canReview: true, canDownload: true, independentReview: false },
  capabilities: { nativeGeneration: false, ownedFileAdoption: true,
    supportedFileExtensions: ["png", "jpg", "wav", "mp3", "mp4", "pptx", "glb"],
    limitations: ["Synthetic metadata only; no execution bridge or completed delivery."],
    limitationCodes: ["output_native_execution_unavailable"] },
} : null;
const network = { reads: [], forbidden: [] }, captures = [], saves = [];
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
  .map(value => value.toString(16).padStart(2, "0")).join("");

// Before Store or any component is imported, close the application fetch port.
// Static ES module requests are independently gated by the browser test route.
// There is no real fetch fallback, no backend, and no successful mutation ACK.
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init), url = new URL(request.url);
  request.signal.throwIfAborted();
  const receipt = { method: request.method, origin: url.origin, path: url.pathname, search: url.search };
  if (url.origin === location.origin && request.method === "GET" && !url.search && !url.hash && media.has(url.pathname)) {
    const asset = media.get(url.pathname);
    network.reads.push({ ...receipt, source: "synthetic-media" });
    return new Response(new Uint8Array(asset.bytes), { headers: { "content-type": asset.mime,
      "content-length": String(asset.bytes.length), "cache-control": "no-store" } });
  }
  if (["artifact", "workspace", "workspace-populated"].includes(surface) && request.method === "GET" && url.origin === location.origin
    && url.pathname === "/api/document-jobs/presentation-candidates" && !url.hash
    && url.search === `?document=${encodeURIComponent(documentId)}`) {
    network.reads.push({ ...receipt, source: "declared-empty-synthetic-candidate-list" });
    return new Response(JSON.stringify({ documentId, jobs: [] }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  // Mounting Workspace performs these two existing metadata reads. The POST
  // is only the exact initial resume lookup, never preview/apply/dismiss or a
  // recovery operation ID. Each declaration can be consumed once per surface.
  if (workspaceSurface && request.method === "POST" && url.origin === location.origin
    && url.pathname === "/api/workspace/quick-edit" && !url.search && !url.hash
    && request.headers.get("content-type") === "application/json") {
    const body = await request.text(); request.signal.throwIfAborted();
    if (body === JSON.stringify({ action: "resume", projectId, documentId })
      && !network.reads.some(value => value.source === "declared-empty-synthetic-review-resume")) {
      network.reads.push({ ...receipt, source: "declared-empty-synthetic-review-resume", body: JSON.parse(body) });
      return new Response(JSON.stringify({ status: "none" }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
  }
  if (workspaceSurface && request.method === "GET" && url.origin === location.origin
    && url.pathname === "/api/output-requirements" && !url.hash
    && url.search === `?documentId=${encodeURIComponent(documentId)}`
    && !network.reads.some(value => value.source === "declared-empty-synthetic-output-requirements")) {
    network.reads.push({ ...receipt, source: "declared-empty-synthetic-output-requirements" });
    return new Response(JSON.stringify(emptyWorkspaceOutput), {
      headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  network.forbidden.push(receipt);
  throw new TypeError("Undeclared native3D fixture request blocked before network");
};

const { store } = await import("/src/state/store.ts");
const { setFormaLocale } = await import("/src/components/design-system/localization.ts");
const { createReferenceComposition, addReferenceCompositionLayer, referenceCompositionSources } =
  await import("/src/model/reference-composition.ts");
await setFormaLocale(locale, { persist: false });

const labels = locale === "ar" ? {
  project: "مشروع اصطناعي لفحص عناصر التحكم ثلاثية الأبعاد",
  document: "مراجعة تفاصيل العمل المرئي مع عنوان طويل يختبر العرض على الشاشة الصغيرة",
  model: "مجسم اصطناعي أخضر مع وصف مطول لاختبار موضع عناصر التحكم باللغة العربية",
  scene: "مشهد مرجعي تجريبي يحتفظ بترتيب الصور وإعدادات المشهد بعد الحفظ",
  first: "خلفية اصطناعية طويلة الاسم لاختبار قراءة المصدر وترتيبه في المشهد المرجعي",
  second: "تفاصيل اصطناعية طويلة الاسم لاختبار الطبقة الأمامية وإمكانية الوصول بلوحة المفاتيح",
  artifact: "نموذج ثلاثي الأبعاد مع ملفات أصلية وعنوان مطول لاختبار التصدير على الشاشة الصغيرة",
} : {
  project: "Synthetic native three-dimensional controls project",
  document: "A long authored document title for checking context creation at a narrow viewport",
  model: "Synthetic jade object with an intentionally long label for native model-view controls",
  scene: "A retained reference scene with a deliberately long authored name for keyboard review",
  first: "A deliberately long named synthetic studio backdrop for the retained reference scene",
  second: "A deliberately long named synthetic foreground detail for layered keyboard inspection",
  artifact: "A deliberately long model output title with original mesh and companion texture downloads",
};
const baseEvent = { streamId: "native3d-synthetic-only", occurredAt: "2026-09-02T12:00:00.000Z",
  recordedAt: "2026-09-02T12:00:00.000Z", clientId: "native3d-fixture", correlationId: "native3d-fixture",
  causationId: null, compensatesEventId: null, schemaVersion: 1, actor: "user:" + principal };
let sequence = 0;
const event = (type, payload) => ({ ...baseEvent, eventId: "native3d-event-" + ++sequence, sequence, type, payload });
const seed = [event("ProjectCreated", { project_id: projectId, name: labels.project }),
  event("DocumentCreated", { project_id: projectId, document_id: documentId, title: labels.document })];
if (["artifact", "workspace-populated"].includes(surface)) seed.push(event("BlockCreated", { project_id: projectId, document_id: documentId,
  block_id: "native3d-direction", type: "direction", handle: "direction/native3d", properties: {
    label: "Synthetic owned direction", text: "Inspect the synthetic jade object and its original files.", weight: 1,
  } }));
if (surface === "composition") {
  for (const [index, path] of [FIRST_IMAGE_PATH, SECOND_IMAGE_PATH].entries()) {
    const id = "native3d-source-" + index, referenceId = "native3d-reference-" + index;
    const contentHash = await digest(media.get(path).bytes);
    seed.push(event("ReferenceIngested", { project_id: projectId, document_id: documentId,
      reference_id: referenceId, source_ref: path, content_hash: contentHash, rights_class: "owned_or_licensed",
      mime_type: "image/png", original_name: id + ".png" }));
    seed.push(event("BlockCreated", { project_id: projectId, document_id: documentId, block_id: id,
      type: "reference", handle: "reference/" + id, properties: { label: index ? labels.second : labels.first,
        reference_id: referenceId, media_url: path, media_type: "image/png", source_content_hash: contentHash,
        rights_class: "owned_or_licensed", weight: 1, pixel_reference_mode: "send" } }));
  }
}
if (surface === "artifact") {
  const mesh = media.get(MODEL_PATH), texture = media.get(SECOND_IMAGE_PATH);
  seed.push(event("DocumentRenderCompleted", { project_id: projectId, document_id: documentId,
    artifact_id: artifactId, artifact_kind: "model3d", title: labels.artifact,
    summary: "Authored synthetic metadata only; no provider execution, payment or delivery is represented.",
    content_ref: contentRef, item_count: 1, items: [{ id: "native3d-mesh-item", title: labels.model, body: "Local fixture mesh", notes: "", image_prompt: "" }],
    media_url: MODEL_PATH, media_type: mesh.mime, provider: "synthetic-fixture", model_id: "synthetic-cube",
    latency_ms: 0, requested_by_user_id: principal, source_surface: "native3d-fixture", settings: { model3d_files: [
      { url: MODEL_PATH, mimeType: mesh.mime, fileName: "original-synthetic-jade-object-with-a-long-preserved-file-name.glb",
        fileSize: mesh.bytes.length, format: "glb", role: "mesh", sha256: await digest(mesh.bytes), previewSupported: true },
      { url: SECOND_IMAGE_PATH, mimeType: texture.mime, fileName: "companion-texture-with-a-long-preserved-file-name-for-the-original-object.png",
        fileSize: texture.bytes.length, format: null, role: "texture", sha256: await digest(texture.bytes) },
    ] } }));
}

// Fresh, declared personal principal. Never initialize(), load(), copy cookies,
// hydrate an account, or alter any real user's permissions or retained bytes.
const session = {
  user: { userId: principal, email: "native3d@example.invalid", displayName: "Synthetic native3D fixture",
    role: "creator", consentVersion: "synthetic", consentedAt: baseEvent.occurredAt },
  impersonation: null, audience: "creative",
  capabilities: ["project.read", "project.author", "project.output.request"],
  policy: { version: "synthetic", accepted: true, passiveCapture: false, externalAssetsRequireAssertion: true,
    retentionDays: 30, sharing: "synthetic" },
  canvas: { version: "synthetic", mode: "pilot", pilotAvailable: false, access: false,
    accessReason: "pilot-gate-incomplete", blockedBy: [], requirements: [] },
  provider: { name: "synthetic", model: "unconfigured", configured: false, plannerConfigured: false,
    videoConfigured: false, audioConfigured: false, model3dConfigured: false },
  budgets: { period: "synthetic", user: { used: 0, reserved: 0, limit: 0 }, workspace: { used: 0, reserved: 0, limit: 0 } },
};
store.session.set(session);
store.route.set(`/document/${documentId}/native3d-qualification`);
store.events.set(structuredClone(seed)); store.head.set(sequence); store.loading.set(false);
store.patchUi({ instrumentation: false });
if (surface === "artifact") store.content.set({ [contentRef]: JSON.stringify({ title: labels.artifact,
  summary: "Synthetic retained content", content_markdown: "Synthetic model delivery metadata.",
  items: [{ title: labels.model, body: "Local fixture mesh", notes: "", image_prompt: "" }] }) });
if (surface === "composition") {
  const sources = referenceCompositionSources(store.projection.get().libraryBlocks, store.events.get());
  if (sources.length !== 2) throw new Error("Real composition source admission rejected the synthetic fixture");
  let recipe = createReferenceComposition();
  for (const [index, source] of sources.entries()) recipe = addReferenceCompositionLayer(recipe, source, "native3d-layer-" + index);
  seed.push(event("BlockCreated", { project_id: projectId, document_id: documentId, block_id: compositionId,
    type: "reference", handle: "reference/native3d-composition", properties: { label: labels.scene,
      reference_id: "native3d-composition-original", media_url: FIRST_IMAGE_PATH, media_type: "image/png",
      source_content_hash: await digest(media.get(FIRST_IMAGE_PATH).bytes), reference_composition: recipe, weight: 1 } }));
  store.events.set(structuredClone(seed)); store.head.set(sequence);
}
const source = store.captureSourceOwnership();
if (!store.sourceOwnershipActive(source)) throw new Error("Real Store did not admit the finite synthetic source");

const root = document.querySelector("#native3d-root");
let host, mount = root, pendingSave = null, capturePending = 0;
// This sole application-method port represents a delayed *in-memory* save.
// The real editor supplies its unchanged current() guard and real bitmap.
// No successful HTTP response or server acknowledgment is synthesized.
Object.defineProperty(store, "saveReferenceComposition", { value(input, current) {
  if (surface !== "composition" || pendingSave || input.targetBlockId !== compositionId || !current())
    throw new Error("Undeclared synthetic save");
  const receipt = { kind: "in-memory-only", targetBlockId: input.targetBlockId, label: input.label,
    recipe: structuredClone(input.recipe), byteLength: input.blob.size, mime: input.blob.type,
    completed: false, renderBeforeResolution: null };
  saves.push(receipt);
  return new Promise(resolve => { pendingSave = { input, current, resolve, receipt }; });
} });

if (surface === "viewer") {
  await import("/src/components/model3d-viewer.ts");
  host = document.createElement("forma-model3d-viewer"); host.src = MODEL_PATH; host.label = labels.model;
  host.addEventListener("model3d-capture", async ({ detail }) => {
    capturePending++;
    try {
      const bitmap = await createImageBitmap(detail.blob);
      captures.push({ view: structuredClone(detail.view), src: detail.src, mime: detail.blob.type,
        byteLength: detail.blob.size, width: bitmap.width, height: bitmap.height,
        sha256: await digest(await detail.blob.arrayBuffer()) });
      bitmap.close();
    } finally { capturePending--; }
  });
} else if (surface === "composition") {
  await import("/src/components/reference-composition-editor.ts");
  host = document.createElement("forma-reference-composition-editor");
  host.block = store.projection.get().libraryBlocks.find(block => block.id === compositionId);
} else if (["workspace", "workspace-populated"].includes(surface)) {
  await import("/src/components/forma-workspace.ts");
  // Structural shell only. Its real registration lives in apps/creative/entry,
  // reached by route-loader on navigation; neither entry is invoked here.
  // Fail before creating/connecting the tag if the import graph ever changes.
  if (customElements.get("forma-creative-application")) throw new Error("Native3D scaffold cannot connect a registered application");
  const inline = root.getBoundingClientRect().width || document.documentElement.clientWidth;
  const block = document.documentElement.clientHeight || innerHeight, short = block <= 600;
  // Same fixed-viewport posture calculation as FormaShell.#syncLayout.
  const posture = short && inline > block ? "rail" : inline < 768 ? "compact" : inline < 1200 ? "rail" : "expanded";
  root.classList.add("app-shell");
  root.dataset.placement = "workbench"; root.dataset.layoutIntent = "workbench";
  root.dataset.navPosture = posture; root.dataset.shortHeight = String(short);
  const main = document.createElement("main");
  main.id = "main-content"; main.tabIndex = -1; main.setAttribute("aria-busy", "false");
  mount = document.createElement("forma-creative-application");
  main.append(mount); root.append(main);
  // The real StudioModeNav derives html[data-document-focus] from the unchanged
  // route and fresh storage. No fixture focus preference or html flag is set.
  host = document.createElement("forma-workspace");
} else {
  await import("/src/components/document-artifacts.ts");
  host = document.createElement("forma-document-artifacts"); host.documentId = documentId;
}
mount.append(host); await host.updateComplete;

async function completeSyntheticSave() {
  const pending = pendingSave;
  if (!pending || !pending.current()) throw new Error("Synthetic completion lost its actual owner guard");
  const child = host.querySelector("forma-reference-compositor"), dialog = child?.querySelector("dialog:modal");
  if (!dialog) throw new Error("Original native save dialog is unavailable");
  const contentHash = await digest(await pending.input.blob.arrayBuffer());
  if (!pending.current()) throw new Error("Synthetic save owner changed during local hashing");
  const newEvents = [event("BlockPropertyEdited", { block_id: compositionId, property_path: "label", new_value: pending.input.label }),
    event("BlockPropertyEdited", { block_id: compositionId, property_path: "reference_composition", new_value: structuredClone(pending.input.recipe) }),
    event("BlockPropertyEdited", { block_id: compositionId, property_path: "source_content_hash", new_value: contentHash })];
  // Force the own-canonical-update window before resolving the parent save.
  // This intentionally uses only synthetic in-memory events, never Store.append.
  store.events.set([...store.events.get(), ...newEvents]); store.head.set(sequence); store.notify();
  await host.updateComplete; await child.updateComplete;
  pending.receipt.renderBeforeResolution = {
    sameChild: host.querySelector("forma-reference-compositor") === child,
    nativeModal: dialog.isConnected && dialog.matches(":modal"),
    openerEnabled: !host.querySelector(":scope > button")?.disabled,
    canonicalHashUpdated: store.projection.get().libraryBlocks.find(block => block.id === compositionId)?.properties.source_content_hash === contentHash,
  };
  pending.receipt.completed = true; pendingSave = null; pending.resolve(true);
}
Object.defineProperty(globalThis, "formaNative3d", { configurable: false, value: Object.freeze({
  completeSyntheticSave,
  snapshot: () => structuredClone({ schema: "forma-native3d-synthetic-r1", surface, locale, labels,
    initializedFromAccount: false, sourceActive: store.sourceOwnershipActive(source),
    owner: { tag: host.localName, constructor: host.constructor.name, connected: host.isConnected,
      actualRegistryInstance: host instanceof customElements.get(host.localName) },
    custody: { events: store.events.get(), optimisticEvents: store.optimisticEvents.get(), content: store.content.get(),
      head: store.head.get(), route: store.route.get(), session: store.session.get(), jobs: store.documentJobs.get() },
    outputRequirements: workspaceSurface ? store.outputRequirements.resource(documentId) : null,
    scaffold: workspaceSurface ? { kind: "structural-only", rootTag: root.localName,
      directOwnerChain: host.matches(".app-shell.application-creative > #main-content > forma-creative-application > forma-workspace"),
      applicationUnregistered: !customElements.get("forma-creative-application"),
      navPosture: root.dataset.navPosture, shortHeight: root.dataset.shortHeight, layoutIntent: root.dataset.layoutIntent,
      documentFocus: document.documentElement.hasAttribute("data-document-focus"),
      mainPaddingBlockEnd: getComputedStyle(mount.parentElement).paddingBlockEnd,
      composerBlockEnd: getComputedStyle(host.querySelector(".composer-dock")).insetBlockEnd } : null,
    network, captures, capturePending, saves, pendingSave: Boolean(pendingSave),
    limits: ["Synthetic renderer qualification only; no account, provider, migration, export receipt or persistence evidence.",
      "The single save port applies three declared in-memory fixture events before resolving.",
      "Remote fonts are blocked; the unchanged CSS uses its normal system-font fallback.",
      "Software WebGL; not hardware GPU, assistive technology or all-browser certification."] }),
}) });
document.documentElement.dataset.native3dReady = "true";
