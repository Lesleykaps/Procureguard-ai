import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dataPath = join(process.cwd(), 'ml', 'synthetic_procurement_transactions.csv');
const artifactPath = join(process.cwd(), 'ml', 'model-artifacts.json');
const TARGET_VALIDATION_FPR = 8;
let state = 9072026 >>> 0;
function random() { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; }
function integer(min, max) { return Math.floor(random() * (max - min + 1)) + min; }
function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function sigmoid(value) { return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, value)))); }
function logit(value) { return Math.log(clamp(value, 0.0001, 0.9999) / (1 - clamp(value, 0.0001, 0.9999))); }

function parseCsv(text) {
  const records = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value.length)) records.push(row); row = [];
    } else field += character;
  }
  if (field.length || row.length) { row.push(field); records.push(row); }
  const headers = records.shift();
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

const featureNames = ['amount_scale', 'contract_ratio', 'bidder_scarcity', 'bid_window_risk', 'price_deviation', 'duplicate_signal', 'invoice_velocity', 'approval_override', 'domain_match', 'split_ratio', 'supplier_youth', 'related_supplier_signal'];
function features(record) {
  const amount = Number(record.amount_usd);
  const contract = Math.max(1, Number(record.contract_amount_usd));
  return [
    clamp(Math.log1p(amount) / Math.log1p(180000)),
    clamp(amount / contract / 2),
    1 - clamp((Number(record.bidder_count) - 1) / 7),
    1 - clamp((Number(record.bidding_window_days) - 1) / 44),
    clamp((Number(record.price_deviation_pct) + 10) / 78),
    clamp((Number(record.invoice_duplicate_count) - 1) / 3),
    clamp(Number(record.invoices_last_30d) / 26),
    Number(record.approval_override_count) ? 1 : 0,
    Number(record.approver_vendor_domain_match) ? 1 : 0,
    clamp(Number(record.split_group_total_usd) / Math.max(amount * 7, 1)),
    1 - clamp((Number(record.supplier_age_days) - 30) / 4170),
    clamp(Number(record.related_supplier_count) / 4),
  ];
}
function dot(left, right) { return left.reduce((sum, value, index) => sum + value * right[index], 0); }
function sampleRows(rows, size) { return Array.from({ length: size }, () => rows[integer(0, rows.length - 1)]); }
function gini(rows) {
  if (!rows.length) return 0;
  const positive = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
  return 1 - positive * positive - (1 - positive) * (1 - positive);
}
function mean(rows) { return rows.reduce((sum, row) => sum + row.y, 0) / Math.max(rows.length, 1); }
function candidateThresholds(rows, featureIndex, count = 7) {
  const values = rows.map((row) => row.x[featureIndex]).sort((left, right) => left - right);
  return Array.from({ length: count }, (_, index) => values[Math.floor(((index + 1) / (count + 1)) * (values.length - 1))]).filter((value, index, all) => index === 0 || value !== all[index - 1]);
}
function classificationTree(rows, depth, featureChoices) {
  const positiveRate = mean(rows);
  if (depth === 0 || rows.length < 24 || positiveRate === 0 || positiveRate === 1) return { leaf: positiveRate };
  let best = null;
  for (const feature of featureChoices) {
    for (const threshold of candidateThresholds(rows, feature)) {
      const left = rows.filter((row) => row.x[feature] <= threshold);
      const right = rows.filter((row) => row.x[feature] > threshold);
      if (left.length < 8 || right.length < 8) continue;
      const impurity = (left.length * gini(left) + right.length * gini(right)) / rows.length;
      if (!best || impurity < best.impurity) best = { feature, threshold, left, right, impurity };
    }
  }
  if (!best) return { leaf: positiveRate };
  return { feature: best.feature, threshold: best.threshold, left: classificationTree(best.left, depth - 1, featureChoices), right: classificationTree(best.right, depth - 1, featureChoices) };
}
function classificationPredict(tree, x) { return tree.leaf === undefined ? classificationPredict(x[tree.feature] <= tree.threshold ? tree.left : tree.right, x) : tree.leaf; }
function regressionTree(rows, depth) {
  const value = rows.reduce((sum, row) => sum + row.target, 0) / Math.max(rows.length, 1);
  if (depth === 0 || rows.length < 24) return { leaf: value };
  let best = null;
  for (let feature = 0; feature < featureNames.length; feature += 1) {
    for (const threshold of candidateThresholds(rows.map((row) => ({ x: row.x, y: row.target })), feature, 5)) {
      const left = rows.filter((row) => row.x[feature] <= threshold);
      const right = rows.filter((row) => row.x[feature] > threshold);
      if (left.length < 8 || right.length < 8) continue;
      const leftMean = left.reduce((sum, row) => sum + row.target, 0) / left.length;
      const rightMean = right.reduce((sum, row) => sum + row.target, 0) / right.length;
      const error = left.reduce((sum, row) => sum + (row.target - leftMean) ** 2, 0) + right.reduce((sum, row) => sum + (row.target - rightMean) ** 2, 0);
      if (!best || error < best.error) best = { feature, threshold, left, right, error };
    }
  }
  if (!best) return { leaf: value };
  return { feature: best.feature, threshold: best.threshold, left: regressionTree(best.left, depth - 1), right: regressionTree(best.right, depth - 1) };
}
function regressionPredict(tree, x) { return tree.leaf === undefined ? regressionPredict(x[tree.feature] <= tree.threshold ? tree.left : tree.right, x) : tree.leaf; }
function metrics(rows, probabilities, threshold = 0.5) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  rows.forEach((row, index) => {
    const prediction = probabilities[index] >= threshold ? 1 : 0;
    if (prediction && row.y) tp += 1; else if (!prediction && !row.y) tn += 1; else if (prediction) fp += 1; else fn += 1;
  });
  const ordered = probabilities.map((probability, index) => ({ probability, label: rows[index].y })).sort((left, right) => right.probability - left.probability);
  let positives = 0, negatives = 0, rankSum = 0;
  ordered.forEach((item, index) => { if (item.label) { positives += 1; rankSum += index + 1; } else negatives += 1; });
  const auc = positives && negatives ? (positives * negatives - (rankSum - positives * (positives + 1) / 2)) / (positives * negatives) : 0.5;
  return { threshold: Number(threshold.toFixed(2)), accuracy: Number(((tp + tn) / Math.max(rows.length, 1) * 100).toFixed(2)), precision: Number((tp / Math.max(tp + fp, 1) * 100).toFixed(2)), recall: Number((tp / Math.max(tp + fn, 1) * 100).toFixed(2)), falsePositiveRate: Number((fp / Math.max(fp + tn, 1) * 100).toFixed(2)), rocAuc: Number(auc.toFixed(4)), confusionMatrix: { truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn } };
}
function tuneThreshold(rows, probabilities) {
  let best = null;
  for (let step = 5; step <= 95; step += 1) {
    const threshold = step / 100;
    const result = metrics(rows, probabilities, threshold);
    const f2 = (5 * result.precision * result.recall) / Math.max(4 * result.precision + result.recall, 1);
    if (result.falsePositiveRate <= TARGET_VALIDATION_FPR && (!best || f2 > best.f2)) best = { threshold, f2, metrics: result };
  }
  if (best) return best;
  const fallback = Array.from({ length: 91 }, (_, index) => (index + 5) / 100).map((threshold) => ({ threshold, metrics: metrics(rows, probabilities, threshold) })).sort((left, right) => left.metrics.falsePositiveRate - right.metrics.falsePositiveRate || right.metrics.recall - left.metrics.recall)[0];
  return { ...fallback, f2: 0 };
}
function importanceFromTrees(trees) {
  const counts = Array(featureNames.length).fill(0);
  function visit(tree) { if (tree.leaf === undefined) { counts[tree.feature] += 1; visit(tree.left); visit(tree.right); } }
  trees.forEach(visit);
  const total = counts.reduce((sum, value) => sum + value, 0) || 1;
  return counts.map((value) => Number((value / total).toFixed(4)));
}

