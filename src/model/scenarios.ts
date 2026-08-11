import { SignalArray } from "signal-utils/array";
import type { CreativeEvent } from "./events";
import { BLOCK_TYPES } from "./block-types.ts";

export type ScenarioKey = "creative-loop" | "document-evolution" | "async-return" | "concurrency" | "promotion" | "taste-time" | "attention-friction" | "operational-safety";

export const SCENARIOS = [
  { key: "creative-loop" as const, label: "Creative loop", kicker: "Authored wins", summary: "A reference becomes editable context, an authored correction survives compilation, and the resulting output carries critique, library, and export receipts.", actors: ["user", "worker:extractor", "worker:compiler", "worker:generator"] },
  { key: "document-evolution" as const, label: "Document evolution", kicker: "Every block has a life", summary: "A project and document evolve through all twenty context types, reversible block and document changes, extraction outcomes, object actions, collections, and annotations.", actors: ["user", "worker:extractor", "worker:compiler", "worker:generator"] },
  { key: "async-return" as const, label: "Asynchronous return", kicker: "Agency preserved", summary: "A re-entry brief, bounded Scout run, human judgment, and accepted context bridge a session boundary without agents silently editing the document.", actors: ["user", "worker:brief", "worker:scout"] },
  { key: "concurrency" as const, label: "Concurrent pressure", kicker: "Conflicts are explicit", summary: "Views, annotations, and coarse attention evidence keep landing while stale model proposals and version-sensitive generation receive explicit validation outcomes.", actors: ["user", "model:forma-chat", "worker:validator"] },
  { key: "promotion" as const, label: "Family promotion", kicker: "Inference is not authorship", summary: "The index proposes a visual family and anchors its evidence; only a separate accepted proposal creates and organizes a durable user collection.", actors: ["worker:indexer", "model:forma-chat", "user"] },
  { key: "taste-time" as const, label: "Taste & time", kicker: "Memory stays reversible", summary: "An output critique is joined to its compiler inputs, versioned as ranking-only taste, promoted explicitly, resurfaced on a condition, then revoked and forgotten.", actors: ["user", "worker:compiler", "worker:taste", "worker:scheduler"] },
  { key: "attention-friction" as const, label: "Attention & friction", kicker: "Weak signals stay weak", summary: "Visible-page dwell becomes bounded, reviewable evidence around intent, generation, and comparison—then the user can erase the entire attention ledger.", actors: ["user", "worker:attention", "worker:compiler", "worker:generator"] },
  { key: "operational-safety" as const, label: "Operational safeguards", kicker: "Failure stays legible", summary: "Registry, budget, provider, attribution, retention, abandonment, and gate events explain how the application contains failures without rewriting creative truth.", actors: ["user", "model:forma-chat", "worker:registry", "worker:policy", "worker:generator"] },
];

const baseTypes: Record<ScenarioKey, Array<[string, string]>> = {
  "creative-loop": [["user","ProjectCreated"],["user","DocumentCreated"],["user","EmptyCanvasChosen"],["user","BlockCreated"],["user","ReferenceIngested"],["user","RightsAsserted"],["user","ExtractionRequested"],["worker:extractor","ExtractionCompleted"],["user","ChipEdited"],["user","GenerationRequested"],["worker:compiler","ContextCompiled"],["worker:generator","GenerationCompleted"],["user","ComparisonOpened"],["user","ObjectCritiqued"],["user","ObjectPinned"],["user","AddedToLibrary"],["user","ObjectExported"]],
  "document-evolution": [
    ["user","ProjectCreated"],["user","ProjectOpened"],["user","ProjectRenamed"],["user","ProjectStateChanged"],["user","DocumentCreated"],["user","DocumentRenamed"],["user","DocumentOpened"],["user","EmptyCanvasChosen"],
    ...BLOCK_TYPES.map(()=>["user","BlockCreated"] as [string,string]),
    ["user","BlockRenamed"],["user","BlockPropertyEdited"],["user","BlockWeightSet"],["user","BlockLocked"],["user","BlockUnlocked"],["user","BlockRemoved"],["user","BlockRestored"],
    ["user","ReferenceIngested"],["user","RightsAsserted"],["user","RegionPromoted"],["user","ExtractionRequested"],["worker:extractor","ExtractionCompleted"],["worker:extractor","ExtractionFailed"],["worker:extractor","ExtractionSuperseded"],["worker:extractor","ExtractorEvaluationCompleted"],
    ["user","GenerationRequested"],["worker:compiler","ContextCompiled"],["worker:generator","GenerationCompleted"],["user","ObjectViewed"],["user","ObjectSaved"],["user","ObjectPinned"],["user","ObjectUnpinned"],["user","ObjectRegenerated"],["user","AddedToLibrary"],["user","RemovedFromLibrary"],["user","AnnotationAdded"],["user","AnnotationRetracted"],["user","ObjectDiscarded"],["user","ObjectExported"],
    ["user","CollectionCreated"],["user","CollectionCreated"],["user","CollectionItemAdded"],["user","CollectionItemMoved"],["user","CollectionItemRemoved"],["user","CollectionRenamed"],["user","CollectionRemoved"],["user","CollectionRestored"],
    ["user","DocumentForked"],["user","DocumentRemoved"],["user","DocumentRestored"],
  ],
  "async-return": [["user","SessionClosed"],["worker:brief","BriefComposed"],["user","BriefItemPresented"],["worker:scout","ScoutRunStarted"],["worker:scout","GenerationRequested"],["worker:scout","GenerationCompleted"],["worker:scout","ScoutObserved"],["worker:scout","ScoutRunCompleted"],["user","ObservationJudged"],["user","BriefItemAccepted"],["user","BlockCreated"],["user","SessionOpened"]],
  concurrency: [["model:forma-chat","MutationProposed"],["user","ObjectViewed"],["user","AttentionEpisodeObserved"],["user","AnnotationAdded"],["user","ProposalAccepted"],["user","GenerationRequested"],["worker:validator","ValidationFailed"],["user","BlockPropertyEdited"],["user","ObjectPinned"],["user","ProposalRejected"]],
  promotion: [["worker:indexer","FamilyDeclared"],["worker:indexer","FamilyAnchorSet"],["worker:indexer","FamilyMembershipAsserted"],["model:forma-chat","MutationProposed"],["user","ProposalAccepted"],["user","CollectionCreated"],["user","CollectionItemAdded"],["user","CollectionRenamed"]],
  "taste-time": [["user","DocumentCreated"],["user","BlockCreated"],["user","GenerationRequested"],["worker:compiler","ContextCompiled"],["worker:generator","GenerationCompleted"],["user","ObjectCritiqued"],["worker:taste","TasteModelVersioned"],["user","PreferenceAuthored"],["user","ConditionSet"],["worker:scheduler","ConditionFired"],["worker:scheduler","Resurfaced"],["user","PreferenceRevoked"],["user","FactRetracted"]],
  "attention-friction": [["user","SessionOpened"],["user","DocumentCreated"],["user","IntentDeclared"],["user","AttentionEpisodeObserved"],["user","GenerationRequested"],["worker:compiler","ContextCompiled"],["worker:generator","GenerationCompleted"],["user","ComparisonOpened"],["user","ObjectPinned"],["user","AttentionEpisodeObserved"],["user","AttentionSignalsForgotten"],["user","SessionClosed"]],
  "operational-safety": [["worker:registry","ModelRegistered"],["worker:registry","AdapterVersioned"],["worker:registry","CapabilityDeclared"],["worker:policy","BudgetReserved"],["model:forma-chat","AssistantReasoned"],["worker:policy","GenerationUsageRecorded"],["worker:attribution","AttributionComputed"],["worker:policy","BudgetReleased"],["worker:policy","BudgetExceeded"],["worker:generator","GenerationFailed"],["worker:extractor","ExtractionFailed"],["worker:extractor","ExtractionSuperseded"],["worker:extractor","ExtractorEvaluationCompleted"],["user","BriefItemIgnored"],["user","BriefDismissed"],["user","PhaseGateReviewed"],["user","ProposalDeclined"],["worker:scheduler","BranchAbandoned"],["worker:scout","ScoutBudgetExhausted"],["user","ClaimSuperseded"],["worker:policy","RetentionSweepCompleted"]],
};

