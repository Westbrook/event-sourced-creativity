CREATE EXTENSION IF NOT EXISTS vector VERSION '0.8.2';
CREATE SCHEMA memory_pilot;
-- Tombstones/authority are retained independently of disposable vector rows.
CREATE TABLE memory_pilot.partitions(partition_id text PRIMARY KEY,generation bigint NOT NULL DEFAULT 1,enabled boolean NOT NULL DEFAULT true);
CREATE TABLE memory_pilot.members(partition_id text REFERENCES memory_pilot.partitions,principal_id text NOT NULL,PRIMARY KEY(partition_id,principal_id));
CREATE TABLE memory_pilot.authority(partition_id text REFERENCES memory_pilot.partitions,source_id text NOT NULL,generation bigint NOT NULL,deleted boolean NOT NULL DEFAULT false,PRIMARY KEY(partition_id,source_id));
CREATE TABLE memory_pilot.entries(partition_id text NOT NULL,source_id text NOT NULL,generation bigint NOT NULL,partition_generation bigint NOT NULL,content_hash text NOT NULL,embedding vector(3) NOT NULL,terms tsvector NOT NULL,PRIMARY KEY(partition_id,source_id),FOREIGN KEY(partition_id,source_id) REFERENCES memory_pilot.authority);
CREATE TABLE memory_pilot.receipts(receipt_id text PRIMARY KEY,partition_id text NOT NULL,source_id text NOT NULL,generation bigint NOT NULL,operation text NOT NULL CHECK(operation IN('upsert','delete','restore')),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
