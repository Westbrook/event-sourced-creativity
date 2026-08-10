import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type EventInput = {
  type?: string;
  payload?: Record<string, unknown>;
  compensatesEventId?: string | null;
};

type EventRow = {
  eventId: string;
  streamId: string;
  sequence: number;
  occurredAt: string;
  recordedAt: string;
  actor: string;
  clientId: string;
  correlationId: string;
  causationId: string | null;
  compensatesEventId: string | null;
  schemaVersion: number;
  type: string;
  payload: Record<string, unknown>;
};

const USER_EVENTS = new Set([
  "ProjectCreated",
  "ProjectRenamed",
  "ProjectStateChanged",
  "DocumentCreated",
  "DocumentForked",
  "BlockCreated",
  "BlockRenamed",
  "BlockPropertyEdited",
  "BlockWeightSet",
  "BlockLocked",
  "BlockUnlocked",
  "BlockRemoved",
  "BlockRestored",
  "ReferenceIngested",
  "RegionPromoted",
  "ExtractionRequested",
  "ChipEdited",
  "GenerationRequested",
  "ObjectViewed",
  "ObjectSaved",
  "ObjectDiscarded",
  "ObjectPinned",
  "ObjectUnpinned",
  "ObjectRegenerated",
  "ObjectCritiqued",
  "ObjectExported",
  "SessionOpened",
  "SessionClosed",
  "BriefItemPresented",
  "BriefItemAccepted",
  "BriefItemIgnored",
  "BriefDismissed",
  "EmptyCanvasChosen",
  "ComparisonOpened",
  "ProposalAccepted",
  "ProposalRejected",
  "ProposalDeclined",
  "AnnotationAdded",
  "AnnotationRetracted",
  "PreferenceAuthored",
  "PreferenceRevoked",
  "ObservationJudged",
  "IntentDeclared",
  "Deferred",
  "ConditionSet",
  "ConditionFired",
  "Resurfaced",
  "AddedToLibrary",
  "RemovedFromLibrary",
  "FamilyDeclared",
  "FamilyAnchorSet",
  "FamilyMembershipAsserted",
  "CollectionCreated",
  "CollectionRenamed",
  "CollectionRemoved",
  "CollectionRestored",
  "CollectionItemAdded",
  "CollectionItemRemoved",
  "CollectionItemMoved",
  "FactRetracted",
  "ClaimSuperseded",
]);

const PRODUCER_EVENTS: Record<string, Set<string>> = {
  "worker:compiler": new Set(["ContextCompiled"]),
  "worker:generator": new Set(["GenerationCompleted", "GenerationFailed"]),
  "worker:extractor": new Set(["ExtractionCompleted", "ExtractionFailed"]),
  "worker:brief": new Set(["BriefComposed"]),
  "worker:taste": new Set(["TasteModelVersioned"]),
  "worker:validator": new Set(["ValidationFailed"]),
  "worker:scout": new Set([
    "ScoutRunStarted",
    "ScoutObserved",
    "ScoutRunCompleted",
    "ScoutBudgetExhausted",
    "GenerationRequested",
    "GenerationCompleted",
    "GenerationFailed",
  ]),
  "model:forma-chat": new Set(["MutationProposed", "AssistantReasoned"]),
};

const COMMUTATIVE_EVENTS = new Set([
  "AnnotationAdded",
  "ComparisonOpened",
  "ObjectViewed",
  "ObjectPinned",
  "ScoutObserved",
]);

const PERMISSION_SCHEMA_VERSION = 1;

function actorCanAppend(actor: string, type: string) {
  if (actor === "user") return USER_EVENTS.has(type);
  return PRODUCER_EVENTS[actor]?.has(type) ?? false;
}

