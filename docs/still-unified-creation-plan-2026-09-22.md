# Still unified creation: implementation specification

2026-09-23 · Specification v20 · Ready to implement · Architecture audit baseline: 68b5f0ab

This specification consolidates the original request and subsequent decisions. It supersedes v19 by adding the user-approved contextual help contract in §2, its Package C work and §17 acceptance criteria; other product contracts are unchanged. Earlier discussion and the rejected sectioned-input mock are historical. User-decided behavior is binding. Concrete engineering defaults below resolve remaining details under the user's request to make the plan implementable; they are not claims about existing functionality or measured model performance.

The feature organizes supplied content into Still's Projects, Documents and reusable Ideas. It never invents creative content. Faithful rewording, source-grounded titles, classification, grouping, references and explicit user corrections are allowed. All transformed content is reviewable before final save. Existing search suggestions are not source material until explicitly selected.

## 1. Scope and outcomes

The release includes the three shared creation forms, live scoped rediscovery, rich inline references and slash markers, faithful interpretation, contextual review, correction operations, recovery and one atomic save. It also includes persistent Format preferences and the minimal downstream output integration needed to make them useful.

The six product outcomes are: fast and forgiving capture; efficient batch creation; visible value from independently reusable pieces; easy reuse; useful organization of messy input; and rediscovery of forgotten work. More extracted records is not a success metric.

Memory/trajectory suggestions, generation during creation, cross-project adoption, a general chat interface, and wholesale redesign of Research/Search/Use in… are outside this release. Reusable search, reference and proposal services are designed now so those surfaces can adopt them later.

Ready to implement describes the specification. It does not mean the feature is built, deployment is authorized, or model quality/latency has been proven.

## 2. Shared entry and scope

Every form has **Explain your new project/document/idea**, one rich free-text editor, **Save**, and **Back**. Keep the current Project breadcrumb where applicable. Helper: “Start with a name or describe what you have in mind.” Enter inserts text/newlines; mention selection and IME composition never submit. Use a documented explicit save shortcut.

No named Document sections, cards, hierarchy builder or mandatory type field appear in the initial writing surface. Structure appears in review. Empty input produces one local error with editor focus, not duplicate toast/detail messages.

| Entry | Discovery | Permitted creation and uses |
| --- | --- | --- |
| New Project | Projects, Documents and Ideas accessible in the current account; Open only | Exactly one new Project; zero or more Documents and project-owned Ideas |
| New Document | Documents and Ideas in the current Project | Initially one or more proposed Documents, plus Ideas and reviewed uses; explicit removal of every proposed Document may leave project Ideas only |
| New Idea | Ideas in the current Project | New Ideas and/or uses of existing Ideas; when entered from a Document, review attachments to that existing Document without creating another container |

Discovery covers readable personal and shared Projects exposed by the current account's access model. Implement a dedicated aggregate read endpoint with per-Project authorization; the current selected-context API is not an account-wide search API. Keep custody/provider policy partitions intact. In a selected shared Project, Document/Idea discovery remains inside that Project. Retain existing capability rules for creating a new Project; this feature does not grant a new shared-context project-creation capability.

No adoption crosses Project boundaries: no copies, live references, partial extraction, pasted references or dependency expansion from another Project. Account-wide New Project results can only Open. Open preserves the latest acknowledged draft and never retargets Save.

Every Idea belongs to a Project; Documents use Ideas. Existing Projects/Documents are read-only destinations in creation review, not new objects to recreate or rename. New Project's root is required: removing it means leaving/discarding the creation draft, not saving unowned children.

**Contextual guidance — user-approved addition in v20.** Place a visible **How this works** text button beside the introductory description on all three entry pages. Prefer this contextual placement to a toolbar-only icon; do not call it Instructions or make help a required step. Retain access while reviewing through the shared workflow introduction, without disturbing the current review card. The initial writing surface remains continuous free text.

Keep the essential promise outside the dialog. Suggested copy: “Start with a name or describe what you have in mind. Still organizes your description into reusable pieces. Review its suggestions before creating them.” Keep the current-action helper from §3 visible: a clear Project/Document title saves an empty container immediately; a title-only Idea needs completion in review. Do not make a blanket promise that every Save opens review or that nothing is stored before approval. Draft status must distinguish **Draft saved** from the creation of Project/Document/Idea records.

Open an opt-in dialog titled **From your description to organized content**. Use short, skimmable explanations and one read-only example of input alongside a possible reviewed organization. Derive an entry-appropriate excerpt from the user's White Album example in §15: Project may show its title and first Document scene, Document may show that scene, and Idea may show its action/participants without out-of-scope container markers. On narrow screens, stack the input and result. Examples demonstrate interpretation rather than promise exact extraction counts. Explain why reusable Ideas help: a detail can be reused or changed independently while its relationships remain in the Document. The help introduces the workflow; it is not a full command glossary or an automatically opened tutorial.

