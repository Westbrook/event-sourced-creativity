import { mergeProviderSubmissions, providerSubmissions, type PaidProviderSubmission, type PaidProviderSubmissionObserver } from "../src/model/provider-submission.ts";

type Progress = (stage: string, message: string, patch?: Record<string, unknown>) => void | Promise<void>;

/** Serialize paid checkpoints before dispatch, including parallel production units. */
export function paidProviderObserver(checkpoint: Record<string, unknown>, progress?: Progress, accounting: Record<string, unknown> = {}): PaidProviderSubmissionObserver {
  checkpoint.providerSubmissionProtocol=1;
  let queue = Promise.resolve();
  return (observation) => {
    const persist = async () => {
      const existing = providerSubmissions(checkpoint).find((entry) => entry.clientRequestId === observation.clientRequestId
        || observation.providerRequestId && entry.provider === observation.provider && entry.providerRequestId === observation.providerRequestId);
      const receipt: PaidProviderSubmission = { ...observation, clientRequestId: existing?.clientRequestId ?? observation.clientRequestId };
      const receipts = mergeProviderSubmissions(checkpoint.providerSubmissions, { [receipt.clientRequestId]: receipt });
      const planning = Object.values(receipts).filter((entry) => entry.operation === "planning" && entry.status === "completed");
      const plannerPatch = receipt.operation === "planning" && receipt.status === "completed" ? {
        plannerModel: receipt.model,
        plannerResponseId: planning[0]?.providerRequestId ?? "",
        plannerResponseIds: planning.map((entry) => entry.providerRequestId).filter(Boolean),
        plannerUsage: planning.reduce((total, entry) => ({ inputTokens: total.inputTokens + Number(entry.inputTokens ?? 0), outputTokens: total.outputTokens + Number(entry.outputTokens ?? 0), totalTokens: total.totalTokens + Number(entry.totalTokens ?? 0) }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      } : {};
      const patch = { ...accounting, providerSubmissionProtocol: 1, providerSubmissions: receipts, ...plannerPatch };
      await progress?.(receipt.status === "pending" ? "submitting" : "provider-receipt", receipt.status === "pending"
        ? `Recording the approved ${receipt.operation} request before sending it.`
        : `The ${receipt.operation} provider receipt is safely recorded.`, patch);
      Object.assign(checkpoint, patch);
    };
    const next = queue.then(persist);
    // A failed checkpoint prevents this request; later observations still retain other units.
    queue = next.catch(() => undefined);
    return next;
  };
}
