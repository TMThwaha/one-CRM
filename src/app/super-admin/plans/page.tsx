import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui";
import { Table, Td } from "@/components/platform/bits";
import { listPlans } from "@/server/modules/platform-admin/queries.service";

export const metadata = { title: "Subscriptions and plans" };

const unset = <span className="text-muted">Not set</span>;

export default async function PlansPage() {
  const plans = await listPlans();
  return (
    <div className="space-y-4">
      <PageHeader title="Subscriptions and plans" description="Assign a plan to each company when you create or edit it." />
      <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
        Plan names exist so companies can be assigned one. Pricing, employee and storage limits, module entitlements, trials and payment collection are <strong className="text-fg">not built yet</strong>:
        no limit is enforced and no payment is taken. These columns stay &ldquo;Not set&rdquo; until that work is done.
      </p>
      <Table head={["Plan", "Status", "Monthly price", "Annual price", "Employee limit", "Storage limit", "Companies"]}>
        {plans.map((p) => (
          <tr key={p.id}>
            <Td className="font-medium">{p.name}</Td>
            <Td><Badge tone={p.isActive ? "success" : "neutral"}>{p.isActive ? "Available" : "Retired"}</Badge></Td>
            <Td>{p.monthlyPrice ? `${p.priceCurrency ?? ""} ${p.monthlyPrice}` : unset}</Td>
            <Td>{p.annualPrice ? `${p.priceCurrency ?? ""} ${p.annualPrice}` : unset}</Td>
            <Td>{p.maxEmployees ?? unset}</Td>
            <Td>{p.maxStorageMb ? `${p.maxStorageMb} MB` : unset}</Td>
            <Td className="tabular-nums">{p.companies > 0 ? <Link className="text-accent hover:underline" href={`/super-admin/companies?plan=${p.id}`}>{p.companies}</Link> : 0}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
