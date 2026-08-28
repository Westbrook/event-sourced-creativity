# Output requirements

An Output context block describes work the Document owes. Its wording and structured requirements remain separate from the source facts used to create that work. Saving a block or confirming its delivery plan is free and never starts generation.

Create and edit Output blocks in a Document. Each block can contain several delivery groups, format variants, or explicitly enumerated series members. The Document shows the complete delivery plan; project cards and Deliver show the same scoped progress. Library supports inspection and safe copying of existing Output blocks. Standalone Library and context-package authoring of Output requirements are not supported.

The social-image example defines five geometries, not five physical files or a carousel length. The social-video example defines three required geometries and an optional square variant that starts off. The executive-summary example requests a slideshow, a podcast, and a finite video series together. One slideshow containing 5–15 slides is one deliverable. The video series needs agreed membership and coverage; Forma does not infer a production pipeline between the media.

## From wording to an agreed plan

The editor preserves the original wording, interpreted structure, authored decisions, and planning suggestions separately. Changing wording does not discard manually resolved members or quantities. Compatible optional commitments also carry into the next plan preview, including commitments previously made through a target filter. Unrelated optional work remains off. The affected interpretation must be reviewed before it becomes executable. Unsupported schemas remain preserved and unavailable for execution.

A suggested aim is not an acceptance rule. A deck with an accepted range of 5–15 slides and an aim of 8 can accept 9. An exact-8 policy cannot. A paid result never changes the rule used to judge itself. The planning view displays the effective rule, including a rule qualified by its unit, separately from the attempt aim.

Concurrent edits use captured revisions. Newer saved choices replace an untouched local preview. If local choices have changed, the interface preserves them and shows the previous, latest, and local decisions. Reapplying local choices requires an acknowledgment tied to the exact comparison. A conflict does not silently retry against a newer revision.

Optional work is off until selected. Selecting only some targets for a run does not remove required work from the assignment. Withdrawing previously agreed work requires a reason and leaves an amendment record. Existing authorizations, attempts, costs, and acceptances remain historical records.

A confirmed plan can also contain a target filter that limits eligibility for generation checks. Work excluded by that filter remains owed. In plan review, an explicit action can include all required and already selected optional targets in the local preview. It preserves optional commitments made through the old target list, leaves other optional work off, and preserves count decisions and amendment text. The before-and-after selection is visible; a separate confirmation saves the change. Resetting the filter never confirms a plan, obtains a cost offer, changes an existing grant, or starts work.

For a large eligible plan, **Clear selection for this check** clears only the local selection used by the next availability and cost check. It retires an existing offer and its acknowledgment without changing the delivery plan, optional commitments, or authorizations. The user can then choose a smaller set; Forma does not silently choose the first 256 targets.

The amendment reason is included in the JSON and CSV manifests in every exported delivery part. JSON preserves the authored text exactly; CSV quotes cells and adds a safety prefix where needed to prevent spreadsheet formulas, without dropping the reason. Authors should enter only text suitable for those recipients; the planning form discloses that destination before confirmation.

Reason validation runs before saving or confirming, using the same policy as export: at most 2,000 UTF-16 code units, with tabs and line breaks allowed, but other control and format characters rejected. Invalid local text remains available for correction; it is not silently stripped. An invalid reason already in retained history blocks package export with an explicit explanation. A new confirmation does not repair or omit that ancestor. Exact files, approvals, counts, and source checks remain separate from package availability.

## Creation, checking, and acceptance

The paid flow has separate steps: check availability and cost, acknowledge the disclosed provider and source transfer, authorize the bounded work, then start it. Authorization is bound to the current Document, plan, actor, terms, deadline, call allowance, and spending limit. Repairs consume the same disclosed allowance. Unknown provider acceptance or cost blocks an automatic replacement attempt. An alternative needs its own explicit preflight and authorization.

A cost offer also belongs to the exact confirmed plan, source, requirements, target contracts, and selected attempt. An older response cannot restore an offer after those decisions change. The scoped GET performed after a successful cost check does not discard that pending offer when it returns the same verified contract. A later refresh can retire a displayed offer and require a new check; paid actions always require current ready data. Missing target-contract information blocks the check with an explanation instead of treating it as an empty selection.

