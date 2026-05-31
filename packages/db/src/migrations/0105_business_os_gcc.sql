CREATE TABLE IF NOT EXISTS "bos_einvoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid,
	"uuid_value" text,
	"invoice_hash" text,
	"previous_hash" text,
	"qr_code" text,
	"signed_xml" text,
	"invoice_kind" text DEFAULT 'standard',
	"zatca_status" text DEFAULT 'draft',
	"submitted_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"error_code" text,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"vat_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'SAR',
	"seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_einvoice_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_einvoice" ADD CONSTRAINT "bos_einvoice_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_einvoice_company_idx" ON "bos_einvoice" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_einvoice_company_status_idx" ON "bos_einvoice" USING btree ("company_id","zatca_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_einvoice_company_seq_idx" ON "bos_einvoice" USING btree ("company_id","seq");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_tax_registration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"country" text,
	"vat_number" text,
	"registered" boolean DEFAULT false NOT NULL,
	"vat_rate_bps" integer DEFAULT 0 NOT NULL,
	"scheme" text DEFAULT 'standard',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_tax_registration_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_tax_registration" ADD CONSTRAINT "bos_tax_registration_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_tax_registration_company_idx" ON "bos_tax_registration" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_tax_registration_company_country_idx" ON "bos_tax_registration" USING btree ("company_id","country");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_payment_gateway" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'sandbox',
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_payment_gateway_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_payment_gateway" ADD CONSTRAINT "bos_payment_gateway_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_payment_gateway_company_idx" ON "bos_payment_gateway" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_payment_gateway_company_provider_idx" ON "bos_payment_gateway" USING btree ("company_id","provider");
