CREATE TABLE IF NOT EXISTS "bos_briefing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"period" text,
	"summary" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"alerts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"insights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_briefing_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_briefing" ADD CONSTRAINT "bos_briefing_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_briefing_company_idx" ON "bos_briefing" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_briefing_company_generated_idx" ON "bos_briefing" USING btree ("company_id","generated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_insight" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info',
	"title" text,
	"detail" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_insight_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_insight" ADD CONSTRAINT "bos_insight_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_insight_company_idx" ON "bos_insight" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_insight_company_kind_idx" ON "bos_insight" USING btree ("company_id","kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_insight_company_resolved_idx" ON "bos_insight" USING btree ("company_id","resolved");
