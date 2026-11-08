import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Table, Td } from "@/components/platform/bits";
import { COUNTRIES } from "@/shared/countries";
import { companiesByCountry } from "@/server/modules/platform-admin/queries.service";

export const metadata = { title: "Countries and regions" };

export default async function CountriesPage() {
  const counts = new Map((await companiesByCountry()).map((r) => [r.country, r.n]));
  const rows = [...COUNTRIES].sort((a, b) => (counts.get(b.code) ?? 0) - (counts.get(a.code) ?? 0) || a.name.localeCompare(b.name));
  return (
    <div className="space-y-4">
      <PageHeader title="Countries and regions" description="Defaults offered when you create a company. Each company stores its own copy and can override any value." />
      <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
        Tax identifiers are labels only. OneCRM stores what a company enters; it does not calculate, file or certify tax, and makes no claim of regional legal compliance.
      </p>
      <Table head={["Country", "Currency", "Default time zone", "Phone", "Language", "Date format", "Tax identifier label", "Companies"]}>
        {rows.map((c) => {
          const n = counts.get(c.code) ?? 0;
          return (
            <tr key={c.code}>
              <Td className="font-medium">{c.name}</Td>
              <Td>{c.currency}</Td>
              <Td>{c.timeZone}</Td>
              <Td>{c.phoneCode}</Td>
              <Td>{c.locale}</Td>
              <Td>{c.dateFormat}</Td>
              <Td>{c.taxLabel}</Td>
              <Td className="tabular-nums">{n > 0 ? <Link className="text-accent hover:underline" href={`/super-admin/companies?country=${c.code}`}>{n}</Link> : 0}</Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
