/** Presentation only. Source drift withdraws paid controls without destroying
 * the original's passive recovery. Losing base custody retires this instance. */
export class ExperienceHostSourceLifetime {
  #retired = false;
  observe(baseCurrent: boolean, exactSourceCurrent: boolean) {
    if (!baseCurrent) this.#retired = true;
    return Object.freeze({ retired: this.#retired, readable: !this.#retired, paidSourceCurrent: !this.#retired && exactSourceCurrent });
  }
  retire() { this.#retired = true; }
}
