-- Identity-module tables: not reachable by the tenant application role at all.
ALTER TABLE email_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The previous grant exposed only these user columns to the tenant role; MFA columns stay private.
-- (Column-level grant from 0001 is unchanged: id, email, name, email_verified_at, created_at.)
