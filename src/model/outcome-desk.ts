import type { OutputRequirementRow, OutputResultRow, OutputGrantRow, OutputRequirementsSnapshot } from "./output-delivery-contract.ts";
import type { OutputPlanTarget } from "./output-plan.ts";
import type { OutputPlanResource } from "../state/output-requirements-client.ts";
import { captureOutputNavigation, type OutputNavigationReference } from "./output-navigation.ts";
import type { CreativeDocument, CreativeOutput } from "./events.ts";
import type { DocumentArtifact } from "./document-artifacts.ts";
import type { DocumentJob } from "./document-jobs.ts";
import { creativeActionScopeAvailable, creativeActionSourceRevision, type CreativeActionScope, type CreativeWorkspaceFacts } from "./workspace-intelligence.ts";
import { documentJobMatchesSurface } from "./canvas-document-target.ts";
import { canvasIdFromRoute } from "../canvas/routes.ts";
import { outcomeRecipe, type OutcomeRecipeId } from "./outcome-recipes.ts";

export type OutcomeDeskObject =
  | { readonly kind: "document"; readonly value: CreativeDocument }
  | { readonly kind: "output"; readonly value: CreativeOutput }
  | { readonly kind: "artifact"; readonly value: DocumentArtifact }
  | { readonly kind: "job"; readonly value: DocumentJob }
  | { readonly kind: "requirement"; readonly value: OutputRequirementRow }
  | { readonly kind: "target"; readonly value: OutputPlanTarget }
  | { readonly kind: "result"; readonly value: OutputResultRow }
  | { readonly kind: "operation"; readonly value: OutputGrantRow["operations"][number] };
export type OutcomeDeskReference = {
  readonly kind: OutcomeDeskObject["kind"];
  readonly id: string;
  readonly documentId: string;
  readonly revision?: string;
};
export type OutcomeDeskRow = {
  readonly key: string;
  readonly reference: OutcomeDeskReference;
  /** The original authorized object, never a replica or a persisted desk record. */
  readonly object: OutcomeDeskObject;
  readonly navigation?: OutputNavigationReference;
  readonly retained?: boolean;
};
export type OutcomeDeskInput = {
  readonly facts: CreativeWorkspaceFacts;
  readonly document: CreativeDocument | null;
  /** The existing scoped read cache, not a second Output store or approval authority. */
  readonly output?: { readonly authorizationScopeKey: string; readonly actorUserId: string; readonly projectAccessId: string | null;
    readonly resource: OutputPlanResource<OutputRequirementsSnapshot>; readonly jobs?: readonly DocumentJob[] };
};
export type OutcomeDeskProjection = {
  readonly rows: readonly OutcomeDeskRow[];
  readonly selected: OutcomeDeskRow | null;
  readonly unavailableSelection: boolean;
};
export const outcomeDeskKey = (reference: OutcomeDeskReference) => reference.revision === undefined ? reference.kind + ":" + reference.id
  : reference.kind + ":" + encodeURIComponent(reference.id) + ":" + encodeURIComponent(reference.revision);
const validKey = (value: string) => (/^(document|output|artifact|job):[\s\S]{1,256}$/u.test(value)
  || /^(requirement|target|result|operation):[\s\S]{1,2048}$/u.test(value))
  && Array.from(value).every(character => { const code = character.codePointAt(0)!; return code > 31 && code !== 127; });

function deskAvailable(input: OutcomeDeskInput) {
  const { facts, document } = input;
  return facts.canRead && Boolean(facts.authorityKey) && Boolean(facts.projectId && facts.documentId) && Boolean(document && !document.removed
    && document.id === facts.documentId && document.projectId === facts.projectId);
}
function row(object: Extract<OutcomeDeskObject, { kind: "document" | "output" | "artifact" | "job" }>): OutcomeDeskRow {
  const id = object.kind === "job" ? object.value.jobId : object.value.id;
  const documentId = object.kind === "document" ? object.value.id : object.value.documentId;
  const reference = { kind: object.kind, id, documentId };
  return { key: outcomeDeskKey(reference), reference, object };
}

