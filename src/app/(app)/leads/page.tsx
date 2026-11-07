import type { Metadata } from "next";
import { Suspense } from "react";
import { LeadsView } from "@/components/views/leads-view";

export const metadata: Metadata = { title: "Leads" };
export default function Page() {
  return (
    <Suspense>
      <LeadsView />
    </Suspense>
  );
}
