import type { CreativeEvent } from "../model/events";
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

const DATABASE = "forma-account-snapshots-v1";
const STORE = "snapshots";
const SNAPSHOT_SCHEMA_VERSION = 2;
const MAX_AGE_MS = 15 * 60_000;
const MAX_RECORDS = 6;

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

function snapshotKey(identity: AccountSnapshotIdentity) {
  return `${identity.userId}:${identity.policyVersion}:v2`;
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
