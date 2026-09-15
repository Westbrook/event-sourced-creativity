/** Optional attention stays local during a mini-app's source-sensitive lifetime.
 * No queue or release-time flush: an episode crossing either boundary may never
 * be replayed later. This is scheduling, not source or authorization authority. */
export class AttentionPublicationGate {
  #epoch = 0;
  #leases = new Set<object>();
  #pending = new Set<Promise<unknown>>();

  ticket(): number | null { return this.#leases.size ? null : this.#epoch; }
  current(ticket: number | null) { return ticket !== null && ticket === this.#epoch && !this.#leases.size; }
  hold() {
    const lease = {}; this.#leases.add(lease); this.#epoch++;
    return () => { if (this.#leases.delete(lease)) this.#epoch++; };
  }
  async publish<T>(ticket: number | null, work: () => Promise<T>): Promise<T | undefined> {
    if (!this.current(ticket)) return;
    // Start synchronously so a subsequently acquired lease sees this request.
    const pending = work(); this.#pending.add(pending);
    try { return await pending; } finally { this.#pending.delete(pending); }
  }
  async settled() { await Promise.all([...this.#pending]); }
}
