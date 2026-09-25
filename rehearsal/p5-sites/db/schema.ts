// Exact canonical definitions for the generated custom Drizzle migration.
// Do not normalize SQL: P2/P4 intentionally qualify sqlite_schema text.
// Regenerate in the P5 source workspace with prepare-generation-p5-rehearsal.mjs
// and metadata-generation-p5-rehearsal.mjs; append migrations after deployment.
import schema from './canonical-schema.json';
export const canonicalSchema = schema;
export const schemaOnlyDDL = schema.map(object => object.sql + ';');