Displayed call allowances and recorded call counts refer to generation calls, including direction planning and bounded repairs. Manual Slides allows an initial generation call and at most one repair. A native image attempt allows one direction call and one image call, plus at most one separate text safety request to OpenAI before image creation. That safety request sends the exact final image prompt after authorization and Start; it is not a generation-ledger row or permission for another image attempt. The full request-budget meter still counts it. OpenAI lists `omni-moderation-latest` as free in its [model documentation](https://developers.openai.com/api/docs/models/omni-moderation-latest), checked on 27 August 2026. This is a current pricing fact, not a guarantee about future pricing or the billing of the generation operation. The safety check is not evidence that the resulting image is useful or acceptable.

Start records the queued work; the existing job driver executes one job per request. It does not run a whole selected batch inside the authorization request. Only authorized or queued operations offer Start. Failed, completed, or uncertain attempts remain recorded and cannot be revived through that control.

A native attempt has one four-minute execution window, including its initial request and any allowed repair, or image planning and rendering. This deadline is separate from the authorization expiry and spending limit. A timeout does not cancel a provider request already sent or establish a refund. Unknown acceptance or cost keeps its reservation held, and no replacement starts automatically.

Native creation supports manual Slides and supported OpenAI image configurations. A route is available only when its actual settings and cost can be bounded. Unavailable geometries or media remain owed; they do not silently become a different format. Audio, video, and other unsupported native requests can be fulfilled by adopting an owned finished file in a supported format.

Native image requests that require sending reference pixels are currently unavailable because that input cost is not bounded by this route. A description-only reference is a different instruction. Forma does not silently omit requested pixels to make a request fit; an owned image remains an alternative fulfillment path.

Completed generation is not fulfillment. A completed native result or an uploaded file must be matched to an exact target, inspected, reviewed for useful content and source coverage, and accepted by a currently authorized reviewer. Where independent review is required, creators and contributors cannot approve their own result. Reusing an earlier acceptance is an explicit inclusion decision with current server checks, not a new approval.

File inspection is structural. It does not prove that an image is useful, a podcast sounds right, a video plays well, the content follows its sources, accessibility is adequate, or usage rights are current. The review interface states those separate duties. A download for review is not evidence of acceptance.

Source verification has explicit pilot capacity limits: four distinct imported storage objects for owned-file operations and reads, and one for native generation. These are limits on source evidence checks, not on context blocks, outputs, or references to the same file. Repeated references share an exact-object check, while each reference's identity and rights must still agree. The interface shows counts, applicable limits, and available source names. A Document with two through four distinct imported files can still use the owned-file route when its checks pass, but cannot use native generation under this pilot limit.

Exceeding a limit never truncates the corpus or hides owed work. The affected route remains unavailable and delivery readiness is unknown if the required source evidence cannot be verified. Saving wording or confirming structure remains free and explicitly unverified; it does not make the sources usable. A shortened source-name list is labeled incomplete rather than presented as the complete inventory. These bounded checks do not establish support for arbitrary corpus sizes.

Governed sources have separate verification limits: at most two database capture batches and a bounded complete proof. A batch is not a package or a nesting level. Direct institutional and licensed packages can fit, including several packages sharing an origin; their complete history and current authority must also fit. More complex chains or oversized evidence remain unsupported for the affected action. Owned uploads, matching, review, and downloads do not bypass these checks.

The interface distinguishes capture capacity, proof size, imported-file capacity, and unavailable rights or evidence. It preserves the complete assignment and known spending, names accessible source blocks where possible, and offers inspection or administrator escalation. Refresh only rechecks the state. Removing origin records or silently flattening a licensed source is not a remedy. Free Save/Confirm can preserve structure when a governance capacity limit is reached, but cannot bypass missing or erased private Document evidence.

## Delivery and history

Progress counts the entire confirmed plan, including required work outside the next run, unresolved groups, and selected optional work. Unknown or partially loaded status is not zero remaining. An accepted file can become stale when its source or requirement changes; the initial implementation conservatively rechecks the whole Document rather than claiming that unrelated source changes are harmless.

Export pins exact accepted bytes, the current plan, and its verified amendment history. The ZIP contains files plus JSON and CSV manifests recording required, missing, unresolved, and optional-off work. A partial package says it is partial. Completion after a withdrawal is labeled complete for the amended scope; withdrawn work is never reported as fulfilled. Unverified history cannot produce an unqualified completion claim.

Large deliveries use numbered ZIP parts. Every part carries the whole assignment manifest and the same delivery identity. One part does not claim to contain every file. There is no automatic publication to social platforms.

| Boundary | Current limit or behavior |
| --- | --- |
| Authored labels | 240 characters; original wording remains separate and preserved |
| Derived target labels | 245 characters including a finite ordinal |
| Finite plan | At most 1,000 targets; oversized or unresolved obligations stay visible and block confirmation as appropriate |
| Availability and cost check | At most 256 distinct targets already selected in the confirmed plan per check; a smaller run selection never removes work from the full assignment |
| Portable inventory | At most 1,024 rows in each inventory category; capacity errors do not truncate the assignment |
| Owned file | At most 24,000,000 bytes |
| Supported inspection | Bounded PNG, baseline JPEG, PCM WAV, contiguous MP3, supported AVC MP4, and macro-free PPTX |
| ZIP part | At most 32 MiB; runtime partitions default to at most 16 files per part |
| Whole-package metadata | At most 4 MiB for JSON and CSV together; explicit failure if the complete inventory cannot fit |
| Scope history | At most 128 confirmed plan revisions, 64 amendments, and 4,096 withdrawn rows across the history; incomplete ancestry cannot support unqualified completion of the original scope |
| Native manual Slides | 1–15 slides with the confirmed exact or bounded count policy |
| Native request counts | Slides: at most 2 generation calls, including repair. Image: at most 2 generation calls plus 1 separate OpenAI text safety request; generation receipts do not count all network traffic |
| Distinct imported source objects | 4 for owned-file operations and reads; 1 for native generation; all reference claims still checked |
| Governed-source capture | At most 2 capture batches for native and owned-file paths; not a package-count or nesting-depth allowance |
| Retained governance proof | At most 2,000,000 encoded bytes in total; individual SQL JSON results stay below that limit with space reserved for the result record |
| Native attempt lifetime | 240 seconds for the entire attempt, with at most three 60-second lease renewals; no automatic replacement after uncertainty |

## Authority and operations

Immutable private events are the history. Scoped relational indexes are rebuildable projections. Execution grants, operation slots, provider-call receipts, spending exposure, and storage-custody receipts are separate durable operational records. Project and actor scope, current rights, source identity, retained private bodies, and transaction-time authorization are checked at consequential boundaries. A replayed command returns its recorded outcome; it cannot create a second paid operation.

Current-source checks include frozen reference identity and licensed package content identity. Copying a requirement creates new identities without copying acceptance, billing authority, or execution history. Generic editing and package paths cannot bypass the Output contract. Private-cache scope changes and revoked access discard cached private data.

Institutional sources are checked against the organization's retained records. Licensed sources also retain their live origin checks. When source and target share an owner, continuing Output work requires proof that intervening history did not alter the licensed origin. Known target activity may be proven from its exact custody and retained history; unknown, mis-scoped, compensated, or erased evidence cannot be waved through. Source inspection does not repair, reactivate, or advance a different project's projection merely to make a check pass.

Storage cleanup retains uncertain writes and unresolved financial exposure for reconciliation. A lost acknowledgment is not proof that a write failed. Published files and their receipts cannot be deleted merely because an upload response was lost. Cleanup must remain bounded and must not let one uncertain object starve all later objects.

For a terminal native job, **Check saved receipt** checks only evidence Forma has already stored. It does not contact a provider, run the job driver, create another authorization, or accept an output. A known receipt can settle recorded cost without reviving the failed job or its private inputs. Missing evidence leaves the exposure held. Current actor and workspace authority are still required, but expired source rights do not prevent an authorized user from investigating the financial record. A technical receipt contains identifiers and accounting without source text or generation inputs. Copying it sends nothing; the user can give it to an authorized Forma operator or workspace administrator. There is no self-service override that treats an unknown charge as zero.

The local request meter uses a conservative aggregate budget of 50 database, storage, and provider binding calls. This is an implementation test boundary, not a universal Cloudflare account limit. D1 statement, query, value, and row limits remain separate; actual deployment must qualify its account tier and CPU/memory behavior.

This implementation does not migrate or deploy a production database. The isolated implementation's tests use synthetic providers and scoped storage fixtures; they do not qualify live provider behavior, native-speaker translations, human usability, media playback across devices, or assistive technology. Actual native mouse/keyboard activation of the paid controls remains a separate release check; supplied event records in unit tests are not native input evidence. The accompanying implementation review record identifies the exact checkpoint tested and any remaining release gates.

The regression suite also needs a Python interpreter whose standard `sqlite3` module supports `Connection.setlimit` and SQLite JSON functions. The SQL capacity tests use it to enforce narrower statement and value limits against actual SQLite; they do not silently skip those checks. They use `python3` by default, or the interpreter selected by `PYTHON`. The included video test fixtures contain their encoded bytes and do not require ffmpeg at test time.
