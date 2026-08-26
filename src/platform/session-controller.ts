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
let pending: Promise<PlatformSession> | null = null;

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
    if (current?.audience === audience) return current;
    if (pending) return pending;
    pending = (async () => {
      const bootstrap = verifiedBootstrap(audience);
      if (bootstrap) return bootstrap;
      const prefetched=consumeSessionPrefetch();
      const response=(prefetched?await prefetched:null)??await fetch(`/api/session?audience=${encodeURIComponent(audience)}`, { credentials: "same-origin" });
      const body = await response.json() as PlatformSession & { error?: string };
      if (!response.ok || body.audience !== audience) throw new Error(body.error ?? "This workspace is not available to your account.");
      return body;
    })();
    try {
      current = await pending;
      listeners.forEach((callback) => callback());
      return current;
    } finally {
      pending = null;
    }
  },
  reset() { current = null; listeners.forEach((callback) => callback()); },
};
