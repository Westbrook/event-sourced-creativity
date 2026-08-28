import { hasOutputPackageProvenance, OUTPUT_CONTEXT_PACKAGE_MESSAGE } from "./output-context-package-policy.ts";
import { inspectOutputRequirement, isOutputContextType, parseOutputRequirement } from "../src/model/output-requirements.ts";
import type { WorkerEnv } from "./runtime.ts";

export type OutputAuthoringEvent = { type?: string; payload?: Record<string, unknown>; compensatesEventId?: string | null };
export type OutputAuthoringBlock = { id: string; type: string; properties: Record<string, unknown>; position?: string };
export type OutputAuthoringGuardResult<T extends OutputAuthoringEvent> =
  | { ok: true; events: T[] }
  | { ok: false; status: 400 | 409; error: string; index: number; blockId?: string; message: string };

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const influenceProperties = new Set(["weight", "influence", "intent", "effect"]);
// output_palette is an established generated-image-as-input field and is unrelated to requirements.
const serverOwnedProperty = (key: string) => /^(?:output_(?:plan|preflight|grant|slot|acceptance|fulfillment|execution|result|asset|delivery|status|confirmed|revision)(?:_|$)|grant_|acceptance_|fulfillment_|execution_)/u.test(key);

/** Assert the validated source head inside the append transaction; a zero-row write is not rollback. */
export function outputRequirementHeadGuard(env: WorkerEnv, streamId: string, expectedHead: number) {
  if (!streamId || !Number.isSafeInteger(expectedHead) || expectedHead < 0) throw new Error("output_requirement_source_head_required");
  return env.DB.prepare(`SELECT CASE WHEN (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
    THEN 1 ELSE json('output requirement context changed') END AS output_requirement_head_guard`).bind(streamId, expectedHead);
}

/** Guard all authorized history, including removed blocks and non-current Documents/projects. */
export function outputAuthoringBlocksFromEvents(events: readonly OutputAuthoringEvent[]): OutputAuthoringBlock[] {
  const blocks = new Map<string, OutputAuthoringBlock>();
  for (const event of events) {
    const payload = record(event.payload) ? event.payload : {}, id = String(payload.block_id ?? "");
    if (event.type === "BlockCreated" && id) blocks.set(id, { id, type: String(payload.type ?? "text"), position: String(payload.position ?? "a0"), properties: record(payload.properties) ? { ...payload.properties } : {} });
    const block = blocks.get(id);
    if (!block) continue;
    if (event.type === "BlockPropertyEdited") {
      const path = String(payload.property_path ?? "");
      if (path === "type") block.type = String(payload.new_value ?? block.type);
      else if (path === "position") block.position = String(payload.new_value ?? block.position);
      else if (path) block.properties[path] = payload.new_value;
    }
  }
  return [...blocks.values()];
}

export function outputRequirementChatNotice(locale: unknown, existingRequirementUnchanged: boolean) {
  const language = String(locale ?? "en").split("-")[0];
  const notices: Record<string, readonly [string, string]> = {
    en: ["Output requirements added through chat are drafts. Review and confirm them in the Output card. No output generation or live preview was started.", "Existing Output requirements were not changed. Open their Output card to review and save your proposed changes against the current revision. No output generation or live preview was started."],
    fr: ["Les exigences de sortie ajoutées dans la conversation sont des brouillons. Vérifiez-les et confirmez-les dans la carte Sortie. Aucune génération ni prévisualisation n’a été lancée.", "Les exigences de sortie existantes n’ont pas été modifiées. Ouvrez leur carte Sortie pour vérifier et enregistrer vos modifications à partir de la version actuelle. Aucune génération ni prévisualisation n’a été lancée."],
    ar: ["متطلبات المخرجات المضافة عبر المحادثة هي مسودات. راجعها وأكدها في بطاقة المخرجات. لم يبدأ إنشاء أي مخرجات أو معاينة مباشرة.", "لم تُغيَّر متطلبات المخرجات الحالية. افتح بطاقة المخرجات لمراجعة التغييرات المقترحة وحفظها وفق الإصدار الحالي. لم يبدأ إنشاء أي مخرجات أو معاينة مباشرة."],
    ja: ["チャットから追加した出力要件は下書きです。出力カードで内容を確認して確定してください。出力の生成やライブプレビューは開始していません。", "既存の出力要件は変更していません。出力カードを開き、現在の版に対して変更案を確認・保存してください。出力の生成やライブプレビューは開始していません。"],
  };
  return (notices[language] ?? notices.en)![existingRequirementUnchanged ? 1 : 0];
}

