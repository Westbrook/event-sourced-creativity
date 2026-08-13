export type ProviderFailureCategory = "safety" | "authentication" | "access" | "quota" | "rate_limit" | "network" | "canceled" | "provider" | "server" | "unknown";

export type ProviderFailureDetail = {
  code: string;
  category: ProviderFailureCategory;
  message: string;
  retryable: boolean;
  requestId: string | null;
  httpStatus: number | null;
};

export class ProviderRequestError extends Error {
  readonly detail: ProviderFailureDetail;
  constructor(detail: ProviderFailureDetail) {
    super(detail.message);
    this.name = "ProviderRequestError";
    this.detail = detail;
  }
}

const errorRecord = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};

export function classifyProviderFailure(input: unknown, response?: Response, providerBody?: unknown): ProviderFailureDetail {
  if (input instanceof ProviderRequestError) return input.detail;
  const body = errorRecord(errorRecord(providerBody).error ?? providerBody);
  const message = String(body.message ?? (input instanceof Error ? input.message : "provider_request_failed"));
  const status = response?.status ?? null;
  const providerCode = String(body.code ?? body.type ?? "").trim();
  const lower = `${providerCode} ${message}`.toLowerCase();
  let category: ProviderFailureCategory = "unknown";
  if (/safety|content[_ -]?policy|moderation|request was rejected/.test(lower)) category = "safety";
  else if (status === 401 || /invalid[_ -]?api[_ -]?key|authentication/.test(lower)) category = "authentication";
  else if (status === 403 || /permission|project.*access|organization.*access/.test(lower)) category = "access";
  else if (/insufficient[_ -]?quota|billing[_ -]?quota|credit|hard[_ -]?cap/.test(lower)) category = "quota";
  else if (status === 429 || /rate[_ -]?limit|requests per minute|tokens per minute/.test(lower)) category = "rate_limit";
  else if (input instanceof DOMException && input.name === "AbortError") category = "canceled";
  else if (input instanceof TypeError || /fetch failed|network|econn|dns|timeout/.test(lower)) category = "network";
  else if (status !== null && status >= 500) category = "server";
  else if (status !== null || providerCode) category = "provider";
  const fallbackCode: Record<ProviderFailureCategory, string> = {
    safety: "safety_rejected", authentication: "provider_authentication_failed", access: "provider_access_denied", quota: "provider_quota_exhausted", rate_limit: "provider_rate_limited", network: "provider_network_failed", canceled: "provider_request_canceled", provider: "provider_request_failed", server: "provider_server_failed", unknown: "operation_failed",
  };
  return {
    code: providerCode || fallbackCode[category],
    category,
    message,
    retryable: category === "network" || category === "rate_limit" || category === "server",
    requestId: response?.headers.get("x-request-id") ?? response?.headers.get("openai-request-id") ?? null,
    httpStatus: status,
  };
}

export function providerErrorFromResponse(response: Response, body: unknown, fallback: string) {
  const record = errorRecord(errorRecord(body).error ?? body);
  return new ProviderRequestError(classifyProviderFailure(new Error(String(record.message ?? fallback)), response, body));
}

export function publicFailureDetail(detail: ProviderFailureDetail) {
  return { code: detail.code, category: detail.category, message: detail.message, retryable: detail.retryable, requestId: detail.requestId, httpStatus: detail.httpStatus };
}