| Dialog topic | Required explanation |
| --- | --- |
| Write naturally | Names, sentences and rough notes work; @ and / are optional. Still organizes supplied meaning into Projects, Documents and Ideas, may faithfully reword and suggest supported types, and never invents missing details. Titles/body/type can be corrected in review. |
| Identify content with @ | A new declaration names content to organize separately; surrounding input or review supplies its body/type. Selecting an eligible existing item binds that identity. Typing a matching name alone does not silently link it. Describe the current entry's scope below. |
| Clarify intent with / | Structural markers guide grouping. Output markers such as /image, /video and /3D model become visible Format preferences. They do not execute tools, generate outputs, or prevent other supported Output choices. Show only structural markers valid for this entry. |
| Understand Save and review | A Project/Document name alone creates an empty container; a title-only Idea remains incomplete. Descriptive input proposes organization for Ideas → Documents → Project review, skipping absent levels. Users can edit, merge or remove; every retained item must be complete, seen and approved before one final creation save. Private draft autosave preserves work separately and does not itself create these records. |

Use entry-specific wording in both helper and dialog:

| Entry | @ and discovery explanation |
| --- | --- |
| New Project | @ names new Documents/Ideas to organize; it cannot adopt existing content from another Project. Account-wide suggestions can Open existing work and preserve this draft. |
| New Document | @ can name new content or select eligible Documents/Ideas in this Project. Choosing a Document opens constituent-Idea selection; it is not automatic inclusion of every member or later addition. |
| New Idea | @ can name new Ideas or select eligible Ideas in this Project; do not advertise selecting Documents or creating new containers. |

Where reuse is available, briefly explain that suggestions are not included automatically, **Open** and **Use in this draft** are distinct, and full reuse shares the existing Idea while **Use only this part** creates an independent reviewed piece. Do not imply cross-Project reuse. Keep detailed reference effects in the existing Use preview rather than expanding the help into another approval flow.

The dialog is an informational UI action using the established accessible dialog component. Its trigger is a non-submit button; opening/closing never submits, interprets, creates content, changes approvals, or injects the example into the draft. Normal autosave may continue. Preserve editor content, selection/undo history and review position. Give the dialog an accessible name, appropriate initial focus, contained keyboard focus, an inert background, a visible Close control and Escape dismissal; return focus to its trigger on close. Save shortcuts must not submit the underlying workflow while help has focus. Support scrolling, mobile layout and localization. Reading help never satisfies proposal presentation/approval requirements. Availability does not depend on Jev or any provider call.

## 3. Save classification and completeness

| Input | Result |
| --- | --- |
| Clearly only a Project/Document title | Save the exact title as an empty container; no organizational model call required; use the retained/idempotent write path |
| Clearly only an Idea title | Open one-item review with the actual missing body and type; no saved empty Idea |
| One coherent description | Preserve one Idea unless useful separation is supported; required new containers still appear in review |
| Several separable parts or structural markers | Interpret into a reviewable graph without writing creative records |
| Only an existing reference | New Document may wrap the selected uses; New Idea may propose only an attachment to the current Document; a no-change result offers Open/return instead of inventing a duplicate Idea |

A new Idea requires nonempty semantic body and a supported type at both review and server commit. Titles are editable source-grounded labels. Suggest a supported type from supplied meaning; show it for correction; request a choice when uncertain. Never silently default every Idea to Direction, fabricate a body, or copy a title into an empty body only to pass validation. Short bodies are valid when they actually express the intended content.

Classification is conservative and reversible. Start with a deterministic title candidate check using editor structure and absence of resolved references/commands, lists and descriptive clauses; no fixed word count proves title intent. Show the prospective action in a small stable helper (“Create an empty Document named …” or “Organize this description”) with a correction control. Ambiguous cases enter interpretation/review. The button remains Save. Freeze the submitted revision; background work cannot change its meaning.

Every model-derived title, wording/type change, relationship, new use or multi-record result is reviewed. The exception is unchanged title-only Project/Document creation. No-match search or slow Jev never blocks that path.

On interpretation failure, retain the full draft and offer retry or manual one-Idea completion with explicit title/type and required containers. Do not turn a rich draft into a title-only save or drop text as an outage fallback.

## 4. Free-text sigils and identity

Slash markers guide whole-input interpretation; they do not execute tools or enforce a rigid section grammar.

| Marker | Interpretation |
| --- | --- |
| /project, /document, /idea | Strong evidence for intended object kind and grouping; surrounding prose supplies meaning and possibly a title |
| /image, /video, /3D model and supported Output aliases | A preference for expressing the associated content through that Output, represented by a visible Format Idea |
| Resolved @ reference | Exact chosen identity, not a probabilistic name match |
| New @ declaration | Named proposed content whose body/type/grouping is extracted or completed in review |

Offer only markers compatible with entry scope. An out-of-scope marker receives an actionable explanation; it cannot create an unauthorized Project/Document. Multiple /project roots in New Project require correction within its single-root contract.

Menu selection creates a lightweight inline token. Recognize directly typed known slash commands at token boundaries, using longest-match aliases and a custom matcher for multiword commands such as /3D model. URLs, file paths, escaped sigils and unknown commands remain text. Preserve the exact White Album input without requiring menu selection or a newline per Document.

Raw @Name becomes an unresolved mention candidate. Picker selection or explicit resolution during review supplies the existing/new identity. Emails and escaped @ stay literal. New Project offers only new declarations; New Document offers eligible Documents/Ideas in its Project, while New Idea offers only eligible Ideas. Each also offers compatible explicit new declarations. If no match is selected, interpretation can propose a new declaration or ask for resolution; a same-name existing item is never silently bound.

