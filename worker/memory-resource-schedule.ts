/** Next 01:00 in the user's zone, including DST/quarter-hour zones. No host
 * registration or delivery guarantee. A late invocation catches up once. */
export function nextResourceMemoryNight(now:string,timeZone:string){
 const at=Date.parse(now);if(!Number.isFinite(at))throw Error('resource_schedule_time');
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,hour:'numeric',minute:'numeric',hourCycle:'h23'});
 const first=(Math.floor(at/900000)+1)*900000;
 for(let index=0;index<200;index++){
  const candidate=first+index*900000,parts=Object.fromEntries(formatter.formatToParts(candidate).map(part=>[part.type,part.value]));
  if(Number(parts.hour)===1&&Number(parts.minute)===0)return new Date(candidate).toISOString();
 }
 throw Error('resource_schedule_zone');
}
