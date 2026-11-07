import type { Metadata } from "next";
import { CompaniesView } from "@/components/views/companies-view";

export const metadata: Metadata = { title: "Companies" };
export default function Page() {
  return <CompaniesView />;
}
