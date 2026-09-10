import { classifyTestRequest } from "./read-only-network.mjs";
import { createDeliverDenialStep } from "./deliver-denial-step.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

/** SOURCE-ONLY proposal. Install in the existing guarded context, before navigation.
 * These are declared shared-reader responses, never personal responses relabeled.
 * No API fallback, grant, writer, export, media or direct Store refresh is admitted.
 */
export async function installSharedReaderNetwork(context, page, fixture) {
  const requireBinding = (condition, reason) => {
    if (!condition) throw new Error(`SHARED_READER_BINDING_STOP: ${reason}`);
  };
  requireBinding(process.env.FORMA_A11Y_SYNTHETIC_NETWORK === "0", "personal installer must be disabled explicitly");
  requireBinding(process.env.FORMA_DELIVER_SHARED_READER === "1", "separate shared-reader opt-in required");
  requireBinding(page.context() === context && page.url() === "about:blank", "existing page before navigation");
  requireBinding(typeof context.routeWebSocket === "function", "WebSocket interception required");
  // Reuse three exact EN320 trace responses and one separately cached public
  // font. The test replays all four offline; there is no live-font fallback.
  const retainedFonts = JSON.parse(readFileSync(new URL("../data/shared-reader-fonts.json", import.meta.url), "utf8"));
  const expectedFonts = [
  {
    "url": "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap",
    "bytes": 12597,
    "sha256": "20ebf3a70449976ba09d84e9087f2a9ecdd8787fd95112e22f9c61507ec3d468"
  },
  {
    "url": "https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSvfedN4.woff2",
    "bytes": 24576,
    "sha256": "e310b55a7fd9677f5e3555e6c6c4d064fa1f1d24393f0ddbe217cea12a8c432f"
  },
  {
    "url": "https://fonts.gstatic.com/s/dmmono/v16/aFTU7PB1QTsUX8KYthqQBK6PYK0.woff2",
    "bytes": 8688,
    "sha256": "fd7521f3531a5ccfc655b25c4f22e9871df3ec141ad79bb27fde20d0df347b6d"
  },
  {
    "url": "https://fonts.gstatic.com/s/dmmono/v16/aFTR7PB1QTsUX8KYvumzEYOtbYf-Vlg.woff2",
    "bytes": 8724,
    "sha256": "0e263db52797086e763679c54f84ded8cc1249879bc27dca2bd5dd446f6d9f36"
  }
];
  requireBinding(retainedFonts.schemaVersion === 1 && retainedFonts.responses.length === expectedFonts.length
    && retainedFonts.responses.every((row, index) => row.url === expectedFonts[index].url
      && row.bytes === expectedFonts[index].bytes && row.sha256 === expectedFonts[index].sha256),
    "four independently pinned font response identities");
  const fontResponses = new Map(retainedFonts.responses.map((row, index) => {
    const body = Buffer.from(row.bodyBase64, "base64");
    requireBinding(body.length === row.bytes && createHash("sha256").update(body).digest("hex") === row.sha256
      && row.resourceType === (index === 0 ? "stylesheet" : "font")
      && row.contentType === (index === 0 ? "text/css; charset=utf-8" : "font/woff2"), "exact retained font bytes and type");
    return [row.url, { ...row, body }];
  }));
  const freeze = value => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  // Snapshot once: subsequent caller changes cannot change identity or responses.
  const data = freeze(JSON.parse(JSON.stringify(fixture)));
  const exactIds = {
    actorUserId: "synthetic-p4-deliver-reader", ownerUserId: "synthetic-p4-deliver-owner",
    organizationId: "synthetic-p4-deliver-organization", projectAccessId: "synthetic-p4-deliver-access",
    projectId: "synthetic-p4-deliver-project", documentId: "synthetic-p4-deliver-document",
    artifactId: "synthetic-p4-deliver-story",
  };
  requireBinding(Object.entries(exactIds).every(([key, value]) => data[key] === value), "exact declared shared identities");
  requireBinding(data.origin === "http://127.0.0.1:4186" && data.head === 3
    && data.fixtureId === "priority4-deliver-shared-reader-r1", "exact fixture origin, head and ID");
  const readOnly = value => Array.isArray(value) && value.length === 1 && value[0] === "project.read";
  const session = data.session, project = session?.projectContext;
  requireBinding(session?.user?.userId === data.actorUserId && session.user.role === "creator"
    && session.impersonation === null && session.audience === "creative"
    && session.permissionEpoch === data.permissionEpoch && readOnly(session.capabilities), "declared actor, audience and read-only capabilities");
  requireBinding(project?.organizationId === data.organizationId && project.projectAccessId === data.projectAccessId
    && project.projectId === data.projectId && project.ownerUserId === data.ownerUserId
    && project.role === "reader" && readOnly(project.permissions)
    && project.expiresAt === data.expiresAt, "shared reader context, not personal authority");
  requireBinding(session.organizations?.length === 1 && session.organizations[0].organizationId === data.organizationId
    && session.projects?.length === 1 && session.projects[0].organizationId === data.organizationId
    && session.projects[0].projectAccessId === data.projectAccessId
    && session.projects[0].projectId === data.projectId && session.projects[0].role === "reader", "exact workspace declarations");
  requireBinding(data.deliverPath === "/deliver?document=synthetic-p4-deliver-document"
    && data.activityPath === "/activity?document=synthetic-p4-deliver-document", "two literal document routes");
  requireBinding(data.events?.length === 3 && data.events.every((event, index) => event.sequence === index + 1
    && event.streamId === `project:${data.projectAccessId}`)
    && data.events[2].type === "DocumentRenderCompleted"
    && data.events[2].payload.artifact_id === data.artifactId
    && data.events[2].payload.document_id === data.documentId, "finite retained-artifact declaration");
  requireBinding(data.artifactRevision === 0 && typeof data.artifactContent === "string"
    && data.content?.[data.artifactContentRef] === data.artifactContent
    && /^[a-f0-9]{64}$/.test(data.artifactContentSha256), "declared artifact identity; hash is not hydrated-byte evidence");
  const output = data.outputSnapshot, scope = output?.scope;
  requireBinding(output?.documentId === data.documentId && output.projectId === data.projectId
    && scope?.kind === "project" && scope.actorUserId === data.actorUserId
    && scope.organizationId === data.organizationId && scope.projectAccessId === data.projectAccessId
    && ["canAuthor", "canRequest", "canReview", "canDownload", "independentReview"]
      .every(key => output.permissions?.[key] === false), "read-only shared Output scope");

  const origin = data.origin, deliverUrl = origin + data.deliverPath, activityUrl = origin + data.activityPath;
  const initialEvents = "/api/events?after=0&limit=6500&content=0&profile=workspace";
  const currentEvents = "/api/events?after=3&limit=5000&content=0";
  const hydrationEvents = "/api/events?after=3&limit=1&content=1";
  const pageResult = events => ({ events, head: 3, nextAfter: 3, hasMore: false });
  const declaredReads = [
    ["/api/session", session],
    ["/api/workspaces", { organizations: session.organizations, projects: session.projects, invitations: [] }],
    ["/api/workspaces/reviews", { tasks: [] }],
    ["/api/project-notifications", { notifications: [] }],
    [`/api/workspaces/${data.organizationId}/context-packages`, { packages: [] }],
    ["/api/document-jobs", { jobs: [] }],
    ["/api/document-jobs?scope=active", { jobs: [] }],
    [`/api/document-jobs?document=${data.documentId}`, { jobs: [] }],
    [`/api/output-requirements?documentId=${data.documentId}`, output],
    [initialEvents, pageResult(data.events)],
    [currentEvents, pageResult([])],
    // Source admits this exact hydration query, but neither route need invoke it.
    // Content=0 responses never include content; the test must not force hydration.
    [hydrationEvents, { ...pageResult([]), content: data.content }],
  ];
  const bodies = Object.freeze(Object.fromEntries(declaredReads.map(([key, value]) => [key, JSON.stringify(value)])));
  const headers = Object.freeze({ "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store", "x-forma-synthetic-network": data.fixtureId });
  const documentPaths = Object.freeze([data.deliverPath, data.activityPath]);
  const caps = Object.freeze({ totalRequests: 160, eventPathRequests: 12, otherApiPathRequests: 6,
    staticPathRequests: 4, suppressedTelemetryRequests: 24, records: 160, errors: 24 });
  const counts = { requests: 0, responses200: 0, responses403: 0, fallbackStatic: 0, fallbackLocalBrowser: 0,
    fallbackPublicFont: 0, offlineFontResponses: 0, suppressedTelemetry: 0, forbidden: 0, webSocketsBlocked: 0,
    eventReadsStarted: 0, eventReadsFinished: 0, eventReadsFailed: 0, bindingErrors: 0,
    routeErrors: 0, abortErrors: 0, capErrors: 0, recordsDropped: 0, errorsDropped: 0 };
  const records = [], errors = [], perPath = new Map(), pendingEvents = new Set();
  const eventResponses = new WeakMap(), ownedDeniedResponses = new WeakMap();
  let denialStep = null, halted = false, capturedOwner = null;
  const record = item => records.length < caps.records ? records.push(item) : counts.recordsDropped++;
  const errorRecord = (stage, error) => {
    const message = String(error?.message ?? "");
    const item = { stage, name: String(error?.name ?? "Error").slice(0, 60),
      detail: /^(?:SHARED_READER_BINDING_STOP|DELIVER_DENIAL_BINDING_STOP): /.test(message)
        ? message.slice(0, 240) : "Unexpected transport error; no request body or credentials recorded" };
    if (errors.length < caps.errors) errors.push(item); else counts.errorsDropped++;
  };
  const isEventRead = request => {
    try { const url = new URL(request.url()); return url.origin === origin && url.pathname === "/api/events"; }
    catch { return false; }
  };
  // A successful fulfill call does not settle a browser request. Only the actual
  // context lifecycle events release the departure barrier.
  const trackEvent = request => {
    if (isEventRead(request) && !pendingEvents.has(request)) {
      pendingEvents.add(request); counts.eventReadsStarted++;
    }
  };
  context.on("request", trackEvent);
  context.on("response", response => {
    const request = response.request();
    if (isEventRead(request)) eventResponses.set(request, {
      status: response.status(), url: response.url(), method: request.method(),
      ownedPage: request.frame().page() === page,
    });
  });
  context.on("requestfinished", request => {
    if (pendingEvents.delete(request)) counts.eventReadsFinished++;
  });
  context.on("requestfailed", request => {
    if (pendingEvents.delete(request)) counts.eventReadsFailed++;
  });
  const observeOwner = (observation, { requirePrivateProjection = true } = {}) => {
    const observed = observation?.session;
    requireBinding(observation?.source?.authorization?.shared === true
      && typeof observation.source.authorization.key === "string" && observation.source.authorization.key.length > 0
      && Number.isSafeInteger(observation.source.generation) && observation.source.generation >= 0, "actual shared source key and generation");
    requireBinding(observed?.actorUserId === data.actorUserId && observed.organizationId === data.organizationId
      && observed.projectAccessId === data.projectAccessId && observed.projectId === data.projectId
      && observed.role === "reader" && readOnly(observed.permissions)
      && observed.permissionEpoch === data.permissionEpoch && observed.expiresAt === data.expiresAt,
    "actual witness shared-reader identity");
    // Retirement intentionally clears the private projection. It cannot restore
    // access or change the still-required captured authorization/session owner.
    if (requirePrivateProjection) requireBinding(observation.projectId === data.projectId
      && observation.documentId === data.documentId, "actual private projection before retirement");
    if (capturedOwner) requireBinding(observation.source.authorization.key === capturedOwner.key,
      "captured authorization owner unchanged");
  };
  const abort = async (route, item, reason) => {
    counts.forbidden++; halted = true; record({ ...item, decision: "abort", reason });
    try { await route.abort("blockedbyclient"); }
    catch (error) { counts.abortErrors++; halted = true; errorRecord("abort", error); }
  };

  await context.routeWebSocket("**/*", async socket => {
    counts.webSocketsBlocked++; counts.forbidden++; halted = true;
    record({ method: "WEBSOCKET", decision: "close", reason: "no_shared_reader_websocket" });
    try { await socket.close({ code: 1008, reason: "No WebSocket in finite shared-reader transport" }); }
    catch (error) { counts.abortErrors++; errorRecord("websocket-close", error); }
  });
  await context.route("**/*", async route => {
    let item = { method: "UNKNOWN", path: "unparsed", resourceType: "unknown" };
    try {
      const request = route.request();
      const url = new URL(request.url());
      const input = { method: request.method(), url: url.href, resourceType: request.resourceType(), postData: request.postData() };
      item = { method: input.method, origin: url.origin, path: url.pathname, resourceType: input.resourceType };
      counts.requests++;
      if (halted) return await abort(route, item, "transport_halted");
      if (counts.requests > caps.totalRequests) {
        counts.capErrors++; halted = true; return await abort(route, item, "total_request_cap");
      }
      requireBinding(request.frame().page() === page, "only existing fixture page may request");
      trackEvent(request);
      if (url.username || url.password || url.hash) return await abort(route, item, "URL_credentials_or_fragment");
      const classification = classifyTestRequest(input, origin);
      const api = /^\/api(?:\/|$)/i.test(decodeURIComponent(url.pathname));
      const pathKey = url.origin + url.pathname;
      const pathCount = (perPath.get(pathKey) ?? 0) + 1;
      perPath.set(pathKey, pathCount);
      const pathCap = classification === "suppressed-telemetry" ? caps.suppressedTelemetryRequests
        : url.origin === origin && url.pathname === "/api/events" ? caps.eventPathRequests
        : api ? caps.otherApiPathRequests : caps.staticPathRequests;
      if (pathCount > pathCap) {
        counts.capErrors++; halted = true; return await abort(route, item, "path_request_cap");
      }
      if (classification === "suppressed-telemetry") {
        counts.suppressedTelemetry++;
        if (counts.suppressedTelemetry > caps.suppressedTelemetryRequests) {
          counts.capErrors++; halted = true; return await abort(route, item, "telemetry_cap");
        }
        record({ ...item, decision: "abort_telemetry" });
        try { await route.abort("blockedbyclient"); }
        catch (error) { counts.abortErrors++; halted = true; errorRecord("telemetry-abort", error); }
        return;
      }
      if (url.origin === origin && url.pathname === "/api/events" && denialStep) {
        // Only after real departure may the transport query the parent-installed
        // read-only witness. Wrong query/owner/route is an abort, never a 200.
        const observation = await page.evaluate(() => {
          if (typeof window.__formaDeliverReaderWitness?.sample !== "function") throw new Error("Missing shared-reader witness");
          return window.__formaDeliverReaderWitness.sample();
        });
        observeOwner(observation, { requirePrivateProjection: denialStep.evidence().phase === "armed" });
        if (denialStep.evidence().phase === "armed") requireBinding(observation.sourceActive === true,
          "first re-entry denial belongs to the actual active source");
        const response = denialStep.responseFor({ method: input.method, url: url.href }, observation);
        requireBinding(response?.status === 403, "armed event route must deny, never fallback");
        record({ ...item, query: url.search, decision: "deny403", phase: denialStep.evidence().phase });
        await route.fulfill(response); counts.responses403++;
        ownedDeniedResponses.set(request, { url: url.href, method: input.method,
          authorizationKey: capturedOwner.key, sourceGeneration: capturedOwner.generation,
          observedGeneration: observation.source.generation, ownedPage: request.frame().page() === page });
        return;
      }
      const pathAndQuery = url.pathname + url.search;
      if (url.origin === origin && input.method === "GET" && Object.hasOwn(bodies, pathAndQuery)) {
        record({ ...item, query: url.search, decision: "fixture200" });
        await route.fulfill({ status: 200, headers, body: bodies[pathAndQuery] });
        counts.responses200++;
        return;
      }
      if (!["GET", "HEAD"].includes(input.method)) return await abort(route, item, "unadmitted_method");
      if (classification === "local-browser") {
        counts.fallbackLocalBrowser++; record({ ...item, decision: "fallback_local_browser" });
        await route.fallback(); return;
      }
      if (classification === "public-font") {
        const retained = fontResponses.get(url.href);
        if (input.method === "GET" && retained?.resourceType === input.resourceType) {
          await route.fulfill({ status: 200, headers: { "content-type": retained.contentType,
            "access-control-allow-origin": "*", "cache-control": "no-store" }, body: retained.body });
          counts.offlineFontResponses++;
          record({ ...item, decision: "retained_font_offline", sha256: retained.sha256, bytes: retained.bytes });
          return;
        }
        // All other external fonts remain forbidden; never fall through to the
        // generic guard's public-font network allowance.
        return await abort(route, item, "external_font_not_admitted");
      }
      if (url.origin !== origin || api || ["fetch", "xhr", "eventsource", "websocket"].includes(input.resourceType)) {
        return await abort(route, item, "unadmitted_API_or_transport");
      }
      const documentRoute = input.resourceType === "document" && documentPaths.includes(pathAndQuery);
      const asset = !url.search && /^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|css|woff|woff2)$/.test(url.pathname)
        && (url.pathname.endsWith(".js") && input.resourceType === "script"
          || url.pathname.endsWith(".css") && input.resourceType === "stylesheet"
          || /\.woff2?$/.test(url.pathname) && input.resourceType === "font");
      if (!documentRoute && !asset) return await abort(route, item, "undeclared_static_path");
      counts.fallbackStatic++; record({ ...item, decision: "fallback_exact_static" });
      // Retain generic guardReadOnlyNetwork underneath. No continue() shortcut.
      await route.fallback();
    } catch (error) {
      counts.routeErrors++; halted = true;
      if (/^(?:SHARED_READER_BINDING_STOP|DELIVER_DENIAL_BINDING_STOP): /.test(String(error?.message ?? ""))) counts.bindingErrors++;
      errorRecord("route", error);
      await abort(route, item, "unexpected_route_error");
    }
  });

  return Object.freeze({
    get pendingEventReads() { return pendingEvents.size; },
    armDeparture(observation) {
      try {
        requireBinding(!halted && !denialStep, "one non-halted departure only");
        observeOwner(observation);
        requireBinding(observation.currentUrl === activityUrl && page.url() === activityUrl && observation.deliverDisconnected === true
          && observation.deliverConnected === false && observation.sourceActive === true
          && pendingEvents.size === 0, "native Activity departure and actually settled source reads");
        capturedOwner = Object.freeze({ key: observation.source.authorization.key, generation: observation.source.generation });
        const step = createDeliverDenialStep({ origin, eventsUrl: origin + currentEvents, deliverUrl,
          authorizationKey: capturedOwner.key, sourceGeneration: capturedOwner.generation });
        step.armAfterDeparture({ source: observation.source, deliverDisconnected: observation.deliverDisconnected,
          pendingEventReads: pendingEvents.size });
        denialStep = step;
        record({ decision: "armed_after_native_departure", sourceGeneration: capturedOwner.generation,
          pendingEventReads: pendingEvents.size, currentUrl: observation.currentUrl });
      } catch (error) {
        counts.bindingErrors++; halted = true; errorRecord("armDeparture", error); throw error;
      }
    },
    recordSourceRetirement(detail) {
      try {
        requireBinding(!halted && denialStep && detail?.source?.authorization?.shared === true,
          "actual shared-source retirement after denial");
        denialStep.recordSourceRetirement(detail);
        record({ decision: "source_retirement_recorded", generation: detail.generation });
      } catch (error) {
        counts.bindingErrors++; halted = true; errorRecord("recordSourceRetirement", error); throw error;
      }
    },
    evidence() {
      const denial = denialStep?.evidence() ?? null;
      const retirement = denial?.retirements[0];
      const pendingEventReadDetails = [...pendingEvents].map(request => {
        const response = eventResponses.get(request), ownedDenial = ownedDeniedResponses.get(request);
        const ownedDeniedUnfinished = Boolean(retirement && ownedDenial && response
          && response.status === 403 && response.method === "GET" && response.ownedPage
          && response.url === origin + currentEvents && request.url() === response.url
          && request.method() === "GET" && ownedDenial.ownedPage && ownedDenial.method === "GET"
          && ownedDenial.url === response.url && ownedDenial.authorizationKey === retirement.authorizationKey
          && ownedDenial.sourceGeneration === retirement.sourceGeneration
          && retirement.generation > ownedDenial.sourceGeneration);
        return { method: request.method(), url: request.url(), observedResponseStatus: response?.status ?? null,
          owned403Fulfilled: Boolean(ownedDenial), classification: ownedDeniedUnfinished
            ? "owned_denied_body_awaiting_native_finish" : "unexpected_pending_read" };
      });
      const ownedDeniedUnfinished = pendingEventReadDetails.filter(read => read.classification === "owned_denied_body_awaiting_native_finish").length;
      return {
        status: "TRANSPORT_ONLY_NOT_ACCEPTANCE", fixture: data.fixtureId, halted,
        phase: denialStep?.evidence().phase ?? "ready", counts: { ...counts }, caps: { ...caps },
        pendingEventReads: pendingEvents.size,
        pendingEventReadDetails,
        pendingLifecycle: { rawPending: pendingEvents.size, ownedDeniedUnfinished,
          unexpectedPending: pendingEvents.size - ownedDeniedUnfinished,
          countersBalanced: counts.eventReadsStarted === counts.eventReadsFinished + counts.eventReadsFailed + pendingEvents.size,
          limit: "Denied-body transport completion is not established until actual requestfinished/requestfailed. Fulfillment, headers and source retirement do not settle a request." },
        perPathRequests: Object.fromEntries(perPath),
        records: records.map(value => ({ ...value })), errors: errors.map(value => ({ ...value })),
        denial, admittedReads: Object.keys(bodies), documentPaths: [...documentPaths],
        declaredArtifact: { id: data.artifactId, revision: data.artifactRevision, contentSha256: data.artifactContentSha256,
          contentBytes: "DECLARED_ONLY; hydration and exact observed content are separate runner evidence" },
        limits: "Unknown bootstrap requests are integration gaps. Native population, same Store, actual reader identity, departure/re-entry, source retirement, Shell withdrawal, focus and cleanup require separate runner evidence. No live IAM, provider, export, media or whole-journey acceptance.",
      };
    },
  });
}
