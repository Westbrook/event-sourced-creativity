import { parseModel3dOutputContract } from "../src/model/output-model3d-contract.ts";

/** Private evidence of the original native mini-app job, never a public feed.
 * General Model3D assets and other output families keep their existing policy. */
export const MODEL3D_PRIVATE_CHECKPOINT_KEYS = Object.freeze([
  "outputExecution", "model3dInputReceipt", "model3dProviderFiles", "model3dSettings",
  "model3dEstimatedCostMicrousd", "model3dProviderSubmission", "providerJobId", "providerModel", "provider",
  "providerStatusUrl", "providerResponseUrl", "providerCancelUrl", "providerSubmissions", "providerSubmissionProtocol",
]);
export function model3dNativeCheckpoint(request: Record<string, unknown>): boolean {
  return request.artifactKind === "model3d" && Boolean(parseModel3dOutputContract(request.outputModel3d));
}
// Constant, server-owned keys only. Existing checkpoint evidence wins over the
// sanitized terminal response, including completion's intentionally absent keys.
const values = MODEL3D_PRIVATE_CHECKPOINT_KEYS.map(key => "'$." + key + "',CASE json_type(result_json,'$." + key
  + "') WHEN 'true' THEN json('true') WHEN 'false' THEN json('false') ELSE json_extract(result_json,'$." + key + "') END").join(",");
const absent = MODEL3D_PRIVATE_CHECKPOINT_KEYS.map(key => "CASE WHEN json_type(result_json,'$." + key + "') IS NULL THEN '$." + key + "' ELSE '$[0]' END").join(",");
export const MODEL3D_TERMINAL_RESULT_SQL = "json_remove(json_set(?," + values + ")," + absent + ")";

/** Feed SQL can project away the private request before serializeJob sees it.
 * Filter at that projection boundary too; the marker only narrows privacy. */
export function model3dPublicResultSql(alias: "" | "job"): string {
  const prefix = alias ? alias + "." : "";
  return "CASE WHEN json_type(" + prefix + "request_json,'$.outputModel3d')='object' THEN json_remove(" + prefix + "result_json,"
    + MODEL3D_PRIVATE_CHECKPOINT_KEYS.map(key => "'$." + key + "'").join(",") + ") ELSE " + prefix + "result_json END";
}
