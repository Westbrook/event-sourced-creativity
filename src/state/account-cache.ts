import type { CreativeEvent } from "../model/events";

export type AccountSnapshotProfile = "full" | "projects" | "workspace";

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
  schemaVersion: 1;
};

const DATABASE = "forma-account-snapshots-v1";
const STORE = "snapshots";
const MAX_AGE_MS = 15 * 60_000;
const MAX_RECORDS = 6;

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("indexeddb_unavailable")); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function snapshotKey(identity: AccountSnapshotIdentity) {
  return `${identity.userId}:${identity.policyVersion}:v1`;
}

export async function readAccountSnapshots(): Promise<AccountSnapshot[]> {
  try {
    const connection = await database();
    return await new Promise<AccountSnapshot[]>((resolve, reject) => {
      const transaction = connection.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as AccountSnapshot[]).filter((snapshot) => snapshot.schemaVersion === 1 && Date.now() - snapshot.savedAt <= MAX_AGE_MS));
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
  return snapshots.find((snapshot) =>
    snapshot.key === snapshotKey(identity) &&
    snapshot.userId === identity.userId &&
    snapshot.policyVersion === identity.policyVersion &&
    (snapshot.profile === "full" || snapshot.profile === requestedProfile || snapshot.profile === "workspace" && requestedProfile === "projects") &&
    snapshot.events.length > 0,
  ) ?? null;
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
      const snapshot: AccountSnapshot = { key: snapshotKey(identity), userId: identity.userId, policyVersion: identity.policyVersion, profile, head, events, savedAt: Date.now(), schemaVersion: 1 };
      const existing = store.get(snapshot.key);
      existing.onsuccess = () => {
        const previous = existing.result as AccountSnapshot | undefined;
        const rank = (value: AccountSnapshotProfile) => value === "full" ? 2 : value === "workspace" ? 1 : 0;
        if (!previous || rank(profile) >= rank(previous.profile)) store.put(snapshot);
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
