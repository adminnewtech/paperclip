CREATE TABLE IF NOT EXISTS "bos_org_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"legal_name" text,
	"logo_url" text,
	"address" text,
	"tax_id" text,
	"cr_number" text,
	"default_currency" text DEFAULT 'KWD',
	"fiscal_year_start_month" integer DEFAULT 1,
	"locale" text DEFAULT 'ar',
	"rtl" boolean DEFAULT true,
	"branding" jsonb DEFAULT '{}'::jsonb,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_org_settings_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_org_settings" ADD CONSTRAINT "bos_org_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_org_settings_company_unique') THEN
		ALTER TABLE "bos_org_settings" ADD CONSTRAINT "bos_org_settings_company_unique" UNIQUE ("company_id");
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_org_settings_company_idx" ON "bos_org_settings" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_role_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_role" ADD CONSTRAINT "bos_role_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_role_company_idx" ON "bos_role" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_user_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_user_role_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_user_role" ADD CONSTRAINT "bos_user_role_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_user_role_company_idx" ON "bos_user_role" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_user_role_user_idx" ON "bos_user_role" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_user_role_role_idx" ON "bos_user_role" USING btree ("role_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_tax_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate_bps" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_tax_rate_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_tax_rate" ADD CONSTRAINT "bos_tax_rate_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_tax_rate_company_idx" ON "bos_tax_rate" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_currency_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"rate_to_base" numeric NOT NULL,
	"as_of" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_currency_rate_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_currency_rate" ADD CONSTRAINT "bos_currency_rate_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_currency_rate_company_idx" ON "bos_currency_rate" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_automation_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger_event" text NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb,
	"actions" jsonb DEFAULT '[]'::jsonb,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_automation_rule_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_automation_rule" ADD CONSTRAINT "bos_automation_rule_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_automation_rule_company_idx" ON "bos_automation_rule" USING btree ("company_id");