const raw = await readFile(dataPath, 'utf8');
const records = parseCsv(raw).map((record) => ({ x: features(record), y: Number(record.label_fraud), id: record.transaction_id, split: record.dataset_split }));
const train = records.filter((record) => record.split === 'train');
const validation = records.filter((record) => record.split === 'validation');
const test = records.filter((record) => record.split === 'test');
const positives = train.filter((row) => row.y === 1);
const negatives = train.filter((row) => row.y === 0);
const balanced = train.slice();
while (balanced.filter((row) => row.y === 1).length < negatives.length) {
  const first = positives[integer(0, positives.length - 1)];
  const second = positives[integer(0, positives.length - 1)];
  const alpha = random();
  balanced.push({ x: first.x.map((value, index) => value + alpha * (second.x[index] - value)), y: 1, id: `SMOTE-${balanced.length}`, split: 'train' });
}

const logistic = { weights: Array(featureNames.length).fill(0), bias: logit(train.reduce((sum, row) => sum + row.y, 0) / train.length) };
for (let epoch = 0; epoch < 220; epoch += 1) {
  const gradient = Array(featureNames.length).fill(0); let biasGradient = 0;
  for (const row of balanced) {
    const error = sigmoid(logistic.bias + dot(row.x, logistic.weights)) - row.y;
    logistic.weights.forEach((_, index) => { gradient[index] += error * row.x[index]; });
    biasGradient += error;
  }
  logistic.weights = logistic.weights.map((weight, index) => weight - 0.12 * (gradient[index] / balanced.length + 0.001 * weight));
  logistic.bias -= 0.12 * biasGradient / balanced.length;
}
const logisticPredict = (row) => sigmoid(logistic.bias + dot(row.x, logistic.weights));

