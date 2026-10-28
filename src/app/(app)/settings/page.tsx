// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { AddAccountForm, BusinessSettingsForm, OpeningBalanceForm } from "@/components/forms/settings-forms";
import { Button, SubmitButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge, Notice } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { signOut } from "@/lib/actions/auth";
import { createDemoBusiness } from "@/lib/actions/business";
import { canManage, requireBusiness } from "@/lib/context";
import { getMoneyAccounts } from "@/lib/data/finance";
import { AI_PROVIDER_LABEL, aiConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireBusiness();
  const ai = aiConfig();
  const accounts = await getMoneyAccounts(ctx);
  const manager = canManage(ctx.business);

  return (
    <>
      <PageHeader title="Settings" description={`Signed in as ${ctx.user.email ?? "you"} · role: ${ctx.business.role}`} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Business details" />
          <CardBody>{manager ? <BusinessSettingsForm business={ctx.business} /> : <p className="text-sm text-ink-muted">Only the owner or a manager can change these.</p>}</CardBody>
        </Card>

        <Card id="opening">
          <CardHeader title="Opening cash balance" description="The money you had in each account when you started using BizPilot." />
          <CardBody className="space-y-3">
            {ctx.business.opening_balance_set_at === null ? (
              <Notice tone="warning">Not recorded yet — your cash figures and forecast are marked incomplete until you add it.</Notice>
            ) : (
              <Notice tone="success">Opening balance recorded. To change one, void it from Transactions and record it again.</Notice>
            )}
            {manager && <OpeningBalanceForm accounts={accounts.map((a) => ({ id: a.financial_account_id, name: a.name }))} today={ctx.today} idempotencyKey={randomUUID()} />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Money accounts" description="Where your money is kept. Payment methods are labels you choose — BizPilot is not connected to banks or Mobile Money." />
          <CardBody className="space-y-4">
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {accounts.map((a) => (
                <li key={a.financial_account_id} className="flex justify-between px-3 py-2.5">
                  <span>
                    {a.name} <span className="text-xs text-ink-muted">({a.kind.replace("_", " ")})</span>
                  </span>
                  <Money value={a.balance_minor} currency={ctx.business.currency} />
                </li>
              ))}
            </ul>
            {manager && <AddAccountForm />}
            <Link href="/transactions/new?type=transfer" className="text-sm font-medium text-brand hover:underline">
              Move money between accounts →
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="AI assistant" />
          <CardBody className="space-y-2 text-sm text-ink-soft">
            <p>
              Status: {ai ? <Badge tone="positive">Configured · {AI_PROVIDER_LABEL[ai.provider]} ({ai.model})</Badge> : <Badge tone="warning">Not configured — using built-in calculator</Badge>}
            </p>
            <p>The assistant reads only this business&apos;s records, never sends phone numbers or notes to the AI provider, and cannot save records without your confirmation.</p>
            <Link href="/privacy" className="font-medium text-brand hover:underline">
              Privacy notice
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Businesses" description="You can run more than one business, or try the demo shop." />
          <CardBody className="space-y-3">
            <ul className="space-y-1 text-sm">
              {ctx.businesses.map((b) => (
                <li key={b.id} className="flex items-center gap-2">
                  {b.name} {b.is_demo && <Badge tone="warning">Demo</Badge>} {b.id === ctx.business.id && <Badge tone="brand">Current</Badge>}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Link href="/onboarding" className="inline-flex h-10 items-center rounded-lg border border-line-strong px-4 text-sm font-medium">
                Add a business
              </Link>
              <form action={createDemoBusiness}>
                <SubmitButton variant="secondary" pendingText="Building demo…">
                  {ctx.businesses.some((b) => b.is_demo) ? "Reset demo shop" : "Open demo shop"}
                </SubmitButton>
              </form>
            </div>
            <p className="text-xs text-ink-muted">The demo shop contains fictional data only and is kept separate from your real businesses. Resetting it rebuilds it from scratch.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Account" />
          <CardBody>
            <form action={signOut}>
              <Button type="submit" variant="secondary">
                Log out
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
