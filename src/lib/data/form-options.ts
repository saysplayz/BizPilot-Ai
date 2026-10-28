// BizPilot AI · Part 1 — Database & Security
// Owner: Member 1 (see TEAM.md)
import "server-only";
import { formatMoney } from "@/core/money";
import type { AppContext } from "@/lib/context";
import { getForecast, getPayables, getReceivables } from "./finance";
import { listCustomers, listFinancialAccounts, listLoans, listProducts, listSuppliers } from "./records";

/** Everything the "Record" forms need, loaded in parallel. */
export async function loadFormOptions(ctx: AppContext) {
  const [products, customers, suppliers, accounts, receivables, payables, loans, forecast] = await Promise.all([
    listProducts(ctx),
    listCustomers(ctx),
    listSuppliers(ctx),
    listFinancialAccounts(ctx),
    getReceivables(ctx),
    getPayables(ctx),
    listLoans(ctx),
    getForecast(ctx, 45),
  ]);

  // Planned payments that can be settled by an expense: past-due or upcoming, unsettled.
  const planned = forecast.baseline.events
    .filter((e) => e.source?.type === "scheduled" && e.amount < 0 && e.source.id)
    .map((e) => {
      const date = e.ref.split(":").at(-1)!;
      return { event_id: e.source!.id!, date, label: e.label.replace(/ \(due .*\)$/, ""), amount_minor: -e.amount };
    })
    .slice(0, 20);

  return {
    products: products.map((p) => ({ id: p.id, name: p.name, selling_price_minor: p.selling_price_minor, last_unit_cost_minor: p.last_unit_cost_minor, quantity_on_hand: p.quantity_on_hand })),
    customers: customers.map((c) => ({ id: c.id, name: c.name })),
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    invoices: receivables.map((r) => ({ id: r.invoice_id, number: r.invoice_number, customer_id: r.customer_id, outstanding_minor: r.outstanding_minor, due_date: r.due_date })),
    bills: payables.map((b) => ({ id: b.bill_id, number: b.bill_number, supplier_id: b.supplier_id, outstanding_minor: b.outstanding_minor, due_date: b.due_date })),
    loans: loans.map((l) => ({ id: l.id, name: `${l.lender} (${formatMoney(Number(l.principal_minor))})` })),
    planned,
  };
}
