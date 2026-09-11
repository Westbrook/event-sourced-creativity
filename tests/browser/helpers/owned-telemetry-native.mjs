// Pure, bounded source proposal. Synthetic unit inputs are not browser evidence.
const blocked = /^net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/;
const resource = /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/;
const digest = /^[a-f0-9]{64}$/;
const endpoint = /^http:\/\/127\.0\.0\.1:4186\/api\/(?:performance|events\/hot)$/;
const signature = request => typeof request.url === "string" && endpoint.test(request.url) && request.method === "POST"
  && ["fetch", "xhr"].includes(request.resourceType)
  && Number.isInteger(request.bodyBytes) && request.bodyBytes >= 0 && request.bodyBytes <= 65536
  && typeof request.bodySha256 === "string" && digest.test(request.bodySha256)
  ? JSON.stringify([request.url, request.method, request.resourceType, request.bodyBytes, request.bodySha256]) : null;
const consoleKey = (value, native = false) => typeof value.text === "string" && typeof value.url === "string"
  && Number.isFinite(value.timestamp) && value.timestamp > 0
  && Number.isInteger(value.lineNumber ?? 0) && (value.lineNumber ?? 0) >= 0
  && (native || value.columnNumber === 0)
  ? JSON.stringify([value.timestamp, value.text, value.url, value.lineNumber ?? 0, 0]) : null;
const groups = (values, key) => {
  const result = new Map();
  for (const value of values) { const k = key(value); if (k !== null) result.set(k, [...result.get(k) ?? [], value]); }
  return result;
};

