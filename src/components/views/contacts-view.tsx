"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ContactModal } from "@/components/forms";
import { DataTable, ListEmpty, SearchBox, useList, type Column } from "@/components/list-kit";
import { useCan } from "@/components/session";
import { Badge, Button, PageHeader } from "@/components/ui";
import { fullName, relativeTime } from "@/lib/format";

interface Row {
  id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null; jobTitle: string | null;
  companyId: string | null; companyName: string | null; tags: string[]; updatedAt: string;
}

export function ContactsView() {
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const { q, setQ, page, setPage, pageSize, query } = useList<Row>("contacts", "/contacts");

  const columns: Column<Row>[] = [
    { header: "Name", cell: (c) => (
      <div>
        <Link href={`/contacts/${c.id}`} className="font-medium hover:text-accent hover:underline">{fullName(c.firstName, c.lastName)}</Link>
        {c.jobTitle && <p className="text-xs text-muted">{c.jobTitle}</p>}
      </div>
    ) },
    { header: "Company", hideBelow: "sm", cell: (c) => c.companyId ? <Link href={`/companies/${c.companyId}`} className="hover:underline">{c.companyName}</Link> : <span className="text-faint">—</span> },
    { header: "Email", hideBelow: "md", cell: (c) => c.email ?? <span className="text-faint">—</span> },
    { header: "Phone", hideBelow: "lg", cell: (c) => c.phone ?? <span className="text-faint">—</span> },
    { header: "Tags", hideBelow: "lg", cell: (c) => <div className="flex gap-1">{c.tags.slice(0, 2).map((t) => <Badge key={t}>{t}</Badge>)}</div> },
    { header: "Updated", hideBelow: "md", className: "text-muted whitespace-nowrap", cell: (c) => relativeTime(c.updatedAt) },
  ];

  return (
    <>
      <PageHeader
        title="Contacts"
        description="People you do business with. One record per person, shared across the team."
        actions={can("contact.write") && <Button variant="primary" onClick={() => setCreating(true)}>New contact</Button>}
      />
      <div className="mb-3"><SearchBox value={q} onChange={setQ} placeholder="Search name, email, phone or company" /></div>
      <DataTable
        columns={columns}
        rows={query.data?.items}
        loading={query.isLoading}
        empty={<ListEmpty filtered={Boolean(q)} title="No contacts yet" body="Add your first contact, or convert a lead." action={can("contact.write") ? <Button variant="primary" onClick={() => setCreating(true)}><Users className="h-4 w-4" />New contact</Button> : undefined} />}
        pagination={query.data ? { page, pageSize, total: query.data.total, onPage: setPage } : undefined}
      />
      <ContactModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