Each occurrence has an occurrence ID; repeated occurrences can target one temporary or canonical entity ID. Equal spelling alone is not identity. Pasted canonical targets require fresh authorization and same-Project checks. Temporary targets from another draft become new local candidates, not accidental cross-draft links.

A marker may describe preceding prose: the /image after the first White Album scene belongs to that scene. Use language and marker position together; show consequential uncertainty in review. Do not attach a loose preference to every Document without evidence.

## 5. Rediscovery and replacement

Return **up to three** useful candidates under “You may already have this,” with kind, location and a brief source-grounded relevance reason. Zero good matches is valid. Rank likely intended identity, not mere word overlap. Specific parts rank above their containing Document when the input describes those parts; whole-Document intent can favor the Document. No mandatory parent slot or displayed uncalibrated probability.

**Open** navigates without modifying the new draft. **Use in this draft** is a separate eligible same-Project action. Neither implicitly changes destination.

A selected Document opens constituent-Idea selection. Record the chosen Idea root IDs and disclose their effective dependencies. Later addition of Soundtrack to the source Document does not add it to the new Document. Direct Idea matches bypass the Document picker.

The selected root list is fixed, not a subscription to source-Document membership. Fully reused Ideas retain existing shared identity: later authorized edits to their bodies and authored dependencies follow normal Still sharing behavior. Independent partial reuse/variation is available when that is unwanted. Do not promise frozen transitive content.

For each suggested replacement, show the exact draft passage, included source content/dependencies, and the proposed resulting text. Preserve all uncovered details and qualifications. One passage may become several explicitly selected references in one review. Repeated occurrences are independently selectable. Overlapping replacements or contradictions need resolution; no global replacement merely because names match.

| Use choice | Behavior |
| --- | --- |
| Existing individually reusable Idea fits | Prefer direct reuse of that existing identity |
| Use only this part | Initial path for a partial match inside a larger Idea; select/review the faithful subset as a new independent Idea, leaving the source unchanged |
| Use this Idea | Explicit alternative including the full disclosed existing Idea and its shared dependencies |

Partial reuse is an escape hatch, not the preferred substitute for well-organized reusable Ideas. New partials keep source ID/revision/excerpt in protected provenance, not an inclusion edge back to the original. A provenance edge must never accidentally re-include the full source. Excerpts retain necessary qualifications; missing context is exposed instead of invented.

Add a public En Reve revision-bound range/decorations API: structured/text range, expected content and editor revision; reject stale/cross-token/grapheme-cutting ranges; decorate without moving selection; apply accepted nonoverlapping replacements as one undoable transaction. Current user-selection bookmarks are a foundation, not arbitrary AI-range highlighting. Do not access private editor internals or assign the whole .value/.document for replacement, which resets undo. When no reliable passage exists, offer insertion at a user-chosen location or user-selected text.

## 6. Retrieval implementation contract

Build a reusable scoped search service, not a larger Jev prompt. Existing six-candidate lexical shortlisting and token-hash vectors do not satisfy semantic retrieval.

| Layer | Initial implementation |
| --- | --- |
| Index | D1 manifests, canonical source IDs/revisions, permissions/custody partitions and tombstones; learned-vector adapter for semantic retrieval plus independent lexical index |
| Indexed content | Canonical Ideas once, their uses as location metadata; container titles and grounded descendant passages/summaries; exclude chat, output bodies, telemetry and Memory |
| Candidate generation | Retrieve 20 lexical and 20 semantic candidates independently, union/deduplicate; never lexical-gate the semantic pool |
| Rerank | Hydrate at most 24 authorized candidates; bounded Jev identity/relevance assessment, no-match allowed; return at most three |
| Maintenance | Resumable backfill outside foreground typing; canonical writes/removals invalidate changed Ideas and affected containers; revisioned asynchronous refresh |
| UI scheduling | 400 ms idle debounce initially, IME-safe, one current request per draft, cancellation plus stale-result rejection; freeze ordering during focused/pointed interaction |
| Cache | Principal, Project/custody scope, permission epoch, content/index version, query revision and model version |
| Degraded mode | Honest lexical-only or partial-coverage results; unavailable/incomplete semantic indexing never appears as a definitive “no matches”; Save remains available |

These budgets are configurable starting values, not measured promises. A production learned-vector backend is not currently configured. Its adapter/provisioning is an explicit first implementation work package; do not relabel token hashes or a full event-log scan as semantic search. Index coverage and learned retrieval are release gates. An aggregate account query authorizes each partition and combines bounded results without moving private content across prohibited custody/provider boundaries; partial coverage is disclosed rather than silently narrowing “account-wide.”

Check authority before snippets reach a model, before previews, at Use, and at commit. Delete/withdraw inaccessible results immediately; TTL alone is insufficient. Do not rebuild the current history projection on every keystroke or claim unlimited account size.

## 7. Persistent Idea bodies and dependency semantics

Rich editor tokens must survive saving and later editing. Persist `properties.rich_text_body` as `IdeaBodyV1 = {schemaVersion: 1, document: RichDocument}`, using the public En Reve `RichDocument` shape `{type: "en-rich-text", version: 1, doc: RichNode}`. Capture `editor.document` or the proposed document from its change event; initialize from the stored document. Keep `properties.text` as the derived readable projection. A validated update changes structured body, readable text and semantic dependencies atomically.

