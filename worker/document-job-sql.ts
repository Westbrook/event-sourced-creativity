export function documentJobCompletionBindings(input: {
  status: "completed" | "failed";
  result: Record<string, unknown>;
  errorMessage: string | null;
  completedAt: string;
  parentId: string | null;
  jobId: string;
  ownerId: string;
  correlationId: string;
}) {
  return [
    input.status,
    JSON.stringify(input.result),
    input.errorMessage,
    input.completedAt,
    input.parentId,
    input.completedAt,
    input.completedAt,
    input.jobId,
    input.ownerId,
    input.correlationId,
  ] as const;
}
