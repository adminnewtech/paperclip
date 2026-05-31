CREATE TABLE IF NOT EXISTS "bos_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text,
	"customer_id" uuid,
	"customer_name" text,
	"issue_date" timestamp with time zone DEFAULT now(),
	"due_date" timestamp with time zone,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KWD',
	"status" text DEFAULT 'draft',
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_invoice_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_invoice" ADD CONSTRAINT "bos_invoice_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_invoice_company_idx" ON "bos_invoice" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_invoice_company_status_idx" ON "bos_invoice" USING btree ("company_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_bill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text,
	"vendor_id" uuid,
	"vendor_name" text,
	"issue_date" timestamp with time zone DEFAULT now(),
	"due_date" timestamp with time zone,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KWD',
	"status" text DEFAULT 'draft',
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_bill_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_bill" ADD CONSTRAINT "bos_bill_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_bill_company_idx" ON "bos_bill" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_bill_company_status_idx" ON "bos_bill" USING btree ("company_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_fin_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"invoice_id" uuid,
	"bill_id" uuid,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'KWD',
	"method" text,
	"paid_at" timestamp with time zone DEFAULT now(),
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_fin_payment_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_fin_payment" ADD CONSTRAINT "bos_fin_payment_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_fin_payment_company_idx" ON "bos_fin_payment" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_fin_payment_invoice_idx" ON "bos_fin_payment" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_fin_payment_bill_idx" ON "bos_fin_payment" USING btree ("bill_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_bank_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"account_number" text,
	"currency" text DEFAULT 'KWD',
	"balance_minor" bigint DEFAULT 0 NOT NULL,
	"ledger_account_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_bank_account_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_bank_account" ADD CONSTRAINT "bos_bank_account_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_bank_account_company_idx" ON "bos_bank_account" USING btree ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_bank_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_account_id" uuid,
	"date" timestamp with time zone DEFAULT now(),
	"description" text,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"reconciled" boolean DEFAULT false NOT NULL,
	"matched_payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_bank_transaction_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_bank_transaction" ADD CONSTRAINT "bos_bank_transaction_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_bank_transaction_company_idx" ON "bos_bank_transaction" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_bank_transaction_bank_account_idx" ON "bos_bank_transaction" USING btree ("bank_account_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bos_fiscal_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"status" text DEFAULT 'open',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bos_fiscal_period_company_id_companies_id_fk') THEN
		ALTER TABLE "bos_fiscal_period" ADD CONSTRAINT "bos_fiscal_period_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bos_fiscal_period_company_idx" ON "bos_fiscal_period" USING btree ("company_id");
