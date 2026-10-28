// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import type { PaymentMethod, TxnType } from "@/core/finance/types";

/** Plain-language names for transaction types. */
export const TXN_LABEL: Record<TxnType, string> = {
  opening_balance: "Opening balance",
  cash_sale: "Sale (paid)",
  credit_sale: "Sale on credit",
  customer_payment: "Customer payment",
  inventory_purchase: "Stock bought",
  supplier_bill: "Supplier bill",
  operating_expense: "Expense",
  supplier_payment: "Paid supplier",
  loan_proceeds: "Loan received",
  loan_repayment: "Loan repayment",
  owner_contribution: "Owner added money",
  owner_withdrawal: "Owner took money",
  refund: "Refund",
  transfer: "Transfer",
  stock_adjustment: "Stock adjustment",
  void_reversal: "Reversal",
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  mobile_money: "Mobile Money",
  bank_transfer: "Bank transfer",
  card: "Card",
  other: "Other",
};

/** How a transaction affects cash, for the +/− sign in lists. */
export function cashDirection(type: TxnType): "in" | "out" | "none" {
  switch (type) {
    case "cash_sale":
    case "customer_payment":
    case "loan_proceeds":
    case "owner_contribution":
    case "opening_balance":
      return "in";
    case "inventory_purchase":
    case "operating_expense":
    case "supplier_payment":
    case "loan_repayment":
    case "owner_withdrawal":
    case "refund":
      return "out";
    default:
      return "none";
  }
}

export const LEDGER_LABEL: Record<string, string> = {
  cash: "Cash / MoMo / bank",
  accounts_receivable: "Customers owe you",
  inventory: "Stock",
  accounts_payable: "You owe suppliers",
  loans_payable: "Loans owed",
  owner_equity: "Owner's money",
  opening_balance_equity: "Opening balances",
  sales_revenue: "Sales",
  sales_returns: "Refunds",
  cogs: "Cost of goods sold",
  operating_expense: "Expenses",
  interest_expense: "Loan interest",
  inventory_adjustment: "Stock losses / gains",
};
