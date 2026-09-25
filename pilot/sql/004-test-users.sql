-- Test operators are verified IAP principals; app users retain independent
-- workspaces, consent, drafts, roles and project grants. No shared-IAP bypass.
CREATE TABLE pilot.controlled_test_users(
 controller_id text NOT NULL REFERENCES pilot.principals,
 principal_id text PRIMARY KEY REFERENCES pilot.principals,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(controller_id <> principal_id)
);
CREATE INDEX controlled_test_users_controller ON pilot.controlled_test_users(controller_id);
