CREATE TABLE IF NOT EXISTS "business_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_attachments_company_id_companies_id_fk') THEN
		ALTER TABLE "business_attachments" ADD CONSTRAINT "business_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_attachments_entity_id_business_entities_id_fk') THEN
		ALTER TABLE "business_attachments" ADD CONSTRAINT "business_attachments_entity_id_business_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."business_entities"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_attachments_entity_idx" ON "business_attachments" USING btree ("entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_attachments_company_idx" ON "business_attachments" USING btree ("company_id","created_at" DESC);
