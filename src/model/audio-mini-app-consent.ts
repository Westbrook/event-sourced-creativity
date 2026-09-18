/** Exact original Audio transfer/cost terms, not permission minted by parsing. */
export type AudioMiniAppCostPreview = Readonly<{
  version: "audio-mini-app-cost-v1"; requestId: string; actorUserId: string; projectId: string; documentId: string;
  draftId: string; sourceDigest: string; requirementsDigest: string; expiresAt: string;
  maximumMicrousd: number; maximumCalls: 3; maximumTokens: 128000;
  planningModel: "gpt-5.6-terra"; maximumPlanningCalls: 2; maximumOutputTokens: 3000;
  audioModel: "fal-ai/stable-audio-3/medium/text-to-audio"; maximumAudioCalls: 1;
  durationSeconds: 20; requireInstrumental: true; sourceFilesTransferred: 0;
}>;
const keys = ["version","requestId","actorUserId","projectId","documentId","draftId","sourceDigest","requirementsDigest","expiresAt","maximumMicrousd","maximumCalls","maximumTokens","planningModel","maximumPlanningCalls","maximumOutputTokens","audioModel","maximumAudioCalls","durationSeconds","requireInstrumental","sourceFilesTransferred"] as const;
function closed(value: unknown, expected: readonly string[]): value is Record<string,unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length===expected.length && expected.every(key=>descriptors[key]?.enumerable && "value" in descriptors[key]);
}
export function parseAudioMiniAppCostPreview(value: unknown): AudioMiniAppCostPreview|null {
  if (!closed(value,keys) || value.version!=="audio-mini-app-cost-v1"
    || !["actorUserId","projectId","documentId"].every(key=>typeof value[key]==="string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value[key] as string))
    || typeof value.requestId!=="string" || !/^audio-[a-f0-9]{64}$/u.test(value.requestId)
    || typeof value.draftId!=="string" || !/^experience-draft-[a-f0-9]{64}$/u.test(value.draftId)
    || !["sourceDigest","requirementsDigest"].every(key=>typeof value[key]==="string" && /^[a-f0-9]{64}$/u.test(value[key] as string))
    || typeof value.expiresAt!=="string" || !Number.isFinite(Date.parse(value.expiresAt)) || new Date(value.expiresAt).toISOString()!==value.expiresAt
    || !Number.isSafeInteger(value.maximumMicrousd) || Number(value.maximumMicrousd)<=0 || Number(value.maximumMicrousd)>2_000_000
    || value.maximumCalls!==3 || value.maximumTokens!==128000 || value.planningModel!=="gpt-5.6-terra" || value.maximumPlanningCalls!==2 || value.maximumOutputTokens!==3000
    || value.audioModel!=="fal-ai/stable-audio-3/medium/text-to-audio" || value.maximumAudioCalls!==1 || value.durationSeconds!==20 || value.requireInstrumental!==true || value.sourceFilesTransferred!==0) return null;
  return Object.freeze(Object.fromEntries(keys.map(key=>[key,value[key]]))) as AudioMiniAppCostPreview;
}
export function audioMiniAppCostApprovalMatches(value: unknown, expected: unknown, now=Date.now()): boolean {
  const preview=parseAudioMiniAppCostPreview(expected);
  return Boolean(preview && Number.isFinite(now) && Date.parse(preview.expiresAt)>now && closed(value,[...keys,"confirmed","providerTransferConfirmed"])
    && value.confirmed===true && value.providerTransferConfirmed===true && keys.every(key=>value[key]===preview[key]));
}
