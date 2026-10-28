// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
"use client";

import { CheckCircle2, FileUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { formatDate } from "@/core/dates";
import { formatMoney } from "@/core/money";
import {
  MAX_IMPORT_BYTES,
  PRODUCT_FIELDS,
  REQUIRED_FIELDS,
  TRANSACTION_FIELDS,
  parseCsv,
  suggestMapping,
  validateProductRows,
  validateTransactionRows,
  type ColumnMapping,
  type ImportKind,
} from "@/core/import/csv";
import { runImport, type ImportSummary } from "@/lib/actions/import";

const FIELD_LABEL: Record<string, string> = {
  date: "Date",
  description: "Description",
  amount: "Amount (+ sale, − expense)",
  type: "Type (sale/expense)",
  category: "Category",
  payment_method: "Paid by",
  reference: "Reference",
  name: "Product name",
  sku: "SKU / code",
  selling_price: "Selling price",
  unit_cost: "Unit cost",
  quantity: "Quantity in stock",
  low_stock_threshold: "Low-stock level",
  barcode: "Barcode",
};

/**
 * 1 upload → 2 preview → 3 map columns → 4 validate (errors + duplicates) →
 * 5 confirm → 6 summary. Nothing is written before step 5, and the server
 * re-validates everything (the preview here is for the owner's benefit).
 */
export function ImportWizard({ initialKind, existingFingerprints, existingProducts }: { initialKind: ImportKind; existingFingerprints: string[]; existingProducts: { names: string[]; skus: string[] } }) {
  const [kind, setKind] = useState<ImportKind>(initialKind);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const header = hasHeader ? (rows[0] ?? []) : (rows[0] ?? []).map((_, i) => `Column ${i + 1}`);
  const data = hasHeader ? rows.slice(1) : rows;
  const fields = kind === "transactions" ? TRANSACTION_FIELDS : PRODUCT_FIELDS;

  const validation = useMemo(() => {
    if (data.length === 0) return null;
    return kind === "transactions"
      ? validateTransactionRows(data, mapping, new Set(existingFingerprints))
      : validateProductRows(data, mapping, { names: new Set(existingProducts.names), skus: new Set(existingProducts.skus) });
  }, [data, mapping, kind, existingFingerprints, existingProducts]);

  async function onFile(file: File | undefined) {
    setSummary(null);
    setServerError(null);
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError("That file is too large (max 2 MB). Split it into smaller files.");
      return;
    }
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setFileError("Please upload a .csv file (in Excel or Google Sheets: File → Download → CSV).");
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      setFileError("The file is empty.");
      return;
    }
    setFileName(file.name);
    setRows(parsed);
    setMapping(suggestMapping(parsed[0] ?? [], kind));
  }

  function confirm() {
    start(async () => {
      const res = await runImport({ kind, rows: data, mapping });
      if (res.ok && res.data) setSummary(res.data);
      else if (!res.ok) setServerError(res.error);
    });
  }

  const missing = REQUIRED_FIELDS[kind].filter((f) => mapping[f] === undefined);

  if (summary) {
    return (
      <Card>
        <CardBody className="space-y-3 py-6">
          <p className="flex items-center gap-2 text-lg font-semibold text-positive">
            <CheckCircle2 className="size-5" aria-hidden /> Import finished
          </p>
          <ul className="space-y-1 text-sm">
            <li>
              <strong>{summary.imported}</strong> row(s) imported
            </li>
            <li>
              <strong>{summary.skippedDuplicates}</strong> duplicate(s) skipped
            </li>
            <li>
              <strong>{summary.failed.length}</strong> row(s) not imported
            </li>
          </ul>
          {summary.failed.length > 0 && (
            <ul className="max-h-48 overflow-y-auto rounded-lg border border-line p-2 text-xs text-danger">
              {summary.failed.map((f, i) => (
                <li key={i}>
                  Row {f.row}: {f.message}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Link href={kind === "transactions" ? "/transactions" : "/inventory"} className={buttonClass("primary")}>
              View {kind === "transactions" ? "transactions" : "products"}
            </Link>
            <Button variant="secondary" onClick={() => { setRows([]); setFileName(null); setSummary(null); }}>
              Import another file
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="1. Choose what you are importing and upload a CSV" />
        <CardBody className="space-y-4">
          <div role="radiogroup" className="flex flex-wrap gap-2">
            {(["transactions", "products"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k);
                  setMapping(suggestMapping(rows[0] ?? [], k));
                }}
                className={`rounded-lg border px-3 py-2 text-sm ${kind === k ? "border-brand bg-brand-soft font-semibold" : "border-line-strong"}`}
              >
                {k === "transactions" ? "Sales & expenses" : "Products & stock"}
              </button>
            ))}
          </div>
          <p className="text-sm text-ink-muted">
            {kind === "transactions"
              ? "Columns needed: date, description, amount. Positive amounts import as cash sales, negative amounts as expenses (or add a Type column). Dates like 28/10/2026 are read day-first."
              : "Columns needed: product name and selling price. Optional: SKU, unit cost, quantity in stock (needs a unit cost), low-stock level, barcode."}
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line-strong px-4 py-8 text-center hover:border-brand">
            <FileUp className="size-6 text-brand" aria-hidden />
            <span className="text-sm font-medium">{fileName ?? "Choose a CSV file"}</span>
            <span className="text-xs text-ink-muted">Max 2 MB · up to 2,000 rows</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {fileError && <Notice tone="danger">{fileError}</Notice>}
        </CardBody>
      </Card>

      {rows.length > 0 && (
        <>
          <Card>
            <CardHeader title="2. Preview" description={`${data.length} data row(s)`} action={
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="accent-brand" /> First row is headers
              </label>
            } />
            <Table caption="File preview">
              <thead>
                <tr>{header.map((h, i) => <Th key={i}>{h || `Column ${i + 1}`}</Th>)}</tr>
              </thead>
              <tbody>
                {data.slice(0, 5).map((r, i) => (
                  <tr key={i}>{header.map((_, j) => <Td key={j} className="text-ink-soft">{r[j] ?? ""}</Td>)}</tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader title="3. Match your columns" description="We guessed from your headers — check them." />
            <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => (
                <div key={f} className="space-y-1">
                  <label htmlFor={`map-${f}`} className="text-sm font-medium">
                    {FIELD_LABEL[f]} {REQUIRED_FIELDS[kind].includes(f) ? <span className="text-danger">*</span> : <span className="font-normal text-ink-muted">(optional)</span>}
                  </label>
                  <Select
                    id={`map-${f}`}
                    value={mapping[f] === undefined ? "" : String(mapping[f])}
                    onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                  >
                    <option value="">— Not in file —</option>
                    {header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </CardBody>
          </Card>

          {validation && (
            <Card>
              <CardHeader title="4. Check before importing" />
              <CardBody className="space-y-3">
                {missing.length > 0 ? (
                  <Notice tone="warning">Match these columns first: {missing.map((m) => FIELD_LABEL[m]).join(", ")}.</Notice>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-center text-sm">
                      <div className="rounded-lg bg-positive-soft p-3"><p className="text-2xl font-semibold text-positive">{validation.valid.length}</p>ready</div>
                      <div className="rounded-lg bg-warning-soft p-3"><p className="text-2xl font-semibold text-warning">{validation.duplicates.length}</p>likely duplicates (skipped)</div>
                      <div className="rounded-lg bg-danger-soft p-3"><p className="text-2xl font-semibold text-danger">{validation.errors.length}</p>problems</div>
                    </div>
                    {validation.errors.length > 0 && (
                      <ul className="max-h-40 overflow-y-auto rounded-lg border border-line p-2 text-xs text-danger">
                        {validation.errors.slice(0, 100).map((e, i) => (
                          <li key={i}>Row {e.row}: {e.field ? `${FIELD_LABEL[e.field] ?? e.field} — ` : ""}{e.message}</li>
                        ))}
                      </ul>
                    )}
                    {validation.duplicates.length > 0 && (
                      <ul className="max-h-32 overflow-y-auto rounded-lg border border-line p-2 text-xs text-warning">
                        {validation.duplicates.slice(0, 50).map((d, i) => (
                          <li key={i}>Row {d.row}: {d.reason}</li>
                        ))}
                      </ul>
                    )}
                    {kind === "transactions" && validation.valid.length > 0 && (
                      <p className="text-sm text-ink-soft">
                        Will import {formatMoney((validation.valid as { kind: string; amount: number }[]).filter((v) => v.kind === "sale").reduce((s, v) => s + v.amount, 0))} of cash sales and{" "}
                        {formatMoney((validation.valid as { kind: string; amount: number }[]).filter((v) => v.kind === "expense").reduce((s, v) => s + v.amount, 0))} of expenses
                        {validation.valid[0] && "date" in validation.valid[0] ? ` starting ${formatDate((validation.valid[0] as { date: string }).date)}` : ""}. Imported sales have no product cost, so profit for those days will be marked as an estimate.
                      </p>
                    )}
                    {serverError && <Notice tone="danger">{serverError}</Notice>}
                    <Button onClick={confirm} disabled={pending || validation.valid.length === 0} size="lg">
                      {pending ? "Importing…" : `5. Import ${validation.valid.length} row(s)`}
                    </Button>
                  </>
                )}
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
