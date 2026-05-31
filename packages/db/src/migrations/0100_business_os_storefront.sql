CREATE TABLE IF NOT EXISTS "bos_store" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"domain" text,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currency" text DEFAULT 'KWD',
	"status" text DEFAULT 'draft',
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_store_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_store" ADD CONSTRAINT "bos_store_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_store_company_idx" ON "bos_store" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_store_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text,
	"body" text,
	"published" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_store_page_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_store_page" ADD CONSTRAINT "bos_store_page_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_store_page_company_idx" ON "bos_store_page" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_store_page_store_idx" ON "bos_store_page" USING btree ("store_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"description" text,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_collection_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_collection" ADD CONSTRAINT "bos_collection_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_collection_company_idx" ON "bos_collection" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_channel_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_channel" ADD CONSTRAINT "bos_channel_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_channel_company_idx" ON "bos_channel" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_channel_listing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"listed" boolean DEFAULT true NOT NULL,
	"price_override_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_channel_listing_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_channel_listing" ADD CONSTRAINT "bos_channel_listing_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_channel_listing_company_idx" ON "bos_channel_listing" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_channel_listing_channel_idx" ON "bos_channel_listing" USING btree ("channel_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_discount" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"kind" text,
	"value_bps" integer DEFAULT 0 NOT NULL,
	"value_minor" bigint DEFAULT 0 NOT NULL,
	"min_order_minor" bigint DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_discount_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_discount" ADD CONSTRAINT "bos_discount_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_discount_company_idx" ON "bos_discount" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_discount_company_code_idx" ON "bos_discount" USING btree ("company_id","code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_online_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text,
	"customer_name" text,
	"customer_email" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"shipping_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KWD',
	"status" text DEFAULT 'pending',
	"channel" text DEFAULT 'online',
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discount_code" text,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_online_order_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_online_order" ADD CONSTRAINT "bos_online_order_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_online_order_company_idx" ON "bos_online_order" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_online_order_company_status_idx" ON "bos_online_order" USING btree ("company_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_fulfillment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"online_order_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"status" text DEFAULT 'pending',
	"tracking" text,
	"carrier" text,
	"shipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_fulfillment_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_fulfillment" ADD CONSTRAINT "bos_fulfillment_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_fulfillment_company_idx" ON "bos_fulfillment" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_fulfillment_order_idx" ON "bos_fulfillment" USING btree ("online_order_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_shipping_zone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_shipping_zone_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_shipping_zone" ADD CONSTRAINT "bos_shipping_zone_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_shipping_zone_company_idx" ON "bos_shipping_zone" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_shipping_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_minor" bigint DEFAULT 0 NOT NULL,
	"min_order_free_minor" bigint,
	"est_days" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_shipping_rate_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_shipping_rate" ADD CONSTRAINT "bos_shipping_rate_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_shipping_rate_company_idx" ON "bos_shipping_rate" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_shipping_rate_zone_idx" ON "bos_shipping_rate" USING btree ("zone_id");
