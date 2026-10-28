// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import type { Metadata } from "next";
import { SupplierForm } from "@/components/forms/people-forms";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { requireBusiness } from "@/lib/context";

export const metadata: Metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  await requireBusiness();
  return (
    <>
      <PageHeader title="New supplier" />
      <Card className="max-w-xl">
        <CardBody className="py-5">
          <SupplierForm />
        </CardBody>
      </Card>
    </>
  );
}
