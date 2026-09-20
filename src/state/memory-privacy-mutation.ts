/** A UI invalidation barrier, never authorization. Native reads still prove
 * source access. No user/resource identifiers, source text, or drafts leave
 * this module. Cross-tab messages contain only ephemeral operation tokens. */
let pending = 0;
export function memoryPrivacyMutationActive(): boolean { return pending > 0 || peers.active(); }
function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('forma-memory-privacy-mutation'));
}

type Notice = { version: 1; operation: string; phase: 'begin' | 'end' };
/** Peer notices invalidate presentation, not native authority. The receiver
 * owns a finite monotonic lease so a closed/crashed tab cannot strand every
 * inspector. Releasing that barrier triggers fresh reads, never revives bytes.
 * Bounded maps and identifier-only messages keep synchronization source-free. */
export function createMemoryPrivacyPeers(ports: {
  notify: () => void; now: () => number; schedule: (callback: () => void, ms: number) => unknown;
  cancel: (timer: unknown) => void;
}) {
  const operations = new Map<string, number>();
  let timer: unknown, overflow = 0, last = ports.now();
  const active = () => operations.size > 0 || overflow > 0;
  const arm = () => {
    if (timer !== undefined) ports.cancel(timer);
    timer = undefined;
    if (active()) timer = ports.schedule(expire, Math.max(1, Math.min(...operations.values(), ...(overflow ? [overflow] : [])) - ports.now()));
  };
  const expire = () => {
    timer = undefined;
    const at = ports.now(), before = active();
    // A broken clock cannot revive presentation from an earlier lease. Retire
    // all cached views again; consumers independently reject clock anomalies.
    if (!Number.isFinite(at) || at < last) { operations.clear(); overflow = 0; }
    else { for (const [id, deadline] of operations) if (deadline <= at) operations.delete(id); if (overflow <= at) overflow = 0; }
    last = at;
    if (before !== active()) ports.notify();
    arm();
  };
  return {
    active,
    receive(raw: unknown) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      // BroadcastChannel supplies structured-cloned data, but this port is also
      // tested directly; do not evaluate accessors or arbitrary toJSON methods.
      const descriptors = Object.getOwnPropertyDescriptors(raw);
      if (Reflect.ownKeys(raw).length !== 3 || !['version','operation','phase'].every(key => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key]!, 'value'))) return;
      const version = descriptors.version!.value, operation = descriptors.operation!.value, phase = descriptors.phase!.value;
      if (version !== 1 || typeof operation !== 'string' || !/^[a-f0-9-]{36}$/u.test(operation) || !['begin','end'].includes(phase)) return;
      const at = ports.now(); if (!Number.isFinite(at)) return;
      if (phase === 'begin') {
        if (operations.has(operation)) return; // Replay cannot renew an old lease.
        if (operations.size >= 64) overflow = at + 120000;
        else operations.set(operation, at + 120000);
        ports.notify();
      } else if (operations.delete(operation)) ports.notify();
      last = at; arm();
    },
    dispose() { if (timer !== undefined) ports.cancel(timer); timer = undefined; const before = active(); operations.clear(); overflow = 0; if (before) ports.notify(); },
  };
}

const peers = createMemoryPrivacyPeers({ notify, now: () => performance.now(),
  schedule: (callback, ms) => setTimeout(callback, ms), cancel: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) });
let channel: BroadcastChannel | undefined;
try {
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('forma-memory-privacy-v1');
    channel.onmessage = event => peers.receive(event.data);
  }
} catch { /* Native validation and same-tab invalidation remain mandatory. */ }
function broadcast(notice: Notice) { try { channel?.postMessage(notice); } catch { /* No source data or authority depends on this delivery. */ } }
export function beginMemoryPrivacyMutation(): () => void {
  const operation = crypto.randomUUID();
  pending++;
  notify();
  broadcast({ version: 1, operation, phase: 'begin' });
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pending--;
    broadcast({ version: 1, operation, phase: 'end' });
    if (!pending) notify();
  };
}
