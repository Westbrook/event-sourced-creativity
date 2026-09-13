/** Bounded presentation lifetime for existing passive native readers. A timeout
 * withdraws this host only; it never cancels billing or allocates another job. */
export class ExperienceHostOperation {
  #active = true;
  #timer: ReturnType<typeof setTimeout>;
  #reject: (reason: Error) => void = () => {};
  #stopped: Promise<never>;
  constructor(onTimeout: () => void, timeoutMs = 30000) {
    this.#stopped = new Promise<never>((_, reject) => { this.#reject = reject; });
    void this.#stopped.catch(() => {});
    const bounded = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000 ? timeoutMs : 30000;
    this.#timer = setTimeout(() => {
      if (!this.#active) return;
      this.#active = false; this.#reject(new Error("operation_unconfirmed")); onTimeout();
    }, bounded);
  }
  current() { return this.#active; }
  wait<T>(work: Promise<T>): Promise<T> {
    if (this.#active) return Promise.race([work, this.#stopped]);
    void work.catch(() => {});
    return Promise.reject(new Error("operation_withdrawn"));
  }
  finish() { if (this.#active) { this.#active = false; clearTimeout(this.#timer); } }
  cancel() { if (this.#active) { this.finish(); this.#reject(new Error("operation_withdrawn")); } }
}
