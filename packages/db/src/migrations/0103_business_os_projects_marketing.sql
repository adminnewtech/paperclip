CREATE TABLE IF NOT EXISTS "bos_project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active',
	"customer_name" text,
	"budget_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KWD',
	"start_date" timestamp with time zone,
	"due_date" timestamp with time zone,
	"owner_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_project_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_project" ADD CONSTRAINT "bos_project_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_project_company_idx" ON "bos_project" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_project_company_status_idx" ON "bos_project" USING btree ("company_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text,
	"description" text,
	"status" text DEFAULT 'todo',
	"priority" text DEFAULT 'medium',
	"assignee_user_id" text,
	"depends_on_id" uuid,
	"estimate_hours" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_task_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_task" ADD CONSTRAINT "bos_task_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_task_company_idx" ON "bos_task" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_task_project_idx" ON "bos_task" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_task_company_status_idx" ON "bos_task" USING btree ("company_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_timesheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"employee_id" uuid,
	"date" timestamp with time zone,
	"hours" integer DEFAULT 0 NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"rate_minor" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_timesheet_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_timesheet" ADD CONSTRAINT "bos_timesheet_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_timesheet_company_idx" ON "bos_timesheet" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_timesheet_project_idx" ON "bos_timesheet" USING btree ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"due_date" timestamp with time zone,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_milestone_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_milestone" ADD CONSTRAINT "bos_milestone_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_milestone_company_idx" ON "bos_milestone" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_milestone_project_idx" ON "bos_milestone" USING btree ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" text DEFAULT 'email',
	"status" text DEFAULT 'draft',
	"audience_id" uuid,
	"template_id" uuid,
	"scheduled_at" timestamp with time zone,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"budget_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_campaign_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_campaign" ADD CONSTRAINT "bos_campaign_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_campaign_company_idx" ON "bos_campaign" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_campaign_company_status_idx" ON "bos_campaign" USING btree ("company_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_audience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_audience_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_audience" ADD CONSTRAINT "bos_audience_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_audience_company_idx" ON "bos_audience" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_email_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"body" text,
	"kind" text DEFAULT 'campaign',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_email_template_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_email_template" ADD CONSTRAINT "bos_email_template_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_email_template_company_idx" ON "bos_email_template" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_journey" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" text,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_journey_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_journey" ADD CONSTRAINT "bos_journey_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_journey_company_idx" ON "bos_journey" USING btree ("company_id");