An Idea-reference token is a public `TokenRun` with `kind: "token"`, a unique occurrence `id`, `type: "still-idea-reference"`, readable `text`, display `label`, and `data: {schemaVersion: 1, kind: "idea-reference", projectId, blockId}`. Identity comes from validated IDs, never token labels or an asserted Project ID. Draft references may use temporary IDs; commit maps them once. Command/declaration tokens are resolved or removed during reviewed interpretation; saved Idea bodies contain only supported formatting and canonical Idea references.

Add public pure `decodeRichDocument(unknown, limits)` and `richDocumentText(RichDocument)` functions usable in Worker and browser. Enforce the public node/mark schema, safe links, unique occurrence IDs, supported versions, maximum 32 node levels and 10,000 nodes per body, plus the serialized payload bound below; preserve Unicode. Still's additional decoder validates its reference payload and authority. Legacy plain text opens as text runs through public `richDocumentFromRuns`; literal legacy @ text is never upgraded to a resolved reference. Persist the structured form on a successful edit, leaving untouched records unchanged.

Generic Idea references are distinct from action-specific block_references, whose existing roles and owner validation are limited to Action. Extend same-Project authority, cycle validation, dependency traversal, generation snapshots and unavailable-target handling for generic references. Deduplicate inclusion by source/target identity while retaining all occurrence IDs; repeated mentions include a target's context only once. Do not turn every mention into a context_contains composition or combine all scenes into one context group.

Direction of inclusion matters: scene/composition Ideas reference their participants; shared Paul/Jon do not reference their scenes. Otherwise reusing Paul can import unrelated scenes. An ownership statement such as “Paul's instrument” may reference Paul, but neither points back to its scene. Provenance/source attribution is never semantic inclusion.

Still and Forma editors that can modify a structured body must preserve tokens. Upgrade those editing paths or route such records to the token-aware editor; never flatten and overwrite references silently. Unknown body versions stay readable through their text projection but require a compatible editor to modify. Labels are display fallbacks, not authority.

Enforce this at server mutation boundaries too: legacy BlockPropertyEdited/ChipEdited paths must atomically reconcile body, text, dependencies and preferences through the canonical validator, or reject the incompatible edit with an actionable route. Existing unrelated copy/fork operations must remap structured reference IDs along with dependency edges; until compatible, report that limitation and preserve the source instead of writing stale targets. This compatibility work does not permit cross-Project adoption in the creation workflow.

The commit compiler and generation context resolver must use the same effective dependency closure as review, including existing relations/composition membership and new generic references. Hydrate referenced bodies once per identity, retain scene relationships and exact submitted revisions, and keep audit/source text out of provider context.

## 8. Review state and final approval

Default order is **Ideas → Documents → Project**, skipping creation levels absent from the entry point. First show a compact map with tentative titles so each Idea has context. Review unique shared Ideas once, with source passages and all proposed uses; review each Document's actual composition separately; then review the new Project.

New Idea in an existing Document has an attachment review showing that destination, not a fictitious new Document review. Existing containers retain their titles/content. If all proposed Documents are explicitly removed, review the retained project Ideas and resulting project organization.

A complete destination/composition review can present and approve its disclosed uses and dependency manifests together; record the covered use hashes explicitly. Existing reused Ideas need no fake new-Idea card. Changes to their reviewed content or a use still invalidate the affected composition approval.

Each focused card presents the editable title, full body/type for an Idea, source detail, destinations and relationships. A compact outline navigates between cards. Previous/Next wrap within the current stage; Back to Ideas allows corrections. Stage transitions are explicit; navigation does not imply approval. Large bodies need accessible scrolling and a “Continue review” action after their full content is available; a collapsed title/thumbnail is never counted as a seen body.

Track separately per relevant version: **presented**, **approved**, **complete**, and **retained/merged/removed**. Edits invalidate approvals for changed content and affected compositions, not unrelated nodes. Direct edits require review of the resulting version; changes hidden in a dependent item return it to the review queue. An unchanged revisit changes no state.

Every current proposal must be presented once before the final action appears. New versions/new nodes renew that requirement. Removed/merged versions leave the active save set only through the corresponding reviewed operation, never an unlabelled checkbox.

**Final approval contract:** every retained record/use must be complete, presented and approved at its current version before final save. Approval, merge or explicit removal resolves pending items; an unapproved item remains in the recoverable draft and blocks committing that plan. There is no partial save of an approved subset in v1. This specification default resolves the original “Approve selected” wording consistently with the later explicit Remove/Merge decision; it is not a claim of a separate user confirmation.

Keep **Approve** per item and **Approve all** in the review interface. Approve all approves only complete, already presented current versions, reports remaining unseen/incomplete items, and never preapproves later additions. Before final eligibility, offer “Review next unseen” or “Complete missing information” with a count. The final **Approve selected (N)** action remains hidden until every current proposal has been presented; it is enabled only when all retained records/uses are complete and approved at their current versions, reference revisions are current and the graph is valid. “Selected” means the retained, explicitly resolved plan; there is no silent exclusion checkbox. N counts unique new records; show new uses of existing Ideas separately. For a zero-new-record attachment, use **Approve selected use** with its destination instead of a misleading zero count.

