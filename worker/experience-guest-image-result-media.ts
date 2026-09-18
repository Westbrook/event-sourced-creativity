import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";
import { guestImageResultMediaOperation, GUEST_IMAGE_RESULT_MEDIA_LIMITS, type GuestImageResultMediaOperation } from "./experience-guest-image-result-media-operation.ts";
import type { GuestImageResultInventory } from "./experience-guest-image-result-inventory.ts";
import type { WorkerEnv } from "./runtime.ts";

const unavailable = (): never => { throw new Error("guest_image_result_media_unavailable"); };
const encoder = new TextEncoder();
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const setBytes = Uint8Array.prototype.set;
const fillBytes = Uint8Array.prototype.fill;
const getReader = ReadableStream.prototype.getReader;
const cancelBody = ReadableStream.prototype.cancel;
const readChunk = ReadableStreamDefaultReader.prototype.read;
const cancelReader = ReadableStreamDefaultReader.prototype.cancel;
const releaseReader = ReadableStreamDefaultReader.prototype.releaseLock;
const forbiddenMetadata = new Set(["organizationId", "projectAccessId", "outputId", "operationSha256", "requestSha256",
  "sourceMediaUrl", "sourceMediaSha256", "sourceRevision", "modelSourceKey", "modelSourceSha256", "modelView",
  "parentGenerationId", "derivedFrom", "derivedFromGenerationId"]);
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit
  && value.isWellFormed() && !/[\p{Cc}]/u.test(value) && encoder.encode(value).byteLength <= limit;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

type ObjectMetadata = Readonly<{ size: number; mimeType: "image/png"; httpEtag: string;
  custom: Readonly<Record<string, string>>; http: readonly (readonly [string, string])[];
  identity: Readonly<Partial<Record<"key" | "version" | "etag", string>>> }>;
