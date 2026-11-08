import { PageHeader } from "@/components/ui";
import { CreateCompanyWizard } from "@/components/platform/company-form";
import { listPlans } from "@/server/modules/platform-admin/queries.service";

export const metadata = { title: "Create company" };

export default async function NewCompanyPage() {
  const plans = (await listPlans()).filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name }));
  return (
    <div className="space-y-5">
      <PageHeader title="Create company" description="Set up a new company workspace and appoint its administrator." />
      <CreateCompanyWizard plans={plans} />
    </div>
  );
}