export const SCENARIO_EVENT_TYPES = [...new Set(Object.values(baseTypes).flat().map(([,type])=>type))];

type ReplayEventStory = { action: string; value: string };
const EVENT_STORIES: Record<string,ReplayEventStory> = {
  ProjectCreated:{action:"The user opened a durable project boundary for the study.",value:"Every later document, generation, and memory receipt can be scoped without relying on a mutable folder name."},
  DocumentCreated:{action:"The user created and named a distinct document in the project.",value:"The document can be opened, renamed, replayed, or removed independently while its history remains intact."},
  EmptyCanvasChosen:{action:"The user explicitly declined suggested re-entry context and chose an empty canvas.",value:"Blankness is witnessed as intent; the app does not silently insert a direction block or mistake absence for missing data."},
  BlockCreated:{action:"The user added authored context to the active document.",value:"The block receives stable identity, type, order, and authority so later compilation can cite the exact version used."},
  ReferenceIngested:{action:"The user attached a visual reference as source material.",value:"The upload becomes addressable evidence rather than an opaque prompt attachment, enabling extraction, preview, and provenance."},
  RightsAsserted:{action:"The user confirmed they may use the uploaded reference.",value:"Generation can proceed with an explicit rights receipt instead of hiding a legal assumption inside UI state."},
  ExtractionRequested:{action:"The application queued structured analysis for the reference block.",value:"Pending work is visible and replayable, separating the user upload from fallible machine-derived properties."},
  ExtractionCompleted:{action:"The extractor proposed palette, mood, composition, material, lighting, and spatial findings with confidence.",value:"The user can adopt each visual finding separately, keeping the image as evidence while turning only useful suggestions into editable document decisions."},
  ChipEdited:{action:"The user corrected one extracted creative property.",value:"Authored judgment now outranks inference, and every future projection can still explain both the suggestion and the correction."},
  GenerationRequested:{action:"A bounded generation was requested against the current document version.",value:"The request establishes intent and a version checkpoint before any provider work begins."},
  ContextCompiled:{action:"The compiler froze the exact block versions and standing constraints sent to generation.",value:"Outputs can be reproduced, compared, and blamed back to their real inputs instead of an unknowable latest document."},
  GenerationCompleted:{action:"The generator returned an addressable creative object.",value:"Provider, model, latency, generation, and object identity become durable receipts for later comparison and critique."},
  ComparisonOpened:{action:"The user opened alternatives side by side.",value:"The app witnesses a decision context, so a later pin or critique has stronger meaning than an isolated view."},
  ObjectCritiqued:{action:"The user recorded axis-specific taste evidence on an output.",value:"The critique joins through the object and generation to model, adapter, and contributing block versions while remaining reversible."},
  ObjectPinned:{action:"The user kept one output in active working context.",value:"This explicit positive outcome carries more authority than passive attention and can support ranking without deleting alternatives."},
  AddedToLibrary:{action:"The user saved the output into the durable library.",value:"Reuse becomes intentional and reversible; the same object remains linked to its originating document and compile receipt."},
  ObjectExported:{action:"The user exported the selected object for use outside Forma.",value:"A high-intent outcome closes the creative loop and gives evaluation a concrete success signal."},
  SessionClosed:{action:"The user ended a working session with the current head recorded.",value:"Later assistance can reason across a real interruption instead of treating the next visit as a stateless page load."},
  BriefComposed:{action:"The brief worker summarized unresolved work into ranked re-entry items.",value:"The summary is derived report space: useful preparation that cannot mutate the document by itself."},
  BriefItemPresented:{action:"The application showed one brief item to the returning user.",value:"Presentation is witnessed separately from acceptance, making dosage and ignored suggestions measurable."},
  ScoutRunStarted:{action:"The Scout opened a bounded exploration run with a declared envelope.",value:"Budget, capability, and report-only limits are known before exploratory work starts."},
  ScoutObserved:{action:"The Scout reported a falsifiable pattern with confidence and evidence references.",value:"The observation can be judged or rejected without granting the Scout authority to choose a creative direction."},
  ScoutRunCompleted:{action:"The Scout stopped within its declared exploration budget.",value:"Exhaustion is planned and auditable rather than an open-ended background agent loop."},
  ObservationJudged:{action:"The user confirmed, rejected, or marked the Scout observation unclear.",value:"Human verdicts calibrate observation types and confirmed-observations-per-dollar instead of rewarding persuasive prose."},
  BriefItemAccepted:{action:"The user explicitly accepted prepared context from the re-entry brief.",value:"Only this authored bridge lets report-space work influence the live document."},
  SessionOpened:{action:"The user began a new witnessed work session.",value:"The app can measure continuity, re-entry dosage, and time-scoped signals without inferring a session from page presence alone."},
  MutationProposed:{action:"Forma Chat proposed a typed mutation without committing it.",value:"The user can inspect exact consequences; model usefulness never expands into write authority."},
  ObjectViewed:{action:"The user deliberately opened a creative object.",value:"Explicit engagement is recorded as a lightweight signal while remaining weaker than pinning, critique, or export."},
  AttentionEpisodeObserved:{action:"A visible-page attention episode was summarized into active time, idle time, visible references, and its ending action.",value:"Potential friction becomes reviewable low-weight evidence without storing pointer paths, keystrokes, or typed content."},
  AnnotationAdded:{action:"The user attached a comment to a specific creative object or region.",value:"Collaborative meaning stays addressable and commutative even while version-sensitive work is being checked."},
  ProposalAccepted:{action:"The user authorized the valid part of a model proposal.",value:"Authorship is explicit, and accepted events can proceed independently of rejected or stale siblings."},
  ValidationFailed:{action:"The validator rejected an unauthorized or stale event with structured reasons.",value:"The stream preserves the failed attempt as evidence while keeping invalid state out of every projection."},
  BlockPropertyEdited:{action:"The user changed a named property on an existing block version.",value:"Version-sensitive generation can detect the relevant change instead of invalidating unrelated engagement."},
  ProposalRejected:{action:"The user declined the remaining model proposal.",value:"Rejected-path memory prevents the same suggestion from returning as if no decision had been made."},
  FamilyDeclared:{action:"The indexer proposed an aesthetic family from related outputs.",value:"The family is visible as inferred, confidence-bearing, and correctable—not silently filed as user-authored truth."},
  FamilyAnchorSet:{action:"The indexer attached representative anchors and evidence receipts to the family.",value:"A reviewer can inspect what visually grounds the grouping instead of trusting only its label."},
  FamilyMembershipAsserted:{action:"The indexer proposed one output as a family member with confidence.",value:"Individual edges can be corrected without deleting the broader family or rewriting history."},
  CollectionCreated:{action:"The user promoted useful family evidence into a durable collection.",value:"A separate authored event preserves the boundary between machine inference and user organization."},
  CollectionItemAdded:{action:"The user filed a specific document or output into that collection.",value:"Membership is reversible and independently ordered rather than embedded in the asset itself."},
  CollectionRenamed:{action:"The user gave the promoted collection their own language.",value:"The organizational concept now reflects authored meaning while retaining its source-claim receipt."},
  TasteModelVersioned:{action:"The taste worker snapshotted decaying beliefs and a ranking-only policy.",value:"Changes in taste can be compared as-of time; inferred beliefs may reorder candidates but cannot filter them."},
  PreferenceAuthored:{action:"The user promoted a specific claim into a standing preference.",value:"Future compilation may state this preference assertively because authorship and source claim are both witnessed."},
  ConditionSet:{action:"The user asked for a private concern to resurface after a concrete trigger.",value:"Future memory is intentional, scoped, and inspectable instead of a hidden reminder heuristic."},
  ConditionFired:{action:"The scheduler detected that the authored trigger had become due.",value:"Timing logic is witnessed separately from presentation, making premature or late reminders diagnosable."},
  Resurfaced:{action:"The application presented the due condition back to the user.",value:"Evaluation can measure whether the remembered concern was useful at the moment it returned."},
  PreferenceRevoked:{action:"The user revoked a standing preference.",value:"The constraint stops compiling into future generations while its former validity remains historically explainable."},
  FactRetracted:{action:"The user forgot an inferred taste claim.",value:"The claim disappears from current capsules without deleting the evidence trail that explains the retraction."},
  IntentDeclared:{action:"The user stated the goal for the current session.",value:"Attention and generation outcomes can be interpreted against explicit intent rather than guessed from dwell alone."},
  AttentionSignalsForgotten:{action:"The user erased retained coarse attention evidence.",value:"The low-authority signal path remains consent-based, reviewable, and genuinely reversible."},
  ProjectOpened:{action:"The user switched the active project boundary.",value:"Every document, collection, and library projection can change scope without copying or silently merging project state."},
  ProjectRenamed:{action:"The user renamed the project in their own language.",value:"Stable identity survives a changing label, so links and event history do not depend on mutable presentation text."},
  ProjectStateChanged:{action:"The user changed the project lifecycle state.",value:"Active and archived work remain explicitly distinguishable without deleting their documents, objects, or receipts."},
  DocumentRenamed:{action:"The user gave the current document a new title.",value:"The document stays addressable by durable identity while its human-facing name evolves with the work."},
  DocumentForked:{action:"The user created a document fork with a source receipt.",value:"A new direction can diverge safely while retaining the exact stream and sequence from which it began."},
  DocumentOpened:{action:"The user opened a specific existing document.",value:"Navigation becomes witnessed context, allowing re-entry and projections to return to the intended work rather than a default document."},
  DocumentRemoved:{action:"The user removed a document from active project views.",value:"A reversible tombstone clears the working surface without erasing the event history needed for audit or restoration."},
  DocumentRestored:{action:"The user restored a previously removed document.",value:"The complete document reappears from its event history, including blocks, outputs, and organizational relationships."},
  BlockRenamed:{action:"The user renamed a context block handle.",value:"Readable vocabulary can improve without changing the block identity cited by generations and downstream evidence."},
  BlockWeightSet:{action:"The user adjusted how strongly a block should influence compilation.",value:"Influence becomes an explicit, replayable decision rather than an invisible prompt-order side effect."},
  BlockLocked:{action:"The user locked a resolved block against incidental editing.",value:"Stable decisions can remain visible and compilable while exploratory parts of the document continue to change."},
  BlockUnlocked:{action:"The user reopened a locked block for revision.",value:"A prior decision can evolve deliberately without losing the interval during which its locked version governed generation."},
  BlockRemoved:{action:"The user removed a block from the live document projection.",value:"The block stops compiling immediately while its earlier contribution remains attributable to outputs already generated."},
  BlockRestored:{action:"The user restored a removed context block.",value:"The same stable block identity returns, avoiding a misleading copy that would sever its earlier provenance."},
  RegionPromoted:{action:"The user promoted a selected reference region into explicit context.",value:"A local visual observation becomes addressable evidence with its own provenance instead of an unexplained crop."},
  ObjectSaved:{action:"The user saved an output as a deliberate working result.",value:"This stronger outcome signal can guide re-entry and ranking while remaining distinct from library filing or export."},
  ObjectDiscarded:{action:"The user discarded an output from active result views.",value:"Negative creative judgment remains learnable and reversible without deleting the generation and compile receipts."},
  ObjectUnpinned:{action:"The user removed an output from active pinned context.",value:"A former preference stops steering the workspace while the duration and source of its earlier importance remain visible."},
  ObjectRegenerated:{action:"The user requested another attempt from an existing output context.",value:"Iteration is linked to the result that motivated it, distinguishing refinement from an unrelated new generation."},
  BriefItemIgnored:{action:"The user ignored one re-entry suggestion.",value:"Dosage and rejected-path memory can improve without treating non-selection as permission to mutate the document."},
  BriefDismissed:{action:"The user dismissed the remaining re-entry brief.",value:"The application witnesses a preference to resume unaided and can stop repeating stale preparation."},
  PhaseGateReviewed:{action:"A human reviewer recorded the evidence-based phase decision.",value:"Product advancement remains an accountable judgment with cited metrics rather than an automatic threshold crossing."},
  ProposalDeclined:{action:"The user declined a proposal before any mutation was authorized.",value:"Model assistance stays preview-only, and declined intent can inform future suggestions without entering authored state."},
  AnnotationRetracted:{action:"The annotation owner retracted a previous comment.",value:"Current collaboration views stay accurate while the durable history can still explain that the comment once existed."},
  RemovedFromLibrary:{action:"The user removed an output from the kept library set.",value:"Intentional reuse remains reversible and does not require deleting the underlying object or its originating document."},
  CollectionRemoved:{action:"The user removed a collection from the active project tree.",value:"Authored organization can be simplified with a reversible tombstone while contained items keep their durable identities."},
  CollectionRestored:{action:"The user restored a removed collection.",value:"The project organization returns from witnessed state rather than reconstructing a look-alike container with new identity."},
  CollectionItemRemoved:{action:"The user removed an item from its authored collection.",value:"Filing changes independently from the item itself, preserving both content provenance and organization history."},
  CollectionItemMoved:{action:"The user moved an item between authored collections.",value:"The latest project structure is direct to query while the stream still explains every earlier location."},
  ClaimSuperseded:{action:"The user or worker superseded a specific inferred claim.",value:"One incorrect family or taste edge can be corrected without deleting the evidence set or rebuilding unrelated claims."},
  GenerationFailed:{action:"The generator returned a structured failure instead of an object.",value:"Provider errors, timeouts, and policy stops stay distinct from creative rejection and never masquerade as successful output."},
  ExtractionFailed:{action:"The extractor could not derive reliable properties from the reference.",value:"Unavailable machine evidence is explicit, allowing the user to author context directly without trusting fabricated chips."},
  ExtractionSuperseded:{action:"A newer extraction replaced an earlier derived result.",value:"Improved analysis can become current while every generation retains the exact extractor version it originally used."},
  ExtractorEvaluationCompleted:{action:"The extractor suite recorded a fixed-corpus evaluation receipt.",value:"Quality claims remain tied to reproducible corrections and named versions instead of subjective confidence alone."},
  ModelRegistered:{action:"The registry introduced a model identity to the workspace.",value:"Later generations and critiques can name the real producer rather than relying on a mutable provider default."},
  AdapterVersioned:{action:"The registry recorded a new model-adapter contract version.",value:"Behavior changes at the integration boundary remain attributable and comparable across otherwise similar generations."},
  CapabilityDeclared:{action:"The registry declared the operations a model adapter may perform.",value:"Routing and authorization can fail closed instead of discovering unsupported powers during a creative request."},
  BranchAbandoned:{action:"The scheduler marked an inactive exploration branch abandoned.",value:"Re-entry can avoid stale paths while preserving the evidence that explains why the branch stopped receiving attention."},
  AttributionComputed:{action:"The attribution worker joined an output to contributing inputs and receipts.",value:"Critique can point to likely sources without overstating statistical association as singular creative causation."},
  BudgetReserved:{action:"The policy worker reserved capacity before provider execution.",value:"Concurrent requests cannot overspend a shared hard cap simply because their final token receipts arrive later."},
  BudgetReleased:{action:"The policy worker returned an unused reservation after a stopped operation.",value:"Failed or cancelled work does not strand capacity, and the release remains auditable against its original reservation."},
  BudgetExceeded:{action:"The policy worker denied work at a declared hard cap.",value:"The application fails before external spend while presenting a predictable operational reason rather than a broken canvas."},
  GenerationUsageRecorded:{action:"The policy worker settled actual token usage against the reservation.",value:"Cost and capacity reports reflect provider receipts while preserving the safety of pre-execution reservation."},
  RetentionSweepCompleted:{action:"The policy worker completed a private-content retention sweep.",value:"Sensitive provider and prompt material expires on schedule while non-sensitive event receipts preserve accountability."},
  ScoutBudgetExhausted:{action:"The Scout reached its declared exploration limit.",value:"The run stops as a planned envelope outcome, preventing curiosity from becoming an unbounded autonomous loop."},
  AssistantReasoned:{action:"Forma produced a private structured interpretation for review.",value:"The reasoning result remains an inspectable, expiring proposal artifact and cannot directly become authored context."},
};

