// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { ProductForm } from "@/components/forms/inventory-forms";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { requireBusiness } from "@/lib/context";
import { listSuppliers } from "@/lib/data/records";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const ctx = await requireBusiness();
  const suppliers = await listSuppliers(ctx);
  return (
    <>
      <PageHeader title="Add product" />
      <Card className="max-w-2xl">
        <CardBody className="py-5">
          <ProductForm suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} idempotencyKey={randomUUID()} />
        </CardBody>
      </Card>
    </>
  );
}
