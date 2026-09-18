import type { EventInput } from "../src/model/events.ts";
import { outcomeRecipe } from "../src/model/outcome-recipes.ts";

export const CANVAS_ARRANGEMENT_MAX_ITEMS = 100;
export const CANVAS_ARRANGEMENT_MAX_EVENTS = 1 + 2 * CANVAS_ARRANGEMENT_MAX_ITEMS;
export const CANVAS_ARRANGEMENT_MAX_COORDINATE = 1_000_000;
export const CANVAS_ARRANGEMENT_MAX_EDGE = 8192;

type Candidate = { type?: string; payload?: Record<string, unknown>; compensatesEventId?: string | null };
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9:_-]{0,127}$/iu.test(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function validCanvasArrangementFrame(value: unknown): boolean {
  const frame = record(value);
  return identifier(frame.itemId ?? frame.item_id) && number(frame.x) && number(frame.y)
    && Math.abs(frame.x) <= CANVAS_ARRANGEMENT_MAX_COORDINATE && Math.abs(frame.y) <= CANVAS_ARRANGEMENT_MAX_COORDINATE
    && number(frame.w) && frame.w >= 120 && frame.w <= CANVAS_ARRANGEMENT_MAX_EDGE
    && number(frame.h) && frame.h >= 90 && frame.h <= CANVAS_ARRANGEMENT_MAX_EDGE;
}

/** This bounded server-only grammar never admits semantic events or arbitrary Canvas registers. */
export function validateAtomicCanvasArrangementEvents(events: Candidate[], actorUserId: string): string | null {
  const first = events[0], payload = record(first?.payload);
  const itemIds = Array.isArray(payload.item_ids) ? payload.item_ids : [];
  const before = Array.isArray(payload.previous_frames) ? payload.previous_frames.map(record) : [];
  const after = Array.isArray(payload.frames) ? payload.frames.map(record) : [];
  const sources = Array.isArray(payload.source_items) ? payload.source_items.map(record) : [];
  if (first?.type !== "CanvasArrangementCreated" || itemIds.length < 2 || itemIds.length > CANVAS_ARRANGEMENT_MAX_ITEMS
    || new Set(itemIds).size !== itemIds.length || itemIds.some((id) => !identifier(id))
    || events.length !== 1 + itemIds.length * 2 || before.length !== itemIds.length || after.length !== itemIds.length || sources.length !== itemIds.length
    || !identifier(payload.project_id) || !identifier(payload.canvas_id) || !identifier(payload.arrangement_id)
    || !identifier(payload.organization_action_id) || payload.history_action_id !== payload.organization_action_id
    || payload.history_owner_id !== actorUserId || payload.arrangement_is_context !== false
    || !["grid", "row", "column"].includes(String(payload.kind))
    || !outcomeRecipe(String(payload.recipe_id))
    || typeof payload.name !== "string" || !payload.name.trim() || Array.from(payload.name).length > 80 || /\p{Cc}/u.test(payload.name)
    || payload.source_surface !== "canvas-outcome-arrangement"
    || payload.undo_of_arrangement_id !== null && !identifier(payload.undo_of_arrangement_id)
    || !keys(payload, ["project_id", "canvas_id", "arrangement_id", "organization_action_id", "history_action_id", "history_owner_id",
      "client_event_id", "name", "kind", "recipe_id", "item_ids", "frames", "previous_frames", "source_items", "source_surface",
      "arrangement_is_context", "undo_of_arrangement_id"])
    || events.some((event) => Boolean(event.compensatesEventId))) return "invalid_canvas_arrangement_authoring";
  const kind = outcomeRecipe(String(payload.recipe_id))?.arrangement;
  if (kind !== payload.kind) return "invalid_canvas_arrangement_authoring";
  const site = actorUserId + ":canvas-arrangement";
  const clientPrefix = String(payload.arrangement_id) + ":";
  if (payload.client_event_id !== clientPrefix + "0") return "invalid_canvas_arrangement_authoring";
  let clock: Record<string, unknown> | null = null;
  for (let index = 0; index < itemIds.length; index++) {
    const id = itemIds[index], previous = before[index], next = after[index], source = sources[index];
    if (previous.item_id !== id || next.item_id !== id || source.item_id !== id
      || !validCanvasArrangementFrame(previous) || !validCanvasArrangementFrame(next) || previous.w !== next.w || previous.h !== next.h
      || !keys(previous, ["item_id", "x", "y", "w", "h"]) || !keys(next, ["item_id", "x", "y", "w", "h"])
      || !keys(source, ["item_id", "source_kind", "source_id", "rot", "z"]) || !identifier(source.source_id)
      || !["block", "document", "output", "artifact", "reference", "sketch", "context"].includes(String(source.source_kind))
      || !number(source.rot) || Math.abs(source.rot) > 360_000 || typeof source.z !== "string" || source.z.length > 128)
      return "invalid_canvas_arrangement_authoring";
    for (const [axisIndex, prop] of (["x", "y"] as const).entries()) {
      const ordinal = 1 + index * 2 + axisIndex, event = events[ordinal], current = record(event?.payload);
      const operation = record(current.operation), object = record(operation.object), hlc = record(operation.hlc);
      if (event?.type !== "CanvasRegisterSet" || current.project_id !== payload.project_id || current.canvas_id !== payload.canvas_id
        || current.arrangement_id !== payload.arrangement_id || current.item_id !== id || current.previous_value !== previous[prop]
        || current.organization_action_id !== payload.organization_action_id || current.history_action_id !== payload.history_action_id
        || current.history_owner_id !== actorUserId || current.client_event_id !== clientPrefix + ordinal
        || current.source_surface !== payload.source_surface || current.arrangement_is_context !== false
        || !same(current.selected_item_ids, itemIds)
        || !keys(current, ["project_id", "canvas_id", "item_id", "previous_value", "arrangement_id", "organization_action_id",
          "history_action_id", "history_owner_id", "client_event_id", "selected_item_ids", "source_surface", "arrangement_is_context", "operation"])
        || !keys(operation, ["object", "prop", "value", "hlc"]) || !keys(object, ["kind", "item_id"])
        || object.kind !== "canvas_item" || object.item_id !== id || operation.prop !== prop || operation.value !== next[prop]
        || !keys(hlc, ["pt", "c", "site"]) || !Number.isSafeInteger(hlc.pt) || Number(hlc.pt) < 0
        || hlc.c !== ordinal || hlc.site !== site || !identifier(site) || clock && hlc.pt !== clock.pt)
        return "invalid_canvas_arrangement_authoring";
      clock = hlc;
    }
  }
  return null;
}

export function assertAtomicCanvasArrangementEvents(events: EventInput[], actorUserId: string): void {
  const error = validateAtomicCanvasArrangementEvents(events, actorUserId);
  if (error) throw new Error(error);
}