function captureMetadata(operation: GuestImageResultMediaOperation, object: unknown, key: string): ObjectMetadata {
  operation.charge("metadataCaptures");
  if (!object || typeof object !== "object") return unavailable();
  // Native R2 fields can be prototype getters. Preserve their real receiver;
  // only the returned custom metadata map is qualified as bounded JSON data.
  const size: unknown = Reflect.get(object, "size", object), httpEtag: unknown = Reflect.get(object, "httpEtag", object);
  const raw: unknown = Reflect.get(object, "customMetadata", object), writer: unknown = Reflect.get(object, "writeHttpMetadata", object);
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > MAX_OUTPUT_ASSET_BYTES
    || !text(httpEtag, 1024) || !httpEtag || !plain(raw) || typeof writer !== "function") return unavailable();
  const keys = Reflect.ownKeys(raw);
  if (keys.length < 1 || keys.length > 64) return unavailable();
  const custom: Record<string, string> = Object.create(null);
  let total = encoder.encode(httpEtag).byteLength;
  for (const name of keys) {
    if (typeof name !== "string" || !text(name, 128) || !name || ["__proto__", "prototype", "constructor"].includes(name)
      || forbiddenMetadata.has(name)) return unavailable();
    const descriptor = Object.getOwnPropertyDescriptor(raw, name);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || !text(descriptor.value, 8192)) return unavailable();
    total += encoder.encode(name).byteLength + encoder.encode(descriptor.value).byteLength;
    if (total > 32768) return unavailable();
    custom[name] = descriptor.value;
  }
  const headers = new Headers(); Reflect.apply(writer, object, [headers]);
  const http: (readonly [string, string])[] = [];
  for (const [name, value] of headers) {
    if (http.length >= 32 || !text(name, 128) || !text(value, 8192)) return unavailable();
    total += encoder.encode(name).byteLength + encoder.encode(value).byteLength;
    if (total > 32768) return unavailable();
    http.push(Object.freeze([name, value] as const));
  }
  if (headers.get("content-type") !== "image/png") return unavailable();
  http.sort(([a], [b]) => a.localeCompare(b));
  const identity: Partial<Record<"key" | "version" | "etag", string>> = {};
  for (const field of ["key", "version", "etag"] as const) if (Reflect.has(object, field)) {
    const value: unknown = Reflect.get(object, field, object);
    if (!text(value, 1024) || !value || field === "key" && value !== key) return unavailable();
    identity[field] = value; total += encoder.encode(field).byteLength + encoder.encode(value).byteLength;
  }
  if (total > 32768) return unavailable();
  operation.charge("metadataBytes", total);
  const { manifest, producer } = operation;
  const expected = { ownerId: manifest.guestSubject, artifactId: manifest.generationId, generationId: manifest.generationId,
    model: producer.model, provider: producer.provider, adapter: producer.adapter, providerRequestId: producer.providerRequestId,
    source: "provider-image-api", mimeType: "image/png", sha256: manifest.object.contentSha256,
    outputNativeStorage: "1", outputScopeKey: manifest.nativeIdentity.scopeKey, outputSlotId: manifest.nativeIdentity.slotId,
    outputOwnerId: manifest.guestSubject, outputDocumentId: manifest.documentId, outputSha256: manifest.object.contentSha256 };
  if (Object.entries(expected).some(([name, value]) => custom[name] !== value)) return unavailable();
  operation.check();
  return Object.freeze({ size, mimeType: "image/png", httpEtag, custom: Object.freeze(custom), http: Object.freeze(http), identity: Object.freeze(identity) });
}
function sameMetadata(left: ObjectMetadata, right: ObjectMetadata): boolean {
  const sorted = (value: Readonly<Record<string, string>>) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return left.size === right.size && left.mimeType === right.mimeType && left.httpEtag === right.httpEtag
    && JSON.stringify(left.http) === JSON.stringify(right.http)
    && JSON.stringify(sorted(left.custom)) === JSON.stringify(sorted(right.custom))
    && JSON.stringify(sorted(left.identity)) === JSON.stringify(sorted(right.identity));
}
function ownBuffer(operation: GuestImageResultMediaOperation, size: number): Uint8Array<ArrayBuffer> {
  operation.check();
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_OUTPUT_ASSET_BYTES) return unavailable();
  const bytes = new Uint8Array(size);
  try { return operation.own(bytes); }
  catch (error) { fillBytes.call(bytes, 0); throw error; }
}
async function readOriginal(operation: GuestImageResultMediaOperation, key: string) {
  const delivery: { body: ReadableStream<Uint8Array> | null } = { body: null };
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let active = true, complete = false;
  const release = () => { try { if (reader) releaseReader.call(reader); } catch { /* A pending read still owns the lock. */ } };
  const cancel = () => {
    try {
      const pending = reader ? cancelReader.call(reader) : delivery.body ? cancelBody.call(delivery.body) : null;
      if (pending) void pending.then(release, release);
    } catch { /* Cancellation is best effort and never blocks refusal. */ }
    release();
  };
  const removeCleanup = operation.onStop(() => { active = false; cancel(); });
  try {
    operation.charge("get");
    const object = await operation.wait(() => operation.bucket.get(key), value => {
      // Acquire the actual body even if the foreground already timed out.
      delivery.body = value?.body ?? null;
      if (!active) cancel();
    });
    operation.check();
    const metadata = captureMetadata(operation, object, key);
    const body = delivery.body;
    if (!(body instanceof ReadableStream)) return unavailable();
    const bytes = ownBuffer(operation, metadata.size);
    reader = getReader.call(body) as ReadableStreamDefaultReader<Uint8Array>; let offset = 0;
    while (true) {
      operation.charge("streamReads");
      const next = await operation.wait(() => readChunk.call(reader!));
      operation.check();
      if (next.done) {
        if (next.value !== undefined || offset !== metadata.size) return unavailable();
        complete = true; break;
      }
      const chunk: unknown = next.value;
      if (!(chunk instanceof Uint8Array) || Object.getPrototypeOf(chunk) !== Uint8Array.prototype
        || !(bufferOf.call(chunk) instanceof ArrayBuffer)) return unavailable();
      const length: number = byteLengthOf.call(chunk);
      if (!Number.isSafeInteger(length) || length < 1 || length > metadata.size - offset) return unavailable();
      setBytes.call(bytes, chunk, offset); offset += length;
    }
    operation.check(); return { bytes, metadata };
  } finally {
    active = false; if (!complete) cancel(); else release(); removeCleanup();
  }
}

declare const observationBrand: unique symbol;
export type GuestImageResultMedia = Readonly<{ [observationBrand]: true }>;
export type GuestImageResultMediaReview = Readonly<{ version: 1; kind: "guest-image-result-media";
  mimeType: "image/png"; sha256: string; byteLength: number; width: number; height: number;
  freshBytesVerified: true; custodyTransferred: false; publicReadAvailable: false }>;
