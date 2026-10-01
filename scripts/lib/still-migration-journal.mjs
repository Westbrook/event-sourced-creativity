/** Reviewed source-journal extensions. These do not authorize packaged SQL. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const STILL_JOURNAL_TRANSITION=Object.freeze({
 kind:'still-action-outcomes-0074',
 before:'00b0317fa45a2686e6545d3a16dd3864eb1f6e521be73f4cd331281400248dc0',
 after:'c62a5d495eabc1ffda638543f6bba66c3dc0e01b5495e93085fed0e53d08b61f',
 sql:'4b8eabd4ffad33e8c735275bda3c5a6b278894acea0a20973b6b0b8491fa478f',
});
export const STILL_USER_SETTINGS_JOURNAL_TRANSITION=Object.freeze({
 kind:'still-user-settings-0075',
 before:STILL_JOURNAL_TRANSITION.after,
 after:'ac4433ef48d3f0ecedee5ef97b84da6fcda116077b5889c86fff5b307efeb893',
 sql:'dcadf375a378a0f622de2bf3f95fac8416a14606ce3c8cb017db458ea1501ec9',
});
const extensions=[
 {transition:STILL_JOURNAL_TRANSITION,count:73,file:'drizzle/0074_still_action_outcomes.sql'},
 {transition:STILL_USER_SETTINGS_JOURNAL_TRANSITION,count:74,file:'drizzle/0075_still_user_settings.sql'},
];
const fail=()=>{throw Error('Unreviewed Still source journal transition');};
const reviewedIndex=transition=>{
 const index=extensions.findIndex(entry=>isDeepStrictEqual(transition,entry.transition));
 if(index<0)fail();
 return index;
};
/** Fixed filenames only, selected after validating the exact declared transition. */
export function stillJournalTransitionSqlFiles(transition){
 return extensions.slice(0,reviewedIndex(transition)+1).map(entry=>entry.file);
}
export function memoryRepairJournal(source,addedSql){
 const bytes=Buffer.from(source),digest=hash(bytes),journal=JSON.parse(bytes.toString());
 if(digest===STILL_JOURNAL_TRANSITION.before)return {count:72,sourceJournalSha256:digest};
 const index=extensions.findIndex(entry=>entry.transition.after===digest);
 if(index<0||journal.entries.length!==extensions[index].count)fail();
 // Preserve the original single-SQL call for the original 0074 qualification.
 const sqlByPath=typeof addedSql==='string'||Buffer.isBuffer(addedSql)?{[extensions[0].file]:addedSql}:addedSql;
 for(const {transition,count,file} of extensions.slice(0,index+1)){
  const sql=sqlByPath?.[file];
  if(!(typeof sql==='string'||Buffer.isBuffer(sql))||hash(sql)!==transition.sql)fail();
  const prefix=JSON.stringify({...journal,entries:journal.entries.slice(0,count-1)},null,2)+'\n';
  if(hash(prefix)!==transition.before)fail();
 }
 return {count:72,sourceJournalSha256:STILL_JOURNAL_TRANSITION.before};
}
export function verifyStillJournalTransition({transition,beforePolicy,afterPolicy,beforeJournal,afterJournal,addedSql}){
 reviewedIndex(transition);
 if(hash(beforeJournal)!==transition.before||hash(afterJournal)!==transition.after)fail();
 const oldPolicy=JSON.parse(beforePolicy),newPolicy=JSON.parse(afterPolicy);
 if(oldPolicy.sourceJournalSha256!==transition.before||newPolicy.sourceJournalSha256!==transition.after)fail();
 // Even whitespace and every other policy field must be unchanged.
 if(beforePolicy.replace(transition.before,transition.after)!==afterPolicy)fail();
 memoryRepairJournal(afterJournal,addedSql);
 return {...transition,packagedMigrationPolicy:'unchanged'};
}
