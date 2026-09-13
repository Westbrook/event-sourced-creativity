import { readVideoReferenceCandidate } from "../src/experiences/video-reference-candidate.ts";
import { foldEvents, type CreativeEvent } from "../src/model/events.ts";
import { mediaKeyMatchesOwnerNamespace } from "../src/model/media-ownership.ts";
import { readModel3dReferenceCandidate } from "../src/experiences/model3d-reference-candidate.ts";
import { authorizeExperienceIntake } from "./experience-intake-api.ts";
import { readEvents, streamHead } from "./event-stream-read.ts";
import { projectIntakeAuthority } from "./intake-authority.ts";
import { captureOutputPrivateSources, verifyOutputSourceRead } from "./output-disclosure-proof.ts";
import type { OutputScope } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
const denied = (error: string, status = 409) => reply({ error }, status);

/** Page at most five explicit personal projects and20 references. A cursor is
 * project/block or project/~ (exhausted project), bound to the unchanged head. */
export function model3dReferenceDiscoveryPage(events: CreativeEvent[], owner: string, excluded: ReadonlySet<string>, after: string | null, output: "model3d" | "video" = "model3d") {
  const projection = foldEvents(events), [afterProject, afterBlock] = after?.split("/") ?? [];
  const selected: Array<{ block: (typeof projection.libraryBlocks)[number]; candidate: NonNullable<ReturnType<typeof readModel3dReferenceCandidate | typeof readVideoReferenceCandidate>> }> = [];
  const projects = projection.projects.filter(project => project.state !== "removed" && !excluded.has(project.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  let visited = 0, cursor = after, more = false;
  outer: for (const project of projects) {
    if (afterProject && (project.id < afterProject || project.id === afterProject && afterBlock === "~")) continue;
    if (visited++ === 5) { more = true; break; }
    const scoped = foldEvents(events, Number.POSITIVE_INFINITY, "", project.id);
    const documents = new Map(scoped.documents.filter(item => !item.removed).map(item => [item.id, item]));
    const available = scoped.libraryBlocks.flatMap(block => {
      const document = documents.get(block.documentId), properties = block.properties;
      if (block.removed || block.scope !== "document" || !document || document.projectId !== block.projectId
        || !["reference", "model3d"].includes(block.type)) return [];
      if (output === "video" && (block.type !== "reference" || ["model_url", "model_view", "model_reference_id", "model_content_hash", "reference_composition"].some(key => key in properties))) return [];
      const ingestion = events.findLast(event => event.type === "ReferenceIngested" && event.payload.reference_id === properties.reference_id);
      const mime = properties.media_type ?? properties.source_mime_type ?? ingestion?.payload.media_type ?? ingestion?.payload.source_mime_type;
      if (!["image/png", "image/jpeg", "image/webp"].includes(String(mime)) || block.type === "model3d" && mime !== "image/png") return [];
      const metadata = { source: { version: 1, ...(output === "model3d" ? { kind: block.type === "model3d" ? "saved-model-view" : "image" } : {}),
        sourceProjectId: block.projectId, sourceDocumentId: block.documentId, sourceBlockId: block.id,
        referenceId: properties.reference_id, sha256: properties.source_content_hash },
        label: typeof properties.label === "string" && properties.label ? properties.label : block.handle, preview: properties.media_url };
      const candidate = output === "video" ? readVideoReferenceCandidate(metadata) : readModel3dReferenceCandidate(metadata);
      if (!candidate || !mediaKeyMatchesOwnerNamespace(decodeURIComponent(candidate.preview.slice(11)), owner)) return [];
      return [{ block, candidate }];
    }).sort((a, b) => a.block.id < b.block.id ? -1 : a.block.id > b.block.id ? 1 : 0);

    for (const item of available) {
      if (project.id === afterProject && afterBlock && item.block.id <= afterBlock) continue;
      if (selected.length === 20) { more = true; break outer; }
      selected.push(item); cursor = project.id + "/" + item.block.id;
    }
    cursor = project.id + "/~";
  }
  return { projection, selected, next: more ? cursor : null };
}

/** Bounded personal Document-backed Library discovery. No media read, rights
 * assertion, grant, write or generation; selection has its own fresh inspector. */
export async function listExperienceModel3dReferences(request: Request, env: WorkerEnv, output: "model3d" | "video" = "model3d") {
  const url = new URL(request.url);
  if (request.method !== "GET") return denied("method_not_allowed", 405);
  const keys = [...url.searchParams.keys()], after = url.searchParams.get("after"), wantedHead = url.searchParams.get("head");
  if (url.hash || keys.some(key => !["after", "head"].includes(key)) || keys.length !== new Set(keys).size
    || (after === null) !== (wantedHead === null) || after !== null && !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,239}\/(?:[A-Za-z0-9][A-Za-z0-9:_-]{0,239}|~)$/u.test(after)
    || wantedHead !== null && (!/^(0|[1-9][0-9]{0,15})$/u.test(wantedHead) || !Number.isSafeInteger(Number(wantedHead)))) return denied("request_invalid", 400);
  const auth = await authorizeExperienceIntake(request, env); if (auth instanceof Response) return auth;
  try {
    const owner = auth.user.userId, head = await streamHead(env, auth.user.streamId);
    if (wantedHead !== null && Number(wantedHead) !== head) return denied(`${output}_reference_list_changed`);
    const events = await readEvents(env, auth.user.streamId), projection = foldEvents(events);
    const governed = await env.DB.prepare("SELECT project_id FROM organization_projects WHERE owner_user_id=?").bind(owner).all<{ project_id: string }>();
    if (!governed.success) throw Error("unavailable");
    const excluded = new Set(governed.results.map(row => row.project_id));
    const { selected, next } = model3dReferenceDiscoveryPage(events, owner, excluded, after, output);
    const authority = projectIntakeAuthority(env, auth, { projectId: "", documentId: "" });
    const projects = [...new Set(selected.map(item => item.block.projectId))];
    const personal = { sql: "NOT EXISTS(SELECT 1 FROM organization_projects WHERE owner_user_id=? AND project_id IN(SELECT value FROM json_each(?)))", bindings: [owner, JSON.stringify(projects)] };
    const scope: OutputScope = { kind: "personal", key: `personal:${owner}:reference-discovery`, actorUserId: owner, ownerUserId: owner,
      projectId: "", documentId: "", organizationId: null, projectAccessId: null, contextId: null };
    // This subset is only a private-disclosure proof, never a generative context.
    // Labels and paths come from these exact current authored block bodies.
    const disclosure = { ...projection, blocks: selected.map(item => item.block), blockRelations: [], outputs: [], documents: [] };
    const proofs = await captureOutputPrivateSources(env, scope, events, disclosure, head, [authority, personal]);
    request.signal.throwIfAborted();
    await verifyOutputSourceRead(env, scope, head, [authority, personal, ...proofs]);
    request.signal.throwIfAborted();
    return reply({ version: 1, scope: "personal-document-references", qualification: "discovery-only", head,
      candidates: selected.map(item => item.candidate), next: next ? { after: next, head } : null });
  } catch { return denied(`${output}_reference_list_unavailable`); }
}
