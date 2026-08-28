import { isOutputContextType } from "../src/model/output-requirements.ts";

export const OUTPUT_CONTEXT_PACKAGE_MESSAGE = "Output requirements are not supported in organization context packages yet. Author or copy them in a Document.";
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Output packages need a dedicated version/copy contract; no generic package mutation can supply it. */
export function outputContextPackageFailure(blocks: readonly unknown[]) {
  return blocks.some((candidate) => record(candidate) && (isOutputContextType(candidate.type)
    || record(candidate.properties) && Object.hasOwn(candidate.properties, "output_spec")))
    ? { error: "output_context_package_unsupported", errorCode: "output_context_package_unsupported", errorValues: {}, message: OUTPUT_CONTEXT_PACKAGE_MESSAGE } : null;
}

export function hasOutputPackageProvenance(properties: Record<string, unknown>) {
  return ["organization_context_package_id", "organization_context_package_version_id", "organization_context_package_binding_id", "organization_context_source_block_id"]
    .some((key) => properties[key] !== undefined && properties[key] !== null && properties[key] !== "");
}

export function rejectOutputContextPackage(blocks: readonly unknown[]): Response | null {
  const failure = outputContextPackageFailure(blocks);
  return failure ? Response.json(failure, { status: 409 }) : null;
}
