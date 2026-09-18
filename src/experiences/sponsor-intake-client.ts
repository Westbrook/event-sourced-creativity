import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import type { CompiledRelease } from "./contracts.ts";
import { isDraftId, isIntentId, type IntakeRequest } from "./intake.ts";
import { ExperienceIntakeRuntime, type SponsorImageIntakeBinding } from "./intake-runtime.ts";

export type SponsorImageIntakeCommand =
  | Readonly<{ action: "prepare-sponsored-image-draft"; campaignId: string; request: IntakeRequest }>
  | Readonly<{ action: "commit-sponsored-image-draft"; campaignId: string; draftId: string; draftHash: string }>
  | Readonly<{ action: "read-experience-draft"; draftId: string }>
  | Readonly<{ action: "read-experience-draft"; intentId: string }>
  | Readonly<{ action: "read-experience-intake-receipt"; draftId: string }>;
export type SponsorImageIntakeTransport = (command: SponsorImageIntakeCommand, options: Readonly<{ signal: AbortSignal }>) => Promise<Response>;
const fail = (): never => { throw new Error("sponsor_intake_client_transport_invalid"); };

/** Explicit internal composition only. There is no default transport, endpoint
 * registration or new server authority. Native response bytes are not rewritten. */
export function createSponsorImageIntakeRuntime(release: CompiledRelease, binding: SponsorImageIntakeBinding, transport: SponsorImageIntakeTransport) {
  if (typeof transport !== "function" || jsonIssues(binding).length || !record(binding)
    || !exactKeys(binding, ["version", "campaignId", "actorUserId"])) return fail();
  const expected = freeze(structuredClone(binding)), send = transport;
  const runtime = new ExperienceIntakeRuntime(release, async (path, init) => {
    if (!init?.signal) return fail();
    let command: SponsorImageIntakeCommand;
    if (init.method === "POST") {
      if (typeof init.body !== "string") return fail();
      let body: unknown; try { body = JSON.parse(init.body); } catch { return fail(); }
      if (jsonIssues(body).length || !record(body)) return fail();
      if (path === "/api/experiences/drafts") {
        if (!exactKeys(body, ["intentId", "experienceId", "releaseHash", "values"]) || body.experienceId !== "image" || !isIntentId(body.intentId)) return fail();
        command = { action: "prepare-sponsored-image-draft", campaignId: expected.campaignId, request: body as IntakeRequest };
      } else {
        const match = /^\/api\/experiences\/drafts\/(experience-draft-[a-f0-9]{64})\/commit$/u.exec(path);
        if (!match || !exactKeys(body, ["draftHash"]) || typeof body.draftHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(body.draftHash)) return fail();
        command = { action: "commit-sponsored-image-draft", campaignId: expected.campaignId, draftId: match[1]!, draftHash: body.draftHash };
      }
    } else {
      if (init.method !== undefined || init.body !== undefined) return fail();
      const byIntent = /^\/api\/experiences\/drafts\?intentId=([^?&/]+)$/u.exec(path);
      const byDraft = /^\/api\/experiences\/drafts\/(experience-draft-[a-f0-9]{64})(\/receipt)?$/u.exec(path);
      if (byIntent && isIntentId(byIntent[1])) command = { action: "read-experience-draft", intentId: byIntent[1]! };
      else if (byDraft && isDraftId(byDraft[1]!)) command = byDraft[2]
        ? { action: "read-experience-intake-receipt", draftId: byDraft[1]! }
        : { action: "read-experience-draft", draftId: byDraft[1]! };
      else return fail();
    }
    return send(freeze(JSON.parse(canonicalJson(command)) as SponsorImageIntakeCommand), Object.freeze({ signal: init.signal }));
  }, expected);
  return runtime;
}
