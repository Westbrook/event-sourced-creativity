import type { WorkerEnv } from './runtime.ts';
import type { MemoryDerivationFinanceView } from '../src/model/memory-derivation-policy.ts';
import { derivationExact, derivationInteger, derivationTime } from './memory-derivation-policy.ts';

/** Aggregate only the authenticated payer's own allowance. No source, document,
 * organization, grant, request or other payer identifiers leave this reader.
 * Include this SELECT in the controls' same identity/schema-guarded read batch. */
export function memoryDerivationFinanceViewStatement(env:WorkerEnv,payerId:string){
  return env.DB.prepare(`WITH clock AS (SELECT strftime('%Y-%m','now') AS period,strftime('%Y-%m-%dT%H:%M:%fZ','now') AS at),
    accepted AS (SELECT cap_microusd AS cap FROM memory_derivation_month_caps WHERE payer_id=? AND period=(SELECT period FROM clock)
      UNION ALL SELECT monthly_cap_microusd FROM memory_derivation_grants WHERE actor_user_id=? AND
        (substr(consented_at,1,7)=(SELECT period FROM clock) OR revoked_at IS NULL AND background_enabled=1 AND expires_at>(SELECT at FROM clock))
      UNION ALL SELECT authorized_cap_microusd FROM memory_derivation_finance WHERE payer_id=? AND period=(SELECT period FROM clock)),
    amounts AS (SELECT COALESCE(SUM(COALESCE(usage.used_microusd,0)),0) AS used,
      COALESCE(SUM(CASE WHEN usage.finance_id IS NULL AND unused.finance_id IS NULL THEN f.maximum_microusd ELSE 0 END),0) AS reserved
      FROM memory_derivation_finance f LEFT JOIN memory_derivation_usage usage ON usage.finance_id=f.finance_id
      LEFT JOIN memory_derivation_no_dispatch unused ON unused.finance_id=f.finance_id WHERE f.payer_id=? AND f.period=(SELECT period FROM clock))
    SELECT clock.period,clock.at AS checked_at,(SELECT MIN(cap) FROM accepted) AS cap,amounts.used,amounts.reserved FROM clock,amounts`).bind(payerId,payerId,payerId,payerId);
}
export function memoryDerivationFinanceView(value:unknown):MemoryDerivationFinanceView{
  if(!derivationExact(value,['period','checked_at','cap','used','reserved'])||!derivationTime(value.checked_at)
    ||value.period!==value.checked_at.slice(0,7)||!(value.cap===null||derivationInteger(value.cap,1,1000000000))
    ||!derivationInteger(value.used)||!derivationInteger(value.reserved)||!Number.isSafeInteger(value.used+value.reserved))throw Error('memory-finance-view-unavailable');
  return {period:String(value.period),checkedAt:value.checked_at,capMicroUsd:value.cap,usedMicroUsd:value.used,reservedMicroUsd:value.reserved,
    remainingMicroUsd:value.cap===null?null:Math.max(0,value.cap-value.used-value.reserved),retention:'independent-of-memory-erasure'};
}
