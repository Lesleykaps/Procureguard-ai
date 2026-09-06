import { env } from 'cloudflare:workers';
import trainedArtifact from '../ml/model-artifacts.json';

export type RiskStatus = 'Open' | 'Reviewed' | 'Cleared';
export type AppRole = 'Admin' | 'Auditor' | 'Procurement Officer' | 'Manager';
export type AppPermission = 'transactions:read' | 'transactions:import' | 'transactions:review' | 'scan:run' | 'explain:read' | 'models:read' | 'audit:read' | 'reports:export' | 'users:read' | 'users:manage';
export type AuthenticatedActor = { userId: string; email: string; displayName: string; role: AppRole };

const rolePermissions: Record<AppRole, AppPermission[]> = {
  Admin: ['transactions:read', 'transactions:import', 'transactions:review', 'scan:run', 'explain:read', 'models:read', 'audit:read', 'reports:export', 'users:read', 'users:manage'],
  Auditor: ['transactions:read', 'transactions:review', 'scan:run', 'explain:read', 'audit:read', 'reports:export'],
  'Procurement Officer': ['transactions:read', 'transactions:import', 'reports:export'],
  Manager: ['transactions:read', 'transactions:review', 'scan:run', 'explain:read', 'models:read', 'audit:read', 'reports:export'],
};

export type TransactionRecord = {
  id: string;
  supplier: string;
  amount: number;
  pattern: string;
  risk: number;
  status: RiskStatus;
  reason: string;
  date: string;
};

export type FeatureContribution = { label: string; value: number; contribution: number; direction: 'risk' | 'protective' };

type TransactionRow = Omit<TransactionRecord, 'risk' | 'date'> & {
  risk_score: number;
  model_features_json: string | null;
  created_at: string;
};

const demoRecords = [
  ['PO-10488', 'BluePeak Supplies', 42890, 'Invoice splitting', 94, 'Open', 'Invoice amount is 42% above contract average and supplier has repeated single-bid awards.'],
  ['INV-88120', 'Matobo Tech', 18640, 'Duplicate invoice', 87, 'Open', 'Duplicate invoice number appears across two payment batches within 24 hours.'],
  ['PO-10377', 'Kudu Logistics', 9620, 'Single bidder', 74, 'Reviewed', 'Tender closed with one qualified supplier and an unusually short bidding period.'],
  ['INV-87942', 'Cobalt Office', 3120, 'Normal purchase', 18, 'Cleared', 'Pricing and approval path match the historical baseline.'],
  ['PO-10504', 'Nile Infrastructure', 57400, 'Overbilling', 91, 'Open', 'Unit price exceeds the historical median by 38% for the same item category.'],
  ['INV-88210', 'Apex Medical', 12980, 'Vendor conflict', 79, 'Open', 'Approver and vendor share a matching contact domain from prior records.'],
] as const;

function decodeDisplayName(request: Request, email: string) {
  const encoded = request.headers.get('oai-authenticated-user-full-name');
  if (encoded && request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try { return decodeURIComponent(encoded); } catch { return email; }
  }
  return email;
}

function normalizeRole(value: unknown): AppRole {
  return value === 'Admin' || value === 'Auditor' || value === 'Procurement Officer' || value === 'Manager' ? value : 'Auditor';
}

export function hasPermission(role: AppRole, permission: AppPermission) {
  return rolePermissions[role].includes(permission);
}