const EVENT_TRIGGERS: Record<string,string> = {
  ProjectCreated:"This happens when the user submits the New project form with a name and initial lifecycle state.",
  DocumentCreated:"This happens when the user chooses to start a document and confirms its initial name.",
  EmptyCanvasChosen:"This happens when the user explicitly chooses a blank canvas instead of accepting prepared re-entry context.",
  BlockCreated:"This happens when the user confirms an authored block, adopts a reference-derived decision, or accepts a proposed context addition.",
  ReferenceIngested:"This happens after the user selects a file and the application stores an addressable private media reference.",
  RightsAsserted:"This happens only after the uploader explicitly confirms ownership or permission to use the selected reference.",
  ExtractionRequested:"This happens when a newly ingested reference is eligible for structured palette, light, or composition analysis.",
  ExtractionCompleted:"This happens when the requested extractor finishes successfully and returns confidence-bearing properties for the reference block.",
  ChipEdited:"This happens when the user corrects a machine-derived property rather than accepting the extracted value as authored truth.",
  GenerationRequested:"This happens when the user invokes generation with a valid document version and the required provider prerequisites.",
  ContextCompiled:"This happens after a generation request passes validation and the compiler freezes the exact blocks and standing constraints to send.",
  GenerationCompleted:"This happens when the provider returns a successful result for the compiled generation request.",
  ComparisonOpened:"This happens when at least two outputs are available and the user chooses to evaluate them side by side.",
  ObjectCritiqued:"This happens when the user records a positive or negative judgment against a named creative axis on an output.",
  ObjectPinned:"This happens when the user deliberately marks an output as active working context or a preferred comparison result.",
  AddedToLibrary:"This happens when the user chooses to keep an output for deliberate reuse beyond the recent-results trail.",
  ObjectExported:"This happens when the user requests a downloadable rendition and the rights and object prerequisites are satisfied.",
  ProjectOpened:"This happens when the user selects a different existing project from the account-level project list or breadcrumb.",
  ProjectRenamed:"This happens when the user saves a changed project name from project settings.",
  ProjectStateChanged:"This happens when the user changes a project between its supported lifecycle states in project settings.",
  DocumentRenamed:"This happens when the user confirms an edited document title in the document bar.",
  DocumentOpened:"This happens when the user selects a specific document from project contents, navigation, library, or a re-entry destination.",
  BlockRenamed:"This happens when the user saves a different readable handle for an existing block.",
  BlockPropertyEdited:"This happens when the user changes one editable block property or an accepted proposal targets that exact property.",
  BlockWeightSet:"This happens when the user adjusts a block's influence control in a document view or layer inspector.",
  BlockLocked:"This happens when the user marks a resolved block as protected from incidental edits.",
  BlockUnlocked:"This happens when the user deliberately reopens a protected block for revision.",
  BlockRemoved:"This happens when the user confirms removal of a live block from the current document projection.",
  BlockRestored:"This happens when Undo or another explicit restoration action compensates for a previous block removal.",
  RegionPromoted:"This happens when the user selects a meaningful region inside a reference and promotes that region into reusable context.",
  ExtractionFailed:"This happens when requested analysis cannot produce properties that satisfy the extractor's validity requirements.",
  ExtractionSuperseded:"This happens when a newer extractor result or version becomes authoritative for the same reference analysis request.",
  ExtractorEvaluationCompleted:"This happens when the fixed evaluation corpus has run against a named extractor version and produced correction metrics.",
  ObjectViewed:"This happens when the user deliberately opens an output's focused preview rather than merely scrolling past it.",
  ObjectSaved:"This happens when the user invokes the output's save action after reviewing the generated result.",
  ObjectUnpinned:"This happens when the user removes a previously pinned output from active working context.",
  ObjectRegenerated:"This happens when the user asks for another variation from the context of a specific existing output.",
  RemovedFromLibrary:"This happens when the user removes a deliberately kept output from the reusable library set.",
  AnnotationAdded:"This happens when a user or authorized annotator submits a comment attached to an addressable object or region.",
  AnnotationRetracted:"This happens when the annotation owner or an authorized collaborator retracts an existing comment.",
  ObjectDiscarded:"This happens when the user explicitly rejects an output from active result views.",
  CollectionCreated:"This happens when the user confirms a new top-level or nested organizational collection.",
  CollectionItemAdded:"This happens when the user files an unfiled document, output, or nested collection into a valid collection.",
  CollectionItemMoved:"This happens when the user moves a filed item to another valid collection without creating a cycle.",
  CollectionItemRemoved:"This happens when the user removes an item's authored collection membership while keeping the item itself.",
  CollectionRenamed:"This happens when the user saves a changed collection handle that does not collide with a sibling.",
  CollectionRemoved:"This happens when the user confirms removal of a collection from the active project tree.",
  CollectionRestored:"This happens when an explicit restoration action compensates for a previous collection removal.",
  DocumentForked:"This happens when the user imports or branches a document while retaining its source stream and sequence receipt.",
  DocumentRemoved:"This happens when the user confirms deletion of a non-final document in the project.",
  DocumentRestored:"This happens when Undo or another explicit restoration action compensates for a previous document removal.",
  SessionClosed:"This happens when the user ends a session or the application closes a witnessed work boundary with a final head snapshot.",
  BriefComposed:"This happens when the re-entry gate is eligible and the brief worker finds unresolved, sufficiently dormant work in closed-session evidence.",
  BriefItemPresented:"This happens when the application renders an eligible composed brief item to the returning user.",
  ScoutRunStarted:"This happens when the user requests bounded exploration and the Scout receives an approved report-only envelope.",
  ScoutObserved:"This happens when a Scout run finds a falsifiable pattern supported by trajectory evidence inside its declared envelope.",
  ScoutRunCompleted:"This happens when the Scout satisfies its envelope, finishes planned work, or reaches another declared terminal condition.",
  ObservationJudged:"This happens when the user reviews a Scout observation and submits confirmed, rejected, or unclear.",
  BriefItemAccepted:"This happens when the user explicitly accepts a presented brief item as useful context for live work.",
  SessionOpened:"This happens when the user begins a new witnessed work period, including a return after a closed-session boundary.",
  MutationProposed:"This happens when Forma interprets an open request as typed candidate events but lacks authority to append them directly.",
  AttentionEpisodeObserved:"This happens when opted-in, visible-page activity reaches a semantic boundary and can be summarized without raw input capture.",
  ProposalAccepted:"This happens when the user reviews a valid mutation proposal and authorizes its applicable events.",
  ValidationFailed:"This happens when an attempted event violates producer permissions, sequence expectations, or another append-time invariant.",
  ProposalRejected:"This happens when the user reviews a proposal and records that its suggested direction is not acceptable.",
  FamilyDeclared:"This happens when a versioned index rebuild finds a sufficiently coherent cluster of related project outputs.",
  FamilyAnchorSet:"This happens after a family is declared and the indexer chooses representative evidence that best grounds the grouping.",
  FamilyMembershipAsserted:"This happens when the indexer scores a specific output strongly enough to propose a correctable family edge.",
  TasteModelVersioned:"This happens when new critiques or time decay require the taste worker to snapshot a revised ranking-only belief model.",
  PreferenceAuthored:"This happens when the user promotes a visible taste claim into an explicit standing preference.",
  ConditionSet:"This happens when the user authors a future trigger for resurfacing a private concern or decision.",
  ConditionFired:"This happens when the scheduler observes that an authored date or generation-count threshold has been reached.",
  Resurfaced:"This happens after a condition fires and the application presents the due private concern on an appropriate surface.",
  PreferenceRevoked:"This happens when the user explicitly withdraws a previously authored standing preference.",
  FactRetracted:"This happens when the user chooses to forget or correct a currently projected inferred claim.",
  IntentDeclared:"This happens when the user optionally records what they want to accomplish during the current session.",
  AttentionSignalsForgotten:"This happens when the user invokes the governance control to erase retained coarse attention episodes.",
  ModelRegistered:"This happens when an administrator or deployment process introduces a named model identity to the registry.",
  AdapterVersioned:"This happens when the integration contract for a model adapter changes and is released as a new version.",
  CapabilityDeclared:"This happens when a registered model-adapter pair publishes the bounded operations it is allowed to support.",
  BudgetReserved:"This happens after an external operation is authorized but before provider execution can consume shared capacity.",
  AssistantReasoned:"This happens when an authorized model call returns a private structured interpretation for user review.",
  GenerationUsageRecorded:"This happens when provider token usage is available and the policy worker can settle it against the reservation.",
  AttributionComputed:"This happens when an output, its generation, and its compiled source block versions are all available to join.",
  BudgetReleased:"This happens when a reserved provider operation stops before consuming all or any of its reserved capacity.",
  BudgetExceeded:"This happens when a requested operation cannot reserve capacity beneath the applicable user or workspace hard cap.",
  GenerationFailed:"This happens when the provider, adapter, policy layer, or network returns a terminal generation error instead of an object.",
  BriefItemIgnored:"This happens when the user declines or passes over one presented re-entry item without accepting it.",
  BriefDismissed:"This happens when the user closes the remaining re-entry brief and chooses to continue without it.",
  PhaseGateReviewed:"This happens when the agreed evidence floor is available and an authorized human reviewer records a phase decision.",
  ProposalDeclined:"This happens when the user dismisses a model proposal before authorizing any of its candidate mutations.",
  BranchAbandoned:"This happens when a branch remains inactive beyond the scheduler's declared dormancy rule after a session boundary.",
  ScoutBudgetExhausted:"This happens when a Scout run consumes the final observation, generation, cost, or time allowance in its envelope.",
  ClaimSuperseded:"This happens when stronger evidence or a human correction identifies a replacement for one specific inferred claim.",
  RetentionSweepCompleted:"This happens on the configured retention schedule after eligible private content passes its expiry cutoff.",
};

