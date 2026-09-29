# Private history boundaries — 2026-09-21

## Implemented

Native block, relation, approved-copy footprint and authored-profile history reads now join private event bodies only when their owner, project and document match the independently authorized source. Metadata for a mismatched event remains visible to the validator so it cannot silently fall back to an older version; foreign prose never enters the returned database rows. Library bodies with no document cannot be read under a Document enrollment. The native duplicate-folder footprint retains its narrowly checked collection-event exception.

Inspection references now use the same candidate denominator as the block-history reader. A successful inspection therefore cannot produce a negative unresolved count. New aggregate block coverage uses version2; retained version1 manifests replay their original contract rather than silently changing their hash or losing valid history. This does not treat inspection as authorship, intent, or a new copy.

## Verification

- 22 focused privacy/copy/retained-version checks pass. The privacy checks inspect actual database return values before application decoding, across four source readers and owner/project/document/Library mismatches.
- 126 native history/profile/recall/duplicate regression checks pass.
- 54 resource binding, relation budget, mixed-producer and block-inspection checks pass, including isolated local D1.
- TypeScript and changed Worker lint pass. All data and provider transports are synthetic.

The frozen full regression at886305ca is separate and excludes these changes. No production migration, deployment, provider purchase or real-user enrollment occurred. Distinct Library/Canvas enrollment and all other open native work remain assigned in the [completion matrix](forma-memory-completion-matrix-2026-09-20.md).