export function reconcileNativeTelemetry(snapshot) {
  const { requests, nativeRequests, nativeLogs, console: notices, mainFrameId } = snapshot;
  const issues = [], consoleResults = new Map(), logResults = new Map();
  let pendingNative = 0;
  const result = (id, classification, reason, extra = {}) => ({ id, classification, reason, ...extra });
  const stop = reason => ({
    console: notices.slice(0, 32).map(x => result(x.id, "unexpected", reason)),
    nativeLog: nativeLogs.slice(0, 32).map(x => result(x.id, "unexpected", reason)),
    issues: [reason], pendingNative: 0,
  });
  if (requests.length > 64 || nativeRequests.length > 64 || nativeLogs.length > 32 || notices.length > 32)
    return stop("record_bounds_exceeded");
  if (snapshot.recordLoss) return stop("record_loss_invalidates_identity");
  if (snapshot.runtimeConsoleErrors) return stop("runtime_console_error_or_assert");
  if (snapshot.ready !== true || typeof mainFrameId !== "string" || !mainFrameId)
    return stop("native_session_not_ready");
  if (requests.some(x => !Number.isInteger(x.id) || x.id < 1)
    || notices.some(x => !Number.isInteger(x.id) || x.id < 1)
    || nativeLogs.some(x => !Number.isInteger(x.id) || x.id < 1)
    || nativeRequests.some(x => typeof x.id !== "string" || !x.id || x.id.length > 160))
    return stop("invalid_record_identity");
  if (new Set(requests.map(x => x.id)).size !== requests.length
    || new Set(nativeRequests.map(x => x.id)).size !== nativeRequests.length
    || new Set(nativeLogs.map(x => x.id)).size !== nativeLogs.length
    || new Set(notices.map(x => x.id)).size !== notices.length) return stop("duplicate_record_identity");
  const pwGroups = groups(requests, signature), nativeGroups = groups(nativeRequests, signature);
  const nativeById = new Map(nativeRequests.map(x => [x.id, x]));
  const logsById = groups(nativeLogs, x => typeof x.networkRequestId === "string" && x.networkRequestId ? x.networkRequestId : null);
  const logsByKey = groups(nativeLogs, x => consoleKey(x, true)), noticesByKey = groups(notices, x => consoleKey(x));
  const requestVerdict = new Map();
  for (const request of requests) {
    const key = signature(request), peers = key === null ? [] : pwGroups.get(key), matches = key === null ? [] : nativeGroups.get(key) ?? [];
    if (!key || request.owned !== true || request.mainFrameOwned !== true) {
      issues.push(`unqualified_playwright_request:${request.id}`); continue;
    }
    if (peers.length !== 1 || matches.length > 1) {
      issues.push(`ambiguous_request_signature:${request.id}`);
      for (const match of matches) requestVerdict.set(match.id, result(match.id, "ambiguous", "duplicate_body_signature"));
      continue;
    }
    if (!matches.length) { pendingNative++; continue; }
    const native = matches[0];
    const invalid = native.frameId !== mainFrameId || Boolean(native.urlFragment)
      || native.redirected !== false || native.requestCount !== 1
      || native.finishedCount !== 0 || native.responseCount !== 0 || ![0, 1].includes(native.failedCount)
      || typeof request.abortSettled !== "boolean" || typeof request.abortCompleted !== "boolean"
      || request.finishedOrdinal !== null || request.abortSettled && !request.abortCompleted
      || request.failedOrdinal !== null && (!Number.isInteger(request.failedOrdinal) || typeof request.failureText !== "string" || !blocked.test(request.failureText)
        || !(request.failedOrdinal > request.abortStartedOrdinal))
      || native.failedCount === 1 && (typeof native.failureText !== "string" || !blocked.test(native.failureText));
    if (invalid) {
      issues.push(`contradictory_request_lifecycle:${request.id}`);
      requestVerdict.set(native.id, result(native.id, "unexpected", "contradictory_request_lifecycle")); continue;
    }
    if (!request.abortCompleted || !request.abortSettled || request.failedOrdinal === null || native.failedCount === 0) {
      pendingNative++; requestVerdict.set(native.id, result(native.id, "pending", "request_lifecycle_unsettled")); continue;
    }
    if (!Number.isInteger(request.abortStartedOrdinal) || request.abortStartedOrdinal < 1
      || native.failureText !== request.failureText) {
      issues.push(`failure_identity_mismatch:${request.id}`);
      requestVerdict.set(native.id, result(native.id, "unexpected", "failure_identity_mismatch")); continue;
    }
    requestVerdict.set(native.id, result(native.id, "expected", "unique_full_body_native_request_bridge", { requestId: request.id }));
    const linkedLogs = logsById.get(native.id) ?? [];
    if (!linkedLogs.length) pendingNative++;
    else if (linkedLogs.length !== 1) issues.push(`duplicate_native_request_log:${native.id}`);
  }
  for (const native of nativeRequests) {
    if (typeof native.id !== "string" || !native.id || !signature(native)) issues.push("invalid_native_request_identity_or_body");
    if (!requestVerdict.has(native.id)) { issues.push(`native_request_without_owned_bridge:${native.id}`); }
  }
  for (const log of nativeLogs) {
    const native = nativeById.get(log.networkRequestId), verdict = requestVerdict.get(log.networkRequestId);
    if (log.source !== "network" || log.level !== "error" || log.workerId || !resource.test(log.text ?? "")
      || !native || log.url !== native.url || !consoleKey(log, true)) {
      logResults.set(log.id, result(log.id, "unexpected", "not_exact_native_network_log")); continue;
    }
    if ((logsById.get(native.id) ?? []).length !== 1 || (logsByKey.get(consoleKey(log, true)) ?? []).length !== 1) {
      logResults.set(log.id, result(log.id, "ambiguous", "duplicate_native_log_identity")); continue;
    }
    if (!verdict || verdict.classification !== "expected") {
      logResults.set(log.id, result(log.id, verdict?.classification ?? "unexpected", verdict?.reason ?? "no_owned_bridge")); continue;
    }
    if (log.text !== `Failed to load resource: ${native.failureText}`) {
      logResults.set(log.id, result(log.id, "unexpected", "native_log_failure_mismatch")); continue;
    }
    const publicPeers = noticesByKey.get(consoleKey(log, true)) ?? [];
    if (publicPeers.length !== 1) {
      if (!publicPeers.length) pendingNative++;
      logResults.set(log.id, result(log.id, publicPeers.length ? "ambiguous" : "pending", "public_console_conservation")); continue;
    }
    logResults.set(log.id, result(log.id, "expected", "native_request_id_and_exact_public_timestamp", {
      requestId: verdict.requestId, networkRequestId: native.id,
    }));
  }
  for (const notice of notices) {
    const key = consoleKey(notice), matches = key === null ? [] : logsByKey.get(key) ?? [];
    if (key === null || !resource.test(notice.text ?? "") || !endpoint.test(notice.url ?? "")) {
      consoleResults.set(notice.id, result(notice.id, "unexpected", "not_exact_public_resource_error")); continue;
    }
    if (matches.length > 1 || (noticesByKey.get(key) ?? []).length > 1) {
      consoleResults.set(notice.id, result(notice.id, "ambiguous", "duplicate_timestamp_location_identity")); continue;
    }
    if (!matches.length) {
      pendingNative++; consoleResults.set(notice.id, result(notice.id, "pending", "native_log_not_observed")); continue;
    }
    const verdict = logResults.get(matches[0].id);
    consoleResults.set(notice.id, { ...verdict, id: notice.id });
  }
  return { console: [...consoleResults.values()], nativeLog: [...logResults.values()], issues, pendingNative };
}