export function formatReplayDuration(milliseconds:number) {
  const seconds=Math.max(0,Math.round(milliseconds/1000));if(seconds<60)return`${seconds}s`;
  const minutes=Math.floor(seconds/60);if(minutes<60)return`${minutes}m ${seconds%60}s`;
  const hours=Math.floor(minutes/60);if(hours<24)return`${hours}h ${minutes%60}m`;
  const days=Math.floor(hours/24);return`${days}d ${hours%24}h`;
}

export function explainReplayEvent(event: CreativeEvent, previousEvent?:CreativeEvent) {
  let story=EVENT_STORIES[event.type]??{action:`${event.actor} appended ${event.type}.`,value:"The typed event remains independently inspectable and replayable."};
  let trigger=EVENT_TRIGGERS[event.type]??(previousEvent?`This happens because the preceding ${previousEvent.type} event satisfied the next typed transition in the workflow.`:"This happens when the workflow's typed preconditions are satisfied.");
  if(event.type==="BlockPropertyEdited"&&event.payload.property_path==="spatial_scope"){
    story={action:"The user limited one creative decision to a specific part of the document.",value:"Generation can apply the instruction only inside its normalized region, subject-relative area, or clipping path while every document view resolves the same durable target."};
    trigger="This happens when the user opens a block’s Affects control, chooses a targeting method, and confirms its edge behavior.";
  }
  const gapMs=previousEvent?Math.max(0,Date.parse(event.occurredAt)-Date.parse(previousEvent.occurredAt)):0;const elapsed=previousEvent?formatReplayDuration(gapMs):"Scenario start";
  let temporalValue="This timestamp establishes the baseline from which later creative actions, interruptions, and machine responses are measured.";
  if(previousEvent&&event.type==="SessionOpened")temporalValue=`The ${elapsed} gap makes re-entry explicit: Forma can prepare continuity without pretending the user stayed in one uninterrupted session.`;
  else if(previousEvent&&["ConditionFired","Resurfaced"].includes(event.type))temporalValue=`The ${elapsed} delay demonstrates that remembered context can return at an authored trigger rather than merely appearing in the next render.`;
  else if(previousEvent&&gapMs>=86_400_000)temporalValue=`The ${elapsed} interval tests durable meaning across days, when transient UI state would no longer be a trustworthy explanation.`;
  else if(previousEvent&&gapMs>=3_600_000)temporalValue=`The ${elapsed} interruption distinguishes resumed work from a continuous editing burst and gives re-entry evidence a real boundary.`;
  else if(previousEvent&&(event.actor.startsWith("worker:")||event.actor.startsWith("model:")))temporalValue=`The ${elapsed} handoff exposes machine latency and causation, so assistance can be evaluated separately from the user action that requested it.`;
  else if(previousEvent&&(previousEvent.actor.startsWith("worker:")||previousEvent.actor.startsWith("model:")))temporalValue=`The user responded ${elapsed} after machine work, preserving a measurable review interval instead of collapsing assistance and acceptance into one step.`;
  else if(previousEvent)temporalValue=`The ${elapsed} interval preserves the pace of the creative decision, helping distinguish rapid manipulation from considered revision.`;
  return {...story,trigger,cause:event.causationId?`Causation points to ${event.causationId}; actor ${event.actor} owns this step.`:`This is the first witnessed step in its scenario; actor ${event.actor} owns it.`,timing:{gapMs,label:elapsed,value:temporalValue}};
}

