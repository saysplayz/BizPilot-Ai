// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import type { Metadata } from "next";
import { ImportWizard } from "@/components/import/import-wizard";
import { PageHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { requireBusiness } from "@/lib/context";

export const metadata: Metadata = { title: "Import CSV" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const ctx = await requireBusiness();
  const [fps, products] = await Promise.all([
    ctx.supabase.from("transactions").select("import_fingerprint").eq("business_id", ctx.business.id).eq("status", "posted").not("import_fingerprint", "is", null),
    ctx.supabase.from("products").select("name, sku").eq("business_id", ctx.business.id),
  ]);
  const productRows = (products.data ?? []) as { name: string; sku: string | null }[];
  return (
    <>
      <PageHeader title="Import from CSV" description="Bring in past sales, expenses or your product list from a spreadsheet." />
      <Notice tone="info" className="mb-5">
        BizPilot is not connected to any bank or Mobile Money account. Imported rows are your own records; you confirm them before anything is saved.
      </Notice>
      <ImportWizard
        initialKind={kind === "products" ? "products" : "transactions"}
        existingFingerprints={((fps.data ?? []) as { import_fingerprint: string }[]).map((r) => r.import_fingerprint)}
        existingProducts={{
          names: productRows.map((p) => p.name.toLowerCase().replace(/\s+/g, " ").trim()),
          skus: productRows.filter((p) => p.sku).map((p) => String(p.sku).toLowerCase().trim()),
        }}
      />
    </>
  );
}