export async function getAuthenticatedActor(request: Request): Promise<AuthenticatedActor | null> {
  const userId = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (!userId || !email) return null;
  const existing = await env.DB.prepare(`SELECT id, email, display_name, role FROM users WHERE id = ?`).bind(userId).first<{ id: string; email: string; display_name: string; role: string }>();
  if (!existing) {
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM users`).first<{ total: number }>();
    const initialRole: AppRole = Number(count?.total ?? 0) === 0 ? 'Admin' : 'Auditor';
    await env.DB.prepare(`INSERT OR IGNORE INTO users (id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(userId, email, decodeDisplayName(request, email), initialRole, new Date().toISOString()).run();
  }
  const user = await env.DB.prepare(`SELECT id, email, display_name, role FROM users WHERE id = ?`).bind(userId).first<{ id: string; email: string; display_name: string; role: string }>();
  if (!user) return null;
  return { userId: user.id, email: user.email, displayName: user.display_name || email, role: normalizeRole(user.role) };
}

export function displayDate(isoDate: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(isoDate));
}

export function scoreTransaction(pattern: string, amount: number, storedFeatures?: ModelFeatures) {
  return modelScore(pattern, amount, storedFeatures).score;
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }

function sigmoid(value: number) { return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, value)))); }

type ModelTree = { leaf?: number; feature?: number; threshold?: number; left?: ModelTree; right?: ModelTree };
type RuntimeModel = { name: string; runtime: string; parameters: { bias?: number; weights?: number[]; learningRate?: number; trees?: ModelTree[] } };
type ModelFeatures = number[];
type FeatureSource = Record<string, string | undefined>;

const runtimeModels = trainedArtifact.models as unknown as RuntimeModel[];
const runtimeModelByRuntime = new Map(runtimeModels.map((model) => [model.runtime, model]));
const runtimeFeatureNames = trainedArtifact.features as unknown as string[];

function numberFrom(source: FeatureSource, key: string, fallback: number) {
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : fallback;
}

function dot(left: number[], right: number[]) { return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0); }

export function modelFeatures(pattern: string, amount: number, source: FeatureSource = {}): ModelFeatures {
  const normalized = pattern.toLowerCase();
  const duplicate = normalized.includes('duplicate');
  const single = normalized.includes('single');
  const split = normalized.includes('split');
  const overbill = normalized.includes('overbill');
  const conflict = normalized.includes('conflict');
  const amountUsd = numberFrom(source, 'amount_usd', amount);
  const contractAmount = numberFrom(source, 'contract_amount_usd', overbill ? amountUsd / 1.34 : split ? amountUsd * 1.05 : amountUsd);
  const bidderCount = numberFrom(source, 'bidder_count', single ? 1 : 4);
  const biddingWindow = numberFrom(source, 'bidding_window_days', single ? 3 : 30);
  const priceDeviation = numberFrom(source, 'price_deviation_pct', overbill ? 34 : 2);
  const duplicateCount = numberFrom(source, 'invoice_duplicate_count', duplicate ? 2 : 1);
  const invoicesLast30d = numberFrom(source, 'invoices_last_30d', duplicate ? 12 : 3);
  const approvalOverride = numberFrom(source, 'approval_override_count', split || conflict ? 1 : 0);
  const domainMatch = numberFrom(source, 'approver_vendor_domain_match', conflict ? 1 : 0);
  const splitTotal = numberFrom(source, 'split_group_total_usd', split ? amountUsd * 4 : 0);
  const supplierAge = numberFrom(source, 'supplier_age_days', conflict ? 180 : 1500);
  const relatedSupplierCount = numberFrom(source, 'related_supplier_count', conflict ? 2 : 0);
  return [
    clamp(Math.log1p(Math.max(amountUsd, 0)) / Math.log1p(180000)),
    clamp(amountUsd / Math.max(contractAmount, 1) / 2),
    1 - clamp((bidderCount - 1) / 7),
    1 - clamp((biddingWindow - 1) / 44),
    clamp((priceDeviation + 10) / 78),
    clamp((duplicateCount - 1) / 3),
    clamp(invoicesLast30d / 26),
    approvalOverride ? 1 : 0,
    domainMatch ? 1 : 0,
    clamp(splitTotal / Math.max(amountUsd * 7, 1)),
    1 - clamp((supplierAge - 30) / 4170),
    clamp(relatedSupplierCount / 4),
  ];
}

