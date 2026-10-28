// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import type { IsoDate } from "../dates";
import type { DataGap } from "../finance/types";
import type { Minor } from "../money";

/**
 * How sure we are that a forecast event will happen.
 *   confirmed  – already recorded money movement (only future-dated records)
 *   scheduled  – an obligation the business has committed to (open bills, planned rent)
 *   expected   – money owed to the business that is not yet overdue (assumed paid on the due date)
 *   uncertain  – overdue receivables, projections from past sales; excluded from the main line by default
 */
export const CONFIDENCE_LEVELS = ["confirmed", "scheduled", "expected", "uncertain"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export type ForecastCategory =
  | "customer_collection"
  | "supplier_payment"
  | "planned_expense"
  | "planned_income"
  | "loan_repayment"
  | "projected_sales"
  | "projected_purchases"
  | "scenario";

export interface ForecastEvent {
  /** Stable reference used by scenarios: invoice:<id>, bill:<id>, scheduled:<id>:<date>, sales:<date>, scenario:<n> */
  ref: string;
  date: IsoDate;
  /** Signed: positive = money in, negative = money out. */
  amount: Minor;
  label: string;
  category: ForecastCategory;
  confidence: Confidence;
  /** Plain-language assumption behind this event's date/amount. */
  assumption?: string;
  source?: { type: "invoice" | "bill" | "scheduled" | "projection" | "scenario"; id?: string };
  /** Free-text category for scenario items (e.g. "Stock purchases"). */
  tag?: string;
}

/** Shape returned by the get_forecast_inputs RPC. */
export interface ForecastInputs {
  as_of: IsoDate;
  business: {
    id: string;
    name: string;
    currency: string;
    is_demo: boolean;
    min_cash_reserve_minor: Minor | null;
    opening_balance_set: boolean;
  };
  cash_balance_minor: Minor;
  future_dated_cash_minor: Minor;
  open_invoices: {
    id: string;
    number: string;
    customer_id: string;
    customer_name: string;
    issue_date: IsoDate;
    due_date: IsoDate;
    outstanding_minor: Minor;
  }[];
  open_bills: {
    id: string;
    number: string;
    supplier_id: string;
    supplier_name: string;
    kind: "inventory" | "expense";
    due_date: IsoDate;
    outstanding_minor: Minor;
  }[];
  scheduled_events: {
    id: string;
    direction: "in" | "out";
    label: string;
    category: string | null;
    amount_minor: Minor;
    start_date: IsoDate;
    recurrence: "none" | "weekly" | "monthly";
    end_date: IsoDate | null;
    confidence: Exclude<Confidence, "confirmed">;
    settled_dates: IsoDate[];
  }[];
  trailing_sales: {
    days: number;
    cash_sales_minor: Minor;
    credit_sales_minor: Minor;
    stock_purchases_minor: Minor;
    first_txn_date: IsoDate | null;
  };
}

export interface ForecastOptions {
  today: IsoDate;
  horizonDays: number;
  /** Add projected daily sales/purchases from recent history (uncertain). Off by default. */
  includeProjectedSales?: boolean;
}

export interface ForecastDay {
  date: IsoDate;
  inflow: Minor;
  outflow: Minor;
  closing: Minor;
  refs: string[];
}

export interface ForecastResult {
  start: IsoDate;
  end: IsoDate;
  openingCash: Minor;
  closingCash: Minor;
  totalInflow: Minor;
  totalOutflow: Minor;
  minBalance: Minor;
  minBalanceDate: IsoDate;
  /** First day the projected balance goes below zero, if any. */
  firstShortfallDate: IsoDate | null;
  /** Most negative projected balance (0 if never negative). */
  worstShortfall: Minor;
  /** First day the projected balance goes below the minimum reserve, if a reserve is set. */
  firstBelowReserveDate: IsoDate | null;
  reserve: Minor | null;
  days: ForecastDay[];
  included: ForecastEvent[];
  excluded: ForecastEvent[];
  includedConfidence: Confidence[];
}

export interface BaselineForecast {
  events: ForecastEvent[];
  assumptions: string[];
  gaps: DataGap[];
}
