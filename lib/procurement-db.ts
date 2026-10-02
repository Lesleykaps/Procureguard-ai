import { assertSupabase, getSupabaseServer } from './supabase-server';
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
  model_features_json: unknown | null;
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

function normalizeRole(value: unknown): AppRole {
  return value === 'Admin' || value === 'Auditor' || value === 'Procurement Officer' || value === 'Manager' ? value : 'Auditor';
}

export function hasPermission(role: AppRole, permission: AppPermission) {
  return rolePermissions[role].includes(permission);
}

export async function getAuthenticatedActor(request: Request): Promise<AuthenticatedActor | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const supabase = getSupabaseServer();
  const identity = await supabase.auth.getUser(token);
  if (identity.error || !identity.data.user?.email) return null;
  const userId = identity.data.user.id;
  const email = identity.data.user.email;
  const displayName = typeof identity.data.user.user_metadata.full_name === 'string' ? identity.data.user.user_metadata.full_name : email;
  const existing = await supabase.from('app_users').select('id, email, display_name, role').eq('id', userId).maybeSingle();
  assertSupabase(existing);
  if (!existing.data) {
    const inserted = await supabase.from('app_users').insert({ id: userId, email, display_name: displayName, role: 'Auditor' });
    assertSupabase(inserted);
  }
  const user = existing.data ?? { id: userId, email, display_name: displayName, role: 'Auditor' };
  return { userId: user.id, email: user.email, displayName: user.display_name || email, role: normalizeRole(user.role) };
}

export function displayDate(isoDate: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(isoDate));
}

export async function scoreTransaction(pattern: string, amount: number, storedFeatures?: ModelFeatures) {
  return (await modelScore(pattern, amount, storedFeatures)).score;
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }

function sigmoid(value: number) { return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, value)))); }

type ModelTree = { leaf?: number; feature?: number; threshold?: number; left?: ModelTree; right?: ModelTree };
type RuntimeModel = { name: string; runtime: string; parameters: { bias?: number; weights?: number[]; learningRate?: number; trees?: ModelTree[] } };
type ModelFeatures = number[];
type FeatureSource = Record<string, string | undefined>;

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

type ActiveArtifact = {
  features: string[];
  models: RuntimeModel[];
  ensemble: { weights: { xgboost: number; randomForest: number; logisticRegression: number }; threshold: number };
};

function candidateToArtifact(candidate: { features?: string[]; model?: { runtime?: string; bias?: number; weights?: number[]; threshold?: number } }): ActiveArtifact | null {
  if (candidate.model?.runtime !== 'logistic_regression' || !Array.isArray(candidate.model.weights) || !Number.isFinite(candidate.model.bias) || !Number.isFinite(candidate.model.threshold)) return null;
  return {
    features: candidate.features ?? runtimeFeatureNames,
    models: [{ name: 'Reviewer-trained Logistic Regression', runtime: 'logistic_regression', parameters: { bias: candidate.model.bias!, weights: candidate.model.weights } }],
    ensemble: { weights: { xgboost: 0, randomForest: 0, logisticRegression: 1 }, threshold: candidate.model.threshold! },
  };
}

function parseActiveArtifact(value: unknown | null): ActiveArtifact {
  if (!value) return trainedArtifact as unknown as ActiveArtifact;
  try {
    const parsed = (typeof value === 'string' ? JSON.parse(value) : value) as { models?: RuntimeModel[]; ensemble?: ActiveArtifact['ensemble']; features?: string[]; model?: unknown };
    if (Array.isArray(parsed.models) && parsed.ensemble && Array.isArray(parsed.features)) return parsed as ActiveArtifact;
    return candidateToArtifact(parsed as never) ?? (trainedArtifact as unknown as ActiveArtifact);
  } catch { return trainedArtifact as unknown as ActiveArtifact; }
}

