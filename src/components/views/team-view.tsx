"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import { useCan, useSession } from "@/components/session";
import { Avatar, Badge, Button, ErrorNote, Field, Input, Modal, PageHeader, Panel, Select, useToast } from "@/components/ui";
import { ApiError, api, del, patch, post } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { PERMISSIONS, type Permission } from "@/shared/permissions";

interface Member { membershipId: string; userId: string; name: string; email: string; status: string; roleKey: string; roleName: string }
interface Role { id: string; key: string; name: string; description: string | null; permissions: { permission: string; scope: string }[] }
interface Invite { id: string; email: string; roleName: string; expiresAt: string }

export function TeamView() {
  const can = useCan();
  const { user } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [issued, setIssued] = useState<{ email: string; url: string } | null>(null);
  const [viewRole, setViewRole] = useState<Role | null>(null);

  const members = useQuery({ queryKey: ["members"], queryFn: () => api<Member[]>("/members") });
  const roles = useQuery({ queryKey: ["roles"], enabled: can("role.read"), queryFn: () => api<Role[]>("/roles") });
  const invites = useQuery({ queryKey: ["invitations"], enabled: can("member.invite"), queryFn: () => api<Invite[]>("/invitations") });

  const update = useMutation({
    mutationFn: (v: { id: string; body: { roleKey?: string; status?: string } }) => patch(`/members/${v.id}`, v.body),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast(e instanceof ApiError ? e.message : "Could not update member", "danger"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <>
      <PageHeader title="Team" description="Who has access, and what each role can do."
        actions={can("member.invite") && <Button variant="primary" onClick={() => setInviting(true)}>Invite teammate</Button>} />
      <div className="space-y-6">
        <Panel title={`Members${members.data ? ` (${members.data.length})` : ""}`}>
          <ul className="divide-y divide-border">
            {members.data?.map((m) => (
              <li key={m.membershipId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={m.name} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.name} {m.userId === user.id && <span className="text-xs text-faint">(you)</span>}</p>
                  <p className="truncate text-xs text-muted">{m.email}</p>
                </div>
                {m.status === "suspended" && <Badge tone="danger">Suspended</Badge>}
                {can("member.manage") && m.userId !== user.id ? (
                  <Select aria-label={`Role for ${m.name}`} value={m.roleKey} className="h-8 w-36 text-[13px]"
                    onChange={(e) => update.mutate({ id: m.membershipId, body: { roleKey: e.target.value } })}>
                    {roles.data?.map((r) => <option key={r.key} value={r.key}>{r.name}</option>) ?? <option>{m.roleName}</option>}
                  </Select>
                ) : <Badge tone="accent">{m.roleName}</Badge>}
                {can("member.manage") && m.userId !== user.id && (
                  <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: m.membershipId, body: { status: m.status === "active" ? "suspended" : "active" } })}>
                    {m.status === "active" ? "Suspend" : "Reactivate"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        {can("member.invite") && (invites.data?.length ?? 0) > 0 && (
          <Panel title="Pending invitations">
            <ul className="divide-y divide-border">
              {invites.data!.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1"><p className="truncate">{i.email}</p><p className="text-xs text-muted">{i.roleName} · expires {formatDate(i.expiresAt)}</p></div>
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Revoke</Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {can("role.read") && roles.data && (
          <Panel title="Roles">
            <ul className="divide-y divide-border">
              {roles.data.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1"><p className="font-medium">{r.name}</p><p className="text-sm text-muted">{r.description}</p></div>
                  <Button size="sm" variant="ghost" onClick={() => setViewRole(r)}>View permissions</Button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <InviteModal open={inviting} onClose={() => setInviting(false)} roles={roles.data ?? []} onIssued={(x) => { setInviting(false); setIssued(x); }} />

      <Modal open={Boolean(issued)} onClose={() => setIssued(null)} title="Invitation created" description={`Share this link with ${issued?.email}. It can be used once and expires in 7 days.`}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input readOnly value={issued?.url ?? ""} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
            <Button onClick={async () => { await navigator.clipboard.writeText(issued!.url); toast("Link copied", "success"); }}><Copy className="h-4 w-4" />Copy</Button>
          </div>
          <p className="text-xs text-muted">Email delivery is not configured yet, so the link is shown only here, once. Anyone with it can join as the invited role.</p>
        </div>
      </Modal>

      <Modal open={Boolean(viewRole)} onClose={() => setViewRole(null)} title={`${viewRole?.name} permissions`} description={viewRole?.description ?? undefined} width={520}>
        <ul className="space-y-1 text-sm">
          {viewRole?.permissions.sort((a, b) => a.permission.localeCompare(b.permission)).map((p) => (
            <li key={p.permission} className="flex justify-between gap-3 rounded-md bg-surface-2 px-3 py-1.5">
              <span>{PERMISSIONS[p.permission as Permission] ?? p.permission}</span>
              <Badge tone={p.scope === "all" ? "success" : "warning"}>{p.scope === "all" ? "All records" : "Own records only"}</Badge>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

function InviteModal({ open, onClose, roles, onIssued }: { open: boolean; onClose: () => void; roles: Role[]; onIssued: (x: { email: string; url: string }) => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("sales");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => post<{ email: string; url: string }>("/invitations", { email, roleKey }),
    onSuccess: async (r) => { await qc.invalidateQueries(); setEmail(""); onIssued(r); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not create invitation"),
  });
  return (
    <Modal open={open} onClose={onClose} title="Invite a teammate" width={440}>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }} className="space-y-4">
        <ErrorNote message={error} />
        <Field label="Email">{(id) => <Input id={id} type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Role" hint={roles.find((r) => r.key === roleKey)?.description ?? undefined}>
          {(id) => (
            <Select id={id} value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
              {(roles.length ? roles : [{ key: "sales", name: "Sales" } as Role]).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </Select>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={m.isPending}>Create invitation</Button>
        </div>
      </form>
    </Modal>
  );
}