No creative records are saved during stage approval. Save one exact reviewed plan. Existing references are reviewed as included content/uses, not counted as newly created Ideas.

## 9. Editing, live split insight and corrections

Editing a shared proposed Idea changes all its proposed uses by default. Show those uses. **Make a separate Idea** creates a new proposed identity for the chosen Document and redirects its local uses. If a shared parent Direction/composition refers to the original, also preview the necessary local parent variation and reference rewrites; changing one ID alone is insufficient. Other Documents keep original identities/content. All changed/new records enter review.

Editing an already saved reference does not silently edit that shared source through this creation transaction. Offer its existing editing workflow separately, or a clearly identified independent variation within this draft. Merge into a saved target similarly produces a reviewed independent merged Idea rather than an early global update.

While editing an Idea, Jev assesses potential useful separation after a 500 ms idle debounce initially. Evaluate independent editing/reuse, relationship preservation and fragmentation; length or multiple names alone do not require splitting. Persist exact typed text before interpretation replaces anything.

Show a quiet **“This could work as more than one Idea”** hint with **See options** and **Keep as one Idea**. No focus move, modal or draft mutation on a live response.

- See options prepares a source-grounded organization preview for the captured revision; it does not apply or approve it.
- Keep as one retains the body and records that choice for this semantic content/context version. Formatting-only edits do not revive the same hint.
- Accepting an organization updates the same review plan; new/changed Ideas and affected compositions return to review. Keep original input recoverable.
- A newly extracted child does not immediately provoke recursive splitting without a material edit or explicit request.
- Cancel superseded requests and always reject stale results, including options prepared against old reference/context versions.
- A slow/failed check allows the user to keep a complete Idea and continue. Lack of a result is not proof of singularity. Late results cannot redirect a user who has moved on.

One unresolved-suggestion summary before Documents offers exploration or keeping remaining Ideas together. Previously kept unchanged suggestions do not reappear. This summary is advisory, not a mandatory successful network call.

## 10. Remove, merge and container removal

Do not describe user-authored content as “declined.” Offer **Remove altogether** or **Merge into another Idea** to correct organization.

**Remove altogether** operates across the current creation draft. Preview every identified use, explicit reference, dependent relationship and semantic mention in Directions/other Ideas, grouped by affected item/Document. Show before/after wording. Trace aliases and pronouns from context; uncertain matches need user resolution, not indiscriminate word deletion.

For Microphone, show both its standalone removal and the change from “Paul and Jon sit with their instruments on either side of a microphone” to a faithful remainder such as “Paul and Jon sit with their instruments.” Expose the removal of microphone-relative positioning. Preserve unaffected content; never invent a substitute object or relation. Unrepairable meaning is flagged for user input.

Record the removal in the working source/decision ledger so later extraction cannot restore it from the original. Keep original input only for review/recovery; Undo or explicit new instruction can restore it. Known residual mentions and unresolved reference/dependency effects block completing the removal. Semantic detection is fallible: present uncertain occurrences and verify against fixtures rather than claiming automated proof of total semantic absence.

Included existing bodies may still contain the removed concept. Resolve those uses through explicit detachment or a reviewed independent variation; do not mutate saved shared records elsewhere. Revalidate effective closure after changes.

**Merge into another Idea** selects a proposed destination and previews the combined body, supported type and redirected uses. Preserve qualifications and distinct facts; expose contradictions/type uncertainty. The source ceases to be a separate proposal only after acceptance. If source and destination have different Document uses, preview the whole effect and use local variations where needed; do not silently spread unrelated destination content. No invented connective material.

**Removing a proposed Document preserves all its Idea proposals**, including approved and unfinished ones, in the Project. Keep each Idea's approval/completeness state and its uses elsewhere. This extends the user's approved preservation rule to unfinished input so it cannot disappear. Removing Idea content still requires the explicit operation above. The same final body/type requirements apply.

## 11. Format preferences and output surfaces

Documents remain adaptable source material for any supported Output. Persist preference markers as visible Format Ideas with body, type=format, subtype=Channel and intent=prefer; use protected preferred_output_kinds containing canonical Output IDs. OutputKind includes image plus supported Document artifact kinds.

Group preferences with the same intended use into one Format Idea by default: “Preferred outputs: Image and 3D model.” Keep separate source preferences when their uses differ. No marker implies dimensions, provider, quantities, generation order, jobs or an exclusive Document type. Output deliverable-obligation Ideas remain a different existing concept.

One preferredDocumentOutputKinds helper reads explicit active positive Format preferences and returns a deduplicated set. Existing single non-image inference is a weak legacy suggestion, not this source of truth. Body and structured preference values are edited/validated together; after free prose edits, reconcile the visible supported preferences before saving rather than silently retaining stale metadata. Genuine contradictory authored constraints stay visible.

| Surface | Required initial behavior |
| --- | --- |
| Creation review and Document | Visible editable Format Idea; compact “Prefers Image, 3D model” summary derived from active preferences |
| Output chooser | Preferred badges/order among available choices; all other supported choices remain available; unavailable preferences are labelled, not erased |
| Explicit generation | The selected Output kind governs that request; preferences never force an image when the user chooses video, and never trigger generation themselves |
| Jev recommendations | Preferences are context for useful suggestions, not a current instruction to generate |
| Results | Existing mixed-output history stays intact; choosing an alternate Output does not edit saved preferences |

