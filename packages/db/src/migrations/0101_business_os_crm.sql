CREATE TABLE IF NOT EXISTS "bos_pipeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_pipeline_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_pipeline" ADD CONSTRAINT "bos_pipeline_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_pipeline_company_idx" ON "bos_pipeline" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_pipeline_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"win_probability" integer DEFAULT 0 NOT NULL,
	"is_won" boolean DEFAULT false NOT NULL,
	"is_lost" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_pipeline_stage_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_pipeline_stage" ADD CONSTRAINT "bos_pipeline_stage_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_pipeline_stage_company_idx" ON "bos_pipeline_stage" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_pipeline_stage_pipeline_idx" ON "bos_pipeline_stage" USING btree ("pipeline_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"company_name" text,
	"email" text,
	"phone" text,
	"source" text,
	"status" text DEFAULT 'new',
	"score" integer DEFAULT 0 NOT NULL,
	"owner_user_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_lead_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_lead" ADD CONSTRAINT "bos_lead_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_lead_company_idx" ON "bos_lead" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_lead_company_status_idx" ON "bos_lead" USING btree ("company_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_deal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pipeline_id" uuid,
	"stage_id" uuid,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KWD',
	"contact_id" uuid,
	"customer_name" text,
	"status" text DEFAULT 'open',
	"expected_close" timestamp with time zone,
	"score" integer DEFAULT 0 NOT NULL,
	"owner_user_id" text,
	"lost_reason" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_deal_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_deal" ADD CONSTRAINT "bos_deal_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_deal_company_idx" ON "bos_deal" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_deal_company_status_idx" ON "bos_deal" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_deal_pipeline_idx" ON "bos_deal" USING btree ("pipeline_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_deal_stage_idx" ON "bos_deal" USING btree ("stage_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text,
	"subject" text,
	"body" text,
	"related_type" text,
	"related_id" uuid,
	"due_at" timestamp with time zone,
	"done" boolean DEFAULT false NOT NULL,
	"owner_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_activity_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_activity" ADD CONSTRAINT "bos_activity_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_activity_company_idx" ON "bos_activity" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_activity_related_idx" ON "bos_activity" USING btree ("related_type","related_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_quote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text,
	"deal_id" uuid,
	"customer_name" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KWD',
	"status" text DEFAULT 'draft',
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_quote_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_quote" ADD CONSTRAINT "bos_quote_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_quote_company_idx" ON "bos_quote" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_quote_company_status_idx" ON "bos_quote" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_quote_deal_idx" ON "bos_quote" USING btree ("deal_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_quote_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"description" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_price_minor" bigint DEFAULT 0 NOT NULL,
	"line_total_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_quote_line_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_quote_line" ADD CONSTRAINT "bos_quote_line_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_quote_line_company_idx" ON "bos_quote_line" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_quote_line_quote_idx" ON "bos_quote_line" USING btree ("quote_id");
