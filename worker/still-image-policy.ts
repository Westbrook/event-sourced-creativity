import type { WorkerEnv } from "./runtime.ts";

/** Applied at admission and restored from the saved job before execution/recovery. */
export function stillImageEnvironment(env: WorkerEnv, sourceSurface: string, request: Record<string, unknown>): WorkerEnv {
  return sourceSurface === "still" && request.stillImageProvider === "openai"
    ? { ...env, FORMA_IMAGE_PROVIDER: "openai" }
    : env;
}
