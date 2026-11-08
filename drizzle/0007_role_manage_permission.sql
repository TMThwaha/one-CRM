-- New permission `role.manage` (create, edit and delete custom roles).
-- System roles are stored per organization, so organizations created before this migration need the
-- permission added to their Company Admin ("owner") role. New organizations get it from SYSTEM_ROLES.
-- The delegated "admin" role deliberately does NOT receive it. Idempotent.
INSERT INTO role_permissions (role_id, organization_id, permission, scope)
SELECT r.id, r.organization_id, 'role.manage', 'all'
FROM roles r
WHERE r.key = 'owner' AND r.is_system
ON CONFLICT (role_id, permission) DO NOTHING;