/** Ready governs actionable current truth. A missing read never means zero owed work. */
export function outcomeDeskOutputRead(input: OutcomeDeskInput): OutputRequirementsSnapshot | null {
  const output = input.output, resource = output?.resource, snapshot = resource?.snapshot;
  if (!deskAvailable(input) || !output || output.authorizationScopeKey !== input.facts.authorityKey
    || resource?.accessLost || resource?.privateUnavailable || !snapshot
    || snapshot.documentId !== input.facts.documentId || snapshot.projectId !== input.facts.projectId
    || snapshot.scope?.actorUserId !== output.actorUserId || snapshot.scope.projectAccessId !== output.projectAccessId
    || !Array.isArray(snapshot.requirements) || !Array.isArray(snapshot.results) || !Array.isArray(snapshot.assets) || !Array.isArray(snapshot.grants)) return null;

  const plan = snapshot.confirmedPlan;
  const id = (value: unknown) => typeof value === "string" && value.length > 0;
  if (![snapshot.revision, snapshot.sourceRevision, snapshot.requirementRevision].every(id)
    || !snapshot.requirements.every(row => row && id(row.blockId))
    || !snapshot.results.every(row => row && id(row.id) && id(row.targetId) && id(row.assetId) && id(row.planRevisionId))
    || !snapshot.assets.every(row => row && id(row.id) && row.inspection && typeof row.inspection === "object")
    || !snapshot.grants.every(row => row && id(row.id) && id(row.planRevisionId) && Array.isArray(row.operations)
      && row.operations.every(operation => operation && id(operation.id) && id(operation.targetId) && id(operation.jobId)))
    || !snapshot.permissions || !["canAuthor", "canRequest", "canReview", "canDownload", "independentReview"].every(key => typeof snapshot.permissions[key as keyof typeof snapshot.permissions] === "boolean")
    || !snapshot.capabilities || typeof snapshot.capabilities.nativeGeneration !== "boolean" || typeof snapshot.capabilities.ownedFileAdoption !== "boolean"
    || snapshot.capabilities.limitationCodes && (!Array.isArray(snapshot.capabilities.limitationCodes) || snapshot.capabilities.limitationCodes.some(code => typeof code !== "string"))
    || !Array.isArray(snapshot.targetStates) || !snapshot.targetStates.every(row => row && id(row.target_id))
    || new Set(snapshot.targetStates.map(row => row.target_id)).size !== snapshot.targetStates.length
    || plan && (!id(plan.revisionId) || !Array.isArray(plan.plan?.targets)
      || !plan.plan.targets.every(target => target && id(target.id) && id(target.requirement_id) && Array.isArray(target.blocking_issues)))) return null;
  return snapshot;
}
export function outcomeDeskOutputSnapshot(input: OutcomeDeskInput): OutputRequirementsSnapshot | null {
  return input.output?.resource.state === "ready" ? outcomeDeskOutputRead(input) : null;
}
export function outcomeDeskOutputRows(input: OutcomeDeskInput): readonly OutcomeDeskRow[] {
  const snapshot = outcomeDeskOutputRead(input);
  if (!snapshot || !input.output) return [];
  const rows: OutcomeDeskRow[] = [], plan = snapshot.confirmedPlan;
  const add = (kind: "requirement" | "target" | "result" | "operation", id: string, value: OutcomeDeskObject["value"], revision?: string) => {
    const navigation = captureOutputNavigation(snapshot, input.output!.authorizationScopeKey, kind, id);
    if (!navigation) return;
    const reference = { kind, id, documentId: snapshot.documentId, ...(revision === undefined ? {} : { revision }) };
    rows.push({ key: outcomeDeskKey(reference), reference, object: { kind, value } as OutcomeDeskObject, navigation, ...(input.output!.resource.state !== "ready" ? { retained: true } : {}) });
  };
  if (input.output.resource.state === "ready") {
  for (const value of snapshot.requirements) add("requirement", value.blockId, value);
  // Never filter by target.selected: that is a run choice, not the full owed scope.
  if (plan) for (const value of plan.plan.targets) add("target", value.id, value, plan.revisionId);
  if (plan) for (const value of snapshot.results) if (value.planRevisionId === plan.revisionId)
    add("result", value.id, value, plan.revisionId + ":" + value.resultRevision);
  }
  for (const grant of snapshot.grants) for (const value of grant.operations) add("operation", value.id, value, grant.id + ":" + grant.planRevisionId);
  return rows;
}