/** New prose/imports become drafts only. Unknown versions stay opaque, inspectable and non-executable. */
export function normalizeOutputRequirementCreation(payload: Record<string, unknown>): Record<string, unknown> {
  if (!isOutputContextType(payload.type)) return payload;
  const properties = record(payload.properties) ? { ...payload.properties } : {};
  for (const key of influenceProperties) delete properties[key];
  if (!Object.hasOwn(properties, "output_spec")) {
    const parsed = parseOutputRequirement({
      id: String(payload.block_id ?? ""), type: "output", content: typeof properties.text === "string" ? properties.text : "",
      subtype: typeof properties.subtype === "string" ? properties.subtype : "Custom deliverables",
    });
    if (parsed.spec) properties.output_spec = parsed.spec;
  }
  // Do not normalize an unsupported schema into schema 1 or fabricate confirmation/approval.
  return { ...payload, type: "output", properties };
}

/**
 * Generic append, canvas replay and chat cannot replace a saved requirement contract.
 * Dedicated commands compare the exact authored revision and preserve a conflicting draft.
 * This guard has no provider, storage or job dependency and must run before any append.
 */
export function prepareOutputRequirementClientEvents<T extends OutputAuthoringEvent>(
  input: readonly T[], savedBlocks: readonly OutputAuthoringBlock[],
): OutputAuthoringGuardResult<T> {
  const blocks = new Map(savedBlocks.map((block) => [block.id, { ...block, properties: { ...block.properties } }]));
  const events: T[] = [];
  const reject = (index: number, blockId: string, error = "output_requirement_endpoint_required", status: 400 | 409 = 409): OutputAuthoringGuardResult<T> => ({
    ok: false, status, error, index, ...(blockId ? { blockId } : {}),
    message: error === "output_context_package_unsupported" ? OUTPUT_CONTEXT_PACKAGE_MESSAGE : error === "output_requirement_status_server_owned"
      ? "Output plans, authorization and acceptance can only be changed through their dedicated commands."
      : "Open the Output requirements editor to review and save this change against its current revision. Your draft was not saved.",
  });
  for (const [index, item] of input.entries()) {
    const payload = record(item.payload) ? item.payload : {};
    const type = String(item.type ?? ""), id = String(payload.block_id ?? "");
    const block = blocks.get(id);
    // OutputRenamed names an existing produced result, not an Output requirement.
    if (type.startsWith("Output") && type !== "OutputRenamed") return reject(index, id, "output_requirement_status_server_owned", 400);
    if (type === "BlockCreated") {
      const properties = record(payload.properties) ? payload.properties : {};
      if (Object.keys(properties).some(serverOwnedProperty)) return reject(index, id, "output_requirement_status_server_owned", 400);
      const output = isOutputContextType(payload.type);
      if ((output || Object.hasOwn(properties,"output_spec")) && hasOutputPackageProvenance(properties)) return reject(index,id,"output_context_package_unsupported",409);
      if (block && (output || isOutputContextType(block.type) || Object.hasOwn(properties, "output_spec"))) return reject(index, id);
      if (!output && Object.hasOwn(properties, "output_spec")) return reject(index, id, "output_requirement_type_required", 400);
      const next = output ? normalizeOutputRequirementCreation(payload) : payload;
      if (output && record(next.properties) && Object.hasOwn(next.properties, "output_spec")) {
        const inspection = inspectOutputRequirement(next.properties.output_spec);
        if (inspection.status === "valid" && inspection.spec!.id !== id) return reject(index, id, "output_requirement_identity_mismatch", 400);
      }
      events.push({ ...item, payload: next });
      blocks.set(id, { id, type: String(next.type ?? "text"), position: String(next.position ?? "a0"), properties: record(next.properties) ? { ...next.properties } : {} });
      continue;
    }
    const property = type === "ChipEdited" ? String(payload.property ?? "value") : String(payload.property_path ?? "");
    if ((type === "BlockPropertyEdited" || type === "ChipEdited")
      && (property === "output_spec" || serverOwnedProperty(property))) return reject(index, id);
    if (type === "BlockPropertyEdited" && property === "type" && (isOutputContextType(payload.new_value) || isOutputContextType(block?.type))) return reject(index, id);
    if (isOutputContextType(block?.type)) {
      if (["BlockRemoved", "BlockRestored", "BlockRehomed", "BlockRenamed", "BlockWeightSet", "ChipEdited", "ExtractionRequested"].includes(type)) return reject(index, id);
      if (type === "BlockPropertyEdited") {
        if (property !== "position") return reject(index, id);
        if (!Object.hasOwn(payload, "old_value") || payload.old_value !== block?.position) return reject(index, id, "output_requirement_position_conflict");
      }
    }
    events.push({ ...item, payload });
    // Keep later events in the same request from evading the guard through a prior type change.
    if (block && type === "BlockPropertyEdited" && property === "type") block.type = String(payload.new_value ?? block.type);
    if (block && type === "BlockPropertyEdited" && property === "position") block.position = String(payload.new_value ?? block.position);
  }
  return { ok: true, events };
}
