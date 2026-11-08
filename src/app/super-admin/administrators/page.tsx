import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Empty, Section, StatusBadge, Table, Td, utc } from "@/components/platform/bits";
import { listAdministrators } from "@/server/modules/platform-admin/queries.service";

export const metadata = { title: "Company administrators" };

export default async function AdministratorsPage() {
  const { active, pending } = await listAdministrators();
  return (
    <div className="space-y-5">
      <PageHeader title="Company administrators" description="Everyone holding the Company Admin role, across all companies. Change them from each company's page." />
      <Table head={["Name", "Email", "Company", "Company status", "Role status", "2FA"]} empty={active.length === 0 ? <Empty title="No administrators yet" body="They appear here once an invitation is accepted." /> : undefined}>
        {active.map((a) => (
          <tr key={a.membershipId}>
            <Td>{a.name}{a.jobTitle && <p className="text-xs text-muted">{a.jobTitle}</p>}</Td>
            <Td>{a.email}</Td>
            <Td><Link className="text-accent hover:underline" href={`/super-admin/companies/${a.organizationId}`}>{a.company}</Link></Td>
            <Td><StatusBadge status={a.companyStatus} /></Td>
            <Td>{a.status === "active" ? "Active" : "Suspended"}</Td>
            <Td>{a.mfaEnabled ? "On" : "Off"}</Td>
          </tr>
        ))}
      </Table>
      <Section title={`Pending invitations (${pending.length})`}>
        {pending.length === 0 ? <p className="text-sm text-muted">No administrator invitations are waiting.</p> : (
          <Table head={["Invited", "Email", "Company", "Expires"]}>
            {pending.map((p) => (
              <tr key={p.id}>
                <Td>{p.invitedName ?? "—"}</Td>
                <Td>{p.email}</Td>
                <Td><Link className="text-accent hover:underline" href={`/super-admin/companies/${p.organizationId}`}>{p.company}</Link></Td>
                <Td>{utc(p.expiresAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
