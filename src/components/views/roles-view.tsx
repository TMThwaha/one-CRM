"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { useCan, useSession } from "@/components/session";
import { Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Panel, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { ApiError, api, del, post, patch } from "@/lib/api";
import {
  PERMISSIONS, PERMISSION_GROUPS, SCOPED_PERMISSIONS, setPermission,
  type Permission, type PermissionMap, type Scope,
} from "@/shared/permissions";

interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  permissions: { permission: string; scope: string }[];
}

type Editing =
  | { mode: "create"; template?: Role }
  | { mode: "edit"; role: Role }
  | { mode: "view"; role: Role };

const toMap = (r?: Role): PermissionMap => Object.fromEntries((r?.permissions ?? []).map((p) => [p.permission, p.scope])) as PermissionMap;

export function RolesView() {
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/roles") });
  const manage = can("role.manage");

  const remove = useMutation({
    mutationFn: (id: string) => del(`/roles/${id}`),
    onSuccess: () => {
      toast("Role deleted", "success");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (e) => setDeleteError(e instanceof ApiError ? e.message : "Could not delete the role"),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Roles and permissions"
        description="Decide who can see and do what. System roles are fixed; create custom roles for everything else."
        actions={manage ? <Button variant="primary" onClick={() => setEditing({ mode: "create" })}>New role</Button> : undefined}
      />
      {roles.isLoading ? (
        <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : roles.isError ? (
        <ErrorNote message="Could not load roles." />
      ) : !roles.data?.length ? (
        <EmptyState title="No roles" />
      ) : (
        <Panel>
          <ul className="divide-y divide-border">
            {roles.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {r.name}
                    {r.isSystem ? <Badge tone="neutral"><Lock className="mr-1 h-3 w-3" aria-hidden />System</Badge> : <Badge tone="accent">Custom</Badge>}
                  </p>
                  {r.description && <p className="text-sm text-muted">{r.description}</p>}
                  <p className="mt-0.5 text-xs text-faint">
                    {r.permissions.length} {r.permissions.length === 1 ? "permission" : "permissions"} · {r.memberCount} {r.memberCount === 1 ? "person" : "people"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ mode: "view", role: r })}>View</Button>
                  {manage && !r.isSystem && <Button size="sm" onClick={() => setEditing({ mode: "edit", role: r })}>Edit</Button>}
                  {manage && !r.isSystem && <Button size="sm" variant="ghost" onClick={() => { setDeleteError(null); setDeleting(r); }}>Delete</Button>}
                  {manage && r.isSystem && <Button size="sm" variant="ghost" onClick={() => setEditing({ mode: "create", template: r })}>Use as template</Button>}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        side
        width={680}
        title={editing?.mode === "create" ? "New role" : editing?.mode === "edit" ? `Edit ${editing.role.name}` : editing ? editing.role.name : ""}
        description={editing?.mode === "view" ? (editing.role.isSystem ? "A system role. It cannot be changed." : "Read-only view.") : "Choose exactly what people with this role can do."}
      >
        {editing && (
          <RoleEditor
            key={editing.mode + ("role" in editing ? editing.role.id : editing.template?.id ?? "new")}
            editing={editing}
            roles={roles.data ?? []}
            onDone={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ["roles"] }); }}
          />
        )}
      </Modal>

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name ?? "role"}?`} description="This cannot be undone. A role that people still use cannot be deleted.">
        <div className="space-y-4">
          <ErrorNote message={deleteError} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>Delete role</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function RoleEditor({ editing, roles, onDone }: { editing: Editing; roles: Role[]; onDone: () => void }) {
  const { permissions: held } = useSession();
  const toast = useToast();
  const readOnly = editing.mode === "view";
  const base = editing.mode === "create" ? editing.template : editing.role;
  const [name, setName] = useState(editing.mode === "create" ? "" : editing.role.name);
  const [description, setDescription] = useState(editing.mode === "create" ? "" : editing.role.description ?? "");
  const [error, setError] = useState<string | null>(null);

  // A role can never contain more than its author holds, so a template is trimmed to what you can grant.
  const { initial, skipped } = useMemo(() => {
    const all = toMap(base);
    if (editing.mode !== "create") return { initial: all, skipped: 0 };
    const kept: PermissionMap = {};
    let n = 0;
    for (const [k, sc] of Object.entries(all) as [Permission, Scope][]) {
      const h = held[k];
      if (h === undefined) { n++; continue; }
      kept[k] = h === "all" ? sc : "own";
    }
    return { initial: kept, skipped: n };
  }, [base, editing.mode, held]);
  const [perms, setPerms] = useState<PermissionMap>(initial);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, permissions: perms };
      return editing.mode === "edit" ? patch(`/roles/${editing.role.id}`, body) : post("/roles", body);
    },
    onSuccess: () => {
      toast(editing.mode === "edit" ? "Role updated" : "Role created", "success");
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save the role"),
  });

  const total = Object.keys(perms).length;
  const copyFrom = (id: string) => {
    const r = roles.find((x) => x.id === id);
    if (!r) return;
    const next: PermissionMap = {};
    for (const [k, sc] of Object.entries(toMap(r)) as [Permission, Scope][]) {
      const h = held[k];
      if (h !== undefined) next[k] = h === "all" ? sc : "own";
    }
    setPerms(next);
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}
      className="space-y-5"
      noValidate
    >
      <ErrorNote message={error} />
      {skipped > 0 && (
        <p role="status" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
          {skipped} {skipped === 1 ? "permission was" : "permissions were"} left out because you do not hold {skipped === 1 ? "it" : "them"} yourself, so you cannot grant {skipped === 1 ? "it" : "them"}.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role name *">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} maxLength={60} autoFocus={!readOnly} />}</Field>
        {editing.mode === "create" && (
          <Field label="Start from" hint="Copies another role's permissions.">
            {(id) => (
              <Select id={id} defaultValue="" onChange={(e) => copyFrom(e.target.value)}>
                <option value="">Nothing (blank role)</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Description" className="sm:col-span-2">
          {(id) => <Textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} maxLength={200} />}
        </Field>
      </div>

      <div className="space-y-4">
        {PERMISSION_GROUPS.map((g) => (
          <fieldset key={g.title} className="rounded-xl border border-border">
            <legend className="ml-3 px-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{g.title}</legend>
            <ul className="divide-y divide-border">
              {g.permissions.map((p) => {
                const mine = held[p];
                const current = perms[p];
                const cannot = mine === undefined && !readOnly;
                const label = PERMISSIONS[p];
                return (
                  <li key={p} className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <label htmlFor={`perm-${p}`} className={cannot ? "text-sm text-faint" : "text-sm"}>
                      {label}
                      {cannot && <span className="ml-2 text-xs">(you do not hold this)</span>}
                    </label>
                    {SCOPED_PERMISSIONS.has(p) ? (
                      <Select
                        id={`perm-${p}`}
                        aria-label={label}
                        className="h-8 w-full text-[13px] sm:w-40"
                        value={current ?? "none"}
                        disabled={readOnly || cannot}
                        onChange={(e) => setPerms((m) => setPermission(m, p, e.target.value === "none" ? null : (e.target.value as Scope)))}
                      >
                        <option value="none">No access</option>
                        <option value="own">Own records</option>
                        <option value="all" disabled={mine !== "all"}>All records</option>
                      </Select>
                    ) : (
                      <input
                        id={`perm-${p}`}
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--accent)]"
                        checked={current !== undefined}
                        disabled={readOnly || cannot}
                        onChange={(e) => setPerms((m) => setPermission(m, p, e.target.checked ? "all" : null))}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>

      {!readOnly && (
        <div className="sticky -bottom-4 -mx-1 -mb-4 flex items-center justify-between gap-3 border-t border-border bg-surface px-1 pt-3 pb-4">
          <p className="text-sm text-muted">{total} {total === 1 ? "permission" : "permissions"} selected</p>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={name.trim().length < 2 || total === 0}>
            {editing.mode === "edit" ? "Save changes" : "Create role"}
          </Button>
        </div>
      )}
    </form>
  );
}
