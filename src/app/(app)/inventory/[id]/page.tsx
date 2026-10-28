// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { randomUUID } from "node:crypto";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OpeningStockForm, ProductForm, StockAdjustmentForm } from "@/components/forms/inventory-forms";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { Table, Td, Th } from "@/components/ui/table";
import { formatDate } from "@/core/dates";
import { archiveProduct } from "@/lib/actions/records";
import { canManage, requireBusiness } from "@/lib/context";
import { getProduct, listSuppliers } from "@/lib/data/records";

export const metadata: Metadata = { title: "Product" };

const MOVEMENT_LABEL: Record<string, string> = {
  opening: "Opening stock",
  purchase: "Bought",
  sale: "Sold",
  adjustment: "Adjustment",
  return: "Returned",
  void_reversal: "Reversal (voided record)",
};

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireBusiness();
  const [{ product, movements }, suppliers] = await Promise.all([getProduct(ctx, id), listSuppliers(ctx)]);
  if (!product) notFound();
  const currency = ctx.business.currency;
  const avg = product.quantity_on_hand > 0 ? Math.round(product.inventory_value_minor / product.quantity_on_hand) : null;
  const low = product.quantity_on_hand <= product.low_stock_threshold;

  return (
    <>
      <Link href="/inventory" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Inventory
      </Link>
      <PageHeader
        title={product.name}
        description={product.sku ? `SKU ${product.sku}` : undefined}
        actions={
          <form action={archiveProduct}>
            <input type="hidden" name="id" value={product.id} />
            <input type="hidden" name="archive" value={product.archived_at ? "false" : "true"} />
            <Button variant="secondary" type="submit">
              {product.archived_at ? "Restore" : "Archive"}
            </Button>
          </form>
        }
      />
      {saved && <Notice tone="success" className="mb-4">Product saved.</Notice>}
      {product.archived_at && <Notice tone="info" className="mb-4">This product is archived. It is hidden from sales forms but its history is kept.</Notice>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Box label="In stock" value={<span className={low ? "text-warning" : ""}>{product.quantity_on_hand}</span>} hint={`Warn at ${product.low_stock_threshold}`} />
        <Box label="Selling price" value={<Money value={product.selling_price_minor} currency={currency} />} />
        <Box label="Average cost" value={avg === null ? "—" : <Money value={avg} currency={currency} />} hint={avg !== null && product.selling_price_minor > 0 ? `Margin ${Math.round(((product.selling_price_minor - avg) / product.selling_price_minor) * 100)}%` : undefined} />
        <Box label="Stock value" value={<Money value={product.inventory_value_minor} currency={currency} />} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Stock movement history" description="Every change to the quantity, newest first" />
          {movements.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-muted">No stock recorded yet.</p>
            </CardBody>
          ) : (
            <Table caption="Stock movements">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Movement</Th>
                  <Th align="right">Change</Th>
                  <Th align="right">After</Th>
                  <Th align="right">Value change</Th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <Td className="whitespace-nowrap text-ink-soft">{formatDate(m.movement_date)}</Td>
                    <Td>
                      <Link href={`/transactions/${m.transaction_id}`} className="hover:text-brand hover:underline">
                        {MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}
                      </Link>
                      {m.note && <span className="block text-xs text-ink-muted">{m.note}</span>}
                    </Td>
                    <Td align="right" className={m.quantity_delta < 0 ? "text-danger" : "text-positive"}>
                      {m.quantity_delta > 0 ? "+" : ""}
                      {m.quantity_delta}
                    </Td>
                    <Td align="right">{m.quantity_after}</Td>
                    <Td align="right"><Money value={Number(m.value_delta_minor)} signed currency={currency} className="text-ink-soft" /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-5 lg:col-span-2">
          {movements.length === 0 ? (
            <Card>
              <CardHeader title="Opening stock" description="How many you already have before using BizPilot" />
              <CardBody>
                <OpeningStockForm productId={product.id} today={ctx.today} idempotencyKey={randomUUID()} defaultCost={product.last_unit_cost_minor} />
              </CardBody>
            </Card>
          ) : (
            canManage(ctx.business) && (
              <Card>
                <CardHeader title="Adjust stock" description="After a count, or for damaged or lost items" />
                <CardBody>
                  <StockAdjustmentForm productId={product.id} today={ctx.today} idempotencyKey={randomUUID()} onHand={product.quantity_on_hand} />
                </CardBody>
              </Card>
            )
          )}
          <Card>
            <CardHeader title="Edit product" />
            <CardBody>
              <ProductForm suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} product={product} idempotencyKey={randomUUID()} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function Box({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
      <p className="text-[13px] font-medium text-ink-soft">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
