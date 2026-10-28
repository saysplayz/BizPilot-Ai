// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import { addDays, type IsoDate } from "../../src/core/dates";
import type { ForecastInputs } from "../../src/core/forecast/types";

/** Mirrors the database demo business (supabase/migrations/..._demo.sql). */
export function demoInputs(today: IsoDate): ForecastInputs {
  return {
    as_of: today,
    business: {
      id: "biz-demo",
      name: "Kofi's Phone Hub (Demo)",
      currency: "GHS",
      is_demo: true,
      min_cash_reserve_minor: 50_000,
      opening_balance_set: true,
    },
    cash_balance_minor: 300_000,
    future_dated_cash_minor: 0,
    open_invoices: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        number: "INV-00021",
        customer_id: "c-ama",
        customer_name: "Ama Mensah",
        issue_date: addDays(today, -4),
        due_date: addDays(today, 10),
        outstanding_minor: 200_000,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        number: "INV-00013",
        customer_id: "c-yaw",
        customer_name: "Yaw Boateng",
        issue_date: addDays(today, -13),
        due_date: addDays(today, -6),
        outstanding_minor: 45_000,
      },
    ],
    open_bills: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        number: "BILL-00003",
        supplier_id: "s-agw",
        supplier_name: "Accra Gadget Wholesale",
        kind: "inventory",
        due_date: addDays(today, 5),
        outstanding_minor: 150_000,
      },
    ],
    scheduled_events: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        direction: "out",
        label: "Shop rent",
        category: "Rent",
        amount_minor: 100_000,
        start_date: addDays(today, 3),
        recurrence: "monthly",
        end_date: null,
        confidence: "scheduled",
        settled_dates: [],
      },
    ],
    trailing_sales: {
      days: 28,
      cash_sales_minor: 840_000,
      credit_sales_minor: 245_000,
      stock_purchases_minor: 280_000,
      first_txn_date: addDays(today, -45),
    },
  };
}
