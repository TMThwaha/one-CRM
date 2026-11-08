import { PageHeader } from "@/components/ui";
import { Badge } from "@/components/ui";
import { Empty, Pager, Table, Td, qs, utc } from "@/components/platform/bits";
import { listPlatformUsers } from "@/server/modules/platform-admin/queries.service";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: PageProps<"/super-admin/users">) {
  const raw = await searchParams;
  const q = (Array.isArray(raw.q) ? raw.q[0] : raw.q)?.slice(0, 100) || undefined;
  const pageNum = Number(Array.isArray(raw.page) ? raw.page[0] : raw.page);
  const page = Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1;
  const r = await listPlatformUsers({ q, page });
  return (
    <div className="space-y-4">
      <PageHeader title="Users" description={`${r.total} ${r.total === 1 ? "person" : "people"} with an account on the platform.`} />
      <form method="get" role="search" className="flex gap-2">
        <input type="search" name="q" defaultValue={q} placeholder="Search name or email" aria-label="Search users" className="h-9 w-full max-w-sm rounded-lg border border-border-strong bg-surface px-2.5 text-sm" />
        <button className="h-9 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover" type="submit">Search</button>
      </form>
      <Table head={["Name", "Email", "Companies and roles", "2FA", "Email", "Joined"]} empty={r.rows.length === 0 ? <Empty title="No users match" /> : undefined}>
        {r.rows.map((u) => (
          <tr key={u.id}>
            <Td>{u.name} {u.isPlatformAdmin && <Badge tone="accent" className="ml-1">Super Admin</Badge>} {u.disabled && <Badge tone="danger" className="ml-1">Disabled</Badge>}</Td>
            <Td>{u.email}</Td>
            <Td className="max-w-xs">{u.companies ?? <span className="text-muted">{u.isPlatformAdmin ? "Platform" : "None"}</span>}</Td>
            <Td>{u.mfaEnabled ? "On" : "Off"}</Td>
            <Td>{u.emailVerified ? "Verified" : "Unverified"}</Td>
            <Td>{utc(u.createdAt)}</Td>
          </tr>
        ))}
      </Table>
      <Pager page={r.page} pages={r.pages} total={r.total} pageSize={r.pageSize} href={(p) => `/super-admin/users${qs({ q }, { page: p })}`} />
    </div>
  );
}
