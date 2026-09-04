import { test, expect, attachJSON, captureViewport, openForma } from "./fixtures.mjs";
import { documentPath, waitForExistingDocument, tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";
import { measureOrdinaryCopy } from "./helpers/ordinary-copy-layout.mjs";
import { measureFormaFocusVisibility } from "../helpers/forma-dom-focus-visibility.mjs";

// Additive E11 copy observations on the existing finite source-preview fixture.
// Five independent journeys in each of these four explicit cells add20 cases;
// existing138 membership, helpers, transport and route authorization stay intact.
const profiles = [
  { name: "EN coarse390", geometry: { viewport: { width: 390, height: 844 }, zoom: 1, hasTouch: true } },
  { name: "FR true200", geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2, locale: "fr" } },
  { name: "AR coarse320", geometry: { viewport: { width: 320, height: 800 }, zoom: 1, locale: "ar", hasTouch: true } },
  { name: "JA768", geometry: { viewport: { width: 768, height: 900 }, zoom: 1, locale: "ja" } },
];
test.beforeEach(async ({ baseURL }, testInfo) => {
  expect(process.env.FORMA_A11Y_SYNTHETIC_NETWORK, "Retained finite transport is required").toBe("1");
  expect(process.env.FORMA_A11Y_E11_COPY, "Only the explicit additive E11 project owns these cases").toBe("1");
  expect(testInfo.project.name).toBe("e11-copy-locales");
  expect(baseURL).toBe(testInfo.project.use.baseURL);
  expect(baseURL).toBe("http://127.0.0.1:4186");
});
// External source fragment only: no imports, registrations or execution.
// Parent supplies expect and attachJSON. ctx supplies page and testInfo.
// ctx.currentOwner, when supplied, is one current real Forma owner Locator.
// An explicit allowedRoute requires ctx.currentOwner; final custody likewise
// uses the current owner if native navigation retired the original element.
// Only the six named UI values below are covered; allowedUi is an exact value
// override, not a suppression list. Route is separate from source equality.

async function retainState(owner) {
  await expect(owner, "One actual E11 source owner").toHaveCount(1);
  return owner.evaluateHandle(element => {
    const store = element.store;
    const signals = ["events", "optimisticEvents", "content", "projection", "session", "documentJobs", "head", "route"];
    if (!element.isConnected || !store || signals.some(key => typeof store[key]?.get !== "function") || !store.ui)
      throw new Error("Require the current connected Forma owner and its declared Store signals");
    const uiKeys = ["focusBlockId", "editingBlockId", "selectedOutputId", "focusCollectionId", "libraryView", "libraryOutputScope"];
    const read = () => {
      const projection = store.projection.get(), presented = projection.presentedBriefItems;
      if (!(presented instanceof Set) || [...presented].some(value => typeof value !== "string"))
        throw new Error("Require CreativeProjection.presentedBriefItems as the declared Set<string>");
      const events = store.events.get();
      if (!Array.isArray(events) || uiKeys.some(key => typeof store.ui[key] !== "string"))
        throw new Error("Require the declared event array and six string UI fields");
      return {
        source: {
          events: JSON.stringify(events), eventCount: events.length,
          optimisticEvents: JSON.stringify(store.optimisticEvents.get()),
          content: JSON.stringify(store.content.get()),
          projection: JSON.stringify({ ...projection, presentedBriefItems: { type: "Set<string>", values: [...presented] } }),
          session: JSON.stringify(store.session.get()), jobs: JSON.stringify(store.documentJobs.get()), head: store.head.get(),
        },
        ui: Object.fromEntries(uiKeys.map(key => [key, store.ui[key]])),
        route: store.route.get(), href: element.ownerDocument.location.href,
      };
    };
    const original = read();
    return { original, inspect: currentOwner => {
      const current = currentOwner ?? element;
      return {
        retainedOwner: { connected: element.isConnected, sameStore: element.store === store, localName: element.localName },
        currentOwner: { connected: Boolean(current?.isConnected), sameStore: current?.store === store,
          sameDocument: current?.ownerDocument === element.ownerDocument, sameAsOriginal: current === element,
          localName: current?.localName ?? null },
        current: read(),
      };
    } };
  });
}

async function assertState(ctx, held, stage, { allowedUi = {}, allowedRoute } = {}) {
  const uiKeys = ["focusBlockId", "editingBlockId", "selectedOutputId", "focusCollectionId", "libraryView", "libraryOutputScope"];
  const explicitRoute = allowedRoute !== undefined;
  if (!allowedUi || typeof allowedUi !== "object" || Array.isArray(allowedUi)
    || Object.keys(allowedUi).some(key => !uiKeys.includes(key) || typeof allowedUi[key] !== "string"))
    throw new Error("allowedUi must contain only exact string overrides of the six retained UI fields");
  if (explicitRoute && (typeof allowedRoute !== "string" || !allowedRoute.startsWith("/") || allowedRoute.startsWith("//")))
    throw new Error("allowedRoute must be one exact application-relative route string");
  if (explicitRoute && !ctx.currentOwner)
    throw new Error("An explicit route transition requires ctx.currentOwner as the actual current Forma owner Locator");
  let currentOwner, result, primary;
  try {
    if (ctx.currentOwner) {
      await expect(ctx.currentOwner, stage + ": one current route owner").toHaveCount(1);
      currentOwner = await ctx.currentOwner.elementHandle();
      expect(currentOwner, stage + ": retain current owner identity").not.toBeNull();
    }
    result = await held.evaluate((state, element) => ({ original: state.original, ...state.inspect(element) }), currentOwner ?? null);
    const route = explicitRoute ? allowedRoute : result.original.route;
    const expectedHref = new URL(route, result.original.href).href;
    const expectedUi = { ...result.original.ui, ...allowedUi };
    await attachJSON(ctx.testInfo, stage, { ...result, expectedUi, allowedUi, expectedRoute: route,
      expectedHref, explicitRoute, currentOwnerSupplied: Boolean(ctx.currentOwner), pageURL: ctx.page.url(),
      limit: "Exact JSON-serializable values of the named events/optimistic/content/projection/session/jobs/head fields; presentedBriefItems is explicitly Set<string>. Six named UI strings and exact route/URL are checked separately. Private caches, other UI fields, non-JSON payload objects, DOM drafts and native focus are not covered by this receipt." });
    expect(result.currentOwner, stage + ": actual current owner still holds the retained Store")
      .toMatchObject({ connected: true, sameStore: true, sameDocument: true });
    if (!ctx.currentOwner)
      expect(result.retainedOwner, stage + ": unchanged-route original owner").toMatchObject({ connected: true, sameStore: true });
    expect(result.original.source.eventCount, stage + ": nonempty source").toBeGreaterThan(0);
    expect(result.original.source.head, stage + ": nonzero head").toBeGreaterThan(0);
    expect(result.current.source, stage + ": raw source and typed projection remain unchanged").toEqual(result.original.source);
    expect(result.current.ui, stage + ": exact UI values and only named overrides").toEqual(expectedUi);
    expect(result.current.route, stage + ": exact Store route").toBe(route);
    expect(result.current.href, stage + ": exact document URL").toBe(expectedHref);
    expect(ctx.page.url(), stage + ": exact browser URL").toBe(expectedHref);
  } catch (error) { primary = error; }
  await finish(primary, currentOwner);
  return result;
}

async function finish(primary, ...handles) {
  const failures = primary === undefined || primary === null ? [] : [primary];
  for (const handle of handles) {
    try { await handle?.dispose(); } catch (error) { failures.push(error); }
  }
  if (failures.length > 1) throw new AggregateError(failures, "E11 primary observation and independent handle disposal failed");
  if (failures.length) throw failures[0];
}

async function assertSeed(ctx, owner) {
  // Call once at a fresh admitted entry, before local route/UI actions. This
  // intentionally does not accept any convenient count from {12,23,24}.
  // route-capabilities.ts: Projects uses projects; Document/Library use workspace.
  // The fixed transport has 24 total events/head24, but workspace omits event22
  // (ComparisonOpened), while projects returns the exact 12 structural receipts.
  const documentPath = "/document/doc-atmosphere/atmosphere-studies";
  const routeProfiles = new Map([["/projects", "projects"], [documentPath, "workspace"],
    ["/library?document=doc-atmosphere", "workspace"]]);
  await expect(owner, "One current finite-seed owner").toHaveCount(1);
  const seed = await owner.evaluate(element => {
    const store = element.store;
    if (!element.isConnected || !store?.events?.get || !store?.projection?.get || !store?.head?.get
      || !store?.optimisticEvents?.get || !store?.content?.get || !store?.documentJobs?.get || !store?.route?.get)
      throw new Error("Require actual current finite-seed Store signals");
    const p = store.projection.get(), presented = p.presentedBriefItems;
    if (!(presented instanceof Set) || [...presented].some(value => typeof value !== "string"))
      throw new Error("Require the declared presentedBriefItems Set<string>, never infer a selection Set");
    const standalone = p.libraryBlocks.filter(block => block.scope === "library");
    const targeted = new Set(p.libraryBlockRelations.map(relation => relation.toBlockId));
    const roots = standalone.filter(block => block.type !== "reference" || !targeted.has(block.id));
    const previousOutputs = p.libraryOutputs.filter(output => Boolean(output.mediaUrl) && !output.discarded);
    return {
      connected: element.isConnected, owner: element.localName, route: store.route.get(), href: location.href,
      head: store.head.get(), eventCount: store.events.get().length,
      events: store.events.get().map(event => ({ sequence: event.sequence, eventId: event.eventId, type: event.type })),
      optimisticEvents: store.optimisticEvents.get(), content: store.content.get(), jobs: store.documentJobs.get(),
      projectId: p.projectId, projectName: p.projectName, documentId: p.documentId, documentTitle: p.documentTitle,
      documents: p.documents.map(item => ({ id: item.id, projectId: item.projectId, title: item.title })),
      blocks: p.blocks.map(item => ({ id: item.id, scope: item.scope, documentId: item.documentId, projectId: item.projectId })),
      libraryBlocks: p.libraryBlocks.map(item => ({ id: item.id, scope: item.scope, documentId: item.documentId, projectId: item.projectId })),
      outputs: p.outputs.map(item => ({ id: item.id, documentId: item.documentId, standalone: item.standalone,
        mediaUrl: item.mediaUrl, discarded: item.discarded, library: item.library, saved: item.saved })),
      libraryOutputs: p.libraryOutputs.map(item => ({ id: item.id, documentId: item.documentId, standalone: item.standalone,
        mediaUrl: item.mediaUrl, discarded: item.discarded, library: item.library, saved: item.saved })),
      collections: p.collections.map(item => ({ id: item.id, handle: item.handle })), membership: p.membership,
      artifacts: p.artifacts, libraryArtifacts: p.libraryArtifacts,
      projectCounts: p.projects.map(item => ({ id: item.id, documentCount: item.documentCount,
        blockCount: item.blockCount, outputCount: item.outputCount, collectionCount: item.collectionCount, artifactCount: item.artifactCount })),
      studioReuse: { libraryScopeBlockIds: standalone.map(item => item.id), rootIds: roots.map(item => item.id),
        eligiblePreviousOutputIds: previousOutputs.map(item => item.id), artifactIds: p.libraryArtifacts.map(item => item.id),
        hasPreviousWork: p.libraryArtifacts.length > 0 || previousOutputs.length > 0 },
      presentedBriefItems: { type: "Set<string>", values: [...presented] },
    };
  });
  const profile = routeProfiles.get(seed.route);
  const expectedSequences = profile === "projects" ? [1, 2, 7, 9, 10, 12, 13, 14, 18, 20, 21, 24]
    : profile === "workspace" ? Array.from({ length: 24 }, (_, index) => index + 1).filter(sequence => sequence !== 22) : [];
  const eventTypes = ["ProjectCreated", "DocumentCreated", "ModelRegistered", "AdapterVersioned", "CapabilityDeclared",
    "SessionOpened", "BlockCreated", "ReferenceIngested", "BlockCreated", "BlockCreated", "ExtractionCompleted",
    "CollectionCreated", "CollectionCreated", "CollectionCreated", "CollectionItemAdded", "FamilyDeclared", "ContextCompiled",
    "GenerationCompleted", "ContextCompiled", "GenerationCompleted", "ObjectPinned", "ComparisonOpened", "ConditionSet", "BlockCreated"];
  await attachJSON(ctx.testInfo, "e11-positive-seed", { ...seed, expectedProfile: profile ?? null, expectedSequences,
    declaredTransportTotalEvents: 24,
    limit: "Fresh admitted-route finite synthetic seed witness. Head24 does not mean Store24 events: Projects requires12 and Document/Library23. Full24 is transport-declared but no planned fresh E11 route requests it. No populated kept output, reusable Library block, media-bearing previous output or artifact is fabricated." });
  expect(profile, "Seed witness must run at one of the three fresh admitted E11 entry routes").toBeTruthy();
  expect(seed.connected).toBe(true);
  const url = new URL(ctx.page.url());
  expect(url.pathname + url.search + url.hash).toBe(seed.route);
  expect(seed.href).toBe(ctx.page.url());
  expect(seed.head).toBe(24);
  expect(seed.eventCount).toBe(expectedSequences.length);
  expect(seed.events).toEqual(expectedSequences.map(sequence => ({ sequence, eventId: `e6-network-event-${sequence}`, type: eventTypes[sequence - 1] })));
  expect(seed.optimisticEvents).toEqual([]);
  expect(seed.content).toEqual({});
  expect(seed.jobs).toEqual([]);
  expect(seed).toMatchObject({ projectId: "project-atmosphere", projectName: "Studio launch",
    documentId: "doc-atmosphere", documentTitle: "Atmosphere studies" });
  expect(seed.documents).toEqual([{ id: "doc-atmosphere", projectId: "project-atmosphere", title: "Atmosphere studies" }]);
  const blockIds = ["block-direction", "block-reference", "block-palette", "e6-network-fourth-decision"];
  const blocks = blockIds.map(id => ({ id, scope: "document", documentId: "doc-atmosphere", projectId: "project-atmosphere" }));
  expect(seed.blocks).toEqual(blocks);
  expect(seed.libraryBlocks).toEqual(blocks);
  const outputs = ["object-nocturne-02", "object-nocturne-01"].map(id => ({ id, documentId: "doc-atmosphere",
    standalone: true, mediaUrl: null, discarded: false, library: false, saved: false }));
  expect(seed.outputs).toEqual(outputs);
  expect(seed.libraryOutputs).toEqual(outputs);
  expect([...seed.collections].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
    { id: "collection-acme", handle: "acme" }, { id: "collection-client", handle: "client-work" },
    { id: "collection-studio", handle: "studio-launch" }]);
  expect(seed.artifacts).toEqual([]);
  expect(seed.libraryArtifacts).toEqual([]);
  expect(seed.projectCounts).toEqual([{ id: "project-atmosphere", documentCount: 1,
    blockCount: 4, outputCount: 2, collectionCount: 3, artifactCount: 0 }]);
  expect(seed.studioReuse).toEqual({ libraryScopeBlockIds: [], rootIds: [], eligiblePreviousOutputIds: [], artifactIds: [], hasPreviousWork: false });
  expect(seed.presentedBriefItems).toEqual({ type: "Set<string>", values: [] });
  if (profile === "projects") expect(seed.membership).toEqual({});
  else expect(seed.membership["doc-atmosphere"]).toMatchObject({ collectionId: "collection-studio" });
  return seed;
}
// E11 caller-only observations. Existing fixture, native focus observer and
// ordinary-copy collector remain unchanged; no focus/scroll/style repairs.
const e11LayerPeers = [
  'forma-reality-layers form.layer-inspector[data-layer-inspector="e6-network-fourth-decision"] > label > :is(input,textarea,select)',
  'forma-reality-layers form.layer-inspector[data-layer-inspector="e6-network-fourth-decision"] > :is(header,footer) > button',
  'forma-reality-layers .layers-panel > ol > li.selected button',
];
const e11Overlays = [".forma-assistant-launcher", ":popover-open", ":modal", ".topbar",
  '.workspace-page[data-workbench="document"] > forma-project-rail',
  ".studio-header-stack > forma-studio-mode-nav > .studio-mode-nav", ...e11LayerPeers];
