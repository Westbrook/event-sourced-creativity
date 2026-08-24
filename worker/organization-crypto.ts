import { uuidV7, type WorkerEnv } from "./runtime.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function decode(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export class OrganizationCryptoUnavailable extends Error {
  constructor(message = "organization_encryption_root_unavailable") { super(message); }
}

type RootMaterial={version:string|null;bytes:Uint8Array};
function decodeRoot(raw:string):Uint8Array{
  let bytes: Uint8Array;
  try {
    bytes = /^[a-f0-9]{64}$/i.test(raw)
      ? Uint8Array.from(raw.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16))
      : decode(raw);
  } catch { throw new OrganizationCryptoUnavailable("organization_encryption_root_invalid"); }
  if (bytes.byteLength !== 32) throw new OrganizationCryptoUnavailable("organization_encryption_root_invalid");
  return bytes;
}

function rootMaterials(env:WorkerEnv):{active:RootMaterial;all:RootMaterial[]}{
  const configured=env.FORMA_ENCRYPTION_ROOT_KEYS?.trim()??"";
  if(!configured){
    if(env.FORMA_ENCRYPTION_ROOT_KEY_VERSION?.trim())throw new OrganizationCryptoUnavailable("organization_encryption_root_invalid");
    const raw=env.FORMA_ENCRYPTION_ROOT_KEY?.trim()??"";
    if(!raw)throw new OrganizationCryptoUnavailable();
    const active={version:null,bytes:decodeRoot(raw)};
    return{active,all:[active]};
  }
  let parsed:unknown;
  try{parsed=JSON.parse(configured);}catch{throw new OrganizationCryptoUnavailable("organization_encryption_root_invalid");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new OrganizationCryptoUnavailable("organization_encryption_root_invalid");
  const entries=Object.entries(parsed as Record<string,unknown>);
  if(!entries.length||entries.length>16)throw new OrganizationCryptoUnavailable("organization_encryption_root_invalid");
  const all:RootMaterial[]=entries.map(([version,value])=>{
    if(!/^[a-z][a-z0-9_-]{0,31}$/.test(version)||typeof value!=="string"||!value.trim())throw new OrganizationCryptoUnavailable("organization_encryption_root_invalid");
    return{version,bytes:decodeRoot(value.trim())};
  });
  const chosen=env.FORMA_ENCRYPTION_ROOT_KEY_VERSION?.trim()??"";
  const active=all.find((entry)=>entry.version===chosen);
  if(!active)throw new OrganizationCryptoUnavailable("organization_encryption_root_invalid");
  const legacy=env.FORMA_ENCRYPTION_ROOT_KEY?.trim()??"";
  if(legacy){
    const bytes=decodeRoot(legacy);
    if(!all.some((entry)=>entry.bytes.every((value,index)=>value===bytes[index])))all.push({version:null,bytes});
  }
  return{active,all};
}

async function importRoot(material:RootMaterial){
  return crypto.subtle.importKey("raw",material.bytes as Uint8Array<ArrayBuffer>,"AES-GCM",false,["encrypt","decrypt"]);
}

async function encryptBytes(key: CryptoKey, bytes: Uint8Array, associatedData: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(associatedData), tagLength: 128 }, key, bytes as Uint8Array<ArrayBuffer>));
  return JSON.stringify({ schema: 1, iv: encode(iv), ciphertext: encode(ciphertext) });
}

async function decryptBytes(key: CryptoKey, envelope: string, associatedData: string) {
  let parsed: { schema?: unknown; iv?: unknown; ciphertext?: unknown };
  try { parsed = JSON.parse(envelope) as typeof parsed; } catch { throw new OrganizationCryptoUnavailable("organization_encrypted_payload_invalid"); }
  if (parsed.schema !== 1 || typeof parsed.iv !== "string" || typeof parsed.ciphertext !== "string") throw new OrganizationCryptoUnavailable("organization_encrypted_payload_invalid");
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(parsed.iv), additionalData: encoder.encode(associatedData), tagLength: 128 }, key, decode(parsed.ciphertext)));
  } catch { throw new OrganizationCryptoUnavailable("organization_encrypted_payload_integrity_failed"); }
}

