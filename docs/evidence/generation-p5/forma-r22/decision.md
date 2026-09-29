# Proposed R22 diagnostic — one existing-log read only

**Pending user approval. No hosted action has been taken in R22.** This is an explicit one-read exception to the current stop, not permission to resume publication or qualification navigation.

Use the supported native **`mcp__codex_apps__sites_get_site_worker_logs`** once:

```json
{
  "project_id": "appgprj_6a7a020e334881919ed8aea0363cb98f",
  "since_minutes": "N, computed once immediately before reservation as specified below",
  "limit": 100,
  "errors_only": false
}
```

`since_minutes` must be an integer at dispatch, not the explanatory string above. Calculate `N = ceil((dispatchUTC - 2026-09-28T23:57:45.950721Z) / 60000) + 1`; require `1 <= N <= 2880` and dispatch before `2026-09-30T22:00:00Z`. This supplies the smallest whole-minute window containing the original attempt with one minute of boundary allowance. Native contract allows1–10080 minutes,1–100 events and a boolean error filter; it promises recent logs, not completeness or retention. No route/time-to filter or pagination cursor is documented. Do not invent one. The returned shape is `{project_id, events:[{...}]}`; event fields are not guaranteed by the contract.

Copy the project ID from the verified R21 site receipt and validate equality locally. No fresh native target call is needed for this historical read; it does not assert fresh live-state parity. Require the returned project to match. Request successful as well as failed events because a successful invocation whose response was not delivered to the browser is one possibility being distinguished. Do not deploy551 or navigate to generate logs.

Before dispatch, carry all24prior entries and counters forward unchanged into the continuation ledger; record the explicit log-only approval, authorize only group`logs` (cap1, previously unused), and fsync/read back reservation25. R21's stopped ledger remains immutable. Its old helper does not allow `logs` at reserve time: adapt only this local one-operation accounting allowlist after approval, without unlocking deployment, browser, qualification or restoration actions. Do not bypass the stopped ledger or treat the available category cap as authority. Save/redact the response and reconcile that one reserved entry even on refusal or uncertain completion. No retry, polling, second query or automatic scope expansion.

**Allocation:**1existing normal reservation,0recovery; no ceiling increase or transfer. After dispatch:19/22normal,6/6recovery,25total charged. This read makes no application request or deployment/environment/access mutation, so there is no changed state to restore and0recovery is sufficient for this operation only. Underlying native HTTP and price remain unknown. No later qualification resumption is included; it requires separately sufficient recovery. No sign-in approval, credential entry, security-setting change or other user interaction is needed beyond approval of this exact read. If access fails or new authentication is demanded, retain the refusal and stop.

## Interpret the returned evidence

Compare only events with the exact qualification route, a timestamp within the original action interval `23:57:45.950721Z–23:58:30.915793Z` on September28, and methodGET when available. Check deployment/version identifiers if present. Report any missing correlation field; route/time proximity without a unique request/trace identifier is corroboration, not conclusive attribution to tab7. Do not interpret unrelated events as this request.

| Outcome | What it establishes / next boundary |
| --- | --- |
| Exact correlated invocation and success/status | The request reached the Worker if attribution is sufficient; the failure may be after dispatch. A status alone is not qualification JSON, schema/principal proof or a browser root cause. Preserve any explicit delivery/redirect evidence, without following redirects. |
| Correlated error/refusal | The specific logged Worker outcome is evidence of an application-side event; it does not by itself explain the browser block or authorize application/schema/authentication changes. |
| Nearby route event without adequate request correlation | Partial evidence only; preserve uncertainty about whether it is the R21 attempt. |
| No match, empty/truncated/limited logs or missing fields | Inconclusive. Sampling, capture coverage, retention, restored-version log scope and recent-event cap may hide the event. Do not claim no Worker invocation. Stop; report the exact missing correlation/trace capability rather than redeploying. |
| Native refusal, mismatched project, unavailable logs or unexpected authentication | Stop with a redacted receipt; no alternative surface, retries or extra calls. |

Keep only relevant timestamp, exact fixed route, method, outcome/status, request/trace/deployment/version identifiers when supplied, plus aggregate returned/matching/omitted counts and field-coverage limitations. Redact bodies, cookies, tokens, headers, identity/account data, document text, query values and unrelated event content before durable storage; do not retain a raw log dump. These redacted receipts stay in restricted P5 evidence/Git indefinitely under the existing accepted retention owner, westbrook.johnson@reve.art. No external message is sent. No platform capability request is proposed while this supported observation remains available.

No Start, qualification GET, redeployment, source push/save, migration, normalization, fixture, custody, grant, paid provider call, cleanup or controls change is included. Last verified live550/env16/workspace_all/access7 remains the known state; saved/admitted551 remains available for a later specifically authorized resumption. All prior migration/retention/authentication choices, P2 gates,847/six exclusions, September30 22UTC margin and October1 00UTC expiry persist. **P5 remains open.**