type Observation = { request: Request; env: WorkerEnv; operation: GuestImageResultMediaOperation;
  bytes: Uint8Array<ArrayBuffer> | null; review: GuestImageResultMediaReview };
const observations = new WeakMap<GuestImageResultMedia, Observation>();
function observation(request: Request, env: WorkerEnv, token: GuestImageResultMedia): Observation {
  const value = token && typeof token === "object" ? observations.get(token) : undefined;
  if (!value || value.request !== request || value.env !== env) return unavailable();
  value.operation.check(); return value;
}

/** One private observation of the exact original object. This performs no copy,
 * destination selection, provider action, publication or custody transfer. */
export async function readGuestImageResultMedia(request: Request, env: WorkerEnv, inventory: GuestImageResultInventory): Promise<GuestImageResultMedia> {
  const operation = guestImageResultMediaOperation(request, env, inventory);
  try {
    operation.charge("readAttempts");
    operation.charge("inspectionScratchBytes", GUEST_IMAGE_RESULT_MEDIA_LIMITS.inspectionScratchBytes);
    const { manifest } = operation, expected = manifest.object;
    const key = `${ownerMediaNamespace(manifest.guestSubject)}/generated/${manifest.generationId}.png`;
    if (expected.storageKey !== key || expected.mimeType !== "image/png") return unavailable();
    await operation.fullProof(); operation.check();
    const { bytes, metadata } = await readOriginal(operation, key); operation.check();
    // A filename does not select the inspector's parser. Refuse other signatures
    // before admitting PNG scratch or dispatching any other format inspector.
    if (bytes.length < 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => bytes[index] !== byte)) return unavailable();
    // The unchanged inspector hashes these same immutable bytes once.
    operation.charge("hash");
    operation.charge("inspection");
    const inspected = await operation.use(bytes, () => inspectOutputAsset(bytes, "image.png", { snapshot: false })); operation.check();
    if (inspected.status !== "inspected" || inspected.kind !== "image" || inspected.extension !== "png" || inspected.mimeType !== "image/png"
      || inspected.sha256 !== expected.contentSha256 || inspected.byteLength !== metadata.size
      || inspected.facts.width !== expected.width || inspected.facts.height !== expected.height) return unavailable();
    operation.charge("head");
    const head = await operation.wait(() => operation.bucket.head(key)); operation.check();
    const final = captureMetadata(operation, head, key);
    if (!sameMetadata(metadata, final)) return unavailable();
    await operation.fullProof(); operation.check();
    const review: GuestImageResultMediaReview = Object.freeze({ version: 1, kind: "guest-image-result-media", mimeType: "image/png",
      sha256: expected.contentSha256, byteLength: metadata.size, width: expected.width, height: expected.height,
      freshBytesVerified: true, custodyTransferred: false, publicReadAvailable: false });
    const token = Object.freeze({}) as GuestImageResultMedia;
    const captured: Observation = { request, env, operation, bytes, review };
    operation.onStop(() => { captured.bytes = null; observations.delete(token); });
    operation.check(); observations.set(token, captured); return token;
  } catch (error) { operation.stop(); throw error; }
}

/** Safe scalar review only; this local fence is not a fresh database proof. */
export function guestImageResultMediaReview(request: Request, env: WorkerEnv, token: GuestImageResultMedia): GuestImageResultMediaReview {
  return observation(request, env, token).review;
}

/** Internal one-shot consumption after a fresh full proof. The consumer owns a
 * separate copy until its actual promise settles, including after timeout. No
 * raw synchronous byte accessor or public route is installed by this module. */
export async function consumeGuestImageResultMedia<T>(request: Request, env: WorkerEnv, token: GuestImageResultMedia,
  consumer: (bytes: Uint8Array<ArrayBuffer>, review: GuestImageResultMediaReview) => Promise<T>): Promise<T> {
  const value = observation(request, env, token), { operation } = value;
  try {
    operation.charge("consumeAttempts");
    if (typeof consumer !== "function") return unavailable();
    await operation.fullProof(); operation.check();
    let copy: Uint8Array<ArrayBuffer>;
    {
      const source = value.bytes;
      if (!source) return unavailable();
      copy = ownBuffer(operation, source.byteLength);
      setBytes.call(copy, source);
    }
    operation.check();
    const result = await operation.use(copy, () => consumer(copy, value.review));
    operation.check(); return result;
  } finally { operation.stop(); }
}
