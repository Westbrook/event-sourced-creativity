import { isOutputFixtureReadOnlyResume } from "./output-reachability-fixture.mjs";
import { untilScene } from "./scene-cost-store-host.mjs";

/** Test-only evidence for the original SceneStoreHost transport, not application
 * authority. No replay, response substitution or endpoint-wide exemption.
 * The response clone is awaited before returning the SAME original response:
 * observation adds latency and is not a zero-timing-effect probe. The SQLite
 * total_changes counter is connection-wide; concurrent writes conservatively
 * prevent certification, rather than being attributed to this read.
 */
export function observeActualSceneResumeReads(host) {
  const proofs = new WeakMap(), observations = [], prior = host.transport;
  const classify = request => {
    const proof = proofs.get(request);
    return Boolean(proof && request.init === proof.init && request.init.body === proof.body
      && isOutputFixtureReadOnlyResume(request, proof.scope));
  };
  const executeOriginalTransport = async request => {
    const projection = host.store.projection.get(), authorization = host.store.captureAuthorizationScope(), source = host.store.captureSourceOwnership();
    const scope = Object.freeze({ projectId: projection.projectId, documentId: projection.documentId });
    const exact = isOutputFixtureReadOnlyResume(request, scope);
    const owned = Boolean(authorization && host.store.authorizationScopeActive(authorization)
      && source && host.store.sourceOwnershipActive(source));
    const candidate = exact && owned, init = request.init, body = request.init?.body;
    const before = candidate ? host.worker.sqlite.prepare("SELECT total_changes() AS changes").get().changes : null;
    const response = await (prior ? prior(request) : host.worker.request(request.url, request.init));
    if (!candidate) return response;
    let returned = null, readError = null;
    try { returned = await response.clone().json(); } catch (error) { readError = String(error?.name ?? "unreadable"); }
    const after = host.worker.sqlite.prepare("SELECT total_changes() AS changes").get().changes;
    const unchanged = request.init === init && request.init.body === body;
    const exactNone = Boolean(returned && typeof returned === "object" && !Array.isArray(returned)
      && Object.keys(returned).length === 1 && returned.status === "none");
    if (response.status === 200 && exactNone && before === after && unchanged)
      proofs.set(request, { scope, init, body });
    observations.push(Object.freeze({ url: request.url, method: request.init.method, body: Object.freeze(JSON.parse(body)), scope,
      dispatchOwned: owned, responseStatus: response.status, responseStatusValue: returned?.status ?? null, exactNone,
      sqliteChangesBefore: before, sqliteChangesAfter: after, sqliteUnchanged: before === after,
      inputUnchanged: unchanged, classified: classify(request), clonedOuterRowClassified: classify({ ...request }), readError }));
    return response;
  };
  // Retain the original transport Promise; test settlement never sends a request.
  const pendingOriginals = new Map();
  const transport = request => {
    const original = executeOriginalTransport(request);
    pendingOriginals.set(original, request);
    original.then(() => pendingOriginals.delete(original), () => pendingOriginals.delete(original));
    return original;
  };
  host.transport = transport;
  // A test-owned verified held write is still pending, not a certified read.
  // Omitted options retain the original full count/wait. Never exclude a clone
  // or more than one original Promise for the exact supplied request object.
  const forSettlement = heldOriginal => {
    const entries = [...pendingOriginals.entries()];
    if (!heldOriginal || typeof heldOriginal.current !== "function" || heldOriginal.current() !== true) return entries;
    const held = entries.filter(([, request]) => request === heldOriginal.request);
    return held.length === 1 ? entries.filter(([promise]) => promise !== held[0][0]) : entries;
  };
  return { isReadOnlyResume: classify, observations: () => [...observations],
    pendingOriginalCount: ({ heldOriginal } = {}) => forSettlement(heldOriginal).length,
    async settleOriginalRequests({ heldOriginal } = {}) {
      const captured = forSettlement(heldOriginal); let terminal = false;
      const settlement = Promise.allSettled(captured.map(([promise]) => promise)).then(results => { terminal = true; return results; });
      await untilScene(() => terminal, "Already-started original transports must settle within the existing finite Scene boundary");
      const results = await settlement;
      return captured.map(([, request], index) => ({ request, status: results[index].status,
        responseStatus: results[index].status === "fulfilled" ? results[index].value.status : null }));
    },
    restore() { if (host.transport === transport) host.transport = prior; } };
}
