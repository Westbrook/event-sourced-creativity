# Resource inventory and economic decision

Exact machine-readable inventory: [resource-inventory.json](resource-inventory.json). Target: existing retired private Site `appgprj_6ab5929a74288191bf37ed429f7a7e20`, existing D1 `DB`. Proposed manifest delta: **`r2: null → "MEDIA"`**, requiring one new managed R2 resource. No second database, new Site, secret, access change or production Forma binding is proposed.

| Item | Exact finite inventory / observed local result |
| --- | --- |
| Migration | Preserve one historical file; append one 144-statement schema-only file. 142 application objects and two P5 controls. |
| Import | 26 compiled rows / 18,538 JSON bytes, no caller dataset. |
| Synthetic provider transport | Six intercepted responses; zero external attempts. These are not paid POSTs. |
| R2 payloads | Two keys, 6,190 bytes each; **12,380 total object bytes**. PNG SHA256 `08c04ddee6610589fccaf694ee06dac80e8b6506c2ca07f57b0acbf7eaaa3c89`. |
| Normal R2 operations | 2 puts, 1 actual recovery get, 2 cleanup original gets, 2 deletes, 2 read-null gets = **2 puts / 5 gets / 2 deletes**. No list/head in candidate. Harness list checks are local only. |
| Primary driver | 24 HTTP requests including negative/concurrent/status checks. Normal positive lifecycle has start, ten steps and cleanup; status recovers discarded acknowledgements. |
| D1 returned metadata | 8,926 successful statements, 2,308,867 rows read, 6,764 rows written across successful primary responses. Failed batches do not return full work metadata: these are observed lower bounds, not billed units. |
| Per-request local maximum | 842 binding calls; 3,276 successful SQL statements. Maximum local client wall time 523.5 ms; no hosted CPU or peak-memory measurement. |
| Local allocated D1 size | 1,060,864 bytes after cleanup; deletion did not shrink allocated storage. |
| Residue | 62 synthetic application rows + new P5 tombstone + original N10H tombstone = 64 rows. Approximately 39,563 serialized local row bytes; hosted native owner length may differ. All 172 explicit schema objects remain. |
| Compiled/source residue | Synthetic input/terms/PNG are embedded in the retained source and Worker. Database/R2 cleanup does not remove those bytes from source/version history. |

## Execution bounds and their limits

Body ≤128 bytes; five fixed actions; ten step indices; one claim per index; one import and no rearm. New steps must start within one hour and before October 1, 2026 00:00 UTC. Each request has a 120-second observed wall deadline. Normal mutation admission stops at 80 requests; stop/cleanup/status remain available for recovery and are not an infinite-free-service guarantee. The later authorized driver should be limited to **80 total HTTP requests including recovery**, at most five cleanup attempts, no generation/approval retry, then escalate custody failure rather than loop.

The wrapper refuses more than 950 attempted D1 binding calls in an invocation, SQL above 100,000 bytes or 100 parameters, returned totals above 6,000 successful statements / 10 million rows read / 20,000 rows written, or reported database size above 16 million bytes. Row/size/wall checks observe work already done and may overshoot by the last batch; failed batches may have unreturned usage. These controls bound the finite application procedure and its recovery, **not a hard monetary cap**. Unauthenticated requests still incur whatever ingress costs the platform applies.

For the proposed 80-request driver, multiplying the per-request observation ceilings gives planning ceilings of 76,000 admitted D1 binding calls, 480,000 successful statements, 800 million observed rows read and 1.6 million observed rows written, plus failed/overshoot work. Those loose ceilings are not forecasts or accepted spending. Up to five cleanup attempts add at most ten deletes and twenty gets for the same two keys; retries never add objects or provider calls.

Cloudflare currently documents D1 invocation/query limits of 1,000 on Workers Paid / 50 on Free, plus per-query size/parameter limits. This candidate measured binding calls and statements separately; do not equate those units or infer the managed Sites plan/allocation. **Hosted runtime fit remains unqualified**, even though the local emulator passes. Native admission/observed hosted outcomes are needed; a quota refusal must leave the run consumed and proceed to cleanup, not weaken guards. [Official D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Retention and deletion

Proposed operational target: finish proof and cleanup within the one-hour run window; cleanup remains available after expiry. No scheduler is installed. If interrupted, P5 retains the cleanup obligation and must resume the same operation after applicable hosted authorization; an expiry timestamp alone does not delete an R2 object. Preserve private owner-only access throughout.

Cleanup deletes the two original keys (including orphaned puts) and all synthetic private bodies. Original operation/intent/charge/reconciliation/receipt rows are immutable and retained with the synthetic user and budget records. No trigger is dropped to erase them. The new P5 control becomes permanently disabled and discards its report. Old N10H is unchanged. Empty bucket, allocated database, schema, source/deployment history and synthetic tombstones remain. Physical backup/provider erasure is not demonstrated by API read-null; R2's consistency guarantee is a separate documented property. [Official R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/).

## Unresolved cost terms — no liability accepted

Measured local usage above is not an invoice. Sites unit prices, billing owner, included allocation, paid/free/enterprise limits, resource minimums, deployment/source charges and retention terms are unknown. No actual hosting charge or peak managed resource observation exists.

**Proposed, unaccepted spending limit: $1 incremental managed-service cost for this finite run and a seven-day review window; $0 real-provider spend.** The Worker cannot enforce a dollar cap, prices have not been obtained and $1 is not represented as sufficient. A later decision must either establish applicable terms that make an accepted monetary limit enforceable, or explicitly choose finite-resource/unknown-price exposure instead. Neither choice has been made. Continued empty-resource/schema/source retention beyond the review window is a separate unresolved duration/cost term; the dossier does not promise bucket/database removal or accept ongoing liability.