function payloadFor(type: string, i: number, key: ScenarioKey, cycle: number): Record<string, unknown> {
  const patternPosition=i%baseTypes[key].length;const patternPrefix=baseTypes[key].slice(0,patternPosition+1);const blockOrdinal=patternPrefix.filter(([,eventType])=>eventType==="BlockCreated").length-1;const replayBlockType=key==="document-evolution"?BLOCK_TYPES[Math.max(0,blockOrdinal)%BLOCK_TYPES.length].type:key==="async-return"?"direction":"reference";
  const documentId=`document-${key}-${cycle}`; const blockId=key==="document-evolution"?`block-${key}-${cycle}-${replayBlockType}`:`block-${key}-${cycle}`; const referenceBlockId=key==="document-evolution"?`block-${key}-${cycle}-reference`:blockId; const generationId=`generation-${key}-${cycle}`; const objectId=`object-${key}-${cycle}`; const runId=`run-${key}-${cycle}`; const observationId=`observation-${key}-${cycle}`; const familyId=`family-${cycle}`; const collectionId=`collection-${cycle}`; const preferenceId=`preference-${cycle}`; const conditionId=`condition-${cycle}`;
  if(type==="ProjectCreated")return{project_id:"project-long-horizon",name:"Long horizon study",state:"active"};
  if(type==="ProjectOpened")return{project_id:"project-long-horizon",previous_project_id:"project-previous"};
  if(type==="ProjectRenamed")return{project_id:"project-long-horizon",old_name:"Long horizon study",new_name:"Long horizon creative system"};
  if(type==="ProjectStateChanged")return{project_id:"project-long-horizon",previous_state:"draft",state:"active"};
  if(type==="DocumentCreated")return{document_id:documentId,title:`Atmosphere study ${cycle+1}`,handle:`atmosphere-${cycle+1}`};
  if(type==="DocumentRenamed")return{document_id:documentId,old_title:`Atmosphere study ${cycle+1}`,new_title:`Nocturne system ${cycle+1}`};
  if(type==="DocumentOpened")return{document_id:documentId,previous_document_id:`document-previous-${cycle}`};
  if(type==="DocumentForked")return{document_id:`document-${key}-${cycle}-fork`,title:`Nocturne system ${cycle+1} · fork`,source_stream_id:`theory:${key}`,source_sequence:i,carried_block_ids:BLOCK_TYPES.map((definition)=>`block-${key}-${cycle}-${definition.type}`)};
  if(type==="DocumentRemoved"||type==="DocumentRestored")return{document_id:documentId,reason:type==="DocumentRemoved"?"project cleanup":"user undo"};
  if(type==="EmptyCanvasChosen")return{document_id:documentId,brief_id:null,explicit_blank:true};
  if(type==="BlockCreated"){
    const spatialScopes=[
      {schema_version:1,kind:"document",coordinate_space:"document-normalized",feather:0,falloff:"hard",polarity:"inside"},
      {schema_version:1,kind:"region",coordinate_space:"document-normalized",region:"right",instruction:"",feather:.2,falloff:"contextual",polarity:"inside"},
      {schema_version:1,kind:"aabb",coordinate_space:"document-normalized",aabb:{x:.12,y:.18,width:.46,height:.52},feather:.08,falloff:"soft",polarity:"inside"},
      {schema_version:1,kind:"subject",coordinate_space:"document-normalized",subject_block_id:`block-${key}-${cycle}-subject`,subject_relation:"around",feather:.22,falloff:"contextual",polarity:"inside"},
      {schema_version:1,kind:"path",coordinate_space:"document-normalized",path:[{x:.18,y:.2},{x:.82,y:.14},{x:.7,y:.78},{x:.28,y:.72}],feather:.04,falloff:"soft",polarity:"outside"},
    ];
    const spatial_scope=spatialScopes[Math.max(0,blockOrdinal)%spatialScopes.length];
    const properties=replayBlockType==="palette"?{label:"Dusk amber",colors:["#27252b","#e9a073","#e8d7bd","#8a6571"],subtype:"Emotional",authority:"authored",weight:.8,spatial_scope}:replayBlockType==="reference"?{reference_id:`reference-${cycle}`,label:"Window light",subtype:"Mood",authority:"authored",weight:.8,spatial_scope}:{text:`${replayBlockType} decision for a quiet, warm nocturne`,subtype:BLOCK_TYPES.find((definition)=>definition.type===replayBlockType)?.subtypes[0],authority:"authored",weight:.8,spatial_scope};return{block_id:blockId,document_id:documentId,type:replayBlockType,handle:`${replayBlockType}/${key}-${cycle}`,position:`a${String(Math.max(0,blockOrdinal)).padStart(6,"0")}`,properties};}
  if(type==="BlockRenamed")return{block_id:`block-${key}-${cycle}-direction`,old_handle:`direction/${key}-${cycle}`,new_handle:`direction/nocturne-${cycle}`};
  if(type==="BlockWeightSet")return{block_id:`block-${key}-${cycle}-direction`,old_weight:.8,weight:.92};
  if(type==="BlockLocked"||type==="BlockUnlocked"||type==="BlockRemoved"||type==="BlockRestored")return{block_id:`block-${key}-${cycle}-direction`,reason:type.toLowerCase()};
  if(type==="ReferenceIngested")return{reference_id:`reference-${cycle}`,block_id:referenceBlockId,document_id:documentId,media_type:"image/jpeg",content_ref:`media-${cycle}`};
  if(type==="RightsAsserted")return{reference_id:`reference-${cycle}`,assertion:"user-owns-or-may-use",scope:"generation"};
  if(type==="RegionPromoted")return{reference_id:`reference-${cycle}`,block_id:referenceBlockId,region:{x:.18,y:.22,width:.44,height:.38},promoted_property:"lighting",label:"Window edge light"};
  if(type==="ExtractionRequested")return{reference_id:`reference-${cycle}`,block_id:referenceBlockId,extractor_name:"palette-light-v2"};
  if(type==="ExtractionCompleted")return{reference_id:`reference-${cycle}`,block_id:referenceBlockId,extractor_name:"deterministic-image-suite-v2",overall_confidence:.78,requested_findings:["palette","mood","composition","material","lighting","spatial"],chips:[{property:"colors",value:["#27252b","#e8d7bd"],confidence:.88},{property:"dominant_edges",value:"vertical",confidence:.84},{property:"reference_findings",value:[{kind:"mood",blockType:"emotion",subtype:"Primary affect",label:"Quiet and nocturnal",value:"Carry a quiet, nocturnal mood with restrained energy and protected shadows.",basis:"Brightness and contrast sample",confidence:.76},{kind:"composition",blockType:"composition",subtype:"Focal hierarchy",label:"Vertical division",value:"Use vertical divisions and side-to-side contrast to organize the frame.",basis:"Dominant vertical edge energy",confidence:.81},{kind:"material",blockType:"material",subtype:"Texture",label:"Natural material variation",value:"Preserve moderate surface variation so materials feel physical without becoming noisy.",basis:"Local color variation",confidence:.64}],confidence:.73}]};
  if(type==="ExtractionFailed")return{reference_id:`reference-${cycle}`,block_id:referenceBlockId,extractor_name:"palette-light-v2",reason:"insufficient-readable-pixels",retryable:true};
  if(type==="ExtractionSuperseded")return{reference_id:`reference-${cycle}`,block_id:referenceBlockId,superseded_extractor:"palette-light-v1",replacement_extractor:"palette-light-v2"};
  if(type==="ExtractorEvaluationCompleted")return{evaluation_id:`extractor-eval-${cycle}`,corpus_version:"fixed-v1",extractor_version:"palette-light-v2",sample_count:40,correction_rate:.075,passed:true};
  if(type==="ChipEdited")return{block_id:referenceBlockId,chip_id:`chip-${cycle}`,property:"palette",old_value:"dusk amber",new_value:"restrained amber"};
  if(type==="GenerationRequested")return{generation_id:generationId,document_id:documentId,document_version:i,model_ids:[key==="async-return"?"deterministic-scout-v1":"gpt-5.6-terra"],...(key==="async-return"?{run_id:runId,report_space:"scout"}:{})};
  if(type==="ContextCompiled")return{generation_id:generationId,document_id:documentId,model_id:"gpt-5.6-terra",adapter_version:"openai-responses-v1",compiled_snapshot:{facts:["direction/quiet-nocturne","palette/restrained-amber"],pins:[key==="document-evolution"?`block-${key}-${cycle}-direction`:blockId],standing_constraints:key==="taste-time"?["style/restrained-grain"]:[],...(key==="document-evolution"?{spatial_targets:[{block_id:`block-${key}-${cycle}-direction`,kind:"region",region:"right",falloff:"contextual"},{block_id:`block-${key}-${cycle}-subject`,kind:"subject",subject_relation:"around"}]}:{}),tail:[],as_of:{head:i,lag:0}},source_block_versions:key==="document-evolution"?BLOCK_TYPES.map((definition)=>({block_id:`block-${key}-${cycle}-${definition.type}`,version:1})):[{block_id:blockId,version:cycle+1}]};
  if(type==="GenerationCompleted")return{generation_id:generationId,document_id:documentId,model_id:key==="async-return"?"deterministic-scout-v1":"gpt-5.6-terra",adapter_version:key==="async-return"?"scout-v1":"openai-responses-v1",object_ids:[objectId],latency_ms:key==="async-return"?0:930,variant:cycle%4,simulation:key==="async-return",...(key==="async-return"?{run_id:runId,report_space:"scout",candidate:{kind:"adjacent-palette",colors:["#2f4840","#c88358","#d7e780"]}}:{})};
  if(type==="ComparisonOpened")return{comparison_id:`comparison-${cycle}`,object_ids:[objectId,`object-${key}-${Math.max(0,cycle-1)}`]};
  if(type==="ObjectCritiqued")return{object_id:objectId,axis_ref:key==="taste-time"?"composition":"palette",polarity:key==="taste-time"?"negative":"positive",value:key==="taste-time"?"too centered":"restrained amber"};
  if(type==="ObjectPinned"||type==="ObjectViewed"||type==="ObjectSaved"||type==="ObjectDiscarded"||type==="ObjectUnpinned"||type==="ObjectExported"||type==="AddedToLibrary"||type==="RemovedFromLibrary")return{object_id:objectId,view_id:`view-${cycle}`,...(type==="ObjectExported"?{format:"png",rights_receipt_ref:`rights-${cycle}`}:{})};
  if(type==="ObjectRegenerated")return{object_id:objectId,source_generation_id:generationId,new_generation_id:`generation-${key}-${cycle}-retry`,reason:"user requested another variation"};
  if(type==="SessionClosed")return{session_id:`session-${cycle}`,closed_at_sequence:i,reason:"user-ended",duration_seconds:780};
  if(type==="SessionOpened")return{session_id:`session-${cycle+1}`,intent_ref:`intent-${cycle}`,reentry:true};
  if(type==="BriefComposed")return{brief_id:`brief-${cycle}`,source_session_id:`session-${cycle}`,items:[{item_id:`brief-item-${cycle}`,item_type:"comparison",rank:1,destination:{kind:"document",document_id:documentId}}]};
  if(type==="BriefItemPresented"||type==="BriefItemAccepted"||type==="BriefItemIgnored")return{brief_id:`brief-${cycle}`,item_id:`brief-item-${cycle}`,destination:{kind:"document",document_id:documentId},...(type==="BriefItemIgnored"?{reason:"not useful now"}:{})};
  if(type==="BriefDismissed")return{brief_id:`brief-${cycle}`,reason:"resume without assistance"};
  if(type==="PhaseGateReviewed")return{phase:6,decision:"advance-with-monitoring",evidence_refs:[`acceptance-ledger-${cycle}`,`dosage-ledger-${cycle}`],reviewer:"pilot-owner"};
  if(type==="ScoutRunStarted")return{run_id:runId,envelope:{max_observations:1,max_generations:1,max_cost_usd:.02},report_only:true};
  if(type==="ScoutObserved")return{run_id:runId,observation_id:observationId,type:"adjacency",confidence:.74,evidence_refs:[`trajectory:${cycle}`,objectId],falsifier:"User rejects the adjacent palette as unrelated."};
  if(type==="ScoutRunCompleted")return{run_id:runId,observations:1,generations:1,cost_usd:0,terminal:"envelope-satisfied"};
  if(type==="ObservationJudged")return{run_id:runId,observation_id:observationId,verdict:cycle%3===0?"unclear":"confirmed",note:"Evidence was reviewed by the user."};
  if(type==="MutationProposed")return{proposal_id:`proposal-${cycle}`,content_ref:`proposal-content-${cycle}`,expected_sequence:Math.max(0,i-2),proposed_events:[{type:"BlockPropertyEdited",payload:{block_id:blockId,property_path:"weight",new_value:.9}}]};
  if(type==="AttentionEpisodeObserved")return{episode_id:`attention-${i}`,surface:key==="attention-friction"?"studio":"library",context:key==="attention-friction"?(i%2?"comparison":"generation"):"library-browsing",visible_refs:[objectId,blockId],active_ms:42_000,idle_ms:i%2?4_000:28_000,terminal_type:i%2?"ObjectPinned":"GenerationRequested",outcome_weight:i%2?.25:.08,expires_at:new Date(Date.UTC(2026,0,19)).toISOString()};
  if(type==="AnnotationAdded"||type==="AnnotationRetracted")return{annotation_id:`annotation-${cycle}`,object_id:objectId,...(type==="AnnotationAdded"?{body_ref:`annotation-content-${cycle}`}:{reason:"comment resolved"})};
  if(type==="ProposalAccepted"||type==="ProposalRejected"||type==="ProposalDeclined")return{proposal_id:`proposal-${cycle}`,expected_sequence:Math.max(0,i-2),...(type!=="ProposalAccepted"?{reason:type==="ProposalRejected"?"not aligned with authored direction":"declined before mutation"}:{})};
  if(type==="ValidationFailed")return{attempted_type:"GenerationRequested",attempted_by:"model:forma-chat",errors:[{index:0,reason:"stale_sequence",expected:Math.max(0,i-3),actual:i}]};
  if(type==="BlockPropertyEdited")return key==="document-evolution"?{block_id:`block-${key}-${cycle}-direction`,property_path:"spatial_scope",old_value:{schema_version:1,kind:"document",coordinate_space:"document-normalized",feather:0,falloff:"hard",polarity:"inside"},new_value:{schema_version:1,kind:"region",coordinate_space:"document-normalized",region:"right",instruction:"the quiet negative space beside the subject",feather:.2,falloff:"contextual",polarity:"inside"},source_surface:"replay-document-view"}:{block_id:blockId,property_path:"weight",old_value:.8,new_value:.9};
  if(type==="FamilyDeclared")return{family_id:familyId,label:"Warm nocturnes",confidence:.81,evidence_refs:[`object-promotion-${cycle}`],embedding_model_id:"deterministic-visual-v1",source_head:i};
  if(type==="FamilyAnchorSet")return{family_id:familyId,anchor_object_ids:[`object-promotion-${cycle}`],evidence_refs:[`embedding-${cycle}`]};
  if(type==="FamilyMembershipAsserted")return{family_id:familyId,object_id:`object-promotion-${cycle}`,confidence:.77,claim_ref:`family-membership:${familyId}:object-promotion-${cycle}`};
  if(type==="CollectionCreated"){const ordinal=patternPrefix.filter(([,eventType])=>eventType==="CollectionCreated").length-1;const id=key==="document-evolution"?`collection-${cycle}-${ordinal}`:collectionId;return{collection_id:id,handle:ordinal===1?`archive-${cycle}`:`kept-warm-nocturnes-${cycle}`,parent_collection_id:null,source_claim_ref:`family:${familyId}`,position:`a${ordinal}`};}
  if(type==="CollectionItemAdded")return{collection_id:key==="document-evolution"?`collection-${cycle}-0`:collectionId,item_ref:{document_id:documentId},position:"a0"};
  if(type==="CollectionItemMoved")return{from_collection_id:`collection-${cycle}-0`,to_collection_id:`collection-${cycle}-1`,item_ref:{document_id:documentId},position:"a0"};
  if(type==="CollectionItemRemoved")return{collection_id:`collection-${cycle}-1`,item_ref:{document_id:documentId}};
  if(type==="CollectionRenamed"||type==="CollectionRemoved"||type==="CollectionRestored")return{collection_id:key==="document-evolution"?`collection-${cycle}-1`:collectionId,...(type==="CollectionRenamed"?{new_handle:`night-studies-${cycle}`}:{reason:type.toLowerCase()})};
  if(type==="TasteModelVersioned")return{version_id:`taste-version-${cycle}`,beliefs:[{beliefId:`belief-${cycle}`,claimRef:`taste:composition-${cycle}`,axis:"composition",value:"too centered",polarity:"forbid",authority:"inferred",confidence:.67,evidenceCount:3,evidenceRefs:[`theory-taste-time-${i}`],validFrom:new Date(Date.UTC(2026,0,5)).toISOString(),recordedAt:new Date(Date.UTC(2026,0,5)).toISOString(),freshness:1}],ranking_policy:{ranking_only:true,half_life_days:60}};
  if(type==="PreferenceAuthored")return{preference_id:preferenceId,axis:"composition",value:"too centered",polarity:"forbid",scope:"account",source_claim_ref:`taste:composition-${cycle}`};
  if(type==="ConditionSet")return{condition_id:conditionId,condition_ref:`condition-content-${cycle}`,trigger_kind:"generation_count",threshold:3,created_sequence:i};
  if(type==="ConditionFired")return{condition_id:conditionId,trigger_kind:"generation_count",observed_count:3};
  if(type==="Resurfaced")return{condition_id:conditionId,condition_ref:`condition-content-${cycle}`,surface:"memory"};
  if(type==="PreferenceRevoked")return{preference_id:preferenceId,reason:"changed-by-user"};
  if(type==="FactRetracted")return{fact_ref:`taste:composition-${cycle}`,reason:"forgotten-by-user"};
  if(type==="ClaimSuperseded")return{claim_ref:`family-membership:family-${cycle}:object-promotion-${cycle}`,replacement_ref:`family-membership:family-${cycle}:object-corrected-${cycle}`,reason:"human correction"};
  if(type==="IntentDeclared")return{intent_id:`intent-${cycle}`,statement_ref:`intent-content-${cycle}`,surface:"studio"};
  if(type==="AttentionSignalsForgotten")return{scope:"device",episode_count:2,reason:"user-requested"};
  if(type==="ModelRegistered")return{model_id:"gpt-5.6-terra",provider:"openai",status:"human-gated"};
  if(type==="AdapterVersioned")return{adapter_id:"openai-responses",version:"v1.4",contract_version:2};
  if(type==="CapabilityDeclared")return{model_id:"gpt-5.6-terra",capabilities:["structured-context","image-direction","adaptive-structure"]};
  if(type==="BudgetReserved")return{reservation_id:`reservation-${cycle}`,operation:"generation",reserved_tokens:32000,period:"2026-01"};
  if(type==="BudgetReleased")return{reservation_id:`reservation-${cycle}`,reserved_tokens:32000,reason:"provider-failed-before-usage"};
  if(type==="BudgetExceeded")return{operation:"generation",scope:"workspace-month",reason:"hard_cap_reached",reserved_tokens:0};
  if(type==="GenerationUsageRecorded")return{reservation_id:`reservation-${cycle}`,operation:"generation",input_tokens:4200,output_tokens:980,total_tokens:5180,reserved_tokens:32000,model_id:"gpt-5.6-terra"};
  if(type==="GenerationFailed")return{generation_id:generationId,model_id:"gpt-5.6-terra",adapter_version:"openai-responses-v1",reason:"provider_timeout",retryable:true};
  if(type==="AssistantReasoned")return{operation:"adaptive-structure",intent_ref:`intent-content-${cycle}`,content_ref:`assistant-content-${cycle}`,model_id:"gpt-5.6-terra",active_decision_type:"composition",suggested_block_types:["lighting","format"]};
  if(type==="AttributionComputed")return{object_id:objectId,generation_id:generationId,source_block_versions:[{block_id:`block-${key}-${cycle}-direction`,version:1}],method:"compiler-input-join",causal_claim:false};
  if(type==="BranchAbandoned")return{branch_id:`branch-${cycle}`,document_id:documentId,reason:"inactive-after-session-boundary",last_active_sequence:i-8};
  if(type==="ScoutBudgetExhausted")return{run_id:runId,envelope:{max_observations:2,max_generations:1,max_cost_usd:.02},observations:1,generations:1,cost_usd:.02,terminal:"budget-exhausted"};
  if(type==="RetentionSweepCompleted")return{sweep_id:`retention-${cycle}`,private_content_expired:14,event_receipts_retained:14,cutoff:"2025-12-06T00:00:00.000Z"};
  return {scenario:key,ref_id:`ref-${i}`,scope:"project"};
}

