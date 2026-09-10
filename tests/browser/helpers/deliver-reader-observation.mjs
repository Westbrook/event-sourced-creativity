/** Proposed observer only. Install before navigation in the sole synthetic page.
 * It observes actual Store public capture/read methods and DOM; no setters,
 * private-method calls, refresh, navigation, focus, storage or event injection.
 * Source capture registers the existing Store ownership token, not a fake token.
 */
export function installDeliverReaderWitness(fixture) {
  if (Object.hasOwn(window, "__formaDeliverReaderWitness")) throw new Error("Duplicate Deliver witness");
  let initialDeliver = null, baselineSource = null, baselineStore = null, unsubscribe = null;
  const retirements = [], frames = [], unexpected = [], seenExtraEvents = new Set();
  let unexpectedCount = 0, unexpectedEventCount = 0;
  const recordError = error => { unexpectedCount++; if (unexpected.length < 20) unexpected.push(String(error).slice(0, 1200)); };
  const require = (value, message) => { if (!value) throw new Error(`DELIVER_READER_STOP: ${message}`); };
  const identity = element => element ? { tag: element.localName, id: element.id, classes: element.getAttribute("class") } : null;
  const paint = element => {
    if (!element) return null;
    const r = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { ...identity(element), text: element.textContent.trim(), box: { x: r.x, y: r.y, width: r.width, height: r.height },
      hidden: Boolean(element.closest("[hidden],[inert]")), display: style.display, visibility: style.visibility,
      focused: document.activeElement === element, focusVisible: element.matches(":focus-visible") };
  };
  const shellStore = () => {
    const shells = document.querySelectorAll("forma-shell"); require(shells.length === 1 && shells[0].isConnected, "one actual Shell");
    const shell = shells[0], store = shell.store;
    require(store && typeof store.captureSourceOwnership === "function", "actual application Store read surface");
    require(!baselineStore || store === baselineStore, "same exact Store object throughout departure and retirement");
    return { shell, store };
  };
  const checkSession = session => {
    const context = session?.projectContext;
    require(session?.user.userId === fixture.actorUserId && session.user.role === "creator" && !session.impersonation,
      "exact declared principal and ordinary Creator shell, no impersonation");
    require(context && ["organizationId", "projectAccessId", "projectId", "ownerUserId", "expiresAt"]
      .every(key => context[key] === fixture[key]), "actual shared project context");
    require(context.role === "reader" && context.ownerUserId !== session.user.userId
      && JSON.stringify(context.permissions) === '["project.read"]'
      && JSON.stringify(session.capabilities) === '["project.read"]'
      && session.permissionEpoch === fixture.permissionEpoch && Date.parse(context.expiresAt) > Date.now(), "unexpired reader-only authority");
    return { actorUserId: session.user.userId, organizationId: context.organizationId, projectAccessId: context.projectAccessId,
      projectId: context.projectId, ownerUserId: context.ownerUserId, role: context.role, permissions: [...context.permissions],
      permissionEpoch: session.permissionEpoch, expiresAt: context.expiresAt };
  };
  const sample = () => {
    require(location.origin === fixture.origin && [fixture.deliverPath, fixture.activityPath].includes(location.pathname + location.search), "exact declared view route");
    const { shell, store } = shellStore(), session = checkSession(store.session.get());
    const source = store.captureSourceOwnership(); require(source?.authorization.shared === true, "actual shared source token");
    const projection = store.projection.get(), deliverNodes = shell.querySelectorAll("forma-deliver");
    require(deliverNodes.length <= 1, "no duplicate Deliver owner");
    const deliver = deliverNodes[0] ?? null, artifactRows = projection.libraryArtifacts ?? [];
    const summaries = [...(deliver?.querySelectorAll("forma-artifact-summary") ?? [])];
    const exactSummaries = summaries.filter(element => element.artifact?.id === fixture.artifactId);
    require(exactSummaries.length <= 1, "unique exact declared artifact summary");
    const summary = exactSummaries[0] ?? null, card = summary?.closest("article.forma-deliver-card") ?? null;
    const preview = card?.querySelector(":scope > a.forma-deliver-preview") ?? null;
    const artifact = artifactRows.find(row => row.id === fixture.artifactId) ?? null;
    const rawContent = store.content.get()[fixture.artifactContentRef];
    if (rawContent !== undefined) require(rawContent === fixture.artifactContent, "unchanged hydrated source bytes if present");
    const main = shell.querySelector("main#main-content"), status = main?.querySelector(":scope > .application-loading[role=status]") ?? null;
    const retries = [...(status?.querySelectorAll("button") ?? [])];
    const events = store.events.get(), optimistic = store.optimisticEvents.get();
    for (const event of [...events, ...optimistic]) if (!fixture.events.some(known => known.eventId === event.eventId)) { unexpectedEventCount++; if (seenExtraEvents.size < 50) seenExtraEvents.add(event.type + ":" + event.eventId); }
    return { status: "OBSERVATIONS_ONLY", currentUrl: location.href, route: store.route.get(), session,
      source, sourceActive: store.sourceOwnershipActive(source), oldSourceActive: baselineSource ? store.sourceOwnershipActive(baselineSource) : null,
      projectId: projection.projectId, documentId: projection.documentId, sourceReady: store.routeDataReady(),
      documentRouteState: store.documentRouteState(), error: store.error.get(), loading: store.loading.get(),
      deliverConnected: Boolean(deliver?.isConnected), deliverDisconnected: Boolean(initialDeliver && !initialDeliver.isConnected),
      reconnectedDifferentOwner: Boolean(initialDeliver && deliver && deliver !== initialDeliver),
      counts: { deliver: deliverNodes.length, cards: deliver?.querySelectorAll(".forma-deliver-card").length ?? 0,
        artifactSummaries: summaries.length, visualHosts: deliver?.querySelectorAll("forma-output-visual").length ?? 0,
        outputViews: shell.querySelectorAll("forma-output-requirements").length,
        events: events.length, optimisticEvents: optimistic.length, libraryArtifacts: artifactRows.length,
        libraryOutputs: projection.libraryOutputs?.length ?? 0, contentEntries: Object.keys(store.content.get()).length },
      artifact: artifact ? { id: artifact.id, documentId: artifact.documentId, kind: artifact.kind, title: artifact.title,
        summary: artifact.summary, contentRef: artifact.contentRef, sourceEventId: artifact.sourceEventId, sequence: artifact.sequence } : null,
      summaryArtifact: summary ? { id: summary.artifact.id, kind: summary.artifact.kind, documentId: summary.artifact.documentId } : null,
      card: paint(card), preview: preview ? { ...paint(preview), href: preview.getAttribute("href") } : null,
      sourceContent: { contentRef: fixture.artifactContentRef, declaredSha256: fixture.artifactContentSha256,
        state: rawContent === undefined ? "NOT_HYDRATED_IN_THIS_VIEW" : "EXACT_DECLARED_BYTES_PRESENT",
        limit: "Declaration hash is not proof of hydration or artifact quality." },
      unavailable: paint(status), retry: retries.length === 1 ? paint(retries[0]) : null, retryCount: retries.length,
      activeElement: identity(document.activeElement), unexpectedEvents: [...seenExtraEvents],
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio, visualScale: visualViewport?.scale ?? null } };
  };
  const rememberPopulated = () => {
    require(!initialDeliver && !baselineSource, "one original populated observation");
    const { shell, store } = shellStore(), value = sample();
    require(value.sourceActive && value.sourceReady && value.documentRouteState === "ready"
      && value.currentUrl === fixture.origin + fixture.deliverPath && value.projectId === fixture.projectId
      && value.documentId === fixture.documentId, "populated source and exact address");
    require(value.counts.cards === 1 && value.counts.artifactSummaries === 1 && value.counts.visualHosts === 0
      && value.counts.libraryArtifacts === 1 && value.counts.libraryOutputs === 0, "one non-media artifact, not an empty substitute");
    require(value.artifact?.id === fixture.artifactId && value.artifact.kind === fixture.artifactKind
      && value.artifact.documentId === fixture.documentId && value.artifact.contentRef === fixture.artifactContentRef
      && value.artifact.sourceEventId === fixture.events.at(-1).eventId
      && value.artifact.title === fixture.artifactTitle && value.artifact.summary === fixture.artifactSummary,
      "exact source event/ref/public artifact");
    require(value.summaryArtifact?.id === fixture.artifactId && value.preview?.href, "owned native summary preview");
    const href = new URL(value.preview.href, location.origin);
    require(href.origin === fixture.origin && href.pathname.startsWith("/library/artifact/" + encodeURIComponent(fixture.artifactId) + "/")
      && href.searchParams.get("document") === fixture.documentId && href.searchParams.get("revision") === String(fixture.artifactRevision)
      // This legacy shared artifact has no source-version approval requirement.
      // Existing project.read policy permits its receipt-gated export path;
      // Output snapshot download permissions are a separate resource contract.
      && href.searchParams.get("intent") === "export", "same declared artifact revision-qualified export-intent preview; never activate");
    require(!href.searchParams.has("sha256") || href.searchParams.get("sha256") === fixture.artifactContentSha256, "no mismatched advertised digest");
    const preview = shell.querySelector("forma-deliver .forma-deliver-card > a.forma-deliver-preview");
    const r = preview.getBoundingClientRect(), center = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    require(value.card && !value.card.hidden && value.card.display !== "none" && value.card.visibility === "visible"
      && !value.preview.hidden && value.preview.display !== "none" && value.preview.visibility === "visible"
      && r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
      && center && preview.contains(center), "visible source-bound preview in viewport, not a hidden retained subtree");
    initialDeliver = shell.querySelector("forma-deliver"); baselineStore = store; baselineSource = store.captureSourceOwnership();
    unsubscribe = store.subscribe(() => { try { sample(); } catch (error) { recordError(error); } });
    return sample();
  };
  const onRetired = event => {
    try {
      require(baselineSource, "retirement follows populated baseline");
      const detail = event.detail;
      require(detail?.status === 403 && detail.source?.authorization.key === baselineSource.authorization.key
        && detail.source.generation === baselineSource.generation && detail.generation > baselineSource.generation, "owned actual retirement event");
      retirements.push(JSON.parse(JSON.stringify(detail)));
      require(retirements.length === 1, "one current-source retirement");
      frames.push({ stage: "retirement-dispatch-before-render", observation: sample() });
      queueMicrotask(() => { try { frames.push({ stage: "retirement-microtask", observation: sample() }); } catch (error) { recordError(error); } });
      requestAnimationFrame(() => { try { frames.push({ stage: "first-retirement-animation-frame", observation: sample() }); } catch (error) { recordError(error); } });
    } catch (error) { recordError(error); }
  };
  window.addEventListener("forma-event-source-retired", onRetired);
  Object.defineProperty(window, "__formaDeliverReaderWitness", { value: Object.freeze({ sample, rememberPopulated,
    evidence: () => ({ status: "OBSERVATIONS_ONLY", retirements: [...retirements], frames: [...frames], unexpected: [...unexpected],
      unexpectedCount, unexpectedEventCount, unexpectedEvents: [...seenExtraEvents], limits: "Current DOM/source and first-frame observations only. No reload-safe cache/queue deletion, full focus perimeter, physical input, live IAM or whole Deliver claim." }),
    detach: () => { unsubscribe?.(); window.removeEventListener("forma-event-source-retired", onRetired); },
  }), configurable: false });
}
