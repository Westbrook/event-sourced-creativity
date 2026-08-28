/**
 * A transient UI-intent guard, not provider or billing authority.
 * No DOM, browser globals, timers, store, or network dependencies are imported.
 * Hosts pass genuine native events and current navigator.userActivation state.
 */
type OutputPaidDecisionScope = {
  authorizationScopeKey: string;
  documentId: string;
  viewEpoch: number;
  planRevisionId: string;
  /** Exact reviewed source, requirements, target contracts, and disclosed terms; UI identity only. */
  executionScopeKey: string;
};
export type OutputPaidDecision = OutputPaidDecisionScope & (
  | { action: "authorize"; preflightId: string; termsDigest: string }
  | { action: "run"; grantId: string }
);
export type OutputActivationButton = { type: string; disabled: boolean; form: object | null };
export type OutputActivationClick = {
  type: string; isTrusted: boolean; currentTarget: unknown; defaultPrevented?: boolean;
};
export type OutputActivationSubmit = { isTrusted: boolean; submitter: unknown; currentTarget: unknown };

const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** An exact preflight/terms or grant identity; no label, index, or current global route. */
export function outputPaidDecisionKey(decision: OutputPaidDecision): string | null {
  if (!decision || typeof decision !== "object" || !nonempty(decision.authorizationScopeKey)
    || !nonempty(decision.documentId) || !nonempty(decision.planRevisionId) || !nonempty(decision.executionScopeKey)
    || !Number.isSafeInteger(decision.viewEpoch) || decision.viewEpoch < 0) return null;
  const base = [decision.authorizationScopeKey, decision.documentId, decision.viewEpoch, decision.planRevisionId, decision.executionScopeKey];
  if (decision.action === "authorize" && nonempty(decision.preflightId) && nonempty(decision.termsDigest)) {
    return JSON.stringify([...base, "authorize", decision.preflightId, decision.termsDigest]);
  }
  if (decision.action === "run" && nonempty(decision.grantId)) return JSON.stringify([...base, "run", decision.grantId]);
  return null;
}

/**
 * Arm from the paid native button's trusted click, including native keyboard clicks.
 * Consume synchronously from its native form submit, before asynchronous work.
 * Every consume attempt clears the latch, including rejected attempts.
 * Hosts must expire the returned token next task (not a microtask), and clear on
 * scope, selection, terms, permission, cancel, disconnect, or grant changes.
 */
export class OutputDirectActivationLatch {
  #nextToken = 0;
  #armed: { token: number; button: OutputActivationButton; form: object; decisionKey: string } | null = null;

  clear(): void { this.#armed = null; }

  /** An older scheduled expiry cannot clear a newly armed click. */
  expire(token: number): void { if (this.#armed?.token === token) this.#armed = null; }

  arm(event: OutputActivationClick, button: OutputActivationButton, decision: OutputPaidDecision, userActivationActive: boolean): number | null {
    this.clear();
    const decisionKey = outputPaidDecisionKey(decision);
    if (!decisionKey || event.type !== "click" || event.isTrusted !== true || event.defaultPrevented === true
      || event.currentTarget !== button || userActivationActive !== true
      || button.type !== "submit" || button.disabled !== false || !button.form) return null;
    const token = ++this.#nextToken;
    this.#armed = { token, button, form: button.form, decisionKey };
    return token;
  }

  consume(event: OutputActivationSubmit, decision: OutputPaidDecision, userActivationActive: boolean): boolean {
    const armed = this.#armed;
    this.clear();
    return !!armed && event.isTrusted === true && userActivationActive === true
      && outputPaidDecisionKey(decision) === armed.decisionKey
      && event.submitter === armed.button && event.currentTarget === armed.form
      && armed.button.form === armed.form && armed.button.type === "submit" && armed.button.disabled === false;
  }
}
