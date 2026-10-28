# Hackathon demo script

**Setup (2 minutes, once):** sign up (turn off email confirmation in Supabase for the event, or confirm the email first) and choose **Explore the demo shop** on the onboarding screen. This creates **"Kofi's Phone Hub (Demo)"**, a fictional Accra phone shop with 45 days of history. Pressing it again rebuilds a fresh copy. The demo is a separate business with an amber "Demo business" banner; real businesses are never touched.

All dates are relative to the day you create the demo ("D"), so the story works on any day.

## The story in numbers

| What | Amount | When | How the forecast treats it |
|---|---:|---|---|
| Cash available today (till + MoMo) | GH₵3,000 | today | starting point |
| Shop rent (planned, monthly) | GH₵1,000 | D+3 | *scheduled* outflow |
| Accra Gadget Wholesale bill | GH₵1,500 | D+5 | *scheduled* outflow (open bill) |
| Ama Mensah owes (credit sale) | GH₵2,000 | D+10 | *expected* inflow (not yet due) |
| Yaw Boateng owes (overdue) | GH₵450 | was due D−6 | *uncertain*, excluded by default |
| Minimum cash reserve | GH₵500 | | alert threshold |
| **Proposed stock purchase** | **GH₵2,000** | D+1 | what-if only |

Results (computed by the app's forecast engine against the demo data):

| Scenario (saved in the demo) | Lowest cash | Shortfall | Cash after 30 days |
|---|---:|---|---:|
| Current forecast, no purchase | GH₵500 (D+5) | none | GH₵2,500 |
| **Buy GH₵2,000 stock tomorrow** | **−GH₵1,500 (D+5)** | **from D+5 until Ama pays on D+10** | GH₵500 |
| Buy stock tomorrow + collect from Ama early (D+4) | GH₵0 (D+3) | none (but below the reserve) | GH₵500 |
| Buy stock after Ama pays (D+10) | GH₵500 | none | GH₵500 |

The point to land: the purchase is **affordable over the month** (cash ends at GH₵500 either way) but **not tomorrow**, because the bills fall due before the customer pays. It's a timing problem, and BizPilot shows it before it happens.

## Walk-through (≈ 5 minutes)

1. **Dashboard.** "Cash you have now: GH₵3,000." Point out that sales, profit and cash are different cards: Ama's GH₵2,000 is a sale already counted in revenue, but it is *not* cash yet ("Customers owe you"). Show low stock (two products) and the alerts.
2. **Transactions.** Record a quick sale live: *Record → Sale → Fast Charger 25W × 1 → Paid now*. Back on the dashboard, cash, sales and stock all moved by exactly that amount. Then show that a *credit* sale would raise "Customers owe you" instead of cash.
3. **Customers.** Ama (not yet due) and Yaw (overdue). Open Yaw and use *Send reminder*: a WhatsApp message is prefilled and the owner sends it themselves.
4. **Cash Flow.** The 30-day chart. Show the event list with its confidence labels, and that Yaw's overdue GH₵450 is **excluded** (tick the box to include it, and the forecast says it's uncertain). Read one or two assumptions aloud.
5. **AI Assistant.** Ask: *"Can I afford to spend GH₵2,000 on stock tomorrow?"* The answer explains the shortfall from D+5 and that it recovers when Ama pays. Under the answer, show the **figures used** (each one comes from BizPilot's calculations). Without an AI key, the built-in calculator gives the same figures and says AI is not configured.
6. **What-if.** Back on Cash Flow, load *"Buy GH₵2,000 stock tomorrow"*. Baseline and scenario sit on one chart, and the red dip is the shortfall. Switch to *"…collect from Ama early"* and *"Buy stock after Ama pays"*.
7. **Decision.** "Kofi should either ask Ama to pay a few days early, buy a smaller amount now, or wait until D+10. Nothing we just tried changed his records: scenarios are assumptions only."

## Questions the assistant answers well

- How much cash do I have right now?
- Which customers owe me the most?
- Which products need restocking?
- Can I afford to spend GH₵2,000 on stock tomorrow?
- Which bills should I prepare for?
- What were my largest expenses this month?
- Why was my profit lower this month?
- How does "Buy stock after Ama pays" compare with my current forecast?
- "I paid GH₵50 for transport today": drafts an expense the owner confirms.

## If something goes wrong

- **"The demo business could not be created"**: check the migrations were applied (`0009_demo.sql` especially) and you are signed in.
- **Assistant says AI is not configured**: set `ANTHROPIC_API_KEY` on the server and redeploy; the calculator answers still work for the demo.
- **Numbers look different from this script**: the demo was probably created on an earlier day, so dates have moved on. Press *Explore the demo shop* again to rebuild it for today.
