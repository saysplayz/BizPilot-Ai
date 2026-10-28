// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCsv,
  parseFlexibleDate,
  parseSignedAmount,
  suggestMapping,
  transactionFingerprint,
  validateProductRows,
  validateTransactionRows,
} from "../../src/core/import/csv";

describe("CSV parsing", () => {
  it("handles quotes, embedded commas/newlines, CRLF and BOM", () => {
    const rows = parseCsv('﻿Date,Description,Amount\r\n28/10/2026,"Sale, phone ""A15""",1450\r\n29/10/2026,"Multi\nline",-80\r\n\r\n');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[1], ["28/10/2026", 'Sale, phone "A15"', "1450"]);
    assert.equal(rows[2]![1], "Multi\nline");
  });

  it("detects semicolon delimiters", () => {
    assert.deepEqual(parseCsv("a;b;c\n1;2;3"), [["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("parses Ghanaian day-first dates and bank-style amounts", () => {
    assert.equal(parseFlexibleDate("28/10/2026"), "2026-10-28");
    assert.equal(parseFlexibleDate("5-1-26"), "2026-01-05");
    assert.equal(parseFlexibleDate("31/02/2026"), null);
    assert.equal(parseFlexibleDate("10/28/2026"), null, "never guesses month-first");
    assert.equal(parseSignedAmount("GH₵1,200.50"), 120_050);
    assert.equal(parseSignedAmount("(250.00)"), -25_000);
    assert.equal(parseSignedAmount("-80"), -8_000);
    assert.equal(parseSignedAmount("twelve"), null);
  });

  it("suggests column mappings from common header names", () => {
    const m = suggestMapping(["Txn Date", "Narration", "Amount (GHS)", "Channel"], "transactions");
    assert.deepEqual(m, { date: 0, description: 1, amount: 2, payment_method: 3 });
  });
});

describe("9. imports cannot silently double-count", () => {
  const rows = [
    ["28/10/2026", "Phone sale", "1450", "MoMo"],
    ["28/10/2026", "Taxi to market", "-50", "cash"],
    ["28/10/2026", "Phone sale", "1450", "MoMo"], // duplicate within file
    ["31/02/2026", "Bad date", "10", ""],
    ["29/10/2026", "", "10", ""],
    ["29/10/2026", "Bad amount", "ten", ""],
  ];
  const mapping = { date: 0, description: 1, amount: 2, payment_method: 3 };

  it("validates rows and reports errors before anything is written", () => {
    const r = validateTransactionRows(rows, mapping);
    assert.equal(r.valid.length, 2);
    assert.equal(r.valid[0]!.kind, "sale");
    assert.equal(r.valid[0]!.payment_method, "mobile_money");
    assert.equal(r.valid[1]!.kind, "expense");
    assert.equal(r.valid[1]!.amount, 5_000);
    assert.deepEqual(r.errors.map((e) => e.field).sort(), ["amount", "date", "description"]);
  });

  it("flags duplicates within the file and against earlier imports", () => {
    const r = validateTransactionRows(rows, mapping);
    assert.equal(r.duplicates.length, 1);
    assert.equal(r.duplicates[0]!.row, 3);
    const again = validateTransactionRows(rows, mapping, new Set(r.valid.map((v) => v.fingerprint)));
    assert.equal(again.valid.length, 0);
    assert.equal(again.duplicates.length, 3);
  });

  it("fingerprints are normalised so spacing/case differences still match", () => {
    assert.equal(transactionFingerprint("2026-10-28", 145_000, "sale", "Phone  SALE "), transactionFingerprint("2026-10-28", 145_000, "sale", "phone sale"));
  });

  it("requires mapping of required columns", () => {
    const r = validateTransactionRows(rows, { date: 0, amount: 2 });
    assert.equal(r.valid.length, 0);
    assert.match(r.errors[0]!.message, /description/);
  });

  it("validates product imports including opening stock cost", () => {
    const r = validateProductRows(
      [
        ["Phone Case", "PC-01", "45", "18", "30"],
        ["Charger", "CH-25", "60", "", "10"], // stock without cost
        ["phone case", "PC-02", "45", "18", "5"], // duplicate name
        ["Earbuds", "EB-01", "150", "80", "x"],
      ],
      { name: 0, sku: 1, selling_price: 2, unit_cost: 3, quantity: 4 },
      { names: new Set(), skus: new Set(["eb-01"]) },
    );
    assert.equal(r.valid.length, 1);
    assert.equal(r.valid[0]!.unit_cost, 1_800);
    assert.equal(r.duplicates.length, 1);
    assert.deepEqual(r.errors.map((e) => e.field).sort(), ["quantity", "unit_cost"]);
  });
});