function uuidV7() {
  const time = Date.now().toString(16).padStart(12, "0");
  const random = crypto.getRandomValues(new Uint8Array(10));
  const hex = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const variant = ((random[4] & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${time.slice(0, 8)}-${time.slice(8)}-7${hex.slice(0, 3)}-${variant}${hex.slice(5, 7)}-${hex.slice(7, 19)}`;
}

function identity(request: Request) {
  const ownerId = request.headers.get("oai-authenticated-user-id") ?? "local-creative";
  return { ownerId, streamId: `creative:${ownerId}` };
}

async function ensureSchema() {
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY NOT NULL,
      stream_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      actor TEXT NOT NULL,
      client_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      causation_id TEXT,
      compensates_event_id TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_stream_sequence ON events(stream_id, sequence)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_events_stream_type ON events(stream_id, type)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id)"),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS events_block_update
      BEFORE UPDATE ON events BEGIN
        SELECT RAISE(ABORT, 'events are append-only');
      END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS events_block_delete
      BEFORE DELETE ON events BEGIN
        SELECT RAISE(ABORT, 'events are append-only');
      END`),
    db.prepare(`CREATE TABLE IF NOT EXISTS external_content (
      content_id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_external_content_owner ON external_content(owner_id)"),
  ]);
}

function insertStatement(event: EventRow) {
  return env.DB.prepare(`INSERT INTO events (
    event_id, stream_id, sequence, occurred_at, recorded_at, actor, client_id,
    correlation_id, causation_id, compensates_event_id, schema_version, type, payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    event.eventId,
    event.streamId,
    event.sequence,
    event.occurredAt,
    event.recordedAt,
    event.actor,
    event.clientId,
    event.correlationId,
    event.causationId,
    event.compensatesEventId,
    event.schemaVersion,
    event.type,
    JSON.stringify(event.payload),
  );
}

function makeEvent(
  streamId: string,
  sequence: number,
  actor: string,
  clientId: string,
  correlationId: string,
  type: string,
  payload: Record<string, unknown>,
  options: { causationId?: string | null; compensatesEventId?: string | null } = {},
): EventRow {
  const now = new Date().toISOString();
  return {
    eventId: uuidV7(),
    streamId,
    sequence,
    occurredAt: now,
    recordedAt: now,
    actor,
    clientId,
    correlationId,
    causationId: options.causationId ?? null,
    compensatesEventId: options.compensatesEventId ?? null,
    schemaVersion: 1,
    type,
    payload,
  };
}

async function headSequence(streamId: string) {
  const row = await env.DB.prepare(
    "SELECT COALESCE(MAX(sequence), 0) AS head FROM events WHERE stream_id = ?",
  )
    .bind(streamId)
    .first<{ head: number }>();
  return Number(row?.head ?? 0);
}

async function seedIfEmpty(streamId: string) {
  const head = await headSequence(streamId);
  if (head > 0) return;

  const correlationId = uuidV7();
  const clientId = "seed:studio";
  const specs: Array<[string, string, Record<string, unknown>]> = [
    ["user", "ProjectCreated", { project_id: "project-atmosphere", name: "Studio launch", state: "active" }],
    ["user", "DocumentCreated", { document_id: "doc-atmosphere", handle: "atmosphere-studies", title: "Atmosphere studies" }],
    ["user", "SessionOpened", { session_id: "session-today", snapshot_ref: null }],
    ["user", "BlockCreated", { block_id: "block-direction", type: "direction", handle: "direction/nocturne", properties: { text: "A quiet interior that feels held between dusk and night.", weight: 0.92, authority: "authored" }, position: "a0" }],
    ["user", "ReferenceIngested", { reference_id: "ref-window-light", source_type: "upload", source_ref: "seed://window-light", content_hash: "seed-window-light", rights_class: "owned" }],
    ["user", "BlockCreated", { block_id: "block-reference", type: "reference", handle: "reference/window-light", properties: { reference_id: "ref-window-light", label: "Window light", weight: 0.78, authority: "authored" }, position: "a1" }],
    ["user", "BlockCreated", { block_id: "block-palette", type: "palette", handle: "palette/dusk-warm", properties: { colors: ["#27252B", "#E9A073", "#E8D7BD", "#8A6571"], weight: 0.84, authority: "inferred", confidence: 0.86 }, position: "a2" }],
    ["worker:extractor", "ExtractionCompleted", { block_id: "block-palette", extractor_name: "palette-kmeans-v1", chips: [{ chip_id: "chip-palette", property: "colors", value: ["#27252B", "#E9A073", "#E8D7BD", "#8A6571"], confidence: 0.86 }] }],
    ["user", "CollectionCreated", { collection_id: "collection-studio", handle: "studio-launch", parent_collection_id: null, source_claim_ref: null }],
    ["user", "CollectionCreated", { collection_id: "collection-client", handle: "client-work", parent_collection_id: null, source_claim_ref: null }],
    ["user", "CollectionCreated", { collection_id: "collection-acme", handle: "acme", parent_collection_id: "collection-client", source_claim_ref: null }],
    ["user", "CollectionItemAdded", { collection_id: "collection-studio", item_ref: { document_id: "doc-atmosphere" }, position: "a0" }],
    ["worker:compiler", "ContextCompiled", { generation_id: "generation-01", model_id: "adapter-neutral", adapter_version: "v0.1", compiled_snapshot: { facts: ["direction/nocturne", "reference/window-light", "palette/dusk-warm"], pins: ["block-direction"], tail: [] }, source_block_versions: [{ block_id: "block-direction", version: 1 }, { block_id: "block-reference", version: 1 }, { block_id: "block-palette", version: 1 }] }],
    ["worker:generator", "GenerationCompleted", { generation_id: "generation-01", model_id: "adapter-neutral", object_ids: ["object-nocturne-01"], latency_ms: 1820, variant: 0 }],
    ["user", "ObjectPinned", { object_id: "object-nocturne-01", scope: "project" }],
    ["user", "ComparisonOpened", { object_ids: ["object-nocturne-01", "object-nocturne-00"], source_surface: "canvas" }],
    ["worker:brief", "BriefComposed", { brief_id: "brief-today", session_id: "session-today", items: [{ item_type: "comparison", ref_id: "object-nocturne-01", rank: 1, rationale_ref: "event:15" }, { item_type: "thread", ref_id: "palette/dusk-warm", rank: 2, rationale_ref: "event:8" }] }],
    ["user", "BriefItemPresented", { brief_id: "brief-today", item_id: "object-nocturne-01" }],
  ];

  const events = specs.map(([actor, type, payload], index) =>
    makeEvent(streamId, index + 1, actor, clientId, correlationId, type, payload),
  );
  await env.DB.batch(events.map(insertStatement));
}

function serializeRow(row: Record<string, unknown>): EventRow {
  return {
    eventId: String(row.event_id),
    streamId: String(row.stream_id),
    sequence: Number(row.sequence),
    occurredAt: String(row.occurred_at),
    recordedAt: String(row.recorded_at),
    actor: String(row.actor),
    clientId: String(row.client_id),
    correlationId: String(row.correlation_id),
    causationId: row.causation_id ? String(row.causation_id) : null,
    compensatesEventId: row.compensates_event_id ? String(row.compensates_event_id) : null,
    schemaVersion: Number(row.schema_version),
    type: String(row.type),
    payload: JSON.parse(String(row.payload)) as Record<string, unknown>,
  };
}

async function readEvents(streamId: string) {
  const result = await env.DB.prepare(
    "SELECT * FROM events WHERE stream_id = ? ORDER BY sequence ASC LIMIT 500",
  )
    .bind(streamId)
    .all<Record<string, unknown>>();
  return result.results.map(serializeRow);
}

function collectionStateFrom(events: EventRow[]) {
  const parents = new Map<string, string | null>();
  const handles = new Map<string, { handle: string; removed: boolean }>();
  const membership = new Map<string, string>();
  for (const event of events) {
    const payload = event.payload;
    if (event.type === "CollectionCreated") {
      const id = String(payload.collection_id ?? "");
      parents.set(id, payload.parent_collection_id ? String(payload.parent_collection_id) : null);
      handles.set(id, { handle: String(payload.handle ?? ""), removed: false });
    } else if (event.type === "CollectionRenamed") {
      const current = handles.get(String(payload.collection_id));
      if (current) current.handle = String(payload.new_handle ?? current.handle);
    } else if (event.type === "CollectionRemoved") {
      const current = handles.get(String(payload.collection_id));
      if (current) current.removed = true;
    } else if (event.type === "CollectionRestored") {
      const current = handles.get(String(payload.collection_id));
      if (current) current.removed = false;
    } else if (event.type === "CollectionItemAdded") {
      const ref = (payload.item_ref ?? {}) as Record<string, unknown>;
      const itemId = String(ref.document_id ?? ref.collection_id ?? "");
      if (itemId) membership.set(itemId, String(payload.collection_id ?? ""));
      if (ref.collection_id) parents.set(String(ref.collection_id), String(payload.collection_id ?? ""));
    } else if (event.type === "CollectionItemRemoved") {
      const ref = (payload.item_ref ?? {}) as Record<string, unknown>;
      const itemId = String(ref.document_id ?? ref.collection_id ?? "");
      membership.delete(itemId);
      if (ref.collection_id) parents.set(String(ref.collection_id), null);
    } else if (event.type === "CollectionItemMoved") {
      const ref = (payload.item_ref ?? {}) as Record<string, unknown>;
      const itemId = String(ref.document_id ?? ref.collection_id ?? "");
      if (itemId) membership.set(itemId, String(payload.to_collection_id ?? ""));
      if (ref.collection_id) parents.set(String(ref.collection_id), String(payload.to_collection_id ?? ""));
    }
  }
  return { parents, handles, membership };
}

function wouldCreateCycle(itemId: string, targetId: string, parents: Map<string, string | null>) {
  let cursor: string | null | undefined = targetId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === itemId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parents.get(cursor);
  }
  return false;
}

function validateCollectionEvent(
  item: EventInput,
  state: ReturnType<typeof collectionStateFrom>,
) {
  const payload = item.payload ?? {};
  if (item.type === "CollectionCreated") {
    const id = String(payload.collection_id ?? "");
    const handle = String(payload.handle ?? "").trim();
    const parentId = payload.parent_collection_id ? String(payload.parent_collection_id) : null;
    if (!id || !handle) return "collection_id_and_handle_are_required";
    if (state.handles.has(id)) return "collection_id_already_exists";
    if (parentId && !state.handles.has(parentId)) return "parent_collection_not_found";
    if (parentId === id) return "collection_cycle";
    const siblingCollision = Array.from(state.handles.entries()).some(
      ([existingId, value]) => !value.removed && value.handle === handle && state.parents.get(existingId) === parentId,
    );
    if (siblingCollision) return "handle_already_exists_within_parent";
    state.parents.set(id, parentId);
    state.handles.set(id, { handle, removed: false });
  }
  if (item.type === "CollectionRenamed") {
    const id = String(payload.collection_id ?? "");
    const next = String(payload.new_handle ?? "").trim();
    const current = state.handles.get(id);
    if (!current || !next) return "collection_and_new_handle_are_required";
    const siblingCollision = Array.from(state.handles.entries()).some(
      ([existingId, value]) => existingId !== id && !value.removed && value.handle === next && state.parents.get(existingId) === state.parents.get(id),
    );
    if (siblingCollision) return "handle_already_exists_within_parent";
    current.handle = next;
  }
  if (item.type === "CollectionItemAdded" || item.type === "CollectionItemMoved") {
    const ref = (payload.item_ref ?? {}) as Record<string, unknown>;
    const itemId = String(ref.document_id ?? ref.collection_id ?? "");
    const targetId = String(item.type === "CollectionItemMoved" ? payload.to_collection_id : payload.collection_id);
    if (!itemId || !targetId || !state.handles.has(targetId)) return "valid_item_and_target_collection_are_required";
    if (item.type === "CollectionItemAdded" && state.membership.has(itemId)) return "item_already_filed";
    if (ref.collection_id && wouldCreateCycle(itemId, targetId, state.parents)) return "collection_cycle";
    state.membership.set(itemId, targetId);
    if (ref.collection_id) state.parents.set(itemId, targetId);
  }
  return null;
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const { streamId } = identity(request);
    await seedIfEmpty(streamId);
    const events = await readEvents(streamId);
    return Response.json({ events, head: events.at(-1)?.sequence ?? 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read the event stream";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const { ownerId, streamId } = identity(request);
    await seedIfEmpty(streamId);
    const body = (await request.json()) as {
      action?: "append" | "batch" | "propose" | "generate";
      event?: EventInput;
      events?: EventInput[];
      expectedSequence?: number;
      clientId?: string;
      correlationId?: string;
      prompt?: string;
      snapshot?: Record<string, unknown>;
      sourceBlockVersions?: Array<Record<string, unknown>>;
    };
    const currentHead = await headSequence(streamId);
    const clientId = body.clientId || "web:primary";
    const correlationId = body.correlationId || uuidV7();
    const requested = body.action === "batch" ? body.events ?? [] : body.event ? [body.event] : [];
    const onlyCommutative = requested.length > 0 && requested.every((item) => COMMUTATIVE_EVENTS.has(item.type ?? ""));

    if (
      typeof body.expectedSequence === "number" &&
      body.expectedSequence !== currentHead &&
      body.action !== "propose" &&
      !onlyCommutative
    ) {
      return Response.json(
        { error: "stale_sequence", expected: body.expectedSequence, head: currentHead },
        { status: 409 },
      );
    }

    if (body.action === "propose") {
      const contentId = uuidV7();
      await env.DB.prepare(
        "INSERT INTO external_content (content_id, owner_id, content, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind(contentId, ownerId, body.prompt ?? "", new Date().toISOString())
        .run();
      const proposal = makeEvent(
        streamId,
        currentHead + 1,
        "model:forma-chat",
        clientId,
        correlationId,
        "MutationProposed",
        {
          content_ref: contentId,
          proposed_events: body.events ?? [],
          expected_sequence: currentHead,
        },
      );
      await insertStatement(proposal).run();
      return Response.json({ appended: [proposal], rejected: [], head: proposal.sequence });
    }

    if (body.action === "generate") {
      const generationId = uuidV7();
      const requestEvent = makeEvent(
        streamId,
        currentHead + 1,
        "user",
        clientId,
        correlationId,
        "GenerationRequested",
        { generation_id: generationId, stream_id: streamId, model_ids: ["adapter-neutral"] },
      );
      const compileEvent = makeEvent(
        streamId,
        currentHead + 2,
        "worker:compiler",
        clientId,
        correlationId,
        "ContextCompiled",
        {
          generation_id: generationId,
          model_id: "adapter-neutral",
          adapter_version: "v0.1",
          compiled_snapshot: body.snapshot ?? {},
          source_block_versions: body.sourceBlockVersions ?? [],
        },
        { causationId: requestEvent.eventId },
      );
      const completeEvent = makeEvent(
        streamId,
        currentHead + 3,
        "worker:generator",
        clientId,
        correlationId,
        "GenerationCompleted",
        {
          generation_id: generationId,
          model_id: "adapter-neutral",
          object_ids: [`object-${generationId.slice(-8)}`],
          latency_ms: 900 + ((currentHead * 83) % 1400),
          variant: (currentHead + 1) % 4,
        },
        { causationId: compileEvent.eventId },
      );
      await env.DB.batch([requestEvent, compileEvent, completeEvent].map(insertStatement));
      return Response.json({ appended: [requestEvent, compileEvent, completeEvent], rejected: [], head: completeEvent.sequence });
    }

    if (body.action !== "append" && body.action !== "batch") {
      return Response.json({ error: "Unsupported append action" }, { status: 400 });
    }

    const rejected: Array<{ index: number; type: string; reason: string }> = [];
    const collectionState = collectionStateFrom(await readEvents(streamId));
    const valid = requested.filter((item, index) => {
      const type = item.type ?? "";
      if (!type || !actorCanAppend("user", type)) {
        rejected.push({ index, type, reason: "event_not_permitted_for_user" });
        return false;
      }
      if (!item.payload || typeof item.payload !== "object") {
        rejected.push({ index, type, reason: "payload_must_be_an_object" });
        return false;
      }
      if (type.startsWith("Collection")) {
        const reason = validateCollectionEvent(item, collectionState);
        if (reason) {
          rejected.push({ index, type, reason });
          return false;
        }
      }
      return true;
    });

    let sequence = currentHead;
    const appended = valid.map((item) =>
      makeEvent(
        streamId,
        ++sequence,
        "user",
        clientId,
        correlationId,
        item.type!,
        item.payload!,
        { compensatesEventId: item.compensatesEventId },
      ),
    );

    if (rejected.length > 0) {
      appended.push(
        makeEvent(
          streamId,
          ++sequence,
          "worker:validator",
          clientId,
          correlationId,
          "ValidationFailed",
          { attempted_type: "emit_events", attempted_by: "user", permission_schema_version: PERMISSION_SCHEMA_VERSION, errors: rejected },
        ),
      );
    }

    if (appended.length > 0) await env.DB.batch(appended.map(insertStatement));
    return Response.json({ appended, rejected, head: sequence });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to append events";
    return Response.json({ error: message }, { status: 500 });
  }
}
