/** Pure validation of already parsed, retained completed-original metadata.
 * This never issues custody, spends money, claims a lease, or reads a provider.
 * The caller must separately require the authentic native original proof. */
type Row = Record<string, unknown>;
export type SelectedShareMediaRecoveryObservation = Readonly<{
  output: "audio" | "video" | "model3d";
  jobId: unknown; slotId: unknown; completionId: unknown; completionClient: unknown;
  request: unknown; result: unknown; publicCompletion: unknown; privateCompletion: unknown;
}>;
const object = (value: unknown): Row | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const own = (row: object, key: string) => Object.hasOwn(row, key);
const closed = (value: unknown, required: readonly string[], optional: readonly string[] = []): value is Row => {
  const row = object(value);
  return Boolean(row && required.every(key => own(row, key)) && Object.keys(row).every(key => required.includes(key) || optional.includes(key)));
};
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const token = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length <= maximum;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const rendererClient = "server:document-job:render_document";
const commonLease = ["version", "token", "expiresAt", "clientRequestId", "providerRequestId", "requestDigest", "priorStatus", "priorErrorCode", "priorCompletedAt"];
const terminal = ["status", "completionEventId"];
const videoLease = [...commonLease, "evidenceMode", "storageKey"];
const modelLease = [...commonLease, "jobId", "slotId", "originalSubmission", "originalResultSha256"];
const videoKeys = ["outputVideoRecovery", "outputVideoRecoveryEnvelopes"];
const modelKeys = ["outputModel3dRecovery", "outputModel3dRecoveryHistory", "outputModel3dRecoveryEnvelopes", "outputModel3dRecoveryFiles"];

/** Capture data descriptors only. Besides bounded server JSON, this pure helper
 * safely refuses direct accessor/proxy failures without invoking a getter. */
