import type { CreativeEvent } from "../model/events";
import type { AnalyticsReport } from "../model/analytics";
import { eventMatchesProfile, eventProfileRank, type EventProfile } from "../model/event-profiles.ts";

export type AccountSnapshotProfile = EventProfile;

export type AccountSnapshotIdentity = {
  userId: string;
  policyVersion: string;
  accepted: boolean;
  impersonating: boolean;
};

export type AccountSnapshot = {
  key: string;
  userId: string;
  policyVersion: string;
  profile: AccountSnapshotProfile;
  head: number;
  events: CreativeEvent[];
  savedAt: number;
  schemaVersion: 2;
};

export type AnalyticsSnapshotIdentity = AccountSnapshotIdentity & { role: string };
export type AnalyticsSnapshot = {
  key: string;
  userId: string;
  policyVersion: string;
  role: "admin";
  url: string;
  report: AnalyticsReport;
  savedAt: number;
  schemaVersion: 1;
};

const DATABASE = "forma-account-snapshots-v1";
const STORE = "snapshots";
const SNAPSHOT_SCHEMA_VERSION = 2;
const MAX_AGE_MS = 15 * 60_000;
const MAX_RECORDS = 6;
const ANALYTICS_MAX_AGE_MS = 60_000;
const ANALYTICS_DATABASE = "forma-admin-analytics-v1";
const ANALYTICS_STORE = "reports";

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("indexeddb_unavailable")); return; }
    const request = indexedDB.open(DATABASE, SNAPSHOT_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
      else request.transaction?.objectStore(STORE).clear();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
  return `${identity.userId}:${identity.policyVersion}:v2`;
}

function analyticsSnapshotKey(identity: AnalyticsSnapshotIdentity, url: string) {
  return `${identity.userId}:${identity.policyVersion}:analytics:${encodeURIComponent(url)}:v1`;
}

export function matchingAnalyticsSnapshot(candidate: unknown, identity: AnalyticsSnapshotIdentity, url: string, now = Date.now()) {
  if (identity.role !== "admin" || identity.impersonating || !identity.accepted || !candidate || typeof candidate !== "object") return null;
  const snapshot = candidate as Partial<AnalyticsSnapshot>;
  if (snapshot.schemaVersion !== 1 || snapshot.key !== analyticsSnapshotKey(identity, url) || snapshot.userId !== identity.userId || snapshot.policyVersion !== identity.policyVersion || snapshot.role !== "admin" || snapshot.url !== url) return null;
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
      const snapshot: AnalyticsSnapshot = { key: analyticsSnapshotKey(identity, url), userId: identity.userId, policyVersion: identity.policyVersion, role: "admin", url, report, savedAt: Date.now(), schemaVersion: 1 };
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

export async function readAccountSnapshots(): Promise<AccountSnapshot[]> {
  try {
    const connection = await database();
    return await new Promise<AccountSnapshot[]>((resolve, reject) => {
      const transaction = connection.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as AccountSnapshot[]).filter((snapshot) => snapshot.schemaVersion === SNAPSHOT_SCHEMA_VERSION && Date.now() - snapshot.savedAt <= MAX_AGE_MS));
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => connection.close();
    });
  } catch {
    return [];
  }
}

export function matchingAccountSnapshot(
  snapshots: AccountSnapshot[],
  identity: AccountSnapshotIdentity,
  requestedProfile: AccountSnapshotProfile,
) {
  if (identity.impersonating || !identity.accepted) return null;
  const snapshot = snapshots.find((candidate) =>
    candidate.key === snapshotKey(identity) &&
    candidate.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
    candidate.userId === identity.userId &&
    candidate.policyVersion === identity.policyVersion &&
    eventProfileRank(candidate.profile) >= eventProfileRank(requestedProfile) &&
    candidate.events.length > 0,
  );
  if (!snapshot) return null;
  if (requestedProfile === "full" && snapshot.profile === "full") return snapshot;
  return { ...snapshot, profile: requestedProfile, events: snapshot.events.filter((event) => eventMatchesProfile(requestedProfile, event.type, event.payload)) };
}

export async function writeAccountSnapshot(
  identity: AccountSnapshotIdentity,
  events: CreativeEvent[],
  head: number,
  profile: AccountSnapshotProfile,
) {
  if (identity.impersonating || !identity.accepted || !events.length) return;
  try {
    const connection = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = connection.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const safeEvents = profile === "full" ? events : events.filter((event) => eventMatchesProfile(profile, event.type, event.payload));
      const snapshot: AccountSnapshot = { key: snapshotKey(identity), userId: identity.userId, policyVersion: identity.policyVersion, profile, head, events: safeEvents, savedAt: Date.now(), schemaVersion: SNAPSHOT_SCHEMA_VERSION };
      const existing = store.get(snapshot.key);
      existing.onsuccess = () => {
        const previous = existing.result as AccountSnapshot | undefined;
        if (!previous || previous.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || Date.now() - previous.savedAt > MAX_AGE_MS || eventProfileRank(profile) >= eventProfileRank(previous.profile)) store.put(snapshot);
        const records = store.getAll();
        records.onsuccess = () => {
          const stale = (records.result as AccountSnapshot[]).sort((left, right) => right.savedAt - left.savedAt).slice(MAX_RECORDS);
          stale.forEach((record) => store.delete(record.key));
        };
      };
      transaction.oncomplete = () => { connection.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // Private browsing, storage policies, and quotas must never block rendering.
  }
}
