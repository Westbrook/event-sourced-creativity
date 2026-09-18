/** Measurements include real button labels, badge widths, gaps and toolbar padding. */
export function fitToolbarLimit(measurements:{limit:number;width:number}[],available:number,maximum:number,previous?:number):number {
  const upper=Math.max(1,Math.min(7,maximum));
  // Leave a little slack when adding controls so rounding/font changes cannot oscillate.
  const candidates=measurements.filter(m=>m.limit<=upper&&Number.isFinite(m.width)&&m.width<=available-(previous!==undefined&&m.limit>previous?12:2));
  return Math.max(1,...candidates.map(m=>m.limit));
}
