CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"monthly_price" numeric(12, 2),
	"annual_price" numeric(12, 2),
	"price_currency" char(3),
	"max_employees" integer,
	"max_storage_mb" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "platform_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"organization_id" uuid,
	"summary" text,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "country" char(2);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "business_email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "business_phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "phone_country_code" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "date_format" text DEFAULT 'dd/MM/yyyy' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_created_idx" ON "platform_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_org_idx" ON "platform_audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_legal_name_country_uq" ON "organizations" USING btree (lower("legal_name"),"country") WHERE "organizations"."legal_name" is not null and "organizations"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_registration_uq" ON "organizations" USING btree ("country",lower("registration_number")) WHERE "organizations"."registration_number" is not null and "organizations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "organizations_status_idx" ON "organizations" USING btree ("status");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_status_chk" CHECK ("organizations"."status" in ('active','suspended','deactivated','archived'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_country_chk" CHECK ("organizations"."country" is null or "organizations"."country" ~ '^[A-Z]{2}$');