Provider context must distinguish a soft medium preference from actual constraints. Preserve unrelated framing/content constraints and surface genuine incompatibility. Raw draft originals, removed wording and provenance excerpts are not generation instructions.

## 12. Draft, plan and review data

Use versioned schemas shared by client/server; deterministic validation owns identity, authority, completeness and commit. Models return structured proposals, never canonical events or authorization.

| Record | Required fields/meaning |
| --- | --- |
| CreationDraft | Draft ID, actor/custody scope, entry kind/destination, revision, original and working editor documents, marker occurrences, acknowledged-save state, reference selections, decision ledger, expiry |
| SourceEvidence | Supplied source span/marker or explicitly selected existing ID + exact revision/hash; provenance is separate from inclusion |
| ProposedNode | Stable temporary ID, Project/Document/Idea kind, source-grounded title, Idea structured body/type/subtype, source evidence, node revision, retained/merged/removed disposition |
| ProposedUse | Document/destination ID, Idea target ID, order, use revision and effective dependency manifest |
| CreationPlan | Schema version, draft revision, nodes/uses/references, ambiguity/completeness issues, coverage ledger, model/schema version, compiled-event bound |
| ReviewState | Presented and approved hashes for exact node/use versions, completion, stage/navigation and last acknowledged revision |
| DecisionLedger | Explicit removals, merges, keep-together choices, variations and undo relationships; applies to subsequent reanalysis |
| CreationReceipt | Operation/preview identity, exact approval hash, temp-to-canonical ID mapping, all created records/uses and terminal status |

Coverage accounts for supplied substantive content through retained bodies/relationships or an explicit user correction/removal. Model-supplied source spans must exist and be shown; evidence validity is necessary but cannot alone prove faithful meaning. Evaluate both additions and omissions.

## 13. Persistence, concurrency and recovery

Add server-backed actor-private creation-draft storage using existing erasable private-content infrastructure. Add a dedicated private-content kind plus small CAS metadata for actor/scope/destination, revision, state, protected-content pointer, expiry and eventual operation/receipt identity.

Store source text, structured bodies, plan, evidence and approvals in protected payloads—not public events, URLs, logs or operation-journal browser storage. Browser journals remain IDs/hashes only. Exclude creation drafts from generic private-content hydration; use authorized dedicated endpoints. Shared-Project drafts are actor-private within their proper custody; New Project uses prospective personal scope.

Autosave coalesces typing and uses expectedRevision. Display Saving/Saved/Unable to save accurately. Back/Open/explicit Save waits for acknowledgement of the latest edit; if it fails, preserve the live editor with retry/copy rather than navigating away. Reload recovers acknowledged content; v1 does not promise recovery of unacknowledged offline text. Concurrent tabs get a revision conflict and recoverable local copy, never silent last-writer overwrite.

Use existing transient-content retention policy (currently personal fallback 30 days and scoped organization policy). Show expiry and allow discard; do not promise indefinite retention. Private pointer publication and scope/expiry metadata changes are atomic.

Suggested endpoints: create/load/update/discard draft; scoped search; split assessment; retained interpretation prepare/execute/retrieve; review-plan preview; apply/retrieve. Every response carries its scope and relevant revisions. Client guards cannot replace server authority.

Source changes during review pause commit. Refresh the same explicitly selected root identities, disclose changed bodies/dependencies/permissions, and renew affected approvals. Never silently add new source-Document members, substitute latest content into an old approval, freeze a shared copy without consent, or create a new source identity to hide a conflict.

## 14. Canonical compilation and atomic save

Add a retained creation-plan authoring operation. Existing context-authoring authority requires a live Document and cannot authorize a prospective root. Resolve authority by entry: new personal Project capability and unused allocated IDs; writable existing Project for New Document; that Project plus optional current Document for New Idea.

Allocate canonical IDs once per retained operation. Compile validated new Ideas to project-owned library BlockCreated records, then explicit BlockDocumentAttached uses. Create each shared Idea once. Map conceptual Object to subject/Object study and human participants to subject/Human presence. Scene prose can be Action when it describes interactions; never force every description to Direction. Enforce supported types/subtypes and meaningful bodies server-side rather than relying on permissive event folding.

The operation may create Project/Document/Idea records, uses and approved semantic relationships for new nodes. It may attach existing eligible Ideas. It may not overwrite/delete existing shared Idea bodies through hidden property events. Extend generic-reference validation and shared-Project event allowlists deliberately.

Retained interpretation identity binds draft revision, source evidence, scope and model/schema version. Retries retrieve the original execution. Invalid model output never writes creative records. The reviewed preview binds the exact compiled graph and source/dependency/authority versions; unrelated stream advancement can rebase the write head only if those semantic bindings remain unchanged.

Apply all canonical events, protected payloads, shared sidecars and the receipt in one transaction. Recheck authority and reference closure inside the commit boundary. Double Save or a lost response returns the original receipt and IDs. Failure produces no partial graph.

