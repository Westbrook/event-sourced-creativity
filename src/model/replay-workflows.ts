import { defaultSlidePresentation, DOCUMENT_ARTIFACT_KINDS, normalizeSlideVisual } from "./document-artifacts.ts";
import type { CreativeEvent } from "./events.ts";
import type { CreativeStudyKind } from "./replay-development.ts";

export const REPLAY_OUTPUT_KINDS = ["image", ...DOCUMENT_ARTIFACT_KINDS] as const;
export type ReplayOutputKind = typeof REPLAY_OUTPUT_KINDS[number];

export type FinishedWorkProduct = {
  kind: ReplayOutputKind;
  title: string;
  audience?: string;
  purpose?: string;
  content?: string;
  subject?: string;
  setting?: string;
  lighting?: string;
  palette?: string[];
  constraints?: string[];
  reference?: { label: string; rightsConfirmed?: boolean; attribution?: string };
};

export type ReconstructedContextFact = {
  type: "direction" | "subject" | "environment" | "lighting" | "palette" | "exclusion" | "reference";
  label: string;
  value: string;
  authority: "inferred";
  confidence: number;
  evidence: string;
  requiresConfirmation: true;
};

export type ReplayWorkflowStep = {
  id: string;
  phase: "intake" | "intent" | "context" | "rights" | "study" | "compose" | "approval" | "render" | "review" | "reuse" | "deliver";
  label: string;
  rationale: string;
  actor: "user" | "worker";
  eventTypes: string[];
  dependsOn: string[];
  requiresApproval: boolean;
  inferred: boolean;
};

export type ReverseEngineeredWorkflow = {
  workflowId: string;
  source: Readonly<FinishedWorkProduct>;
  outputKind: ReplayOutputKind;
  confidence: number;
  contextFingerprint: string;
  inferredContext: ReconstructedContextFact[];
  steps: ReplayWorkflowStep[];
  alternatives: Array<{ id: string; label: string; reason: string; confidence: number; entryStep: ReplayWorkflowStep; steps: string[] }>;
  safeguards: {
    originalArtifactPreserved: true;
    inferredFactsRequireAcceptance: true;
    paidWorkRequiresApproval: true;
    referenceRightsRequired: boolean;
    noProviderCalls: true;
  };
};

export type ReplayWorkflowOptions = {
  workflowId?: string;
  projectId?: string;
  documentId?: string;
  streamId?: string;
  providerBacked?: boolean;
  interruptBefore?: ReplayOutputKind;
  recoverInterrupted?: boolean;
  leaveUnfinished?: ReplayOutputKind;
  focusedStudies?: CreativeStudyKind[];
  includeSharing?: boolean;
  artifactFirst?: boolean;
};

const text = (value: unknown) => String(value ?? "").trim();
const slug = (value: unknown) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "creative-work";
const labels: Record<ReplayOutputKind, string> = { image: "image", short_story: "short story", scene: "screen scene", slides: "presentation", storyboard: "storyboard", video: "video treatment" };
const SAFE_SHARE_AUDIT_FIELDS = new Set([
  "share_id", "project_id", "document_id", "resource_id", "resource_kind", "access", "expires_at", "revoked_at", "revoked", "media_count", "audit_only", "trusted_share_service",
  "workflow_id", "workflow_mode", "inferred_history", "narrative_scenario", "experience_area", "narrative_position", "narrative_length", "chapter_cycle", "primary_facet",
  "mock_data_source", "replay_session_id", "experience_profile", "development_stage_kind", "development_stage_sequence", "development_stage_total", "study",
  "target_event_count", "provider_milestone_index", "fixture_cycle", "durable_media_backed", "provider_call_backed", "external_asset_backed", "fixture_asset_reused",
]);

/** Trusted share witnesses retain scoped identifiers only, never links, tokens, nested data, or creative text. */
export function sanitizeReplayShareAuditPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).filter(([key, value]) => SAFE_SHARE_AUDIT_FIELDS.has(key) && (value === null || ["string", "number", "boolean"].includes(typeof value)) && !(typeof value === "string" && /https?:\/\/|data:|\/share\/|(?:^|[?&])token=/i.test(value))));
}

export function replayShareAuditPayloadIsSafe(payload: Record<string, unknown>) {
  return Object.keys(payload).length === Object.keys(sanitizeReplayShareAuditPayload(payload)).length;
}

function canonicalContextValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map(canonicalContextValue);
    if (normalized.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      return [...normalized].sort((left, right) => {
        const first = left as Record<string, unknown>;
        const second = right as Record<string, unknown>;
        const firstOrder = Number(first.member_order ?? first.memberOrder ?? first.order ?? Number.NaN);
        const secondOrder = Number(second.member_order ?? second.memberOrder ?? second.order ?? Number.NaN);
        if (Number.isFinite(firstOrder) && Number.isFinite(secondOrder)) return firstOrder - secondOrder;
        const firstKey = text(first.block_id ?? first.id ?? first.type ?? "");
        const secondKey = text(second.block_id ?? second.id ?? second.type ?? "");
        return firstKey.localeCompare(secondKey) || JSON.stringify(first).localeCompare(JSON.stringify(second));
      });
    }
    return normalized;
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalContextValue(item)]));
  return value;
}

/** A deterministic, non-sensitive identifier; this is provenance labeling, not cryptographic security. */
export function replayContextFingerprint(value: unknown) {
  const source = JSON.stringify(canonicalContextValue(value));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `context-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizedProduct(product: FinishedWorkProduct): FinishedWorkProduct {
  const kind = REPLAY_OUTPUT_KINDS.includes(product.kind) ? product.kind : "image";
  return {
    ...product,
    kind,
    title: text(product.title) || `Untitled ${labels[kind]}`,
    audience: text(product.audience) || "creative review team",
    purpose: text(product.purpose) || `Make the resolved creative direction useful as a ${labels[kind]}.`,
    palette: [...new Set((product.palette ?? []).map((color) => text(color)).filter(Boolean))],
    constraints: [...new Set((product.constraints ?? []).map((constraint) => text(constraint)).filter(Boolean))],
  };
}

function contextFacts(product: FinishedWorkProduct): ReconstructedContextFact[] {
  const explicit = (type: ReconstructedContextFact["type"], label: string, value: unknown, confidence: number, evidence: string): ReconstructedContextFact[] => text(value)
    ? [{ type, label, value: text(value), authority: "inferred", confidence, evidence, requiresConfirmation: true }]
    : [];
  const palette = product.palette?.length ? product.palette : text(product.content).match(/#[a-f\d]{6}\b/gi) ?? [];
  return [
    ...explicit("direction", "Creative direction", product.purpose ?? product.title, product.purpose ? .84 : .58, product.purpose ? "supplied purpose" : "finished title"),
    ...explicit("subject", "Subject", product.subject, .88, "supplied subject"),
    ...explicit("environment", "Setting", product.setting, .86, "supplied setting"),
    ...explicit("lighting", "Lighting", product.lighting, .85, "supplied lighting"),
    ...explicit("palette", "Palette", palette.join(", "), product.palette?.length ? .87 : .62, product.palette?.length ? "supplied palette" : "colors observed in the finished work"),
    ...(product.constraints ?? []).flatMap((constraint) => explicit("exclusion", "Keep out", constraint, .9, "supplied negative constraint")),
    ...explicit("reference", "Reference", product.reference?.label, .81, "supplied reference"),
  ];
}

function workflowStep(id: string, phase: ReplayWorkflowStep["phase"], label: string, rationale: string, eventTypes: string[], dependsOn: string[], options: Partial<Pick<ReplayWorkflowStep, "actor" | "requiresApproval" | "inferred">> = {}): ReplayWorkflowStep {
  return { id, phase, label, rationale, eventTypes, dependsOn, actor: options.actor ?? "user", requiresApproval: options.requiresApproval ?? false, inferred: options.inferred ?? false };
}

/**
 * Propose a reversible route from finished work to editable creative context.
 * This function is pure: it neither asserts historical provenance nor spends money.
 */
export function reverseEngineerWorkProduct(input: FinishedWorkProduct): ReverseEngineeredWorkflow {
  const source = Object.freeze(normalizedProduct(input));
  const inferredContext = contextFacts({ ...source, purpose: text(input.purpose) || undefined });
  const fingerprint = replayContextFingerprint(inferredContext.map(({ type, value }) => ({ type, value })));
  const workflowId = `workflow-${slug(source.title)}-${fingerprint.slice(-8)}`;
  const steps: ReplayWorkflowStep[] = [
    workflowStep("preserve-original", "intake", "Keep the original work unchanged", "The supplied artifact is evidence, not proof that an earlier workflow really happened.", [], []),
    workflowStep("name-the-outcome", "intent", `Choose the purpose of the ${labels[source.kind]}`, "Confirm who the result serves and what successful use looks like.", ["IntentDeclared"], ["preserve-original"]),
    workflowStep("review-inferred-context", "context", "Review suggested creative decisions", "Recovered subject, setting, palette, and exclusions remain suggestions until explicitly accepted.", ["MutationProposed", "ProposalAccepted", "BlockCreated"], ["name-the-outcome"], { inferred: true }),
  ];
  if (source.reference) steps.push(workflowStep("confirm-reference-rights", "rights", "Confirm reference permission", "Imported reference imagery cannot enter paid generation until its usage rights are verified.", ["ReferenceIngested", "RightsAsserted"], ["review-inferred-context"], { requiresApproval: true }));
  const contextDependency = source.reference ? "confirm-reference-rights" : "review-inferred-context";
  if (source.subject || source.setting) steps.push(workflowStep("resolve-focused-study", "study", "Resolve the most uncertain detail", "A small focused study protects the accepted identity or environment before composition.", ["BlockCreated", "BlockLocked"], [contextDependency]));
  const studyDependency = source.subject || source.setting ? "resolve-focused-study" : contextDependency;
  steps.push(
    workflowStep("compose-one-context", "compose", "Assemble one reusable creative context", "Every later form should point to the same project, document, context revision, and fingerprint.", ["ContextSetFormalized", "ContextCompiled"], [studyDependency]),
  );
  steps.push(workflowStep("approve-paid-work", "approval", `Review ${labels[source.kind]} production costs`, "No provider-backed planning, image generation, or media rendering starts without a separate direct approval.", [], ["compose-one-context"], { requiresApproval: true }));
  const renderDependency = "approve-paid-work";
  steps.push(
    workflowStep("make-the-output", "render", `Create the ${labels[source.kind]}`, "Render only after the creator has confirmed the inferred context, usage rights, and provider spending.", source.kind === "image" ? ["GenerationRequested", "ContextCompiled", "GenerationCompleted"] : ["DocumentRenderRequested", "DocumentRenderCompleted"], [renderDependency], { requiresApproval: true }),
    workflowStep("review-the-result", "review", "Inspect the finished result", "A result is not a successful handoff until a person actually opens and evaluates it.", source.kind === "image" ? ["ObjectViewed", "ObjectSaved"] : ["DocumentArtifactViewed"], ["make-the-output"]),
    workflowStep("reuse-the-context", "reuse", "Try another form from the same context", "The accepted source context can answer another audience's question without being recreated.", ["BlockCreated"], ["review-the-result"]),
    workflowStep("deliver-the-work", "deliver", "Export or share the chosen result", "Delivery is an explicit, attributable creator action; share receipts never contain tokens or private URLs.", source.kind === "image" ? ["ObjectExported"] : ["DocumentArtifactExported"], ["review-the-result"]),
  );
  const confidence = Math.min(.93, Number((.49 + inferredContext.length * .07 + (source.content ? .05 : 0)).toFixed(2)));
  const referenceEntry=workflowStep("inspect-reference-evidence","context","Inspect the finished visual or approved reference","Identify visual evidence without treating it as licensed generation input.",[],["preserve-original"],{inferred:true});
  const conversationEntry=workflowStep("discuss-the-desired-outcome","intent","Describe what success should feel like","Start with a creator conversation before proposing a direction.",["ChatMessageSent"],["preserve-original"]);
  const libraryEntry=workflowStep("discover-existing-library-context","context","Search existing project Library decisions","Locate reusable accepted context before proposing new creative decisions.",["CanvasInteractionRecorded"],["preserve-original"]);
  const alternativeSteps=(entry:ReplayWorkflowStep,omitReuse=false)=>["preserve-original",entry.id,...steps.filter((step)=>step.id!=="preserve-original"&&(!omitReuse||step.phase!=="reuse")).map((step)=>step.id)];
  return {
    workflowId,
    source,
    outputKind: source.kind,
    confidence,
    contextFingerprint: fingerprint,
    inferredContext,
    steps,
    alternatives: [
      { id: "reference-first", label: "Start from visual evidence", reason: "Useful when an approved image communicates the direction more clearly than written context.", confidence: source.reference ? .8 : .57, entryStep:referenceEntry, steps:alternativeSteps(referenceEntry,true) },
      { id: "conversation-first", label: "Start with a conversation", reason: "Useful when the desired audience or emotional outcome is clearer than its visual execution.", confidence: .73, entryStep:conversationEntry, steps:alternativeSteps(conversationEntry) },
      { id: "library-first", label: "Reuse an existing context set", reason: "Useful when a related subject, palette, or setting already belongs to the project Library.", confidence: inferredContext.length >= 3 ? .78 : .59, entryStep:libraryEntry, steps:alternativeSteps(libraryEntry) },
    ],
    safeguards: { originalArtifactPreserved: true, inferredFactsRequireAcceptance: true, paidWorkRequiresApproval: true, referenceRightsRequired: Boolean(source.reference), noProviderCalls: true },
  };
}

function outputBrief(product: FinishedWorkProduct) {
  const kind = product.kind;
  return {
    title: product.title,
    purpose: product.purpose,
    audience: product.audience,
    content_direction: product.subject ? `${product.subject}${product.setting ? ` in ${product.setting}` : ""}.` : product.purpose,
    success_signal: `${product.audience} can use this ${labels[kind]} without reopening accepted creative decisions.`,
    beats: [
      `Establish why ${product.title} matters to ${product.audience}.`,
      `Develop the ${labels[kind]} using the accepted subject, setting, and constraints.`,
      `Leave ${product.audience} with a specific decision or next step.`,
    ],
  };
}

/** Materialize an honest, deterministic nothing-to-something creator journey. */
export function buildNothingToSomethingWorkflow(inputs: FinishedWorkProduct[], options: ReplayWorkflowOptions = {}): CreativeEvent[] {
  const products = inputs.map(normalizedProduct);
  if (!products.length) return [];
  const sharedDirection = { ...products[0], palette: [...(products[0].palette ?? [])], constraints: [...(products[0].constraints ?? [])] };
  for (const product of products.slice(1)) {
    for (const field of ["subject", "setting", "lighting"] as const) {
      const incoming = text(product[field]);
      if (incoming && text(sharedDirection[field]) && incoming !== text(sharedDirection[field])) throw new Error("replay_work_products_require_shared_context");
      if (incoming && !sharedDirection[field]) sharedDirection[field] = incoming;
    }
    sharedDirection.palette = [...new Set([...sharedDirection.palette, ...(product.palette ?? [])])];
    sharedDirection.constraints = [...new Set([...sharedDirection.constraints, ...(product.constraints ?? [])])];
  }
  products[0] = sharedDirection;
  const recipe = reverseEngineerWorkProduct(sharedDirection);
  const referencesByLabel = new Map<string, NonNullable<FinishedWorkProduct["reference"]>>();
  for (const product of products) {
    if (!product.reference) continue;
    const existing = referencesByLabel.get(product.reference.label);
    referencesByLabel.set(product.reference.label, existing ? { ...existing, rightsConfirmed: existing.rightsConfirmed === true && product.reference.rightsConfirmed === true } : { ...product.reference });
  }
  const sharedReferences = [...referencesByLabel.values()];
  const acceptedContext: ReconstructedContextFact[] = [...recipe.inferredContext, ...sharedReferences.filter((reference) => !recipe.inferredContext.some((fact) => fact.type === "reference" && fact.value === reference.label)).map((reference) => ({ type: "reference" as const, label: "Reference", value: reference.label, authority: "inferred" as const, confidence: .81, evidence: "supplied reference", requiresConfirmation: true as const }))];
  const workflowId = options.workflowId ?? recipe.workflowId;
  const projectId = options.projectId ?? `project-${slug(products[0].title)}`;
  const documentId = options.documentId ?? `document-${slug(products[0].title)}`;
  const streamId = options.streamId ?? `theory:workflow:${slug(workflowId)}`;
  const sourceContextId = `context-set-${slug(workflowId)}`;
  const canvasId = `canvas-${slug(workflowId)}`;
  const contextFingerprint = options.focusedStudies?.length || sharedReferences.length > Number(Boolean(products[0].reference)) ? replayContextFingerprint({ context: recipe.contextFingerprint, studies: options.focusedStudies ?? [], references: sharedReferences.map((reference) => reference.label) }) : recipe.contextFingerprint;
  const revision = "context-revision-1";
  const events: CreativeEvent[] = [];
  const previousByCorrelation = new Map<string, string>();
  let clock = Date.UTC(2026, 0, 5, 9);
  let sessionNumber = 1;
  const add = (actor: CreativeEvent["actor"], type: string, payload: Record<string, unknown>, branch = "foundation", delay = actor === "user" ? 42_000 : 5_000) => {
    clock += delay;
    const sequence = events.length + 1;
    const eventId = `${slug(workflowId)}-event-${sequence}`;
    const correlationId = `corr-${slug(workflowId)}-${branch}`;
    const occurredAt = new Date(clock).toISOString();
    const event: CreativeEvent = {
      eventId,
      streamId,
      sequence,
      occurredAt,
      recordedAt: occurredAt,
      actor,
      clientId: "web:replay-workflow",
      correlationId,
      causationId: previousByCorrelation.get(correlationId) ?? events.at(-1)?.eventId ?? null,
      compensatesEventId: null,
      schemaVersion: 1,
      type,
      payload: { workflow_id: workflowId, project_id: projectId, ...(options.artifactFirst ? { workflow_mode: "artifact-first", inferred_history: true } : {}), ...payload },
    };
    previousByCorrelation.set(correlationId, eventId);
    events.push(event);
    return event;
  };

  add("user", "SessionOpened", { session_id: `${workflowId}-session-${sessionNumber}`, reentry: false });
  add("user", "ProjectCreated", { project_id: projectId, name: products[0].title, state: "active" });
  add("user", "DocumentCreated", { document_id: documentId, title: `${products[0].title} · source context`, handle: slug(products[0].title) });
  add("user", "EmptyCanvasChosen", { document_id: documentId, explicit_blank: true });
  add("user", "IntentDeclared", { document_id: documentId, scope_ref: documentId, intent_id: `${workflowId}-root-intent`, statement_ref: `${workflowId}-private-root-intent`, deadline: null, expected_output_kind: "context" });

  if (options.artifactFirst) {
    add("model:forma-chat", "MutationProposed", {
      document_id: documentId,
      proposal_id: `${workflowId}-reverse-proposal`,
      inference_only: true,
      proposed_context_types: acceptedContext.map((fact) => fact.type),
      source_artifact_kind: products[0].kind,
      source_artifact_preserved: true,
      proposed_events: [],
    });
    add("user", "ProposalAccepted", { document_id: documentId, proposal_id: `${workflowId}-reverse-proposal`, accepted_inferred_context: true });
  }

  acceptedContext.forEach((fact, index) => {
    add("user", "BlockCreated", {
      document_id: documentId,
      block_id: `${workflowId}-block-${fact.type}-${index + 1}`,
      type: fact.type,
      handle: `${fact.type}/${slug(fact.label)}`,
      position: `a${String(index).padStart(4, "0")}`,
      properties: { text: fact.value, label: fact.label, authority: "authored", accepted_from_inference: options.artifactFirst === true, intent: fact.type === "exclusion" ? "avoid" : "include", weight: .85 },
    });
  });
  const sourceBlockVersions = [...acceptedContext.map((fact, index) => ({ block_id: `${workflowId}-block-${fact.type}-${index + 1}`, version: 1 })), ...(options.focusedStudies ?? []).map((study) => ({ block_id: `${workflowId}-study-${study}`, version: 1 }))];

  sharedReferences.forEach((reference,index)=>{
    const referenceId = `${workflowId}-reference${index ? `-${index + 1}` : ""}`;
    add("user", "ReferenceIngested", { document_id: documentId, reference_id: referenceId, label: reference.label, source_type: "fictional-fixture", media_url: `/api/media/replay%2Freferences%2F${slug(referenceId)}.jpg`, synthetic_reference: true });
    if (reference.rightsConfirmed === true) add("user", "RightsAsserted", { document_id: documentId, reference_id: referenceId, rights_class: "synthetic-fixture", attribution: reference.attribution ?? "Fictional replay reference" });
  });

  for (const study of options.focusedStudies ?? []) {
    const blockId = `${workflowId}-study-${study}`;
    const studyType = study === "character" || study === "prop" || study === "wardrobe" ? "subject" : study === "location" ? "environment" : study === "logo" ? "brand" : study;
    add("user", "BlockCreated", { document_id: documentId, block_id: blockId, type: studyType, handle: `${study}/focused-study`, position: `s${study}`, properties: { text: `Resolve the ${study} independently before composition.`, authority: "authored", study_kind: study, weight: .9 } }, `study-${study}`);
    add("user", "BlockLocked", { document_id: documentId, block_id: blockId, development_stage_kind: study, study: true, lock_reason: `Preserve the accepted ${study} decision during later composition.` }, `study-${study}`);
  }

  add("user", "CanvasCreated", { canvas_id: canvasId, name: `${products[0].title} · context board`, document_id: documentId });
  const canvasItemIds = acceptedContext.map((fact, index) => {
    const itemId = `${workflowId}-canvas-item-${index + 1}`;
    add("user", "CanvasItemPlaced", { canvas_id: canvasId, document_id: documentId, item_id: itemId, source_kind: "block", source_id: `${workflowId}-block-${fact.type}-${index + 1}`, title: fact.label, x: index * 180, y: 80, w: 160, h: 120 });
    return itemId;
  });
  add("user", "ContextSetFormalized", {
    canvas_id: canvasId,
    document_id: documentId,
    context_set_id: sourceContextId,
    source_context_id: sourceContextId,
    context_fingerprint: contextFingerprint,
    context_revision: revision,
    source_block_versions: sourceBlockVersions,
    name: `${products[0].title} · shared context`,
    target: products[0].subject ?? products[0].title,
    role: "scene",
    application: "isolate",
    relativity: 1,
    semantic_isolation: true,
    composite: true,
    item_ids: canvasItemIds,
  });

  const occurrenceByKind = new Map<ReplayOutputKind, number>();
  for (const product of products) {
    const occurrence = (occurrenceByKind.get(product.kind) ?? 0) + 1;
    occurrenceByKind.set(product.kind, occurrence);
    const suffix = occurrence === 1 ? product.kind : `${product.kind}-${occurrence}`;
    const intentId = `${workflowId}-intent-${suffix}`;
    const branch = `intent-${suffix}`;
    const artifactId = `${workflowId}-artifact-${suffix}`;
    const generationId = `${workflowId}-generation-${suffix}`;
    const shared = { document_id: documentId, intent_id: intentId, parent_intent_id: `${workflowId}-root-intent`, source_context_id: sourceContextId, context_fingerprint: contextFingerprint, context_revision: revision, source_block_versions: sourceBlockVersions };
    const brief = outputBrief(product);
    add("user", "IntentDeclared", { ...shared, scope_ref: documentId, statement_ref: `${workflowId}-private-intent-${suffix}`, expected_output_kind: product.kind, deadline: null }, branch);

    const image = product.kind === "image";
    const request = image
      ? { ...shared, generation_id: generationId, requested_output: "image", quality: "high", purpose: "final", job_kind: "generate", document_revision: revision, output_brief: brief, reference_rights_required: sharedReferences.length > 0 }
      : { ...shared, artifact_id: artifactId, artifact_kind: product.kind, job_kind: "render_document", paid_media_confirmed: product.kind !== "video" || !options.providerBacked, ...(product.kind==="video"&&options.providerBacked?{approval_required:true}:{}), output_brief: brief, reference_rights_required: sharedReferences.length > 0 };
    add("user", image ? "GenerationRequested" : "DocumentRenderRequested", request, branch);

    if (sharedReferences.some((reference) => reference.rightsConfirmed !== true)) {
      add("worker:policy", "GenerationBlockedBeforeProvider", { ...shared, ...(image ? { generation_id: generationId } : { artifact_id: artifactId, artifact_kind: product.kind }), blocking_probes: ["reference-rights"], reason: "reference_rights_not_confirmed", estimated_cost_avoided_microusd: 0 }, branch);
      continue;
    }

    if (options.interruptBefore === product.kind) {
      add("user", "SessionClosed", { session_id: `${workflowId}-session-${sessionNumber}`, snapshot_ref: { project_id: projectId, document_id: documentId, head: events.at(-1)?.sequence ?? 0 } }, "foundation");
      sessionNumber += 1;
      add("user", "SessionOpened", { session_id: `${workflowId}-session-${sessionNumber}`, snapshot_ref: { project_id: projectId, document_id: documentId }, reentry: true }, "foundation", 57_600_000);
      if (!options.recoverInterrupted) continue;
      add("user", "DocumentOpened", { document_id: documentId, intent_id: intentId, resumed_intent_id: intentId }, branch);
    }

    if (options.leaveUnfinished === product.kind) continue;

    add("worker:compiler", "ContextCompiled", {
      ...shared,
      ...(image ? { generation_id: generationId } : { artifact_id: artifactId }),
      document_revision: revision,
      compiled_snapshot: {
        facts: [...acceptedContext.map((fact) => ({ type: fact.type, value: fact.value, authority: "authored", intent: fact.type === "exclusion" ? "avoid" : "include" })), ...(options.focusedStudies ?? []).map((study) => ({ block_id: `${workflowId}-study-${study}`, type: study === "character" || study === "prop" || study === "wardrobe" ? "subject" : study === "location" ? "environment" : study === "logo" ? "brand" : study, value: `Preserve the accepted ${study} decision.`, authority: "authored", intent: "include", study_kind: study, locked: true }))],
        standing_constraints: products[0].constraints ?? [],
        locked_studies: (options.focusedStudies ?? []).map((study) => ({ study_kind: study, block_id: `${workflowId}-study-${study}`, locked: true })),
        consumes_studies: options.focusedStudies ?? [],
        source_context_id: sourceContextId,
        context_fingerprint: contextFingerprint,
        as_of: { document_revision: revision, complete: true },
      },
    }, branch);

    if (product.kind === "video" && options.providerBacked) {
      add("worker:renderer", "DocumentRenderFailed", {
        ...shared,
        artifact_id: artifactId,
        artifact_kind: "video",
        error_code: "video_provider_not_approved_for_actual_data_mock",
        error_message: "The video treatment is ready; rendering requires a separate explicit approval.",
        retryable: false,
        provider_job_id: null,
        video_mock_boundary: true,
        output_brief: brief,
      }, branch);
      continue;
    }

    if (image) {
      const objectId = `${workflowId}-output-${suffix}`;
      add("worker:generator", "GenerationCompleted", { ...shared, generation_id: generationId, object_ids: [objectId], object_id: objectId, model_id: "fictional-replay", quality: "high", purpose: "final", simulation: true, media_url: `/api/media/replay%2Fgenerated%2F${slug(objectId)}.png`, output_brief: brief }, branch);
      add("user", "ObjectViewed", { ...shared, object_id: objectId }, branch);
      add("user", "ObjectSaved", { ...shared, object_id: objectId }, branch);
      add("user", "ObjectExported", { ...shared, object_id: objectId, format: "image/png" }, branch);
    } else {
      const count = product.kind === "slides" ? 4 : product.kind === "storyboard" ? 4 : 1;
      const items = Array.from({ length: count }, (_, index) => {
        const title = count === 1 ? product.title : `${product.title} · ${product.kind === "slides" ? "slide" : "frame"} ${index + 1}`;
        const body = index >= brief.beats.length ? `Decision ${index + 1}: ${brief.success_signal}` : brief.beats[index];
        return {
          id: `${artifactId}-item-${index + 1}`,
          title,
          body,
          notes: `For ${product.audience}. ${brief.success_signal}`,
          image_prompt: product.kind === "storyboard" ? body : "",
          ...(product.kind === "slides" ? {
            slide: normalizeSlideVisual({
              layout: index === 0 ? "cover" : "split",
              kicker: `Decision ${index + 1}`,
              bullets: [body],
              footer: { label: product.title, counter: `${index + 1} / ${count}` },
              visual: { kind: index === 0 ? "hero-type" : "metric", label: "Creative signal", value: index === 0 ? "One shared context" : `${index + 1} decisions`, data: [] },
            }, { title, body }, index),
          } : {}),
          ...(product.kind === "storyboard" ? { media_url: `/api/media/replay%2Fstoryboard%2F${slug(artifactId)}-${index + 1}.jpg`, media_type: "image/jpeg", width: 1024, height: 1024 } : {}),
        };
      });
      add("worker:renderer", "DocumentRenderCompleted", { ...shared, artifact_id: artifactId, artifact_kind: product.kind, content_ref: `synthetic-artifact:${artifactId}`, title: product.title, summary: product.purpose, output_brief: brief, items, item_count: count, presentation: product.kind === "slides" ? { ...defaultSlidePresentation("nocturne"), theme: product.title, footerLabel: product.title, footer_label: product.title } : null, media_url: product.kind === "video" ? `/api/media/replay%2Fvideo%2F${slug(artifactId)}.mp4` : null, media_type: product.kind === "video" ? "video/mp4" : null, ...(product.kind === "video" ? { provider_job_id: `simulation:${artifactId}` } : {}), provider: "fictional-replay", simulation: true }, branch);
      add("user", "DocumentArtifactViewed", { ...shared, artifact_id: artifactId, artifact_kind: product.kind, viewer_kind: product.kind === "storyboard" ? "storyboard" : product.kind === "video" ? "media" : "reader" }, branch);
      add("user", "DocumentArtifactExported", { ...shared, artifact_id: artifactId, artifact_kind: product.kind, format: product.kind === "video" ? "video/mp4" : product.kind === "slides" ? "application/pdf" : "markdown" }, branch);
    }
  }

  const firstCompleted = events.find((event) => event.type === "GenerationCompleted" || event.type === "DocumentRenderCompleted");
  if (firstCompleted) {
    const image = firstCompleted.type === "GenerationCompleted";
    const nextFingerprint = replayContextFingerprint({ previous: contextFingerprint, output: firstCompleted.eventId });
    add("user", "BlockCreated", {
      document_id: documentId,
      block_id: `${workflowId}-output-as-context`,
      type: image ? "reference" : "message",
      handle: `${image ? "reference" : "message"}/accepted-result`,
      position: "z9999",
      source_context_id: sourceContextId,
      parent_context_fingerprint: contextFingerprint,
      context_fingerprint: nextFingerprint,
      context_revision: "context-revision-2",
      properties: {
        authority: "authored",
        input_mode: "full_output",
        ...(image ? { source_output_id: firstCompleted.payload.object_id, source_generation_id: firstCompleted.payload.generation_id } : { source_artifact_id: firstCompleted.payload.artifact_id, source_artifact_kind: firstCompleted.payload.artifact_kind }),
        source_document_id: documentId,
      },
    }, "reuse");
    if (options.artifactFirst) {
      const generationId = `${workflowId}-derived-generation`;
      const objectId = `${workflowId}-derived-output`;
      const shared = { document_id: documentId, intent_id: `${workflowId}-derived-intent`, parent_intent_id: `${workflowId}-root-intent`, source_context_id: sourceContextId, context_fingerprint: nextFingerprint, context_revision: "context-revision-2", source_block_versions: [...sourceBlockVersions, { block_id: `${workflowId}-output-as-context`, version: 1 }] };
      add("user", "IntentDeclared", { ...shared, scope_ref: documentId, statement_ref: `${workflowId}-private-derived-intent`, expected_output_kind: "image", deadline: null }, "reuse");
      add("user", "GenerationRequested", { ...shared, generation_id: generationId, requested_output: "image", quality: "high", purpose: "final", job_kind: "generate", document_revision: "context-revision-2", output_brief: outputBrief(products.find((product) => product.kind === "image") ?? { ...products[0], kind: "image" }) }, "reuse");
      add("worker:compiler", "ContextCompiled", { ...shared, generation_id: generationId, document_revision: "context-revision-2", compiled_snapshot: { facts: [{ type: image ? "reference" : "message", authority: "authored", ...(image ? { source_output_id: firstCompleted.payload.object_id } : { source_artifact_id: firstCompleted.payload.artifact_id }) }], source_context_id: sourceContextId, context_fingerprint: nextFingerprint, as_of: { document_revision: "context-revision-2", complete: true } } }, "reuse");
      add("worker:generator", "GenerationCompleted", { ...shared, generation_id: generationId, object_id: objectId, object_ids: [objectId], model_id: "fictional-replay", quality: "high", purpose: "final", simulation: true, media_url: `/api/media/replay%2Fgenerated%2F${slug(objectId)}.png`, output_brief: outputBrief(products.find((product) => product.kind === "image") ?? { ...products[0], kind: "image" }) }, "reuse");
      add("user", "ObjectSaved", { ...shared, object_id: objectId }, "reuse");
    }
  }

  if (options.includeSharing && firstCompleted) {
    const shareId = `${workflowId}-share`;
    const mediaCount = new Set(events.filter((event)=>event.type==="GenerationCompleted"||event.type==="DocumentRenderCompleted").flatMap((event)=>[text(event.payload.media_url),...(Array.isArray(event.payload.items)?event.payload.items.map((item)=>text((item as Record<string,unknown>).media_url)):[])]).filter(Boolean)).size;
    add("user", "ShareLinkCreated", { document_id: documentId, share_id: shareId, resource_id: documentId, resource_kind: "document", access: "read-only", media_count: mediaCount, expires_at: new Date(clock + 86_400_000).toISOString(), audit_only: true, trusted_share_service: true }, "delivery");
    add("user", "ShareLinkRevoked", { document_id: documentId, share_id: shareId, resource_id: documentId, resource_kind: "document", revoked_at: new Date(clock + 42_000).toISOString(), audit_only: true, trusted_share_service: true }, "delivery");
  }

  return events;
}

export const DEFAULT_REPLAY_WORK_PRODUCTS: FinishedWorkProduct[] = [
  { kind: "image", title: "The field remembers", audience: "campaign art director", purpose: "Establish the visual anchor for a restrained community campaign.", subject: "A child returning to an empty playing field", setting: "a weathered coastal field at dusk", lighting: "soft late-day amber light", palette: ["#17211c", "#d99261", "#e9dfca"], constraints: ["Avoid posed crowds and saturated orange"], reference: { label: "Rights-cleared coastal field reference", rightsConfirmed: true } },
  { kind: "short_story", title: "The Last Match", audience: "editorial lead", purpose: "Reveal why the child returns after the final game." },
  { kind: "scene", title: "EXT. SILVER FIELD — DUSK", audience: "director and cast", purpose: "Translate the emotional idea into playable movement and dialogue." },
  { kind: "slides", title: "A Field After the Crowd", audience: "campaign review group", purpose: "Explain which creative decisions are locked and what still needs approval." },
  { kind: "storyboard", title: "The Last Match · Previz", audience: "cinematographer and editor", purpose: "Test shot order and spatial continuity before motion production." },
  { kind: "video", title: "The Last Match · Motion Study", audience: "motion director", purpose: "Describe camera movement, pacing, and the separate video-provider handoff." },
];