/**
 * One selected canonical document, not a project-wide output store. Invalid or
 * removed selections stay unavailable; they never fall through to another result.
 * Review, approval, delivery, costs and recoverability are intentionally NOT
 * derived here: the existing exact-object renderers supply their current truth.
 */
export function projectOutcomeDesk(input: OutcomeDeskInput, selectedKey = ""): OutcomeDeskProjection {
  if (!deskAvailable(input)) return { rows: [], selected: null, unavailableSelection: Boolean(selectedKey) };
  const { facts, document } = input;
  const rows: OutcomeDeskRow[] = [row({ kind: "document", value: document! })];
  for (const output of facts.outputs) {
    if (output.documentId !== facts.documentId || output.discarded || output.provider === "simulation"
      || !output.mediaUrl || facts.canvasId && output.canvasId && output.canvasId !== facts.canvasId) continue;
    rows.push(row({ kind: "output", value: output }));
  }
  for (const artifact of facts.artifacts) {
    if (artifact.documentId !== facts.documentId || artifact.provider === "simulation") continue;
    rows.push(row({ kind: "artifact", value: artifact }));
  }
  for (const job of facts.jobs ?? []) {
    if (!documentJobMatchesSurface(job, { documentId: facts.documentId, canvasId: facts.canvasId ?? null })
      || job.dismissedAt) continue;
    rows.push(row({ kind: "job", value: job }));
  }
  rows.push(...outcomeDeskOutputRows(input));
  // Duplicate IDs are ambiguous input, not permission to choose whichever came first.
  const counts = new Map<string, number>();
  for (const item of rows) counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
  const unique = rows.filter((item) => counts.get(item.key) === 1);
  const selected = selectedKey && validKey(selectedKey) ? unique.find((item) => item.key === selectedKey) ?? null : null;
  return { rows: unique, selected, unavailableSelection: Boolean(selectedKey && !selected) };
}

/** A display permutation must account for every current row exactly once. */
export function reorderOutcomeDeskRows(rows: readonly OutcomeDeskRow[], order: readonly string[]): readonly OutcomeDeskRow[] {
  if (order.length !== rows.length || new Set(order).size !== order.length) return rows;
  const byKey = new Map(rows.map((item) => [item.key, item]));
  if (byKey.size !== rows.length || order.some((key) => !byKey.has(key))) return rows;
  return order.map((key) => byKey.get(key)!);
}

/**
 * A transient adapter around the existing next/review/delivery action. The host
 * creates this for the selected exact object and opens that existing executor.
 * It must not wire open() directly to generation, authored changes or approval.
 */
