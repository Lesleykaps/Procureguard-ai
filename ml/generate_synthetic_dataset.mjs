import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROW_COUNT = 12_000;
const SEED = 20260905;
const outputPath = join(process.cwd(), 'ml', 'synthetic_procurement_transactions.csv');

let state = SEED >>> 0;
function random() {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 4294967296;
}
function integer(min, max) { return Math.floor(random() * (max - min + 1)) + min; }
function pick(values) { return values[integer(0, values.length - 1)]; }
function chance(probability) { return random() < probability; }
function normal(mean, spread) {
  const u = Math.max(random(), 0.000001);
  const v = Math.max(random(), 0.000001);
  return mean + spread * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function money(value) { return Math.round(value * 100) / 100; }
function csv(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function dateFor(index) {
  const date = new Date(Date.UTC(2024, 0, 1));
  date.setUTCDate(date.getUTCDate() + (index % 730));
  date.setUTCHours(integer(7, 17), integer(0, 59), integer(0, 59));
  return date.toISOString();
}
function stableSplit(id) {
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  const bucket = Math.abs(hash) % 100;
  return bucket < 70 ? 'train' : bucket < 85 ? 'validation' : 'test';
}

const categories = ['IT equipment', 'Facilities', 'Medical supplies', 'Transport', 'Construction', 'Office supplies', 'Consulting', 'Fuel and energy'];
const tenderMethods = ['Open tender', 'Request for quotations', 'Direct purchase', 'Framework call-off'];
const fraudTypes = ['duplicate_invoice', 'invoice_splitting', 'single_bidder', 'overbilling', 'vendor_conflict'];
const supplierPrefixes = ['BluePeak', 'Matobo', 'Kudu', 'Cobalt', 'Nile', 'Apex', 'Granite', 'Mosi', 'Savanna', 'Copperleaf', 'Tafara', 'Zambezi', 'Harbor', 'Cedar', 'Meridian'];
const supplierSuffixes = ['Supplies', 'Holdings', 'Logistics', 'Technologies', 'Medical', 'Infrastructure', 'Services', 'Trading'];
const headers = ['transaction_id', 'transaction_type', 'supplier_id', 'supplier_name', 'procurement_category', 'amount_usd', 'contract_amount_usd', 'tender_method', 'bidder_count', 'bidding_window_days', 'price_deviation_pct', 'invoice_number', 'invoice_duplicate_count', 'invoices_last_30d', 'approval_override_count', 'approver_vendor_domain_match', 'split_group_id', 'split_group_total_usd', 'supplier_age_days', 'related_supplier_count', 'delivery_days_variance', 'pattern', 'label_fraud', 'fraud_type', 'label_reason', 'dataset_split', 'created_at'];

const suppliers = Array.from({ length: 180 }, (_, index) => ({
  id: `SUP-${String(index + 1).padStart(4, '0')}`,
  name: `${pick(supplierPrefixes)} ${pick(supplierSuffixes)} ${index + 1}`,
}));
const rows = [headers.join(',')];
let fraudCount = 0;

for (let index = 0; index < ROW_COUNT; index += 1) {
  const transactionId = `${chance(0.58) ? 'PO' : 'INV'}-${String(100000 + index).slice(-6)}`;
  const supplier = pick(suppliers);
  const fraud = chance(0.18);
  const fraudType = fraud ? pick(fraudTypes) : 'none';
  const category = pick(categories);
  const baseAmount = clamp(Math.exp(normal(Math.log(9500), 1.05)), 250, 180000);
  const contractAmount = baseAmount * clamp(1 + normal(0, 0.08), 0.55, 1.45);
  let amount = baseAmount;
  let tenderMethod = pick(tenderMethods);
  let bidderCount = integer(2, 8);
  let biddingWindow = integer(7, 45);
  let priceDeviation = clamp(normal(2, 5), -12, 18);
  let duplicateCount = 1;
  let invoicesLast30d = integer(1, 8);
  let approvalOverride = chance(0.06) ? 1 : 0;
  let domainMatch = 0;
  let splitGroupId = '';
  let splitGroupTotal = 0;
  let supplierAge = integer(180, 4200);
  let relatedSupplierCount = chance(0.08) ? integer(1, 2) : 0;
  let deliveryVariance = clamp(normal(0, 3), -8, 15);
  let pattern = 'Normal purchase';
  let reason = 'Pricing, competition, approval path, and supplier history align with the expected baseline.';

  if (fraudType === 'duplicate_invoice') {
    amount = baseAmount * clamp(1 + normal(0.08, 0.12), 0.7, 1.8);
    duplicateCount = integer(2, 4);
    invoicesLast30d = integer(8, 26);
    pattern = 'Duplicate invoice';
    reason = `Invoice number recurs ${duplicateCount} times across payment batches within a short processing window.`;
  } else if (fraudType === 'invoice_splitting') {
    amount = clamp(baseAmount, 2500, 24000);
    splitGroupId = `SPLIT-${String(integer(1000, 9999))}`;
    splitGroupTotal = amount * integer(3, 7);
    approvalOverride = chance(0.55) ? 1 : 0;
    pattern = 'Invoice splitting';
    reason = `Related invoices total $${Math.round(splitGroupTotal).toLocaleString()} and appear structured below a review threshold.`;
  } else if (fraudType === 'single_bidder') {
    amount = baseAmount * clamp(1 + normal(0.12, 0.16), 0.75, 2.2);
    tenderMethod = chance(0.7) ? 'Open tender' : 'Request for quotations';
    bidderCount = 1;
    biddingWindow = integer(1, 5);
    pattern = 'Single bidder';
    reason = 'Tender closed with one bidder and an unusually short bidding window for the purchase value.';
  } else if (fraudType === 'overbilling') {
    amount = baseAmount * clamp(1 + normal(0.28, 0.16), 1.12, 2.3);
    priceDeviation = clamp(normal(34, 11), 18, 68);
    deliveryVariance = clamp(normal(8, 4), 2, 25);
    pattern = 'Overbilling';
    reason = `Unit price is approximately ${Math.round(priceDeviation)}% above the category baseline for a comparable purchase.`;
  } else if (fraudType === 'vendor_conflict') {
    amount = baseAmount * clamp(1 + normal(0.18, 0.18), 0.7, 2.1);
    domainMatch = 1;
    relatedSupplierCount = integer(1, 4);
    supplierAge = integer(30, 700);
    approvalOverride = chance(0.7) ? 1 : 0;
    pattern = 'Vendor conflict';
    reason = 'Supplier and approver records share a relationship signal that requires independent review.';
  }

  const noiseFlip = chance(0.035);
  const labelFraud = noiseFlip ? (fraud ? 0 : 1) : (fraud ? 1 : 0);
  const recordedFraudType = labelFraud ? (fraud ? fraudType : pick(fraudTypes)) : 'none';
  if (labelFraud) fraudCount += 1;
  const values = [
    transactionId,
    transactionId.startsWith('PO') ? 'purchase_order' : 'invoice',
    supplier.id,
    supplier.name,
    category,
    money(amount),
    money(contractAmount),
    tenderMethod,
    bidderCount,
    biddingWindow,
    money(priceDeviation),
    `INV-${String(500000 + index).slice(-6)}`,
    duplicateCount,
    invoicesLast30d,
    approvalOverride,
    domainMatch,
    splitGroupId,
    money(splitGroupTotal),
    supplierAge,
    relatedSupplierCount,
    money(deliveryVariance),
    pattern,
    labelFraud,
    recordedFraudType,
    reason,
    stableSplit(transactionId),
    dateFor(index),
  ];
  rows.push(values.map(csv).join(','));
}

await mkdir(join(process.cwd(), 'ml'), { recursive: true });
await writeFile(outputPath, `${rows.join('\n')}\n`, 'utf8');
console.log(`Generated ${ROW_COUNT.toLocaleString()} synthetic records.`);
console.log(`Fraud-labelled records: ${fraudCount.toLocaleString()} (${((fraudCount / ROW_COUNT) * 100).toFixed(1)}%).`);
console.log(`Output: ${outputPath}`);