const e11Critical = [".output-recipe-entry", ".output-requirement-warning", "forma-ui-notice", ...e11LayerPeers];
const e11Scopes = {
  projects: { owner: "forma-projects .projects-grid > article.project-card.current > footer", controls: ":scope > button", count: 3,
    peers: ["forma-projects .projects-grid > article.project-card.current > footer > button"] },
  "studio-modal": { owner: "forma-workspace forma-studio-mode-nav[active=document] dialog.context-set-picker-dialog:modal > section.context-set-picker-panel",
    controls: "button, a[href]", count: null,
    peers: ["dialog.context-set-picker-dialog:modal > section.context-set-picker-panel button", "dialog.context-set-picker-dialog:modal > section.context-set-picker-panel a[href]"] },
  "view-popover": { owner: "forma-workspace forma-studio-mode-nav[active=document] forma-ui-popover.studio-view-menu > .ui-popover > section.ui-popover-panel:popover-open",
    controls: ":scope > nav.studio-view-options > a[data-studio-view]", count: 7,
    peers: ["forma-ui-popover.studio-view-menu > .ui-popover > section.ui-popover-panel:popover-open > nav.studio-view-options > a[data-studio-view]"] },
};
const locatorFor = (ctx, value) => typeof value === "string" ? ctx.page.locator(value) : value;
async function actualOwnerSelector(owner) {
  return owner.evaluate(element => {
    const known = ["forma-library forma-library-block-editor", "forma-library", "forma-projects",
      "forma-workspace", "forma-reality-layers",
      'forma-reality-layers form.layer-inspector[data-layer-inspector="e6-network-fourth-decision"]',
      'dialog.context-set-picker-dialog:modal > section.context-set-picker-panel'];
    const selector = known.find(value => element.matches(value) && document.querySelectorAll(value).length === 1);
    if (!selector) throw new Error("An explicit unique E11 owner selector is required");
    return selector;
  });
}
async function observeNative(ctx, target, stage, { owner, regions = [], scope = null } = {}) {
  const { page, testInfo } = ctx, ownerLocator = locatorFor(ctx, owner);
  await expect(ownerLocator).toHaveCount(1); await expect(target).toHaveCount(1);
  await expect(target).toBeFocused();
  const detected = await target.evaluate(element => element.closest("dialog.context-set-picker-dialog:modal") ? "studio-modal"
    : element.closest("section.ui-popover-panel:popover-open")?.closest("forma-ui-popover.studio-view-menu") ? "view-popover" : null);
  const kind = scope ?? detected, task = kind ? e11Scopes[kind] : null;
  if (kind && !task) throw new Error("Unknown E11 task boundary");
  const ownerHandle = await ownerLocator.elementHandle();
  expect(ownerHandle).not.toBeNull();
  let held, observation, before;
  const errors = [];
  try {
    held = await target.evaluateHandle((element, { owner, task, kind, layerSelectors }) => {
      const doc = element.ownerDocument, currentOwner = task ? doc.querySelector(task.owner) : owner;
      if (!currentOwner || !owner.contains(element) || !currentOwner.contains(element)) throw new Error("Current owner must contain the actual focused target");
      const peers = task ? [...currentOwner.querySelectorAll(task.controls)] : [];
      const layerForm = element.closest('forma-reality-layers form.layer-inspector[data-layer-inspector="e6-network-fourth-decision"]');
      const layerOwner = layerForm?.closest("forma-reality-layers");
      const selectedLayer = layerOwner?.querySelector(".layers-panel > ol > li.selected");
      const layerPeers = layerForm ? [...new Set(layerSelectors.flatMap(selector => [...doc.querySelectorAll(selector)]))] : [];
      const dialog = kind === "studio-modal" ? currentOwner.parentElement : null;
      const popover = kind === "view-popover" ? currentOwner.closest("forma-ui-popover.studio-view-menu") : null;
      const trigger = popover?.querySelector(":scope > .ui-popover > button.ui-popover-trigger");
      const describe = node => ({ tag: node.tagName, id: node.id, text: node.textContent, type: node.type ?? null,
        ariaLabel: node.getAttribute("aria-label"), href: node.getAttribute("href"), disabled: Boolean(node.disabled) });
      return { inspect: () => {
        const current = task ? [...currentOwner.querySelectorAll(task.controls)] : [];
        return { kind, predicates: {
          originalOwner: owner.isConnected && owner.ownerDocument === doc && owner.contains(element),
          actualFocus: element.isConnected && doc.activeElement === element && doc.hasFocus() && element.matches(":focus-visible"),
          uniqueTaskOwner: !task || doc.querySelectorAll(task.owner).length === 1 && doc.querySelector(task.owner) === currentOwner,
          retainedTaskPeers: !task || current.length === peers.length && peers.includes(element)
            && peers.every((peer, i) => peer.isConnected && current[i] === peer),
          exactPeerCount: !task || (task.count === null ? [3].includes(peers.length) : peers.length === task.count),
          actualLayersPeerScope: !layerForm || layerOwner.isConnected && layerForm.isConnected
            && layerOwner.querySelectorAll('form.layer-inspector[data-layer-inspector="e6-network-fourth-decision"]').length === 1
            && layerOwner.querySelector('form.layer-inspector[data-layer-inspector="e6-network-fourth-decision"]') === layerForm
            && layerOwner.querySelectorAll(".layers-panel > ol > li.selected").length === 1
            && layerOwner.querySelector(".layers-panel > ol > li.selected") === selectedLayer
            && selectedLayer.querySelector(":scope > button.layer-name > b")?.textContent === "direction/synthetic-custody"
            && layerForm.querySelectorAll("input,textarea,select,button").length === 8
            && selectedLayer.querySelectorAll("button").length === 5 && layerPeers.length === 13
            && layerPeers.every((peer, index) => peer.isConnected
              && [...new Set(layerSelectors.flatMap(selector => [...doc.querySelectorAll(selector)]))][index] === peer
              && (layerForm.contains(peer) && peer.form === layerForm || selectedLayer.contains(peer) && peer instanceof HTMLButtonElement)),
          projectsFooter: kind !== "projects" || currentOwner.parentElement.matches("article.project-card.current")
            && currentOwner.parentElement.querySelector(".project-card-title > h2")?.textContent === "Studio launch"
            && peers.every(peer => peer instanceof HTMLButtonElement && peer.parentElement === currentOwner),
          actualModal: kind !== "studio-modal" || dialog instanceof HTMLDialogElement && dialog.open && dialog.matches(":modal")
            && doc.querySelectorAll(":modal").length === 1 && dialog.querySelector(":scope > section.context-set-picker-panel") === currentOwner
            && dialog.getAttribute("aria-labelledby") === "context-set-picker-title"
            && doc.querySelectorAll("#context-set-picker-title").length === 1
            && currentOwner.querySelector("header > h2#context-set-picker-title") === doc.getElementById("context-set-picker-title")
            && peers.every(peer => peer instanceof HTMLButtonElement && peer.form === null || peer instanceof HTMLAnchorElement),
          actualPopover: kind !== "view-popover" || currentOwner.matches(":popover-open") && currentOwner.getAttribute("popover") === "auto"
            && popover.isConnected && currentOwner.closest("forma-ui-popover.studio-view-menu") === popover
            && popover.querySelectorAll(":scope > .ui-popover > section.ui-popover-panel").length === 1
            && popover.querySelector(":scope > .ui-popover > section.ui-popover-panel") === currentOwner
            && trigger instanceof HTMLButtonElement && trigger.isConnected && trigger.ownerDocument === doc
            && popover.querySelectorAll(":scope > .ui-popover > button.ui-popover-trigger").length === 1
            && popover.querySelector(":scope > .ui-popover > button.ui-popover-trigger") === trigger
            && trigger.getAttribute("aria-expanded") === "true"
            && trigger.getAttribute("aria-controls") === currentOwner.id
            && doc.querySelectorAll("#" + CSS.escape(currentOwner.id)).length === 1
            && peers.every(peer => peer instanceof HTMLAnchorElement && peer.parentElement === currentOwner.querySelector(":scope > nav.studio-view-options")),
        }, peers: peers.map(describe), layersPeers: layerPeers.map(describe), target: describe(element),
        scope: task ? "Only the positively owned task controls are asserted as peer obstacles/body regions. The ENTIRE other-control inventory remains raw diagnostics, not a global clearance pass."
          : "Existing whole visible-control census remains asserted at this ordinary stage." };
      } };
    }, { owner: ownerHandle, task, kind, layerSelectors: e11LayerPeers });
    before = await held.evaluate(value => value.inspect());
    await expect(ownerLocator).toHaveCount(1);
    before.predicates.currentLocatorOwner = await ownerLocator.evaluate((element, original) => element === original, ownerHandle);
    await attachJSON(testInfo, stage + "-native-owner-before", before);
    for (const [key, value] of Object.entries(before.predicates)) expect(value, stage + ": " + key).toBe(true);
    if (task) {
      const census = await target.evaluate(measureFormaFocusVisibility, { stage, requireFocusVisible: true,
        overlaySelectors: e11Overlays, regionSelectors: [...e11Critical, ...regions], checkVisibleControls: true });
      await attachJSON(testInfo, stage + "-full-census-diagnostic", { observation: census, limit: before.scope });
    }
    observation = await verifyFocus(page, target, testInfo, stage, {
      overlaySelectors: [...e11Overlays, ...(task?.peers ?? [])],
      regionSelectors: [...e11Critical, ...regions, ...(task?.peers ?? [])], checkVisibleControls: !task,
    });
    expect(observation.focus.raw.width, stage + ": native width").toBeGreaterThanOrEqual(44);
    expect(observation.focus.raw.height, stage + ": native height").toBeGreaterThanOrEqual(44);
  } catch (error) { errors.push(error); }
  // Keep the independent ownership/focus boundary even when strict geometry or
  // its capture fails. A failed boundary remains a failed observation.
  if (held) try {
    const after = await held.evaluate(value => value.inspect());
    after.predicates.currentLocatorOwner = await ownerLocator.count() === 1
      && await ownerLocator.evaluate((element, original) => element === original, ownerHandle);
    await attachJSON(testInfo, stage + "-native-owner-after", after);
    for (const [key, value] of Object.entries(after.predicates)) expect(value, stage + ": after " + key).toBe(true);
    if (before) expect(after, stage + ": held owner, peers and native focus through strict capture").toEqual(before);
  } catch (error) { errors.push(error); }
  await finish(errors.length > 1 ? new AggregateError(errors, "E11 native observation and owner boundary failed") : errors[0], held, ownerHandle);
  return observation;
}