const forestTrees = [];
for (let treeIndex = 0; treeIndex < 24; treeIndex += 1) {
  const subset = sampleRows(balanced, Math.min(4200, balanced.length));
  const choices = Array.from({ length: featureNames.length }, (_, index) => index).sort(() => random() - 0.5).slice(0, 4);
  forestTrees.push(classificationTree(subset, 4, choices));
}
const forestPredict = (row) => forestTrees.reduce((sum, tree) => sum + classificationPredict(tree, row.x), 0) / forestTrees.length;

let boostRaw = balanced.reduce((sum, row) => sum + row.y, 0) / balanced.length;
const boostBias = logit(boostRaw);
const boostTrees = [];
const boostLearningRate = 0.12;
for (let stage = 0; stage < 32; stage += 1) {
  const rows = balanced.map((row) => ({ x: row.x, target: row.y - sigmoid(boostRaw) }));
  const tree = regressionTree(rows, 3);
  boostTrees.push(tree);
  for (const row of balanced) boostRaw += boostLearningRate * regressionPredict(tree, row.x);
}
const boostPredict = (row) => {
  let value = boostBias;
  for (const tree of boostTrees) value += boostLearningRate * regressionPredict(tree, row.x);
  return sigmoid(value);
};
const ensemblePredict = (row) => boostPredict(row) * 0.5 + forestPredict(row) * 0.3 + logisticPredict(row) * 0.2;

const validationProbabilities = {
  boost: validation.map(boostPredict),
  forest: validation.map(forestPredict),
  logistic: validation.map(logisticPredict),
  ensemble: validation.map(ensemblePredict),
};
const tuned = {
  boost: tuneThreshold(validation, validationProbabilities.boost),
  forest: tuneThreshold(validation, validationProbabilities.forest),
  logistic: tuneThreshold(validation, validationProbabilities.logistic),
  ensemble: tuneThreshold(validation, validationProbabilities.ensemble),
};

