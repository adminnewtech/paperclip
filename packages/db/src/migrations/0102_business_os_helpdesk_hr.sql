CREATE TABLE IF NOT EXISTS "bos_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text,
	"subject" text,
	"body" text,
	"customer_name" text,
	"customer_email" text,
	"channel" text DEFAULT 'email',
	"priority" text DEFAULT 'medium',
	"status" text DEFAULT 'open',
	"sla_policy_id" uuid,
	"assignee_user_id" text,
	"sla_due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_ticket_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_ticket" ADD CONSTRAINT "bos_ticket_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_ticket_company_idx" ON "bos_ticket" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_ticket_company_status_idx" ON "bos_ticket" USING btree ("company_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_ticket_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author" text,
	"body" text,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_ticket_comment_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_ticket_comment" ADD CONSTRAINT "bos_ticket_comment_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_ticket_comment_company_idx" ON "bos_ticket_comment" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_ticket_comment_ticket_idx" ON "bos_ticket_comment" USING btree ("ticket_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_sla_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text,
	"first_response_mins" integer DEFAULT 60 NOT NULL,
	"resolution_mins" integer DEFAULT 1440 NOT NULL,
	"priority" text DEFAULT 'medium',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_sla_policy_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_sla_policy" ADD CONSTRAINT "bos_sla_policy_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_sla_policy_company_idx" ON "bos_sla_policy" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_kb_article" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text,
	"slug" text,
	"body" text,
	"category" text,
	"published" boolean DEFAULT false NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_kb_article_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_kb_article" ADD CONSTRAINT "bos_kb_article_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_kb_article_company_idx" ON "bos_kb_article" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" timestamp with time zone,
	"check_in" timestamp with time zone,
	"check_out" timestamp with time zone,
	"hours" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'present',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_attendance_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_attendance" ADD CONSTRAINT "bos_attendance_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_attendance_company_idx" ON "bos_attendance" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_attendance_employee_idx" ON "bos_attendance" USING btree ("employee_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_leave_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"days" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending',
	"reason" text,
	"approver_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_leave_request_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_leave_request" ADD CONSTRAINT "bos_leave_request_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_leave_request_company_idx" ON "bos_leave_request" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_leave_request_company_status_idx" ON "bos_leave_request" USING btree ("company_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_leave_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text,
	"kind" text,
	"days_per_year" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_leave_policy_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_leave_policy" ADD CONSTRAINT "bos_leave_policy_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_leave_policy_company_idx" ON "bos_leave_policy" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_payroll_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period" text,
	"status" text DEFAULT 'draft',
	"gross_minor" bigint DEFAULT 0 NOT NULL,
	"deductions_minor" bigint DEFAULT 0 NOT NULL,
	"net_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KWD',
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_payroll_run_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_payroll_run" ADD CONSTRAINT "bos_payroll_run_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_payroll_run_company_idx" ON "bos_payroll_run" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_payroll_run_company_status_idx" ON "bos_payroll_run" USING btree ("company_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_payslip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payroll_run_id" uuid,
	"employee_id" uuid,
	"employee_name" text,
	"gross_minor" bigint DEFAULT 0 NOT NULL,
	"deductions_minor" bigint DEFAULT 0 NOT NULL,
	"net_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KWD',
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_payslip_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_payslip" ADD CONSTRAINT "bos_payslip_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_payslip_company_idx" ON "bos_payslip" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_payslip_run_idx" ON "bos_payslip" USING btree ("payroll_run_id");
