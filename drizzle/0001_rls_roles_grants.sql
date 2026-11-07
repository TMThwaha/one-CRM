-- ONECRM tenant isolation, defense in depth (layer 2 of 3).
--   Layer 1: every service call is authorized and scoped by organization in application code.
--   Layer 2: (this file) PostgreSQL row-level security under a restricted role.
--   Layer 3: composite foreign keys (organization_id, id) make cross-tenant references impossible.
--
-- Tenant data is only ever touched inside a transaction that runs `SET LOCAL ROLE onecrm_app`
-- and sets `app.org_id` (see src/server/db/tenant.ts). Identity flows (sign-in, invitation
-- acceptance) use the owning connection, which bypasses RLS by design and is confined to
-- the identity module.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onecrm_app') THEN
    CREATE ROLE onecrm_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO onecrm_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'roles', 'role_permissions', 'organization_members', 'invitations',
    'companies', 'contacts', 'leads',
    'pipelines', 'pipeline_stages', 'deals', 'deal_contacts',
    'activities', 'tasks'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO onecrm_app USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id())',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO onecrm_app', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- organization_members rows are created by the identity module (invitation acceptance),
-- and members are suspended rather than deleted, so the app role cannot insert/delete them.
REVOKE INSERT, DELETE ON organization_members FROM onecrm_app;
--> statement-breakpoint

-- Audit log: append-only for the application.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_select ON audit_logs FOR SELECT TO onecrm_app USING (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY audit_insert ON audit_logs FOR INSERT TO onecrm_app WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_logs TO onecrm_app;
--> statement-breakpoint

-- Organizations: a tenant context can only see and edit its own organization row.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_select ON organizations FOR SELECT TO onecrm_app USING (id = app_org_id());
--> statement-breakpoint
CREATE POLICY org_update ON organizations FOR UPDATE TO onecrm_app USING (id = app_org_id()) WITH CHECK (id = app_org_id());
--> statement-breakpoint
GRANT SELECT, UPDATE ON organizations TO onecrm_app;
--> statement-breakpoint

-- Users are global, so a tenant context may only see members of its own organization,
-- and never the password hash (column-level grant).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_visible_to_org_members ON users FOR SELECT TO onecrm_app
  USING (EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.user_id = users.id AND m.organization_id = app_org_id()
  ));
--> statement-breakpoint
GRANT SELECT (id, email, name, email_verified_at, created_at) ON users TO onecrm_app;
--> statement-breakpoint

-- Sessions, auth events: identity module only. The app role gets no access at all.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_events ENABLE ROW LEVEL SECURITY;
