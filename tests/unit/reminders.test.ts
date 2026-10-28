// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReminderMessage, smsLink, toInternationalGhana, whatsappLink } from "../../src/core/reminders";

describe("payment reminders (drafts only — never sent automatically)", () => {
  it("builds a friendly reminder with amount and due date", () => {
    const msg = buildReminderMessage({ businessName: "Kofi's Phone Hub", customerName: "Yaw Boateng", amount: 45_000, dueDate: "2026-10-22", daysOverdue: 6, invoiceNumber: "INV-00013" });
    assert.match(msg, /Hello Yaw/);
    assert.match(msg, /GH₵450\.00 \(INV-00013\) which was due on 22 Oct 2026/);
  });

  it("supports a firmer tone", () => {
    assert.match(buildReminderMessage({ businessName: "Shop", customerName: "Esi", amount: 100, dueDate: "2026-10-22", daysOverdue: 30, tone: "firm" }), /still outstanding/);
  });

  it("normalises Ghanaian phone numbers for WhatsApp links", () => {
    assert.equal(toInternationalGhana("024 555 0101"), "233245550101");
    assert.equal(toInternationalGhana("+233 20 555 0102"), "233205550102");
    assert.equal(toInternationalGhana("12345"), null);
    assert.equal(whatsappLink("0245550101", "Hi there"), "https://wa.me/233245550101?text=Hi%20there");
    assert.equal(smsLink("024 555 0101", "Hi"), "sms:0245550101?body=Hi");
  });
});
