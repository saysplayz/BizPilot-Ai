// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDays, addMonths, diffDays, eachDay, endOfMonth, formatDate, isIsoDate, relativeDay, todayIn } from "../../src/core/dates";

describe("dates", () => {
  it("validates ISO dates strictly", () => {
    assert.equal(isIsoDate("2026-10-28"), true);
    assert.equal(isIsoDate("2026-02-30"), false);
    assert.equal(isIsoDate("28/10/2026"), false);
  });

  it("does calendar arithmetic across month and year ends", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2024-03-01", -1), "2024-02-29");
    assert.equal(diffDays("2026-10-28", "2026-11-07"), 10);
    assert.equal(eachDay("2026-10-30", "2026-11-02").length, 4);
    assert.equal(endOfMonth("2026-02-10"), "2026-02-28");
  });

  it("clamps month addition to the last day and keeps the anchor day", () => {
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2026-01-31", 2), "2026-03-31");
    assert.equal(addMonths("2026-02-28", 1, 31), "2026-03-31");
  });

  it("computes 'today' in Accra regardless of server timezone", () => {
    assert.equal(todayIn("Africa/Accra", new Date("2026-10-28T23:30:00Z")), "2026-10-28");
    assert.equal(todayIn("Africa/Accra", new Date("2026-10-29T00:10:00Z")), "2026-10-29");
  });

  it("formats day-first for Ghana", () => {
    assert.equal(formatDate("2026-11-07"), "7 Nov 2026");
    assert.equal(formatDate("2026-11-07", { year: false, weekday: true }), "Sat 7 Nov");
    assert.equal(relativeDay("2026-10-29", "2026-10-28"), "tomorrow");
    assert.equal(relativeDay("2026-10-25", "2026-10-28"), "3 days ago");
  });
});
