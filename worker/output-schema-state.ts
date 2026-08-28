/** Positive knowledge only: a fresh worker still initializes the durable schema. */
const readyDatabases=new WeakSet<object>();
export const outputSchemaIsReady=(db:object)=>readyDatabases.has(db);
export const markOutputSchemaReady=(db:object)=>{readyDatabases.add(db);};
