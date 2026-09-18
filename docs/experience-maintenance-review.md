# Experience maintenance review

The current maintenance mode is proposal-only with source review and CI. The offline reviewer makes a person- or LLM-written presentation change inspectable against the exact current mini-app release. It cannot register an output, change provider settings, grant authority, modify saved work, call a model, spend, or publish.

Run from the repository root with Node 24 or a compatible TypeScript-stripping runtime:

```sh
node --experimental-strip-types scripts/experience-review.mjs describe image
node --experimental-strip-types scripts/experience-review.mjs review proposal.json
```

`describe` prints the current definition, exact release hash, labeled decision identities, supported operation and a proposal template. Copy the template into a local JSON file, replace the evidence reference, and change the complete ordered list of existing decision IDs. The template preserves the current order and is deliberately a no-op until edited. References are bounded inert labels: the tool neither fetches them nor establishes that their evidence is authorized or correct.

The proposal has exactly these fields:

```json
{
  "schemaVersion": 1,
  "experienceId": "image",
  "baseReleaseHash": "Use the exact hash from describe",
  "evidenceRefs": ["review:permitted-observation"],
  "changes": {
    "decisionOrder": ["subject", "ratio", "lighting", "composition"]
  }
}
```

The example hash is intentionally incomplete. Stale hashes, unknown outputs, missing or duplicate decision IDs, extra fields, non-JSON values and oversized input fail closed. Scene name/goal pairs must remain adjacent and in order because the current view groups them in participant fieldsets. Layout changes are refused: the current renderer does not consume the layout selector, even though the compiler recognizes its values. Successful review prints the actual semantic diff, original and candidate definitions, compiled candidate, unchanged dependency hashes, and the remaining review requirements. No-op proposals are rejected. A candidate increments its definition revision but remains an unregistered proposal.

Decision order can change the meaning or usability of a flow even when its fields and defaults remain identical. Every ordering candidate needs dependency and essential-interaction review. A successful check means only that the bounded configuration compiled and preserved its catalog dependencies; it is not an approval, a browser test result, or evidence that the candidate is safe to publish.

For an actual change, keep the proposal and review output with its source diff in version control. Independently review the evidence and candidate, render the affected candidate using the normal UI, run the relevant CI and retained-draft/original-job compatibility checks, then hand the exact change to the deployment owner. Re-run review against the current base after concurrent source changes. Publication and rollback remain separate owner-controlled operations; this CLI has no activation command. Preserve original drafts, Documents, outputs, grants and receipts through either operation.

New output families, layout support, creative defaults, context bindings, copy, models/APIs, pricing, source transfer, artifact formats, policy and recovery implementations require a separate qualified source change. They cannot be smuggled through this presentation proposal. Unknown types remain unavailable. This tool does not detect provider drift, prove old-adapter recovery after a schema/rate change, run a live LLM, collect private telemetry, or implement automatic canaries. Durable all-output v2 adoption and the separate server-owned generation architecture remain deferred work.
