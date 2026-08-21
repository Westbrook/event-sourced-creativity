export type ProviderFailureCategory = "safety" | "authentication" | "access" | "quota" | "rate_limit" | "network" | "canceled" | "provider" | "server" | "unknown";
export type ProviderFailureScope = "request" | "user" | "workspace" | "account" | "project" | "organization" | "model" | "region" | "network" | "provider" | "unknown";
export type ProviderFailureAction = "edit_request" | "check_credentials" | "check_project" | "verify_organization" | "add_credits" | "raise_limit" | "review_budget" | "wait_and_retry" | "retry" | "contact_support" | "none";

export type ProviderFailureDetail = {
  code: string;
  category: ProviderFailureCategory;
  scope: ProviderFailureScope;
  action: ProviderFailureAction;
  message: string;
  retryable: boolean;
  retryAfterMs: number | null;
  requestId: string | null;
  httpStatus: number | null;
  riskCategories?: string[];
  contributingBlockIds?: string[];
  contributingReferenceIds?: string[];
  probe?: string;
};

export class ProviderRequestError extends Error {
  readonly detail: ProviderFailureDetail;
  readonly preparedPrompt: string | null;
  constructor(detail: ProviderFailureDetail, preparedPrompt: string | null = null) {
    super(detail.message);
    this.name = "ProviderRequestError";
    this.detail = detail;
    this.preparedPrompt = preparedPrompt;
  }
}

export function providerFailurePrompt(input: unknown) {
  return input instanceof ProviderRequestError ? input.preparedPrompt : null;
}

const errorRecord = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
const providerErrorRecord=(value:unknown)=>{
  const root=errorRecord(value);const direct=errorRecord(root.error??root);const detail=Array.isArray(root.detail)?errorRecord(root.detail[0]):{};
  if(Object.keys(detail).length){const context=errorRecord(detail.ctx);const extra=errorRecord(context.extra_info);return{...detail,message:String(detail.msg??detail.message??direct.message??"provider_request_failed"),code:String(detail.type??detail.code??extra.reason??direct.code??"")};}
  return direct;
};

function durationMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  const units = [...value.toLowerCase().matchAll(/([\d.]+)\s*(ms|s|m|h)/g)];
  if (!units.length) return null;
  const multipliers = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;
  return Math.max(0, Math.round(units.reduce((total, match) => total + Number(match[1]) * multipliers[match[2] as keyof typeof multipliers], 0)));
}

export function providerRetryAfterMs(response?: Response) {
  return durationMs(response?.headers.get("retry-after") ?? null)
    ?? durationMs(response?.headers.get("x-ratelimit-reset-requests") ?? null)
    ?? durationMs(response?.headers.get("x-ratelimit-reset-tokens") ?? null);
}