// Direct LABEL text excludes nested SELECT OPTION copy and the separately
// observed OUTPUT. No text node, value, focus, style, or scroll position is set.
async function observeCopy(ctx, owner, focus, targets, stage) {
  const { page, testInfo } = ctx, ownerLocator = locatorFor(ctx, owner);
  await expect(ownerLocator).toHaveCount(1); await expect(focus).toHaveCount(1); await expect(focus).toBeFocused();
  expect(targets.length, stage + ": designated copy cannot be empty").toBeGreaterThan(0);
  const ownerSelector = typeof owner === "string" ? owner : await actualOwnerSelector(ownerLocator);
  const errors = [];
  let ownerHandle, focusHandle, held, beforeStrict, before, afterStrict, after;
  const collect = async (suffix, read) => {
    try { const value = await read(); await attachJSON(testInfo, stage + suffix, value); return value; }
    catch (error) { errors.push(error); return null; }
  };
  try {
    ownerHandle = await ownerLocator.elementHandle();
    expect(ownerHandle).not.toBeNull();
    focusHandle = await focus.elementHandle();
    expect(focusHandle).not.toBeNull();
    const mode = await focusHandle.evaluate(element => ({
      modal: Boolean(element.closest("dialog.context-set-picker-dialog:modal")),
      popover: Boolean(element.closest("section.ui-popover-panel:popover-open")?.closest("forma-ui-popover.studio-view-menu")),
      ordinary: Boolean(element.closest(".application-creative")?.querySelector("forma-assistant-panel > button.forma-assistant-launcher")),
    }));
    const scope = ownerSelector.includes("forma-projects") ? "projects" : mode.modal ? "studio-modal" : mode.popover ? "view-popover" : null;
    const task = scope ? e11Scopes[scope] : null;
    const regionSelectors = [...e11Critical, ...targets.map(target => target.selector), ...(task?.peers ?? [])];
    const strictOptions = { stage: stage + "-copy", requireFocusVisible: true,
      overlaySelectors: [...e11Overlays, ...(task?.peers ?? [])], regionSelectors, checkVisibleControls: !task };
    // Use the already captured owner, not a second locator resolution that could
    // silently acquire a replacement. All selected nodes remain held across readiness.
    held = await ownerHandle.evaluateHandle((element, { focus, targets, ownerSelector, regionSelectors }) => {
      const doc = element.ownerDocument, win = doc.defaultView;
      const copyTextNodes = (node, direct) => {
        if (direct) return [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE);
        const values = [], walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (let child = walker.nextNode(); child; child = walker.nextNode())
          if (!child.parentElement.closest("script,style,svg,.forma-icon")) values.push(child);
        return values;
      };
      const selected = targets.map(target => {
        const nodes = [...doc.querySelectorAll(target.selector)];
        if (nodes.length !== 1 || !element.contains(nodes[0])) throw new Error("Every designated copy leaf must have one actual owner");
        const node = nodes[0], direct = target.text === "direct";
        if (direct && !(node instanceof HTMLLabelElement)) throw new Error("Direct copy mode is reserved for an actual native LABEL");
        return { node, textNodes: copyTextNodes(node, direct), target };
      });
      // Exact unchanged focus-helper order: breadth-first open roots, then
      // selectors per root, then querySelectorAll order, with Set deduplication.
      const inventory = () => {
        const roots = [doc];
        for (let index = 0; index < roots.length; index += 1)
          for (const node of roots[index].querySelectorAll("*")) if (node.shadowRoot) roots.push(node.shadowRoot);
        return { roots, nodes: [...new Set(roots.flatMap(root => regionSelectors.flatMap(selector => [...root.querySelectorAll(selector)])))] };
      };
      const rect = value => ({ left: value.left, top: value.top, right: value.right, bottom: value.bottom,
        width: value.width, height: value.height });
      const describe = node => ({ tag: node.tagName, id: node.id || null,
        className: node.getAttribute("class"), role: node.getAttribute("role"), ariaLabel: node.getAttribute("aria-label") });
      let regionNodes = null, regionRoots = null;
      return {
        bindRegions: () => { const current = inventory(); regionNodes = current.nodes; regionRoots = current.roots; },
        inspect: () => {
          if (!regionNodes || !regionRoots) throw new Error("Bind the strict region inventory after existing native readiness");
          const currentInventory = inventory();
          return {
            sameOwner: element.isConnected && element.ownerDocument === doc
              && doc.querySelectorAll(ownerSelector).length === 1 && doc.querySelector(ownerSelector) === element,
            sameFocus: focus.isConnected && element.contains(focus) && doc.activeElement === focus && focus.matches(":focus-visible") && doc.hasFocus(),
            viewport: { width: win.innerWidth, height: win.innerHeight, scrollX: win.scrollX, scrollY: win.scrollY },
            regionInventory: {
              sameRoots: currentInventory.roots.length === regionRoots.length && regionRoots.every((root, index) => currentInventory.roots[index] === root),
              sameNodes: currentInventory.nodes.length === regionNodes.length && regionNodes.every((node, index) => currentInventory.nodes[index] === node && node.isConnected),
              openShadowRoots: currentInventory.roots.length - 1,
              nodes: currentInventory.nodes.map((node, index) => ({ index, originalNode: regionNodes[index] === node,
                element: describe(node), raw: rect(node.getBoundingClientRect()) })),
            },
            copy: selected.map(({ node, textNodes, target }) => {
              const direct = target.text === "direct", current = copyTextNodes(node, direct);
              const texts = textNodes.map((text, textIndex) => {
                const range = doc.createRange(); range.selectNodeContents(text);
                const style = win.getComputedStyle(text.parentElement), ancestry = [];
                for (let parent = text.parentElement; parent; parent = parent.parentElement) {
                  const s = win.getComputedStyle(parent);
                  ancestry.push({ tag: parent.tagName, belowRegion: parent !== node && node.contains(parent),
                    hidden: parent.hidden, inert: parent.inert, ariaHidden: parent.getAttribute("aria-hidden"),
                    display: s.display, visibility: s.visibility, opacity: s.opacity, textOverflow: s.textOverflow,
                    lineClamp: s.webkitLineClamp, textShadow: s.textShadow, writingMode: s.writingMode,
                    transform: s.transform, translate: s.translate, rotate: s.rotate, scale: s.scale, perspective: s.perspective,
                    zoom: s.zoom, clip: s.clip, clipPath: s.clipPath, maskImage: s.maskImage, filter: s.filter,
                    backdropFilter: s.backdropFilter, contain: s.contain, overflowX: s.overflowX, overflowY: s.overflowY,
                    contentVisibility: s.contentVisibility, scrollTop: parent.scrollTop, scrollLeft: parent.scrollLeft });
                  if (parent.matches(":modal,:popover-open")) break;
                }
                const clientRects = [...range.getClientRects()].map(rect);
                return { textIndex, text: text.textContent, nonempty: Boolean(text.textContent.trim()),
                  originalTextNode: text.isConnected && node.contains(text) && current[textIndex] === text,
                  color: style.color, textFillColor: style.webkitTextFillColor, ancestry, clientRects,
                  fragments: clientRects.filter(value => value.width > 0 && value.height > 0) };
              });
              const regionIndex = currentInventory.nodes.indexOf(node), originalRegionIndex = regionNodes.indexOf(node);
              return { selector: target.selector, expected: target.expected, direct, element: describe(node), raw: rect(node.getBoundingClientRect()),
                originalNode: node.isConnected && element.contains(node) && doc.querySelectorAll(target.selector).length === 1
                  && doc.querySelector(target.selector) === node,
                originalTextNodes: current.length === textNodes.length && textNodes.every((text, index) => current[index] === text && text.isConnected && node.contains(text)),
                regionIndex, originalRegionIndex, sameRegionNode: regionIndex >= 0 && originalRegionIndex === regionIndex
                  && currentInventory.nodes[regionIndex] === node && regionNodes[regionIndex] === node,
                text: textNodes.map(text => text.textContent).join(""), texts };
            }),
          };
        },
      };
    }, { focus: focusHandle, targets, ownerSelector, regionSelectors });

    // Existing readiness is first and unchanged. A failed readiness observation
    // remains a hard failure; the one later transaction may still retain its
    // actual diagnostic copy and image without repairing focus or scrolling.
    try { await observeNative(ctx, focus, stage, { owner: ownerLocator, regions: targets.map(target => target.selector), scope }); }
    catch (error) { errors.push(error); }

    // The unchanged ordinary collector is asserted only at its real premise.
    // Native modal rejection is preserved. Direct LABEL descendant collection
    // is diagnostic; a mixed batch gets a separate asserted non-direct sample.
    if (mode.ordinary) {
      const launcher = page.locator("forma-assistant-panel > button.forma-assistant-launcher");
      await expect(launcher).toHaveCount(1);
      const launcherHandle = await launcher.elementHandle();
      let ordinaryError;
      try {
        const batches = mode.modal ? [{ selected: targets, kind: "modal-diagnostic" }] : [
          ...(targets.some(target => target.text === "direct") ? [{ selected: targets.filter(target => target.text === "direct"), kind: "direct-label-diagnostic" }] : []),
          ...(targets.some(target => target.text !== "direct") ? [{ selected: targets.filter(target => target.text !== "direct"), kind: "ordinary-asserted" }] : []),
        ];
        for (const batch of batches) {
          const ordinary = await ownerHandle.evaluate(measureOrdinaryCopy, { focus: focusHandle, launcher: launcherHandle,
            ownerSelector, selectors: batch.selected.map(target => target.selector), primarySelector: batch.selected[0].selector });
          await attachJSON(testInfo, stage + "-ordinary-copy-" + batch.kind, { observation: ordinary, disposition: batch.kind,
            limit: batch.kind === "direct-label-diagnostic"
              ? "Whole-LABEL descendants are diagnostic; only each held direct text node and its unchanged strict clip support direct-copy acceptance."
              : batch.kind === "modal-diagnostic" ? "Native modal top-layer rejection retained; no ordinary modal-clearance claim." : null });
          if (batch.kind === "modal-diagnostic") expect(ordinary.issues).toContain("ordinary-copy frame still has a native top layer");
          else if (batch.kind === "ordinary-asserted") {
            expect(ordinary.issues).toEqual([]); expect(ordinary.unassessed).toEqual([]); expect(ordinary.observedObstructions).toEqual([]);
          } else {
            for (const issue of ["current owner/launcher/native focus identity changed", "ordinary-copy frame still has a native top layer",
              "ordinary page does not have the expected floating Assistant owner", "current launcher is not visibly laid out"])
              expect(ordinary.issues, stage + ": direct mode does not waive the ordinary owner premise").not.toContain(issue);
            expect(ordinary.unassessed.filter(item => item.kind === "launcher-geometry")).toEqual([]);
          }
        }
      } catch (error) { ordinaryError = error; }
      try { await finish(ordinaryError, launcherHandle); } catch (error) { errors.push(error); }
    } else expect(mode.modal, "Only this positively owned native modal can be outside the ordinary floating-Assistant premise").toBe(true);

    await held.evaluate(value => value.bindRegions());
    // Exactly one pre-measure/sample, one dedicated native viewport capture,
    // and one post-measure/sample. No new wait, retry, repair or recapture.
    beforeStrict = await collect("-copy-strict-before", () => focusHandle.evaluate(measureFormaFocusVisibility, strictOptions));
    before = await collect("-full-copy-before", () => held.evaluate(value => value.inspect()));
    try { await captureViewport(page, testInfo, stage + "-copy"); } catch (error) { errors.push(error); }
    afterStrict = await collect("-copy-strict-after", () => focusHandle.evaluate(measureFormaFocusVisibility, strictOptions));
    after = await collect("-full-copy-after", () => held.evaluate(value => value.inspect()));

    const rectFields = ["left", "top", "right", "bottom", "width", "height"];
    const assertRect = (actual, expected, label) => {
      for (const key of rectFields) {
        expect(Number.isFinite(actual?.[key]), label + ": finite " + key).toBe(true);
        expect(actual[key], label + ": " + key).toBe(expected[key]);
      }
    };
    const transparent = color => color === "transparent"
      || /^rgba\([^,]+,[^,]+,[^,]+,\s*0(?:\.0+)?\s*\)$/.test(color)
      || /\/\s*0(?:\.0+)?%?\s*\)$/.test(color);
    const assertSample = (sample, strict, suffix) => {
      expect(sample, stage + suffix + ": copy sample exists").not.toBeNull();
      expect(strict, stage + suffix + ": strict sample exists").not.toBeNull();
      expect(strict.failures).toEqual([]); expect(strict.unassessed).toEqual([]);
      expect(strict.focus.active && strict.focus.documentHasFocus && strict.focus.focusVisible).toBe(true);
      expect(strict.focus.raw.width).toBeGreaterThanOrEqual(44); expect(strict.focus.raw.height).toBeGreaterThanOrEqual(44);
      expect(sample.sameOwner && sample.sameFocus).toBe(true);
      expect(sample.regionInventory.sameRoots && sample.regionInventory.sameNodes).toBe(true);
      expect(sample.regionInventory.openShadowRoots).toBe(strict.coverage.openShadowRoots);
      expect(sample.regionInventory.nodes).toHaveLength(strict.regions.length);
      expect(strict.coverage.regionSelectors).toEqual(regionSelectors);
      for (const entry of sample.regionInventory.nodes) {
        expect(entry.originalNode).toBe(true);
        expect(strict.regions[entry.index].element).toEqual(entry.element);
        assertRect(strict.regions[entry.index].raw, entry.raw, stage + suffix + ": region " + entry.index);
      }
      expect(sample.copy).toHaveLength(targets.length);
      for (const item of sample.copy) {
        expect(item.originalNode && item.originalTextNodes && item.sameRegionNode).toBe(true);
        expect(item.regionIndex).toBeGreaterThanOrEqual(0); expect(item.regionIndex).toBe(item.originalRegionIndex);
        expect(item.text).toBe(item.expected);
        const region = strict.regions[item.regionIndex];
        expect(region.element).toEqual(item.element); assertRect(region.raw, item.raw, stage + suffix + ": designated region");
        expect(region.unknown).toEqual([]); expect(region.paintedBox).toBe(true); expect(region.collisions).toEqual([]);
        const nonempty = item.texts.filter(text => text.nonempty);
        expect(nonempty.length, stage + ": each designated leaf needs nonempty native text").toBeGreaterThan(0);
        for (const text of item.texts) {
          expect(text.originalTextNode).toBe(true);
          if (!text.nonempty) continue;
          expect(text.fragments.length, stage + ": every nonempty text node needs positive rectangles").toBeGreaterThan(0);
          expect(transparent(text.color) || transparent(text.textFillColor)).toBe(false);
          for (const ancestor of text.ancestry) {
            expect(ancestor.hidden || ancestor.inert || ancestor.ariaHidden === "true").toBe(false);
            expect(ancestor.display).not.toBe("none"); expect(ancestor.visibility).toBe("visible"); expect(Number(ancestor.opacity)).toBe(1);
            expect(ancestor.textOverflow).not.toBe("ellipsis"); expect(["none", "0"].includes(ancestor.lineClamp)).toBe(true);
            expect(ancestor.textShadow).toBe("none"); expect(ancestor.writingMode).toBe("horizontal-tb");
            if (ancestor.belowRegion) {
              for (const key of ["transform", "translate", "rotate", "scale", "perspective", "clipPath", "maskImage", "filter", "backdropFilter"])
                expect(["", "none"].includes(ancestor[key]), stage + ": unsupported descendant " + key).toBe(true);
              expect(["", "normal", "1"].includes(ancestor.zoom)).toBe(true); expect(ancestor.clip).toBe("auto");
              expect(/(^|\s)(paint|strict|content)(\s|$)/.test(ancestor.contain)).toBe(false);
              expect(ancestor.overflowX).toBe("visible"); expect(ancestor.overflowY).toBe("visible");
              expect(["", "visible"].includes(ancestor.contentVisibility)).toBe(true);
            }
          }
          for (const fragment of text.fragments) {
            // The strict region's obstacles are checked against its border box.
            // A complete line must also fit that exact node's inline bounds.
            expect(fragment.left).toBeGreaterThanOrEqual(item.raw.left);
            expect(fragment.right).toBeLessThanOrEqual(item.raw.right);
            expect(fragment.left).toBeGreaterThanOrEqual(region.intersection.left); expect(fragment.right).toBeLessThanOrEqual(region.intersection.right);
            expect(fragment.top).toBeGreaterThanOrEqual(region.intersection.top); expect(fragment.bottom).toBeLessThanOrEqual(region.intersection.bottom);
            expect(fragment.left).toBeGreaterThanOrEqual(0); expect(fragment.top).toBeGreaterThanOrEqual(0);
            expect(fragment.right).toBeLessThanOrEqual(sample.viewport.width); expect(fragment.bottom).toBeLessThanOrEqual(sample.viewport.height);
          }
        }
      }
    };
    try { assertSample(before, beforeStrict, " before"); } catch (error) { errors.push(error); }
    try { assertSample(after, afterStrict, " after"); } catch (error) { errors.push(error); }
    try {
      expect(after, stage + ": equal held ownership, text, Range, ancestry and scroll samples across the dedicated capture").toEqual(before);
      const geometry = value => ({ url: value.url, lang: value.lang, dir: value.dir, viewport: value.viewport, focus: value.focus,
        coverage: value.coverage, overlays: value.overlays, overlayPaintOrderProofs: value.overlayPaintOrderProofs, regions: value.regions });
      expect(geometry(afterStrict), stage + ": equal strict focus, clipping and obstacle geometry across the dedicated capture").toEqual(geometry(beforeStrict));
    } catch (error) { errors.push(error); }
    await attachJSON(testInfo, stage + "-copy-verdict", { completeDesignatedLeaves: errors.length === 0,
      leaves: targets.map(target => target.selector), failures: errors.map(error => ({ name: error.name, message: error.message })),
      verticalFontOverhang: [before, after].map(sample => sample?.copy.flatMap(item => item.texts.flatMap(text => text.fragments
        .filter(fragment => fragment.top < item.raw.top || fragment.bottom > item.raw.bottom)
        .map(fragment => ({ selector: item.selector, textIndex: text.textIndex, fragment, owner: item.raw })))) ?? null),
      scope: "Every designated nonempty held text node fits its exact node's inline bounds and supported strict ancestor clips/viewport. Vertical font-layout overhang is retained as diagnostics, not glyph-ink proof. Strict obstacles and the dedicated native capture remain required. Equal samples are not continuous or permanent settlement or AT proof." });
  } catch (error) { errors.push(error); }
  await finish(errors.length > 1 ? new AggregateError(errors, "E11 copy transaction or custody failed") : errors[0], held, focusHandle, ownerHandle);
}

