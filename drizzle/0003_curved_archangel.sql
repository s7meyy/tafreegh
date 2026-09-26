ALTER TABLE "edits" ADD COLUMN "start_ms" integer;--> statement-breakpoint
ALTER TABLE "edits" ADD COLUMN "end_ms" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "speakers" text[] DEFAULT '{}' NOT NULL;