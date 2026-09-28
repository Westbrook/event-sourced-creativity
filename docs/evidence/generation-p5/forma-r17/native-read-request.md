# Exact missing read capability — no publication decision

**Status: capability unavailable through the exposed tools; not an executable approval block.** This is a narrowly specified request for Sites to expose supported evidence, not a request for a SQL console, new hosting owner, physical Cloudflare ID, credentials, or diagnostic deployment. No message has been sent to a platform operator.

## Available contracts and why no existing call suffices

- `sites_get_site_version({project_id, version_id})` is callable, but R16 already retained its `source.commit_sha`, `archive_storage.{archive_format,content_hash,sediment_file_id,size_bytes,file_count}` and deployment ID. It has no archive-content/per-file-manifest output. No tool accepts that opaque file ID for archive retrieval in this session.
- `sites_read_database_overview({project_id, binding_name:"DB"})` is callable and returns bounded user-table identifiers plus omission metadata, with no pagination parameter. The retained actual-Forma result contains no exposed migration table. Its zero omission counters do not certify that the backend enumerated every schema table.
- `sites_read_database_table_rows({project_id,binding_name,table_name,limit:25,offset:0})` is callable only with exact names from overview. Continuation must use returned `model_projection.next_offset`; it cannot be calculated. No valid migration-table input is currently available. Even filename rows alone would not identify v550's admitted SQL bytes. No call to a guessed internal table is proposed.

Full current schemas are preserved in [native-contracts.json](native-contracts.json). No suitable archive export, applied-history export, or migration dry-run operation is exposed. The Sites service itself remains available.

## Smallest useful platform evidence request

Request **a read-only, version-bound migration provenance export**, restricted to:

- Project `appgprj_6a7a020e334881919ed8aea0363cb98f`; DB logical binding `DB`.
- Saved version `appgprj_6a7a020e334881919ed8aea0363cb98f~appgver_e2949878bb5c81919d4845ec5e3cb3f8`; source `c28af5fea0fc3ec2b37b878a544ec59c52a64daf`; deployment `appgdep_6ab573499a108191a2691a137672b93e`.
- Admitted archive `sha256:a629abf35cdb357f0affa0c309ebfc0591cfe235249404c97b7ce19ee813be7f`, opaque file `file_00000000fd6c8208a3030e5382cc45d2` as an evidence identifier only.
- Complete admitted migration path/byte-hash manifest, including journal/metadata hashes, linked by the platform to that exact archive. Bounded to 256 entries and 256 KiB; explicit completeness/truncation flags.
- Applied success/identity records for the candidate's exact 41 migration names (from R15 artifact manifest), and supported runner documentation identifying the replay/skip key and behavior for the identical admitted files. No user-table rows, SQL execution, schema modification or full source export.

This is the **required input/output capability**, not a fabricated existing tool name. If a supported archive-only export plus documented migration-before-upload/unchanged-skip contract suffices to prove the exact 41 already processed, do not additionally request history rows. If the platform instead exposes separate operations, enumerate their actual contracts and revise the count before seeking approval. Native names-only records without byte/source provenance are insufficient; no self-authored attestation will stand in for platform evidence.

## Exact conditional allowance amendment

Proposed, **not accepted or dispatched**: add a separate prerequisite-read allowance of **at most 1 new normal reservation, 0 recovery, 0 retries**, only if a supported single read meets the restricted export above and its actual tool schema is reviewed before dispatch. This is not a blank reservation for arbitrary platform work. If the capability is still unavailable, dispatch zero. If more calls or a browser/settings flow is necessary, return the exact supported plan and count for review first; do not borrow from another phase.

Stage A stays 7 charged / 1 unused / cap8. Stage B stays unapproved at20 normal+6 recovery; Stage C stays unapproved at15+12. If the one-read amendment and all later stages were independently accepted, total actual-Forma maxima would become **8+1+26+27=62**, with separate ceilings and no slot transfers. Private R14 remains60/71, normalStop59 exhausted. Prior unknown internal/authentication HTTP and late-entry disclosures remain; these are operator reservations, not a verified total-HTTP or monetary bound.

Persist and read back the reservation before its native dispatch. Charge uncertain outcomes. Stop on refusal, mismatched project/version/source/archive, incomplete/truncated output, unexpected user data/secrets, undefined skip semantics, missing/changed migration, or required additional authentication/calls. Do not repeat the read, deploy to discover DDL, or mutate on a discrepancy. Compare exact filenames/hashes offline; preserve raw permitted provenance and exact differences. The unresolved gap stays open if evidence is insufficient.

The later exact read approval must explicitly accept its unknown-price read exposure and retaining the returned migration metadata/receipts in P5's restricted local evidence and Git history, owner westbrook.johnson@reve.art, indefinitely until separately reviewed deletion; no automatic removal. These are proposed terms for this actual-Forma read, **not an extension of accepted private rehearsal retention by the agent**. No production source/version or application state is created by the read. No unrelated user data, financial/provider data, secret values or complete source archive is requested.

The read must finish before **2026-10-01T00:00Z** with no renewal. It does not authorize Stage B, Stage C or a paid comparison. Once the actual supported capability is present, use its exact returned contract to present this narrow decision; until then the next action is to obtain that capability description/evidence, not to ask for broad publication authority.
