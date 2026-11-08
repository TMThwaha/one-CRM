import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RolesView } from "@/components/views/roles-view";
import { requireAuth } from "@/server/http/session";

export const metadata: Metadata = { title: "Roles and permissions" };

export default async function RolesPage() {
  const ctx = await requireAuth();
  // The API enforces this too; here it just avoids rendering a page that could only show errors.
  if (ctx.permissions["role.read"] === undefined) notFound();
  return <RolesView />;
}
