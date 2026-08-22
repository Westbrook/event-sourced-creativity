import type { PilotSession } from "./store";

type RoutePrefetch = { path: string; url: string; pending: Promise<Response | null> };

/** Adopt exactly the authenticated request that started while this HTML head was parsed. */
export function consumeSessionPrefetch(): Promise<Response> | null {
  const target = globalThis as typeof globalThis & { __formaInitialSession?: Promise<Response> };
  const pending = target.__formaInitialSession;
  delete target.__formaInitialSession;
  return pending && typeof pending.then === "function" ? pending : null;
}

/** A page-specific server request is reusable once, and only for its exact active route and URL. */
export function consumeRoutePrefetch(url: string, options: { impersonating?: boolean } = {}): Promise<Response | null> | null {
  const target = globalThis as typeof globalThis & { __formaInitialRouteData?: RoutePrefetch };
  const pending = target.__formaInitialRouteData;
  if (!pending) return null;
  delete target.__formaInitialRouteData;
  if (options.impersonating || pending.url !== url || pending.path !== (location.pathname.replace(/\/+$/, "") || "/")) return null;
  if (!pending.pending || typeof pending.pending.then !== "function") return null;
  return pending.pending.then((response) => {
    if (!response) return null;
    const adopted = Math.round(performance.now() * 10) / 10;
    const started = Number(document.documentElement.dataset.formaRoutePrefetchStartedMs);
    document.documentElement.dataset.formaRouteDataSource = "prefetch";
    document.documentElement.dataset.formaRoutePrefetchPath = url;
    document.documentElement.dataset.formaRoutePrefetchAdoptedMs = String(adopted);
    if (Number.isFinite(started) && started > 0 && started <= adopted) document.documentElement.dataset.formaRoutePrefetchHeadStartMs = String(Math.round((adopted - started) * 10) / 10);
    return response;
  }).catch(() => null);
}

/** Consume the session verified for this exact private HTML response, never a previous visit. */
export function consumeSessionBootstrap(): PilotSession | null {
  const node = document.querySelector<HTMLScriptElement>('script#forma-session-bootstrap[type="application/json"]');
  if (!node) return null;

  const source = node.textContent ?? "";
  const serverMs = Number(node.dataset.serverMs);
  node.remove();

  try {
    const value = JSON.parse(source) as Partial<PilotSession>;
    if (!value.user?.userId || typeof value.user.userId !== "string") return null;
    if (!value.policy?.version || typeof value.policy.accepted !== "boolean") return null;
    if (!value.provider || typeof value.provider.configured !== "boolean") return null;
    if (!value.budgets?.user || !value.budgets.workspace) return null;
    if (Number.isFinite(serverMs) && serverMs >= 0) document.documentElement.dataset.formaSessionServerMs = String(serverMs);
    return value as PilotSession;
  } catch {
    return null;
  }
}
