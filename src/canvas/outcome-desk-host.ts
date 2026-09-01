import { outputNavigationMatches, type OutputNavigationReference, type OutputNavigationSection } from "../model/output-navigation.ts";
import { outputContinuationChoices } from "../components/output-continuation.ts";
import { creativeNextActionDisplayLabels, type CreativeNextActionDisplayLocale } from "../model/output-naming.ts";
import type { ArtifactDeliveryIntent, artifactDeliveryState } from "../model/artifact-delivery.ts";
import { DOCUMENT_ARTIFACT_KINDS, documentArtifactRevision, type DocumentArtifact } from "../model/document-artifacts.ts";
import {
  creativeActionSourceRevision, creativeNextActions, creativeNextTargetAvailable, creativePreparationChoice,
  type CreativeActionScope, type CreativeNextAction, type CreativeNextTarget,
} from "../model/workspace-intelligence.ts";
import { outcomeDeskKey, outcomeDeskOutputRead, outcomeDeskOutputSnapshot, projectOutcomeDesk, type OutcomeDeskAction, type OutcomeDeskInput, type OutcomeDeskRow } from "../model/outcome-desk.ts";

type Delivery = ReturnType<typeof artifactDeliveryState>;
export type OutcomeDeskTarget = { kind: "canonical-output"; reference: OutputNavigationReference; section: OutputNavigationSection; refresh: boolean }
  | { kind: "next"; action: CreativeNextAction } | {
  kind: "delivery"; artifactId: string; sequence: number; revision: number;
  sourceEventId: string; contentRef: string | null; intent: ArtifactDeliveryIntent; proof: string;
};
export type OutcomeDeskHostPorts = {
  /** The existing current locale supplies date/number formatting, not state or authority. */
  displayLocale?: CreativeNextActionDisplayLocale;
  localize: (id: string, fallback: string) => string;
  delivery: (artifact: DocumentArtifact) => Delivery;
};
const scopeFor = (input: OutcomeDeskInput): CreativeActionScope => ({
  projectId: input.facts.projectId, documentId: input.facts.documentId,
  canvasId: input.facts.canvasId ?? null, authorityKey: input.facts.authorityKey,
});
const deliveryProof = (delivery: Delivery) => JSON.stringify({
  revision: delivery.revision, review: delivery.review, approved: delivery.approved, canRead: delivery.canRead,
  action: delivery.action, intent: delivery.intent, rightsBlockIds: delivery.rightsBlockIds,
  independentEligible: delivery.independentEligible, contentSha256: delivery.contentSha256,
  assignedReviewerId: delivery.assignedReviewerId,
});
function wrap(row: OutcomeDeskRow, input: OutcomeDeskInput, action: CreativeNextAction, ports: OutcomeDeskHostPorts,
  copyId: string = action.id): OutcomeDeskAction<OutcomeDeskTarget> {
  return { key: row.key + ":" + action.id + ":" + JSON.stringify(action.target), subject: row.reference,
    scope: scopeFor(input), sourceRevision: creativeActionSourceRevision(input.facts), effect: "open-existing-executor",
    label: ports.localize(action.labelKey ?? "next.exact." + copyId + ".label", action.label),
    detail: ports.localize(action.reasonKey ?? "next.exact." + copyId + ".reason", action.reason), target: { kind: "next", action } };
}
function deliveryAction(row: OutcomeDeskRow, input: OutcomeDeskInput, artifact: DocumentArtifact, ports: OutcomeDeskHostPorts): OutcomeDeskAction<OutcomeDeskTarget> {
  const delivery = ports.delivery(artifact), proof = deliveryProof(delivery);
  return { key: row.key + ":delivery:" + artifact.id + ":" + proof, subject: row.reference,
    scope: scopeFor(input), sourceRevision: creativeActionSourceRevision(input.facts), effect: "open-existing-executor",
    label: ports.localize("artifact.delivery.action." + delivery.action, delivery.action),
    detail: ports.localize("next.exact.open-output.reason", "Inspect this exact saved output without starting another generation."),
    target: { kind: "delivery", artifactId: artifact.id, sequence: artifact.sequence,
      revision: documentArtifactRevision(input.facts.events ?? [], artifact.id), sourceEventId: artifact.sourceEventId,
      contentRef: artifact.contentRef ?? null, intent: delivery.intent, proof } };
}


function outputAction(row: OutcomeDeskRow, input: OutcomeDeskInput, ports: OutcomeDeskHostPorts, section: OutputNavigationSection,
  label: string, fallback: string, detailKey: string, detail: string, reference = row.navigation!, refresh = false): OutcomeDeskAction<OutcomeDeskTarget> {
  return { key: row.key + ":output:" + section + ":" + label + ":" + JSON.stringify(reference), subject: row.reference,
    scope: scopeFor(input), sourceRevision: creativeActionSourceRevision(input.facts), effect: "open-existing-executor",
    label: ports.localize(label, fallback), detail: ports.localize(detailKey, detail),
    target: { kind: "canonical-output", reference, section, refresh } };
}
/** Desk identity/localization wrap the same surface-independent continuation choices. */
function canonicalOutputActions(row: OutcomeDeskRow, input: OutcomeDeskInput, ports: OutcomeDeskHostPorts): readonly OutcomeDeskAction<OutcomeDeskTarget>[] {
  const read = input.output?.resource;
  return outputContinuationChoices({
    read: read ? { ...read, snapshot: outcomeDeskOutputRead(input) } : null,
    authorizationScopeKey: input.facts.authorityKey, reference: row.navigation ?? null, jobs: input.output?.jobs,
  }).map(choice => outputAction(row, input, ports, choice.section, choice.label.key, choice.label.fallback,
    choice.detail.key, choice.detail.fallback, choice.reference, choice.refresh));
}

