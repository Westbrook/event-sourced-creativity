import { experienceHostTimeout, type ExperienceForegroundOperation } from "./output-transport-lifetime.ts";

/** Bounded presentation lifetime for native readers and explicit foreground jobs. A timeout
 * withdraws this host only; it never cancels billing or allocates another job. */
export class ExperienceHostOperation {
  #active = true;
  #timer: ReturnType<typeof setTimeout>;
  #reject: (reason: Error) => void = () => {};
  #stopped: Promise<never>;
  constructor(onTimeout: () => void, timeoutMs?: number, foreground?: ExperienceForegroundOperation) {
    this.#stopped = new Promise<never>((_, reject) => { this.#reject = reject; });
    void this.#stopped.catch(() => {});
    const maximum = experienceHostTimeout(foreground);
    const bounded = Number.isSafeInteger(timeoutMs) && Number(timeoutMs) > 0 && Number(timeoutMs) <= 30000 ? Number(timeoutMs) : maximum;
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
