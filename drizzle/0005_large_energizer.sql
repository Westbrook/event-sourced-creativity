CREATE TABLE `cost_budget_counters` (
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`period` text NOT NULL,
	`used_microusd` integer DEFAULT 0 NOT NULL,
	`reserved_microusd` integer DEFAULT 0 NOT NULL,
	`hard_limit_microusd` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`scope`, `scope_id`, `period`)
);
--> statement-breakpoint
CREATE TABLE `replay_cost_authorizations` (
	`approval_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`pricing_version` text NOT NULL,
	`estimated_microusd` integer NOT NULL,
	`reserved_microusd` integer NOT NULL,
	`maximum_microusd` integer NOT NULL,
	`allow_user_overage` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
