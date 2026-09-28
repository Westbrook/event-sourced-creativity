// Fixed read-only diagnostic. Never used to admit Start or change its catalog guard.
export const CATALOG_VERSION = 'p5-catalog-r8';
export const CATALOG_LIMITS = Object.freeze({ objects: 256, nameBytes: 256, sqlBytes: 32768, responseBytes: 262144 });
// CASE bounds values before they leave D1. Byte lengths retain overflow evidence.
// Include named platform bookkeeping definitions; never read bookkeeping rows.
export const CATALOG_SQL = `SELECT
 CASE WHEN length(CAST(type AS BLOB))<=16 THEN type ELSE NULL END AS type,
 CASE WHEN length(CAST(name AS BLOB))<=256 THEN name ELSE NULL END AS name,
 CASE WHEN length(CAST(tbl_name AS BLOB))<=256 THEN tbl_name ELSE NULL END AS tbl_name,
 CASE WHEN length(CAST(sql AS BLOB))<=32768 THEN sql ELSE NULL END AS sql,
 length(CAST(sql AS BLOB)) AS sql_bytes
 FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
 ORDER BY name LIMIT 257`;
export function boundedCatalog(rows) {
 if (!Array.isArray(rows) || rows.length > CATALOG_LIMITS.objects) throw Error('catalog_object_bound');
 const catalog = rows.map(r => {
  if (!['table','index','trigger','view'].includes(r.type) || typeof r.name !== 'string' || typeof r.tbl_name !== 'string' || typeof r.sql !== 'string' || !Number.isInteger(r.sql_bytes) || r.sql_bytes < 0 || r.sql_bytes > CATALOG_LIMITS.sqlBytes) throw Error('catalog_definition_bound');
  if (new TextEncoder().encode(r.name).length > 256 || new TextEncoder().encode(r.tbl_name).length > 256 || new TextEncoder().encode(r.sql).length !== r.sql_bytes) throw Error('catalog_definition_bound');
  return { type:r.type, name:r.name, tbl_name:r.tbl_name, sql:r.sql };
 });
 return catalog;
}
export function boundedCatalogResponse(body, headers) {
 const text=JSON.stringify(body);
 if (new TextEncoder().encode(text).length > CATALOG_LIMITS.responseBytes) throw Error('catalog_response_bound');
 return new Response(text,{headers:{...headers,'content-type':'application/json'}});
}
// Offline comparison only; never normalize SQL or authorize execution from a diff.
export function compareCatalog(expected, observed) {
 const map=rows=>{const m=new Map();for(const r of rows){if(m.has(r.name))throw Error('duplicate_catalog_name');m.set(r.name,r);}return m;};
 const e=map(expected),o=map(observed);
 return {missing:[...e.keys()].filter(k=>!o.has(k)).sort().map(k=>e.get(k)),extra:[...o.keys()].filter(k=>!e.has(k)).sort().map(k=>o.get(k)),changed:[...e.keys()].filter(k=>o.has(k)).sort().flatMap(name=>{const fields={};for(const f of ['type','tbl_name','sql'])if(e.get(name)[f]!==o.get(name)[f])fields[f]={expected:e.get(name)[f],observed:o.get(name)[f]};return Object.keys(fields).length?[{name,fields}]:[];})};
}
