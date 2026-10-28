// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import type { IsoDate } from "../dates";
import type { Minor } from "../money";

/** Ledger accounts — mirrors the `ledger_account` enum in the database. */
export const LEDGER_ACCOUNTS = [
  "cash",
  "accounts_receivable",
  "inventory",
  "accounts_payable",
  "loans_payable",
  "owner_equity",
  "opening_balance_equity",
  "sales_revenue",
  "sales_returns",
  "cogs",
  "operating_expense",
  "interest_expense",
  "inventory_adjustment",
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

/** Transaction types — mirrors the `txn_type` enum. */
export const TXN_TYPES = [
  "opening_balance",
  "cash_sale",
  "credit_sale",
  "customer_payment",
  "inventory_purchase",
  "supplier_bill",
  "operating_expense",
  "supplier_payment",
  "loan_proceeds",
  "loan_repayment",
  "owner_contribution",
  "owner_withdrawal",
  "refund",
  "transfer",
  "stock_adjustment",
  "void_reversal",
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const PAYMENT_METHODS = ["cash", "mobile_money", "bank_transfer", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const BUSINESS_TYPES = ["electronics", "clothing", "cosmetics", "minimart", "wholesale", "other"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Debit-positive balance per ledger account (as returned by get_account_balances). */
export type AccountBalances = Partial<Record<LedgerAccount, Minor>>;

/** Period activity row (as returned by get_period_activity). */
export interface ActivityRow {
  account: LedgerAccount;
  category: string | null;
  amount_minor: Minor;
}

/** A known gap in the data that makes a figure incomplete or estimated. */
export interface DataGap {
  code:
    | "no_opening_balance"
    | "no_transactions"
    | "sales_without_cost"
    | "negative_cash"
    | "no_upcoming_obligations"
    | "short_history"
    | "future_dated_records";
  message: string;
}

export interface Period {
  from: IsoDate;
  to: IsoDate;
}