export type OutcomeDeskAction<Target> = {
  readonly key: string;
  readonly subject: OutcomeDeskReference;
  readonly scope: CreativeActionScope;
  readonly sourceRevision: string;
  readonly label: string;
  readonly detail: string;
  readonly target: Target;
  readonly effect: "open-existing-executor";
};
export type OutcomeDeskActionPorts<Target> = {
  /** Re-run the existing exact target, permission, source and review guard. */
  readonly available: (action: OutcomeDeskAction<Target>, current: OutcomeDeskInput) => boolean;
  readonly open: (action: OutcomeDeskAction<Target>) => unknown | Promise<unknown>;
};
export function outcomeDeskActionAvailable<Target>(
  action: OutcomeDeskAction<Target>, current: OutcomeDeskInput,
  available: OutcomeDeskActionPorts<Target>["available"],
): boolean {
  if (!action.key || action.effect !== "open-existing-executor" || !deskAvailable(current)
    || !creativeActionScopeAvailable(action.scope, current.facts)
    || action.sourceRevision !== creativeActionSourceRevision(current.facts)) return false;
  const selected = projectOutcomeDesk(current, outcomeDeskKey(action.subject)).selected;
  if (!selected || selected.reference.documentId !== action.subject.documentId) return false;
  try { return available(action, current) === true; } catch { return false; }
}
export function outcomeDeskActions<Target>(
  selected: OutcomeDeskRow | null, candidates: readonly OutcomeDeskAction<Target>[], current: OutcomeDeskInput,
  available: OutcomeDeskActionPorts<Target>["available"], dismissedKeys: readonly string[] = [],
) {
  if (!selected) return { primary: null, alternatives: [], otherWays: [] };
  const seen = new Set<string>();
  const allowed = candidates.filter((action) => {
    if (outcomeDeskKey(action.subject) !== selected.key || seen.has(action.key)
      || !outcomeDeskActionAvailable(action, current, available)) return false;
    seen.add(action.key);
    return true;
  });
  const suggested = allowed.filter((action) => !dismissedKeys.includes(action.key)).slice(0, 3);
  const visibleKeys = new Set(suggested.map((action) => action.key));
  return { primary: suggested[0] ?? null, alternatives: suggested.slice(1), otherWays: allowed.filter((action) => !visibleKeys.has(action.key)) };
}
export async function followOutcomeDeskAction<Target>(
  action: OutcomeDeskAction<Target>, current: () => OutcomeDeskInput,
  ports: OutcomeDeskActionPorts<Target>,
): Promise<boolean> {
  if (!outcomeDeskActionAvailable(action, current(), ports.available)) return false;
  return await ports.open(action) !== false;
}

const routeBase = "https://canvas.local";
function canvasUrl(route: string): URL | null {
  if (!route.startsWith("/") || route.startsWith("//") || route.includes("\\")) return null;
  try {
    const url = new URL(route, routeBase);
    return url.origin === routeBase && canvasIdFromRoute(route) ? url : null;
  } catch { return null; }
}
const localRoute = (url: URL) => url.pathname + url.search + url.hash;
export function outcomeDeskRouteState(route: string) {
  const url = canvasUrl(route);
  const rawKey = url?.searchParams.get("outcome") ?? "";
  return {
    posture: url?.searchParams.get("posture") === "outcomes" ? "outcomes" as const : "canvas" as const,
    recipeId: outcomeRecipe(url?.searchParams.get("recipe"))?.id ?? null,
    selectedKey: validKey(rawKey) ? rawKey : "",
  };
}
/** Only presentation query parameters change; path, document/board identity and hash survive. */
export function withOutcomeDeskPosture(route: string, posture: "canvas" | "outcomes"): string {
  const url = canvasUrl(route);
  if (!url) return route;
  if (posture === "outcomes") url.searchParams.set("posture", "outcomes");
  else url.searchParams.delete("posture");
  return localRoute(url);
}
export function withOutcomeDeskSelection(route: string, key: string): string {
  const url = canvasUrl(route);
  if (!url || !validKey(key)) return route;
  url.searchParams.set("outcome", key);
  url.searchParams.set("posture", "outcomes");
  return localRoute(url);
}
export function withOutcomeRecipe(route: string, id: OutcomeRecipeId | null): string {
  const url = canvasUrl(route);
  if (!url || id !== null && !outcomeRecipe(id)) return route;
  if (id) url.searchParams.set("recipe", id); else url.searchParams.delete("recipe");
  return localRoute(url);
}