export function buildScenario(key: ScenarioKey, count: number): CreativeEvent[] {
  const list = new SignalArray<CreativeEvent>(); const pattern=baseTypes[key]; let clock=Date.UTC(2026,0,5,9);
  for(let i=0;i<count;i++){const position=i%pattern.length;const [actor,type]=pattern[position];const cycle=Math.floor(i/pattern.length);if(i){const gap=position===0?43_200_000:type==="SessionOpened"?57_600_000:type==="Resurfaced"?259_200_000:type==="ConditionFired"?86_400_000:type==="RetentionSweepCompleted"?2_592_000_000:type==="BranchAbandoned"?129_600_000:type==="DocumentOpened"?7_200_000:actor.startsWith("worker:")?4_000+(i%5)*900:actor.startsWith("model:")?12_000+(i%4)*1_500:45_000+(i%7)*15_000;clock+=gap;}const at=new Date(clock).toISOString();list.push({eventId:`theory-${key}-${i+1}`,streamId:`theory:${key}`,sequence:i+1,occurredAt:at,recordedAt:at,actor,clientId:i%17===0?"web:secondary":"web:primary",correlationId:`corr-${key}-${cycle}`,causationId:i?`theory-${key}-${i}`:null,compensatesEventId:null,schemaVersion:1,type,payload:payloadFor(type,i,key,cycle)});}
  return Array.from(list);
}