function capture(value: unknown): unknown {
  let count = 0, bytes = 0;
  const encoder = new TextEncoder(), parents = new Set<object>();
  function read(item: unknown, depth: number): unknown {
    if (++count > 100000 || depth > 64) throw Error("bounds");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") { if (!Number.isFinite(item)) throw Error("number"); return item; }
    if (typeof item === "string") { bytes += encoder.encode(item).length; if (bytes > 1048576) throw Error("bytes"); return item; }
    if (!item || typeof item !== "object" || parents.has(item)) throw Error("data");
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw Error("prototype");
    parents.add(item);
    try {
      const keys = Reflect.ownKeys(item), result: Row = Object.create(null);
      let length = 0;
      if (array) {
        const field = Object.getOwnPropertyDescriptor(item, "length");
        if (!field || !own(field, "value") || !Number.isSafeInteger(field.value) || field.value < 0 || field.value > 100000) throw Error("array");
        length = field.value; if (keys.length !== length + 1) throw Error("array keys");
      }
      for (const key of keys) {
        if (array && key === "length") continue;
        if (typeof key !== "string" || array && (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= length)) throw Error("key");
        const field = Object.getOwnPropertyDescriptor(item, key);
        if (!field?.enumerable || !own(field, "value")) throw Error("accessor");
        bytes += encoder.encode(key).length; if (bytes > 1048576) throw Error("bytes");
        result[key] = read(field.value, depth + 1);
      }
      return array ? Array.from({ length }, (_, index) => result[index]) : result;
    } finally { parents.delete(item); }
  }
  return read(value, 0);
}
function lineage(value: unknown, allowedRoot: readonly string[] = []): boolean {
  const pending: { value: unknown; root: boolean }[] = [{ value, root: true }];
  while (pending.length) {
    const current = pending.pop()!;
    if (Array.isArray(current.value)) { pending.push(...current.value.map(value => ({ value, root: false }))); continue; }
    const row = object(current.value); if (!row) continue;
    for (const [key, child] of Object.entries(row)) {
      if (/sponsor|workflow|replacement/iu.test(key) || /recover/iu.test(key) && !(current.root && allowedRoot.includes(key))) return false;
      pending.push({ value: child, root: false });
    }
  }
  return true;
}
function prior(row: Row): boolean {
  return token(row.token) && timestamp(row.expiresAt) && identifier(row.clientRequestId) && identifier(row.providerRequestId)
    && hash(row.requestDigest) && row.priorStatus === "failed" && (row.priorErrorCode === null || text(row.priorErrorCode, 131072))
    && (row.priorCompletedAt === null || timestamp(row.priorCompletedAt));
}
function array(value: unknown, maximum: number, check: (row: unknown, index: number) => boolean): boolean {
  return Array.isArray(value) && value.length <= maximum && value.every(check);
}
function videoRecovery(result: Row, settings: Row, input: Row): boolean {
  const cp = result.outputVideoRecovery, receipt = object(settings.output_video), media = object(receipt?.media),
    request = object(result.outputVideoMediaCheckpoint), completed = object(result.outputVideoMediaResult);
  if (!closed(cp, [...videoLease, ...terminal], ["evidenceToken"]) || !prior(cp) || cp.version !== "output-video-recovery-v1"
    || cp.status !== "completed" || cp.completionEventId !== input.completionId || !receipt || !media || !request || !completed
    || receipt.jobId !== input.jobId || receipt.slotId !== input.slotId
    || cp.clientRequestId !== request.clientRequestId || cp.clientRequestId !== completed.clientRequestId
    || cp.requestDigest !== request.requestDigest || cp.requestDigest !== completed.requestDigest
    || cp.providerRequestId !== completed.providerRequestId || cp.providerRequestId !== media.providerRequestId
    || typeof media.mediaUrl !== "string" || !media.mediaUrl.startsWith("/api/media/")
    || cp.storageKey !== decodeURIComponent(media.mediaUrl.slice("/api/media/".length))
    || cp.evidenceMode !== "original" && cp.evidenceMode !== "retrieved"
    || cp.evidenceMode === "original" && own(cp, "evidenceToken")
    || cp.evidenceMode === "retrieved" && own(cp, "evidenceToken") && !token(cp.evidenceToken)) return false;
  if (own(result, "outputVideoRecoveryEnvelopes") && !array(result.outputVideoRecoveryEnvelopes, 64, row =>
    closed(row, ["version", "token", "phase", "responseRef", "envelopeSha256", "decodedBodySha256", "expiresAt"])
      && row.version === "output-video-recovery-envelope-v1" && token(row.token) && ["status", "result"].includes(String(row.phase))
      && identifier(row.responseRef) && hash(row.envelopeSha256) && hash(row.decodedBodySha256) && timestamp(row.expiresAt))) return false;
  // Native Video proves the actual decisive original/retrieved envelope bodies.
  // This shape check cannot replace it or refresh expired history into a lease.
  return cp.evidenceMode !== "retrieved" || Array.isArray(result.outputVideoRecoveryEnvelopes);
}
function originalSubmission(value: unknown, receipt: Row, preview: Row): boolean {
  if (!closed(value, ["clientRequestId", "provider", "operation", "model", "status", "providerRequestId"],
    ["unitId", "requestDigest", "costMicrousd", "inputTokens", "outputTokens", "totalTokens"])) return false;
  const row = value;
  if (row.provider !== "fal" || row.operation !== "model3d" || row.model !== preview.model
    || !["accepted", "completed"].includes(String(row.status)) || row.clientRequestId !== receipt.mediaCallId
    || row.providerRequestId !== receipt.providerRequestId || own(row, "requestDigest") && row.requestDigest !== receipt.requestDigest
    || own(row, "unitId") && row.unitId !== "model3d:initial"
    || own(row, "costMicrousd") && (!Number.isSafeInteger(row.costMicrousd) || Number(row.costMicrousd) < 0 || Number(row.costMicrousd) > Number(preview.maximumMicrousd))
    || ["inputTokens", "outputTokens", "totalTokens"].some(key => own(row, key) && row[key] !== 0)) return false;
  // Completed submissions passed the original recovery checkpoint's same
  // price/zero-token condition; an accepted historical submission is not a bill.
  return row.status !== "completed" || row.costMicrousd === preview.maximumMicrousd
    && row.inputTokens === 0 && row.outputTokens === 0 && row.totalTokens === 0;
}