export function classifyProviderFailure(input: unknown, response?: Response, providerBody?: unknown): ProviderFailureDetail {
  if (input instanceof ProviderRequestError) return input.detail;
  const body = providerErrorRecord(providerBody);
  const message = String(body.message ?? (input instanceof Error ? input.message : "provider_request_failed"));
  const status = response?.status ?? null;
  const providerCode = String(body.code ?? body.type ?? "").trim();
  const lower = `${providerCode} ${message}`.toLowerCase();
  const promptTooLong = /prompt.*(?:string too long|maximum length)|(?:string too long|maximum length).*prompt/.test(lower);
  const imageCardinalityExceeded = /number of images \(\d+\) exceeds maximum of \d+/.test(lower);
  let category: ProviderFailureCategory = "unknown";
  let scope: ProviderFailureScope = "unknown";
  let action: ProviderFailureAction = "none";

  if (/safety|content[_ -]?policy|moderation|request was rejected/.test(lower)) {
    category = "safety"; scope = "request"; action = "edit_request";
  } else if (promptTooLong || imageCardinalityExceeded) {
    category = "provider"; scope = "request"; action = "edit_request";
  } else if (/credit_balance_exhausted|insufficient[_ -]?quota|billing[_ -]?quota|billing.*not active|credit.*exhaust|hard[_ -]?cap/.test(lower)) {
    category = "quota"; scope = "account"; action = "add_credits";
  } else if (/project_(spend|usage)_limit_exceeded|project.*(spend|usage).*limit/.test(lower)) {
    category = "quota"; scope = "project"; action = "raise_limit";
  } else if (/organization_(spend|usage)_limit_exceeded|organization.*(spend|usage).*limit/.test(lower)) {
    category = "quota"; scope = "organization"; action = "raise_limit";
  } else if (/not a member|membership|organization.*access|organization.*permission/.test(lower)) {
    category = "access"; scope = "organization"; action = "check_project";
  } else if (/project.*(access|permission|mismatch)|does not belong to project/.test(lower)) {
    category = "access"; scope = "project"; action = "check_project";
  } else if (/organization.*verif|verify.*organization/.test(lower)) {
    category = "access"; scope = "organization"; action = "verify_organization";
  } else if (/model_not_found|model.*(access|permission|not available)|does not have access to model/.test(lower)) {
    category = "access"; scope = "model"; action = "check_project";
  } else if (status === 401 || /invalid[_ -]?api[_ -]?key|authentication|incorrect api key/.test(lower)) {
    category = "authentication"; scope = "account"; action = "check_credentials";
  } else if (/country|region|territory.*not supported/.test(lower)) {
    category = "access"; scope = "region"; action = "contact_support";
  } else if (status === 403 || /permission|access denied|ip allowlist/.test(lower)) {
    category = "access"; scope = "account"; action = "check_project";
  } else if (status === 429 || /rate[_ -]?limit|requests per minute|tokens per minute|images per minute/.test(lower)) {
    category = "rate_limit"; scope = "project"; action = "wait_and_retry";
  } else if (input instanceof DOMException && input.name === "AbortError") {
    category = "canceled"; scope = "request"; action = "retry";
  } else if (input instanceof TypeError || /fetch failed|network|econn|dns|timeout/.test(lower)) {
    category = "network"; scope = "network"; action = "retry";
  } else if (status !== null && status >= 500) {
    category = "server"; scope = "provider"; action = "retry";
  } else if (status !== null || providerCode) {
    category = "provider"; scope = "request"; action = "edit_request";
  }

  const fallbackCode: Record<ProviderFailureCategory, string> = {
    safety: "safety_rejected", authentication: "provider_authentication_failed", access: "provider_access_denied", quota: "provider_quota_exhausted", rate_limit: "provider_rate_limited", network: "provider_network_failed", canceled: "provider_request_canceled", provider: "provider_request_failed", server: "provider_server_failed", unknown: "operation_failed",
  };
  return {
    code: promptTooLong ? "image_prompt_too_long" : imageCardinalityExceeded ? "provider_image_cardinality_exceeded" : providerCode || fallbackCode[category], category, scope, action,
    message: promptTooLong
      ? "The prepared image prompt exceeded the provider's 32,000-character limit. The application should compact the document context before retrying."
      : imageCardinalityExceeded
        ? "A provider preflight received more images than that endpoint accepts. The application must split the images into valid probes before retrying."
        : message,
    retryable: category === "network" || category === "rate_limit" || category === "server" || category === "canceled",
    retryAfterMs: providerRetryAfterMs(response),
    requestId: response?.headers.get("x-fal-request-id") ?? response?.headers.get("x-request-id") ?? response?.headers.get("openai-request-id") ?? null,
    httpStatus: status,
  };
}

export function applicationFailureDetail(code: string, scope?: unknown, status: number | null = null): ProviderFailureDetail {
  const normalizedScope = scope === "workspace" ? "workspace" : "user";
  if (code === "budget_hard_cap_reached" || code === "budget_user_hard_cap_reached" || code === "budget_workspace_hard_cap_reached") {
    return {
      code, category: "quota", scope: normalizedScope, action: "review_budget",
      message: normalizedScope === "workspace" ? "The workspace generation budget is exhausted for this period." : "Your generation budget is exhausted for this period.",
      retryable: false, retryAfterMs: null, requestId: null, httpStatus: status,
    };
  }
  if (code === "provider_not_configured") {
    return { code, category: "authentication", scope: "account", action: "check_credentials", message: "Image generation is not configured.", retryable: false, retryAfterMs: null, requestId: null, httpStatus: status };
  }
  if (code === "video_provider_not_configured") {
    return { code, category: "authentication", scope: "account", action: "check_credentials", message: "Fal video generation is not configured.", retryable: false, retryAfterMs: null, requestId: null, httpStatus: status };
  }
  if (code === "selected_preview_unavailable") {
    return { code, category: "provider", scope: "request", action: "edit_request", message: "The selected draft image is no longer available. Generate from the document or choose another draft.", retryable: false, retryAfterMs: null, requestId: null, httpStatus: status };
  }
  return classifyProviderFailure(new Error(code), status ? new Response(null, { status }) : undefined, { error: { code, message: code } });
}

export function providerErrorFromResponse(response: Response, body: unknown, fallback: string, preparedPrompt: string | null = null) {
  const record = providerErrorRecord(body);
  return new ProviderRequestError(classifyProviderFailure(new Error(String(record.message ?? fallback)), response, body), preparedPrompt);
}

export function publicFailureDetail(detail: ProviderFailureDetail) {
  return { code: detail.code, category: detail.category, scope: detail.scope, action: detail.action, message: detail.message, retryable: detail.retryable, retryAfterMs: detail.retryAfterMs, requestId: detail.requestId, httpStatus: detail.httpStatus, riskCategories: detail.riskCategories ?? [], contributingBlockIds: detail.contributingBlockIds ?? [], contributingReferenceIds: detail.contributingReferenceIds ?? [], probe: detail.probe ?? null };
}