const modelRows = [
  { name: 'XGBoost Ensemble', version: 'synthetic-v1', description: 'Compact gradient-boosted tree ensemble trained on the synthetic procurement dataset.', probabilities: test.map(boostPredict), threshold: tuned.boost.threshold, validation: tuned.boost.metrics, featureImportance: importanceFromTrees(boostTrees), runtime: 'gradient_boosted_trees', parameters: { bias: boostBias, learningRate: boostLearningRate, trees: boostTrees } },
  { name: 'Random Forest', version: 'synthetic-v1', description: 'Bagged decision-tree benchmark with randomized feature selection.', probabilities: test.map(forestPredict), threshold: tuned.forest.threshold, validation: tuned.forest.metrics, featureImportance: importanceFromTrees(forestTrees), runtime: 'random_forest', parameters: { trees: forestTrees } },
  { name: 'Logistic Regression', version: 'synthetic-v1', description: 'Regularized linear benchmark for transparent comparison.', probabilities: test.map(logisticPredict), threshold: tuned.logistic.threshold, validation: tuned.logistic.metrics, featureImportance: logistic.weights.map((weight) => Math.abs(weight)).map((value, _, all) => value / (all.reduce((sum, item) => sum + item, 0) || 1)), runtime: 'logistic_regression', parameters: logistic },
];
const artifact = {
  artifactVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  dataset: { file: 'synthetic_procurement_transactions.csv', rows: records.length, trainingRows: train.length, validationRows: validation.length, testRows: test.length, trainingRowsAfterSmote: balanced.length, fraudRate: Number((records.reduce((sum, row) => sum + row.y, 0) / records.length * 100).toFixed(2)), smoteApplied: true, label: 'synthetic_development_only' },
  features: featureNames,
  models: modelRows.map((model) => ({ name: model.name, version: model.version, description: model.description, runtime: model.runtime, threshold: model.threshold, validationMetrics: model.validation, metrics: metrics(test, model.probabilities, model.threshold), featureImportance: model.featureImportance.map((value) => Number(value.toFixed(4))), parameters: model.parameters })),
  ensemble: { weights: { xgboost: 0.5, randomForest: 0.3, logisticRegression: 0.2 }, threshold: tuned.ensemble.threshold, validationMetrics: tuned.ensemble.metrics, metrics: metrics(test, test.map(ensemblePredict), tuned.ensemble.threshold) },
  calibration: { method: 'maximize F2 subject to a conservative validation false-positive ceiling', validationTargetFalsePositiveRate: TARGET_VALIDATION_FPR, selectionSplit: 'validation', evaluationSplit: 'test' },
  explanation: { method: 'exact_shapley_enumeration', featureCount: featureNames.length, note: 'The hosted Worker scores with these serialized model parameters and calculates exact Shapley values across the full deployed feature vector by coalition enumeration. Python SHAP remains optional for offline plots.' },
  note: 'Metrics are measured on the held-out synthetic test split after choosing thresholds on validation. They are not production performance claims.',
};
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(`Trained 3 models on ${train.length.toLocaleString()} source training rows (${balanced.length.toLocaleString()} after SMOTE).`);
for (const model of artifact.models) console.log(`${model.name}: threshold ${model.threshold}, accuracy ${model.metrics.accuracy}%, recall ${model.metrics.recall}%, false positives ${model.metrics.falsePositiveRate}%, ROC-AUC ${model.metrics.rocAuc}.`);
console.log(`Ensemble: threshold ${artifact.ensemble.threshold}, accuracy ${artifact.ensemble.metrics.accuracy}%, recall ${artifact.ensemble.metrics.recall}%, false positives ${artifact.ensemble.metrics.falsePositiveRate}%, ROC-AUC ${artifact.ensemble.metrics.rocAuc}.`);
console.log(`Artifact: ${artifactPath}`);