function modelRecovery(result: Row, settings: Row, input: Row): boolean {
  const cp = result.outputModel3dRecovery, evidence = object(settings.output_model3d), receipt = object(evidence?.receipt), preview = object(evidence?.costPreview);
  if (!closed(cp, [...modelLease, ...terminal]) || !prior(cp) || cp.version !== "output-model3d-recovery-v1"
    || cp.status !== "completed" || cp.completionEventId !== input.completionId || !evidence || !receipt || !preview
    || cp.jobId !== input.jobId || cp.slotId !== input.slotId || evidence.jobId !== input.jobId
    || object(evidence.execution)?.slotId !== input.slotId || cp.clientRequestId !== receipt.mediaCallId
    || cp.providerRequestId !== receipt.providerRequestId || cp.requestDigest !== receipt.requestDigest
    || !hash(cp.originalResultSha256) || !originalSubmission(cp.originalSubmission, receipt, preview)) return false;
  // Claim always appends its immutable lease; finish only adds the two terminal
  // fields. Older entries are audit history, not current authority or expiry.
  const history = result.outputModel3dRecoveryHistory;
  if (!array(history, 32, row => closed(row, modelLease) && prior(row) && row.version === "output-model3d-recovery-v1"
      && row.jobId === input.jobId && row.slotId === input.slotId && hash(row.originalResultSha256)
      && row.clientRequestId === receipt.mediaCallId && row.providerRequestId === receipt.providerRequestId && row.requestDigest === receipt.requestDigest
      && originalSubmission(row.originalSubmission, receipt, preview)) || !Array.isArray(history) || !history.length) return false;
  const last = object(history.at(-1))!;
  if (!modelLease.every(key => JSON.stringify(last[key]) === JSON.stringify(cp[key]))) return false;
  const tokens = new Set(history.map(row => object(row)!.token));
  if (own(result, "outputModel3dRecoveryEnvelopes") && !array(result.outputModel3dRecoveryEnvelopes, 64, row =>
    closed(row, ["token", "phase", "responseRef", "sha256", "expiresAt"]) && tokens.has(row.token)
      && ["status", "result"].includes(String(row.phase)) && identifier(row.responseRef) && hash(row.sha256) && timestamp(row.expiresAt))) return false;
  if (own(result, "outputModel3dRecoveryFiles") && !array(result.outputModel3dRecoveryFiles, 64, (row, index) => {
    if (!closed(row, ["index", "token", "storageKey", "sha256", "file", "providerMediaUrl"]) || row.index !== index
      || !tokens.has(row.token) || !text(row.storageKey, 2048) || !hash(row.sha256) || !text(row.providerMediaUrl, 4000)) return false;
    const file = row.file;
    return closed(file, ["url", "mimeType", "fileName", "fileSize", "format", "role", "sha256"], ["previewSupported"])
      && file.sha256 === row.sha256 && file.url === "/api/media/" + encodeURIComponent(row.storageKey)
      && text(file.mimeType, 127) && text(file.fileName, 512) && positive(file.fileSize)
      && (file.format === null || text(file.format, 32)) && ["mesh", "texture", "preview"].includes(String(file.role))
      && (!own(file, "previewSupported") || typeof file.previewSupported === "boolean");
  })) return false;
  return true;
}

/** Returns true only for unchanged ordinary lineage or the exact kind-specific
 * completed original recovery grammar. Its boolean is not a custody token. */
export function selectedOutputShareMediaRecoveryLineage(value: SelectedShareMediaRecoveryObservation): boolean {
  try {
    const input = object(capture(value));
    if (!input) return false;
    const request = object(input.request), result = object(input.result), publicCompletion = object(input.publicCompletion), completion = object(input.privateCompletion);
    if (!request || !result || !publicCompletion || !completion || !lineage(request) || !lineage(publicCompletion)) return false;
    const output = input.output, recoveryKey = output === "video" ? "outputVideoRecovery" : output === "model3d" ? "outputModel3dRecovery" : "";
    if (!recoveryKey || !own(result, recoveryKey)) return input.completionClient === rendererClient && lineage(result) && lineage(completion);
    const settings = object(completion.settings), client = output === "video" ? "output-video-recovery" : "output-model3d-recovery";
    if (own(result, "outputVideoStop") || own(result, "outputModel3dStop")) return false;
    if (!settings || !identifier(input.jobId) || !identifier(input.slotId) || !identifier(input.completionId)
      || completion.source_surface !== "outputs" || completion.artifact_kind !== output
      || !(input.completionClient === client ? completion.recovered === true
        : input.completionClient === rendererClient && !own(completion, "recovered"))) return false;
    const allowed = output === "video" ? videoKeys : modelKeys;
    if (!lineage(result, allowed) || !lineage(completion, input.completionClient === client ? ["recovered"] : [])) return false;
    return output === "video" ? videoRecovery(result, settings, input) : modelRecovery(result, settings, input);
  } catch { return false; }
}