async function unwrapOrganizationKey(env: WorkerEnv, organizationId: string, keyId: string) {
  const key = await env.DB.prepare("SELECT wrapped_key,status FROM organization_key_versions WHERE organization_id=? AND key_id=? AND status IN('active','retired')")
    .bind(organizationId, keyId).first<{ wrapped_key: string; status: string }>();
  if (!key) throw new OrganizationCryptoUnavailable("organization_encryption_key_unavailable");
  let envelope:{wrapping_root_version?:unknown};
  try{envelope=JSON.parse(key.wrapped_key) as typeof envelope;}catch{throw new OrganizationCryptoUnavailable("organization_encrypted_payload_invalid");}
  const roots=rootMaterials(env);
  const named=envelope.wrapping_root_version;
  const candidates=named===undefined?roots.all:[roots.all.find((root)=>root.version===named)].filter((root):root is RootMaterial=>Boolean(root));
  if(named!==undefined&&(typeof named!=="string"||!candidates.length))throw new OrganizationCryptoUnavailable("organization_encryption_root_unavailable");
  let plain:Uint8Array|null=null;
  for(const material of candidates){
    try{
      const associated=`forma:tenant-data-key:${organizationId}:${keyId}${named===undefined?"":`:root:${String(named)}`}`;
      plain=await decryptBytes(await importRoot(material),key.wrapped_key,associated);
      break;
    }catch{if(named!==undefined)break;}
  }
  if(!plain)throw new OrganizationCryptoUnavailable("organization_encrypted_payload_integrity_failed");
  if (plain.byteLength !== 32) throw new OrganizationCryptoUnavailable("organization_encryption_key_invalid");
  return crypto.subtle.importKey("raw", plain as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Persist only an AEAD-wrapped tenant key; its wrapping root remains outside D1. */
export async function ensureOrganizationKey(env: WorkerEnv, organizationId: string, rotate = false) {
  const existing = await env.DB.prepare("SELECT key_id,version FROM organization_key_versions WHERE organization_id=? AND status='active' ORDER BY version DESC LIMIT 1")
    .bind(organizationId).first<{ key_id: string; version: number }>();
  if (existing && !rotate) return { keyId: existing.key_id, version: existing.version };
  if(existing&&rotate){
    await unwrapOrganizationKey(env,organizationId,existing.key_id);
    const recoverable=await env.DB.prepare("SELECT DISTINCT key_id FROM organization_recovery_snapshots WHERE organization_id=? AND status='available'")
      .bind(organizationId).all<{key_id:string}>();
    for(const snapshot of recoverable.results)if(snapshot.key_id!==existing.key_id)await unwrapOrganizationKey(env,organizationId,snapshot.key_id);
  }
  const material=rootMaterials(env).active;
  const root=await importRoot(material);
  const id = uuidV7();
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const wrappedBase=await encryptBytes(root,raw,`forma:tenant-data-key:${organizationId}:${id}${material.version?`:root:${material.version}`:""}`);
  const wrapped=material.version?JSON.stringify({...JSON.parse(wrappedBase) as Record<string,unknown>,wrapping_root_version:material.version}):wrappedBase;
  const now = new Date().toISOString();
  const previous = await env.DB.prepare("SELECT COALESCE(MAX(version),0) AS latest FROM organization_key_versions WHERE organization_id=?").bind(organizationId).first<{ latest: number }>();
  const version = Number(previous?.latest ?? 0) + 1;
  const statements: D1PreparedStatement[] = [];
  const tenantActive=`EXISTS(SELECT 1 FROM organizations governed JOIN organization_memberships owner
      ON owner.organization_id=governed.organization_id AND owner.user_id=governed.owner_user_id
        AND owner.role='owner' AND owner.status='active' AND owner.accepted_at IS NOT NULL AND owner.revoked_at IS NULL
      WHERE governed.organization_id=? AND governed.status='active')
    AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs removal
      WHERE removal.organization_id=? AND removal.status IN('pending','processing','partial','completed'))`;
  if (existing && rotate) statements.push(env.DB.prepare(`UPDATE organization_key_versions SET status='retired',retired_at=?
    WHERE organization_id=? AND key_id=? AND status='active' AND ${tenantActive}`)
    .bind(now, organizationId, existing.key_id,organizationId,organizationId));
  const retiring=existing&&rotate?existing.key_id:"";
  statements.push(env.DB.prepare(`INSERT INTO organization_key_versions(key_id,organization_id,version,algorithm,wrapped_key,status,created_at,retired_at)
    SELECT ?,?,?,'AES-GCM-256',?,'active',?,NULL WHERE
      ((?='' AND NOT EXISTS(SELECT 1 FROM organization_key_versions live WHERE live.organization_id=? AND live.status='active'))
      OR(?<>'' AND EXISTS(SELECT 1 FROM organization_key_versions old
        WHERE old.organization_id=? AND old.key_id=? AND old.status='retired' AND old.retired_at=?)))
      AND ${tenantActive}`)
    .bind(id,organizationId,version,wrapped,now,retiring,organizationId,retiring,organizationId,retiring,now,organizationId,organizationId));
  try {
    const results=await env.DB.batch(statements);
    if(results.some((result)=>Number(result.meta.changes??0)!==1))throw new OrganizationCryptoUnavailable("organization_encryption_key_conflict");
  }
  catch {
    if (!rotate) {
      const winner = await env.DB.prepare("SELECT key_id,version FROM organization_key_versions WHERE organization_id=? AND status='active' ORDER BY version DESC LIMIT 1")
        .bind(organizationId).first<{ key_id: string; version: number }>();
      if (winner) return { keyId: winner.key_id, version: winner.version };
    }
    throw new OrganizationCryptoUnavailable("organization_encryption_key_conflict");
  }
  return { keyId: id, version };
}

/** Associated tenant and resource identities prevent cross-organization ciphertext substitution. */
export async function sealOrganizationPayload(env: WorkerEnv, organizationId: string, resourceId: string, plain: string) {
  const active = await ensureOrganizationKey(env, organizationId);
  const key = await unwrapOrganizationKey(env, organizationId, active.keyId);
  const ciphertext = await encryptBytes(key, encoder.encode(plain), `forma:tenant-payload:${organizationId}:${resourceId}:${active.keyId}`);
  return { keyId: active.keyId, ciphertext };
}

export async function openOrganizationPayload(env: WorkerEnv, organizationId: string, resourceId: string, keyId: string, ciphertext: string) {
  const key = await unwrapOrganizationKey(env, organizationId, keyId);
  const plain = await decryptBytes(key, ciphertext, `forma:tenant-payload:${organizationId}:${resourceId}:${keyId}`);
  return decoder.decode(plain);
}

export const organizationEncryptionConfigured = (env: WorkerEnv) => {
  try{return Boolean(rootMaterials(env).active);}catch{return false;}
};