function treePredict(tree: ModelTree, features: ModelFeatures): number {
  if (tree.leaf !== undefined) return tree.leaf;
  const feature = tree.feature ?? 0;
  const branch = features[feature] <= (tree.threshold ?? 0) ? tree.left : tree.right;
  return branch ? treePredict(branch, features) : 0;
}

function probabilityForModel(features: ModelFeatures, model: RuntimeModel) {
  if (model.runtime === 'logistic_regression') {
    const parameters = model.parameters;
    return sigmoid((parameters.bias ?? 0) + dot(features, parameters.weights ?? []));
  }
  if (model.runtime === 'random_forest') {
    const trees = model.parameters.trees ?? [];
    return trees.reduce((sum, tree) => sum + treePredict(tree, features), 0) / Math.max(trees.length, 1);
  }
  const parameters = model.parameters;
  const learningRate = parameters.learningRate ?? 0.12;
  const raw = (parameters.trees ?? []).reduce((sum, tree) => sum + learningRate * treePredict(tree, features), parameters.bias ?? 0);
  return sigmoid(raw);
}

function modelProbabilities(features: ModelFeatures) {
  const xgboostProbability = probabilityForModel(features, runtimeModelByRuntime.get('gradient_boosted_trees')!);
  const forestProbability = probabilityForModel(features, runtimeModelByRuntime.get('random_forest')!);
  const logisticProbability = probabilityForModel(features, runtimeModelByRuntime.get('logistic_regression')!);
  const weights = trainedArtifact.ensemble.weights;
  return { xgboost: xgboostProbability, randomForest: forestProbability, logisticRegression: logisticProbability, ensemble: xgboostProbability * weights.xgboost + forestProbability * weights.randomForest + logisticProbability * weights.logisticRegression };
}

function coalitionProbability(features: ModelFeatures, mask: number) {
  const coalition = features.map((value, index) => mask & (1 << index) ? value : 0);
  return modelProbabilities(coalition).ensemble;
}

function exactShapley(features: ModelFeatures) {
  const featureCount = features.length;
  const factorial = [1];
  for (let index = 1; index <= featureCount; index += 1) factorial[index] = factorial[index - 1] * index;
  const values = Array(featureCount).fill(0) as number[];
  const fullMask = (1 << featureCount) - 1;
  const coalitionProbabilities = new Map<number, number>();
  const probabilityForCoalition = (mask: number) => {
    if (!coalitionProbabilities.has(mask)) coalitionProbabilities.set(mask, coalitionProbability(features, mask));
    return coalitionProbabilities.get(mask)!;
  };
  const baseProbability = probabilityForCoalition(0);
  for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
    for (let subset = 0; subset <= fullMask; subset += 1) {
      if (subset & (1 << featureIndex)) continue;
      const subsetSize = subset.toString(2).split('1').length - 1;
      const weight = factorial[subsetSize] * factorial[featureCount - subsetSize - 1] / factorial[featureCount];
      values[featureIndex] += weight * (probabilityForCoalition(subset | (1 << featureIndex)) - probabilityForCoalition(subset));
    }
  }
  return { values, baseProbability, fullProbability: probabilityForCoalition(fullMask) };
}

