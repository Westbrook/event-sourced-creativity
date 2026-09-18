import type { WorkerEnv } from './runtime.ts';
import { requireUser } from './pilot-policy.ts';
import { PANEL_TTL_MS, PANEL_LEASE_MS, panelHash, validPanelCommand, validPanelId, validPanelToken } from '../src/still/remote-protocol.ts';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'private, no-store'}});
export async function sweepStillPanels(env:WorkerEnv){
  await env.DB.batch([
    env.DB.prepare('DELETE FROM still_panel_commands WHERE session_id IN (SELECT id FROM still_panel_sessions WHERE expires_at<=?)').bind(Date.now()),
    env.DB.prepare('DELETE FROM still_panel_sessions WHERE expires_at<=?').bind(Date.now()),
  ]);
}
/** A panel capability delegates inspection and three UI settings, never the owner's identity. */
export const handleStillPanel=createStillPanelHandler(requireUser);
export function createStillPanelHandler(authorize:typeof requireUser){return async function(request:Request,env:WorkerEnv){
  const url=new URL(request.url),origin=request.headers.get('origin');
  if(origin&&origin!==url.origin)return reply({error:'same_origin_required'},403);
  const auth=await authorize(request,env,'viewer',{account:'principal'});
  if(auth.response||!auth.user)return auth.response??reply({error:'authentication_required'},401);
  const userId=auth.user.userId,parts=url.pathname.slice('/api/still/panel'.length).split('/').filter(Boolean);
  const now=Date.now();
  let body:Record<string,unknown>={};
  if(request.method==='POST'||request.method==='PUT'){
    if(Number(request.headers.get('content-length')??0)>1_850_000)return reply({error:'panel_snapshot_too_large'},413);
    const text=await request.text();if(text.length>1_850_000)return reply({error:'panel_snapshot_too_large'},413);
    try{body=JSON.parse(text);}catch{return reply({error:'invalid_request'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'invalid_request'},400);
  }
  if(parts.length===0&&request.method==='POST'){
    await sweepStillPanels(env);
    const token=String(body.token??'');if(!validPanelToken(token))return reply({error:'invalid_token'},400);
    const count=await env.DB.prepare('SELECT count(*) AS n FROM still_panel_sessions WHERE owner_id=?').bind(userId).first<{n:number}>();
    if((count?.n??0)>=5)return reply({error:'too_many_shared_panels'},429);
    const id=crypto.randomUUID(),expiresAt=now+PANEL_TTL_MS;
    await env.DB.prepare('INSERT INTO still_panel_sessions(id,owner_id,token_hash,expires_at,heartbeat,scope,revision) VALUES(?,?,?,?,?,?,0)').bind(id,userId,await panelHash(token),expiresAt,now,'').run();
    return reply({id,expiresAt},201);
  }
  const [id,operation]=parts;if(!id||!validPanelId(id)||parts.length>2)return reply({error:'not_found'},404);
  const row=await env.DB.prepare('SELECT owner_id,token_hash,expires_at,heartbeat,scope,revision FROM still_panel_sessions WHERE id=? AND expires_at>?').bind(id,now).first<{owner_id:string;token_hash:string;expires_at:number;heartbeat:number;scope:string;revision:number}>();
  if(!row)return reply({error:'panel_expired'},410);
  if(!operation){
    if(row.owner_id!==userId)return reply({error:'owner_required'},403);
    if(request.method==='DELETE'){
      await env.DB.batch([env.DB.prepare('DELETE FROM still_panel_commands WHERE session_id=?').bind(id),env.DB.prepare('DELETE FROM still_panel_sessions WHERE id=? AND owner_id=?').bind(id,userId)]);return reply({ended:true});
    }
    if(request.method!=='PUT')return reply({error:'method_not_allowed'},405);
    const scope=String(body.scope??''),payload=body.payload;
    if(!/^[a-f0-9]{64}$/.test(scope)||payload!==undefined&&(typeof payload!=='string'||payload.length>1_800_000||!/^[A-Za-z0-9+/=]+$/.test(payload)))return reply({error:'invalid_snapshot'},400);
    if(scope!==row.scope&&payload===undefined)return reply({error:'snapshot_required'},400);
    const ack=Number(body.ack??0);if(!Number.isSafeInteger(ack)||ack<0)return reply({error:'invalid_ack'},400);
    await env.DB.batch([
      env.DB.prepare('UPDATE still_panel_sessions SET heartbeat=?,scope=?,payload=COALESCE(?,payload),revision=revision+? WHERE id=? AND owner_id=? AND expires_at>?').bind(now,scope,payload??null,payload?1:0,id,userId,now),
      env.DB.prepare('DELETE FROM still_panel_commands WHERE session_id=? AND (seq<=? OR scope<>?)').bind(id,ack,scope),
    ]);
    const commands=await env.DB.prepare('SELECT seq,type,value,scope FROM still_panel_commands WHERE session_id=? AND scope=? AND created_at>? ORDER BY seq LIMIT 30').bind(id,scope,now-PANEL_LEASE_MS).all();
    return reply({commands:commands.results,expiresAt:row.expires_at});
  }
  const token=request.headers.get('x-still-panel-token')??'';
  if(!validPanelToken(token)||await panelHash(token)!==row.token_hash)return reply({error:'panel_access_required'},403);
  if(operation==='view'&&request.method==='GET'){
    if(now-row.heartbeat>PANEL_LEASE_MS)return reply({error:'host_offline'},409);
    const after=Number(url.searchParams.get('after')??0);
    const data=await env.DB.prepare('SELECT revision,CASE WHEN revision>? THEN payload ELSE NULL END AS payload FROM still_panel_sessions WHERE id=? AND expires_at>?').bind(Number.isSafeInteger(after)?after:0,id,now).first();
    return reply({...data,expiresAt:row.expires_at,heartbeat:row.heartbeat});
  }
  if(operation==='command'&&request.method==='POST'){
    if(now-row.heartbeat>PANEL_LEASE_MS)return reply({error:'host_offline'},409);
    if(!validPanelCommand(body)||body.scope!==row.scope)return reply({error:'view_changed'},409);
    // Coalesce settings of the same kind; never enqueue arbitrary application actions.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM still_panel_commands WHERE session_id=? AND type=?').bind(id,body.type),
      env.DB.prepare('INSERT INTO still_panel_commands(session_id,type,value,scope,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM still_panel_sessions WHERE id=? AND expires_at>? AND scope=?)').bind(id,body.type,JSON.stringify(body.value),body.scope,now,id,now,body.scope),
    ]);
    return reply({queued:true});
  }
  return reply({error:'not_found'},404);
};}
