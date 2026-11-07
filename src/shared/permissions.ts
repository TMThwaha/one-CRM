/**
 * Permission catalog and system roles. Shared by server (enforcement) and UI (hiding controls).
 * The UI only ever HIDES things for convenience - the server is the sole authority.
 */

export const PERMISSIONS = {
  "org.manage": "Edit organization settings",
  "member.read": "View team members",
  "member.invite": "Invite team members",
  "member.manage": "Change roles and suspend members",
  "role.read": "View roles and permissions",
  "audit.read": "View the audit log",
  "contact.read": "View contacts",
  "contact.write": "Create and edit contacts",
  "contact.delete": "Delete contacts",
  "company.read": "View companies",
  "company.write": "Create and edit companies",
  "company.delete": "Delete companies",
  "lead.read": "View leads",
  "lead.write": "Create and edit leads",
  "lead.delete": "Delete leads",
  "lead.convert": "Convert leads to contacts and deals",
  "deal.read": "View deals",
  "deal.write": "Create and edit deals",
  "deal.delete": "Delete deals",
  "pipeline.manage": "Configure pipelines and stages",
  "task.read": "View tasks",
  "task.write": "Create and edit tasks",
  "task.delete": "Delete tasks",
  "activity.read": "View the activity timeline",
  "activity.write": "Log notes, calls and meetings",
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Record-level scope for a permission.
 *  all  - every record in the organization
 *  own  - only records the user owns / is assigned to
 *  team - reserved; currently enforced as `own` (the safe, more restrictive interpretation)
 */
export type Scope = "all" | "team" | "own";

export type PermissionMap = Partial<Record<Permission, Scope>>;

const all = (...p: Permission[]): PermissionMap => Object.fromEntries(p.map((k) => [k, "all" as Scope]));
const own = (...p: Permission[]): PermissionMap => Object.fromEntries(p.map((k) => [k, "own" as Scope]));

const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  permissions: PermissionMap;
}

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: "owner",
    name: "Owner",
    description: "Full control of the organization, including settings and roles.",
    permissions: all(...ALL_PERMISSIONS),
  },
  {
    key: "admin",
    name: "Admin",
    description: "Manages the team and all CRM data. Cannot change organization settings.",
    permissions: all(...ALL_PERMISSIONS.filter((p) => p !== "org.manage")),
  },
  {
    key: "manager",
    name: "Manager",
    description: "Sees and manages all CRM data and the sales pipeline.",
    permissions: all(
      "member.read", "role.read", "audit.read",
      "contact.read", "contact.write", "contact.delete",
      "company.read", "company.write", "company.delete",
      "lead.read", "lead.write", "lead.delete", "lead.convert",
      "deal.read", "deal.write", "deal.delete", "pipeline.manage",
      "task.read", "task.write", "task.delete",
      "activity.read", "activity.write",
    ),
  },
  {
    key: "sales",
    name: "Sales",
    description: "Shared contacts and companies; works only on their own leads, deals and tasks.",
    permissions: {
      ...all("member.read", "contact.read", "contact.write", "company.read", "company.write", "activity.read", "activity.write"),
      ...own("lead.read", "lead.write", "lead.convert", "deal.read", "deal.write", "task.read", "task.write", "task.delete"),
    },
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to CRM data.",
    permissions: all("member.read", "contact.read", "company.read", "lead.read", "deal.read", "task.read", "activity.read"),
  },
];

export const DEFAULT_ROLE_FOR_INVITES = "sales";