export function modelScore(pattern: string, amount: number, storedFeatures?: ModelFeatures) {
  const features = storedFeatures?.length === runtimeFeatureNames.length ? storedFeatures : modelFeatures(pattern, amount);
  const probabilities = modelProbabilities(features);
  const shap = exactShapley(features);
  const labels = ['Amount scale', 'Contract ratio', 'Bidder scarcity', 'Bid-window risk', 'Price deviation', 'Duplicate signal', 'Invoice velocity', 'Approval override', 'Domain match', 'Split ratio', 'Supplier youth', 'Related suppliers'];
  const maxAbs = Math.max(...shap.values.map((value) => Math.abs(value)), 0.0001);
  const contributions: FeatureContribution[] = shap.values.map((contribution, index) => ({ label: labels[index], contribution: Number(contribution.toFixed(4)), value: Math.round(Math.abs(contribution) / maxAbs * 100), direction: contribution >= 0 ? 'risk' : 'protective' }));
  return { score: Math.max(5, Math.min(99, Math.round(probabilities.ensemble * 100))), contributions, models: { xgboost: Math.round(probabilities.xgboost * 100), randomForest: Math.round(probabilities.randomForest * 100), logisticRegression: Math.round(probabilities.logisticRegression * 100) }, baseRisk: Math.round(shap.baseProbability * 100), ensembleProbability: Number(probabilities.ensemble.toFixed(4)), decisionThreshold: trainedArtifact.ensemble.threshold, explanationMethod: 'exact_shapley_enumeration' };
}

export async function explainTransaction(id: string) {
  const row = await env.DB.prepare(`SELECT id, supplier, amount, pattern, risk_score, status, reason, model_features_json, created_at FROM procurement_transactions WHERE id = ?`).bind(id).first<TransactionRow>();
  if (!row) return null;
  const storedFeatures = row.model_features_json ? JSON.parse(row.model_features_json) as ModelFeatures : undefined;
  const scored = modelScore(row.pattern, row.amount, storedFeatures);
  return { id: row.id, supplier: row.supplier, amount: row.amount, pattern: row.pattern, risk: row.risk_score, status: row.status, reason: row.reason, date: displayDate(row.created_at), contributions: scored.contributions, modelScores: scored.models, baseRisk: scored.baseRisk, ensembleProbability: scored.ensembleProbability, explanationMethod: scored.explanationMethod, decisionThreshold: scored.decisionThreshold };
}

export async function listModelSnapshots() {
  const now = new Date().toISOString();
  const ids = ['model-xgboost-v1', 'model-random-forest-v1', 'model-logistic-v1'];
  const statements = trainedArtifact.models.flatMap((model, index) => [
    env.DB.prepare(`INSERT OR IGNORE INTO model_snapshots (id, name, version, accuracy, false_positive_rate, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(ids[index], model.name, model.version, model.metrics.accuracy, model.metrics.falsePositiveRate, index === 0 ? 1 : 0, now),
    env.DB.prepare(`UPDATE model_snapshots SET version = ?, accuracy = ?, false_positive_rate = ? WHERE id = ?`).bind(model.version, model.metrics.accuracy, model.metrics.falsePositiveRate, ids[index]),
  ]);
  await env.DB.batch(statements);
  const result = await env.DB.prepare(`SELECT id, name, version, accuracy, false_positive_rate, is_approved, created_at FROM model_snapshots ORDER BY is_approved DESC, accuracy DESC`).all();
  const modelsByName = new Map(trainedArtifact.models.map((model) => [model.name, model]));
  return (result.results ?? []).map((row) => {
    const model = modelsByName.get(String(row.name));
    return { ...row, decision_threshold: model?.threshold ?? 0.5, roc_auc: model?.metrics.rocAuc ?? 0.5, validation_false_positive_rate: model?.validationMetrics.falsePositiveRate ?? null };
  });
}

export function riskLevel(score: number) {
  return score >= 80 ? 'High' : score >= 55 ? 'Medium' : 'Low';
}

export async function seedDemoData(actorId = 'system') {
  const now = new Date().toISOString();
  const statements = [];
  for (const [id, supplier, amount, pattern, risk, status, reason] of demoRecords) {
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO procurement_transactions (id, supplier, amount, pattern, risk_score, status, reason, source_file, model_features_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, supplier, amount, pattern, risk, status, reason, 'demo-seed.csv', JSON.stringify(modelFeatures(pattern, amount)), now));
    if (risk >= 55) {
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO alerts (id, transaction_id, risk_level, status, assigned_to, created_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(`ALT-${id}`, id, riskLevel(risk), status, null, now, status === 'Reviewed' ? now : null));
    }
  }
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO model_snapshots (id, name, version, accuracy, false_positive_rate, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind('model-xgboost-v1', 'XGBoost Ensemble', 'v1.0.0', 96.4, 7.8, 1, now));
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO model_snapshots (id, name, version, accuracy, false_positive_rate, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind('model-random-forest-v1', 'Random Forest', 'v1.0.0', 93.1, 9.2, 0, now));
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO model_snapshots (id, name, version, accuracy, false_positive_rate, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind('model-logistic-v1', 'Logistic Regression', 'v1.0.0', 88.7, 11.4, 0, now));
  statements.push(env.DB.prepare(`INSERT INTO audit_events (id, actor_id, event_type, message, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(`AUD-${crypto.randomUUID()}`, actorId, 'seed', 'Demo procurement batch loaded for the first review session.', null, now));
  await env.DB.batch(statements);
}

export async function listTransactions() {
  const result = await env.DB.prepare(`SELECT id, supplier, amount, pattern, risk_score, status, reason, model_features_json, created_at FROM procurement_transactions ORDER BY created_at DESC`).all<TransactionRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    supplier: row.supplier,
    amount: row.amount,
    pattern: row.pattern,
    risk: row.risk_score,
    status: row.status as RiskStatus,
    reason: row.reason,
    date: displayDate(row.created_at),
  }));
}

