// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
/**
 * CSV import: parse → preview → map columns → validate → detect duplicates.
 * Nothing is written until the user confirms; writes then go through the same
 * posting functions as manual entry, each carrying a fingerprint that the
 * database refuses to post twice.
 */
import { isIsoDate, type IsoDate } from "../dates";
import { MoneyError, parseMoney, type Minor } from "../money";

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, BOM, comma or semicolon delimiter. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== "")).map((r) => r.map((f) => f.trim()));
}

/**
 * Dates as shops write them: 2026-10-28, 28/10/2026, 28-10-2026, 28.10.2026,
 * 28/10/26. Day-first (Ghana convention); never guesses month-first.
 */
export function parseFlexibleDate(value: string): IsoDate | null {
  const v = value.trim();
  if (isIsoDate(v)) return v;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(v);
  if (!m) return null;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const iso = `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

/** Amounts as exported by banks/MoMo: "GH₵1,200.50", "-250", "(250.00)". */
export function parseSignedAmount(value: string): Minor | null {
  let v = value.trim();
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  try {
    const parsed = parseMoney(v, { allowNegative: true, allowZero: false });
    return negative ? -Math.abs(parsed) : parsed;
  } catch (err) {
    if (err instanceof MoneyError) return null;
    throw err;
  }
}

export type ImportKind = "transactions" | "products";

export const TRANSACTION_FIELDS = ["date", "description", "amount", "type", "category", "payment_method", "reference"] as const;
export const PRODUCT_FIELDS = ["name", "sku", "selling_price", "unit_cost", "quantity", "low_stock_threshold", "barcode"] as const;
export type TransactionField = (typeof TRANSACTION_FIELDS)[number];
export type ProductField = (typeof PRODUCT_FIELDS)[number];

export const REQUIRED_FIELDS: Record<ImportKind, readonly string[]> = {
  transactions: ["date", "description", "amount"],
  products: ["name", "selling_price"],
};

/** Mapping from target field to source column index. */
export type ColumnMapping = Partial<Record<string, number>>;

const SYNONYMS: Record<string, string[]> = {
  date: ["date", "txn date", "transaction date", "value date", "posting date", "day"],
  description: ["description", "details", "narration", "particulars", "memo", "item"],
  amount: ["amount", "value", "total", "amount (ghs)", "ghs", "cedis"],
  type: ["type", "kind", "transaction type", "direction"],
  category: ["category", "expense type", "account"],
  payment_method: ["payment method", "method", "channel", "paid by", "mode"],
  reference: ["reference", "ref", "receipt", "transaction id", "id"],
  name: ["name", "product", "product name", "item", "item name"],
  sku: ["sku", "code", "product code", "item code"],
  selling_price: ["selling price", "price", "retail price", "unit price"],
  unit_cost: ["unit cost", "cost", "cost price", "buying price"],
  quantity: ["quantity", "qty", "stock", "in stock", "count"],
  low_stock_threshold: ["low stock", "reorder level", "reorder point", "minimum", "min stock"],
  barcode: ["barcode", "ean", "upc"],
};

/** Suggest a mapping from header names. */
export function suggestMapping(headers: readonly string[], kind: ImportKind): ColumnMapping {
  const fields = kind === "transactions" ? TRANSACTION_FIELDS : PRODUCT_FIELDS;
  const normalised = headers.map((h) => h.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim());
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const field of fields) {
    const candidates = SYNONYMS[field] ?? [field];
    const idx = normalised.findIndex((h, i) => !used.has(i) && candidates.includes(h));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

export interface RowError {
  row: number; // 1-based data row number (excluding header)
  field: string;
  message: string;
}

export interface ImportTransactionRow {
  row: number;
  date: IsoDate;
  description: string;
  amount: Minor; // always positive
  kind: "sale" | "expense";
  category: string;
  payment_method: "cash" | "mobile_money" | "bank_transfer" | "card" | "other";
  reference?: string;
  fingerprint: string;
}

export interface ImportProductRow {
  row: number;
  name: string;
  sku?: string;
  selling_price: Minor;
  unit_cost: Minor | null;
  quantity: number;
  low_stock_threshold: number;
  barcode?: string;
  fingerprint: string;
}

export interface ValidationResult<T> {
  valid: T[];
  errors: RowError[];
  duplicates: { row: number; reason: string }[];
}

function normaliseText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function transactionFingerprint(date: IsoDate, amount: Minor, kind: string, description: string): string {
  return `import:${kind}:${date}:${amount}:${normaliseText(description).slice(0, 80)}`;
}

function methodFrom(value: string | undefined): ImportTransactionRow["payment_method"] {
  const v = normaliseText(value ?? "");
  if (/momo|mobile|mtn|vodafone|telecel|airteltigo|\bat\b/.test(v)) return "mobile_money";
  if (/bank|transfer|gip|ach/.test(v)) return "bank_transfer";
  if (/card|visa|master|pos/.test(v)) return "card";
  if (v === "" || /cash/.test(v)) return "cash";
  return "other";
}

/**
 * Validate mapped transaction rows. Positive amounts (or type "sale"/"income")
 * import as cash sales; negative amounts (or type "expense") as expenses.
 * Rows matching an existing fingerprint or an earlier row are flagged as
 * duplicates and skipped unless the user removes them deliberately.
 */
export function validateTransactionRows(
  rows: readonly string[][],
  mapping: ColumnMapping,
  existingFingerprints: ReadonlySet<string> = new Set(),
): ValidationResult<ImportTransactionRow> {
  const result: ValidationResult<ImportTransactionRow> = { valid: [], errors: [], duplicates: [] };
  const missing = REQUIRED_FIELDS.transactions.filter((f) => mapping[f] === undefined);
  if (missing.length > 0) {
    result.errors.push({ row: 0, field: missing.join(", "), message: `Map these columns first: ${missing.join(", ")}` });
    return result;
  }
  const seen = new Set<string>();
  const get = (r: readonly string[], f: string) => (mapping[f] === undefined ? undefined : r[mapping[f]!]?.trim());

  rows.slice(0, MAX_IMPORT_ROWS).forEach((r, i) => {
    const rowNo = i + 1;
    const errors: RowError[] = [];
    const date = parseFlexibleDate(get(r, "date") ?? "");
    if (!date) errors.push({ row: rowNo, field: "date", message: "Date not recognised (use 28/10/2026 or 2026-10-28)" });
    const description = (get(r, "description") ?? "").slice(0, 200);
    if (!description) errors.push({ row: rowNo, field: "description", message: "Description is empty" });
    const signed = parseSignedAmount(get(r, "amount") ?? "");
    if (signed === null) errors.push({ row: rowNo, field: "amount", message: "Amount not recognised" });

    const typeText = normaliseText(get(r, "type") ?? "");
    let kind: "sale" | "expense" | null = null;
    if (/sale|income|credit|in\b|receipt|deposit/.test(typeText)) kind = "sale";
    else if (/expense|debit|out\b|payment|withdraw/.test(typeText)) kind = "expense";
    else if (typeText !== "") errors.push({ row: rowNo, field: "type", message: `Type "${typeText}" not recognised (use sale or expense)` });
    else if (signed !== null) kind = signed > 0 ? "sale" : "expense";

    if (errors.length > 0 || !date || signed === null || !kind) {
      result.errors.push(...errors);
      return;
    }
    const amount = Math.abs(signed);
    const fingerprint = transactionFingerprint(date, amount, kind, description);
    if (existingFingerprints.has(fingerprint)) {
      result.duplicates.push({ row: rowNo, reason: "Already imported" });
      return;
    }
    if (seen.has(fingerprint)) {
      result.duplicates.push({ row: rowNo, reason: "Same date, amount and description as an earlier row in this file" });
      return;
    }
    seen.add(fingerprint);
    result.valid.push({
      row: rowNo,
      date,
      description,
      amount,
      kind,
      category: (get(r, "category") || (kind === "sale" ? "Sales" : "Other")).slice(0, 60),
      payment_method: methodFrom(get(r, "payment_method")),
      reference: get(r, "reference")?.slice(0, 80) || undefined,
      fingerprint,
    });
  });

  if (rows.length > MAX_IMPORT_ROWS) {
    result.errors.push({ row: MAX_IMPORT_ROWS + 1, field: "", message: `Only the first ${MAX_IMPORT_ROWS} rows are imported at a time` });
  }
  return result;
}

export function validateProductRows(
  rows: readonly string[][],
  mapping: ColumnMapping,
  existing: { names: ReadonlySet<string>; skus: ReadonlySet<string> } = { names: new Set(), skus: new Set() },
): ValidationResult<ImportProductRow> {
  const result: ValidationResult<ImportProductRow> = { valid: [], errors: [], duplicates: [] };
  const missing = REQUIRED_FIELDS.products.filter((f) => mapping[f] === undefined);
  if (missing.length > 0) {
    result.errors.push({ row: 0, field: missing.join(", "), message: `Map these columns first: ${missing.join(", ")}` });
    return result;
  }
  const get = (r: readonly string[], f: string) => (mapping[f] === undefined ? undefined : r[mapping[f]!]?.trim());
  const seenNames = new Set<string>();
  const seenSkus = new Set<string>();

  rows.slice(0, MAX_IMPORT_ROWS).forEach((r, i) => {
    const rowNo = i + 1;
    const errors: RowError[] = [];
    const name = (get(r, "name") ?? "").slice(0, 120);
    if (!name) errors.push({ row: rowNo, field: "name", message: "Name is empty" });
    const price = parseSignedAmount(get(r, "selling_price") ?? "");
    if (price === null || price < 0) errors.push({ row: rowNo, field: "selling_price", message: "Selling price not recognised" });
    const costText = get(r, "unit_cost") ?? "";
    const cost = costText ? parseSignedAmount(costText) : null;
    if (costText && (cost === null || cost < 0)) errors.push({ row: rowNo, field: "unit_cost", message: "Unit cost not recognised" });
    const qtyText = get(r, "quantity") ?? "";
    const qty = qtyText === "" ? 0 : Number(qtyText.replace(/,/g, ""));
    if (!Number.isInteger(qty) || qty < 0) errors.push({ row: rowNo, field: "quantity", message: "Quantity must be a whole number of 0 or more" });
    if (qty > 0 && cost === null) errors.push({ row: rowNo, field: "unit_cost", message: "Unit cost is needed to value opening stock" });
    const thrText = get(r, "low_stock_threshold") ?? "";
    const threshold = thrText === "" ? 0 : Number(thrText);
    if (!Number.isInteger(threshold) || threshold < 0) errors.push({ row: rowNo, field: "low_stock_threshold", message: "Low-stock level must be a whole number" });

    if (errors.length > 0 || price === null) {
      result.errors.push(...errors);
      return;
    }
    const sku = get(r, "sku")?.slice(0, 60) || undefined;
    const nameKey = normaliseText(name);
    const skuKey = sku ? normaliseText(sku) : undefined;
    if ((skuKey && existing.skus.has(skuKey)) || existing.names.has(nameKey)) {
      result.duplicates.push({ row: rowNo, reason: "A product with this name or SKU already exists" });
      return;
    }
    if ((skuKey && seenSkus.has(skuKey)) || seenNames.has(nameKey)) {
      result.duplicates.push({ row: rowNo, reason: "Repeated in this file" });
      return;
    }
    seenNames.add(nameKey);
    if (skuKey) seenSkus.add(skuKey);
    result.valid.push({
      row: rowNo,
      name,
      sku,
      selling_price: price,
      unit_cost: cost,
      quantity: qty,
      low_stock_threshold: threshold,
      barcode: get(r, "barcode")?.slice(0, 64) || undefined,
      fingerprint: `product:${skuKey ?? nameKey}`,
    });
  });
  return result;
}