async function openDocument(ctx) {
  await openForma(ctx.page, ctx.context, ctx.geometry, documentPath, ctx.testInfo);
  await waitForExistingDocument(ctx.page);
  const owner = ctx.page.locator("forma-workspace"); await expect(owner).toHaveCount(1);
  ctx.currentOwner = owner; await profileWitness(ctx); await assertSeed(ctx, owner); return owner;
}
async function openLibrary(ctx) {
  await openForma(ctx.page, ctx.context, ctx.geometry, "/library?document=doc-atmosphere", ctx.testInfo);
  const owner = ctx.page.locator("forma-library"); await expect(owner).toHaveCount(1);
  await expect(owner.locator(".page-header--library")).toHaveCount(1);
  ctx.currentOwner = owner; await profileWitness(ctx); await assertSeed(ctx, owner); return owner;
}
async function profileWitness(ctx) {
  const { page, geometry, testInfo } = ctx;
  const value = await page.evaluate(() => ({ language: document.documentElement.lang, direction: document.documentElement.dir,
    coarse: matchMedia("(pointer: coarse)").matches, hoverNone: matchMedia("(hover: none)").matches, maxTouchPoints: navigator.maxTouchPoints }));
  expect(value.language).toBe(geometry.locale ?? "en-US"); expect(value.direction).toBe(geometry.locale === "ar" ? "rtl" : "ltr");
  if (geometry.hasTouch) { expect(value.coarse).toBe(true); expect(value.hoverNone).toBe(true); expect(value.maxTouchPoints).toBeGreaterThan(0); }
  await attachJSON(testInfo, "e11-profile", { ...value, geometry,
    limit: "Four explicit locale/profile cells, not a cross product. Real fixture browser zoom, Chromium coarse declaration, native selected-control44 floor; no physical-device, AT or unobserved locale/viewport claim." });
}
// Literal source/catalog oracle only; no imports, registration or execution.
// Parent can merge e11LayersCopy[locale] into its per-locale expected object.
// Direct Influence label source ends in one space; layersJourney appends it.
// Source references: layers-oracle-source-audit.md and layers-option-oracle.json.
// Document: system-{en,fr,ar,ja}.ts:4028 (system.auto.1wvusj8.8).
// View templates: responsive-messages.ts:24,183,340,497.
// Save: localization.ts:707 and {fr,ar,ja}.ts:694 (delivery.save).
// Discard: localization.ts:438 and {fr,ar,ja}.ts:425.
const e11LayersCopy = {
  en: {
    viewTrigger: "Change view · Document",
    layersView: "Reality layers",
    layers: {
      handle: "Short name",
      instructions: "What it should do",
      subtype: "Role",
      influence: "Influence on the result",
      save: "Save decision",
      discard: "Discard unsaved changes",
      optionLabels: ["Campaign goal", "Emotional outcome", "Behavioral objective", "Exploration question"],
    },
  },
  fr: {
    viewTrigger: "Changer de vue · Document",
    layersView: "Couches de réalité",
    layers: {
      handle: "Nom abrégé",
      instructions: "Ce que cela doit accomplir",
      subtype: "Rôle",
      influence: "Influence sur le résultat",
      save: "Enregistrer la décision",
      discard: "Abandonner les modifications non enregistrées",
      optionLabels: ["Objectif de la campagne", "Résultat émotionnel", "Objectif comportemental", "Question d’exploration"],
    },
  },
  ar: {
    viewTrigger: "تغيير العرض · مستند",
    layersView: "طبقات الواقع",
    layers: {
      handle: "الاسم المختصر",
      instructions: "ما ينبغي أن يفعله",
      subtype: "الدور",
      influence: "التأثير في النتيجة",
      save: "حفظ القرار",
      discard: "تجاهل التغييرات غير المحفوظة",
      optionLabels: ["هدف الحملة", "الأثر العاطفي", "الهدف السلوكي", "سؤال استكشافي"],
    },
  },
  ja: {
    viewTrigger: "表示を変更 · ドキュメント",
    layersView: "現実のレイヤー",
    layers: {
      handle: "短縮名",
      instructions: "果たすべき役割",
      subtype: "役割",
      influence: "結果への影響度",
      save: "判断を保存",
      discard: "未保存の変更を破棄",
      optionLabels: ["キャンペーンの目標", "感情面の効果", "行動目標", "探索の問い"],
    },
  },
};
// External source fragment only. No imports, registrations or execution.
// Parent supplies expect, attachJSON, tabTo, openLibrary, observeNative,
// observeCopy, retainState, assertState and primary-first finish.
// Parent sets ctx.expected.library = e11LibraryCopy[locale.split("-")[0]].
// assertState's allowedUi is an exact key/value override of the retained UI,
// never an omission list. All unspecified source, projection and UI fields stay equal.
const e11LibraryCopy = {
  en: {
    newBlock: "New reusable block", type: "Direction", recentControl: "Recent", keptControl: "Kept",
    label: "Direction content",
    guidance: "The outcome or change the work should create. This remains project context until someone copies it into a document.",
    editorHelp: "Markdown formatting is available. Use Control or Command plus B for bold and I for italic.",
    description: "Find reusable ideas and creative outputs in this project.",
    recent: "Project outputs appear here when they match the current search and collection filter.",
    kept: "Outputs kept for reuse appear here when they match the current search and collection filter.",
  },
  fr: {
    newBlock: "Nouveau bloc réutilisable", type: "Orientation", recentControl: "Récents", keptControl: "Conservés",
    label: "Contenu de Orientation",
    guidance: "Le résultat ou le changement que la création doit produire. Cet élément reste dans le contexte du projet tant que personne ne le copie dans un document.",
    editorHelp: "La mise en forme Markdown est disponible. Utilisez Contrôle ou Commande avec B pour le gras et I pour l’italique.",
    description: "Retrouvez les idées réutilisables et les créations de ce projet.",
    recent: "Les créations du projet apparaissent ici lorsqu’elles correspondent à la recherche et au filtre de collection actuels.",
    kept: "Les créations conservées pour réutilisation apparaissent ici lorsqu’elles correspondent à la recherche et au filtre de collection actuels.",
  },
  ar: {
    newBlock: "عنصر جديد قابل لإعادة الاستخدام", type: "التوجه", recentControl: "حديثة", keptControl: "محفوظة",
    label: "محتوى التوجه",
    guidance: "النتيجة أو التغيير الذي ينبغي أن يحققه العمل. يظل هذا ضمن سياق المشروع حتى ينسخه أحد إلى مستند.",
    editorHelp: "يتوفر تنسيق Markdown. استخدم مفتاح التحكم أو الأوامر مع B للنص الغامق ومع I للنص المائل.",
    description: "اعثر على الأفكار القابلة لإعادة الاستخدام والمخرجات الإبداعية في هذا المشروع.",
    recent: "تظهر مخرجات المشروع هنا عندما تطابق البحث الحالي وعامل تصفية المجموعة الحالي.",
    kept: "تظهر المخرجات المحفوظة لإعادة الاستخدام هنا عندما تطابق البحث الحالي وعامل تصفية المجموعة الحالي.",
  },
  ja: {
    newBlock: "新しい再利用可能なブロック", type: "方向性", recentControl: "最近", keptControl: "保存済み",
    label: "方向性の内容",
    guidance: "作品によって生み出したい成果や変化。この内容は、誰かがドキュメントにコピーするまで、プロジェクトのコンテキストとして保持されます。",
    editorHelp: "Markdownによる書式設定を利用できます。ControlまたはCommandキーを押しながら、Bで太字、Iで斜体にできます。",
    description: "このプロジェクトの再利用可能なアイデアやクリエイティブな成果物を探せます。",
    recent: "現在の検索条件とコレクションのフィルターに一致するプロジェクトの成果物がここに表示されます。",
    kept: "再利用のために保存した成果物のうち、現在の検索条件とコレクションのフィルターに一致するものがここに表示されます。",
  },
};

async function libraryLabelJourney(ctx) {
  const { page, testInfo, expected } = ctx, copy = expected.library;
  const owner = await openLibrary(ctx);
  const newSelector = 'forma-library .page-header--library button[data-context-controls-id="__new__"]';
  const richSelector = "forma-library forma-library-block-editor forma-ui-rich-text.block-editor-copy";
  const labelSelector = richSelector + " > .ui-rich-text > label.ui-rich-text-label";
  const helpSelector = richSelector + " > .ui-rich-text > small[id]";
  const newBlock = page.locator(newSelector);
  let state, fields, primaryError;
  try {
    state = await retainState(owner);
    await expect(newBlock).toHaveCount(1);
    await expect(newBlock).toHaveText(copy.newBlock);
    await tabTo(page, newBlock);
    await observeNative(ctx, newBlock, "e11-library-label-new-unactivated", { owner, regions: [] });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/library\/blocks\/editor\/new\?document=doc-atmosphere$/);
    const editor = owner.locator("forma-library-block-editor");
    const form = editor.locator("form.library-block-form");
    const textarea = page.locator(richSelector + " textarea.ui-rich-text-input");
    await expect(editor).toHaveCount(1);
    await expect(form).toHaveCount(1);
    ctx.currentOwner = editor;
    await expect(textarea).toHaveCount(1);
    await expect(textarea).toBeEditable();
    await expect(page.locator(":modal, :popover-open")).toHaveCount(0);
    fields = await editor.evaluateHandle(element => {
      const library = element.closest("forma-library"), store = element.store;
      const form = element.querySelector("form.library-block-form"), rich = element.querySelector("forma-ui-rich-text.block-editor-copy");
      const field = rich?.querySelector("textarea.ui-rich-text-input"), label = rich?.querySelector("label.ui-rich-text-label");
      const help = rich?.querySelector(".ui-rich-text > small[id]");
      const identity = form?.querySelector('fieldset[aria-labelledby="library-block-identity"]');
      const selects = [...(identity?.querySelectorAll("select") ?? [])];
      const handle = identity?.querySelector("input"), submit = form?.querySelector("footer > button.button.primary");
      if (!library || !(form instanceof HTMLFormElement) || !rich || !(field instanceof HTMLTextAreaElement)
        || !(label instanceof HTMLLabelElement) || !help || selects.length !== 3 || !(handle instanceof HTMLInputElement)
        || !(submit instanceof HTMLButtonElement)) throw new Error("Require the real new Library rich-text form and exact native owners");
      const controls = [...form.elements];
      return { inspect: () => ({
        sameOwner: element.isConnected && library.isConnected && element.closest("forma-library") === library
          && element.store === store && library.store === store && library.querySelector("forma-library-block-editor") === element,
        sameForm: element.querySelector("form.library-block-form") === form && form.isConnected,
        sameControls: controls.length === form.elements.length && controls.every((node, i) => form.elements[i] === node),
        sameRich: rich.isConnected && element.querySelector("forma-ui-rich-text.block-editor-copy") === rich
          && rich.querySelector("textarea.ui-rich-text-input") === field && rich.querySelector("label.ui-rich-text-label") === label
          && rich.querySelector(".ui-rich-text > small[id]") === help,
        association: field.form === form && field.labels.length === 1 && field.labels[0] === label
          && label.control === field && label.htmlFor === field.id
          && document.querySelectorAll(`[id="${CSS.escape(field.id)}"]`).length === 1
          && field.getAttribute("aria-describedby") === help.id
          && document.querySelectorAll(`[id="${CSS.escape(help.id)}"]`).length === 1,
        newBlockId: element.blockId, rawValue: field.value, richValue: rich.value,
        rawLabel: label.textContent, richLabel: rich.label, rawHelp: help.textContent, richHelp: rich.help,
        identityKeys: selects.map(node => node.value), typeLabel: selects[0].selectedOptions[0]?.textContent,
        handleValue: handle.value, disabled: field.disabled, readOnly: field.readOnly,
        navigationBlocked: element.navigationBlocked, submitType: submit.type, submitDisabled: submit.disabled,
      }) };
    });
    const inspect = async (stage, rawValue) => {
      const current = await fields.evaluate(value => value.inspect());
      await attachJSON(testInfo, stage + "-native-form", current);
      expect(current).toMatchObject({ sameOwner: true, sameForm: true, sameControls: true, sameRich: true,
        association: true, newBlockId: null, rawValue, richValue: rawValue,
        rawLabel: copy.label, richLabel: copy.label, rawHelp: copy.guidance + " " + copy.editorHelp,
        richHelp: copy.guidance, identityKeys: ["direction", "Campaign goal", "include"], typeLabel: copy.type,
        handleValue: "", disabled: false, readOnly: false, navigationBlocked: rawValue !== "",
        submitType: "submit", submitDisabled: false });
      await assertState(ctx, state, stage + "-source", { allowedUi: { libraryView: "blocks" }, allowedRoute: "/library/blocks/editor/new?document=doc-atmosphere" });
    };
    await tabTo(page, textarea);
    await inspect("e11-library-label-empty", "");
    await observeCopy(ctx, editor, textarea, [{ selector: labelSelector, expected: copy.label }], "e11-library-label-readable");
    const raw = "  The outcome or change the work should create — Café e\u0301 العربية 私の文章  ";
    await page.keyboard.insertText(raw);
    await inspect("e11-library-label-raw", raw);
    await observeNative(ctx, textarea, "e11-library-label-raw-unsubmitted", { owner: editor, regions: [labelSelector] });
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await inspect("e11-library-label-cleared", "");
    // The help is below the seven formatting buttons. Reach the next existing
    // native control without activating formatting or changing the range value.
    const influence = form.locator(".library-weight input[type=range]");
    await expect(influence).toHaveCount(1);
    await expect(influence).toHaveValue("0.65");
    await tabTo(page, influence);
    await observeCopy(ctx, editor, influence, [{ selector: helpSelector, expected: copy.guidance + " " + copy.editorHelp }], "e11-library-help-readable");
    await inspect("e11-library-help-unchanged", "");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/library\?document=doc-atmosphere$/);
    await expect(owner.locator("forma-library-block-editor")).toHaveCount(0);
    ctx.currentOwner = owner;
    await assertState(ctx, state, "e11-library-label-escape-source", { allowedUi: { libraryView: "blocks" }, allowedRoute: "/library?document=doc-atmosphere" });
    const view = owner.locator("form.library-toolbar forma-ui-segmented-control.segmented > .ui-segmented > button");
    await expect(view).toHaveCount(4);
    expect(await view.evaluateAll(elements => elements.map(element => element.getAttribute("aria-pressed")))).toEqual(["false", "true", "false", "false"]);
    await tabTo(page, view.nth(0));
    await page.keyboard.press("Enter");
    await expect(view.nth(0)).toHaveAttribute("aria-pressed", "true");
    expect(await view.evaluateAll(elements => elements.map(element => element.getAttribute("aria-pressed")))).toEqual(["true", "false", "false", "false"]);
    await assertState(ctx, state, "e11-library-label-final-source");
    // Explicitly traverse to New after the SPA return; this is not an assertion
    // that the application restores focus automatically to the former trigger.
    await tabTo(page, newBlock);
    await observeNative(ctx, newBlock, "e11-library-label-final-native-traversal", { owner, regions: [] });
  } catch (error) { primaryError = error; }
  await finish(primaryError, fields, state);
}

