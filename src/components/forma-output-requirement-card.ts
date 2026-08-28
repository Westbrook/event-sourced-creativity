import { html, noChange, nothing, type PropertyValues, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { live } from "lit/directives/live.js";
import {
  formatOutputAspectRatio, inspectOutputRequirement, parseOutputAspectRatio, parseOutputRequirement,
  outputRequirementInterpretationBasis, outputRequirementInterpretationNeedsReview,
  outputRequirementWithWording, confirmOutputRequirementInterpretation,
  isOutputRequirementLabel, outputRequirementEditableDraft, OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH,
  type OutputCountPolicy, type OutputDeliverable, type OutputFormatVariant,
  type OutputMediaKind, type OutputQuantity, type OutputRequirementSpec, type OutputSeriesMember,
} from "../model/output-requirements.ts";
import { FormaPresentationalElement } from "./presentational-element";
import { nextFormaId } from "./design-system/contracts";
import { formaLocaleFamily } from "./design-system/localization";
import { FORMA_OUTPUT_REQUIREMENT_MESSAGES, type OutputRequirementMessageKey } from "./design-system/locales/output-requirement-messages.ts";
import {
  moveOutputDraftRow, outputDraftLines, outputMediaQuantityUnit, outputQuantityToDraft, outputSaveReplyCanCloseDraft,
  readOutputCountPolicyDraft, readOutputQuantityDraft, type OutputCountPolicyDraft, type OutputQuantityDraft,
  compareOutputInterpretations, outputInterpretationDecisions, retainOutputInterpretationPlanning,
  outputReinterpretationNeedsConfirmation,
  type OutputInterpretationChange, type OutputInterpretationDecision,
} from "./output-requirement-editor.ts";
import "./forma-output-requirement-card.css";

export type OutputCardScope = { projectId: string; documentId: string; authorizationScopeKey: string };
export type OutputCardRevision = string | number | null;
export type OutputCardResourceState = "loading" | "ready" | "refreshing" | "unavailable";
export type OutputCardPlanSuggestions = { countPolicies: Record<string, OutputCountPolicy>; suggestedCounts: Record<string, number> };
export type OutputRequirementCardSnapshot = {
  scope: OutputCardScope;
  requirementId: string;
  /** Position in the current authorized view; presentation only, not saved state. */
  requirementOrdinal?: number;
  /** Current Document display context only; never part of an edit or approval intent. */
  documentContext?: { projectId: string; documentId: string; title: string; ordinal: number };
  revision: OutputCardRevision;
  label: string;
  originalText: string;
  spec: unknown;
  canEdit: boolean;
  canReviewPlan: boolean;
  summary: {
    headline: string; detail: string; overall: "unknown" | "unresolved" | "planned" | "partial" | "complete";
    requiredRemaining: number | null; unresolvedGroups: number | null;
    /** Unique accepted, current physical files. Property name retained for host compatibility. */
    selectedResultFiles: number | null;
  };
  sourceOptions: Array<{ id: string; label: string }>;
  planSuggestions?: OutputCardPlanSuggestions;
  results?: Array<{ targetId: string; artifactId: string; revision: string; title: string; stateLabel: string; canOpen: boolean }>;
};
export type OutputCardEditorState = {
  status: "idle" | "saving" | "saved" | "conflict" | "invalid" | "forbidden" | "unavailable";
  clientMutationId?: string;
  issues?: Array<{ path: string; message: string }>;
  latest?: OutputRequirementCardSnapshot;
};
export type OutputCardIntentScope = { scope: OutputCardScope; requirementId: string; expectedRevision: OutputCardRevision };
export type OutputRequirementEditIntent = OutputCardIntentScope & { action: "open" | "reapply" };
export type OutputRequirementSaveIntent = OutputCardIntentScope & {
  clientMutationId: string; draft: OutputRequirementSpec; planSuggestions: OutputCardPlanSuggestions;
};
export type OutputRequirementCancelIntent = OutputCardIntentScope & { discarded: boolean };
export type OutputRequirementReviewPlanIntent = OutputCardIntentScope & { planSuggestions: OutputCardPlanSuggestions };
export type OutputRequirementOpenResultIntent = OutputCardIntentScope & {
  targetId: string; artifactId: string; artifactRevision: string;
};
type DraftSession = {
  scope: OutputCardScope; requirementId: string; baseRevision: OutputCardRevision;
  label: string; originalText: string; acceptedWording: string; spec: OutputRequirementSpec;
  quantities: Map<string, OutputQuantityDraft>; text: Map<string, string>; policies: Map<string, OutputCountPolicyDraft>;
  planSuggestions: OutputCardPlanSuggestions; planningBasisSpec: OutputRequirementSpec; editedPolicyIds: Set<string>;
  dirty: boolean; structuredDirty: boolean; editVersion: number;
  pendingMutation: { id: string; fingerprint: string; editVersion: number } | null;
};
type CoverageOwner = Pick<OutputDeliverable, "id" | "source_scope" | "coverage">;
type TextFieldOptions = { multiline?: boolean; rows?: number; help?: string; numeric?: boolean; direction?: "auto" | "ltr"; errorKey?: string; ownerId?: string; sectionLabel?: string };
const MEDIA: OutputMediaKind[] = ["unknown", "image", "slides", "audio", "video", "document"];
const scopeKey = (scope: OutputCardScope, requirementId: string) => JSON.stringify([scope.authorizationScopeKey, scope.projectId, scope.documentId, requirementId]);

/**
 * @tag forma-output-requirement-card
 * @summary Author requested deliverables with native forms and inspect authoritative output status.
 * @property {OutputRequirementCardSnapshot | null} snapshot - Authorized property-only requirement and whole-scope status.
 * @property {OutputCardResourceState} resourceState - Loading, ready, refreshing, or unavailable; never inferred from empty rows.
 * @property {"full" | "compact"} presentation - Full editor or compact saved-status summary.
 * @property {OutputCardEditorState} editorState - Command response, matched by mutation identity before a draft is closed.
 * @property {string} readOnlyReason - Already-localized reason editing is unavailable.
 * @fires {CustomEvent<OutputRequirementEditIntent>} forma-output-edit - The user opens or deliberately reapplies a local draft.
 * @fires {CustomEvent<OutputRequirementSaveIntent>} forma-output-save - Save the reviewed requirement with its expected revision; no execution authority.
 * @fires {CustomEvent<OutputRequirementCancelIntent>} forma-output-cancel - Editing ended after preserving or explicitly discarding changes.
 * @fires {CustomEvent<OutputRequirementReviewPlanIntent>} forma-output-review-plan - Inspect the saved plan; never start generation.
 * @fires {CustomEvent<OutputRequirementOpenResultIntent>} forma-output-open-result - Inspect an authorized exact result revision.
 * @cssprop {<color>} --forma-color-border-strong - Native field and full-perimeter state boundary.
 * @cssprop {<color>} --forma-color-danger-text - Field validation copy.
 * @cssprop {<length>} --forma-control-min-size - Minimum native control target size.
 * @cssprop {<length>} --forma-space-4 - Card and field spacing.
 */
export class FormaOutputRequirementCard extends FormaPresentationalElement {
  static properties = {
    snapshot: { attribute: false }, resourceState: { attribute: false }, presentation: { attribute: false },
    editorState: { attribute: false }, readOnlyReason: { attribute: false },
  };
  snapshot: OutputRequirementCardSnapshot | null = null;
  resourceState: OutputCardResourceState = "loading";
  presentation: "full" | "compact" = "full";
  editorState: OutputCardEditorState = { status: "idle" };
  readOnlyReason = "";
  #id = nextFormaId("output-requirement");
  #session: DraftSession | null = null;
  #cache = new Map<string, DraftSession>();
  #activeKey = "";
  #authorizationKey = "";
  #editing = false;
  #waiting = false;
  #status: OutputRequirementMessageKey | "" = "";
  #announcement = "";
  #errors = new Map<string, OutputRequirementMessageKey>();
  #composing = new Set<string>();
  #fieldIds = new Map<string, string>();
  #parseProposal: { spec: OutputRequirementSpec; previous: OutputRequirementSpec; planning: OutputCardPlanSuggestions; changes: OutputInterpretationChange[]; editVersion: number; recognized: boolean } | null = null;
  #cancelIntent: "cancel" | "reload" | null = null;
  #opener: HTMLElement | null = null;
  #resolvedConflictMarker = "";
  #mediumChange: { deliverableId: string; kind: OutputMediaKind } | null = null;
  #conflictReviewedAt = "";
  #interpretationReviewedAt = -1;

  #t(key: OutputRequirementMessageKey, values: Record<string, string | number> = {}) {
    const family = formaLocaleFamily(this.i18n.locale) as keyof typeof FORMA_OUTPUT_REQUIREMENT_MESSAGES;
    const id = `output.requirement.${key}` as const;
    // Use the scoped controller; the bundle fallback also makes the independent fixture complete.
    const fallback = (FORMA_OUTPUT_REQUIREMENT_MESSAGES[family] ?? FORMA_OUTPUT_REQUIREMENT_MESSAGES.en)[id];
    const scoped = this.i18n.messages[id];
    return (scoped && scoped !== FORMA_OUTPUT_REQUIREMENT_MESSAGES.en[id] ? scoped : fallback).replace(/\{(\w+)\}/gu, (_, name: string) => String(values[name] ?? ""));
  }
  #isolate(value: string) { return "\u2068" + value + "\u2069"; }
  #documentContext() {
    const scope = this.snapshot?.scope, context = this.snapshot?.documentContext;
    if (!scope) return "";
    return context?.projectId === scope.projectId && context.documentId === scope.documentId
      && typeof context.title === "string" && Number.isSafeInteger(context.ordinal) && context.ordinal > 0
      ? this.#t("contextDocument", { number: this.i18n.number(context.ordinal), name: this.#isolate(context.title) })
      : this.#t("contextDocumentIdentity", { identity: this.#isolate(scope.documentId) });
  }
  #requirementContext() {
    const name = this.#isolate(this.#session?.label || this.snapshot?.label || this.#t("heading"));
    const ordinal = this.snapshot?.requirementOrdinal;
    const requirement = typeof ordinal === "number" && Number.isSafeInteger(ordinal) && ordinal > 0
      ? this.#t("contextRequirement", { number: this.i18n.number(ordinal), name })
      : this.#t("contextRequirementIdentity", { name, identity: this.#isolate(this.snapshot?.requirementId || this.#id) });
    return [this.#documentContext(), requirement].filter(Boolean).join(" · ");
  }
  #context(ownerId = "") {
    const spec = this.#session?.spec ?? outputRequirementEditableDraft(this.snapshot?.spec);
    const requirement = this.#requirementContext();
    const rows = (spec?.deliverables ?? []).flatMap((deliverable, index) => {
      const parent = this.#t("contextDeliverable", { number: this.i18n.number(index + 1), name: this.#isolate(deliverable.label || this.#t("untitledGroup")) });
      return [
        { id: deliverable.id, deliverable, labels: [requirement, parent] },
        ...(deliverable.format_variants ?? []).map((variant, position) => ({ id: variant.id, deliverable, labels: [requirement, parent,
          this.#t("contextFormat", { number: this.i18n.number(position + 1), name: this.#isolate(variant.label || this.#t("unnamedFormat")) })] })),
        ...(deliverable.series?.members ?? []).map((member, position) => ({ id: member.id, deliverable, labels: [requirement, parent,
          this.#t("contextMember", { number: this.i18n.number(position + 1), name: this.#isolate(member.label || this.#t("unnamedVideo")) })] })),
      ];
    });
    // A native field key may contain another row ID; callers supply its exact render owner.
    const owner = rows.find(row => row.id === ownerId);
    if (!owner) return requirement;
    return owner.labels.join(" · ");
  }
  #controlName(label: string, ownerId = "", detail = "") { return [label, this.#context(ownerId), detail].filter(Boolean).join(" · "); }
  #resultContext(result: NonNullable<OutputRequirementCardSnapshot["results"]>[number]) {
    const position = this.snapshot?.results?.findIndex(candidate => candidate.targetId === result.targetId && candidate.artifactId === result.artifactId && candidate.revision === result.revision) ?? -1;
    return this.#t("contextResult", { number: this.i18n.number(position + 1), name: this.#isolate(result.title) });
  }
  #fieldId(key: string) {
    let id = this.#fieldIds.get(key);
    if (!id) { id = `${this.#id}-field-${this.#fieldIds.size + 1}`; this.#fieldIds.set(key, id); }
    return id;
  }
  #emit<T>(name: string, detail: T) { this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true, cancelable: true })); }
  #intent(session = this.#session): OutputCardIntentScope | null {
    if (session) return { scope: { ...session.scope }, requirementId: session.requirementId, expectedRevision: session.baseRevision };
    const value = this.snapshot;
    return value ? { scope: { ...value.scope }, requirementId: value.requirementId, expectedRevision: value.revision } : null;
  }
  #latest() {
    const candidate = this.editorState.latest;
    return candidate && scopeKey(candidate.scope, candidate.requirementId) === this.#activeKey ? candidate : this.snapshot;
  }
  #conflictMarker() { return JSON.stringify([this.#latest()?.revision, this.editorState.clientMutationId ?? ""]); }
  #hasConflict() {
    if (!this.#editing || !this.#session) return false;
    const latest = this.#latest();
    return !!latest && (latest.revision !== this.#session.baseRevision || (this.editorState.status === "conflict" && this.#resolvedConflictMarker !== this.#conflictMarker()));
  }
  #unsupported() { return this.snapshot?.spec != null && inspectOutputRequirement(this.snapshot.spec).status === "unsupported"; }
  #nestedForm() { return this.closest("form") !== null; }
  #canEdit() { return !!this.snapshot?.canEdit && !this.readOnlyReason && !this.#unsupported() && !this.#nestedForm(); }
  #fieldsDisabled() { return !this.#canEdit() || this.#waiting || this.editorState.status === "saving"; }
  #canSave() { return this.#canEdit() && this.resourceState === "ready" && !this.#waiting && this.editorState.status !== "saving" && this.editorState.status !== "forbidden" && !this.#hasConflict(); }

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has("snapshot")) {
      const next = this.snapshot;
      const nextAuthorization = next?.scope.authorizationScopeKey ?? "";
      const nextKey = next ? scopeKey(next.scope, next.requirementId) : "";
      if (this.#authorizationKey && nextAuthorization !== this.#authorizationKey) {
        this.#cache.clear(); this.#session = null; this.#editing = false; this.#composing.clear();
      }
      if (nextKey !== this.#activeKey) {
        if (this.#session?.dirty && this.#activeKey) this.#cache.set(this.#activeKey, this.#session);
        this.#session = null; this.#editing = false; this.#waiting = false;
        this.#errors.clear(); this.#composing.clear(); this.#status = ""; this.#announcement = "";
        this.#cancelIntent = null; this.#parseProposal = null; this.#resolvedConflictMarker = ""; this.#mediumChange = null; this.#interpretationReviewedAt = -1; this.#conflictReviewedAt = "";
        this.#activeKey = nextKey;
      }
      this.#authorizationKey = nextAuthorization;
    }
    const ownReply = !!this.#session?.pendingMutation && this.editorState.clientMutationId === this.#session.pendingMutation.id;
    if (ownReply && this.editorState.status !== "saving" && this.editorState.status !== "idle") this.#waiting = false;
    if (ownReply && this.editorState.status === "saved" && this.snapshot) {
      if (outputSaveReplyCanCloseDraft(this.editorState.clientMutationId, this.#session!.pendingMutation?.id, this.#session!.editVersion, this.#session!.pendingMutation?.editVersion)) {
        this.#cache.delete(this.#activeKey); this.#session = null; this.#editing = false;
        this.#status = "saved"; this.#errors.clear(); this.#focusSummary();
      } else this.#status = "newerDraftRetained";
    }
  }
  #focus(key: string) { void this.updateComplete.then(() => this.querySelector<HTMLElement>(`#${this.#fieldId(key)}`)?.focus({ preventScroll: true })); }
  #focusSummary() { void this.updateComplete.then(() => this.querySelector<HTMLElement>(`#${this.#id}-heading`)?.focus({ preventScroll: true })); }
  #blankSpec(id: string, label: string, originalText: string): OutputRequirementSpec {
    return { schema_version: 1, id, label, original_text: originalText, deliverables: [], value_origins: {} };
  }
  #editableSpec(spec: OutputRequirementSpec) {
    const copy = structuredClone(spec);
    copy.deliverables = copy.deliverables.map((value) => ({ ...value, ...(value.content_quantity ? {} : value.media_kind === "slides" ? { content_quantity: { kind: "unknown" as const, unit: "slide" as const } } : value.media_kind === "audio" || value.media_kind === "video" ? { content_quantity: { kind: "unknown" as const, unit: "second" as const } } : {}) }));
    return copy;
  }
  #newSession(snapshot: OutputRequirementCardSnapshot): DraftSession {
    const editable = outputRequirementEditableDraft(snapshot.spec);
    const spec = editable ? this.#editableSpec(editable) : this.#blankSpec(snapshot.requirementId, snapshot.label, snapshot.originalText);
    return {
      scope: { ...snapshot.scope }, requirementId: snapshot.requirementId, baseRevision: snapshot.revision,
      label: snapshot.label, originalText: snapshot.originalText,
      acceptedWording: editable ? snapshot.originalText : "", spec,
      planSuggestions: structuredClone(snapshot.planSuggestions ?? { countPolicies: {}, suggestedCounts: {} }), planningBasisSpec: structuredClone(spec), editedPolicyIds: new Set(),
      quantities: new Map(), text: new Map(), policies: new Map(), dirty: false, structuredDirty: !!editable?.deliverables.length, editVersion: 0, pendingMutation: null,
    };
  }
  #open(event: Event) {
    if (!this.#canEdit() || !this.snapshot) return;
    this.#opener = event.currentTarget as HTMLElement;
    this.#session = this.#cache.get(this.#activeKey) ?? this.#newSession(this.snapshot);
    this.#editing = true; this.#status = inspectOutputRequirement(this.snapshot.spec).status === "invalid" && outputRequirementEditableDraft(this.snapshot.spec) ? "invalidLabelsPreserved" : ""; this.#waiting = false; this.#errors.clear();
    this.#interpretationReviewedAt = -1; this.#conflictReviewedAt = "";
    this.#emit<OutputRequirementEditIntent>("forma-output-edit", { ...this.#intent()!, action: "open" });
    this.requestUpdate(); this.#focus("originalText");
  }
  #touch(structured = true, field = "") {
    if (!this.#session) return;
    this.#session.dirty = true;
    this.#session.editVersion += 1;
    if (structured) this.#session.structuredDirty = true;
    if (field) this.#errors.delete(field);
    this.#parseProposal = null;
    this.#status = ""; this.requestUpdate();
  }
  #parse() {
    const session = this.#session;
    if (!session || this.#fieldsDisabled()) return;
    const before = this.#comparisonDraft();
    const beforePlanning = this.#currentPlanning(before);
    const parsed = parseOutputRequirement({ id: session.requirementId, Type: "Output", Subtype: session.label, Content: session.originalText }, session.spec);
    const proposed = parsed.spec ? this.#editableSpec(parsed.spec) : this.#blankSpec(session.requirementId, session.label, session.originalText);
    // These are newly proposed labels, not translations of the authored request.
    for (const value of proposed.deliverables) {
      if (value.media_kind !== "unknown") value.label = this.#t(value.series ? "series" : `media.${value.media_kind}`);
      if (value.coverage.kind === "unresolved") value.coverage.description = this.#t("coverageDescription");
      if (value.series) value.series.description = this.#t("seriesHelp");
      for (const variant of value.format_variants ?? []) variant.label = `${variant.aspect_ratio ? formatOutputAspectRatio(variant.aspect_ratio) : this.#t("ratioUnknown")} · ${this.#t(`media.${value.media_kind}`)}`;
    }
    const planning = retainOutputInterpretationPlanning(before, proposed, beforePlanning);
    const changes = [...compareOutputInterpretations(before, proposed, beforePlanning, planning), ...this.#uncommittedDraftChanges()];
    this.#parseProposal = { spec: proposed, previous: before, planning, changes, editVersion: session.editVersion, recognized: parsed.recognized };
    // Persisted decisions need protection even when no structured field was touched in this session.
    if (outputReinterpretationNeedsConfirmation(session.spec, session.structuredDirty)) { this.requestUpdate(); this.#focus("proposalComparison"); }
    else this.#acceptParseProposal();
  }
  #acceptParseProposal() {
    const session = this.#session, proposal = this.#parseProposal;
    if (!session || !proposal || this.#fieldsDisabled()) return;
    if (session.editVersion !== proposal.editVersion || session.originalText !== proposal.spec.original_text) { this.#parse(); return; }
    session.spec = structuredClone(proposal.spec); session.acceptedWording = session.originalText;
    session.planSuggestions = structuredClone(proposal.planning); session.planningBasisSpec = structuredClone(proposal.spec);
    session.quantities.clear(); session.text.clear(); session.policies.clear(); session.editedPolicyIds.clear();
    session.dirty = true; session.structuredDirty = true; session.pendingMutation = null; session.editVersion += 1;
    this.#status = proposal.recognized ? "proposalDraft" : "proposalNotRecognized";
    this.#errors.clear(); this.#parseProposal = null; this.requestUpdate(); this.#focus("groups");
  }
  #keepWordingOnly() {
    const session = this.#session;
    if (!session || this.#fieldsDisabled() || !session.spec.deliverables.length) return;
    session.spec = outputRequirementWithWording(session.spec, session.originalText);
    session.acceptedWording = session.originalText;
    this.#touch(false, "originalText"); this.#status = "wordingRetained"; this.requestUpdate();
  }
  #confirmRetainedInterpretation() {
    const session = this.#session;
    if (!session || this.#fieldsDisabled() || session.originalText !== session.acceptedWording || this.#interpretationReviewedAt !== session.editVersion || inspectOutputRequirement(this.#comparisonDraft()).status !== "valid" || this.#uncommittedDraftChanges().length) return;
    // This button follows an explicit display of every retained decision, not an automatic wording match.
    session.spec = confirmOutputRequirementInterpretation(outputRequirementWithWording(session.spec, session.originalText));
    this.#touch(); this.#status = "retainedInterpretationConfirmed"; this.requestUpdate();
  }
  #cancel() {
    if (!this.#session || this.#waiting) return;
    if (this.#session.dirty) { this.#cancelIntent = "cancel"; this.requestUpdate(); this.#focus("keepEditing"); return; }
    this.#close(false);
  }
  #close(discarded: boolean) {
    const intent = this.#intent();
    this.#cache.delete(this.#activeKey); this.#session = null; this.#editing = false;
    this.#cancelIntent = null; this.#parseProposal = null; this.#errors.clear(); this.#status = ""; this.#interpretationReviewedAt = -1; this.#conflictReviewedAt = "";
    if (intent) this.#emit<OutputRequirementCancelIntent>("forma-output-cancel", { ...intent, discarded });
    this.requestUpdate();
    void this.updateComplete.then(() => { if (this.#opener?.isConnected) this.#opener.focus({ preventScroll: true }); else this.#focusSummary(); });
  }
  #discard() {
    if (this.#cancelIntent === "reload") {
      const latest = this.#latest();
      if (latest) { this.#session = this.#newSession(latest); this.#resolvedConflictMarker = this.#conflictMarker(); this.#cancelIntent = null; this.#status = ""; this.#errors.clear(); this.#interpretationReviewedAt = -1; this.#conflictReviewedAt = ""; this.requestUpdate(); this.#focus("originalText"); }
    } else this.#close(true);
  }
  #reapply() {
    const latest = this.#latest();
    if (!latest || !this.#session || this.resourceState !== "ready" || !this.#canEdit() || inspectOutputRequirement(latest.spec).status !== "valid" || this.#conflictReviewedAt !== `${this.#conflictMarker()}:${this.#session.editVersion}`) return;
    this.#session.baseRevision = latest.revision; this.#session.pendingMutation = null;
    this.#conflictReviewedAt = "";
    this.#resolvedConflictMarker = this.#conflictMarker(); this.#status = "reapplied";
    this.#emit<OutputRequirementEditIntent>("forma-output-edit", { ...this.#intent()!, action: "reapply" });
    this.requestUpdate(); this.#focus("save");
  }
  #updateDeliverable(id: string, update: (value: OutputDeliverable) => OutputDeliverable) {
    if (!this.#session) return;
    this.#session.spec.deliverables = this.#session.spec.deliverables.map((value) => value.id === id ? this.#markEdited(value, update(value)) : value);
    this.#touch();
  }
  #markEdited<T extends { value_origins: OutputRequirementSpec["value_origins"] }>(before: T, after: T): T {
    const value_origins = { ...after.value_origins };
    for (const key of Object.keys(after) as Array<keyof T & string>) {
      if (["id", "original_text", "value_origins"].includes(key)) continue;
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) value_origins[key] = { kind: "authored" };
    }
    return { ...after, value_origins };
  }
  #updateMember(deliverableId: string, memberId: string, update: (value: OutputSeriesMember) => OutputSeriesMember) {
    this.#updateDeliverable(deliverableId, (value) => value.series ? {
      ...value, series: { ...value.series, state: "unresolved", members: value.series.members.map((member) => member.id === memberId ? this.#markEdited(member, update(member)) : member) },
    } : value);
  }
  #updateVariant(deliverableId: string, variantId: string, update: (value: OutputFormatVariant) => OutputFormatVariant) {
    this.#updateDeliverable(deliverableId, (value) => ({ ...value, format_variants: value.format_variants?.map((variant) => variant.id === variantId ? this.#markEdited(variant, update(variant)) : variant) }));
  }
  #changeMedium(id: string, media_kind: OutputMediaKind) {
    this.#updateDeliverable(id, (current) => ({
      ...current, media_kind, quantity: { kind: "unknown", unit: outputMediaQuantityUnit(media_kind) },
      content_quantity: media_kind === "slides" ? { kind: "unknown", unit: "slide" } : media_kind === "audio" || media_kind === "video" ? { kind: "unknown", unit: "second" } : undefined,
      series: media_kind === "video" ? current.series : undefined,
      format_variants: media_kind === "image" || media_kind === "video" ? current.format_variants?.map((variant) => ({ ...variant, quantity: { kind: "unknown", unit: outputMediaQuantityUnit(media_kind) } })) : undefined,
    }));
    this.#session?.quantities.delete(`${id}:quantity`); this.#session?.quantities.delete(`${id}:content`);
    for (const variant of this.#session?.spec.deliverables.find((value) => value.id === id)?.format_variants ?? []) this.#session?.quantities.delete(`${variant.id}:quantity`);
    this.#mediumChange = null; this.requestUpdate();
  }
  #addDeliverable() {
    if (!this.#session) return;
    const id = crypto.randomUUID();
    this.#session.spec.deliverables.push({
      id, label: "", media_kind: "unknown", required: true, quantity: { kind: "unknown", unit: "member" },
      source_scope: { kind: "document" }, coverage: { kind: "unresolved", description: "" }, original_text: "", value_origins: {},
    });
    this.#touch(); this.#focus(`${id}:label`);
  }
  #removeDeliverable(value: OutputDeliverable) {
    if (!this.#session) return;
    const rows = this.#session.spec.deliverables; const index = rows.findIndex((item) => item.id === value.id);
    this.#session.spec.deliverables = rows.filter((item) => item.id !== value.id);
    this.#announcement = this.#t("removed", { name: value.label || this.#t("untitledGroup") });
    this.#touch(); const neighbor = this.#session.spec.deliverables[index] ?? this.#session.spec.deliverables[index - 1];
    this.#focus(neighbor ? `${neighbor.id}:label` : "groups");
  }
  #addVariant(deliverable: OutputDeliverable) {
    const id = crypto.randomUUID();
    this.#updateDeliverable(deliverable.id, (value) => ({ ...value, format_variants: [...(value.format_variants ?? []), {
      id, label: "", required: true, aspect_ratio: null, quantity: { kind: "unknown", unit: outputMediaQuantityUnit(value.media_kind) },
      placements: [], original_text: "", value_origins: {},
    }] }));
    this.#focus(`${id}:label`);
  }
  #addMember(deliverable: OutputDeliverable) {
    const id = crypto.randomUUID();
    this.#updateDeliverable(deliverable.id, (value) => ({ ...value, quantity: { kind: "unknown", unit: "video" }, series: {
      state: "unresolved", description: value.series?.description ?? "", members: [...(value.series?.members ?? []), {
        id, label: "", required: true, source_scope: { kind: "document" }, coverage: { kind: "unresolved", description: "" },
        quantity: { kind: "exact", unit: "video", value: 1 }, original_text: "", value_origins: {},
      }],
    } }));
    this.#session?.quantities.delete(`${deliverable.id}:quantity`);
    this.#focus(`${id}:label`);
  }
  #moveMember(deliverable: OutputDeliverable, member: OutputSeriesMember, direction: -1 | 1) {
    const members = moveOutputDraftRow(deliverable.series?.members ?? [], member.id, direction);
    this.#updateDeliverable(deliverable.id, (value) => value.series ? { ...value, series: { ...value.series, members } } : value);
    this.#announcement = this.#t("moved", { name: member.label || this.#t("unnamedVideo"), position: this.i18n.number(members.findIndex((item) => item.id === member.id) + 1) });
    this.#focus(`${member.id}:label`);
  }
  #removeMember(deliverable: OutputDeliverable, member: OutputSeriesMember) {
    const members = deliverable.series?.members ?? []; const index = members.findIndex((item) => item.id === member.id);
    const next = members.filter((item) => item.id !== member.id);
    this.#updateDeliverable(deliverable.id, (value) => value.series ? {
      ...value, quantity: { kind: "unknown", unit: "video" }, series: { ...value.series, state: "unresolved", members: next },
    } : value);
    this.#session?.quantities.delete(`${deliverable.id}:quantity`);
    this.#announcement = this.#t("removed", { name: member.label || this.#t("unnamedVideo") });
    const neighbor = next[index] ?? next[index - 1]; this.#focus(neighbor ? `${neighbor.id}:label` : `${deliverable.id}:series`);
  }
  #confirmSeries(deliverable: OutputDeliverable) {
    if (!this.#session) return;
    const members = (deliverable.series?.members ?? []).map((member) => this.#materializeCoverage(member));
    const valid = members.length > 0 && members.every((member) => member.label.trim() && member.coverage.kind !== "unresolved" && member.source_scope.kind !== "unknown" && member.quantity.kind === "exact" && member.quantity.value === 1);
    if (!valid) { this.#errors.set(`${deliverable.id}:series`, "seriesInvalid"); this.requestUpdate(); this.#focus(`${deliverable.id}:series`); return; }
    this.#errors.delete(`${deliverable.id}:series`);
    this.#updateDeliverable(deliverable.id, (value) => value.series ? {
      ...value, quantity: { kind: "exact", unit: "video", value: members.length },
      series: { ...value.series, state: "resolved", members }, value_origins: { ...value.value_origins, quantity: { kind: "confirmed" } },
    } : value);
    this.#session.quantities.delete(`${deliverable.id}:quantity`);
    this.#announcement = this.#t("seriesResolved");
  }
  #quantityDraft(key: string, value: OutputQuantity) {
    const session = this.#session!;
    if (!session.quantities.has(key)) session.quantities.set(key, outputQuantityToDraft(value));
    return session.quantities.get(key)!;
  }
  #textValue(key: string, fallback: string) { return this.#session?.text.get(key) ?? fallback; }
  #setText(key: string, value: string) { this.#session?.text.set(key, value); this.#touch(true, key); }
  #materializeCoverage<T extends CoverageOwner>(owner: T): T {
    let coverage = owner.coverage;
    if (coverage.kind === "topics") {
      const topics = outputDraftLines(this.#textValue(`${owner.id}:topics`, coverage.topics.join("\n")));
      coverage = topics.length ? { kind: "topics", topics } : { kind: "unresolved", description: this.#t("coverage.unresolved") };
    }
    if (coverage.kind === "unresolved" && !coverage.description.trim()) coverage = { kind: "unresolved", description: this.#t("coverage.unresolved") };
    const source = owner.source_scope;
    return { ...owner, coverage, source_scope: source.kind === "blocks" && source.block_ids.length === 0 ? { kind: "unknown", reason: "not_decided" } : source };
  }
  #comparisonDraft(): OutputRequirementSpec {
    const session = this.#session!;
    const draft = structuredClone(session.spec);
    const quantity = (key: string, previous: OutputQuantity) => {
      const fields = session.quantities.get(key);
      return fields ? readOutputQuantityDraft(fields).quantity ?? previous : previous;
    };
    draft.label = session.label; draft.original_text = session.originalText;
    draft.deliverables = draft.deliverables.map((group) => {
      const value = this.#materializeCoverage(group);
      value.quantity = quantity(`${value.id}:quantity`, value.quantity);
      if (value.content_quantity) value.content_quantity = quantity(`${value.id}:content`, value.content_quantity);
      if (value.format_variants) value.format_variants = value.format_variants.map((variant) => {
        const text = this.#textValue(`${variant.id}:ratio`, variant.aspect_ratio ? formatOutputAspectRatio(variant.aspect_ratio) : "").trim();
        return { ...variant, quantity: quantity(`${variant.id}:quantity`, variant.quantity), aspect_ratio: text ? parseOutputAspectRatio(text) ?? variant.aspect_ratio : null, placements: outputDraftLines(this.#textValue(`${variant.id}:placements`, variant.placements.join("\n"))) };
      });
      if (value.series) value.series.members = value.series.members.map((member) => this.#materializeCoverage(member));
      return value;
    });
    return draft;
  }
  #currentPlanning(spec: OutputRequirementSpec): OutputCardPlanSuggestions {
    const session = this.#session!;
    const planning = retainOutputInterpretationPlanning(session.planningBasisSpec, spec, session.planSuggestions);
    for (const group of spec.deliverables) {
      if (!group.content_quantity || !session.editedPolicyIds.has(group.id)) continue;
      const fields = session.policies.get(group.id);
      if (!fields) continue;
      const unitKey = `${group.id}:${group.content_quantity.unit}`;
      const key = Object.hasOwn(session.planSuggestions.countPolicies, unitKey) || Object.hasOwn(session.planSuggestions.suggestedCounts, unitKey) ? unitKey : group.id;
      delete planning.countPolicies[group.id]; delete planning.countPolicies[unitKey];
      delete planning.suggestedCounts[group.id]; delete planning.suggestedCounts[unitKey];
      const result = readOutputCountPolicyDraft(group.content_quantity, fields);
      if (result.policy) planning.countPolicies[key] = result.policy;
      if (result.suggestedCount !== null) planning.suggestedCounts[key] = result.suggestedCount;
    }
    return planning;
  }
  #uncommittedDraftChanges(): OutputInterpretationChange[] {
    const session = this.#session!;
    const spec = this.#comparisonDraft();
    const names = new Map(outputInterpretationDecisions(spec, { countPolicies: {}, suggestedCounts: {} }).map((row) => [row.ownerId, row.label]));
    const changes: OutputInterpretationChange[] = [];
    const add = (key: string, value: unknown) => {
      const ownerId = [...names.keys()].sort((left, right) => right.length - left.length).find((id) => key.startsWith(`${id}:`)) ?? spec.id;
      changes.push({ key: `raw:${key}`, ownerId, label: names.get(ownerId) ?? session.label, field: "draftText", kind: "removed", before: value, after: undefined });
    };
    for (const [key, value] of session.quantities) if (readOutputQuantityDraft(value).issue) add(key, value.kind === "range" ? `${value.min} – ${value.max}` : value.exact);
    for (const [key, value] of session.text) if (key.endsWith(":ratio") && value.trim() && !parseOutputAspectRatio(value)) add(key, value);
    for (const [id, value] of session.policies) {
      const group = spec.deliverables.find((entry) => entry.id === id);
      if (group?.content_quantity && readOutputCountPolicyDraft(group.content_quantity, value).issue) add(`${id}:policy`, value.kind === "exact" ? value.exact : value.aim);
    }
    return changes;
  }
  #readQuantity(key: string, value: OutputQuantity): OutputQuantity {
    const draft = this.#quantityDraft(key, value); const result = readOutputQuantityDraft(draft);
    if (result.issue) this.#errors.set(`${key}:${draft.kind === "exact" ? "exact" : "min"}`, `error.${result.issue}`);
    if (value.kind === "unknown" && draft.kind === "unknown") return value;
    return result.quantity ?? value;
  }
  #policyDraft(deliverable: OutputDeliverable): OutputCountPolicyDraft {
    const session = this.#session!;
    if (!session.policies.has(deliverable.id)) {
      const unitKey = `${deliverable.id}:${deliverable.content_quantity?.unit ?? "slide"}`;
      const policy = session.planSuggestions.countPolicies[unitKey] ?? session.planSuggestions.countPolicies[deliverable.id];
      const aim = session.planSuggestions.suggestedCounts[unitKey] ?? session.planSuggestions.suggestedCounts[deliverable.id] ?? (policy?.kind === "flexible" ? policy.aim : undefined);
      session.policies.set(deliverable.id, { kind: policy?.kind ?? "flexible", aim: aim === undefined ? "" : String(aim), exact: policy?.kind === "exact" ? String(policy.value) : "" });
    }
    return session.policies.get(deliverable.id)!;
  }
  #materialize(): { draft: OutputRequirementSpec; planSuggestions: OutputCardPlanSuggestions } | null {
    const session = this.#session;
    if (!session) return null;
    this.#errors.clear();
    if (session.originalText !== session.acceptedWording) { this.#errors.set("originalText", "needsReparse"); return null; }
    if (!session.spec.deliverables.length) { this.#errors.set("groups", "error.noGroups"); return null; }
    const draft = structuredClone(session.spec);
    draft.label = session.label; draft.original_text = session.originalText;
    if (!isOutputRequirementLabel(draft.label)) this.#errors.set("packageLabel", draft.label.trim() ? "error.labelLimit" : "error.label");
    draft.deliverables = draft.deliverables.map((original) => {
      let value = this.#materializeCoverage(original);
      if (!isOutputRequirementLabel(value.label)) this.#errors.set(`${value.id}:label`, value.label.trim() ? "error.labelLimit" : "error.label");
      value = { ...value, quantity: this.#readQuantity(`${value.id}:quantity`, value.quantity) };
      if (value.content_quantity) value.content_quantity = this.#readQuantity(`${value.id}:content`, value.content_quantity);
      if (value.media_kind === "slides" && value.content_quantity?.kind === "range") {
        const policy = this.#policyDraft(value); const parsed = readOutputCountPolicyDraft(value.content_quantity, policy);
        if (parsed.issue) this.#errors.set(`${value.id}:policy:${policy.kind === "exact" ? "exact" : "aim"}`, `error.${parsed.issue}`);
      }
      value.format_variants = value.format_variants?.map((variant) => {
        if (!isOutputRequirementLabel(variant.label)) this.#errors.set(`${variant.id}:label`, variant.label.trim() ? "error.labelLimit" : "error.label");
        const ratioText = this.#textValue(`${variant.id}:ratio`, variant.aspect_ratio ? formatOutputAspectRatio(variant.aspect_ratio) : "").trim();
        const ratio = ratioText ? parseOutputAspectRatio(ratioText) : null;
        if (ratioText && !ratio) this.#errors.set(`${variant.id}:ratio`, "error.ratio");
        const next = this.#markEdited(variant, { ...variant, aspect_ratio: ratio, quantity: this.#readQuantity(`${variant.id}:quantity`, variant.quantity), placements: outputDraftLines(this.#textValue(`${variant.id}:placements`, variant.placements.join("\n"))) });
        if (JSON.stringify(ratio) !== JSON.stringify(variant.aspect_ratio)) next.value_origins.aspect_ratio = { kind: "authored", text: ratioText };
        return next;
      });
      if (value.series) {
        value.series.members = value.series.members.map((member) => {
          if (!isOutputRequirementLabel(member.label)) this.#errors.set(`${member.id}:label`, member.label.trim() ? "error.labelLimit" : "error.label");
          return this.#markEdited(member, this.#materializeCoverage(member));
        });
        if (!value.series.members.length) { value.series.state = "unresolved"; value.quantity = { kind: "unknown", unit: "video" }; }
      }
      return this.#markEdited(original, value);
    });
    if (!this.#errors.size && inspectOutputRequirement(draft).status !== "valid") this.#errors.set("groups", "error.domain");
    return this.#errors.size ? null : { draft, planSuggestions: this.#currentPlanning(draft) };
  }
  #submit(event: SubmitEvent) {
    event.preventDefault(); event.stopPropagation();
    if (!this.#canSave() || !this.#session || this.#composing.size) return;
    const materialized = this.#materialize();
    if (!materialized) {
      this.#status = "invalid"; this.requestUpdate(); this.#focus(this.#errors.keys().next().value ?? "groups"); return;
    }
    const fingerprint = JSON.stringify([this.#session.baseRevision, materialized.draft, materialized.planSuggestions]);
    const previous = this.#session.pendingMutation;
    const clientMutationId = previous?.fingerprint === fingerprint ? previous.id : crypto.randomUUID();
    this.#session.pendingMutation = { id: clientMutationId, fingerprint, editVersion: this.#session.editVersion };
    this.#waiting = true; this.#status = ""; this.requestUpdate();
    this.#emit<OutputRequirementSaveIntent>("forma-output-save", { ...this.#intent()!, clientMutationId, ...materialized });
  }
  #keydown(event: KeyboardEvent) {
    if (!this.#editing || event.isComposing || this.#composing.size) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.#cancel(); return; }
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || !this.#canSave()) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) || target.form?.id !== `${this.#id}-form`) return;
    event.preventDefault(); event.stopPropagation();
    const button = this.querySelector<HTMLButtonElement>(`#${this.#fieldId("save")}`);
    if (button && !button.disabled) target.form.requestSubmit(button);
  }
  #reviewPlan() {
    if (!this.snapshot?.canReviewPlan || this.resourceState !== "ready" || this.#unsupported() || this.#session?.dirty) return;
    const snapshot = this.snapshot;
    this.#emit<OutputRequirementReviewPlanIntent>("forma-output-review-plan", {
      scope: { ...snapshot.scope }, requirementId: snapshot.requirementId, expectedRevision: snapshot.revision,
      planSuggestions: structuredClone(snapshot.planSuggestions ?? { countPolicies: {}, suggestedCounts: {} }),
    });
  }
  #openResult(result: NonNullable<OutputRequirementCardSnapshot["results"]>[number]) {
    if (!result.canOpen || this.resourceState !== "ready" || !this.snapshot) return;
    const snapshot = this.snapshot;
    this.#emit<OutputRequirementOpenResultIntent>("forma-output-open-result", {
      scope: { ...snapshot.scope }, requirementId: snapshot.requirementId, expectedRevision: snapshot.revision,
      targetId: result.targetId, artifactId: result.artifactId, artifactRevision: result.revision,
    });
  }
  #textField(key: string, label: string, value: string, update: (value: string) => void, options: TextFieldOptions = {}): TemplateResult {
    const id = this.#fieldId(key), isLabel = key === "packageLabel" || key.endsWith(":label");
    const issue = this.#errors.get(options.errorKey ?? key) ?? (isLabel && !isOutputRequirementLabel(value) ? value.trim() ? "error.labelLimit" : "error.label" : undefined);
    const help = options.help || (isLabel ? this.#t("labelLimitHelp", { max: OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH }) : options.numeric ? this.#t("numericEntryHelp") : "");
    const descriptions = [help ? `${id}-help` : "", issue ? `${id}-error` : ""].filter(Boolean).join(" ");
    const onInput = (event: Event) => { if (this.#composing.has(key) || (event instanceof InputEvent && event.isComposing)) return; if (isLabel) this.#errors.delete(options.errorKey ?? key); update((event.currentTarget as HTMLInputElement).value); };
    const compositionEnd = (event: CompositionEvent) => { this.#composing.delete(key); onInput(event); };
    return html`<label class="ui-field output-requirement-field" for=${id}><span>${label}</span>
      ${options.multiline ? html`<textarea id=${id} aria-label=${this.#controlName(label, options.ownerId, options.sectionLabel)} name=${key} form=${`${this.#id}-form`} rows=${options.rows ?? 3} maxlength=${isLabel ? OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH : nothing} dir=${options.direction ?? "auto"} .value=${this.#composing.has(key) ? noChange : live(value)} ?disabled=${this.#fieldsDisabled()} aria-invalid=${issue ? "true" : "false"} aria-describedby=${descriptions || nothing} aria-errormessage=${issue ? `${id}-error` : nothing} @input=${onInput} @compositionstart=${() => this.#composing.add(key)} @compositionend=${compositionEnd}></textarea>`
        : html`<input id=${id} aria-label=${this.#controlName(label, options.ownerId, options.sectionLabel)} type="text" inputmode=${options.numeric ? "decimal" : "text"} name=${key} form=${`${this.#id}-form`} maxlength=${isLabel ? OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH : nothing} dir=${options.direction ?? (options.numeric ? "ltr" : "auto")} .value=${this.#composing.has(key) ? noChange : live(value)} ?disabled=${this.#fieldsDisabled()} aria-invalid=${issue ? "true" : "false"} aria-describedby=${descriptions || nothing} aria-errormessage=${issue ? `${id}-error` : nothing} @input=${onInput} @compositionstart=${() => this.#composing.add(key)} @compositionend=${compositionEnd}>`}
      ${help ? html`<small id=${`${id}-help`}>${help}</small>` : nothing}${issue ? html`<small class="output-requirement-error" id=${`${id}-error`}>${this.#t(issue, { max: OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH })}</small>` : nothing}
    </label>`;
  }
  #select(key: string, label: string, value: string, options: Array<{ value: string; label: string }>, update: (value: string) => void, ownerId = "", sectionLabel = "") {
    const id = this.#fieldId(key);
    return html`<label class="ui-field output-requirement-field" for=${id}><span>${label}</span><select id=${id} aria-label=${this.#controlName(label, ownerId, sectionLabel)} name=${key} form=${`${this.#id}-form`} .value=${live(value)} ?disabled=${this.#fieldsDisabled()} @change=${(event: Event) => update((event.currentTarget as HTMLSelectElement).value)}>${options.map((option) => html`<option value=${option.value} ?selected=${value === option.value}>${option.label}</option>`)}</select></label>`;
  }
  #checkbox(key: string, label: string, checked: boolean, update: (value: boolean) => void, help = "", ownerId = "", sectionLabel = "") {
    const id = this.#fieldId(key);
    return html`<label class="ui-choice output-requirement-choice" for=${id}><input id=${id} aria-label=${this.#controlName(label, ownerId, sectionLabel)} type="checkbox" name=${key} form=${`${this.#id}-form`} .checked=${checked} ?disabled=${this.#fieldsDisabled()} aria-describedby=${help ? `${id}-help` : nothing} @change=${(event: Event) => update((event.currentTarget as HTMLInputElement).checked)}><span>${label}${help ? html`<small id=${`${id}-help`}>${help}</small>` : nothing}</span></label>`;
  }
  #quantity(key: string, label: string, value: OutputQuantity, ownerId = "") {
    const draft = this.#quantityDraft(key, value);
    const update = (property: "kind" | "exact" | "min" | "max", text: string) => { this.#session!.quantities.set(key, { ...draft, [property]: text }); this.#touch(true, `${key}:${property}`); };
    return html`<fieldset class="output-requirement-quantity" aria-label=${this.#controlName(label + " · " + this.#t(`unit.${draft.unit}`), ownerId)}><legend>${label} <span>· ${this.#t(`unit.${draft.unit}`)}</span></legend>
      <div class="output-requirement-fields">
        ${this.#select(`${key}:kind`, this.#t("quantityMode"), draft.kind, (["unknown", "exact", "range"] as const).map((kind) => ({ value: kind, label: this.#t(`quantity.${kind}`) })), (next) => update("kind", next), ownerId, label)}
        ${draft.kind === "exact" ? this.#textField(`${key}:exact`, this.#t("value"), draft.exact, (next) => update("exact", next), { numeric: true , ownerId: ownerId, sectionLabel: label}) : nothing}
        ${draft.kind === "range" ? html`${this.#textField(`${key}:min`, this.#t("minimum"), draft.min, (next) => update("min", next), { numeric: true , ownerId: ownerId, sectionLabel: label})}${this.#textField(`${key}:max`, this.#t("maximum"), draft.max, (next) => update("max", next), { numeric: true , ownerId: ownerId, sectionLabel: label})}` : nothing}
      </div><small>${this.#t(draft.unit === "second" ? "durationHelp" : "blankHelp")}</small>
    </fieldset>`;
  }
  #quantityLabel(value: OutputQuantity) {
    const unit = value.kind === "exact" ? this.i18n.plural(`output.requirement.unit.${value.unit}`, value.value, this.#t(`unit.${value.unit}.one`), this.#t(`unit.${value.unit}`)) : this.#t(`unit.${value.unit}`);
    if (value.kind === "unknown") return this.#t("countUnknown", { unit });
    if (value.kind === "exact") return this.#t("countExact", { count: this.i18n.number(value.value), unit });
    return this.#t("countRange", { min: this.i18n.number(value.min), max: this.i18n.number(value.max), unit });
  }
  #coverage(owner: CoverageOwner, update: (next: Partial<CoverageOwner>) => void) {
    const selected = owner.source_scope.kind === "blocks" ? owner.source_scope.block_ids : [];
    const sources = this.snapshot?.sourceOptions ?? [];
    const coverage = owner.coverage;
    return html`<div class="output-requirement-coverage">
      ${this.#select(`${owner.id}:coverage`, this.#t("coverage"), coverage.kind, (["document_context", "document_outline", "topics", "unresolved"] as const).map((kind) => ({ value: kind, label: this.#t(`coverage.${kind}`) })), (kind) => update({ coverage: kind === "document_outline" || kind === "document_context" ? { kind } : kind === "topics" ? { kind, topics: [] } : { kind: "unresolved", description: "" } }), owner.id, "")}
      ${coverage.kind === "topics" ? this.#textField(`${owner.id}:topics`, this.#t("topics"), this.#textValue(`${owner.id}:topics`, coverage.topics.join("\n")), (value) => { this.#setText(`${owner.id}:topics`, value); update({ coverage: { ...coverage } }); }, { multiline: true , ownerId: owner.id, sectionLabel: ""}) : nothing}
      ${coverage.kind === "unresolved" ? this.#textField(`${owner.id}:coverageDescription`, this.#t("coverageDescription"), coverage.description, (description) => update({ coverage: { kind: "unresolved", description } }), { multiline: true, rows: 2 , ownerId: owner.id, sectionLabel: ""}) : nothing}
      ${this.#select(`${owner.id}:source`, this.#t("sourceScope"), owner.source_scope.kind, (["document", "blocks", "unknown"] as const).map((kind) => ({ value: kind, label: this.#t(`source.${kind}`) })), (kind) => update({ source_scope: kind === "document" ? { kind } : kind === "blocks" ? { kind, block_ids: [] } : { kind: "unknown", reason: "not_decided" } }), owner.id, "")}
      ${owner.source_scope.kind === "blocks" ? html`<fieldset class="output-requirement-source-options" aria-label=${this.#controlName(this.#t("source.blocks"), owner.id)}><legend>${this.#t("source.blocks")}</legend>
        ${sources.length ? repeat(sources, (source) => source.id, (source) => this.#checkbox(`${owner.id}:source:${source.id}`, this.#isolate(source.label), selected.includes(source.id), (checked) => update({ source_scope: { kind: "blocks", block_ids: checked ? [...new Set([...selected, source.id])] : selected.filter((id) => id !== source.id) } }), "", owner.id, this.#t("contextSource", { number: this.i18n.number(sources.findIndex((candidate) => candidate.id === source.id) + 1) }))) : html`<p>${this.#t("sourceNone")}</p>`}
        ${selected.some((id) => !sources.some((source) => source.id === id)) ? html`<p class="output-requirement-note">${this.#t("sourceMissing")}</p>` : nothing}
      </fieldset>` : nothing}
    </div>`;
  }
  #policy(deliverable: OutputDeliverable) {
    if (!deliverable.content_quantity) return nothing;
    const authored = readOutputQuantityDraft(this.#quantityDraft(`${deliverable.id}:content`, deliverable.content_quantity)).quantity;
    if (authored?.kind !== "range") return nothing;
    const policy = this.#policyDraft(deliverable);
    const update = (field: keyof OutputCountPolicyDraft, value: string) => { this.#session!.policies.set(deliverable.id, { ...policy, [field]: value }); this.#session!.editedPolicyIds.add(deliverable.id); this.#touch(true, `${deliverable.id}:policy:${field}`); };
    return html`<fieldset class="output-requirement-policy" aria-label=${this.#controlName(this.#t("proposedTreatment"), deliverable.id)}><legend>${this.#t("proposedTreatment")}</legend>
      <p>${this.#t("authoredRange", { range: this.#quantityLabel(authored) })}</p>
      ${this.#select(`${deliverable.id}:policy:kind`, this.#t("proposedTreatment"), policy.kind, [{ value: "flexible", label: this.#t("flexible") }, { value: "exact", label: this.#t("exactTreatment") }], (value) => update("kind", value), deliverable.id, this.#t("proposedTreatment"))}
      ${policy.kind === "flexible" ? this.#textField(`${deliverable.id}:policy:aim`, this.#t("aim"), policy.aim, (value) => update("aim", value), { numeric: true , ownerId: deliverable.id, sectionLabel: this.#t("proposedTreatment")}) : this.#textField(`${deliverable.id}:policy:exact`, this.#t("value"), policy.exact, (value) => update("exact", value), { numeric: true , ownerId: deliverable.id, sectionLabel: this.#t("proposedTreatment")})}
      <small>${this.#t("aimHelp")}</small>
    </fieldset>`;
  }
  #variant(deliverable: OutputDeliverable, variant: OutputFormatVariant) {
    const name = variant.label || this.#t("unnamedFormat");
    return html`<li class="output-requirement-subrow" data-output-variant=${variant.id} aria-label=${this.#context(variant.id)}>
      <div class="output-requirement-fields">
        ${this.#textField(`${variant.id}:label`, this.#t("label"), variant.label, (label) => this.#updateVariant(deliverable.id, variant.id, (value) => ({ ...value, label })), { ownerId: variant.id, sectionLabel: "" })}
        ${this.#textField(`${variant.id}:ratio`, this.#t("ratio"), this.#textValue(`${variant.id}:ratio`, variant.aspect_ratio ? formatOutputAspectRatio(variant.aspect_ratio) : ""), (value) => this.#setText(`${variant.id}:ratio`, value), { direction: "ltr", help: this.#t("ratioHelp") , ownerId: variant.id, sectionLabel: ""})}
      </div>
      ${this.#checkbox(`${variant.id}:required`, this.#t("required"), variant.required, (required) => this.#updateVariant(deliverable.id, variant.id, (value) => ({ ...value, required })), this.#t("requiredHelp"), variant.id, "")}
      ${this.#quantity(`${variant.id}:quantity`, this.#t("quantity"), variant.quantity, variant.id)}
      ${this.#textField(`${variant.id}:placements`, this.#t("placements"), this.#textValue(`${variant.id}:placements`, variant.placements.join("\n")), (value) => this.#setText(`${variant.id}:placements`, value), { multiline: true, rows: 2 , ownerId: variant.id, sectionLabel: ""})}
      <button aria-label=${this.#controlName(this.#t("remove", { name: this.#isolate(name) }), variant.id)} type="button" class="output-requirement-secondary" ?disabled=${this.#fieldsDisabled()} @click=${() => {
        const rows = deliverable.format_variants ?? []; const index = rows.findIndex((value) => value.id === variant.id); const next = rows.filter((value) => value.id !== variant.id);
        this.#updateDeliverable(deliverable.id, (value) => ({ ...value, format_variants: next }));
        this.#announcement = this.#t("removed", { name }); const neighbor = next[index] ?? next[index - 1]; this.#focus(neighbor ? `${neighbor.id}:label` : `${deliverable.id}:formats`);
      }}>${this.#t("remove", { name: this.#isolate(name) })}</button>
    </li>`;
  }
  #series(deliverable: OutputDeliverable) {
    const series = deliverable.series;
    if (!series) return html`${deliverable.format_variants?.length ? html`<p class="output-requirement-note">${this.#t("seriesFormatLimit")}</p>` : nothing}<button aria-label=${this.#controlName(this.#t("makeSeries"), deliverable.id)} type="button" class="output-requirement-secondary" ?disabled=${this.#fieldsDisabled() || !!deliverable.format_variants?.length} @click=${() => this.#updateDeliverable(deliverable.id, (value) => ({ ...value, series: { state: "unresolved", members: [], description: "" } }))}>${this.#t("makeSeries")}</button>`;
    const seriesError = this.#errors.get(`${deliverable.id}:series`);
    return html`<section class="output-requirement-series" aria-labelledby=${this.#fieldId(`${deliverable.id}:series`)}>
      <h5 tabindex="-1" aria-label=${this.#controlName(this.#t("series"), deliverable.id)} id=${this.#fieldId(`${deliverable.id}:series`)}>${this.#t("series")}</h5><p>${this.#t(series.state === "resolved" ? "seriesResolved" : "seriesUnresolved")}</p><small>${this.#t("seriesHelp")}</small>
      ${this.#textField(`${deliverable.id}:seriesDescription`, this.#t("seriesDescription"), series.description, (description) => this.#updateDeliverable(deliverable.id, (value) => value.series ? { ...value, series: { ...value.series, description } } : value), { multiline: true, rows: 2 , ownerId: deliverable.id, sectionLabel: ""})}
      <ol class="output-requirement-subrows">${repeat(series.members, (member) => member.id, (member, index) => html`<li class="output-requirement-subrow" data-output-member=${member.id} aria-label=${this.#context(member.id)}>
        ${this.#textField(`${member.id}:label`, this.#t("label"), member.label, (label) => this.#updateMember(deliverable.id, member.id, (value) => ({ ...value, label })), { ownerId: member.id, sectionLabel: "" })}
        ${this.#checkbox(`${member.id}:required`, this.#t("required"), member.required, (required) => this.#updateMember(deliverable.id, member.id, (value) => ({ ...value, required })), this.#t("requiredHelp"), member.id, "")}
        ${this.#coverage(member, (next) => this.#updateMember(deliverable.id, member.id, (value) => ({ ...value, ...next })))}
        <div class="output-requirement-actions">
          <button aria-label=${this.#controlName(this.#t("moveUp", { name: this.#isolate(member.label || this.#t("unnamedVideo")) }), member.id)} type="button" ?disabled=${this.#fieldsDisabled() || index === 0} @click=${() => this.#moveMember(deliverable, member, -1)}>${this.#t("moveUp", { name: this.#isolate(member.label || this.#t("unnamedVideo")) })}</button>
          <button aria-label=${this.#controlName(this.#t("moveDown", { name: this.#isolate(member.label || this.#t("unnamedVideo")) }), member.id)} type="button" ?disabled=${this.#fieldsDisabled() || index === series.members.length - 1} @click=${() => this.#moveMember(deliverable, member, 1)}>${this.#t("moveDown", { name: this.#isolate(member.label || this.#t("unnamedVideo")) })}</button>
          <button aria-label=${this.#controlName(this.#t("remove", { name: this.#isolate(member.label || this.#t("unnamedVideo")) }), member.id)} type="button" ?disabled=${this.#fieldsDisabled()} @click=${() => this.#removeMember(deliverable, member)}>${this.#t("remove", { name: this.#isolate(member.label || this.#t("unnamedVideo")) })}</button>
        </div>
      </li>`)}</ol>
      ${seriesError ? html`<p class="output-requirement-error">${this.#t(seriesError)}</p>` : nothing}
      <div class="output-requirement-actions"><button aria-label=${this.#controlName(this.#t("addVideo"), deliverable.id)} type="button" ?disabled=${this.#fieldsDisabled()} @click=${() => this.#addMember(deliverable)}>${this.#t("addVideo")}</button><button aria-label=${this.#controlName(this.#t("confirmSeries"), deliverable.id)} type="button" ?disabled=${this.#fieldsDisabled() || series.state === "resolved"} @click=${() => this.#confirmSeries(deliverable)}>${this.#t("confirmSeries")}</button></div>
    </section>`;
  }
  #deliverable(value: OutputDeliverable) {
    const name = value.label || this.#t("untitledGroup");
    return html`<li class="output-requirement-group" data-output-deliverable=${value.id} aria-labelledby=${this.#fieldId(`${value.id}:heading`)}>
      <header><h4 id=${this.#fieldId(`${value.id}:heading`)} aria-label=${this.#controlName(this.#isolate(name), value.id)} dir="auto">${name}</h4><span>${this.#t(value.required ? "required" : "optional")}</span></header>
      <div class="output-requirement-fields">
        ${this.#textField(`${value.id}:label`, this.#t("label"), value.label, (label) => this.#updateDeliverable(value.id, (current) => ({ ...current, label })), { ownerId: value.id, sectionLabel: "" })}
        ${this.#select(`${value.id}:medium`, this.#t("medium"), value.media_kind, MEDIA.map((kind) => ({ value: kind, label: this.#t(`media.${kind}`) })), (next) => {
          if (next === value.media_kind) return;
          if (value.media_kind === "unknown") this.#changeMedium(value.id, next as OutputMediaKind);
          else { this.#mediumChange = { deliverableId: value.id, kind: next as OutputMediaKind }; this.requestUpdate(); }
        }, value.id, "")}
      </div>
      ${this.#mediumChange?.deliverableId === value.id ? html`<div class="output-requirement-warning"><h5>${this.#t("mediumChangeTitle")}</h5><p>${this.#t("mediumChangeDetail")}</p><div class="output-requirement-actions"><button aria-label=${this.#controlName(this.#t("keepProposal"), value.id)} type="button" @click=${() => { this.#mediumChange = null; this.requestUpdate(); }}>${this.#t("keepProposal")}</button><button aria-label=${this.#controlName(this.#t("changeMedium"), value.id)} type="button" ?disabled=${this.#fieldsDisabled()} @click=${() => { if (this.#mediumChange) this.#changeMedium(value.id, this.#mediumChange.kind); }}>${this.#t("changeMedium")}</button></div></div>` : nothing}
      ${this.#checkbox(`${value.id}:required`, this.#t("required"), value.required, (required) => this.#updateDeliverable(value.id, (current) => ({ ...current, required })), this.#t("requiredHelp"), value.id, "")}
      ${this.#quantity(`${value.id}:quantity`, this.#t("quantity"), value.quantity, value.id)}
      ${value.content_quantity ? this.#quantity(`${value.id}:content`, this.#t(value.content_quantity.unit === "slide" ? "slidesCount" : "duration"), value.content_quantity, value.id) : nothing}
      ${value.media_kind === "slides" ? this.#policy(value) : nothing}
      ${this.#coverage(value, (next) => this.#updateDeliverable(value.id, (current) => ({ ...current, ...next })))}
      ${value.media_kind === "image" || value.media_kind === "video" ? html`<section class="output-requirement-formats" aria-labelledby=${this.#fieldId(`${value.id}:formats`)}><h5 tabindex="-1" aria-label=${this.#controlName(this.#t("formats"), value.id)} id=${this.#fieldId(`${value.id}:formats`)}>${this.#t("formats")}</h5><small>${this.#t("formatHelp")}</small>
        <ul class="output-requirement-subrows">${repeat(value.format_variants ?? [], (variant) => variant.id, (variant) => this.#variant(value, variant))}</ul>
        ${value.series ? html`<p class="output-requirement-note">${this.#t("seriesFormatLimit")}</p>` : nothing}<button aria-label=${this.#controlName(this.#t("addFormat"), value.id)} type="button" ?disabled=${this.#fieldsDisabled() || !!value.series} @click=${() => this.#addVariant(value)}>${this.#t("addFormat")}</button>
      </section>` : nothing}
      ${value.media_kind === "video" ? this.#series(value) : nothing}
      <button aria-label=${this.#controlName(this.#t("remove", { name: this.#isolate(name) }), value.id)} type="button" class="output-requirement-secondary" ?disabled=${this.#fieldsDisabled()} @click=${() => this.#removeDeliverable(value)}>${this.#t("remove", { name: this.#isolate(name) })}</button>
    </li>`;
  }
  #readOnlyGroups(spec: unknown) {
    const editable = outputRequirementEditableDraft(spec);
    if (!editable) return nothing;
    return html`<ul class="output-requirement-summary-groups">${repeat(editable.deliverables, (value) => value.id, (value) => html`<li><div><b dir="auto">${value.label || this.#t("untitledGroup")}</b><span>${this.#t(`media.${value.media_kind}`)} · ${this.#t(value.required ? "required" : "optional")}</span></div><p>${this.#quantityLabel(value.quantity)}${value.content_quantity ? html` · ${this.#quantityLabel(value.content_quantity)}` : nothing}</p>
      ${value.series ? html`<small>${this.#t(value.series.state === "resolved" ? "seriesResolved" : "seriesUnresolved")}</small>` : nothing}
      ${value.format_variants?.length ? html`<ul>${value.format_variants.map((variant) => html`<li><bdi dir="auto">${variant.label || this.#t("unnamedFormat")}</bdi> · <bdi dir="ltr">${variant.aspect_ratio ? formatOutputAspectRatio(variant.aspect_ratio) : this.#t("ratioUnknown")}</bdi> · ${this.#t(variant.required ? "required" : "optional")} · ${this.#quantityLabel(variant.quantity)}</li>`)}</ul>` : nothing}
    </li>`)}</ul>`;
  }
  #decisionValue(field: OutputInterpretationDecision["field"], value: unknown): TemplateResult | string {
    if (value === undefined || value === null || value === "") return this.#t("comparisonAbsent");
    if (field === "required" && typeof value === "boolean") return this.#t(value ? "required" : "optional");
    if (field === "medium" && typeof value === "string" && MEDIA.includes(value as OutputMediaKind)) return this.#t(`media.${value as OutputMediaKind}`);
    if (field === "identity") return html`<code dir="ltr">${String(value)}</code>`;
    if (Array.isArray(value)) return value.length ? html`<ol>${value.map((entry) => html`<li>${entry && typeof entry === "object" && "label" in entry ? html`<bdi dir="auto">${String(entry.label)}</bdi> <code dir="ltr">${String(entry.id)}</code>` : html`<bdi dir="auto">${String(entry)}</bdi>`}</li>`)}</ol>` : this.#t("comparisonAbsent");
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if ((field === "quantity" || field === "contentQuantity") && "unit" in record) return this.#quantityLabel(value as OutputQuantity);
      if (field === "ratio" && "width" in record && "height" in record) return html`<bdi dir="ltr">${formatOutputAspectRatio(value as { width: number; height: number })}</bdi>`;
      if (field === "source") {
        if (record.kind === "document") return this.#t("source.document");
        if (record.kind === "unknown") return this.#t("source.unknown");
        if (Array.isArray(record.block_ids)) return record.block_ids.map((id) => this.snapshot?.sourceOptions.find((source) => source.id === id)?.label ?? this.#t("comparisonUnavailableSource")).join(" · ");
      }
      if (field === "coverage") {
        if (record.kind === "document_context" || record.kind === "document_outline") return this.#t(`coverage.${record.kind}`);
        if (record.kind === "topics" && Array.isArray(record.topics)) return record.topics.join(" · ");
        if (record.kind === "unresolved") return `${this.#t("coverage.unresolved")} · ${String(record.description ?? "")}`;
      }
      if (field === "series") return `${this.#t(record.state === "resolved" ? "seriesResolved" : "seriesUnresolved")} · ${String(record.description ?? "")}`;
      if (field === "countPolicy") {
        const policy = value as OutputCountPolicy;
        if (policy.kind === "exact") return `${this.#t("exactTreatment")} · ${this.#quantityLabel({ kind: "exact", unit: policy.unit, value: policy.value })}`;
        return `${this.#t("flexible")} · ${this.#quantityLabel({ kind: "range", unit: policy.unit, min: policy.min, max: policy.max })}${policy.aim === undefined ? "" : ` · ${this.#t("aim")}: ${this.i18n.number(policy.aim)}`}`;
      }
      return JSON.stringify(value);
    }
    return typeof value === "number" ? this.i18n.number(value) : String(value);
  }
  #decisionChanges(changes: OutputInterpretationChange[]) {
    if (!changes.length) return html`<p>${this.#t("comparisonUnchanged")}</p>`;
    return html`<p>${this.#t("comparisonCount", { count: this.i18n.number(changes.length) })}</p><ol class="output-requirement-subrows">${repeat(changes, (change) => change.key, (change) => html`<li class="output-requirement-subrow"><h5><bdi dir="auto">${change.label || this.#t("untitledGroup")}</bdi> · ${this.#t(`changeField.${change.field}`)}</h5><p>${this.#t(`changeKind.${change.kind}`)}</p><div><b>${this.#t("comparisonBefore")}</b><div class="output-requirement-prose">${this.#decisionValue(change.field, change.before)}</div></div><div><b>${this.#t("comparisonAfter")}</b><div class="output-requirement-prose">${this.#decisionValue(change.field, change.after)}</div></div></li>`)}</ol>`;
  }
  #retainedInterpretationView() {
    const session = this.#session;
    if (!session) return nothing;
    const current = this.#comparisonDraft();
    if (!outputRequirementInterpretationNeedsReview(current)) return nothing;
    const basis = outputRequirementInterpretationBasis(current);
    const valid = inspectOutputRequirement(current).status === "valid" && !this.#uncommittedDraftChanges().length;
    const wordingChosen = session.originalText === session.acceptedWording;
    const decisions = outputInterpretationDecisions(current, this.#currentPlanning(current));
    return html`<div class="output-requirement-warning"><h4>${this.#t("interpretationNeedsReview")}</h4><p>${this.#t("interpretationWarning")}</p>
      ${basis === null ? html`<p>${this.#t("interpretationBasisUnknown")}</p>` : html`<details><summary aria-label=${this.#controlName(this.#t("interpretationBasis"), "")}>${this.#t("interpretationBasis")}</summary><p class="output-requirement-prose" dir="auto">${basis}</p></details>`}
      <details><summary aria-label=${this.#controlName(this.#t("reviewRetainedDecisions"), "")}>${this.#t("reviewRetainedDecisions")}</summary><p>${this.#t("retainedDecisionHelp")}</p>
        <ol class="output-requirement-subrows">${repeat(decisions, (decision) => decision.key, (decision) => html`<li class="output-requirement-subrow"><h5><bdi dir="auto">${decision.label || this.#t("untitledGroup")}</bdi> · ${this.#t(`changeField.${decision.field}`)}</h5><div class="output-requirement-prose">${this.#decisionValue(decision.field, decision.value)}</div></li>`)}</ol>
        ${!valid ? html`<p class="output-requirement-error">${this.#t("retainedReviewInvalid")}</p>` : nothing}
        ${!wordingChosen ? html`<p>${this.#t("chooseWordingFirst")}</p>` : nothing}
        ${this.#checkbox("interpretation-reviewed", this.#t("retainedReviewAcknowledgment"), this.#interpretationReviewedAt === session.editVersion, (checked) => { this.#interpretationReviewedAt = checked ? session.editVersion : -1; this.requestUpdate(); })}
        <button aria-label=${this.#controlName(this.#t("acceptRetainedInterpretation"), "")} type="button" ?disabled=${this.#fieldsDisabled() || !valid || !wordingChosen || this.#interpretationReviewedAt !== session.editVersion} @click=${this.#confirmRetainedInterpretation}>${this.#t("acceptRetainedInterpretation")}</button>
      </details>
    </div>`;
  }
  #parseProposalView() {
    const proposal = this.#parseProposal;
    if (!proposal) return nothing;
    return html`<div class="output-requirement-warning"><h4 id=${this.#fieldId("proposalComparison")} tabindex="-1">${this.#t("replaceProposalTitle")}</h4><p>${this.#t("replaceProposalDetail")}</p>
      ${this.#decisionChanges(proposal.changes)}
      <div class="output-requirement-actions"><button aria-label=${this.#controlName(this.#t("keepProposal"), "")} type="button" @click=${() => { this.#parseProposal = null; this.#status = "proposalCancelled"; this.requestUpdate(); this.#focus("originalText"); }}>${this.#t("keepProposal")}</button><button aria-label=${this.#controlName(this.#t("replaceProposal"), "")} type="button" ?disabled=${this.#fieldsDisabled()} @click=${this.#acceptParseProposal}>${this.#t("replaceProposal")}</button></div>
    </div>`;
  }
  #conflictView() {
    const latest = this.#latest();
    if (!this.#hasConflict() || !latest || !this.#session) return nothing;
    const inspected = inspectOutputRequirement(latest.spec);
    const current = this.#comparisonDraft();
    const changes = inspected.spec ? [...compareOutputInterpretations(inspected.spec, current, latest.planSuggestions ?? { countPolicies: {}, suggestedCounts: {} }, this.#currentPlanning(current)), ...this.#uncommittedDraftChanges()] : null;
    const checked = this.#conflictReviewedAt === `${this.#conflictMarker()}:${this.#session.editVersion}`;
    return html`<div class="output-requirement-warning"><p>${this.#t("conflict")}</p><details><summary aria-label=${this.#controlName(this.#t("compare"), "")}>${this.#t("compare")}</summary>
      <h4>${this.#t("latest")}</h4><p class="output-requirement-prose" dir="auto">${latest.originalText}</p>${this.#readOnlyGroups(latest.spec)}
      <h4>${this.#t("draft")}</h4><p class="output-requirement-prose" dir="auto">${this.#session.originalText}</p>${this.#readOnlyGroups(current)}<p>${this.#t("dirtyState")}</p>
      ${changes ? this.#decisionChanges(changes) : html`<p>${this.#t("conflictComparisonUnavailable")}</p>`}
      <p>${this.#t("conflictReplacementHelp")}</p>
      ${this.#checkbox("conflict-reviewed", this.#t("conflictReplacementAcknowledgment"), checked, (value) => { this.#conflictReviewedAt = value ? `${this.#conflictMarker()}:${this.#session!.editVersion}` : ""; this.requestUpdate(); })}
      <div class="output-requirement-actions"><button aria-label=${this.#controlName(this.#t("reapply"), "")} type="button" ?disabled=${this.#fieldsDisabled() || this.resourceState !== "ready" || !checked || !changes} @click=${this.#reapply}>${this.#t("reapply")}</button><button aria-label=${this.#controlName(this.#t("reloadLatest"), "")} type="button" ?disabled=${this.#waiting} @click=${() => { this.#cancelIntent = "reload"; this.requestUpdate(); this.#focus("keepEditing"); }}>${this.#t("reloadLatest")}</button></div>
    </details></div>`;
  }
  #editor() {
    const session = this.#session;
    if (!session || this.#nestedForm()) return nothing;
    return html`<form id=${`${this.#id}-form`} class="output-requirement-form" novalidate @submit=${this.#submit}>
      <p class="output-requirement-note">${this.#t("proposalDraft")}</p><p>${this.#t("dirtyState")}</p>
      ${this.#textField("packageLabel", this.#t("packageLabel"), session.label, (label) => { session.label = label; this.#touch(false, "packageLabel"); })}
      ${this.#textField("originalText", this.#t("originalProse"), session.originalText, (value) => { session.originalText = value; this.#touch(false, "originalText"); }, { multiline: true, rows: 5, help: this.#t("parserHelp") })}
      ${session.originalText !== session.acceptedWording && session.spec.deliverables.length ? html`<div class="output-requirement-warning"><p>${this.#t("wordingOnlyHelp")}</p>${this.#readOnlyGroups(this.#comparisonDraft())}<button aria-label=${this.#controlName(this.#t("keepRequirementsUpdateWording"), "")} type="button" ?disabled=${this.#fieldsDisabled()} @click=${this.#keepWordingOnly}>${this.#t("keepRequirementsUpdateWording")}</button></div>` : nothing}
      <button aria-label=${this.#controlName(this.#t("parseProposal"), "")} type="button" ?disabled=${this.#fieldsDisabled() || !session.originalText.trim()} @click=${() => this.#parse()}>${this.#t("parseProposal")}</button>
      ${this.#parseProposalView()}
      ${this.#retainedInterpretationView()}
      ${this.#conflictView()}
      <h3 id=${this.#fieldId("groups")} aria-label=${this.#controlName(this.#t("deliverables"))} tabindex="-1">${this.#t("deliverables")}</h3>
      ${this.#errors.has("groups") ? html`<p class="output-requirement-error">${this.#t(this.#errors.get("groups")!)}</p>` : nothing}
      <ol class="output-requirement-groups" aria-labelledby=${this.#fieldId("groups")}>${repeat(session.spec.deliverables, (value) => value.id, (value) => this.#deliverable(value))}</ol>
      <button aria-label=${this.#controlName(this.#t("addDeliverable"), "")} type="button" ?disabled=${this.#fieldsDisabled()} @click=${this.#addDeliverable}>${this.#t("addDeliverable")}</button>
      ${this.editorState.status === "invalid" && this.editorState.issues?.length ? html`<ul class="output-requirement-error">${this.editorState.issues.map((issue) => html`<li>${issue.message}</li>`)}</ul>` : nothing}
      <footer class="output-requirement-form-footer"><p>${this.#t("noGeneration")}</p><div class="output-requirement-actions"><button aria-label=${this.#controlName(this.#t(this.#waiting || this.editorState.status === "saving" ? "saving" : "save"), "")} id=${this.#fieldId("save")} type="submit" form=${`${this.#id}-form`} ?disabled=${!this.#canSave()} aria-keyshortcuts="Control+Enter Meta+Enter">${this.#t(this.#waiting || this.editorState.status === "saving" ? "saving" : "save")}</button><button aria-label=${this.#controlName(this.#t("cancel"), "")} type="button" ?disabled=${this.#waiting} @click=${this.#cancel}>${this.#t("cancel")}</button></div></footer>
      ${this.#cancelIntent ? html`<div class="output-requirement-warning"><h4>${this.#t("discardTitle")}</h4><div class="output-requirement-actions"><button aria-label=${this.#controlName(this.#t("keepEditing"), "")} id=${this.#fieldId("keepEditing")} type="button" @click=${() => { this.#cancelIntent = null; this.requestUpdate(); this.#focus("originalText"); }}>${this.#t("keepEditing")}</button><button aria-label=${this.#controlName(this.#t("discard"), "")} type="button" @click=${this.#discard}>${this.#t("discard")}</button></div></div>` : nothing}
    </form>`;
  }
  override render() {
    const snapshot = this.snapshot;
    const resourceNotice = this.resourceState === "ready" ? "" : this.resourceState === "loading" ? "loading" : this.resourceState === "refreshing" ? "refreshing" : "unavailable";
    const editNotice = this.#editing && this.editorState.status === "unavailable" ? "unavailableDraft" : this.#editing && (this.editorState.status === "forbidden" || !snapshot?.canEdit) ? "forbiddenDraft" : "";
    const reason = this.#unsupported() ? this.#t("unsupported") : this.#nestedForm() ? this.#t("nestedForm") : this.readOnlyReason || (snapshot && !snapshot.canEdit ? this.#t("readOnly") : "");
    return html`<section class="output-requirement-card" data-presentation=${this.presentation} data-state=${this.resourceState} dir=${this.i18n.direction} aria-labelledby=${`${this.#id}-heading`} @keydown=${this.#keydown}>
      <header class="output-requirement-header"><div><span>${this.#t("heading")}</span><h2 id=${`${this.#id}-heading`} aria-label=${this.#controlName(this.#isolate(snapshot?.label || this.#t("heading")))} tabindex="-1" dir="auto">${snapshot?.label || this.#t("heading")}</h2></div><div class="output-requirement-actions">
        ${!this.#editing && this.#canEdit() ? html`<button aria-label=${this.#controlName(this.#t("edit"), "")} type="button" @click=${this.#open}>${this.#t("edit")}</button>` : nothing}
        ${snapshot?.canReviewPlan ? html`<button aria-label=${this.#controlName(this.#t("reviewPlan"), "")} type="button" ?disabled=${this.resourceState !== "ready" || this.#unsupported() || !!this.#session?.dirty} @click=${this.#reviewPlan}>${this.#t("reviewPlan")}</button>` : nothing}
      </div></header>
      ${resourceNotice ? html`<p class="output-requirement-note">${this.#t(resourceNotice)}</p>` : nothing}
      ${reason ? html`<p class="output-requirement-warning">${reason}</p>` : nothing}
      ${!this.#editing && snapshot && inspectOutputRequirement(snapshot.spec).spec && outputRequirementInterpretationNeedsReview(inspectOutputRequirement(snapshot.spec).spec!) ? html`<p class="output-requirement-warning">${this.#t("interpretationWarning")}</p>` : nothing}
      ${!this.#editing && snapshot && inspectOutputRequirement(snapshot.spec).status === "invalid" && outputRequirementEditableDraft(snapshot.spec) ? html`<p class="output-requirement-warning">${this.#t("invalidLabelsPreserved")}</p>` : nothing}
      ${snapshot ? html`<div class="output-requirement-saved-status" data-overall=${snapshot.summary.overall}><h3>${this.#t("authoritativeState")}</h3><p><b>${snapshot.summary.headline}</b></p><p>${snapshot.summary.detail}</p>
        <ul class="output-requirement-totals">${snapshot.summary.requiredRemaining === null || snapshot.summary.unresolvedGroups === null || snapshot.summary.selectedResultFiles === null ? html`<li>${this.#t("unknownTotals")}</li>` : nothing}
          ${snapshot.summary.requiredRemaining !== null ? html`<li>${this.#t("remaining", { count: this.i18n.number(snapshot.summary.requiredRemaining) })}</li>` : nothing}
          ${snapshot.summary.unresolvedGroups !== null ? html`<li>${this.#t("unresolved", { count: this.i18n.number(snapshot.summary.unresolvedGroups) })}</li>` : nothing}
          ${snapshot.summary.selectedResultFiles !== null ? html`<li>${this.#t("files", { count: this.i18n.number(snapshot.summary.selectedResultFiles) })}</li>` : nothing}
        </ul>
      </div>` : nothing}
      ${this.#editing ? this.#editor() : snapshot ? html`${this.#readOnlyGroups(snapshot.spec)}${this.presentation === "full" || this.#unsupported() ? html`<details><summary aria-label=${this.#controlName(this.#t("originalProse"), "")}>${this.#t("originalProse")}</summary><p class="output-requirement-prose" dir="auto">${snapshot.originalText}</p></details>` : nothing}` : nothing}
      ${snapshot?.results?.length ? html`<ul class="output-requirement-results">${repeat(snapshot.results, (result) => JSON.stringify([result.targetId, result.artifactId, result.revision]), (result) => html`<li><div><b dir="auto">${result.title}</b><span>${result.stateLabel}</span></div><button aria-label=${this.#controlName(this.#t("inspectResult"), "", this.#resultContext(result))} type="button" ?disabled=${!result.canOpen || this.resourceState !== "ready"} @click=${() => this.#openResult(result)}>${this.#t("inspectResult")}</button></li>`)}</ul>` : nothing}
      <p class="output-requirement-live" role="status" aria-live="polite" aria-atomic="true">${this.#hasConflict() ? this.#t("conflict") : editNotice ? this.#t(editNotice) : this.#status ? this.#t(this.#status) : this.#announcement}</p>
    </section>`;
  }
}

if (!customElements.get("forma-output-requirement-card")) customElements.define("forma-output-requirement-card", FormaOutputRequirementCard);
declare global {
  interface HTMLElementTagNameMap { "forma-output-requirement-card": FormaOutputRequirementCard }
  interface HTMLElementEventMap {
    "forma-output-edit": CustomEvent<OutputRequirementEditIntent>;
    "forma-output-save": CustomEvent<OutputRequirementSaveIntent>;
    "forma-output-cancel": CustomEvent<OutputRequirementCancelIntent>;
    "forma-output-review-plan": CustomEvent<OutputRequirementReviewPlanIntent>;
    "forma-output-open-result": CustomEvent<OutputRequirementOpenResultIntent>;
  }
}
