import type { ApplicationId } from "./applications";
import type { FormaCapability } from "./capabilities";
import { consumeSessionPrefetch } from "../state/session-bootstrap";

export type PlatformSession = {
  user: { userId: string; email: string; displayName: string; role: "admin" | "creator" | "agent" | "viewer" };
  audience: ApplicationId;
  capabilities: FormaCapability[];
  availableApplications?: Array<{ id: ApplicationId; href: string }>;
  permissionEpoch: string;
  organizations: Array<{ organizationId: string; name: string; role: string }>;
  canvas?: { access: boolean };
  assistant?: { enabled: true; host: "platform"; phase: "read-only" };
};

const listeners = new Set<() => void>();
let current: PlatformSession | null = null;
type PendingSessionLoad = {
  audience: ApplicationId;
  promise: Promise<PlatformSession>;
  reject(reason: unknown): void;
};
let pending: PendingSessionLoad | null = null;

function retirePending() {
  const retired = pending;
  pending = null;
  if (!retired) return;
  const error = new Error("The workspace session changed before this request finished.");
  error.name = "PlatformSessionRequestRetiredError";
  retired.reject(error);
}

function verifiedBootstrap(audience: ApplicationId): PlatformSession | null {
  const element = document.querySelector<HTMLScriptElement>('script#forma-session-bootstrap[type="application/json"]');
  if (!element) return null;
  try {
    const value = JSON.parse(element.textContent ?? "") as Partial<PlatformSession>;
    if (!value.user?.userId || value.audience !== audience || !Array.isArray(value.capabilities)) return null;
    element.remove();
    return value as PlatformSession;
  } catch {
    return null;
  }
}

export const platformSession = {
  get() { return current; },
  subscribe(callback: () => void) { listeners.add(callback); return () => listeners.delete(callback); },
  async load(audience: ApplicationId) {
    // Returning an older cached audience also retires a different pending load.
    if (pending && pending.audience !== audience) retirePending();
    if (current?.audience === audience) return current;
    if (pending) return pending.promise;

    let resolve!: (session: PlatformSession) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<PlatformSession>((done, failed) => { resolve = done; reject = failed; });
    const request: PendingSessionLoad = { audience, promise, reject };
    pending = request;

    const read = async () => {
      const bootstrap = verifiedBootstrap(audience);
      if (bootstrap) return bootstrap;
      const prefetched = consumeSessionPrefetch();
      const prefetchedResponse = prefetched ? await prefetched : null;
      if (pending !== request) return null;
      const response = prefetchedResponse ?? await fetch(`/api/session?audience=${encodeURIComponent(audience)}`, { credentials: "same-origin" });
      if (pending !== request) return null;
      const body = await response.json() as PlatformSession & { error?: string };
      if (pending !== request) return null;
      if (!response.ok || body.audience !== audience) throw new Error(body.error ?? "This workspace is not available to your account.");
      return body;
    };

    // Retired callers settle immediately; late transport/body work is still
    // observed here, but cannot publish or clear a newer audience's request.
    void (async () => {
      try {
        const session = await read();
        if (pending !== request || !session) return;
        current = session;
        listeners.forEach((callback) => callback());
        if (pending === request) resolve(session);
      } catch (error) {
        if (pending === request) reject(error);
      } finally {
        if (pending === request) pending = null;
      }
    })();
    return promise;
  },
  reset() {
    current = null;
    retirePending();
    // A reset must not later adopt the preceding HTML's unconsumed session.
    document.querySelector('script#forma-session-bootstrap[type="application/json"]')?.remove();
    void Promise.resolve(consumeSessionPrefetch()).catch(() => {});
    listeners.forEach((callback) => callback());
  },
};
