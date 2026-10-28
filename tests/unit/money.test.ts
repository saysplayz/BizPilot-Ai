// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPercentChange,
  formatMoney,
  formatMoneyShort,
  mulRatio,
  parseMoney,
  percentOf,
  sumMinor,
  toInputValue,
  tryParseMoney,
} from "../../src/core/money";

describe("money: integer minor units", () => {
  it("adds exactly where floating point would drift", () => {
    // 0.1 + 0.2 in cedis is 10 + 20 pesewas = 30, exactly.
    assert.equal(sumMinor([10, 20]), 30);
    assert.equal(sumMinor(Array(1000).fill(1)), 1000);
    assert.notEqual(0.1 + 0.2, 0.3); // the bug we avoid
  });

  it("rejects non-integer minor units", () => {
    assert.throws(() => sumMinor([1.5]));
  });

  it("rounds ratios half away from zero (matches PostgreSQL round)", () => {
    assert.equal(mulRatio(4100, 1, 4), 1025);
    assert.equal(mulRatio(5, 1, 2), 3); // 2.5 → 3
    assert.equal(mulRatio(-5, 1, 2), -3); // -2.5 → -3
    assert.equal(mulRatio(1000, 1, 3), 333);
    assert.equal(mulRatio(2000, 1, 3), 667);
  });

  it("applies percentage changes via basis points", () => {
    assert.equal(applyPercentChange(200_000, -20), 160_000);
    assert.equal(applyPercentChange(200_000, 10), 220_000);
    assert.equal(applyPercentChange(1001, 12.5), 1126); // 1126.125 → 1126
    assert.equal(percentOf(25, 200), 12.5);
    assert.equal(percentOf(1, 0), null);
  });

  it("parses owner-typed amounts", () => {
    assert.equal(parseMoney("1,250"), 125_000);
    assert.equal(parseMoney("1250.5"), 125_050);
    assert.equal(parseMoney("GH₵ 1,250.50"), 125_050);
    assert.equal(parseMoney("GHS20"), 2_000);
    assert.equal(parseMoney(".75"), 75);
    assert.equal(parseMoney("0", { allowZero: true }), 0);
    assert.equal(parseMoney("-50", { allowNegative: true }), -5_000);
  });

  it("rejects invalid amounts", () => {
    for (const bad of ["", "abc", "1.234", "1,25", "-5", "0", "12a"]) {
      assert.equal(tryParseMoney(bad), null, `should reject "${bad}"`);
    }
  });

  it("formats deterministically", () => {
    assert.equal(formatMoney(300_000), "GH₵3,000.00");
    assert.equal(formatMoney(-150_000), "-GH₵1,500.00");
    assert.equal(formatMoney(5), "GH₵0.05");
    assert.equal(formatMoney(2_000, { signed: true }), "+GH₵20.00");
    assert.equal(formatMoney(200_000, { compact: true }), "GH₵2,000");
    assert.equal(formatMoneyShort(150_000), "GH₵1.5k");
    assert.equal(toInputValue(125_050), "1250.50");
  });
});
