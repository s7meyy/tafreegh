CREATE TYPE "public"."edit_reason" AS ENUM('glossary', 'low_confidence', 'engine_disagreement', 'orthography', 'punctuation', 'disfluency');--> statement-breakpoint
CREATE TYPE "public"."edit_verdict" AS ENUM('pending', 'accepted', 'rejected', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('queued', 'fetching', 'preparing', 'transcribing', 'reviewing_1', 'reviewing_2', 'awaiting_approval', 'approved', 'archived', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."job_state" AS ENUM('waiting', 'active', 'deferred', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."processing_profile" AS ENUM('free_cloud', 'local_only');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('upload', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('fetch', 'prepare', 'transcribe', 'review', 'audit', 'export', 'cleanup');--> statement-breakpoint
CREATE TYPE "public"."transcription_mode" AS ENUM('verbatim', 'clean', 'formal');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"from_stage" "stage" NOT NULL,
	"paragraph" integer NOT NULL,
	"before" text NOT NULL,
	"after" text NOT NULL,
	"reason" "edit_reason" NOT NULL,
	"confidence" real,
	"verdict" "edit_verdict" DEFAULT 'pending' NOT NULL,
	"verdict_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "glossary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"term" text NOT NULL,
	"variants" text[] DEFAULT '{}' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_url" text,
	"content_hash" text,
	"media_path" text,
	"duration_sec" integer,
	"language_hint" text DEFAULT 'ar',
	"status" "item_status" DEFAULT 'queued' NOT NULL,
	"current_stage" "stage",
	"error_message" text,
	"difficulty" real,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp with time zone,
	"media_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"segment_id" uuid,
	"stage" "stage" NOT NULL,
	"state" "job_state" DEFAULT 'waiting' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"retry_after" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"transcription_mode" "transcription_mode" DEFAULT 'clean' NOT NULL,
	"profile" "processing_profile" DEFAULT 'free_cloud' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"overlap_ms" integer DEFAULT 0 NOT NULL,
	"media_path" text
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"stage" "stage" NOT NULL,
	"engine" text NOT NULL,
	"model" text NOT NULL,
	"text" text NOT NULL,
	"words_json" jsonb,
	"avg_confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"requests" integer DEFAULT 1 NOT NULL,
	"audio_seconds" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edits" ADD CONSTRAINT "edits_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary" ADD CONSTRAINT "glossary_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_item_idx" ON "audit_log" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "edits_item_idx" ON "edits" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "glossary_project_term_idx" ON "glossary" USING btree ("project_id","term");--> statement-breakpoint
CREATE INDEX "items_project_idx" ON "items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "items_hash_idx" ON "items" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "jobs_item_stage_idx" ON "jobs" USING btree ("item_id","stage");--> statement-breakpoint
CREATE INDEX "projects_user_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_item_index_idx" ON "segments" USING btree ("item_id","index");--> statement-breakpoint
CREATE INDEX "transcripts_item_stage_idx" ON "transcripts" USING btree ("item_id","stage");--> statement-breakpoint
CREATE INDEX "usage_provider_time_idx" ON "usage" USING btree ("provider","created_at");