import type { PilotSession } from "./store";

/** Adopt exactly the authenticated request that started while this HTML head was parsed. */
export function consumeSessionPrefetch(): Promise<Response> | null {
  const target = globalThis as typeof globalThis & { __formaInitialSession?: Promise<Response> };
  const pending = target.__formaInitialSession;
  delete target.__formaInitialSession;
  return pending && typeof pending.then === "function" ? pending : null;
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