async function libraryNeutralJourney(ctx) {
  const { page, testInfo, expected } = ctx, copy = expected.library;
  const owner = await openLibrary(ctx);
  const newBlock = owner.locator('.page-header--library button[data-context-controls-id="__new__"]');
  const toolbar = owner.locator("form.library-toolbar");
  const search = toolbar.locator('forma-ui-search.searchbox input[type="search"]');
  const view = toolbar.locator("forma-ui-segmented-control.segmented > .ui-segmented > button");
  const history = owner.locator(".library-content > section > .section-heading > forma-ui-segmented-control.compact-segmented");
  const scopes = history.locator(".ui-segmented > button");
  const emptySelector = "forma-library .library-content > section:has(> .section-heading > forma-ui-segmented-control.compact-segmented) > .family-empty[data-forma-empty-state] > p";
  const cards = owner.locator(".library-content > section > .library-output-grid > article.library-output");
  let state, primaryError;
  try {
    state = await retainState(owner);
    await expect(search).toHaveCount(1);
    await expect(search).toHaveValue("");
    await expect(view).toHaveCount(4);
    expect(await view.evaluateAll(elements => elements.map(element => element.getAttribute("aria-pressed")))).toEqual(["true", "false", "false", "false"]);
    const initial = await owner.evaluate(element => ({
      view: element.store.ui.libraryView, scope: element.store.ui.libraryOutputScope,
      collection: element.store.ui.focusCollectionId,
      outputIds: element.store.projection.get().libraryOutputs.map(item => item.id).sort(),
      keptOutputIds: element.store.projection.get().libraryOutputs.filter(item => item.library && item.standalone).map(item => item.id),
      artifactIds: element.store.projection.get().libraryArtifacts.map(item => item.id),
    }));
    await attachJSON(testInfo, "e11-library-neutral-initial-predicates", initial);
    expect(initial).toEqual({ view: "all", scope: "recent", collection: "",
      outputIds: ["object-nocturne-01", "object-nocturne-02"], keptOutputIds: [], artifactIds: [] });
    await expect(cards).toHaveCount(2);
    const initialCards = await cards.locator("forma-output-card").evaluateAll(elements => elements.map(element => element.output.id).sort());
    expect(initialCards).toEqual(initial.outputIds);
    await tabTo(page, newBlock);
    await observeCopy(ctx, owner, newBlock, [{ selector: "forma-library .page-header--library .page-header-copy > p", expected: copy.description }], "e11-library-description-readable");
    // Only the local view changes. Outputs keeps the measured result section
    // present when the query empties it; the All view relocates it in this case.
    await tabTo(page, view.nth(2));
    await page.keyboard.press("Enter");
    await expect(view.nth(2)).toHaveAttribute("aria-pressed", "true");
    expect(await view.evaluateAll(elements => elements.map(element => element.getAttribute("aria-pressed")))).toEqual(["false", "false", "true", "false"]);
    await expect(history).toHaveCount(1);
    await expect(scopes).toHaveCount(2);
    const inspectControls = async (stage, query, scope, recentCount) => {
      const current = await owner.evaluate(element => {
        const toolbar = element.querySelector("form.library-toolbar");
        const search = toolbar?.querySelector('forma-ui-search.searchbox input[type="search"]');
        const view = toolbar?.querySelector("forma-ui-segmented-control.segmented");
        const history = element.querySelector(".library-content > section > .section-heading > forma-ui-segmented-control.compact-segmented");
        const buttons = history ? [...history.querySelectorAll(".ui-segmented > button")] : [];
        return { query: search?.value, searchOwned: search?.form === toolbar,
          view: view?.value, viewKeys: view?.options.map(item => item.value),
          scope: history?.value, scopeKeys: history?.options.map(item => item.value),
          scopeTypes: buttons.map(button => button.type), scopeDisabled: buttons.map(button => button.disabled),
          scopePressed: buttons.map(button => button.getAttribute("aria-pressed")), scopeRaw: buttons.map(button => button.textContent),
          collection: element.store.ui.focusCollectionId };
      });
      await attachJSON(testInfo, stage + "-native-controls", current);
      expect(current).toEqual({ query, searchOwned: true, view: "outputs", viewKeys: ["all", "blocks", "outputs", "families"],
        scope, scopeKeys: ["recent", "kept"], scopeTypes: ["button", "button"], scopeDisabled: [false, false],
        scopePressed: scope === "recent" ? ["true", "false"] : ["false", "true"],
        scopeRaw: [copy.recentControl + " " + recentCount, copy.keptControl + " 0"], collection: "" });
    };
    await inspectControls("e11-library-neutral-outputs", "", "recent", 2);
    await expect(cards).toHaveCount(2);
    await assertState(ctx, state, "e11-library-neutral-outputs-source", { allowedUi: { libraryView: "outputs" } });
    await tabTo(page, search, 80, "Shift+Tab");
    const query = "  e11-no-match-Café-العربية-日本語  ";
    await page.keyboard.insertText(query);
    await expect(search).toHaveValue(query);
    await expect(cards).toHaveCount(0);
    await expect(page.locator(emptySelector)).toHaveCount(1);
    await inspectControls("e11-library-recent-empty", query, "recent", 0);
    await tabTo(page, scopes.nth(0));
    await observeCopy(ctx, owner, scopes.nth(0), [{ selector: emptySelector, expected: copy.recent }], "e11-library-recent-empty-readable");
    await assertState(ctx, state, "e11-library-recent-empty-source", { allowedUi: { libraryView: "outputs" } });
    await tabTo(page, scopes.nth(1));
    await page.keyboard.press("Enter");
    await expect(scopes.nth(0)).toHaveAttribute("aria-pressed", "false");
    await expect(scopes.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(cards).toHaveCount(0);
    await expect(search).toHaveValue(query);
    await inspectControls("e11-library-kept-empty", query, "kept", 0);
    await observeCopy(ctx, owner, scopes.nth(1), [{ selector: emptySelector, expected: copy.kept }], "e11-library-kept-empty-readable");
    await assertState(ctx, state, "e11-library-kept-empty-source", { allowedUi: { libraryView: "outputs", libraryOutputScope: "kept" } });
    await tabTo(page, search, 80, "Shift+Tab");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await expect(search).toHaveValue("");
    // This fixture has no saved-for-reuse output. Clearing search must retain
    // that real empty Kept state; do not invent a recovered kept story.
    await expect(cards).toHaveCount(0);
    await expect(page.locator(emptySelector)).toHaveCount(1);
    await inspectControls("e11-library-cleared-kept", "", "kept", 2);
    await assertState(ctx, state, "e11-library-cleared-kept-source", { allowedUi: { libraryView: "outputs", libraryOutputScope: "kept" } });
    await tabTo(page, scopes.nth(0));
    await page.keyboard.press("Enter");
    await expect(scopes.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(cards).toHaveCount(2);
    await expect(page.locator(emptySelector)).toHaveCount(0);
    expect(await cards.locator("forma-output-card").evaluateAll(elements => elements.map(element => element.output.id).sort())).toEqual(initialCards);
    await inspectControls("e11-library-recent-restored", "", "recent", 2);
    await assertState(ctx, state, "e11-library-recent-restored-source", { allowedUi: { libraryView: "outputs" } });
    await observeNative(ctx, scopes.nth(0), "e11-library-recent-restored", { owner, regions: [] });
    await tabTo(page, view.nth(0), 80, "Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(view.nth(0)).toHaveAttribute("aria-pressed", "true");
    expect(await view.evaluateAll(elements => elements.map(element => element.getAttribute("aria-pressed")))).toEqual(["true", "false", "false", "false"]);
    await expect(search).toHaveValue("");
    await expect(cards).toHaveCount(2);
    expect(await cards.locator("forma-output-card").evaluateAll(elements => elements.map(element => element.output.id).sort())).toEqual(initialCards);
    await expect(page).toHaveURL(/\/library\?document=doc-atmosphere$/);
    await assertState(ctx, state, "e11-library-neutral-final-source");
    await observeNative(ctx, view.nth(0), "e11-library-neutral-all-restored", { owner, regions: [] });
  } catch (error) { primaryError = error; }
  await finish(primaryError, state);
}
// External E11 preparation only: no imports, registrations, candidate edits or run.
// Shared globals: expect, tabTo, attachJSON, openDocument, observeNative,
// observeCopy, retainState, assertState, finish. Parent owns their definitions.
// expected.layers = { handle, instructions, subtype, influence, save, discard,
//   optionLabels: [Campaign-goal label, Emotional-outcome label,
//     Behavioral-objective label, Exploration-question label] }.
// expected.viewTrigger and expected.layersView are independent catalog oracles.
async function layersJourney(ctx) {
  const { page, testInfo, expected } = ctx;
  const ownerSelector = "forma-reality-layers";
  const selectedId = "e6-network-fourth-decision";
  const formSelector = `${ownerSelector} form.layer-inspector[data-layer-inspector="${selectedId}"]`;
  const fieldSelector = name => `${formSelector} > label > [name="${name}"]`;
  const labelSelector = name => `${formSelector} > label:has(> [name="${name}"])`;
  const outputSelector = `${labelSelector("weight")} > output`;
  const saveSelector = `${formSelector} > footer > button.primary`;
  const discardSelector = `${formSelector} > footer > button.layer-inspector-discard`;
  const copySelector = `${formSelector} > footer > button:first-child`;
  const sourceDefaults = {
    handle: "direction/synthetic-custody",
    instructions: "  Synthetic fourth decision. Preserve this exact source wording.  ",
    subtype: "Campaign goal", weight: "0.5", output: "50%",
  };
  const subtypeValues = ["Campaign goal", "Emotional outcome", "Behavioral objective", "Exploration question"];
  const rawHandle = "  direction/English label remains authored — 私の名  ";
  const rawInstructions = "  What it should do — this is my untranslated draft.  ";
  const failures = [];
  let bridge, saved, nativeForm;
  const mergeFailure = error => { failures.push(error); };

  try {
    expect(expected.layers.optionLabels).toHaveLength(4);
    const documentOwner = await openDocument(ctx);
    // A separate bridge admits only the deliberate Document -> Layers route.
    // The original Store/source bytes must survive the owner replacement; all
    // later local observations use retainState on the actual Layers owner.
    bridge = await documentOwner.evaluateHandle(element => {
      const store = element.store, doc = element.ownerDocument;
      if (!store?.projection?.get || !store?.events?.get || !store?.content?.get)
        throw new Error("Require the admitted Document's actual Store");
      const encode = value => JSON.stringify(value, (_key, item) => item instanceof Set
        ? { type: "Set", values: [...item] }
        : typeof item === "number" && !Number.isFinite(item) ? { type: "Number", value: String(item) } : item);
      const read = () => ({ events: encode(store.events.get()), eventCount: store.events.get().length,
        optimisticEvents: encode(store.optimisticEvents.get()), head: store.head.get(),
        content: encode(store.content.get()), projection: encode(store.projection.get()),
        session: encode(store.session.get()), jobs: encode(store.documentJobs.get()),
        selection: { selectedOutputId: store.ui.selectedOutputId, focusBlockId: store.ui.focusBlockId,
          editingBlockId: store.ui.editingBlockId, focusCollectionId: store.ui.focusCollectionId,
          libraryView: store.ui.libraryView, libraryOutputScope: store.ui.libraryOutputScope } });
      const before = read();
      return { before, inspect: () => {
        const owners = [...doc.querySelectorAll("forma-reality-layers")];
        return { before, after: read(), sameDocument: element.ownerDocument === doc,
          sameStoreAtDestination: owners.length === 1 && owners[0].isConnected && owners[0].store === store,
          destinationOwnerCount: owners.length, formerDocumentConnected: element.isConnected,
          actualStoreRoute: store.route.get(), actualURL: doc.location.href };
      } };
    });
    const navSelector = 'forma-workspace forma-studio-mode-nav[active="document"]';
    const menuSelector = `${navSelector} forma-ui-popover.studio-view-menu`;
    const triggerSelector = `${menuSelector} > .ui-popover > button.ui-popover-trigger`;
    const panelSelector = `${menuSelector} > .ui-popover > section.ui-popover-panel`;
    const linkSelector = `${panelSelector} > nav.studio-view-options > a[data-studio-view="layers"]`;
    const trigger = page.locator(triggerSelector), panel = page.locator(panelSelector), link = page.locator(linkSelector);
    await expect(page.locator(navSelector)).toHaveCount(1);
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toHaveAccessibleName(expected.viewTrigger);
    await tabTo(page, trigger, 200);
    await observeNative(ctx, trigger, "e11-layers-01-view-trigger", {
      owner: navSelector, regions: [triggerSelector],
    });
    await page.keyboard.press("Enter");
    await expect(panel).toHaveAttribute("popover", "auto");
    await expect(page.locator(`${panelSelector}:popover-open`)).toHaveCount(1);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", "/document/doc-atmosphere/atmosphere-studies/view/layers");
    await expect(link).toHaveAccessibleName(expected.layersView);
    await tabTo(page, link, 20);
    await observeNative(ctx, link, "e11-layers-02-view-link", {
      owner: `${panelSelector}:popover-open`,
      regions: [`${panelSelector} > nav.studio-view-options > a[data-studio-view]`],
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new URL("/document/doc-atmosphere/atmosphere-studies/view/layers", page.url()).href);
    const owner = page.locator(ownerSelector), form = page.locator(formSelector);
    await expect(owner).toHaveCount(1);
    await expect(form).toHaveCount(1);
    await expect(page.locator(":modal, :popover-open")).toHaveCount(0);
    const routeReceipt = await bridge.evaluate(state => state.inspect());
    await attachJSON(testInfo, "e11-layers-route-source-bridge", routeReceipt);
    expect(routeReceipt.sameDocument).toBe(true);
    expect(routeReceipt.sameStoreAtDestination).toBe(true);
    expect(routeReceipt.destinationOwnerCount).toBe(1);
    expect(routeReceipt.actualStoreRoute).toBe("/document/doc-atmosphere/atmosphere-studies/view/layers");
    expect(routeReceipt.after).toEqual(routeReceipt.before);
    expect(routeReceipt.before.eventCount).toBeGreaterThan(0);
    ctx.currentOwner = owner;
    saved = await retainState(owner);

    nativeForm = await form.evaluateHandle((element, selectedId) => {
      const owner = element.closest("forma-reality-layers"), doc = element.ownerDocument, store = owner?.store;
      if (!(element instanceof HTMLFormElement) || !owner || !store)
        throw new Error("Require the actual current Layers native form and Store");
      const list = owner.querySelector(".layers-panel > ol"), rows = list ? [...list.querySelectorAll(":scope > li")] : [];
      const rowNames = rows.map(row => row.querySelector(":scope > button.layer-name"));
      const rowHandles = rowNames.map(name => name?.querySelector(":scope > b"));
      const selectedRow = list?.querySelector(":scope > li.selected");
      const selectedRowPeers = selectedRow ? [...selectedRow.querySelectorAll("button")] : [];
      if (!list || rows.length !== 4 || rowNames.some(name => !(name instanceof HTMLButtonElement))
        || rowHandles.some(name => !name) || !selectedRow || selectedRowPeers.length !== 5)
        throw new Error("Require the actual four-row Layers list, selected row and its five native controls");
      const originalRowNames = rowHandles.map(node => node.textContent);
      const names = ["handle", "instructions", "subtype", "weight"];
      const fields = names.map(name => element.querySelector(`[name="${name}"]`));
      const labels = fields.map(field => field?.parentElement);
      const output = fields[3]?.previousElementSibling;
      const controls = [...element.elements];
      const options = [...(fields[2]?.options ?? [])];
      const save = element.querySelector(":scope > footer > button.primary");
      const discard = element.querySelector(":scope > footer > button.layer-inspector-discard");
      if (!(fields[0] instanceof HTMLInputElement) || fields[0].type !== "text"
        || !(fields[1] instanceof HTMLTextAreaElement) || !(fields[2] instanceof HTMLSelectElement)
        || !(fields[3] instanceof HTMLInputElement) || fields[3].type !== "range"
        || !(output instanceof HTMLOutputElement) || labels.some(label => !(label instanceof HTMLLabelElement))
        || !(save instanceof HTMLButtonElement) || !(discard instanceof HTMLButtonElement))
        throw new Error("Require four native Layers fields, their four labels, native output and buttons");
      const directText = label => [...label.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join("");
      return { inspect: () => {
        const projection = store.projection.get(), selected = projection.blocks.filter(block => block.id === selectedId);
        return {
          predicates: {
            ownerConnected: owner.isConnected && owner.store === store && owner.ownerDocument === doc,
            uniqueOwner: doc.querySelectorAll("forma-reality-layers").length === 1 && doc.querySelector("forma-reality-layers") === owner,
            actualSelectedList: list.isConnected && owner.querySelectorAll(".layers-panel > ol").length === 1
              && owner.querySelector(".layers-panel > ol") === list && list.querySelectorAll(":scope > li").length === 4
              && rows.every((row, index) => row.isConnected && list.querySelectorAll(":scope > li")[index] === row
                && row.querySelectorAll(":scope > button.layer-name").length === 1
                && row.querySelector(":scope > button.layer-name") === rowNames[index]
                && rowNames[index].querySelector(":scope > b") === rowHandles[index]
                && rowHandles[index].textContent === originalRowNames[index])
              && list.querySelectorAll(":scope > li.selected").length === 1
              && list.querySelector(":scope > li.selected") === selectedRow && selectedRow === rows[0]
              && rowHandles[0].textContent === selected[0]?.handle
              && selectedRowPeers.every((peer, index) => peer.isConnected && selectedRow.querySelectorAll("button")[index] === peer),
            originalForm: element.isConnected && owner.querySelectorAll("form.layer-inspector").length === 1
              && owner.querySelector("form.layer-inspector") === element && element.dataset.layerInspector === selectedId,
            originalControls: controls.length === 9 && element.elements.length === controls.length
              && controls.every((control, index) => control.isConnected && element.elements[index] === control && control.form === element),
            originalFields: fields.every((field, index) => element.querySelectorAll(`[name="${names[index]}"]`).length === 1
              && element.querySelector(`[name="${names[index]}"]`) === field && field.form === element),
            originalLabels: element.querySelectorAll(":scope > label").length === 4
              && labels.every((label, index) => label.isConnected && label.parentElement === element && fields[index].parentElement === label),
            firstThreeNativeLabels: fields.slice(0, 3).every((field, index) => field.labels.length === 1
              && field.labels[0] === labels[index] && labels[index].control === field),
            originalOutput: output.isConnected && output.form === element && fields[3].previousElementSibling === output
              && output.parentElement === labels[3] && element.querySelectorAll("output").length === 1,
            originalOptions: options.length === 4 && fields[2].options.length === 4
              && options.every((option, index) => option.isConnected && fields[2].options[index] === option),
            originalButtons: save.isConnected && discard.isConnected && save.form === element && discard.form === element
              && element.querySelector(":scope > footer > button.primary") === save
              && element.querySelector(":scope > footer > button.layer-inspector-discard") === discard,
            selectedFourth: selected.length === 1 && projection.blocks.length === 4 && projection.blocks.at(-1) === selected[0]
              && selected[0].projectId === "project-atmosphere" && selected[0].documentId === "doc-atmosphere",
          },
          selected: selected.map(block => ({ id: block.id, handle: block.handle, type: block.type,
            text: block.properties.text, weight: block.properties.weight, subtype: block.properties.subtype ?? null })),
          list: { rawNames: rowHandles.map(node => node.textContent), originalRawNames: originalRowNames,
            selectedIndex: rows.indexOf(selectedRow), selectedControlCount: selectedRowPeers.length,
            sourceRows: [...projection.blocks].reverse().map(block => ({ id: block.id, handle: block.handle })),
            selectedRawName: rowHandles[rows.indexOf(selectedRow)].textContent },
          values: { handle: fields[0].value, instructions: fields[1].value,
            subtype: fields[2].value, weight: fields[3].value, output: output.value },
          labels: labels.map((label, index) => ({ field: names[index], directText: directText(label), rawText: label.textContent,
            controlTag: label.control?.tagName ?? null, controlName: label.control?.getAttribute("name") ?? null,
            controlIsField: label.control === fields[index], controlIsOutput: label.control === output,
            fieldLabelsCount: fields[index].labels.length, fieldLabelsIncludeLabel: [...fields[index].labels].includes(label) })),
          rangeAssociation: { labelControlIsRange: labels[3].control === fields[3], labelControlIsOutput: labels[3].control === output,
            rangeLabelsCount: fields[3].labels.length, rangeLabelsIncludeLabel: [...fields[3].labels].includes(labels[3]),
            outputLabelsCount: output.labels.length, outputLabelsIncludeLabel: [...output.labels].includes(labels[3]),
            ariaLabel: fields[3].getAttribute("aria-label"), ariaLabelledby: fields[3].getAttribute("aria-labelledby") },
          select: { value: fields[2].value, selectedIndex: fields[2].selectedIndex, multiple: fields[2].multiple,
            options: options.map(option => ({ value: option.value, label: option.label, text: option.textContent,
              selected: option.selected, defaultSelected: option.defaultSelected, disabled: option.disabled })) },
          range: { type: fields[3].type, min: fields[3].min, max: fields[3].max, step: fields[3].step, value: fields[3].value },
          controls: controls.map(control => ({ tag: control.tagName, name: control.getAttribute("name"),
            type: control.type ?? null, disabled: "disabled" in control ? control.disabled : null })),
          save: { type: save.type, typeAttribute: save.getAttribute("type"), disabled: save.disabled, text: save.textContent },
          discard: { type: discard.type, disabled: discard.disabled, text: discard.textContent, ariaLabel: discard.getAttribute("aria-label") },
          url: doc.location.href, storeRoute: store.route.get(),
        };
      } };
    }, selectedId);
    const inspectForm = async (stage, values) => {
      const evidence = await nativeForm.evaluate(state => state.inspect());
      await attachJSON(testInfo, stage, evidence);
      for (const [name, value] of Object.entries(evidence.predicates)) expect(value, `${stage}: ${name}`).toBe(true);
      expect(evidence.values).toEqual(values);
      expect(evidence.list.selectedIndex).toBe(0); expect(evidence.list.selectedControlCount).toBe(5);
      expect(evidence.list.rawNames).toEqual(evidence.list.originalRawNames);
      expect(evidence.list.rawNames).toEqual(evidence.list.sourceRows.map(row => row.handle));
      expect(evidence.list.sourceRows.map(row => row.id)).toEqual([selectedId, "block-palette", "block-reference", "block-direction"]);
      expect(evidence.list.selectedRawName).toBe(sourceDefaults.handle);
      expect(evidence.selected).toEqual([{ id: selectedId, handle: sourceDefaults.handle, type: "direction",
        text: sourceDefaults.instructions, weight: .5, subtype: null }]);
      expect(evidence.labels.map(label => label.directText)).toEqual([
        expected.layers.handle, expected.layers.instructions, expected.layers.subtype, expected.layers.influence + " ",
      ]);
      expect(evidence.select).toMatchObject({ value: "Campaign goal", selectedIndex: 0, multiple: false });
      expect(evidence.select.options.map(option => option.value)).toEqual(subtypeValues);
      expect(evidence.select.options.map(option => option.label)).toEqual(expected.layers.optionLabels);
      expect(evidence.select.options.map(option => option.text)).toEqual(expected.layers.optionLabels);
      expect(evidence.select.options.map(option => option.selected)).toEqual([true, false, false, false]);
      expect(evidence.select.options.map(option => option.disabled)).toEqual([false, false, false, false]);
      expect(evidence.range).toEqual({ type: "range", min: "0", max: "1", step: ".05", value: "0.5" });
      expect(evidence.save).toEqual({ type: "submit", typeAttribute: null, disabled: false, text: expected.layers.save });
      expect(evidence.discard).toEqual({ type: "button", disabled: false, text: expected.layers.discard,
        ariaLabel: expected.layers.discard + " — \u2068" + sourceDefaults.handle + "\u2069" });
      await assertState(ctx, saved, stage + "-source");
      return evidence;
    };
    await inspectForm("e11-layers-03-initial-form", sourceDefaults);
    const handle = page.locator(fieldSelector("handle")), instructions = page.locator(fieldSelector("instructions"));
    const subtype = page.locator(fieldSelector("subtype")), weight = page.locator(fieldSelector("weight"));
    const save = page.locator(saveSelector), discard = page.locator(discardSelector), copy = page.locator(copySelector);
    await attachJSON(testInfo, "e11-layers-range-native-name-initial", {
      nativeAssociation: await nativeForm.evaluate(state => state.inspect().rangeAssociation),
      ariaSnapshot: await weight.ariaSnapshot(), expectedAccessibleName: expected.layers.influence,
      limit: "Initial native semantics only; no focused paint or viewport claim at this stage.",
    });
    const labels = ["handle", "instructions", "subtype", "weight"];
    const fields = [handle, instructions, subtype, weight];
    for (let index = 0; index < fields.length; index += 1) {
      if (index === 0) await tabTo(page, fields[index], 240);
      else { await page.keyboard.press("Tab"); await expect(fields[index]).toBeFocused(); }
      const name = labels[index], expectedLabel = name === "weight" ? expected.layers.influence : expected.layers[name];
      const targets = [{ selector: labelSelector(name), expected: expectedLabel + (name === "weight" ? " " : ""), text: "direct" }];
      if (name === "weight") targets.push({ selector: outputSelector, expected: "50%" });
      await observeCopy(ctx, formSelector, fields[index], targets, `e11-layers-04-${name}-copy`);
      await inspectForm(`e11-layers-04-${name}-form`, sourceDefaults);
      if (name !== "weight") await expect(fields[index]).toHaveAccessibleName(expectedLabel);
      else {
        // OUTPUT is labelable and precedes the range in the retained markup.
        // Preserve actual evidence before testing the intended native relation.
        // A captured failure is deferred only so safe copy and Discard tails can
        // be retained; it is mandatory in the final case verdict.
        const nativeAssociation = await nativeForm.evaluate(state => state.inspect().rangeAssociation);
        const ariaSnapshot = await weight.ariaSnapshot();
        await attachJSON(testInfo, "e11-layers-range-native-name", { nativeAssociation, ariaSnapshot,
          expectedAccessibleName: expected.layers.influence, requiredAssociation: "The Influence label must name the native range input" });
        try {
          expect(nativeAssociation.labelControlIsRange, "Influence label.control must be the actual range").toBe(true);
          expect(nativeAssociation.rangeLabelsCount).toBe(1);
          expect(nativeAssociation.rangeLabelsIncludeLabel).toBe(true);
        } catch (error) { mergeFailure(error); }
        try { await expect(weight).toHaveAccessibleName(expected.layers.influence, { timeout: 1000 }); }
        catch (error) { mergeFailure(error); }
      }
    }
    await page.keyboard.press("Tab"); await expect(copy).toBeFocused();
    await page.keyboard.press("Tab"); await expect(discard).toBeFocused();
    await page.keyboard.press("Tab"); await expect(save).toBeFocused();
    await expect(save).toHaveAccessibleName(expected.layers.save);
    await observeCopy(ctx, formSelector, save, [{ selector: saveSelector, expected: expected.layers.save }], "e11-layers-05-save-unactivated");
    await inspectForm("e11-layers-05-save-form", sourceDefaults);

    await tabTo(page, handle, 8, "Shift+Tab");
    await expect(handle).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText(rawHandle);
    await expect(handle).toHaveValue(rawHandle);
    await page.keyboard.press("Tab"); await expect(instructions).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText(rawInstructions);
    await expect(instructions).toHaveValue(rawInstructions);
    const unsent = { ...sourceDefaults, handle: rawHandle, instructions: rawInstructions };
    await inspectForm("e11-layers-06-unsent-form", unsent);
    await observeCopy(ctx, formSelector, instructions,
      [{ selector: labelSelector("instructions"), expected: expected.layers.instructions, text: "direct" }],
      "e11-layers-06-unsent-instructions");
    await page.keyboard.press("Tab"); await expect(subtype).toBeFocused();
    await page.keyboard.press("Tab"); await expect(weight).toBeFocused();
    await page.keyboard.press("Tab"); await expect(copy).toBeFocused();
    await page.keyboard.press("Tab"); await expect(discard).toBeFocused();
    await expect(discard).toHaveAccessibleName(expected.layers.discard + " — \u2068" + sourceDefaults.handle + "\u2069");
    await observeCopy(ctx, formSelector, discard, [{ selector: discardSelector, expected: expected.layers.discard }], "e11-layers-07-discard-ready");
    await inspectForm("e11-layers-07-before-discard-form", unsent);
    await page.keyboard.press("Enter");
    await expect(handle).toHaveValue(sourceDefaults.handle);
    await expect(instructions).toHaveValue(sourceDefaults.instructions);
    await expect(discard).toBeFocused();
    await inspectForm("e11-layers-08-discard-restored-form", sourceDefaults);
    await observeCopy(ctx, formSelector, discard, [{ selector: discardSelector, expected: expected.layers.discard }], "e11-layers-08-discard-restored");
    await expect(page.locator(":modal, :popover-open")).toHaveCount(0);
    await attachJSON(testInfo, "e11-layers-completed-tail", {
      route: page.url(), selectedId, originalKeyedFormRetained: true, exactRawDefaultsRestored: true,
      nativeEdits: [rawHandle, rawInstructions], activated: ["View trigger", "Layers link", "Discard unsaved changes"],
      unactivated: ["Save decision", "Make a copy", "Protect", "range arrows", "Role options"],
      deferredHardFailures: failures.map(error => ({ name: error.name, message: error.message })),
      limit: "Four selected locale/profile cells; current source, native form and copy evidence only. No AT, physical device, provider, saved edit or continuous scroll-settlement claim.",
    });
  } catch (error) { mergeFailure(error); }
  try { if (saved) await assertState(ctx, saved, "e11-layers-final-source"); }
  catch (error) { mergeFailure(error); }
  const failure = failures.length > 1 ? new AggregateError(failures, "E11 Layers native copy, association or custody failed") : failures[0];
  await finish(failure, nativeForm, saved, bridge);
}
const e11ProjectNouns = {
  en: { document: "document", decisions: "creative decisions", outputs: "outputs", collections: "collections", conjunction: ", and" },
  fr: { document: "document", decisions: "décisions créatives", outputs: "résultats", collections: "collections", conjunction: ", et" },
  ar: { document: "مستند", decisions: "قرارات إبداعية", outputs: "ناتجان", collections: "مجموعات", conjunction: "، و" },
  ja: { document: "ドキュメント", decisions: "制作上の決定事項", outputs: "生成結果", collections: "コレクション", conjunction: "、および" },
};
async function projectsJourney(ctx) {
  const { page, context, geometry, testInfo, locale } = ctx, copy = e11ProjectNouns[locale.split("-")[0]];
  await openForma(page, context, geometry, "/projects", testInfo);
  const owner = page.locator("forma-projects"); await expect(owner).toHaveCount(1);
  await expect(page.locator("#main-content")).toHaveAttribute("aria-busy", "false");
  await expect(owner.locator(".projects-grid > article.project-card.current")).toBeVisible();
  ctx.currentOwner = owner; await profileWitness(ctx); await assertSeed(ctx, owner);
  const cardSelector = "forma-projects .projects-grid > article.project-card.current";
  const footerSelector = cardSelector + " > footer", summarySelector = cardSelector + " > .project-card-summary";
  const card = page.locator(cardSelector), footer = page.locator(footerSelector), buttons = footer.locator(":scope > button");
  let saved, held, primary;
  try {
    saved = await retainState(owner);
    await expect(card).toHaveCount(1); await expect(footer).toHaveCount(1); await expect(buttons).toHaveCount(3);
    await expect(card.locator(".project-card-title > h2")).toHaveText("Studio launch");
    held = await card.evaluateHandle(element => {
      const host = element.closest("forma-projects"), store = host.store, footer = element.querySelector(":scope > footer");
      const summary = element.querySelector(":scope > .project-card-summary"), controls = [...footer.querySelectorAll(":scope > button")];
      const small = summary.querySelector(":scope > span > small"), count = summary.querySelector(":scope > span > strong");
      const paragraph = summary.querySelector(":scope > p"), values = [...paragraph.querySelectorAll(":scope > b")];
      const raw = () => ({ documentNumber: count.textContent, documentNoun: small.textContent, paragraph: paragraph.textContent,
        numbers: values.map(node => node.textContent),
        controls: controls.map(node => ({ tag: node.tagName, type: node.type, text: node.textContent,
          ariaLabel: node.getAttribute("aria-label"), disabled: node.disabled })) });
      const original = raw();
      return { inspect: () => ({ original, current: raw(), predicates: {
        currentCard: element.isConnected && host.isConnected && host.store === store
          && document.querySelectorAll("forma-projects .projects-grid > article.project-card.current").length === 1
          && document.querySelector("forma-projects .projects-grid > article.project-card.current") === element,
        currentFooter: footer.isConnected && element.querySelector(":scope > footer") === footer && controls.length === 3
          && controls.every((node, index) => node.isConnected && footer.querySelectorAll(":scope > button")[index] === node
            && node instanceof HTMLButtonElement && !node.disabled),
        currentSummary: summary.isConnected && element.querySelector(":scope > .project-card-summary") === summary
          && summary.querySelector(":scope > span > strong") === count && summary.querySelector(":scope > span > small") === small
          && summary.querySelector(":scope > p") === paragraph && values.length === 3
          && values.every((node, index) => paragraph.querySelectorAll(":scope > b")[index] === node),
      }, counts: store.projection.get().projects.filter(project => project.id === "project-atmosphere").map(project => ({
        document: project.documentCount, decision: project.blockCount, output: project.outputCount,
        collection: project.collectionCount, artifact: project.artifactCount })) }) };
    });
    const witness = async stage => {
      const result = await held.evaluate(value => value.inspect());
      await attachJSON(testInfo, stage, result);
      for (const [name, value] of Object.entries(result.predicates)) expect(value, stage + ": " + name).toBe(true);
      expect(result.current).toEqual(result.original);
      expect(result.counts).toEqual([{ document: 1, decision: 4, output: 2, collection: 3, artifact: 0 }]);
      expect(result.current).toMatchObject({ documentNumber: "1", documentNoun: copy.document, numbers: ["4", "2", "3"],
        paragraph: `4 ${copy.decisions}, 2 ${copy.outputs}${copy.conjunction} 3 ${copy.collections}.` });
      return result;
    };
    await witness("e11-projects-nouns-before");
    await tabTo(page, buttons.nth(0), 240);
    // Preserve initial native arrival before deliberately reading the summary
    // below this footer. These are three fixed user keys, not a geometry loop.
    await observeNative(ctx, buttons.nth(0), "e11-projects-count-reading-arrival", {
      owner: footerSelector, regions: [footerSelector + " > button"], scope: "projects" });
    const readingBefore = await witness("e11-projects-count-reading-before");
    const firstButtonFocusedBefore = await buttons.nth(0).evaluate(element => element.ownerDocument.activeElement === element);
    expect(firstButtonFocusedBefore).toBe(true);
    await page.keyboard.press("ArrowDown"); await expect(buttons.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowDown"); await expect(buttons.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowDown"); await expect(buttons.nth(0)).toBeFocused();
    const readingAfter = await witness("e11-projects-count-reading-after");
    const firstButtonFocusedAfter = await buttons.nth(0).evaluate(element => element.ownerDocument.activeElement === element);
    expect(firstButtonFocusedAfter).toBe(true);
    expect(readingAfter).toEqual(readingBefore);
    await attachJSON(testInfo, "e11-projects-count-native-reading", {
      keys: ["ArrowDown", "ArrowDown", "ArrowDown"], firstButtonFocusedBefore, firstButtonFocusedAfter,
      before: readingBefore, after: readingAfter,
      limit: "Intentional native reading after separately measured first-footer arrival. The same held card, footer peers, raw counts and first native focus remain required. Key scroll distance is not prescribed or assumed; full-copy geometry and exact capture samples below must independently pass. No initial-Tab full-paragraph visibility claim.",
    });
    await observeCopy(ctx, "forma-projects", buttons.nth(0), [
      { selector: summarySelector + " > span > small", expected: copy.document },
      { selector: summarySelector + " > p", expected: `4 ${copy.decisions}, 2 ${copy.outputs}${copy.conjunction} 3 ${copy.collections}.` },
    ], "e11-projects-count-nouns-readable");
    for (let index = 0; index < 3; index += 1) {
      if (index) { await page.keyboard.press("Tab"); await expect(buttons.nth(index)).toBeFocused(); }
      await expect(buttons.nth(index)).not.toHaveAccessibleName("");
      await observeNative(ctx, buttons.nth(index), `e11-projects-footer-${index + 1}-unactivated`, {
        owner: footerSelector, regions: [footerSelector + " > button"], scope: "projects" });
      await witness(`e11-projects-nouns-after-peer-${index + 1}`);
    }
    await assertState(ctx, saved, "e11-projects-final-source");
    await attachJSON(testInfo, "e11-projects-completed-tail", { counts: [1, 4, 2, 3], artifactCount: 0,
      exactNouns: copy, activatedProjectActions: [], sourceAndDisplayedCountsMatched: true,
      limit: "One real finite-seed count tuple per locale, not all plural categories. Full paragraph requires the existing locale's catalog conjunction as well as the four count nouns. All other-control census stays diagnostic only at the exact inherited three-footer-control task boundary; no whole scrolled-page clearance." });
  } catch (error) { primary = error; }
  try { if (saved) await assertState(ctx, saved, "e11-projects-finally-source"); }
  catch (error) { primary = primary ? new AggregateError([primary, error], "Projects observation and final custody failed") : error; }
  await finish(primary, held, saved);
}
// External source only: no imports, registrations, application edits or run.
// Parent supplies expect, attachJSON, tabTo, openDocument, observeNative,
// observeCopy, retainState, assertState and primary-first finish.
// Parent sets ctx.expected.studio = e11StudioCopy[locale.split("-")[0]].
// observeCopy must preserve the ordinary-copy helper's modal rejection and use
// its declared modal path: exact raw copy/Range evidence, unchanged strict
// focused target and explicit regions, actual modal owner and current PNG.
const e11StudioCopy = {
  en: {
    addContext: "Add context", addReusableContext: "Add reusable context",
    closePicker: "Close reusable context picker", fromProject: "Add from project",
    reusableContext: "Reusable context", initialSubtitle: "Add an existing or new creative decision",
    openEditor: "Open Block editor",
    subtitle: "Reuse a creative decision or a previous project output. Everything remains editable in this document.",
    emptyHelp: "Create a reusable decision or generate a project output to reuse here.",
  },
  fr: {
    addContext: "Ajouter du contexte", addReusableContext: "Ajouter un contexte réutilisable",
    closePicker: "Fermer le sélecteur de contexte réutilisable", fromProject: "Ajouter depuis le projet",
    reusableContext: "Contexte réutilisable", initialSubtitle: "Ajouter une décision créative existante ou nouvelle",
    openEditor: "Ouvrir l’éditeur de blocs",
    subtitle: "Réutilisez une décision créative ou une création précédente du projet. Tout reste modifiable dans ce document.",
    emptyHelp: "Créez une décision réutilisable ou générez une création du projet à réutiliser ici.",
  },
  ar: {
    addContext: "إضافة سياق", addReusableContext: "إضافة سياق قابل لإعادة الاستخدام",
    closePicker: "إغلاق أداة اختيار السياق القابل لإعادة الاستخدام", fromProject: "إضافة من المشروع",
    reusableContext: "سياق قابل لإعادة الاستخدام", initialSubtitle: "إضافة قرار إبداعي حالي أو جديد",
    openEditor: "فتح محرر العناصر",
    subtitle: "أعِد استخدام قرار إبداعي أو مخرج سابق للمشروع. يظل كل شيء قابلًا للتعديل في هذا المستند.",
    emptyHelp: "أنشئ قرارًا قابلًا لإعادة الاستخدام أو ولّد مخرجًا للمشروع لإعادة استخدامه هنا.",
  },
  ja: {
    addContext: "コンテキストを追加", addReusableContext: "再利用可能なコンテキストを追加",
    closePicker: "再利用可能なコンテキストの選択画面を閉じる", fromProject: "プロジェクトから追加",
    reusableContext: "再利用可能なコンテキスト", initialSubtitle: "既存または新規のクリエイティブな決定を追加",
    openEditor: "ブロックエディターを開く",
    subtitle: "クリエイティブな決定や、プロジェクトの以前の成果物を再利用できます。このドキュメント内のすべての内容を引き続き編集できます。",
    emptyHelp: "再利用可能な決定を作成するか、ここで再利用するプロジェクトの成果物を生成しましょう。",
  },
};

async function studioReuseJourney(ctx) {
  const { page, testInfo, expected } = ctx, copy = expected.studio;
  const owner = await openDocument(ctx);
  const navSelector = 'forma-workspace forma-studio-mode-nav[active="document"]';
  const triggerSelector = navSelector + " > nav.studio-mode-nav > button.context-set-trigger";
  const dialogSelector = navSelector + " > nav.studio-mode-nav > dialog.context-set-picker-dialog";
  const choiceSelector = dialogSelector + ' forma-ui-choice-card[value="reuse"] > button.ui-choice-card[data-choice-value="reuse"]';
  const subtitleSelector = dialogSelector + " > section.context-set-picker-panel > header > p";
  const helpSelector = dialogSelector + " > section.context-set-picker-panel > .context-set-picker-empty > p";
  const trigger = page.locator(triggerSelector), dialog = page.locator(dialogSelector);
  let state, documentOwner, heldDialog, reuseFields, primaryError;
  try {
    state = await retainState(owner);
    await expect(page.locator(navSelector)).toHaveCount(1);
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toHaveAccessibleName(copy.addContext);
    await expect(trigger).toHaveAttribute("type", "button");
    documentOwner = await owner.evaluateHandle(element => {
      const doc = element.ownerDocument, store = element.store;
      const nav = element.querySelector('forma-studio-mode-nav[active="document"]');
      const trigger = nav?.querySelector(":scope > nav.studio-mode-nav > button.context-set-trigger");
      const forms = [...element.querySelectorAll("form")], controls = forms.map(form => [...form.elements]);
      if (!store || !nav || !(trigger instanceof HTMLButtonElement) || !forms.length)
        throw new Error("Require current Document owner, native Add context and nonempty original form inventory");
      const readForms = () => controls.map((items, i) => ({ className: forms[i].className,
        values: items.map(control => ({ tag: control.tagName, type: control.type, name: control.name,
          value: control.value, checked: control.checked, disabled: control.disabled })) }));
      const originalForms = readForms(), url = doc.location.href;
      return { inspect: () => {
        const projection = store.projection.get(), currentForms = [...element.querySelectorAll("form")];
        const standalone = projection.libraryBlocks.filter(block => block.scope === "library");
        const targeted = new Set(projection.libraryBlockRelations.map(relation => relation.toBlockId));
        return { sameOwner: element.isConnected && element.ownerDocument === doc && element.store === store
            && doc.querySelector("forma-workspace") === element,
          sameNav: nav.isConnected && nav.closest("forma-workspace") === element && nav.store === store
            && element.querySelector('forma-studio-mode-nav[active="document"]') === nav,
          sameTrigger: trigger.isConnected && nav.querySelector(":scope > nav.studio-mode-nav > button.context-set-trigger") === trigger,
          triggerFormNull: trigger.form === null, triggerType: trigger.type, triggerDisabled: trigger.disabled,
          triggerFocused: doc.activeElement === trigger, sameURL: doc.location.href === url,
          formCount: forms.length, sameForms: currentForms.length === forms.length && forms.every((form, i) => currentForms[i] === form),
          sameFormControls: forms.every((form, i) => form.isConnected && controls[i].length === form.elements.length
            && controls[i].every((control, j) => form.elements[j] === control && control.form === form)),
          originalForms, currentForms: readForms(), projectId: projection.projectId, documentId: projection.documentId,
          documentTitle: projection.documentTitle,
          libraryBlockIds: projection.libraryBlocks.map(block => block.id).sort(),
          libraryRootIds: standalone.filter(block => block.type !== "reference" || !targeted.has(block.id)).map(block => block.id),
          artifactIds: projection.libraryArtifacts.map(artifact => artifact.id),
          outputIds: projection.libraryOutputs.map(output => output.id).sort(),
          usableOutputIds: projection.libraryOutputs.filter(output => Boolean(output.mediaUrl) && !output.discarded).map(output => output.id),
        };
      } };
    });
    const inspectDocument = async (stage, requireTriggerFocus = false) => {
      const current = await documentOwner.evaluate(value => value.inspect());
      await attachJSON(testInfo, stage + "-document-owner", current);
      expect(current).toMatchObject({ sameOwner: true, sameNav: true, sameTrigger: true,
        triggerFormNull: true, triggerType: "button", triggerDisabled: false, sameURL: true,
        sameForms: true, sameFormControls: true, projectId: "project-atmosphere", documentId: "doc-atmosphere",
        documentTitle: "Atmosphere studies",
        libraryBlockIds: ["block-direction", "block-palette", "block-reference", "e6-network-fourth-decision"],
        libraryRootIds: [], artifactIds: [], outputIds: ["object-nocturne-01", "object-nocturne-02"], usableOutputIds: [] });
      expect(current.formCount).toBeGreaterThan(0);
      expect(current.currentForms).toEqual(current.originalForms);
      if (requireTriggerFocus) expect(current.triggerFocused).toBe(true);
      await assertState(ctx, state, stage + "-source");
    };
    await tabTo(page, trigger, 200);
    await inspectDocument("e11-studio-before-open", true);
    await observeNative(ctx, trigger, "e11-studio-add-context-unactivated", { owner: navSelector, regions: [triggerSelector] });
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(1);
    await expect(page.locator(dialogSelector + ":modal")).toHaveCount(1);
    await expect(page.locator(":modal")).toHaveCount(1);
    await expect(dialog).toHaveAccessibleName(copy.addContext);
    const choice = page.locator(choiceSelector);
    await expect(choice).toHaveCount(1);
    await expect(choice).toHaveAccessibleName(copy.fromProject + " " + copy.reusableContext);
    heldDialog = await dialog.evaluateHandle(element => {
      const nav = element.closest("forma-studio-mode-nav"), doc = element.ownerDocument;
      const panel = element.querySelector(":scope > section.context-set-picker-panel");
      const title = panel?.querySelector(":scope > header > h2#context-set-picker-title");
      const close = panel?.querySelector(":scope > button.modal-close");
      const choice = element.querySelector('forma-ui-choice-card[value="reuse"] > button[data-choice-value="reuse"]');
      if (!(element instanceof HTMLDialogElement) || !nav || !panel || !title
        || !(close instanceof HTMLButtonElement) || !(choice instanceof HTMLButtonElement))
        throw new Error("Require the actual native Studio dialog, title, close and reuse choice");
      return { inspect: () => ({
        sameDialog: element.isConnected && nav.querySelector("dialog.context-set-picker-dialog") === element,
        sameDocument: nav.ownerDocument === doc && element.ownerDocument === doc,
        modal: element.matches(":modal"), open: element.open, closedBy: element.getAttribute("closedby"),
        samePanel: panel.isConnected && element.querySelector(":scope > section.context-set-picker-panel") === panel,
        sameTitle: title.isConnected && panel.querySelector(":scope > header > h2#context-set-picker-title") === title,
        titleAssociated: element.getAttribute("aria-labelledby") === title.id
          && doc.querySelectorAll(`[id="${CSS.escape(title.id)}"]`).length === 1,
        titleRaw: title.textContent, sameClose: close.isConnected && panel.querySelector(":scope > button.modal-close") === close,
        closeName: close.getAttribute("aria-label"), closeType: close.type, closeFormNull: close.form === null,
        formCount: element.querySelectorAll("form").length,
        buttonCount: element.querySelectorAll("button").length, anchorCount: element.querySelectorAll("a").length,
        buttonsUnsubmitted: [...element.querySelectorAll("button")].every(button => button.type === "button" && button.form === null),
        choiceConnected: choice.isConnected, choiceFormNull: choice.form === null,
        choiceValue: choice.dataset.choiceValue, choiceLabel: choice.querySelector(".ui-choice-card-copy > strong")?.textContent,
        choiceDetail: choice.querySelector(".ui-choice-card-copy > small")?.textContent,
        choiceAriaLabel: choice.getAttribute("aria-label"), choiceAriaLabelledby: choice.getAttribute("aria-labelledby"),
        choicePressed: choice.getAttribute("aria-pressed"),
        initialSubtitle: panel.querySelector(":scope > header > p")?.textContent,
      }) };
    });
    const inspectDialog = async (stage, choosing) => {
      const current = await heldDialog.evaluate(value => value.inspect());
      await attachJSON(testInfo, stage + "-held-dialog", current);
      expect(current).toMatchObject({ sameDialog: true, sameDocument: true, modal: true, open: true, closedBy: "any",
        samePanel: true, sameTitle: true, titleAssociated: true, titleRaw: choosing ? copy.addContext : copy.addReusableContext,
        sameClose: true, closeName: copy.closePicker, closeType: "button", closeFormNull: true, formCount: 0,
        buttonCount: choosing ? 3 : 2, anchorCount: choosing ? 0 : 1, buttonsUnsubmitted: true,
        choiceConnected: choosing, choiceFormNull: true, choiceValue: "reuse", choiceLabel: copy.fromProject,
        choiceDetail: copy.reusableContext, choiceAriaLabel: null, choiceAriaLabelledby: null, choicePressed: null,
        initialSubtitle: choosing ? copy.initialSubtitle : copy.subtitle });
      await inspectDocument(stage);
    };
    await inspectDialog("e11-studio-choice-open", true);
    await tabTo(page, choice, 20);
    await observeNative(ctx, choice, "e11-studio-from-project-unactivated", { owner: dialogSelector,
      regions: [choiceSelector + " > .ui-choice-card-copy > strong", choiceSelector + " > .ui-choice-card-copy > small"], scope: "studio-modal" });
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveAccessibleName(copy.addReusableContext);
    await expect(dialog.locator(".context-entry-choices")).toHaveCount(0);
    await expect(dialog.locator(".context-set-picker-empty")).toHaveCount(1);
    await expect(dialog.locator(".context-set-picker-list, .context-picker-previous-work")).toHaveCount(0);
    const back = dialog.locator(".context-set-picker-panel > header > button.context-entry-back");
    const link = dialog.locator('.context-set-picker-empty > a[href="/library/blocks/editor/new"]');
    await expect(back).toHaveCount(1);
    await expect(back).toHaveAccessibleName(copy.addContext);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAccessibleName(copy.openEditor);
    reuseFields = await dialog.evaluateHandle(element => {
      const subtitle = element.querySelector(":scope > section.context-set-picker-panel > header > p");
      const empty = element.querySelector(".context-set-picker-empty"), help = empty?.querySelector(":scope > p");
      const back = element.querySelector(".context-set-picker-panel > header > button.context-entry-back"), link = empty?.querySelector(":scope > a");
      if (!subtitle || !empty || !help || !(back instanceof HTMLButtonElement) || !(link instanceof HTMLAnchorElement))
        throw new Error("Require current reuse subtitle, empty help and native back/link controls");
      return { inspect: () => ({
        sameSubtitle: subtitle.isConnected && element.querySelector(":scope > section.context-set-picker-panel > header > p") === subtitle,
        sameEmpty: empty.isConnected && element.querySelector(".context-set-picker-empty") === empty,
        sameHelp: help.isConnected && empty.querySelector(":scope > p") === help,
        sameBack: back.isConnected && element.querySelector(".context-set-picker-panel > header > button.context-entry-back") === back,
        sameLink: link.isConnected && empty.querySelector(":scope > a") === link,
        subtitle: subtitle.textContent, emptyHelp: help.textContent,
        backType: back.type, backFormNull: back.form === null, linkHref: link.getAttribute("href"),
        linkHasDownload: link.hasAttribute("download"), linkFormNull: link.closest("form") === null,
      }) };
    });
    const inspectReuse = async stage => {
      const current = await reuseFields.evaluate(value => value.inspect());
      await attachJSON(testInfo, stage + "-reuse-owners", current);
      expect(current).toEqual({ sameSubtitle: true, sameEmpty: true, sameHelp: true, sameBack: true, sameLink: true,
        subtitle: copy.subtitle, emptyHelp: copy.emptyHelp, backType: "button", backFormNull: true,
        linkHref: "/library/blocks/editor/new", linkHasDownload: false, linkFormNull: true });
      await inspectDialog(stage, false);
    };
    await inspectReuse("e11-studio-reuse-open");
    await tabTo(page, back, 20);
    await observeCopy(ctx, dialogSelector, back, [{ selector: subtitleSelector, expected: copy.subtitle }], "e11-studio-reuse-subtitle-readable");
    await inspectReuse("e11-studio-reuse-subtitle-preserved");
    await tabTo(page, link, 20);
    await observeCopy(ctx, dialogSelector, link, [{ selector: helpSelector, expected: copy.emptyHelp }], "e11-studio-reuse-empty-help-readable");
    await inspectReuse("e11-studio-reuse-empty-preserved");
    // Escape is the sole dismissal. No Back, Create, Copy, generation or link
    // navigation is activated, and no focus helper repairs the native return.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(":modal")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    const closed = await heldDialog.evaluate(value => value.inspect());
    await attachJSON(testInfo, "e11-studio-held-dialog-closed", closed);
    expect(closed).toMatchObject({ sameDialog: false, open: false, modal: false, samePanel: false, sameTitle: false, sameClose: false });
    await inspectDocument("e11-studio-native-return", true);
    await observeNative(ctx, trigger, "e11-studio-add-context-native-return", { owner: navSelector, regions: [triggerSelector] });
    await inspectDocument("e11-studio-final", true);
  } catch (error) { primaryError = error; }
  await finish(primaryError, reuseFields, heldDialog, documentOwner, state);
}
const journeys = [
  ["E11 Library localized content label and complete help preserve unsent raw input", libraryLabelJourney],
  ["E11 Layers localized inspector labels and Save preserve native associations and Discard custody", layersJourney],
  ["E11 Library neutral description and Recent Kept filtered help preserve native restoration", libraryNeutralJourney],
  ["E11 Projects summary count nouns preserve exact current project counts", projectsJourney],
  ["E11 Studio reuse subtitle and empty help preserve native modal and return custody", studioReuseJourney],
];
for (const profile of profiles) test.describe(profile.name, () => {
  test.use({ geometry: profile.geometry });
  for (const [title, journey] of journeys) test(title, async ({ page, context, geometry }, testInfo) => {
    const locale = geometry.locale ?? "en-US", key = locale.split("-")[0];
    const ctx = { page, context, geometry, testInfo, locale,
      expected: { ...e11LayersCopy[key], library: e11LibraryCopy[key], studio: e11StudioCopy[key] } };
    await journey(ctx);
    await attachJSON(testInfo, "e11-completed-journey", { title, profile: profile.name, locale,
      original138Retained: true, projectedWholeMatrix: 158,
      limit: "This reached case verdict covers its explicit native route, raw source fields and copy targets only. Matrix membership is projected until whole-suite collection; this receipt is not other-case or whole-product acceptance. Existing fixture teardown independently retains and asserts the full forbidden transport ledgers." });
  });
});