/** Exact human selection. Recommendations retain the existing resolver's receipt/reuse priority. */
export function outcomeDeskHostActions(input: OutcomeDeskInput, selectedKey: string, ports: OutcomeDeskHostPorts): readonly OutcomeDeskAction<OutcomeDeskTarget>[] {
  const row = projectOutcomeDesk(input, selectedKey).selected;
  if (!row) return [];
  if (row.navigation) return canonicalOutputActions(row, input, ports);
  const scope = scopeFor(input), { object } = row;
  if (object.kind === "artifact") return [deliveryAction(row, input, object.value, ports)];
  if (object.kind === "document") {
    const actions = creativeNextActions(input.facts);
    const wrapped = actions.map((action) => {
      if (action.target.kind === "artifact") {
        const target = action.target, artifact = input.facts.artifacts.find((value) => value.id === target.artifactId);
        return artifact ? deliveryAction(row, input, artifact, ports) : wrap(row, input, action, ports);
      }
      return wrap(row, input, action, ports);
    });
    if (!input.facts.lifecycle) return wrapped;
    const labels = creativeNextActionDisplayLabels(actions, ports.displayLocale ?? { t: (id: string, fallback = "") => ports.localize(id, fallback) }, wrapped.map(action => action.label));
    return wrapped.map((action, index) => ({ ...action, label: labels[index]! }));
  }
  if (object.kind !== "output" && object.kind !== "job") return [];
  const target: CreativeNextTarget = object.kind === "output" ? { ...scope, kind: "output", outputId: object.value.id }
    : { ...scope, kind: "job", jobId: object.value.jobId };
  const failed = object.kind === "job" && ["failed", "partial"].includes(object.value.status);
  const terminal = object.kind === "job" && ["completed", "canceled"].includes(object.value.status);
  return [wrap(row, input, {
    id: object.kind === "output" ? "open-output" : failed || terminal ? "inspect-job" : "check-job", target,
    label: object.kind === "output" ? "Open saved result" : terminal ? "Inspect this request"
      : failed ? "Inspect the previous attempt" : "Check this work in progress",
    reason: object.kind === "output" ? "Inspect this exact saved output without starting another generation."
      : terminal ? "View the original request and any retained results. No new work is started."
        : failed ? "Review retained evidence and partial work. Independent outputs can continue." : "Open the existing request. A new request is not needed to check progress.",
    title: "", priority: 90, evidence: 1,
  }, ports, terminal ? "inspect-terminal-job" : undefined)];
}
export function outcomeDeskHostActionAvailable(action: OutcomeDeskAction<OutcomeDeskTarget>, current: OutcomeDeskInput, ports: OutcomeDeskHostPorts): boolean {
  if (action.target.kind === "canonical-output") {
    const snapshot = action.target.refresh ? outcomeDeskOutputRead(current) : outcomeDeskOutputSnapshot(current);
    if (!outputNavigationMatches(action.target.reference, snapshot, current.facts.authorityKey)) return false;
    return outcomeDeskHostActions(current, outcomeDeskKey(action.subject), ports).some(candidate => candidate.key === action.key);
  }
  if (action.target.kind === "next") return creativeNextTargetAvailable(action.target.action.target, current.facts);
  const target = action.target, artifact = current.facts.artifacts.find((value) => value.id === target.artifactId);
  return Boolean(artifact && artifact.sourceEventId === target.sourceEventId && (artifact.contentRef ?? null) === target.contentRef
    && creativeNextTargetAvailable({ ...action.scope, kind: "artifact", artifactId: target.artifactId, sequence: target.sequence, revision: target.revision }, current.facts)
    && ports.delivery(artifact).canRead && deliveryProof(ports.delivery(artifact)) === target.proof);
}
/** Expert choices are one disclosure + one exact preparation handoff. No paid executor is called here. */
export function outcomeDeskPreparationActions(input: OutcomeDeskInput, selectedKey: string, ports: OutcomeDeskHostPorts): readonly OutcomeDeskAction<OutcomeDeskTarget>[] {
  const row = projectOutcomeDesk(input, selectedKey).selected;
  if (!row || row.navigation) return [];
  const scope = scopeFor(input), sourceRevision = creativeActionSourceRevision(input.facts);
  const seed: Extract<CreativeNextTarget, { kind: "configure" }> = { ...scope, kind: "configure", medium: null, sourceRevision };
  return (["image", ...DOCUMENT_ARTIFACT_KINDS] as const).flatMap((medium) => {
    const target = creativePreparationChoice(seed, medium, input.facts);
    if (!target) return [];
    const action = wrap(row, input, { id: "configure-output", label: "Prepare an output",
      reason: "Choose and review this document’s output settings. Nothing is generated yet.",
      title: medium, priority: 0, evidence: 0, target }, ports);
    return [{ ...action, label: ports.localize("artifact." + medium + ".label", medium) }];
  });
}
