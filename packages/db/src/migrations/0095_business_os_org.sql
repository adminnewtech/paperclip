CREATE TABLE IF NOT EXISTS "bos_department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text,
	"name_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icon" text,
	"color" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"gated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_department_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_department" ADD CONSTRAINT "bos_department_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_department_company_idx" ON "bos_department" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_department_company_key_idx" ON "bos_department" USING btree ("company_id","key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"department_id" uuid,
	"name" text NOT NULL,
	"lead_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_team_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_team" ADD CONSTRAINT "bos_team_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_team_department_id_bos_department_id_fk') THEN
		ALTER TABLE "bos_team" ADD CONSTRAINT "bos_team_department_id_bos_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."bos_department"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_team_company_idx" ON "bos_team" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_team_department_idx" ON "bos_team" USING btree ("department_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text,
	"agent_id" uuid,
	"kind" text DEFAULT 'human' NOT NULL,
	"department_id" uuid,
	"title" text,
	"manager_id" uuid,
	"working_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_employee_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_employee" ADD CONSTRAINT "bos_employee_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_employee_company_idx" ON "bos_employee" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_employee_department_idx" ON "bos_employee" USING btree ("department_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_employee_agent_idx" ON "bos_employee" USING btree ("agent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_agent_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"job_description" text,
	"autonomy" text DEFAULT 'supervised' NOT NULL,
	"supervisor_employee_id" uuid,
	"kpis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_agent_profile_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_agent_profile" ADD CONSTRAINT "bos_agent_profile_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_agent_profile_company_idx" ON "bos_agent_profile" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_agent_profile_agent_idx" ON "bos_agent_profile" USING btree ("agent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_agent_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_profile_id" uuid NOT NULL,
	"action_key" text NOT NULL,
	"rule" text DEFAULT 'approve' NOT NULL,
	"threshold" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_agent_policy_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_agent_policy" ADD CONSTRAINT "bos_agent_policy_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_agent_policy_agent_profile_id_bos_agent_profile_id_fk') THEN
		ALTER TABLE "bos_agent_policy" ADD CONSTRAINT "bos_agent_policy_agent_profile_id_bos_agent_profile_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."bos_agent_profile"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_agent_policy_company_idx" ON "bos_agent_policy" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_agent_policy_agent_profile_idx" ON "bos_agent_policy" USING btree ("agent_profile_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_agent_policy_company_action_idx" ON "bos_agent_policy" USING btree ("company_id","action_key");
