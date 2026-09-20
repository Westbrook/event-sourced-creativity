import type { WorkerEnv } from './runtime.ts';
import { memoryCanonical } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { nativeDerivationSourceInputs, nativeDerivationSourceGuards, nativeDerivationSourceStatements, replayNativeDerivationSources,
  type NativeDerivationSourceCapture } from './memory-derivation-sources.ts';

export const NATIVE_DERIVATION_MANIFEST_VERSION = 'native-memory-manifest-v1';
const maximumBytes = 256 * 1024;
type Capture = ReturnType<typeof nativeDerivationSourceInputs>;
export type NativeDerivationManifestData = Readonly<{
  version: typeof NATIVE_DERIVATION_MANIFEST_VERSION;
  jobId: string; purpose: Capture['purpose']; scopeKey: string; binding: Capture['binding'];
  /** Original retention, never the short access-proof TTL or a fresh read time. */
  expiresAt: string;
  originals: Omit<Capture['originals'][number], 'text'>[];
  originalBacking: Capture['originalBacking']; observations: Capture['observations'];
  behavioralSources?: Capture['behavioralSources']; provenance: Capture['provenance']; coverage: Capture['coverage']; history?: Capture['history'];
}>;
declare const manifestBrand: unique symbol;
export type NativeDerivationManifest = Readonly<{ [manifestBrand]: true }>;
type Issued = { env: WorkerEnv; db: WorkerEnv['DB']; capture: NativeDerivationSourceCapture; serialized: string; sha256: string };
const manifests = new WeakMap<NativeDerivationManifest, Issued>();

/** Durable data contains no source bodies, prompts, SQL or access capability.
 * It is still PRIVATE user data: identifiers, hashes and observations must be
 * erased with their result, not put in analytics or the retained money ledger. */
function serialize(source: Capture): string {
  const value: NativeDerivationManifestData = {
    version: NATIVE_DERIVATION_MANIFEST_VERSION, jobId: source.jobId, purpose: source.purpose,
    scopeKey: source.scopeKey, binding: source.binding, expiresAt: source.retentionCeiling,
    originals: source.originals.map(({ text: _text, ...metadata }) => metadata),
    originalBacking: source.originalBacking, observations: source.observations,
    ...(source.behavioralSources?{behavioralSources:source.behavioralSources}:{}),
    provenance: source.provenance, coverage: source.coverage, ...(source.history ? { history: source.history } : {}),
  };
  const serialized = memoryCanonical(value);
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) throw Error('memory-manifest-capacity');
  return serialized;
}

/** Only a live native capture may issue a manifest. This performs a fresh read
 * check; a subsequent write still MUST include manifest statements atomically. */
export async function captureNativeDerivationManifest(env: WorkerEnv, capture: NativeDerivationSourceCapture,deferReplay=false): Promise<NativeDerivationManifest | null> {
  try {
    const db = env.DB, serialized = serialize(nativeDerivationSourceInputs(env, capture));
    const sha256 = await memoryDigest(serialized);
    if (env.DB !== db || !deferReplay&&!await replayNativeDerivationSources(env, capture)) return null;
    nativeDerivationSourceInputs(env, capture);
    const handle = Object.freeze({}) as NativeDerivationManifest;
    manifests.set(handle, { env, db, capture, serialized, sha256 });
    return handle;
  } catch { return null; }
}

function lookup(env: WorkerEnv, handle: NativeDerivationManifest) {
  const state = manifests.get(handle);
  if (!state || state.env !== env || state.db !== env.DB) throw Error('memory-manifest-unavailable');
  nativeDerivationSourceInputs(env, state.capture);
  return state;
}

export function nativeDerivationManifestInputs(env: WorkerEnv, handle: NativeDerivationManifest) {
  const state = lookup(env, handle);
  return { serialized: state.serialized, sha256: state.sha256, manifest: JSON.parse(state.serialized) as NativeDerivationManifestData };
}

/** Exact capture identity, not merely the same job or a caller-supplied hash. */
export function nativeDerivationManifestForCapture(env: WorkerEnv, handle: NativeDerivationManifest, capture: NativeDerivationSourceCapture) {
  if (lookup(env, handle).capture !== capture) throw Error('memory-manifest-capture-mismatch');
  return nativeDerivationManifestInputs(env, handle);
}

export function nativeDerivationManifestGuards(env: WorkerEnv, handle: NativeDerivationManifest) {
  return nativeDerivationSourceGuards(env,lookup(env,handle).capture);
}
export function nativeDerivationManifestStatements(env: WorkerEnv, handle: NativeDerivationManifest) {
  return nativeDerivationSourceStatements(env, lookup(env, handle).capture);
}

/** A stored manifest is comparison data, never authority. Rehydrate through an
 * independently authenticated native read capture, then compare EVERY input.
 * Strict canonical equality rejects added/duplicate keys, omitted uncited
 * sources, changed ancestry, altered observations and extended retention.
 * It also conservatively rejects a shortened source lifetime; no saved result
 * survives a changed manifest by silently renewing or rewriting it. */
export async function revalidateNativeDerivationManifest(env: WorkerEnv, capture: NativeDerivationSourceCapture, serialized: unknown,deferReplay=false): Promise<NativeDerivationManifest | null> {
  if (typeof serialized !== 'string' || serialized.length > maximumBytes
    || new TextEncoder().encode(serialized).byteLength > maximumBytes) return null;
  try {
    // Compare before database replay to bound work on corrupt persisted bytes.
    if (serialize(nativeDerivationSourceInputs(env, capture)) !== serialized) return null;
    return await captureNativeDerivationManifest(env, capture,deferReplay);
  } catch { return null; }
}
