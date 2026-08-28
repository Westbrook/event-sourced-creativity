import type { CreativeEvent } from "../model/events";
import type { AnalyticsReport } from "../model/analytics";
import { eventMatchesProfile, eventProfileRank, type EventProfile } from "../model/event-profiles.ts";

export type AccountSnapshotProfile = EventProfile;

export type AccountSnapshotIdentity = {
  userId: string;
  policyVersion: string;
  accepted: boolean;
  impersonating: boolean;
  principalUserId?:string;
  audience?:string;
  organizationId?:string|null;
  projectAccessId?:string|null;
  permissionEpoch?:string;
  accessExpiresAt?:string|null;
};

export type AccountSnapshot = {
  key: string;
  userId: string;
  principalUserId:string;
  audience:string;
  organizationId:string;
  projectAccessId:string;
  permissionEpoch:string;
  policyVersion: string;
  profile: AccountSnapshotProfile;
  head: number;
  events: CreativeEvent[];
  savedAt: number;
  schemaVersion: 3;
};

export type AnalyticsSnapshotIdentity = AccountSnapshotIdentity & { role: string };
export type AnalyticsSnapshot = {
  key: string;
  userId: string;
  policyVersion: string;
  permissionEpoch?: string;
  role: "admin";
  url: string;
  report: AnalyticsReport;
  savedAt: number;
  schemaVersion: 1;
};

const DATABASE = "forma-account-snapshots-v1";
const STORE = "snapshots";
const SNAPSHOT_SCHEMA_VERSION = 3;
const MAX_AGE_MS = 15 * 60_000;
const MAX_RECORDS = 6;
const ANALYTICS_MAX_AGE_MS = 60_000;
const ANALYTICS_DATABASE = "forma-admin-analytics-v1";
const ANALYTICS_STORE = "reports";

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("indexeddb_unavailable")); return; }
    let settled = false;
    const request = indexedDB.open(DATABASE, SNAPSHOT_SCHEMA_VERSION);
    const release = () => {
      request.onsuccess = request.onerror = request.onblocked = request.onupgradeneeded = null;
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      request.onblocked = null;
      reject(error);
    };
    // A blocked open cannot be canceled by IndexedDB. Stop waiting for this
    // optional cache, and close/abort its late result without starting a write.
    const timeout = setTimeout(() => fail(new Error("indexeddb_open_timeout")), 1_000);
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return; }
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
      else request.transaction?.objectStore(STORE).clear();
    };
    request.onsuccess = () => {
      const connection = request.result;
      release();
      if (settled) { connection.close(); return; }
      settled = true;
      clearTimeout(timeout);
      connection.onversionchange = () => connection.close();
      resolve(connection);
    };
    request.onerror = () => { fail(request.error); release(); };
    request.onblocked = () => fail(new Error("indexeddb_open_blocked"));
  });
}


function analyticsDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("indexeddb_unavailable")); return; }
    const request = indexedDB.open(ANALYTICS_DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(ANALYTICS_STORE)) request.result.createObjectStore(ANALYTICS_STORE, { keyPath: "key" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function snapshotKey(identity: AccountSnapshotIdentity) {
  const parts=[identity.principalUserId??identity.userId,identity.userId,identity.audience??"creative",identity.organizationId??"personal",identity.projectAccessId??"personal",identity.permissionEpoch??"legacy",identity.policyVersion];
  return`${parts.map((part)=>encodeURIComponent(part)).join(":")}:v3`;
}

function analyticsSnapshotKey(identity: AnalyticsSnapshotIdentity, url: string) {
  return `${identity.userId}:${identity.policyVersion}:analytics:${encodeURIComponent(url)}:v1${identity.permissionEpoch?`:${encodeURIComponent(identity.permissionEpoch)}`:""}`;
}

export function matchingAnalyticsSnapshot(candidate: unknown, identity: AnalyticsSnapshotIdentity, url: string, now = Date.now()) {
  if (identity.role !== "admin" || identity.impersonating || !identity.accepted || !candidate || typeof candidate !== "object") return null;
  const snapshot = candidate as Partial<AnalyticsSnapshot>;
  if (snapshot.schemaVersion !== 1 || snapshot.key !== analyticsSnapshotKey(identity, url) || snapshot.userId !== identity.userId || snapshot.policyVersion !== identity.policyVersion || snapshot.role !== "admin" || snapshot.url !== url || identity.permissionEpoch&&snapshot.permissionEpoch!==identity.permissionEpoch) return null;
  if (typeof snapshot.savedAt !== "number" || !Number.isFinite(snapshot.savedAt) || snapshot.savedAt > now || now - snapshot.savedAt > ANALYTICS_MAX_AGE_MS) return null;
  if (!snapshot.report || typeof snapshot.report !== "object" || !Number.isFinite(Date.parse(String(snapshot.report.generatedAt ?? ""))) || !snapshot.report.source || !snapshot.report.totals) return null;
  return snapshot as AnalyticsSnapshot;
}

export async function readAnalyticsSnapshot(identity: AnalyticsSnapshotIdentity, url: string): Promise<AnalyticsSnapshot | null> {
  if (identity.role !== "admin" || identity.impersonating || !identity.accepted) return null;
  try {
    const connection = await analyticsDatabase();
    return await new Promise<AnalyticsSnapshot | null>((resolve, reject) => {
      const transaction = connection.transaction(ANALYTICS_STORE, "readonly");
      const request = transaction.objectStore(ANALYTICS_STORE).get(analyticsSnapshotKey(identity, url));
      request.onsuccess = () => resolve(matchingAnalyticsSnapshot(request.result, identity, url));
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => connection.close();
    });
  } catch { return null; }
}

export async function writeAnalyticsSnapshot(identity: AnalyticsSnapshotIdentity, url: string, report: AnalyticsReport) {
  if (identity.role !== "admin" || identity.impersonating || !identity.accepted) return;
  try {
    const connection = await analyticsDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = connection.transaction(ANALYTICS_STORE, "readwrite");
      const snapshot: AnalyticsSnapshot = { key: analyticsSnapshotKey(identity, url), userId: identity.userId, policyVersion: identity.policyVersion, ...(identity.permissionEpoch?{permissionEpoch:identity.permissionEpoch}:{}), role: "admin", url, report, savedAt: Date.now(), schemaVersion: 1 };
      const store = transaction.objectStore(ANALYTICS_STORE);store.put(snapshot);const records=store.getAll();records.onsuccess=()=>{for(const previous of (records.result as AnalyticsSnapshot[]).sort((left,right)=>right.savedAt-left.savedAt).slice(MAX_RECORDS))store.delete(previous.key);};
      transaction.oncomplete = () => { connection.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch { /* Device-local acceleration is never authoritative or required. */ }
}

export async function clearAnalyticsSnapshots(identity: AccountSnapshotIdentity, all = false) {
  try {
    const connection = await analyticsDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = connection.transaction(ANALYTICS_STORE, "readwrite");
      const store = transaction.objectStore(ANALYTICS_STORE);
      const request = all ? store.clear() : store.getAllKeys();
      request.onsuccess = () => {if(!all)(request.result as IDBValidKey[]).filter((key) => typeof key === "string" && key.startsWith(`${identity.userId}:${identity.policyVersion}:analytics:`)).forEach((key) => store.delete(key));};
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { connection.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch { /* A blocked local cache cannot weaken server-owned forgetting. */ }
}


declare const accountSnapshotFenceBrand: unique symbol;
/** In-page ownership only. Never serialize this token or treat it as permission. */
export type AccountSnapshotFence = Readonly<{ [accountSnapshotFenceBrand]: true }>;
export type AccountSnapshotGuard = {
  fence: AccountSnapshotFence;
  /** Reads: owned logical read. Writes: current, completed source covering the written profile. */
  current: () => boolean;
};
export type AccountSnapshotClearResult = { status: "cleared" | "unavailable" | "superseded" };

type SnapshotPrincipal = { generation: object; retired: boolean; barrier: number; tail: Promise<void> };
type SnapshotScope = {
  key: string;
  principal: SnapshotPrincipal;
  generation: object;
  retired: boolean;
  needsGuard: boolean;
  barrier: number;
  revision: object;
  newestWrite: number;
  coveredWrites: number[];
  tail: Promise<void>;
};
type SnapshotFenceRecord = {
  scope: SnapshotScope;
  generation: object;
  principalGeneration: object;
  order: number;
  profile: AccountSnapshotProfile;
};
type SnapshotReadRecord = { fence: SnapshotFenceRecord; revision: object };
type SnapshotPageState = {
  order: number;
  principals: Map<string, SnapshotPrincipal>;
  scopes: Map<string, SnapshotScope>;
  fences: WeakMap<AccountSnapshotFence, SnapshotFenceRecord>;
  reads: WeakMap<AccountSnapshot, SnapshotReadRecord>;
};

// A same-page module copy must observe the same retirement. This contains no
// event bodies, is not persisted, and deliberately does not claim cross-tab custody.
const SNAPSHOT_PAGE_STATE = Symbol.for("forma.account-snapshot-fences.v1");
const snapshotPage = globalThis as typeof globalThis & { [SNAPSHOT_PAGE_STATE]?: SnapshotPageState };
const snapshotState = snapshotPage[SNAPSHOT_PAGE_STATE] ??= {
  order: 0, principals: new Map(), scopes: new Map(), fences: new WeakMap(), reads: new WeakMap(),
};

function snapshotPrincipal(identity: AccountSnapshotIdentity) {
  const key = JSON.stringify([identity.principalUserId ?? identity.userId, identity.userId]);
  let principal = snapshotState.principals.get(key);
  if (!principal) {
    principal = { generation: {}, retired: false, barrier: 0, tail: Promise.resolve() };
    snapshotState.principals.set(key, principal);
  }
  return principal;
}

function snapshotScope(identity: AccountSnapshotIdentity) {
  const key = snapshotKey(identity);
  let scope = snapshotState.scopes.get(key);
  if (!scope) {
    const principal = snapshotPrincipal(identity);
    scope = { key, principal, generation: {}, retired: principal.retired, needsGuard: principal.retired,
      barrier: principal.barrier, revision: {}, newestWrite: 0,
      coveredWrites: Array.from({ length: eventProfileRank("full") + 1 }, () => 0), tail: Promise.resolve() };
    snapshotState.scopes.set(key, scope);
  }
  return scope;
}

function snapshotIdentityCurrent(identity: AccountSnapshotIdentity) {
  const expiry = identity.accessExpiresAt ? Date.parse(identity.accessExpiresAt) : null;
  return identity.accepted && !identity.impersonating &&
    (expiry === null || Number.isFinite(expiry) && expiry > Date.now());
}

function snapshotFenceOwned(record: SnapshotFenceRecord | undefined) {
  return Boolean(record && record.generation === record.scope.generation &&
    record.principalGeneration === record.scope.principal.generation);
}

export function captureAccountSnapshotFence(
  identity: AccountSnapshotIdentity,
  profile: AccountSnapshotProfile,
): AccountSnapshotFence {
  if (eventProfileRank(profile) < 0) throw new Error("account_snapshot_profile_invalid");
  const scope = snapshotScope(identity);
  const fence = Object.freeze({}) as AccountSnapshotFence;
  snapshotState.fences.set(fence, { scope, generation: scope.generation,
    principalGeneration: scope.principal.generation, order: ++snapshotState.order, profile });
  return fence;
}

/** A new post-retirement source read may be owned while its device cache is still unusable. */
export function accountSnapshotFenceCurrent(identity: AccountSnapshotIdentity, fence: AccountSnapshotFence) {
  const record = snapshotState.fences.get(fence);
  return Boolean(record && record.scope.key === snapshotKey(identity) && snapshotFenceOwned(record));
}

function snapshotGuardCurrent(identity: AccountSnapshotIdentity, guard: AccountSnapshotGuard, profile?: AccountSnapshotProfile) {
  const record = snapshotState.fences.get(guard.fence);
  try {
    return Boolean(record && record.scope.key === snapshotKey(identity) && snapshotFenceOwned(record) &&
      snapshotIdentityCurrent(identity) && record.order >= record.scope.newestWrite &&
      (profile === undefined || eventProfileRank(record.profile) >= eventProfileRank(profile)) && guard.current());
  } catch { return false; }
}

function snapshotSequence<T>(scope: SnapshotScope, operation: () => Promise<T>): Promise<T> {
  // Reserve at invocation, before opening IndexedDB. Only this key and an
  // explicit principal-wide privacy clear can precede this operation.
  const result = Promise.all([scope.tail, scope.principal.tail]).then(operation);
  scope.tail = result.then(() => undefined, () => undefined);
  return result;
}

function retireSnapshotScope(scope: SnapshotScope, order: number) {
  scope.generation = {};
  scope.retired = true;
  scope.needsGuard = true;
  scope.barrier = order;
  scope.revision = {};
  scope.newestWrite = 0;
  scope.coveredWrites.fill(0);
}

function snapshotRowFresh(snapshot: AccountSnapshot, now = Date.now()) {
  return snapshot.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
    Number.isFinite(snapshot.savedAt) && snapshot.savedAt <= now && now - snapshot.savedAt <= MAX_AGE_MS;
}

function snapshotTransaction<T>(
  connection: IDBDatabase,
  mode: IDBTransactionMode,
  fallback: () => T,
  completed: () => T,
  prepare: (store: IDBObjectStore, abort: () => void) => void,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let transaction: IDBTransaction | undefined;
    let settled = false, aborting = false;
    const finish = (value: () => T) => {
      if (settled) return;
      settled = true;
      if (transaction) transaction.oncomplete = transaction.onabort = transaction.onerror = null;
      connection.onversionchange = null;
      try { connection.close(); } catch { /* Optional device storage. */ }
      try { resolve(value()); } catch { resolve(fallback()); }
    };
    const abort = () => {
      if (settled || aborting) return;
      aborting = true;
      try { transaction?.abort(); } catch { finish(fallback); }
    };
    try {
      transaction = connection.transaction(STORE, mode);
      transaction.oncomplete = () => finish(aborting ? fallback : completed);
      transaction.onabort = () => finish(fallback);
      transaction.onerror = abort;
      prepare(transaction.objectStore(STORE), abort);
    } catch {
      if (transaction) abort();
      else finish(fallback);
    }
  });
}

export async function readAccountSnapshots(
  identity?: AccountSnapshotIdentity,
  controls?: AccountSnapshotGuard,
): Promise<AccountSnapshot[]> {
  const readOrder = ++snapshotState.order;
  if (!identity && controls) return [];
  const guard = identity ? controls ?? { fence: captureAccountSnapshotFence(identity, "full"), current: () => true } : undefined;
  const record = guard ? snapshotState.fences.get(guard.fence) : undefined;
  const current = () => !identity || Boolean(record && !record.scope.retired &&
    (!record.scope.needsGuard || controls) && snapshotGuardCurrent(identity, guard!));
  if (!current()) return [];
  const read = async () => {
    if (!current()) return [];
    try {
      const connection = await database();
      if (!current()) { connection.close(); return []; }
      let rows: AccountSnapshot[] = [];
      const capturedRevision = record?.scope.revision;
      const filtered = () => {
        if (!current()) return [];
        return rows.filter((snapshot) => {
          if (!snapshotRowFresh(snapshot)) return false;
          const row = snapshotState.reads.get(snapshot);
          return Boolean(row && snapshotFenceOwned(row.fence) && !row.fence.scope.retired &&
            row.revision === row.fence.scope.revision && row.fence.order >= row.fence.scope.newestWrite &&
            (controls || !row.fence.scope.needsGuard));
        });
      };
      return await snapshotTransaction(connection, "readonly", () => [], filtered, (store, abort) => {
        if (!current()) { abort(); return; }
        const request = identity ? store.get(snapshotKey(identity)) : store.getAll();
        request.onerror = abort;
        request.onsuccess = () => {
          if (!current()) { abort(); return; }
          rows = (identity ? request.result ? [request.result] : [] : request.result) as AccountSnapshot[];
          rows = rows.filter((snapshot) => snapshot && snapshotRowFresh(snapshot));
          for (const snapshot of rows) {
            if (record) {
              snapshotState.reads.set(snapshot, { fence: record, revision: capturedRevision! });
              continue;
            }
            const scope = snapshotScope({ ...snapshot, accepted: true, impersonating: false });
            // An unscoped legacy scan is never allowed to turn a later
            // retirement/recovery into ownership of its earlier result.
            if (scope.retired || scope.needsGuard || scope.barrier > readOrder || scope.principal.barrier > readOrder) continue;
            snapshotState.reads.set(snapshot, { fence: { scope, generation: scope.generation,
              principalGeneration: scope.principal.generation, order: readOrder, profile: "full" }, revision: scope.revision });
          }
        };
      });
    } catch { return []; }
  };
  return record ? snapshotSequence(record.scope, read) : read();
}

function clearExactAccountSnapshot(identity: AccountSnapshotIdentity, fence: AccountSnapshotFence): Promise<AccountSnapshotClearResult> {
  const record = snapshotState.fences.get(fence);
  if (!record || record.scope.key !== snapshotKey(identity) || !snapshotFenceOwned(record) ||
    record.scope.coveredWrites[eventProfileRank(record.profile)] > record.order) return Promise.resolve({ status: "superseded" });
  const scope = record.scope;
  // This barrier is synchronous, before sequencing or opening IndexedDB.
  retireSnapshotScope(scope, ++snapshotState.order);
  const generation = scope.generation, principalGeneration = scope.principal.generation;
  const owned = () => scope.generation === generation && scope.principal.generation === principalGeneration && scope.retired;
  const unavailable = (): AccountSnapshotClearResult => ({ status: owned() ? "unavailable" : "superseded" });
  return snapshotSequence(scope, async () => {
    if (!owned()) return { status: "superseded" };
    try {
      const connection = await database();
      if (!owned()) { connection.close(); return { status: "superseded" }; }
      return await snapshotTransaction(connection, "readwrite", unavailable,
        () => ({ status: owned() ? "cleared" : "superseded" }), (store, abort) => {
          if (!owned()) { abort(); return; }
          const request = store.get(scope.key);
          request.onerror = abort;
          request.onsuccess = () => {
            if (!owned()) { abort(); return; }
            const deletion = store.delete(scope.key);
            deletion.onerror = abort;
            deletion.onsuccess = () => { if (!owned()) abort(); };
          };
        });
    } catch { return unavailable(); }
  });
}

function clearPrincipalAccountSnapshots(identity: AccountSnapshotIdentity): Promise<void> {
  const principal = snapshotPrincipal(identity);
  const affected = [...snapshotState.scopes.values()].filter((scope) => scope.principal === principal);
  const previous = [principal.tail, ...affected.map((scope) => scope.tail)];
  principal.generation = {};
  principal.retired = true;
  principal.barrier = ++snapshotState.order;
  const generation = principal.generation;
  for (const scope of affected) retireSnapshotScope(scope, principal.barrier);
  // Only the existing explicit principal-wide privacy action uses this wider
  // barrier. Source denial always uses the exact-key branch below.
  const result = Promise.all(previous).then(async () => {
    const owned = () => principal.generation === generation;
    if (!owned()) return;
    try {
      const connection = await database();
      if (!owned()) { connection.close(); return; }
      await snapshotTransaction(connection, "readwrite", () => undefined, () => undefined, (store, abort) => {
        if (!owned()) { abort(); return; }
        const records = store.getAll();
        records.onerror = abort;
        records.onsuccess = () => {
          if (!owned()) { abort(); return; }
          for (const snapshot of records.result as AccountSnapshot[]) {
            if (!owned()) { abort(); return; }
            if (snapshot.userId === identity.userId && snapshot.principalUserId === (identity.principalUserId ?? identity.userId)) {
              const deletion = store.delete(snapshot.key);
              deletion.onerror = abort;
              deletion.onsuccess = () => { if (!owned()) abort(); };
            }
          }
        };
      });
    } catch { /* Server-owned privacy remains authoritative when device storage is unavailable. */ }
  });
  principal.tail = result.then(() => undefined, () => undefined);
  return result;
}

/** Default: the current principal's device copies. Source mode: only its exact existing key. */
export function clearAccountSnapshots(identity: AccountSnapshotIdentity): Promise<void>;
export function clearAccountSnapshots(
  identity: AccountSnapshotIdentity,
  options: { scope: "source"; fence: AccountSnapshotFence },
): Promise<AccountSnapshotClearResult>;
export function clearAccountSnapshots(
  identity: AccountSnapshotIdentity,
  options?: { scope: "source"; fence: AccountSnapshotFence },
): Promise<void | AccountSnapshotClearResult> {
  if (options !== undefined) return options?.scope === "source"
    ? clearExactAccountSnapshot(identity, options.fence) : Promise.resolve({ status: "superseded" });
  return clearPrincipalAccountSnapshots(identity);
}

export function matchingAccountSnapshot(
  snapshots: AccountSnapshot[],
  identity: AccountSnapshotIdentity,
  requestedProfile: AccountSnapshotProfile,
  controls?: AccountSnapshotGuard,
) {
  const scope = snapshotScope(identity);
  if (!snapshotIdentityCurrent(identity) || scope.retired || scope.needsGuard && !controls ||
    controls && !snapshotGuardCurrent(identity, controls, requestedProfile)) return null;
  const snapshot = snapshots.find((candidate) =>
    candidate.key === snapshotKey(identity) &&
    snapshotRowFresh(candidate) &&
    candidate.userId === identity.userId &&
    candidate.principalUserId === (identity.principalUserId ?? identity.userId) &&
    candidate.audience === (identity.audience ?? "creative") &&
    candidate.organizationId === (identity.organizationId ?? "personal") &&
    candidate.projectAccessId === (identity.projectAccessId ?? "personal") &&
    candidate.permissionEpoch === (identity.permissionEpoch ?? "legacy") &&
    candidate.policyVersion === identity.policyVersion &&
    eventProfileRank(candidate.profile) >= eventProfileRank(requestedProfile) &&
    candidate.events.length > 0 &&
    (() => {
      const read = snapshotState.reads.get(candidate);
      return read ? snapshotFenceOwned(read.fence) && read.fence.scope === scope &&
        read.revision === scope.revision && read.fence.order >= scope.newestWrite : !scope.needsGuard;
    })(),
  );
  if (!snapshot) return null;
  if (requestedProfile === "full" && snapshot.profile === "full") return snapshot;
  const result = { ...snapshot, profile: requestedProfile,
    events: snapshot.events.filter((event) => eventMatchesProfile(requestedProfile, event.type, event.payload)) };
  const read = snapshotState.reads.get(snapshot);
  if (read) snapshotState.reads.set(result, read);
  return result;
}

export async function writeAccountSnapshot(
  identity: AccountSnapshotIdentity,
  events: CreativeEvent[],
  head: number,
  profile: AccountSnapshotProfile,
  controls?: AccountSnapshotGuard,
): Promise<boolean> {
  const guard = controls ?? { fence: captureAccountSnapshotFence(identity, profile), current: () => true };
  const record = snapshotState.fences.get(guard.fence);
  if (!record || !events.length || record.scope.needsGuard && !controls ||
    !snapshotGuardCurrent(identity, guard, profile)) return false;
  const scope = record.scope;
  let safeEvents: CreativeEvent[];
  try {
    safeEvents = structuredClone(profile === "full" ? events :
      events.filter((event) => eventMatchesProfile(profile, event.type, event.payload)));
  } catch { return false; }
  if (!snapshotGuardCurrent(identity, guard, profile)) return false;
  // A writer's current() is explicitly a complete source certificate. A mere
  // read or write beginning never clears the retired flag.
  scope.newestWrite = Math.max(scope.newestWrite, record.order);
  for (let rank = 0; rank <= eventProfileRank(profile); rank += 1) {
    scope.coveredWrites[rank] = Math.max(scope.coveredWrites[rank], record.order);
  }
  const current = () => snapshotGuardCurrent(identity, guard, profile);
  return snapshotSequence(scope, async () => {
    if (!current()) return false;
    try {
      const connection = await database();
      if (!current()) { connection.close(); return false; }
      let putCompleted = false;
      const completed = () => {
        if (!current()) {
          if (putCompleted && snapshotFenceOwned(record)) {
            // The native commit may already be complete. Quarantine these
            // unowned device bytes; do not claim rollback or retire live authority.
            scope.retired = true; scope.needsGuard = true; scope.revision = {};
          }
          return false;
        }
        if (putCompleted) {
          scope.retired = false;
          scope.revision = {};
        }
        return putCompleted;
      };
      return await snapshotTransaction(connection, "readwrite", () => false, completed, (store, abort) => {
        if (!current()) { abort(); return; }
        const existing = store.get(scope.key);
        existing.onerror = abort;
        existing.onsuccess = () => {
          if (!current()) { abort(); return; }
          const previous = existing.result as AccountSnapshot | undefined;
          // A narrower recovery must replace denied richer bytes, never make
          // the old richer snapshot usable by skipping the actual put.
          if (scope.retired || !previous || !snapshotRowFresh(previous) ||
            eventProfileRank(profile) >= eventProfileRank(previous.profile)) {
            const snapshot: AccountSnapshot = { key: scope.key, userId: identity.userId,
              principalUserId: identity.principalUserId ?? identity.userId, audience: identity.audience ?? "creative",
              organizationId: identity.organizationId ?? "personal", projectAccessId: identity.projectAccessId ?? "personal",
              permissionEpoch: identity.permissionEpoch ?? "legacy", policyVersion: identity.policyVersion,
              profile, head, events: safeEvents, savedAt: Date.now(), schemaVersion: SNAPSHOT_SCHEMA_VERSION };
            if (!current()) { abort(); return; }
            const put = store.put(snapshot);
            put.onerror = abort;
            put.onsuccess = () => { if (!current()) abort(); else putCompleted = true; };
          }
          if (!current()) { abort(); return; }
          const records = store.getAll();
          records.onerror = abort;
          records.onsuccess = () => {
            if (!current()) { abort(); return; }
            const stale = (records.result as AccountSnapshot[]).sort((left, right) => right.savedAt - left.savedAt).slice(MAX_RECORDS);
            for (const row of stale) {
              if (!current()) { abort(); return; }
              const deletion = store.delete(row.key);
              deletion.onerror = abort;
              deletion.onsuccess = () => { if (!current()) abort(); };
            }
          };
        };
      });
    } catch { return false; }
  });
}
