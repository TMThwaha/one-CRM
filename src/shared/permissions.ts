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
  "role.manage": "Create, edit and delete custom roles",
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
    name: "Company Admin",
    description: "Full control of the company workspace: team, roles, settings and all business data.",
    permissions: all(...ALL_PERMISSIONS),
  },
  {
    key: "admin",
    name: "Admin",
    description: "Delegated administrator: manages the team and all CRM data. Cannot change company settings.",
    // Deliberately without org.manage and role.manage: changing company settings and defining roles stay with the Company Admin.
    permissions: all(...ALL_PERMISSIONS.filter((p) => p !== "org.manage" && p !== "role.manage")),
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

// ---------------------------------------------------------------------------------------------
// Custom roles: what the editor offers and what the server accepts
// ---------------------------------------------------------------------------------------------

/**
 * Permissions whose record scope the services actually enforce (`own` narrows to records the user
 * owns or is assigned). Every other permission is all-or-nothing; offering `own` for them would be
 * a setting that does nothing.
 */
export const SCOPED_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "contact.read", "contact.write", "contact.delete",
  "company.read", "company.write", "company.delete",
  "lead.read", "lead.write", "lead.delete", "lead.convert",
  "deal.read", "deal.write", "deal.delete",
  "task.read", "task.write", "task.delete",
]);

/** How the permission editor groups and orders the catalogue. */
export const PERMISSION_GROUPS: { title: string; permissions: Permission[] }[] = [
  { title: "Contacts", permissions: ["contact.read", "contact.write", "contact.delete"] },
  { title: "Companies", permissions: ["company.read", "company.write", "company.delete"] },
  { title: "Leads", permissions: ["lead.read", "lead.write", "lead.delete", "lead.convert"] },
  { title: "Deals and pipelines", permissions: ["deal.read", "deal.write", "deal.delete", "pipeline.manage"] },
  { title: "Tasks", permissions: ["task.read", "task.write", "task.delete"] },
  { title: "Activity timeline", permissions: ["activity.read", "activity.write"] },
  { title: "Team and roles", permissions: ["member.read", "member.invite", "member.manage", "role.read", "role.manage"] },
  { title: "Company", permissions: ["org.manage", "audit.read"] },
];

/** A permission is useless (or breaks the UI) without the permission it builds on. */
export const REQUIRES: Partial<Record<Permission, Permission>> = {
  "contact.write": "contact.read", "contact.delete": "contact.read",
  "company.write": "company.read", "company.delete": "company.read",
  "lead.write": "lead.read", "lead.delete": "lead.read", "lead.convert": "lead.read",
  "deal.write": "deal.read", "deal.delete": "deal.read", "pipeline.manage": "deal.read",
  "task.write": "task.read", "task.delete": "task.read",
  "activity.write": "activity.read",
  "member.invite": "member.read", "member.manage": "member.read",
  "role.manage": "role.read",
};

const RANK: Record<Scope, number> = { own: 0, team: 1, all: 2 };

/** Why a permission set is not acceptable, as human sentences. Empty means valid. */
export function validatePermissionSet(map: Partial<Record<string, string>>): string[] {
  const problems: string[] = [];
  for (const [key, scope] of Object.entries(map)) {
    if (!(key in PERMISSIONS)) {
      problems.push(`Unknown permission: ${key}`);
      continue;
    }
    const p = key as Permission;
    if (scope !== "all" && scope !== "own") problems.push(`${PERMISSIONS[p]}: scope must be "all" or "own"`);
    else if (scope === "own" && !SCOPED_PERMISSIONS.has(p)) problems.push(`${PERMISSIONS[p]} cannot be limited to own records`);
  }
  for (const [key, scope] of Object.entries(map) as [Permission, Scope][]) {
    const need = REQUIRES[key];
    if (!need) continue;
    const base = map[need] as Scope | undefined;
    if (!base) problems.push(`"${PERMISSIONS[key]}" also needs "${PERMISSIONS[need]}"`);
    else if (RANK[base] < RANK[scope]) problems.push(`"${PERMISSIONS[need]}" must cover at least the records "${PERMISSIONS[key]}" does`);
  }
  return problems;
}

/** For the editor: after a change, add whatever the new permission depends on so the set stays valid. */
export function withDependencies(map: PermissionMap): PermissionMap {
  const out: PermissionMap = { ...map };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, scope] of Object.entries(out) as [Permission, Scope][]) {
      const need = REQUIRES[key];
      if (!need) continue;
      const base = out[need];
      if (!base || RANK[base] < RANK[scope]) {
        out[need] = scope;
        changed = true;
      }
    }
  }
  return out;
}

/** True when `held` covers `wanted`: every permission at an equal or broader scope. */
export function covers(held: PermissionMap, wanted: PermissionMap): boolean {
  return Object.entries(wanted).every(([k, sc]) => {
    const h = held[k as Permission];
    return h !== undefined && RANK[h] >= RANK[sc as Scope];
  });
}

/**
 * One edit in the role editor, keeping the set valid as you go: removing a permission removes what is
 * built on it; narrowing one narrows what is built on it; adding one adds what it needs.
 */
export function setPermission(map: PermissionMap, p: Permission, next: Scope | null): PermissionMap {
  const out: PermissionMap = { ...map };
  if (next === null) {
    delete out[p];
    let changed = true;
    while (changed) {
      changed = false;
      for (const k of Object.keys(out) as Permission[]) {
        const need = REQUIRES[k];
        if (need && !out[need]) {
          delete out[k];
          changed = true;
        }
      }
    }
    return out;
  }
  out[p] = next;
  for (const k of Object.keys(out) as Permission[]) {
    if (REQUIRES[k] === p && RANK[out[k]!] > RANK[next]) out[k] = next;
  }
  return withDependencies(out);
}