Initial limits are 512 compiled events and 1,000,000 UTF-8 bytes per serialized protected draft/plan envelope, including source, evidence and review state. Preflight throughout drafting and before final approval; a failed oversized autosave is clearly unsaved and retains live input for copy/reduction. Existing transport batching limits (1,900,000-byte chunks, 128 rows per SQL statement, and refusal of string bindings above 2,000,000 bytes) remain implementation ceilings, not additional user capacity promises. Oversized content stays recoverable wherever already acknowledged and in the live editor; never truncate or auto-chunk one approved plan into several commits. These are chosen initial bounds to validate with boundary tests, not inherited creation-draft limits.

Before dispatch, cancellation writes nothing. After uncertain dispatch, show “Checking save” and retrieve the original operation; do not promise rollback or start a replacement transaction. Success requires the terminal receipt. Return to the new Project, primary created Document, or existing destination/project Ideas as appropriate, with links to all created items. A no-change plan offers Open/return rather than an empty commit. Compound post-save undo is not required for v1; in-draft corrections remain undoable.

## 15. White Album acceptance example

The exact supplied input remains valid as one paragraph:

> Recording the White Album. /document Paul and Jon sit with their instruments on either side of a microphone. /image /document Jon, Ringo, and George sit on the other side of the window to the mixing room while Paul appears in the reflection on the glass playing the piano. /video

One valid reviewed result is one Project, two Documents and 14 unique Ideas. Paul and Jon are shared. The implementation fixture accompanying this specification supplies bodies, types, source spans, reference occurrences and Document uses, not only outline labels.

| Document | Content | Preference |
| --- | --- | --- |
| Paul and Jon | Paul, Jon, their separately named unspecified instruments, Microphone, and the first scene's Action | Image |
| Jon, Ringo, and George | The same Paul and Jon; Ringo, George, Window, Piano, mixing room, and the second scene's Action | Video |

Object is represented through existing Subject subtype. Minimal participant/object bodies are extracted from their explicit role in the supplied scene; no body is invented to satisfy a title-only request. The review may accept concise identity content without a biography. The fixture's Action classification is an editable supported interpretation, not a new mandatory scene type or a forced replacement of user-authored Direction.

Preserve Jon's spelling; do not identify either unspecified first-scene instrument as the second-scene piano. Do not add Paul sitting in the second scene, biographical facts, appearance, instrument models or a resolved room-side arrangement beyond the supplied wording.

Compile and fold the graph through the existing model: opening either Document must include only its intended effective content. Shared participants must not drag the other scene into it. Review a shared identity once; then verify each scene's composition and final Project organization.

## 16. Implementation work packages

| Package | Work and dependencies | Done when |
| --- | --- | --- |
| A. Contracts and fixtures | Versioned draft/plan/body/preference schemas; full fixture and correction variants; server validation/compiler; typed authority for prospective roots | Expected canonical IDs/events/closure and rejection cases are deterministic without a model |
| B. Durable execution | Private draft/CAS/retention and recovery; retained interpretation; creation-plan preview/apply/retrieve; personal/shared atomicity | Failure injection, duplicate Save, lost receipt, source/permission changes and event limits pass |
| C. Shared editor and review | En Reve vendoring/custom triggers/range API; portable bodies in Still/Forma; common form; staged review using fixture data; contextual How this works dialog and scope-specific helpers | Free-text capture, seen/approved rules, keyboard/IME, draft restoration, accurate guidance/Save expectations and no duplicate error pass |
| D. Retrieval and Jev | Lexical + learned indexes/backfill and authorized aggregate search; bounded reranking; live split assessment | Held-out semantic retrieval, custody isolation, stale/partial coverage and latency/request budgets qualify |
| E. Correction and preference integration | Removal/merge/variation/partial reuse with reference graph rewrites; Format helper and downstream chooser/provider behavior | No lost/reintroduced content, no scene leakage or saved-source mutation; alternate Outputs remain usable |
| F. Complete release validation | End-to-end original examples and edge cases; accessibility; observability; feature-flag rollout | All acceptance gates pass; unresolved semantic/authorization defects block release |

A and the semantic body/closure contract precede all dependent work. B and C can run in parallel after those schemas; indexing/backend provisioning can also start early. Fixture-driven UI need not wait for model quality. Do not release the interpreted path before its required recovery, correction and reference consumers are ready. Existing creation routes remain available behind a rollback flag; fast title creation does not wait for the full AI path.

## 17. Acceptance and release gates

