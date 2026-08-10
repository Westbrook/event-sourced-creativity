"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  eventCategory,
  foldEvents,
  shortEventType,
  type CreativeBlock,
  type CreativeEvent,
} from "./event-model";

type EventInput = {
  type: string;
  payload: Record<string, unknown>;
  compensatesEventId?: string | null;
};

type Proposal = {
  eventId: string;
  prompt: string;
  summary: string;
  events: EventInput[];
};

const CLIENT_ID = "web:primary";
const WARM_COLORS = ["#30252B", "#F29A65", "#F0D2AA", "#A75A54"];
const COOL_COLORS = ["#202733", "#7995B2", "#D8D7CD", "#6A596B"];

function makeClientId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function MiniMark() {
  return (
    <span className="mini-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function DotIcon({ label }: { label: string }) {
  return <span className="dot-icon" aria-hidden="true">{label.slice(0, 1)}</span>;
}

function AuthorityBadge({ block }: { block: CreativeBlock }) {
  const authority = String(block.properties.authority ?? "authored");
  const confidence = Number(block.properties.confidence ?? 1);
  return (
    <span className={`authority ${authority}`}>
      <span aria-hidden="true">{authority === "authored" ? "◆" : "◌"}</span>
      {authority}
      {authority === "inferred" && confidence < 0.9 ? ` · ${Math.round(confidence * 100)}%` : ""}
    </span>
  );
}

function CollectionTree({
  collections,
  selectedId,
  documentId,
  membership,
  onSelect,
  onMoveDocument,
}: {
  collections: ReturnType<typeof foldEvents>["collections"];
  selectedId: string;
  documentId: string;
  membership: ReturnType<typeof foldEvents>["membership"];
  onSelect: (id: string) => void;
  onMoveDocument: (id: string) => void;
}) {
  const roots = collections.filter((collection) => !collection.parentId);
  const children = (parentId: string) => collections.filter((collection) => collection.parentId === parentId);
  const currentCollection = membership[documentId]?.collectionId;

  const handleTreeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-tree-node]"));
    const index = nodes.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "ArrowDown" ? Math.min(index + 1, nodes.length - 1) : Math.max(index - 1, 0);
    nodes[next]?.focus();
  };

  const renderNode = (collection: (typeof collections)[number], level: number) => {
    const nested = children(collection.id);
    const isSelected = selectedId === collection.id;
    return (
      <li key={collection.id} role="treeitem" aria-selected={isSelected} aria-expanded={nested.length ? true : undefined}>
        <button
          type="button"
          data-tree-node
          className={`tree-row ${isSelected ? "selected" : ""}`}
          style={{ paddingLeft: `${12 + level * 18}px` }}
          onClick={() => onSelect(collection.id)}
          onDoubleClick={() => onMoveDocument(collection.id)}
          title={currentCollection === collection.id ? "This document is filed here" : "Double-click to move this document here"}
        >
          <span className={`folder-shape ${collection.sourceClaimRef ? "promoted" : ""}`} aria-hidden="true" />
          <span>{collection.handle}</span>
          {currentCollection === collection.id && <span className="current-dot" title="Current document">•</span>}
          {collection.handle === "studio-launch" && <span className="tree-count">3</span>}
        </button>
        {nested.length > 0 && <ul role="group">{nested.map((child) => renderNode(child, level + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="tree-wrap" role="tree" tabIndex={0} aria-label="Collections" onKeyDown={handleTreeKey}>
      <ul>{roots.map((collection) => renderNode(collection, 0))}</ul>
    </div>
  );
}

function OutputArtwork({ variant, compact = false }: { variant: number; compact?: boolean }) {
  return (
    <div className={`output-artwork variant-${variant % 4} ${compact ? "compact" : ""}`} aria-label="Generated abstract interior study" role="img">
      <span className="art-haze" />
      <span className="art-window" />
      <span className="art-floor" />
      <span className="art-orb" />
      <span className="art-line" />
    </div>
  );
}

function BlockCard({
  block,
  selected,
  onSelect,
  onPaletteEdit,
  onToggleLock,
}: {
  block: CreativeBlock;
  selected: boolean;
  onSelect: () => void;
  onPaletteEdit: () => void;
  onToggleLock: () => void;
}) {
  const colors = Array.isArray(block.properties.colors) ? (block.properties.colors as string[]) : [];
  return (
    <div
      role="button"
      className={`block-card ${selected ? "selected" : ""} block-${block.type}`}
      onClick={onSelect}
      tabIndex={0}
      aria-label={`${block.handle} ${block.type} block`}
      onKeyDown={(event) => event.key === "Enter" && onSelect()}
    >
      <div className="block-head">
        <span className="drag-dots" aria-hidden="true">⠿</span>
        <span className="block-type">{block.type}</span>
        <button
          type="button"
          className="icon-button quiet"
          onClick={(event) => {
            event.stopPropagation();
            onToggleLock();
          }}
          aria-label={block.locked ? `Unlock ${block.handle}` : `Lock ${block.handle}`}
        >
          {block.locked ? "▣" : "□"}
        </button>
      </div>
      {block.type === "direction" && (
        <>
          <p className="direction-copy">{String(block.properties.text ?? "A new direction")}</p>
          <div className="direction-meta"><span>mood</span><span>spatial</span><span>quiet</span></div>
        </>
      )}
      {block.type === "reference" && (
        <div className="reference-visual">
          {typeof block.properties.source_url === "string" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={block.properties.source_url} alt={String(block.properties.label ?? "Uploaded reference")} />
          ) : (
            <div className="reference-art" aria-label="Window light reference" role="img"><i /><i /><i /></div>
          )}
          <div><strong>{String(block.properties.label ?? "Reference")}</strong><span>owned source</span></div>
        </div>
      )}
      {block.type === "palette" && (
        <>
          <div className="swatch-row">
            {colors.map((color, index) => (
              <button
                type="button"
                key={`${color}-${index}`}
                className="swatch"
                style={{ backgroundColor: color }}
                aria-label={`Edit color ${color}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onPaletteEdit();
                }}
              />
            ))}
          </div>
          <div className="palette-foot"><span>Dusk warm</span><AuthorityBadge block={block} /></div>
        </>
      )}
      {block.type === "constraint" && (
        <div className="constraint-copy"><span aria-hidden="true">⌁</span>{String(block.properties.text ?? "Keep material detail visible")}</div>
      )}
      <div className="weight-line"><span style={{ width: `${Number(block.properties.weight ?? 0.7) * 100}%` }} /></div>
    </div>
  );
}

export default function Workspace() {
  const [events, setEvents] = useState<CreativeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [view, setView] = useState<"context" | "lineage">("context");
  const [selectedBlockId, setSelectedBlockId] = useState("block-palette");
  const [selectedCollectionId, setSelectedCollectionId] = useState("collection-studio");
  const [composerMode, setComposerMode] = useState<"create" | "ask">("create");
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [generating, setGenerating] = useState(false);
  const [streamOpen, setStreamOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(true);
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [notification, setNotification] = useState("");
  const [eventFilter, setEventFilter] = useState("all");
  const [redoSource, setRedoSource] = useState<CreativeEvent | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const project = useMemo(() => foldEvents(events), [events]);
  const head = events.at(-1)?.sequence ?? 0;
  const selectedBlock = project.blocks.find((block) => block.id === selectedBlockId) ?? project.blocks[0];
  const latestOutput = project.outputs[0];

  const notify = useCallback((message: string) => {
    setNotification(message);
    window.setTimeout(() => setNotification(""), 2800);
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const response = await fetch("/api/events", { cache: "no-store" });
      const data = (await response.json()) as { events?: CreativeEvent[]; error?: string };
      if (!response.ok || !data.events) throw new Error(data.error || "The event stream is unavailable");
      setEvents(data.events);
      setSyncError("");
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "The event stream is unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial replay synchronizes this client projection with the durable event stream.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setAddMenuOpen(false);
        setStreamOpen(false);
        setProposal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const postEvents = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: CLIENT_ID, ...body }),
      });
      const data = (await response.json()) as {
        appended?: CreativeEvent[];
        rejected?: Array<{ reason: string }>;
        error?: string;
        head?: number;
      };
      if (response.status === 409) {
        await loadEvents();
        throw new Error("This canvas changed elsewhere. It is refreshed and ready to retry.");
      }
      if (!response.ok) throw new Error(data.error || "The change could not be recorded");
      if (data.appended?.length) {
        setEvents((current) => {
          const known = new Set(current.map((event) => event.eventId));
          return [...current, ...data.appended!.filter((event) => !known.has(event.eventId))].sort((a, b) => a.sequence - b.sequence);
        });
      }
      return data;
    },
    [loadEvents],
  );

  const appendEvents = useCallback(
    async (items: EventInput[], successMessage?: string) => {
      try {
        const result = await postEvents({
          action: items.length === 1 ? "append" : "batch",
          event: items.length === 1 ? items[0] : undefined,
          events: items.length > 1 ? items : undefined,
          expectedSequence: head,
          correlationId: makeClientId("correlation"),
        });
        setRedoSource(null);
        if (result.rejected?.length) notify(`${result.rejected.length} invalid change was witnessed and skipped.`);
        else if (successMessage) notify(successMessage);
        return result;
      } catch (error) {
        notify(error instanceof Error ? error.message : "The change could not be recorded");
        return null;
      }
    },
    [head, notify, postEvents],
  );

  const generate = useCallback(async () => {
    if (generating || !project.blocks.length) return;
    setGenerating(true);
    setProposal(null);
    try {
      const snapshot = {
        as_of: head,
        facts: project.blocks.map((block) => ({
          handle: block.handle,
          type: block.type,
          properties: block.properties,
          authority: block.properties.authority ?? "authored",
          citations: block.sourceEvents,
        })),
        pins: project.outputs.filter((output) => output.pinned).map((output) => output.id),
        tail_budget: 320,
      };
      await postEvents({
        action: "generate",
        expectedSequence: head,
        correlationId: makeClientId("generation"),
        snapshot,
        sourceBlockVersions: project.blocks.map((block) => ({ block_id: block.id, version: block.sourceEvents.length })),
      });
      window.setTimeout(() => setGenerating(false), 650);
      setPrompt("");
      notify("A new study was compiled from the current context.");
    } catch (error) {
      setGenerating(false);
      notify(error instanceof Error ? error.message : "Generation could not start");
    }
  }, [generating, head, notify, postEvents, project.blocks, project.outputs]);

  const editPalette = async () => {
    const palette = project.blocks.find((block) => block.type === "palette");
    if (!palette) return;
    const current = Array.isArray(palette.properties.colors) ? (palette.properties.colors as string[]) : COOL_COLORS;
    const next = current[1] === WARM_COLORS[1] ? COOL_COLORS : WARM_COLORS;
    await appendEvents(
      [{ type: "ChipEdited", payload: { chip_id: "chip-palette", block_id: palette.id, property: "colors", old_value: current, new_value: next } }],
      "Palette promoted to authored state.",
    );
  };

  const toggleLock = async (block: CreativeBlock) => {
    await appendEvents(
      [{ type: block.locked ? "BlockUnlocked" : "BlockLocked", payload: { block_id: block.id, locked_by: "user" } }],
      block.locked ? "Block unlocked." : "Block locked.",
    );
  };

  const changeWeight = async (block: CreativeBlock, delta: number) => {
    const previous = Number(block.properties.weight ?? 0.5);
    const weight = Math.min(1, Math.max(0.1, Math.round((previous + delta) * 100) / 100));
    await appendEvents([{ type: "BlockWeightSet", payload: { block_id: block.id, weight, previous_weight: previous } }]);
  };

  const addBlock = async (type: "direction" | "palette" | "constraint") => {
    const id = makeClientId(`block-${type}`);
    const properties =
      type === "direction"
        ? { text: "A tactile, patient composition with one surprising edge.", weight: 0.72, authority: "authored" }
        : type === "palette"
          ? { colors: COOL_COLORS, weight: 0.7, authority: "authored" }
          : { text: "Preserve quiet space around the subject", weight: 0.88, authority: "constraint" };
    await appendEvents(
      [{ type: "BlockCreated", payload: { block_id: id, type, handle: `${type}/${id.slice(-5)}`, properties, position: `b${head}` } }],
      `${type[0].toUpperCase()}${type.slice(1)} block added.`,
    );
    setSelectedBlockId(id);
    setAddMenuOpen(false);
  };

  const handleUpload = async (file: File) => {
    try {
      notify("Securing the reference…");
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/media", { method: "POST", body });
      const media = (await response.json()) as { url?: string; key?: string; name?: string; error?: string };
      if (!response.ok || !media.url) throw new Error(media.error || "The image could not be stored");
      const referenceId = makeClientId("reference");
      const blockId = makeClientId("block-reference");
      await appendEvents(
        [
          { type: "ReferenceIngested", payload: { reference_id: referenceId, source_type: "upload", source_ref: media.key, content_hash: `${file.name}:${file.size}:${file.lastModified}`, rights_class: "owned" } },
          { type: "BlockCreated", payload: { block_id: blockId, type: "reference", handle: `reference/${file.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, properties: { reference_id: referenceId, source_url: media.url, label: media.name, weight: 0.72, authority: "authored" }, position: `b${head}` } },
        ],
        "Reference added; deterministic reflection is ready.",
      );
      setSelectedBlockId(blockId);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The image could not be added");
    }
  };

  const onCanvasDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void handleUpload(file);
  };

  const submitComposer = async () => {
    if (composerMode === "create") {
      await generate();
      return;
    }
    const command = prompt.trim();
    if (!command) return;
    const palette = project.blocks.find((block) => block.type === "palette");
    const direction = project.blocks.find((block) => block.type === "direction");
    let proposed: EventInput[];
    let summary: string;

    if (/warm|amber|sunset/i.test(command) && palette) {
      proposed = [{ type: "ChipEdited", payload: { chip_id: "chip-palette", block_id: palette.id, property: "colors", old_value: palette.properties.colors, new_value: WARM_COLORS } }];
      summary = "Warm the dusk palette while preserving its four-swatch structure";
    } else if (/lock|keep|preserve/i.test(command) && direction) {
      proposed = [{ type: "BlockLocked", payload: { block_id: direction.id, locked_by: "user" } }];
      summary = `Lock ${direction.handle} so generation cannot drift from it`;
    } else if (direction) {
      proposed = [{ type: "BlockPropertyEdited", payload: { block_id: direction.id, property_path: "text", old_value: direction.properties.text, new_value: `${String(direction.properties.text)} ${command}` } }];
      summary = `Add the instruction to ${direction.handle}`;
    } else {
      proposed = [{ type: "BlockCreated", payload: { block_id: makeClientId("block-direction"), type: "direction", handle: "direction/from-chat", properties: { text: command, weight: 0.75, authority: "authored" }, position: `b${head}` } }];
      summary = "Create a new authored direction block";
    }

    try {
      const result = await postEvents({
        action: "propose",
        expectedSequence: head,
        prompt: command,
        events: proposed,
        correlationId: makeClientId("proposal"),
      });
      const mutation = result.appended?.[0];
      if (mutation) setProposal({ eventId: mutation.eventId, prompt: command, summary, events: proposed });
      setPrompt("");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The proposal could not be prepared");
    }
  };

  const acceptProposal = async () => {
    if (!proposal) return;
    await appendEvents(
      [
        ...proposal.events,
        { type: "ProposalAccepted", payload: { proposal_event_id: proposal.eventId, accepted_count: proposal.events.length } },
      ],
      "Proposal accepted as authored state.",
    );
    setProposal(null);
  };

  const declineProposal = async () => {
    if (!proposal) return;
    await appendEvents(
      [{ type: "ProposalDeclined", payload: { correlation_id: proposal.eventId, declined_item_ids: proposal.events.map((_, index) => index) } }],
      "Proposal declined and retained as a hard negative.",
    );
    setProposal(null);
  };

  const createCollection = async () => {
    const handle = newCollectionName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!handle) return;
    const id = makeClientId("collection");
    await appendEvents(
      [{ type: "CollectionCreated", payload: { collection_id: id, handle, parent_collection_id: null, source_claim_ref: null, position: `b${head}` } }],
      "Authored collection created.",
    );
    setSelectedCollectionId(id);
    setNewCollectionName("");
    setNewCollectionOpen(false);
  };

  const moveDocument = async (collectionId: string) => {
    const existing = project.membership[project.documentId];
    if (existing?.collectionId === collectionId) return;
    await appendEvents(
      [{
        type: existing ? "CollectionItemMoved" : "CollectionItemAdded",
        payload: existing
          ? { item_ref: { document_id: project.documentId }, from_collection_id: existing.collectionId, to_collection_id: collectionId, position: `b${head}` }
          : { collection_id: collectionId, item_ref: { document_id: project.documentId }, position: `b${head}` },
      }],
      "Document moved by an authored filing event.",
    );
  };

  const undo = async () => {
    const reversible = [...events].reverse().find((event) =>
      event.actor === "user" &&
      !event.compensatesEventId &&
      ["BlockWeightSet", "BlockLocked", "BlockUnlocked", "ChipEdited", "BlockCreated"].includes(event.type),
    );
    if (!reversible) return notify("Nothing in this session can be compensated yet.");
    const payload = reversible.payload;
    let inverse: EventInput;
    if (reversible.type === "BlockWeightSet") inverse = { type: "BlockWeightSet", payload: { block_id: payload.block_id, weight: payload.previous_weight, previous_weight: payload.weight } };
    else if (reversible.type === "BlockLocked") inverse = { type: "BlockUnlocked", payload: { block_id: payload.block_id, locked_by: "user" } };
    else if (reversible.type === "BlockUnlocked") inverse = { type: "BlockLocked", payload: { block_id: payload.block_id, locked_by: "user" } };
    else if (reversible.type === "ChipEdited") inverse = { type: "ChipEdited", payload: { ...payload, old_value: payload.new_value, new_value: payload.old_value } };
    else inverse = { type: "BlockRemoved", payload: { block_id: payload.block_id } };
    inverse.compensatesEventId = reversible.eventId;
    const result = await appendEvents([inverse], "Last authored act compensated.");
    if (result) setRedoSource(reversible);
  };

  const redo = async () => {
    if (!redoSource) return;
    const result = await appendEvents([{ type: redoSource.type, payload: redoSource.payload }], "Authored act reapplied.");
    if (result) setRedoSource(null);
  };

  const filteredEvents = events.filter((event) => eventFilter === "all" || eventCategory(event.type) === eventFilter).slice().reverse();

  if (loading) {
    return (
      <main className="loading-stage">
        <MiniMark />
        <p>Replaying the studio…</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#canvas">Skip to canvas</a>
      <header className="topbar">
        <div className="brand"><MiniMark /><span>Forma</span></div>
        <div className="breadcrumb" aria-label="Current location">
          <button type="button">{project.projectName}</button><span>/</span><strong>{project.documentTitle}</strong>
        </div>
        <div className="top-actions">
          <span className={`witness-status ${syncError ? "error" : ""}`}><i />{syncError ? "Local view" : `Witnessed · #${head}`}</span>
          <button type="button" className="keyboard-button" onClick={() => setCommandOpen(true)}><span>Commands</span><kbd>⌘ K</kbd></button>
          <button type="button" className="avatar" aria-label="Account menu">MW</button>
        </div>
      </header>

      <aside className="sidebar" aria-label="Workspace navigation">
        <button type="button" className="brief-peek" onClick={() => setBriefOpen((value) => !value)} aria-expanded={briefOpen}>
          <span className="brief-signal" aria-hidden="true"><i /><i /></span>
          <span><strong>Re-entry brief</strong><small>2 warm threads</small></span>
          <span className="chevron">{briefOpen ? "−" : "+"}</span>
        </button>
        {briefOpen && (
          <div className="brief-card">
            <div className="brief-label"><span>Since your last session</span><time>today</time></div>
            <p>The dusk palette is converging. Your side-by-side comparison is still open.</p>
            <div className="brief-actions">
              <button type="button" onClick={() => void appendEvents([{ type: "BriefItemAccepted", payload: { brief_id: "brief-today", item_id: latestOutput?.id ?? "object-nocturne-01" } }], "Warm thread returned to the canvas.")}>Continue thread</button>
              <button type="button" onClick={() => void appendEvents([{ type: "EmptyCanvasChosen", payload: { session_id: "session-today" } }], "Blank canvas chosen with equal weight.")}>Start blank</button>
            </div>
          </div>
        )}

        <div className="side-section-head">
          <span>Collections</span>
          <button type="button" aria-label="New collection" onClick={() => setNewCollectionOpen(true)}>＋</button>
        </div>
        {newCollectionOpen && (
          <form className="new-collection" onSubmit={(event) => { event.preventDefault(); void createCollection(); }}>
            <input aria-label="Collection name" value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} placeholder="collection-name" />
            <button type="submit" aria-label="Create collection">↵</button>
          </form>
        )}
        <CollectionTree
          collections={project.collections}
          selectedId={selectedCollectionId}
          documentId={project.documentId}
          membership={project.membership}
          onSelect={setSelectedCollectionId}
          onMoveDocument={(id) => void moveDocument(id)}
        />

        <div className="side-section-head library-head"><span>Library</span></div>
        <nav className="library-nav" aria-label="Library">
          <button type="button"><DotIcon label="B" /><span>Reusable blocks</span><b>{project.blocks.length}</b></button>
          <button type="button"><DotIcon label="O" /><span>Recent outputs</span><b>{project.outputs.length}</b></button>
          <button type="button"><DotIcon label="F" /><span>Aesthetic families</span><b>2</b></button>
        </nav>

        <div className="sidebar-foot">
          <button type="button" className="stream-link" onClick={() => setStreamOpen(true)}>
            <span className="stream-pulse"><i /><i /><i /></span>
            <span><strong>Event stream</strong><small>{events.length} immutable records</small></span>
            <span>↗</span>
          </button>
          <div className="projection-health"><span><i />All projections current</span><span>{syncError ? "offline" : "0 lag"}</span></div>
        </div>
      </aside>

      <main id="canvas" className="workspace" onDragOver={(event) => event.preventDefault()} onDrop={onCanvasDrop}>
        <section className="workspace-head">
          <div>
            <div className="eyebrow">Context document <span>·</span> active</div>
            <h1>{project.documentTitle}</h1>
          </div>
          <div className="workspace-tools">
            <div className="view-switch" aria-label="Canvas view">
              <button type="button" className={view === "context" ? "active" : ""} onClick={() => setView("context")}>Context</button>
              <button type="button" className={view === "lineage" ? "active" : ""} onClick={() => setView("lineage")}>Lineage</button>
            </div>
            <button type="button" className="tool-button" onClick={() => void undo()} aria-label="Undo last authored event">↶</button>
            <button type="button" className="tool-button" onClick={() => void redo()} disabled={!redoSource} aria-label="Redo">↷</button>
            <button type="button" className="share-button" onClick={() => notify("Sharing is held behind the human scope decision.")}>Share</button>
          </div>
        </section>

        {view === "context" ? (
          <section className="canvas-stage" aria-label="Context canvas">
            <div className="context-column">
              <div className="lane-label"><span>Inputs</span><small>{project.blocks.length} blocks</small></div>
              <div className="block-stack">
                {project.blocks.map((block) => (
                  <BlockCard
                    key={block.id}
                    block={block}
                    selected={selectedBlock?.id === block.id}
                    onSelect={() => setSelectedBlockId(block.id)}
                    onPaletteEdit={() => void editPalette()}
                    onToggleLock={() => void toggleLock(block)}
                  />
                ))}
                <div className="add-block-wrap">
                  <button type="button" className="add-block" onClick={() => setAddMenuOpen((value) => !value)}>＋ Add a block <span>⌄</span></button>
                  {addMenuOpen && (
                    <div className="add-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => void addBlock("direction")}><DotIcon label="D" /><span><b>Direction</b><small>Authored intent</small></span></button>
                      <button type="button" role="menuitem" onClick={() => void addBlock("palette")}><DotIcon label="P" /><span><b>Palette</b><small>Color structure</small></span></button>
                      <button type="button" role="menuitem" onClick={() => void addBlock("constraint")}><DotIcon label="C" /><span><b>Constraint</b><small>Standing guardrail</small></span></button>
                      <button type="button" role="menuitem" onClick={() => fileInputRef.current?.click()}><DotIcon label="R" /><span><b>Reference</b><small>Upload an owned image</small></span></button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="compile-bridge" aria-label="Compilation path">
              <span className="bridge-line" />
              <button type="button" onClick={() => setStreamOpen(true)} aria-label="Inspect compiled context">
                <span>compiled</span><b>{project.blocks.length}</b><small>cited facts</small>
              </button>
              <span className="bridge-line end" />
            </div>

            <div className="output-column">
              <div className="lane-label"><span>Latest study</span><small>adapter-neutral</small></div>
              <article className={`output-card ${generating ? "generating" : ""}`}>
                {latestOutput ? <OutputArtwork variant={latestOutput.variant} /> : <div className="empty-output">Generate the first study</div>}
                {generating && <div className="generation-scan"><span>Compiling current context</span></div>}
                <div className="output-meta">
                  <div><span className="output-index">A{project.outputs.length || 1}</span><div><strong>Nocturne / interior study</strong><small>{latestOutput ? `${(latestOutput.latency / 1000).toFixed(1)}s · event #${latestOutput.sequence}` : "ready"}</small></div></div>
                  <div className="output-actions">
                    <button type="button" aria-label="Compare output" onClick={() => void appendEvents([{ type: "ComparisonOpened", payload: { object_ids: project.outputs.slice(0, 2).map((output) => output.id), source_surface: "canvas" } }], "Comparison opened and witnessed.")}>◫</button>
                    <button type="button" aria-label={latestOutput?.pinned ? "Unpin output" : "Pin output"} onClick={() => latestOutput && void appendEvents([{ type: latestOutput.pinned ? "ObjectUnpinned" : "ObjectPinned", payload: { object_id: latestOutput.id, scope: "project" } }])}>{latestOutput?.pinned ? "◆" : "◇"}</button>
                    <button type="button" aria-label="Export output" onClick={() => latestOutput && void appendEvents([{ type: "ObjectExported", payload: { object_id: latestOutput.id, destination_class: "download", format: "png" } }], "Export recorded; clearance is owned.")}>↓</button>
                  </div>
                </div>
              </article>
              {project.outputs.length > 1 && (
                <div className="output-strip">
                  {project.outputs.slice(1, 4).map((output, index) => <button type="button" key={output.id} aria-label={`Open prior study A${project.outputs.length - index - 1}`}><OutputArtwork variant={output.variant} compact /><span>A{project.outputs.length - index - 1}</span></button>)}
                </div>
              )}
              <button type="button" className="drop-reference" onClick={() => fileInputRef.current?.click()}><span>＋</span>Drop a reference anywhere on the canvas</button>
            </div>
          </section>
        ) : (
          <section className="lineage-stage" aria-label="Provenance lineage">
            <div className="lineage-note"><span>Live provenance</span><strong>Every result explains itself.</strong><p>Select a node to trace the immutable events that shaped it.</p></div>
            <div className="graph">
              {project.blocks.map((block, index) => (
                <button type="button" key={block.id} className={`graph-node source n${index}`} onClick={() => setSelectedBlockId(block.id)}><span>{block.type}</span><strong>{block.handle.split("/").at(-1)}</strong><small>{block.sourceEvents.length} event{block.sourceEvents.length === 1 ? "" : "s"}</small></button>
              ))}
              <div className="graph-node compile"><span>projection</span><strong>Context # {head}</strong><small>stable prefix</small></div>
              <div className="graph-node result"><OutputArtwork variant={latestOutput?.variant ?? 0} compact /><strong>A{project.outputs.length}</strong><small>derived from {project.blocks.length} blocks</small></div>
              <span className="graph-path p1" /><span className="graph-path p2" /><span className="graph-path p3" /><span className="graph-path p4" />
            </div>
            <div className="lineage-legend"><span><i className="authored-key" />authored</span><span><i className="inferred-key" />inferred</span><span><i className="derived-key" />derived</span></div>
          </section>
        )}

        <div className="composer" aria-label="Create or ask Forma">
          <div className="composer-modes">
            <button type="button" className={composerMode === "create" ? "active" : ""} onClick={() => setComposerMode("create")}><span aria-hidden="true">✦</span>Create</button>
            <button type="button" className={composerMode === "ask" ? "active" : ""} onClick={() => setComposerMode("ask")}><span aria-hidden="true">⌁</span>Ask Forma</button>
          </div>
          {proposal && (
            <div className="proposal-preview" role="status">
              <div><span className="proposal-kicker">Proposed change · as of #{head - 1}</span><strong>{proposal.summary}</strong><small>{proposal.events.map((event) => shortEventType(event.type)).join(" + ")}</small></div>
              <div><button type="button" className="decline" onClick={() => void declineProposal()}>Decline</button><button type="button" className="accept" onClick={() => void acceptProposal()}>Accept change</button></div>
            </div>
          )}
          <div className="composer-entry">
            <button type="button" className="attach" aria-label="Add reference" onClick={() => fileInputRef.current?.click()}>＋</button>
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) void submitComposer(); }}
              aria-label={composerMode === "create" ? "Generation instruction" : "Ask Forma to change the canvas"}
              placeholder={composerMode === "create" ? "Add an instruction, or generate from the context as it is…" : "Try “make the palette warmer” or “lock the direction”…"}
            />
            <span className="context-count">{project.blocks.length} blocks</span>
            <button type="button" className="generate-button" disabled={generating || (composerMode === "ask" && !prompt.trim())} onClick={() => void submitComposer()}>{composerMode === "create" ? (generating ? "Working…" : "Generate") : "Preview"}<span aria-hidden="true">↗</span></button>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleUpload(file); event.target.value = ""; }} />
      </main>

      <aside className="inspector" aria-label="Selected block inspector">
        <div className="inspector-head"><span>Inspector</span><button type="button" aria-label="Inspector options">•••</button></div>
        {selectedBlock ? (
          <>
            <div className="inspector-title"><div><span className={`block-glyph glyph-${selectedBlock.type}`}>{selectedBlock.type.slice(0, 1).toUpperCase()}</span><div><strong>{selectedBlock.handle.split("/").at(-1)}</strong><small>{selectedBlock.handle}</small></div></div><button type="button" onClick={() => void toggleLock(selectedBlock)}>{selectedBlock.locked ? "▣" : "□"}</button></div>
            <section className="inspector-section">
              <h2>Contribution</h2>
              <div className="weight-control"><button type="button" onClick={() => void changeWeight(selectedBlock, -0.05)} aria-label="Decrease contribution">−</button><div><span style={{ width: `${Number(selectedBlock.properties.weight ?? 0.7) * 100}%` }} /></div><button type="button" onClick={() => void changeWeight(selectedBlock, 0.05)} aria-label="Increase contribution">＋</button><b>{Math.round(Number(selectedBlock.properties.weight ?? 0.7) * 100)}%</b></div>
              <p>How strongly this block influences the next compile.</p>
            </section>
            <section className="inspector-section">
              <h2>Authority</h2>
              <AuthorityBadge block={selectedBlock} />
              <p>{selectedBlock.properties.authority === "inferred" ? "Derived by a deterministic extractor. Editing promotes it to authored state." : "You set this value. Workers cannot silently replace it."}</p>
            </section>
            <section className="inspector-section source-section">
              <h2>Provenance</h2>
              <button type="button" onClick={() => { setView("lineage"); }}><span className="source-chain"><i /><i /><i /></span><span><strong>{selectedBlock.sourceEvents.length} source event{selectedBlock.sourceEvents.length === 1 ? "" : "s"}</strong><small>Trace why this is here</small></span><b>→</b></button>
            </section>
            {selectedBlock.type === "palette" && (
              <section className="inspector-section">
                <h2>Extracted colors</h2>
                <div className="inspector-swatches">{(Array.isArray(selectedBlock.properties.colors) ? selectedBlock.properties.colors as string[] : []).map((color) => <button type="button" key={color} style={{ background: color }} aria-label={`Change ${color}`} onClick={() => void editPalette()} />)}</div>
              </section>
            )}
            <div className="inspector-foot"><span>Projection as of</span><button type="button" onClick={() => setStreamOpen(true)}>Event #{head} ↗</button></div>
          </>
        ) : <p className="empty-inspector">Select a block to inspect its authority and provenance.</p>}
      </aside>

      {streamOpen && (
        <div className="drawer-backdrop" role="button" tabIndex={-1} aria-label="Close event stream" onKeyDown={(event) => event.key === "Escape" && setStreamOpen(false)} onMouseDown={(event) => event.target === event.currentTarget && setStreamOpen(false)}>
          <aside className="event-drawer" aria-label="Event stream" role="dialog" aria-modal="true">
            <div className="drawer-head"><div><span>System truth</span><h2>Event stream</h2></div><button type="button" onClick={() => setStreamOpen(false)} aria-label="Close event stream">×</button></div>
            <div className="health-row"><div><i /><span><strong>Projection health</strong><small>All {4 + project.collections.length} views current</small></span></div><b>0 lag</b></div>
            <div className="event-filters" aria-label="Filter events">
              {["all", "document", "generation", "reflection", "collection", "conversation"].map((filter) => <button type="button" key={filter} className={eventFilter === filter ? "active" : ""} onClick={() => setEventFilter(filter)}>{filter}</button>)}
            </div>
            <ol className="event-list">
              {filteredEvents.map((event) => (
                <li key={event.eventId}>
                  <span className={`event-dot category-${eventCategory(event.type)}`} />
                  <div><div><strong>{shortEventType(event.type)}</strong><code>#{event.sequence}</code></div><p>{event.actor}<span>·</span>{new Date(event.recordedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p><small>{Object.entries(event.payload).slice(0, 2).map(([key, value]) => `${key}: ${typeof value === "string" ? value : Array.isArray(value) ? `${value.length} items` : typeof value === "object" ? "{…}" : String(value)}`).join(" · ")}</small></div>
                </li>
              ))}
            </ol>
            <div className="drawer-foot"><span>Append-only · schema v1</span><button type="button" onClick={() => void loadEvents()}>Replay projection</button></div>
          </aside>
        </div>
      )}

      {commandOpen && (
        <div className="command-backdrop" role="button" tabIndex={-1} aria-label="Close command palette" onKeyDown={(event) => event.key === "Escape" && setCommandOpen(false)} onMouseDown={(event) => event.target === event.currentTarget && setCommandOpen(false)}>
          <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
            <div className="command-search"><span>⌕</span><input placeholder="Type a command…" aria-label="Search commands" /><kbd>esc</kbd></div>
            <div className="command-group"><span>Canvas</span>
              <button type="button" onClick={() => { setCommandOpen(false); void generate(); }}><i>✦</i><span><strong>Generate from current context</strong><small>Compiles {project.blocks.length} cited blocks</small></span><kbd>G</kbd></button>
              <button type="button" onClick={() => { setCommandOpen(false); setView(view === "context" ? "lineage" : "context"); }}><i>⌁</i><span><strong>Toggle lineage view</strong><small>Trace the current projection</small></span></button>
              <button type="button" onClick={() => { setCommandOpen(false); setAddMenuOpen(true); }}><i>＋</i><span><strong>Add a block</strong><small>Direction, palette, constraint, or reference</small></span></button>
            </div>
            <div className="command-group"><span>System</span>
              <button type="button" onClick={() => { setCommandOpen(false); setStreamOpen(true); }}><i>≡</i><span><strong>Inspect event stream</strong><small>Filter, trace, and replay</small></span></button>
              <button type="button" onClick={() => { setCommandOpen(false); setNewCollectionOpen(true); }}><i>□</i><span><strong>Create collection</strong><small>Authored organization only</small></span></button>
            </div>
            <div className="command-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> run</span></div>
          </div>
        </div>
      )}

      {notification && <div className="toast" role="status"><span>✓</span>{notification}</div>}
    </div>
  );
}
