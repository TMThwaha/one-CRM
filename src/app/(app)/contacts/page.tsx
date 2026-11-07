import type { Metadata } from "next";
import { ContactsView } from "@/components/views/contacts-view";

export const metadata: Metadata = { title: "Contacts" };
export default function Page() {
  return <ContactsView />;
}
