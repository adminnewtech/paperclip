CREATE TABLE IF NOT EXISTS "bos_vendor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"tax_id" text,
	"payment_terms" text,
	"status" text DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_vendor_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_vendor" ADD CONSTRAINT "bos_vendor_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_vendor_company_idx" ON "bos_vendor" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text,
	"vendor_id" uuid,
	"warehouse_id" uuid,
	"status" text DEFAULT 'draft',
	"order_date" timestamp with time zone DEFAULT now(),
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KWD',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_purchase_order_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_purchase_order" ADD CONSTRAINT "bos_purchase_order_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_purchase_order_company_idx" ON "bos_purchase_order" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_purchase_order_vendor_idx" ON "bos_purchase_order" USING btree ("vendor_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_po_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"variant_id" uuid,
	"description" text,
	"qty" integer DEFAULT 0 NOT NULL,
	"unit_price_minor" bigint DEFAULT 0 NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_po_line_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_po_line" ADD CONSTRAINT "bos_po_line_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_po_line_company_idx" ON "bos_po_line" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_po_line_po_idx" ON "bos_po_line" USING btree ("po_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_goods_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"received_at" timestamp with time zone DEFAULT now(),
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_goods_receipt_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_goods_receipt" ADD CONSTRAINT "bos_goods_receipt_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_goods_receipt_company_idx" ON "bos_goods_receipt" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_goods_receipt_po_idx" ON "bos_goods_receipt" USING btree ("po_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_vendor_bill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"po_id" uuid,
	"vendor_id" uuid,
	"number" text,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KWD',
	"status" text DEFAULT 'pending',
	"matched" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_vendor_bill_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_vendor_bill" ADD CONSTRAINT "bos_vendor_bill_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_vendor_bill_company_idx" ON "bos_vendor_bill" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_vendor_bill_po_idx" ON "bos_vendor_bill" USING btree ("po_id");
