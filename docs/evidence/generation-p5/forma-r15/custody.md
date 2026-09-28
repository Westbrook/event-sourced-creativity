# Separate, default-off production custody phase

**Prepared; not executed or authorized.** [Implementation](../../../../worker/generation-study-custody-probe.ts) is fenced to the actual-Forma origin, trusted named owner's existing administrator/consent/personal guard and unchanged `MEDIA` binding. The flag `FORMA_GENERATION_CUSTODY_PROBE_ENABLED` must equal `1`; otherwise it returns disabled before DB/R2 work. No DB marker, schema install, other object lookup, list operation, provider call or grant is present.

- Unique fixed key: `qualification/p5-forma-r15-29b1d7f841b54f10a9e65a4c6b183e7d.txt`.
- Exactly69UTF-8bytes, two LF terminators:
  ```text
  FORMA P5 R15 synthetic custody only
  29b1d7f841b54f10a9e65a4c6b183e7d
  ```
- Raw-byte SHA256: `b78286741fa1ccf844348654a0f056a44bff6a0ab4598422c82827da759d6e38`.
- HTTP content type `text/plain`. Exact custom metadata: `probe=p5-forma-r15-29b1d7f841b54f10a9e65a4c6b183e7d`, `target=appgprj_6a7a020e334881919ed8aea0363cb98f`, `owner=consentHash(observed real Site user ID)`, `sha256` as above. Owner is bound at invocation, never filled from a synthetic fixture.
- Fixed GET page loads no automatic request/storage action. Three buttons send only `{"action":"put"}`, `{"action":"read"}`, `{"action":"delete"}` to their same-origin path. All POSTs require exact JSON/content type/origin; ≤64bodybytes; duplicate/extra keys denied. Network/refusal leaves buttons disabled. This is a supported browser UI, not a request for an SQL console or unmanaged credentials.

Put first reads only this key, refuses any existing object and uses `onlyIf.etagDoesNotMatch='*'`. A separate HTTP read validates length, raw hash and all metadata; a forced local Worker restart is tested, but a future cross-request hosted read is not a forced hosted restart claim. Delete revalidates the original, deletes only that key and reads it again for null. Already absent is an honest cleanup acknowledgement, not proof it was ever stored. Missing, corrupt or changed original refuses; do not weaken the guard to delete an unknown object.

**Concurrency and retry limits:** native conditional put prevents overwrite, but this R2 interface has no conditional delete. Exact validation is not an atomic lock against a concurrent writer between get/delete. The owner must accept exclusive control of this unique key during the bounded phase; if that cannot be established, do not put. There is no durable one-shot marker: a new put could succeed after deletion while the flag remains enabled. Operator must never replay put, and must disable the flag/redeploy after original cleanup. Expiry gates actions; it does not delete objects. No scheduler is added.

Stage C proposes at most one put, one planned cross-request read and five total original cleanup attempts including the first. The full planned/recovery inventory allows ≤13fixed-key gets, ≤1conditional put and ≤5deletes; each accepted original body is69bytes. D1 use is authentication-only, using the same32statement/read limits and zero writes. These ceilings require driver accounting; the Worker does not enforce a total request/single-use ledger. The object ceiling does not bound provider backups/history or billed operation/storage prices.

If put is uncertain, **never replay it**. Use one reserved original read, then guarded original cleanup if verifiable. A deterministic mismatch stops recovery; retain evidence and ask for an exact changed recovery decision. Keep the cleanup-capable Worker/flag until cleanup settles; rolling back first can strand the object. After verified null, disable the flag, redeploy the saved candidate, verify terminal deployment and disabled response. No deletion of existing buckets or app records, no schema removal, no cleanup of other keys.

Proposed owner choice, still unaccepted: westbrook.johnson@reve.art would own unknown-price finite production-probe exposure, complete original deletion in-session before2026-09-30T22:00Z and retain probe receipts/source/version metadata privately indefinitely until separately reviewed deletion. The observed69-byte object should be absent after cleanup; provider backup/history erasure remains unknown. If cleanup is unresolved, object exposure persists and requires an explicit reviewed recovery/retention disposition, not an invented seven-day promise. This proposal does not modify accepted private-rehearsal retention and does not fund a paid study.
