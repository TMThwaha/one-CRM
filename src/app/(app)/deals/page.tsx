import type { Metadata } from "next";
import { DealsView } from "@/components/views/deals-view";

export const metadata: Metadata = { title: "Deals" };
export default function Page() {
  return <DealsView />;
}
