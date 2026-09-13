export * from "../src/model/output-fal-image-contract.ts";
import { captureOutputFalImageRequest } from "../src/model/output-fal-image-contract.ts";

export type OutputFalCapturedRequest = Awaited<ReturnType<typeof captureOutputFalImageRequest>>;
type Captured = OutputFalCapturedRequest;
/** Same native claim/checkpoint hooks, with no await between final gate and POST. */
export async function submitOutputFalImageRequest<T>(captured: Captured, hooks: {
  beforeAttempt: (attempt: Captured["attempt"]) => void | Promise<void>;
  pending: (receipt: { clientRequestId: string; provider: "fal"; operation: "image"; model: string; status: "pending" }) => void | Promise<void>;
  checkpoint: (captured: Captured) => void | Promise<void>;
  beforeDispatch: (id: string) => void;
}, submit: (body: string) => Promise<T>): Promise<T> {
  await hooks.beforeAttempt(captured.attempt);
  await hooks.checkpoint(captured);
  await hooks.pending({ clientRequestId: captured.attempt.clientRequestId, provider: "fal", operation: "image", model: captured.contract.model, status: "pending" });
  hooks.beforeDispatch(captured.attempt.clientRequestId);
  return submit(captured.body);
}

/** Rebind retained bytes without compiling another prompt or accepting new options. */
export async function restoreOutputFalImageRequest(value: unknown, body: string, clientRequestId: string, requestDigest: string) {
  if (typeof body !== "string" || body.length > 32_768 || !/^[a-f0-9]{64}$/u.test(requestDigest)) throw new Error("output_fal_checkpoint_invalid");
  const input: unknown = JSON.parse(body);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("output_fal_checkpoint_invalid");
  const { readOutputFalImageContract } = await import("../src/model/output-fal-image-contract.ts");
  const contract = readOutputFalImageContract(value);
  if (!contract) throw new Error("output_fal_checkpoint_invalid");
  const captured = await captureOutputFalImageRequest(contract, contract.model, input as Record<string,unknown>, contract, clientRequestId);
  if (captured.body !== body || captured.attempt.requestDigest !== requestDigest) throw new Error("output_fal_checkpoint_invalid");
  return captured;
}
