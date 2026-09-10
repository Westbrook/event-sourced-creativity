/**
 * Unexecuted finite addition to an existing admitted no-egress fixture.
 * No imports, network, Store/DOM mutation, timers, storage or launch code.
 * The existing fixture supplies actual request/navigation/source observations.
 */
export function createDeliverDenialStep(binding) {
  const require = (value, message) => {
    if (!value) throw new Error(`DELIVER_DENIAL_BINDING_STOP: ${message}`);
  };
  const origin = new URL(binding.origin);
  require(origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"]
    .includes(origin.hostname) && origin.origin === binding.origin, "exact local origin");
  const target = new URL(binding.eventsUrl);
  require(target.origin === origin.origin && target.pathname === "/api/events"
    && !target.username && !target.password && !target.hash, "exact event-read URL");
  const deliver = new URL(binding.deliverUrl);
  require(deliver.origin === origin.origin && deliver.pathname === "/deliver"
    && !deliver.username && !deliver.password, "exact Creator Deliver URL");
  require(typeof binding.authorizationKey === "string" && binding.authorizationKey.length > 0
    && Number.isSafeInteger(binding.sourceGeneration) && binding.sourceGeneration >= 0,
    "exact admitted synthetic source owner");
  const authorizationKey = binding.authorizationKey, sourceGeneration = binding.sourceGeneration;
  let phase = "ready", denialCount = 0;
  const retirements = [];
  const ownerMatches = source => source?.authorization?.key === authorizationKey
    && source.generation === sourceGeneration;
  return Object.freeze({
    armAfterDeparture(observation) {
      require(phase === "ready", "one transition only");
      require(observation.deliverDisconnected === true && observation.pendingEventReads === 0
        && ownerMatches(observation.source), "native departure and settled exact source");
      phase = "armed";
    },
    responseFor(request, observation) {
      const url = new URL(request.url);
      // null means the existing finite transport must handle or reject it.
      // It never means network continuation or a backend fallback.
      if (phase === "ready") return null;
      if (url.origin !== origin.origin || url.pathname !== "/api/events") return null;
      require(request.method === "GET", "no event writer");
      require(url.href === target.href, "no broadened query or pagination matcher");
      require(observation.currentUrl === deliver.href
        && observation.source?.authorization?.key === authorizationKey,
        "no denial after route or authorization ownership changes");
      if (phase === "armed") {
        require(observation.deliverConnected === true
          && observation.currentUrl === deliver.href && ownerMatches(observation.source),
          "denial belongs to native Deliver re-entry, not an older background read");
        phase = "denied";
      }
      denialCount += 1;
      // Repeat matching reads stay denied. Restoring access is not this case.
      return {
        status: 403,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ error: "project_access_revoked" }),
      };
    },
    recordSourceRetirement(detail) {
      require(phase === "denied" && denialCount > 0, "retirement must follow actual fixture denial");
      require(detail?.status === 403 && ownerMatches(detail.source)
        && Number.isSafeInteger(detail.generation) && detail.generation > sourceGeneration,
        "exact current source retired with a newer generation");
      require(retirements.length === 0, "one owned retirement witness");
      retirements.push({ status: detail.status, sourceGeneration: detail.source.generation,
        generation: detail.generation, authorizationKey: detail.source.authorization.key });
    },
    evidence() {
      return {
        status: "TRANSPORT_WITNESS_ONLY_NOT_ACCEPTANCE",
        phase, denialCount, retirements: retirements.map(value => ({ ...value })),
        origin: origin.origin, eventsUrl: target.href, deliverUrl: deliver.href,
        limits: "Native connection, visible populated resource, exact identity, Shell withdrawal, focus, forbidden-effect and cleanup evidence remain required from the existing runner.",
      };
    },
  });
}
