import { expect } from "@playwright/test";
import { localTestOrigin } from "./read-only-network.mjs";
import { SYNTHETIC_NETWORK_MARKER, syntheticNetworkEnabled } from "./synthetic-network.mjs";

const requireEvidence = (condition, message) => {
  if (!condition) throw new Error("Initial session observation: " + message);
};
const readJSON = (text, label) => {
  try { return JSON.parse(text); }
  catch { throw new Error("Initial session observation: invalid " + label + " JSON"); }
};
const validSession = value => Boolean(value && typeof value === "object"
  && typeof value.user?.userId === "string" && value.user.userId.length > 0
  && typeof value.policy?.version === "string" && value.policy.version.length > 0
  && typeof value.policy.accepted === "boolean" && typeof value.provider?.configured === "boolean"
  && value.budgets?.user && typeof value.budgets.user === "object"
  && value.budgets.workspace && typeof value.budgets.workspace === "object"
  && (value.capabilities === undefined || Array.isArray(value.capabilities) && value.capabilities.every(item => typeof item === "string"))
  && (value.projectContext == null || typeof value.projectContext === "object"
    && typeof value.projectContext.projectId === "string" && Array.isArray(value.projectContext.permissions)
    && value.projectContext.permissions.every(item => typeof item === "string")));

function embeddedSession(html) {
  // Only worker/session-bootstrap.ts's emitted envelope, never HTML execution
  // or a general DOM parser. Escaped <>& ensure account text cannot add a tag.
  const markers = [...html.matchAll(/<script\b[^>]*\bid=["']forma-session-bootstrap["'][^>]*>/gi)];
  if (markers.length === 0) return null;
  requireEvidence(markers.length === 1, "ambiguous main-document bootstrap");
  const body = /<body\b[^>]*>/i.exec(html);
  const boundary = body ? body.index + body[0].length : -1;
  const match = /^<script id="forma-session-bootstrap" type="application\/json" data-server-ms="(\d+(?:\.\d+)?)">([\s\S]*?)<\/script>/.exec(html.slice(boundary));
  requireEvidence(boundary >= 0 && markers[0].index === boundary && Boolean(match), "unsupported bootstrap envelope");
  const session = readJSON(match[2], "main-document bootstrap");
  requireEvidence(validSession(session), "bootstrap lacks the real Creative session shape");
  return { session, serverMs: Number(match[1]) };
}

/** Observe only the initial, actually delivered Creative session. No fetch,
 * browser storage, private Store, script insertion, or manufactured authority. */
export function observeInitialSession(page, expectedPath) {
  const frame = page.mainFrame(), sessions = new Map();
  let navigation = null, disposed = false, read = false;
  const requestFrame = request => {
    try { return request.frame(); } catch { return null; }
  };
  const onRequest = request => {
    if (requestFrame(request) !== frame) return;
    if (request.isNavigationRequest() && request.resourceType() === "document") {
      navigation = { request, response: null }; return;
    }
    const url = new URL(request.url());
    if (navigation && request.method() === "GET" && url.pathname === "/api/session" && url.search === "") {
      sessions.set(request, { request, navigation, response: null });
    }
  };
  const onResponse = response => {
    const request = response.request();
    if (navigation?.request === request) navigation.response = response;
    const session = sessions.get(request);
    if (session) session.response = response;
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  return {
    async read() {
      requireEvidence(!disposed && !read, "observer is disposed or already consumed");
      read = true;
      await expect.poll(() => Boolean(navigation?.response), {
        message: "The actual owned main-document response must be observed", timeout: 10_000,
      }).toBe(true);
      const owned = navigation, response = owned.response, url = new URL(response.url());
      localTestOrigin(url.origin);
      const current = () => !disposed && navigation === owned && page.mainFrame() === frame
        && requestFrame(owned.request) === frame && response.request() === owned.request
        && owned.request.method() === "GET" && owned.request.url() === url.href
        && page.url() === url.href && new URL(expectedPath, url.origin).href === url.href;
      requireEvidence(current() && response.ok(), "main-document URL, frame, request or status changed");
      const headers = response.headers();
      requireEvidence(/^text\/html(?:;|$)/i.test(headers["content-type"] ?? ""), "main document is not HTML");
      const cache = (headers["cache-control"] ?? "").toLowerCase().split(",").map(value => value.trim());
      const privateNoStore = cache.includes("private") && cache.includes("no-store");
      const html = await response.text();
      requireEvidence(current(), "main document was superseded while reading its body");
      const bootstrap = embeddedSession(html);
      let session, transport, sessionStatus = null, transportSynthetic = false;
      const synthetic = syntheticNetworkEnabled(url.origin);
      if (bootstrap) {
        requireEvidence(!synthetic, "synthetic transport must observe its declared GET, never a real bootstrap");
        requireEvidence(privateNoStore, "authenticated HTML bootstrap must be private and no-store");
        session = bootstrap.session; transport = "main-document-bootstrap";
      } else {
        const candidate = () => [...sessions.values()].find(item => item.navigation === owned
          && new URL(item.request.url()).origin === url.origin);
        await expect.poll(() => Boolean(candidate()?.response), {
          message: "No bootstrap: require the app's actual same-navigation /api/session GET", timeout: 10_000,
        }).toBe(true);
        const actual = candidate(), reply = actual.response;
        requireEvidence(current() && reply.request() === actual.request && reply.ok()
          && requestFrame(actual.request) === frame && reply.url() === new URL("/api/session", url.origin).href,
        "session GET is failed, foreign or superseded");
        requireEvidence(/^application\/json(?:;|$)/i.test(reply.headers()["content-type"] ?? ""), "session GET is not JSON");
        session = readJSON(await reply.text(), "observed session GET");
        requireEvidence(validSession(session), "session GET lacks the real Creative session shape");
        const marker = reply.headers()["x-forma-synthetic-network"];
        requireEvidence(synthetic ? marker === SYNTHETIC_NETWORK_MARKER : marker === undefined,
          "session response synthetic marker does not match the explicitly selected mode");
        transportSynthetic = synthetic;
        sessionStatus = reply.status(); transport = "observed-session-get";
      }
      requireEvidence(current(), "initial session no longer belongs to the current main document");
      return { session, evidence: {
        transport, documentPath: url.pathname, documentStatus: response.status(),
        mainFrameRequestBound: true, privateNoStore, bootstrapServerMs: bootstrap?.serverMs ?? null,
        observedSessionGetStatus: sessionStatus, authenticatedUserPresent: !transportSynthetic,
        ...(transportSynthetic ? { transportSynthetic: true, authority: "explicit synthetic personal-author declaration" } : {}),
        sharedProjectContext: Boolean(session.projectContext),
        permissionCount: (session.projectContext?.permissions ?? session.capabilities ?? []).length,
        limits: transportSynthetic
          ? "Actual browser response binding and synthetic session shape only; not authentication, live permission or organization-task evidence. Disposable browser cache may contain these declarations."
          : "Original response provenance and session shape only; payload stays in memory. Not fabricated authentication or an organization-task pass.",
      } };
    },
    dispose() {
      disposed = true;
      page.off("request", onRequest); page.off("response", onResponse);
      sessions.clear(); navigation = null;
    },
  };
}