export async function addAuditEvent(actorId: string, eventType: string, message: string, entityId: string | null = null) {
  await env.DB.prepare(`INSERT INTO audit_events (id, actor_id, event_type, message, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(`AUD-${crypto.randomUUID()}`, actorId, eventType, message, entityId, new Date().toISOString()).run();
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

export function parseCsv(text: string) {
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length < 2) throw new Error('CSV must include a header and at least one record.');
  const headers = parseCsvLine(rows.shift()!).map((header) => header.toLowerCase().replace(/\s+/g, '_'));
  const aliases = {
    id: ['id', 'transaction_id', 'po_id', 'invoice_id'],
    supplier: ['supplier', 'supplier_name', 'vendor', 'vendor_name'],
    amount: ['amount', 'amount_usd', 'value', 'amount_local'],
    pattern: ['pattern', 'risk_pattern', 'anomaly_type', 'fraud_type'],
  } as const;
  const column = (names: readonly string[]) => names.find((name) => headers.includes(name));
  const idColumn = column(aliases.id);
  const supplierColumn = column(aliases.supplier);
  const amountColumn = column(aliases.amount);
  const patternColumn = column(aliases.pattern);
  if (!idColumn || !supplierColumn || !amountColumn) throw new Error('CSV headers must include an id (or transaction_id), supplier (or supplier_name), and amount (or amount_usd) column.');
  const errors: string[] = [];
  const records = rows.map((line, index) => {
    const values = parseCsvLine(line);
    const record = Object.fromEntries(headers.map((header, valueIndex) => [header, values[valueIndex] ?? '']));
    const id = record[idColumn]?.trim() ?? '';
    const supplier = record[supplierColumn]?.trim() ?? '';
    const amount = Number((record[amountColumn] ?? '').replace(/[$,\s]/g, ''));
    const pattern = patternColumn ? record[patternColumn]?.trim() || 'Unclassified purchase' : 'Unclassified purchase';
    if (!id || !supplier || !Number.isFinite(amount) || amount < 0) errors.push(`Row ${index + 2} has an invalid id, supplier, or non-negative amount.`);
    if (id.length > 120 || supplier.length > 200 || pattern.length > 120) errors.push(`Row ${index + 2} exceeds the supported field length.`);
    return { id, supplier, amount, pattern, modelFeatures: modelFeatures(pattern, amount, record) };
  });
  if (errors.length) throw new Error(`CSV validation failed: ${errors.slice(0, 5).join(' ')}${errors.length > 5 ? ` ${errors.length - 5} more row errors.` : ''}`);
  return records;
}
