/** One reviewed source-journal extension. This does not authorize packaged SQL. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const STILL_JOURNAL_TRANSITION=Object.freeze({
 kind:'still-action-outcomes-0074',
 before:'00b0317fa45a2686e6545d3a16dd3864eb1f6e521be73f4cd331281400248dc0',
 after:'c62a5d495eabc1ffda638543f6bba66c3dc0e01b5495e93085fed0e53d08b61f',
 sql:'4b8eabd4ffad33e8c735275bda3c5a6b278894acea0a20973b6b0b8491fa478f',
});
const fail=()=>{throw Error('Unreviewed Still source journal transition');};
export function memoryRepairJournal(source,addedSql){
 const bytes=Buffer.from(source),digest=hash(bytes),journal=JSON.parse(bytes.toString());
 if(digest===STILL_JOURNAL_TRANSITION.before)return {count:72,sourceJournalSha256:digest};
 if(digest!==STILL_JOURNAL_TRANSITION.after||hash(addedSql)!==STILL_JOURNAL_TRANSITION.sql||journal.entries.length!==73)fail();
 const prefix=JSON.stringify({...journal,entries:journal.entries.slice(0,72)},null,2)+'\n';
 if(hash(prefix)!==STILL_JOURNAL_TRANSITION.before)fail();
 return {count:72,sourceJournalSha256:STILL_JOURNAL_TRANSITION.before};
}
export function verifyStillJournalTransition({transition,beforePolicy,afterPolicy,beforeJournal,afterJournal,addedSql}){
 if(!isDeepStrictEqual(transition,STILL_JOURNAL_TRANSITION))fail();
 if(hash(beforeJournal)!==transition.before||hash(afterJournal)!==transition.after)fail();
 const oldPolicy=JSON.parse(beforePolicy),newPolicy=JSON.parse(afterPolicy);
 if(oldPolicy.sourceJournalSha256!==transition.before||newPolicy.sourceJournalSha256!==transition.after)fail();
 // Even whitespace and every other policy field must be unchanged.
 if(beforePolicy.replace(transition.before,transition.after)!==afterPolicy)fail();
 memoryRepairJournal(afterJournal,addedSql);
 return {...STILL_JOURNAL_TRANSITION,packagedMigrationPolicy:'unchanged'};
}
