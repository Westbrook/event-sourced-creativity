import { mergeProviderSubmissions, providerSubmissions, type PaidProviderSubmission, type PaidProviderSubmissionObserver } from "../src/model/provider-submission.ts";

type Progress = (stage: string, message: string, patch?: Record<string, unknown>,options?:{financialReceiptPersisted?:true}) => void | Promise<void>;

/** Serialize paid checkpoints before dispatch, including parallel production units. */
export function paidProviderObserver(checkpoint: Record<string, unknown>, progress?: Progress, accounting: Record<string, unknown> = {}, observe?:PaidProviderSubmissionObserver,options:{presentation?:boolean}={}): PaidProviderSubmissionObserver {
  checkpoint.providerSubmissionProtocol=1;
  let queue = Promise.resolve();
  const observedFinancial = new Map<string, string>();
  return (observation) => {
    const persist = async () => {
      if (options.presentation && observation.status === "pending" && observation.unitId
        && providerSubmissions(checkpoint).some(entry => entry.operation === "planning" && entry.unitId === observation.unitId && entry.clientRequestId !== observation.clientRequestId)) {
        throw new Error("presentation_paid_call_already_recorded");
      }
      const existing = providerSubmissions(checkpoint).find((entry) => entry.clientRequestId === observation.clientRequestId
        || observation.providerRequestId && entry.provider === observation.provider && entry.providerRequestId === observation.providerRequestId);
      const receipt: PaidProviderSubmission = { ...observation, clientRequestId: existing?.clientRequestId ?? observation.clientRequestId };
      const receipts = mergeProviderSubmissions(checkpoint.providerSubmissions, { [receipt.clientRequestId]: receipt });
      // A restarted observer may replay an earlier checkpoint. Validate its
      // identity above, but never regress a durable completion to submitting.
      const durable = receipts[receipt.clientRequestId];
      if (durable.status !== receipt.status) return;
      const planning = Object.values(receipts).filter((entry) => entry.operation === "planning" && entry.status === "completed");
      const plannerPatch = receipt.operation === "planning" && receipt.status === "completed" ? {
        plannerModel: receipt.model,
        plannerResponseId: receipt.providerRequestId ?? "",
        plannerResponseIds: planning.map((entry) => entry.providerRequestId).filter(Boolean),
        plannerUsage: planning.reduce((total, entry) => ({ inputTokens: total.inputTokens + Number(entry.inputTokens ?? 0), outputTokens: total.outputTokens + Number(entry.outputTokens ?? 0), totalTokens: total.totalTokens + Number(entry.totalTokens ?? 0) }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      } : {};
      const currentClient=String(checkpoint.presentationProviderClientRequestId??receipt.clientRequestId);
      const current=receipts[currentClient];
      const presentationCurrent=receipt.status==="pending"?receipt:current??durable;
      const patch = { ...accounting, providerSubmissionProtocol: 1, providerSubmissions: receipts, ...plannerPatch,...(options.presentation?{presentationProviderSubmission:presentationCurrent.status==="pending"?"pending":"confirmed",presentationProviderClientRequestId:presentationCurrent.clientRequestId}:{}) };
      // Output supplies an independent, source-free accounting observer. Retain it
      // before any private progress write that erasure may now prohibit.
      const { responseRef: _responseRef, validationStatus: _validationStatus, validationIssueCount: _validationIssueCount, ...financial } = receipt;
      const financialKey=JSON.stringify(financial);
      if(observe&&observedFinancial.get(receipt.clientRequestId)!==financialKey){
        await observe(receipt);
        observedFinancial.set(receipt.clientRequestId,financialKey);
      }
      await progress?.(receipt.status === "pending" ? "submitting" : "provider-receipt", receipt.status === "pending"
        ? `Recording the approved ${receipt.operation} request before sending it.`
        : `The ${receipt.operation} provider receipt is safely recorded.`, patch,observe&&receipt.status!=="pending"?{financialReceiptPersisted:true}:undefined);
      Object.assign(checkpoint, patch);
    };
    const next = queue.then(persist);
    // A failed checkpoint prevents this request; later observations still retain other units.
    queue = next.catch(() => undefined);
    return next;
  };
}
