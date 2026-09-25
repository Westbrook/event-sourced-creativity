-- Read-only queries for a supported hosting-owner D1 surface. NOT executed here.
-- Retain exact results privately with physical binding, deployment/environment,
-- operator and UTC time. No DDL, identity, financial or consent mutation.
SELECT sqlite_version() AS sqlite_version;
PRAGMA foreign_keys;
SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY type,name;
SELECT type,name,tbl_name,sql FROM main.sqlite_schema
 WHERE name GLOB 'generation_study_*' OR name GLOB 'authoring_study_*'
 ORDER BY name;
-- Obtain the existing platform's applied-migration ledger through its supported
-- viewer, using the actual observed table name. Do not invent a migration table.
-- Full dependency definitions are required: users/principal admission/consent,
-- project and Memory scope, private_content, all budget/reservation/counter/hold
-- tables/views/triggers reached by existing P2/P4 guards. Mere table existence
-- does not establish compatible columns, immutable guards or atomicity.
