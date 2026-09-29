import { prepareSelectedOutputShare, commitSelectedOutputShare,
  readPreparedSelectedOutputShareMediaFile } from "../../worker/selected-output-share-lifecycle.ts";
import { handleSelectedOutputShareApi } from "../../worker/selected-output-share-api.ts";
import type { WorkerEnv } from "../../worker/runtime.ts";

// Test-only access to dormant implementations. The real dispatcher still
// refuses public creation; it is used unchanged for every ordinary API path.
// No production capability, binding, proof, or media transport is replaced.
export default { async fetch(request: Request, env: WorkerEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/__synthetic__/prepare") return prepareSelectedOutputShare(request, env);
  if (path === "/__synthetic__/commit") return commitSelectedOutputShare(request, env);
  const prepared = path.match(/^\/__synthetic__\/prepared\/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})$/u);
  if (prepared) return readPreparedSelectedOutputShareMediaFile(request, env, prepared[1]!);
  return handleSelectedOutputShareApi(request, env);
} };
