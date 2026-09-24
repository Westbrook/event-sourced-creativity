# Frozen synthetic qualification inputs

This packet is preparation evidence, not a search-quality or fidelity result. It uses no private production data and made no provider calls. It was authored by the task `/root/qualification_fixtures` against source `c28af5fea0fc3ec2b37b878a544ec59c52a64daf`, then frozen at `2026-09-24T20:00:34.137Z` before any model evaluation. The producer receipt is `fixtures/still-hosted-qualification/producer-freeze.json`.

The corpus contains 22 Projects, 22 Documents and 40 Ideas in two explicit custody boundaries. Twenty-one Projects are open to the synthetic search principal. One closed Project contains a denied source; a separate withdrawn source remains present as a negative access fixture. Every identity carries its canonical Project, exact JSON partition key and custody. This is a canonical content manifest, not an already-indexed search fixture: it has no completed index rows, vectors, relevance scores or model outputs. Installation must create canonical content through the qualification environment's supported ingestion path and separately configure the declared synthetic authority. A field named `eligible` is a fixture expectation, not an authorization mechanism.

There are 60 unique held-out search inputs and six separate development inputs. The author designed 40 intended-positive and 20 intended-negative queries; fresh independent review of v2 must confirm the balance and adjudicate ambiguity before the relevance packet can qualify. Cases cover semantic paraphrase, cross-language retrieval, long bodies, specific Document constituents, whole Documents, duplicate titles, later Projects, denied Projects, withdrawn sources and incompatible constraints. Cohort tags describe test intent, not observed retrieval results. No classification or intended answer appears in `heldout-inputs.json`; `allowedIds` and permitted partitions describe fixture access, not relevance. The independent reviewer must check those access lists against the corpus as well as produce labels.

The 32 frozen organizer inputs cover missing body/type, exact or unavailable references, constituent selection, faithful extraction and rewording, splits, merges, removal, accepted corrections, unaffected approvals, confirmed passage replacement, nonexclusive Formats, continuous text, same-Project reuse, cross-Project scope, multilingual constraints, discarded-operation recovery and review order. Each includes input and prior state, with no model output. Human review must inspect invention, omissions and changed constraints. The deterministic validator checks corpus consistency and selected passage offsets; it cannot adjudicate fidelity or replace the required real screen-reader journeys.

| Frozen input | SHA-256 |
| --- | --- |
| corpus.json | `03499f77f4fec632c39adc7a13112ed357c6ec33dbd002b6ba5dcc0a5747e231` |
| heldout-inputs.json | `efa1a425d4918d91572438ccee9e5a76aed4ac42951d9d25c0c285d9e59f7544` |
| tuning-inputs.json | `27427351f02fc7430d4d690489b0e58d865483e8b127c118a12a80916e567a9b` |
| organizer-inputs.json | `0c11e5cf7fc1ccfa4439f2201e43fed60ab772118c5ed87c1132652b03e3fc68` |

From the repository root, validate with:

```sh
node fixtures/still-hosted-qualification/validate-inputs.mjs
```

The deterministic authoring script reproduces those input bytes. Do not regenerate or edit a frozen input in place after evaluation begins. Any material correction creates a new fixture version and freeze receipt; retain this version and any failures. Running a model or tuning against held-out inputs consumes them: mark that fact and replace the held-out set before final qualification. Repeated timing samples do not add unique relevance cases.

For an independent label review, provide only `corpus.json`, `heldout-inputs.json` and `producer-freeze.json`. Do not provide authoring-script grouping, tuning inputs, a proposed answer key, or model outputs. The reviewer must record their actual identity/task, exact input hashes, review time, all positive/no-match labels, intended identities and partitions, forbidden identities, and every ambiguity resolution. A distinct agent review is independently authored synthetic labeling; it is not human fidelity adjudication. The scorer's manifest and provenance receipt must bind the resulting label bytes to these frozen input bytes. A claim of independence in prose is insufficient.

Current producer handoff: input validation passes; no producer-authored answer key was supplied to a reviewer; independent reviewer receipt and human organizer adjudication remain external to this producer receipt. Hosted fidelity, relevance, performance, lifecycle and retention remain unverified by this packet.

The initial v1 review found six positive query ambiguities caused by unsupported descriptive details. Before any model or search run, v2 minimally revised cases 001, 012, 013, 021, 023 and 024 to remove those details. The same source corpus content, authority boundaries and 32 organizer inputs remain; only fixture-version metadata changes their hashes. All v1 inputs, original review and freeze receipts remain under `history/v1`. This is pre-evaluation label adjudication, not tuning against model results. The v2 label status must be determined by a fresh independent review, not inferred from the author's revisions.

The v1 annotation check also found that case020 shares “the” and “and” with English filler in its long body. V2 removes its inaccurate zero-overlap tag while retaining multilingual/long-source coverage; case021 still has zero lexical overlap under the current Worker tokenizer. The original annotation evidence remains in `history/v1/cohort-annotation-erratum.json`.
