-- Background jobs: platform infrastructure. No policies and no grants for the tenant role, so company
-- code can never read or write the queue. Only the owning connection (the worker) touches it.
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Domain events (transactional outbox): a tenant transaction may append and read its OWN events.
-- Never update or delete: dispatching happens on the owning connection.
ALTER TABLE domain_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY events_select ON domain_events FOR SELECT TO onecrm_app USING (organization_id = app_org_id());
--> statement-breakpoint
CREATE POLICY events_insert ON domain_events FOR INSERT TO onecrm_app WITH CHECK (organization_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON domain_events TO onecrm_app;
--> statement-breakpoint

-- Notifications: created by the worker (owning connection). A person can read and mark read ONLY their
-- own, inside their own company. Nothing else (no insert, no delete, no editing the text).
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_own ON notifications FOR SELECT TO onecrm_app
  USING (organization_id = app_org_id() AND user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY notifications_mark_read ON notifications FOR UPDATE TO onecrm_app
  USING (organization_id = app_org_id() AND user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (organization_id = app_org_id() AND user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT ON notifications TO onecrm_app;
--> statement-breakpoint
GRANT UPDATE (read_at) ON notifications TO onecrm_app;
