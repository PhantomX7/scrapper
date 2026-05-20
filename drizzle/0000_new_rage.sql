CREATE TABLE `chats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`service` text NOT NULL,
	`external_id` text NOT NULL,
	`contact_id` integer,
	`name` text NOT NULL,
	`contact_phone_raw` text,
	`created_at` integer,
	`first_response_at` integer,
	`first_response_wait` text,
	`resolved_at` integer,
	`case_duration` text,
	`first_message` text,
	`scraped_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chats_scope_external_id_unique` ON `chats` (`company_id`,`service`,`external_id`);--> statement-breakpoint
CREATE INDEX `chats_contact_id_idx` ON `chats` (`contact_id`);--> statement-breakpoint
CREATE INDEX `chats_created_at_idx` ON `chats` (`created_at`);--> statement-breakpoint
CREATE INDEX `chats_company_service_idx` ON `chats` (`company_id`,`service`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_slug_unique` ON `companies` (`slug`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`service` text NOT NULL,
	`phone` text NOT NULL,
	`display_name` text,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_scope_phone_unique` ON `contacts` (`company_id`,`service`,`phone`);--> statement-breakpoint
CREATE INDEX `contacts_company_service_idx` ON `contacts` (`company_id`,`service`);--> statement-breakpoint
CREATE TABLE `messages` (
	`chat_id` integer NOT NULL,
	`message_id` text NOT NULL,
	`seq` integer NOT NULL,
	`direction` text NOT NULL,
	`sender_name` text,
	`is_agent` integer,
	`body` text,
	`image_url` text,
	`file_name` text,
	`caption` text,
	`reply_to_name` text,
	`reply_to_text` text,
	`timestamp_label` text,
	PRIMARY KEY(`chat_id`, `message_id`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
