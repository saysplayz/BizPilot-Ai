// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { Package, Plus, Search, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-styles";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import { Money } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td, Th } from "@/components/ui/table";
import { requireBusiness } from "@/lib/context";
import { getProductVelocity } from "@/lib/data/finance";
import { listProducts } from "@/lib/data/records";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireBusiness();
  const q = sp.q?.slice(0, 100);
  const [products, velocity] = await Promise.all([listProducts(ctx, { q, includeArchived: sp.show === "archived" }), getProductVelocity(ctx, 30)]);
  const sold = new Map(velocity.map((v) => [v.product_id, v.units_sold]));
  const rows = sp.show === "low" ? products.filter((p) => p.quantity_on_hand <= p.low_stock_threshold && !p.archived_at) : sp.show === "archived" ? products.filter((p) => p.archived_at) : products;
  const active = products.filter((p) => !p.archived_at);
  const totalValue = active.reduce((s, p) => s + p.inventory_value_minor, 0);
  const lowCount = active.filter((p) => p.quantity_on_hand <= p.low_stock_threshold).length;
  const missingCost = active.filter((p) => p.quantity_on_hand > 0 && p.inventory_value_minor === 0).length;

  const withSales = velocity.filter((v) => v.units_sold > 0).sort((a, b) => b.units_sold - a.units_sold);
  const enoughHistory = withSales.length >= 3;
  const fast = enoughHistory ? withSales.slice(0, 3) : [];
  const slow = enoughHistory ? velocity.filter((v) => v.quantity_on_hand > 0).sort((a, b) => a.units_sold - b.units_sold).slice(0, 3) : [];

  const filter = (key: string, label: string) => (
    <Link href={key === "all" ? "/inventory" : `/inventory?show=${key}`} className={cn("rounded-md px-2.5 py-1.5 text-sm font-medium", (sp.show ?? "all") === key ? "bg-brand-soft text-brand-strong" : "text-ink-soft hover:text-ink")}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock is valued at weighted-average cost."
        actions={
          <>
            <LinkButton href="/reports/import?kind=products" variant="secondary">
              <Upload className="size-4" aria-hidden /> Import
            </LinkButton>
            <LinkButton href="/transactions/new?type=stock" variant="secondary">
              Record stock bought
            </LinkButton>
            <LinkButton href="/inventory/new">
              <Plus className="size-4" aria-hidden /> Add product
            </LinkButton>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard plainLabel="Stock value (at cost)" term="Inventory valuation" value={totalValue} currency={ctx.business.currency} estimate={missingCost > 0} hint={missingCost > 0 ? `${missingCost} product(s) have no cost` : undefined} />
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
          <p className="text-[13px] font-medium text-ink-soft">Products</p>
          <p className="text-2xl font-semibold">{active.length}</p>
        </div>
        <Link href="/inventory?show=low" className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] hover:border-line-strong">
          <p className="text-[13px] font-medium text-ink-soft">Running low</p>
          <p className={cn("text-2xl font-semibold", lowCount > 0 && "text-warning")}>{lowCount}</p>
        </Link>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
          <p className="text-[13px] font-medium text-ink-soft">Units sold (30 days)</p>
          <p className="text-2xl font-semibold">{velocity.reduce((s, v) => s + v.units_sold, 0)}</p>
        </div>
      </div>

      {enoughHistory && (
        <div className="mb-5 grid gap-5 md:grid-cols-2">
          <Card>
            <CardHeader title="Fast movers" description="Most units sold in 30 days" />
            <CardBody className="space-y-1.5 text-sm">
              {fast.map((v) => (
                <p key={v.product_id} className="flex justify-between">
                  <span>{v.name}</span>
                  <span className="font-medium">{v.units_sold} sold</span>
                </p>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Slow movers" description="In stock but rarely sold — cash tied up" />
            <CardBody className="space-y-1.5 text-sm">
              {slow.map((v) => (
                <p key={v.product_id} className="flex justify-between">
                  <span>{v.name}</span>
                  <span className="text-ink-soft">
                    {v.units_sold} sold · {v.quantity_on_hand} in stock
                  </span>
                </p>
              ))}
            </CardBody>
          </Card>
        </div>
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Filter" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {filter("all", "All")}
          {filter("low", "Low stock")}
          {filter("archived", "Archived")}
        </nav>
        <form method="get" role="search" className="flex gap-2">
          {sp.show && <input type="hidden" name="show" value={sp.show} />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Name, SKU or barcode" className="pl-9" aria-label="Search products" />
          </div>
          <button className={buttonClass("secondary")}>Search</button>
        </form>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Package className="size-6" />} title={q || sp.show ? "No matching products" : "No products yet"} action={<LinkButton href="/inventory/new">Add your first product</LinkButton>}>
            Add the items you sell with their price and cost. BizPilot will track stock as you record sales and purchases.
          </EmptyState>
        ) : (
          <Table caption="Products">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th align="right">In stock</Th>
                <Th align="right">Price</Th>
                <Th align="right">Avg cost</Th>
                <Th align="right">Stock value</Th>
                <Th align="right">Sold (30d)</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const low = p.quantity_on_hand <= p.low_stock_threshold;
                const avg = p.quantity_on_hand > 0 ? Math.round(p.inventory_value_minor / p.quantity_on_hand) : p.last_unit_cost_minor;
                return (
                  <tr key={p.id} className="hover:bg-canvas/50">
                    <Td>
                      <Link href={`/inventory/${p.id}`} className="font-medium hover:text-brand hover:underline">
                        {p.name}
                      </Link>
                      {p.sku && <span className="ml-2 text-xs text-ink-muted">{p.sku}</span>}
                      {p.archived_at && <Badge className="ml-2">Archived</Badge>}
                    </Td>
                    <Td align="right">
                      <span className={cn("font-medium", p.quantity_on_hand === 0 ? "text-danger" : low ? "text-warning" : "")}>{p.quantity_on_hand}</span>
                      {low && !p.archived_at && <span className="sr-only"> (low stock)</span>}
                    </Td>
                    <Td align="right"><Money value={p.selling_price_minor} currency={ctx.business.currency} /></Td>
                    <Td align="right"><Money value={avg} currency={ctx.business.currency} className="text-ink-soft" /></Td>
                    <Td align="right"><Money value={p.inventory_value_minor} currency={ctx.business.currency} /></Td>
                    <Td align="right">{sold.get(p.id) ?? 0}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
