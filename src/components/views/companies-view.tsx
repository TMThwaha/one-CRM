"use client";

import { Building2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CompanyModal } from "@/components/forms";
import { DataTable, ListEmpty, SearchBox, useList, type Column } from "@/components/list-kit";
import { useCan } from "@/components/session";
import { Button, PageHeader } from "@/components/ui";
import { relativeTime } from "@/lib/format";

interface Row {
  id: string; name: string; domain: string | null; industry: string | null; city: string | null; country: string | null;
  contactCount: number; updatedAt: string;
}

export function CompaniesView() {
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const { q, setQ, page, setPage, pageSize, query } = useList<Row>("companies", "/companies");

  const columns: Column<Row>[] = [
    { header: "Company", cell: (c) => (
      <div>
        <Link href={`/companies/${c.id}`} className="font-medium hover:text-accent hover:underline">{c.name}</Link>
        {c.domain && <p className="text-xs text-muted">{c.domain}</p>}
      </div>
    ) },
    { header: "Industry", hideBelow: "sm", cell: (c) => c.industry ?? <span className="text-faint">—</span> },
    { header: "Location", hideBelow: "md", cell: (c) => [c.city, c.country].filter(Boolean).join(", ") || <span className="text-faint">—</span> },
    { header: "Contacts", className: "tabular", cell: (c) => c.contactCount },
    { header: "Updated", hideBelow: "md", className: "text-muted whitespace-nowrap", cell: (c) => relativeTime(c.updatedAt) },
  ];

  return (
    <>
      <PageHeader
        title="Companies"
        description="Organizations your contacts and deals belong to."
        actions={can("company.write") && <Button variant="primary" onClick={() => setCreating(true)}>New company</Button>}
      />
      <div className="mb-3"><SearchBox value={q} onChange={setQ} placeholder="Search name, domain or industry" /></div>
      <DataTable
        columns={columns}
        rows={query.data?.items}
        loading={query.isLoading}
        empty={<ListEmpty filtered={Boolean(q)} title="No companies yet" body="Add the organizations you work with to keep contacts and deals together." action={can("company.write") ? <Button variant="primary" onClick={() => setCreating(true)}><Building2 className="h-4 w-4" />New company</Button> : undefined} />}
        pagination={query.data ? { page, pageSize, total: query.data.total, onPage: setPage } : undefined}
      />
      <CompanyModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
