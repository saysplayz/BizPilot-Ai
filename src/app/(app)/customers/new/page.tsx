// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import type { Metadata } from "next";
import { CustomerForm } from "@/components/forms/people-forms";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { requireBusiness } from "@/lib/context";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  await requireBusiness();
  const { return_to } = await searchParams;
  const safeReturn = return_to && return_to.startsWith("/") && !return_to.startsWith("//") ? return_to : undefined;
  return (
    <>
      <PageHeader title="New customer" />
      <Card className="max-w-xl">
        <CardBody className="py-5">
          <CustomerForm returnTo={safeReturn} />
        </CardBody>
      </Card>
    </>
  );
}