| Area | Required evidence |
| --- | --- |
| Simple capture | Exact unchanged title saves for Project/Document; no AI wait; empty input has one error; title-only Idea cannot save without body/type |
| Contextual help | Visible How this works beside introductory copy on all entries and available in review; optional plain-language input; entry-correct @ and / examples; no cross-Project reuse promise; title-only and draft-autosave exceptions clear outside and inside dialog; concise input/result example; keyboard/Close/Escape/focus restoration, scrolling/mobile/localization; no draft/undo/review-state mutation, generation, extra provider calls, underlying Save shortcut or false presentation/approval credit |
| Fidelity | Original White Album and multilingual/short/long/ambiguous descriptions; no unsupported added meaning, lost negation/qualification or silent omission in the acceptance corpus |
| Review | All-seen gate, Approve all restrictions, final approval contract, current-version invalidation, changed titles, shared content and absent container stages |
| Identity | Same name/different IDs; repeated occurrences/shared target; cross-draft paste; structured refs round-trip through every supported editor |
| Effective composition | Compile/fold scene isolation; closure permissions/cycles; fixed source-Document roots; changing shared dependencies shown/reviewed before commit |
| Correction | Shared edit/local variation with dependent parents; removal aliases/relationship repair and no reintroduction; merge different uses/types; preserved unfinished children; partial provenance never re-includes source |
| Live assistance | Rapid input, IME, failed/late requests, Keep as one suppression, no recursive prompt loop and no automatic mutation |
| Search | Paraphrases with no token overlap, specific-part versus whole-Document ranking, no good result, deleted/revoked content, partial index and outage behavior |
| Recovery | Reload/Back/Open after acknowledged autosave; two-tab CAS; denied/expired drafts; latest edit not falsely saved; raw content excluded from public/provenance provider paths |
| Commit | Authority changes at each stage; malformed proposal, missing target/cycle, duplicate Save, lost receipt, transaction failure boundaries, 512/513-event and 1,000,000-byte boundaries; one receipt or zero creative writes |
| Output preferences | Multiple/none/disabled/negative preferences; explicit alternate Output wins; no automatic generation or exclusive Document type |
| Access and usability | Keyboard and screen reader completion, focus continuity, long bodies, mobile layout, localization, no input-to-first-paint blocking by network |

Create a fixed source-grounded corpus before tuning: at least 30 organization cases and 50 query/target cases across small and large seeded accounts, including the rows above. Initial retrieval gate: intended result in top three for at least 90% of held-out unambiguous queries, no-match false positives at most 10%, and zero authorization leaks. Treat figures as chosen release targets, not measured results. Separate retrieval recall from reranking quality and manually adjudicate semantic fidelity; passing schema checks is not evidence of no invention.

Initial engineering targets after debounce: local UI feedback within 100 ms; suggestion p95 within 2 seconds at 1,000 and 10,000 indexed Ideas; no foreground work proportional to the full event stream. Use bounded timeouts and honest degraded states. Measure larger accounts and adjust index infrastructure or document supported capacity rather than weakening fidelity or claiming arbitrary scale.

Run focused model/compiler, worker, editor and recovery suites for each package; then repository typecheck/build and relevant end-to-end/accessibility tests. Add live-provider qualification only with configured authorized execution and cost limits. This planning audit makes no live calls and does not claim those implementation tests have already passed.

## 18. Source anchors and readiness handoff

The architecture audit baseline is 68b5f0ab; these anchors describe that audit, not a fresh assessment of the implementation now in progress. Use symbols as stable anchors when line numbers move and consult the implementation verification ledger/current Progress Report before extending existing work.

| Concern | Existing foundation and required extension |
| --- | --- |
| Creation and errors | src/still/app.ts and client.ts: current title/body/type differences and duplicated validation; replace with shared draft controller |
| Model and Object/type mapping | src/model/events.ts; block-types.ts; project-ideas.ts; combined-context.ts |
| References | Design-system rich-text-editor/element.ts, editor-extensions.ts and editor-clipboard.ts; new portable body plus generic server reference contract required |
| Jev | src/still/assessments.ts and decisions.ts; worker/still-idea-assessment.ts; bounded saved-Idea benefit assessment, not account retrieval or draft interpretation |
| Search scale | src/model/indexing.ts; worker/still-history.ts; no production learned-vector backend configured |
| Private drafts | worker/private-content-storage.ts; pilot-policy.ts hydration exclusions; src/still/operation-journal.ts stores identifiers/hashes only |
| Atomic creation | worker/authoring-commits.ts, authoring-event-batches.ts, context-authoring-authority.ts, intake-authority.ts and project-access.ts |
| Output preferences | src/model/document-output-intent.ts, document-artifacts.ts, prompt-policy.ts; Still generation-options/client/results |

The audit companion, docs/still-unified-creation-readiness-audit-2026-09-23.md, records original-request/decision coverage, each corrected gap and the chosen defaults. The fixture, docs/still-unified-creation-fixtures-2026-09-23.json, is a reviewable implementation test input, not the only allowed interpretation. Historical proposals and the rejected sectioned-input mock remain historical evidence, not competing specifications.

**Ready to implement.** The v19 product, architecture and editor/retrieval audit remains the foundation; v20 adds the approved contextual-help requirement. Final-save eligibility remains the explicit specification default in §8. The unchanged v19 fixture passed 63 static assertions during planning; its 29 scenarios and subsequent implementation evidence are tracked separately in the implementation verification ledger. For work already underway, apply the v20 help addition to Package C and its acceptance coverage without restarting completed packages. Help implementation/verification is additional work, not implied complete by earlier editor checks. The Progress Report records this v20 handoff and preserves existing implementation release gates.


## September 24 completion evidence

The product contract above is unchanged. Delivery-audit repairs and agreed interactions are tracked in `still-unified-creation-completion-2026-09-24.md`; the verification ledger records local evidence and existing baseline failures. `still-unified-creation-release-2026-09-24.md` prepares the disabled candidate and lists each required qualification/authorization gate. Implementation evidence does not authorize activation or establish live-provider fidelity.
