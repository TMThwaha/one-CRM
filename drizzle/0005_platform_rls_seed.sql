-- Platform (Super Admin) layer. None of these tables is reachable by the tenant role.
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Append-only, even for the owning connection: history cannot be rewritten by application bugs.
CREATE OR REPLACE FUNCTION platform_audit_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_logs is append-only';
END $$;
--> statement-breakpoint
CREATE TRIGGER platform_audit_no_update BEFORE UPDATE OR DELETE ON platform_audit_logs
  FOR EACH ROW EXECUTE FUNCTION platform_audit_immutable();
--> statement-breakpoint

-- A tenant context may edit its own company PROFILE, but never lifecycle or commercial columns:
-- status, plan, slug, ownership and deletion are platform-only, enforced by the database too.
REVOKE UPDATE ON organizations FROM onecrm_app;
--> statement-breakpoint
GRANT UPDATE (
  name, industry, base_currency, timezone, locale, legal_name, region, city, address, website,
  business_email, business_phone, phone_country_code, registration_number, tax_id, logo_url,
  date_format, updated_at
) ON organizations TO onecrm_app;
--> statement-breakpoint

-- Plan catalogue: names and order only. Prices and limits are deliberately left unset (NULL) for
-- the Super Admin to configure; nothing here is a commercial decision.
INSERT INTO subscription_plans (key, name, sort_order) VALUES
  ('starter', 'Starter', 1),
  ('growth', 'Growth', 2),
  ('professional', 'Professional', 3),
  ('enterprise', 'Enterprise', 4)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

-- Vocabulary: the system `owner` role is the Company Admin. Same permissions, clearer name.
UPDATE roles SET name = 'Company Admin',
  description = 'Full control of the company workspace: team, roles, settings and all business data.'
  WHERE key = 'owner' AND is_system;
--> statement-breakpoint
UPDATE roles SET name = 'Admin',
  description = 'Delegated administrator: manages the team and all CRM data. Cannot change company settings.'
  WHERE key = 'admin' AND is_system;
