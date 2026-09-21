export const PANEL_TTL_MS=60*60*1000;
export const PANEL_LEASE_MS=30_000;
export const PANEL_POLL_MS=2_000;
export type PanelCommand={type:'flags'|'remember-lists'|'next-best'|'density'|'visibility';value:boolean|number;scope:string};
export function validPanelCommand(value:unknown):value is PanelCommand{
  if(!value||typeof value!=='object')return false;
  const c=value as PanelCommand;
  return typeof c.scope==='string'&&/^[a-f0-9]{64}$/.test(c.scope)&&
    (c.type==='density'?Number.isInteger(c.value)&&Number(c.value)>=1&&Number(c.value)<=7:
      (c.type==='remember-lists'||c.type==='flags'||c.type==='next-best'||c.type==='visibility')&&typeof c.value==='boolean');
}
export const validPanelId=(value:string)=>/^[a-f0-9-]{36}$/.test(value);
export const validPanelToken=(value:string)=>/^[a-f0-9]{64}$/.test(value);
export async function panelHash(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
