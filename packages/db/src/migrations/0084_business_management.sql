CREATE TABLE IF NOT EXISTS "business_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"industry_preset" text,
	"activated_by_user_id" text,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_modules_company_id_companies_id_fk') THEN
		ALTER TABLE "business_modules" ADD CONSTRAINT "business_modules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_modules_company_module_uq" ON "business_modules" USING btree ("company_id","module_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_modules_company_idx" ON "business_modules" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"parent_id" uuid,
	"code" text,
	"name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"owner_user_id" text,
	"amount_cents" bigint,
	"currency" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_entities_company_id_companies_id_fk') THEN
		ALTER TABLE "business_entities" ADD CONSTRAINT "business_entities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_entities_company_module_type_idx" ON "business_entities" USING btree ("company_id","module_key","entity_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_entities_company_updated_idx" ON "business_entities" USING btree ("company_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_entities_parent_idx" ON "business_entities" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_entities_name_search_idx" ON "business_entities" USING gin ("name" gin_trgm_ops);