export async function ensureBaselineModelRelease() {
  const now = new Date().toISOString();
  const result = await getSupabaseServer().from('model_releases').upsert({ id: 'release-synthetic-v1', name: 'Synthetic ensemble baseline', version: 'synthetic-v1.0.0', status: 'active', artifact_json: trainedArtifact, metrics_json: trainedArtifact.ensemble.metrics, source: 'synthetic_development', submitted_by: 'system', approved_by: 'system', approved_at: now, activated_by: 'system', activated_at: now, decision_note: 'Development baseline; not a production-performance claim.', created_at: now }, { onConflict: 'id', ignoreDuplicates: true });
  assertSupabase(result);
}

export async function activeModelRelease() {
  await ensureBaselineModelRelease();
  const result = await getSupabaseServer().from('model_releases').select('id, name, version, status, artifact_json, metrics_json, source, activated_at, created_at').eq('status', 'active').order('activated_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();
  assertSupabase(result);
  return result.data;
}

function modelProbabilities(features: ModelFeatures, artifact: ActiveArtifact) {
  const byRuntime = new Map(artifact.models.map((model) => [model.runtime, model]));
  const xgboost = byRuntime.get('gradient_boosted_trees');
  const forest = byRuntime.get('random_forest');
  const logistic = byRuntime.get('logistic_regression');
  const xgboostProbability = xgboost ? probabilityForModel(features, xgboost) : 0;
  const forestProbability = forest ? probabilityForModel(features, forest) : 0;
  const logisticProbability = logistic ? probabilityForModel(features, logistic) : 0;
  const weights = artifact.ensemble.weights;
  return { xgboost: xgboostProbability, randomForest: forestProbability, logisticRegression: logisticProbability, ensemble: xgboostProbability * weights.xgboost + forestProbability * weights.randomForest + logisticProbability * weights.logisticRegression };
}

function coalitionProbability(features: ModelFeatures, mask: number, artifact: ActiveArtifact) {
  const coalition = features.map((value, index) => mask & (1 << index) ? value : 0);
  return modelProbabilities(coalition, artifact).ensemble;
}

function exactShapley(features: ModelFeatures, artifact: ActiveArtifact) {
  const featureCount = features.length;
  const factorial = [1];
  for (let index = 1; index <= featureCount; index += 1) factorial[index] = factorial[index - 1] * index;
  const values = Array(featureCount).fill(0) as number[];
  const fullMask = (1 << featureCount) - 1;
  const coalitionProbabilities = new Map<number, number>();
  const probabilityForCoalition = (mask: number) => {
    if (!coalitionProbabilities.has(mask)) coalitionProbabilities.set(mask, coalitionProbability(features, mask, artifact));
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

export async function modelScore(pattern: string, amount: number, storedFeatures?: ModelFeatures) {
  const release = await activeModelRelease();
  const artifact = parseActiveArtifact(release?.artifact_json ?? null);
  const features = storedFeatures?.length === artifact.features.length ? storedFeatures : modelFeatures(pattern, amount);
  const probabilities = modelProbabilities(features, artifact);
  const shap = exactShapley(features, artifact);
  const labels = ['Amount scale', 'Contract ratio', 'Bidder scarcity', 'Bid-window risk', 'Price deviation', 'Duplicate signal', 'Invoice velocity', 'Approval override', 'Domain match', 'Split ratio', 'Supplier youth', 'Related suppliers'];
  const maxAbs = Math.max(...shap.values.map((value) => Math.abs(value)), 0.0001);
  const contributions: FeatureContribution[] = shap.values.map((contribution, index) => ({ label: labels[index], contribution: Number(contribution.toFixed(4)), value: Math.round(Math.abs(contribution) / maxAbs * 100), direction: contribution >= 0 ? 'risk' : 'protective' }));
  return { score: Math.max(5, Math.min(99, Math.round(probabilities.ensemble * 100))), contributions, models: { xgboost: Math.round(probabilities.xgboost * 100), randomForest: Math.round(probabilities.randomForest * 100), logisticRegression: Math.round(probabilities.logisticRegression * 100) }, baseRisk: Math.round(shap.baseProbability * 100), ensembleProbability: Number(probabilities.ensemble.toFixed(4)), decisionThreshold: artifact.ensemble.threshold, explanationMethod: 'exact_shapley_enumeration', release: { id: release?.id ?? 'release-synthetic-v1', name: release?.name ?? 'Synthetic ensemble baseline', version: release?.version ?? 'synthetic-v1.0.0' } };
}

export async function explainTransaction(id: string) {
  const result = await getSupabaseServer().from('procurement_transactions').select('id, supplier, amount, pattern, risk_score, status, reason, model_features_json, created_at').eq('id', id).maybeSingle();
  assertSupabase(result);
  const row = result.data as TransactionRow | null;
  if (!row) return null;
  const storedFeatures = Array.isArray(row.model_features_json) ? row.model_features_json as ModelFeatures : undefined;
  const scored = await modelScore(row.pattern, row.amount, storedFeatures);
  return { id: row.id, supplier: row.supplier, amount: row.amount, pattern: row.pattern, risk: row.risk_score, status: row.status, reason: row.reason, date: displayDate(row.created_at), contributions: scored.contributions, modelScores: scored.models, baseRisk: scored.baseRisk, ensembleProbability: scored.ensembleProbability, explanationMethod: scored.explanationMethod, decisionThreshold: scored.decisionThreshold, release: scored.release };
}

export async function listModelSnapshots() {
  const now = new Date().toISOString();
  const ids = ['model-xgboost-v1', 'model-random-forest-v1', 'model-logistic-v1'];
  const supabase = getSupabaseServer();
  const saved = await supabase.from('model_snapshots').upsert(trainedArtifact.models.map((model, index) => ({ id: ids[index], name: model.name, version: model.version, accuracy: model.metrics.accuracy, false_positive_rate: model.metrics.falsePositiveRate, is_approved: index === 0, created_at: now })), { onConflict: 'id' });
  assertSupabase(saved);
  const result = await supabase.from('model_snapshots').select('id, name, version, accuracy, false_positive_rate, is_approved, created_at').order('is_approved', { ascending: false }).order('accuracy', { ascending: false });
  assertSupabase(result);
  const modelsByName = new Map(trainedArtifact.models.map((model) => [model.name, model]));
  return (result.data ?? []).map((row) => {
    const model = modelsByName.get(String(row.name));
    return { ...row, decision_threshold: model?.threshold ?? 0.5, roc_auc: model?.metrics.rocAuc ?? 0.5, validation_false_positive_rate: model?.validationMetrics.falsePositiveRate ?? null };
  });
}

export function riskLevel(score: number) {
  return score >= 80 ? 'High' : score >= 55 ? 'Medium' : 'Low';
}

export async function seedDemoData(actorId = 'system') {
  const now = new Date().toISOString();
  const supabase = getSupabaseServer();
  const transactions = demoRecords.map(([id, supplier, amount, pattern, risk, status, reason]) => ({ id, supplier, amount, pattern, risk_score: risk, status, reason, source_file: 'demo-seed.csv', model_features_json: modelFeatures(pattern, amount), created_at: now }));
  const savedTransactions = await supabase.from('procurement_transactions').upsert(transactions, { onConflict: 'id', ignoreDuplicates: true });
  assertSupabase(savedTransactions);
  const alerts = demoRecords.filter(([, , , , risk]) => risk >= 55).map(([id, , , , risk, status]) => ({ id: `ALT-${id}`, transaction_id: id, risk_level: riskLevel(risk), status, assigned_to: null, created_at: now, reviewed_at: status === 'Reviewed' ? now : null }));
  const savedAlerts = await supabase.from('alerts').upsert(alerts, { onConflict: 'id', ignoreDuplicates: true });
  assertSupabase(savedAlerts);
  await listModelSnapshots();
  await addAuditEvent(actorId, 'seed', 'Demo procurement batch loaded for the first review session.');
}

export async function listTransactions() {
  const result = await getSupabaseServer().from('procurement_transactions').select('id, supplier, amount, pattern, risk_score, status, reason, model_features_json, created_at').order('created_at', { ascending: false });
  assertSupabase(result);
  return ((result.data ?? []) as TransactionRow[]).map((row) => ({
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
  const result = await getSupabaseServer().from('audit_events').insert({ id: `AUD-${crypto.randomUUID()}`, actor_id: actorId, event_type: eventType, message, entity_id: entityId, created_at: new Date().toISOString() });
  assertSupabase(result);
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
