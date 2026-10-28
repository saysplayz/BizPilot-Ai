// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePosition, computeProfit, expenseSpike, monthlyTrends } from "../../src/core/finance/metrics";
import type { ActivityRow } from "../../src/core/finance/types";

const period = { from: "2026-10-01", to: "2026-10-28" };

// Ledger activity as the database returns it (debit +, credit −) for a month with:
// cash sale 3,000 (cost 2,000), credit sale 1,500 (cost 1,100), refund 150,
// expenses: rent 1,000 + transport 80, stock loss 20, loan 5,000 received,
// loan repayment 1,000 principal + 50 interest, owner put in 500, transfer 300.
const activity: ActivityRow[] = [
  { account: "sales_revenue", category: "Sales", amount_minor: -450_000 },
  { account: "sales_returns", category: "Refunds", amount_minor: 15_000 },
  { account: "cogs", category: null, amount_minor: 310_000 },
  { account: "operating_expense", category: "Rent", amount_minor: 100_000 },
  { account: "operating_expense", category: "Transport", amount_minor: 8_000 },
  { account: "inventory_adjustment", category: "Stock loss", amount_minor: 2_000 },
  { account: "interest_expense", category: "Loan interest", amount_minor: 5_000 },
  // Balance-sheet movements that must NOT affect profit:
  { account: "loans_payable", category: null, amount_minor: -400_000 },
  { account: "owner_equity", category: null, amount_minor: -50_000 },
  { account: "cash", category: null, amount_minor: 123_456 },
];

describe("profit metrics (single source of truth)", () => {
  it("derives sales, gross profit and net operating profit", () => {
    const p = computeProfit({ period, activity });
    assert.equal(p.grossSales, 450_000);
    assert.equal(p.returns, 15_000);
    assert.equal(p.netSales, 435_000);
    assert.equal(p.cogs, 310_000);
    assert.equal(p.grossProfit, 125_000);
    assert.equal(p.operatingExpenses, 108_000);
    assert.equal(p.stockLosses, 2_000);
    assert.equal(p.netOperatingProfit, 15_000);
    assert.equal(p.interest, 5_000);
    assert.equal(p.netProfitAfterInterest, 10_000);
    assert.deepEqual(p.expensesByCategory.map((e) => e.category), ["Rent", "Transport"]);
  });

  it("5/6/7. loans, loan principal, owner money and transfers never change profit", () => {
    const base = computeProfit({ period, activity: activity.filter((a) => a.account !== "loans_payable" && a.account !== "owner_equity" && a.account !== "cash") });
    const withBalanceSheet = computeProfit({ period, activity });
    assert.equal(withBalanceSheet.netSales, base.netSales);
    assert.equal(withBalanceSheet.netOperatingProfit, base.netOperatingProfit);
    // Interest is separated from operating profit.
    assert.equal(base.netOperatingProfit - base.netProfitAfterInterest, 5_000);
  });

  it("14. flags profit as an estimate when sales lack cost instead of hiding it", () => {
    const p = computeProfit({ period, activity, uncostedSalesMinor: 50_000 });
    assert.equal(p.isEstimate, true);
    assert.equal(p.gaps[0]?.code, "sales_without_cost");
  });
});

describe("financial position", () => {
  it("separates cash from receivables, stock, payables and loans", () => {
    const pos = computePosition(
      { cash: 300_000, accounts_receivable: 245_000, inventory: 900_000, accounts_payable: -150_000, loans_payable: -400_000 },
      { openingBalanceSet: true, hasTransactions: true },
    );
    assert.equal(pos.cash, 300_000);
    assert.equal(pos.receivables, 245_000);
    assert.equal(pos.payables, 150_000);
    assert.equal(pos.loans, 400_000);
    assert.equal(pos.netWorth, 300_000 + 245_000 + 900_000 - 150_000 - 400_000);
    assert.equal(pos.gaps.length, 0);
  });

  it("14. explains missing data rather than presenting a fabricated figure", () => {
    const pos = computePosition({ cash: -5_000 }, { openingBalanceSet: false, hasTransactions: false });
    const codes = pos.gaps.map((g) => g.code).sort();
    assert.deepEqual(codes, ["negative_cash", "no_opening_balance", "no_transactions"]);
    for (const g of pos.gaps) assert.ok(g.message.length > 20);
  });
});

describe("trends and spikes", () => {
  it("builds monthly trends with the same definitions", () => {
    const t = monthlyTrends([
      { month: "2026-09-01", account: "sales_revenue", amount_minor: -100_000 },
      { month: "2026-09-01", account: "cogs", amount_minor: 60_000 },
      { month: "2026-10-01", account: "sales_revenue", amount_minor: -200_000 },
      { month: "2026-10-01", account: "operating_expense", amount_minor: 30_000 },
    ]);
    assert.deepEqual(t.map((x) => x.netOperatingProfit), [40_000, 170_000]);
  });

  it("detects unusual spending only when material", () => {
    assert.equal(expenseSpike(60_000, 30_000).isSpike, true);
    assert.equal(expenseSpike(3_000, 1_000).isSpike, false); // +200% but only GH₵20
    assert.equal(expenseSpike(50_000, null).isSpike, false);
  });
});
