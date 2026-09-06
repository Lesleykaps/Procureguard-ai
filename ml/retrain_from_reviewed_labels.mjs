import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const featureNames = ['amount_scale', 'contract_ratio', 'bidder_scarcity', 'bid_window_risk', 'price_deviation', 'duplicate_signal', 'invoice_velocity', 'approval_override', 'domain_match', 'split_ratio', 'supplier_youth', 'related_supplier_signal'];
const TARGET_FALSE_POSITIVE_RATE = 8;
const DEFAULT_OUTPUT = join(process.cwd(), 'ml', 'retraining-candidate.json');

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function sigmoid(value) { return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, value)))); }
function dot(left, right) { return left.reduce((sum, value, index) => sum + value * right[index], 0); }

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { values.push(value); value = ''; }
    else value += character;
  }
  values.push(value);
  return values;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) throw new Error('The reviewer label export is empty.');
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function metrics(rows, probabilities, threshold) {
  let truePositive = 0; let trueNegative = 0; let falsePositive = 0; let falseNegative = 0;
  rows.forEach((row, index) => {
    const predictedFraud = probabilities[index] >= threshold;
    if (predictedFraud && row.label === 1) truePositive += 1;
    else if (!predictedFraud && row.label === 0) trueNegative += 1;
    else if (predictedFraud) falsePositive += 1;
    else falseNegative += 1;
  });
  const positiveTotal = truePositive + falseNegative;
  const negativeTotal = trueNegative + falsePositive;
  const precision = truePositive / Math.max(truePositive + falsePositive, 1);
  const recall = truePositive / Math.max(positiveTotal, 1);
  const ordered = probabilities.map((probability, index) => ({ probability, label: rows[index].label })).sort((left, right) => right.probability - left.probability);
  let positives = 0; let negatives = 0; let rankSum = 0;
  ordered.forEach((item, index) => { if (item.label === 1) { positives += 1; rankSum += index + 1; } else negatives += 1; });
  const rocAuc = positives && negatives ? (positives * negatives - (rankSum - positives * (positives + 1) / 2)) / (positives * negatives) : 0.5;
  return {
    threshold: Number(threshold.toFixed(2)),
    accuracy: Number(((truePositive + trueNegative) / rows.length * 100).toFixed(2)),
    precision: Number((precision * 100).toFixed(2)),
    recall: Number((recall * 100).toFixed(2)),
    falsePositiveRate: Number((falsePositive / Math.max(negativeTotal, 1) * 100).toFixed(2)),
    rocAuc: Number(rocAuc.toFixed(4)),
    confusionMatrix: { truePositive, trueNegative, falsePositive, falseNegative },
  };
}

function chooseThreshold(rows, probabilities) {
  const candidates = Array.from({ length: 91 }, (_, index) => (index + 5) / 100).map((threshold) => {
    const result = metrics(rows, probabilities, threshold);
    const f2 = (5 * result.precision * result.recall) / Math.max(4 * result.precision + result.recall, 1);
    return { threshold, f2, metrics: result };
  });
  const eligible = candidates.filter((candidate) => candidate.metrics.falsePositiveRate <= TARGET_FALSE_POSITIVE_RATE);
  return (eligible.length ? eligible : candidates).sort((left, right) => {
    if (eligible.length) return right.f2 - left.f2 || right.metrics.recall - left.metrics.recall;
    return left.metrics.falsePositiveRate - right.metrics.falsePositiveRate || right.metrics.recall - left.metrics.recall;
  })[0];
}

function usage() {
  console.log('Usage: pnpm run models:retrain:reviewed -- <reviewed-labels.csv> [output.json]');
  console.log('Creates a pending candidate artifact without changing the active model artifact.');
}

const cliArguments = process.argv.slice(2).filter((argument) => argument !== '--');
const [inputArgument, outputArgument] = cliArguments;
if (!inputArgument || inputArgument === '--help' || inputArgument === '-h') {
  usage();
  process.exit(inputArgument ? 0 : 1);
}

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument || DEFAULT_OUTPUT);
const raw = await readFile(inputPath, 'utf8');
const records = parseCsv(raw);
const requiredHeaders = ['transaction_id', 'label_fraud', 'model_features_json'];
const missingHeaders = requiredHeaders.filter((header) => !(header in records[0]));
if (missingHeaders.length) throw new Error(`Reviewer label export is missing required column(s): ${missingHeaders.join(', ')}.`);

const errors = [];
const seenTransactions = new Set();
const rows = [];
records.forEach((record, index) => {
  const lineNumber = index + 2;
  const transactionId = record.transaction_id.trim();
  const label = Number(record.label_fraud);
  let values;
  try { values = JSON.parse(record.model_features_json); } catch { values = null; }
  if (!transactionId) errors.push(`line ${lineNumber}: transaction_id is empty`);
  if (label !== 0 && label !== 1) errors.push(`line ${lineNumber}: label_fraud must be 0 or 1`);
  if (!Array.isArray(values) || values.length !== featureNames.length || values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) errors.push(`line ${lineNumber}: model_features_json must contain ${featureNames.length} numeric features`);
  if (seenTransactions.has(transactionId)) errors.push(`line ${lineNumber}: duplicate transaction_id ${transactionId}`);
  if (transactionId && (label === 0 || label === 1) && Array.isArray(values) && values.length === featureNames.length && values.every((value) => typeof value === 'number' && Number.isFinite(value)) && !seenTransactions.has(transactionId)) {
    seenTransactions.add(transactionId);
    rows.push({ id: transactionId, label, x: values.map((value) => clamp(value)) });
  }
});
if (errors.length) throw new Error(`Cannot train from reviewer labels:\n${errors.slice(0, 12).join('\n')}${errors.length > 12 ? `\n…and ${errors.length - 12} more error(s).` : ''}`);
const positiveRows = rows.filter((row) => row.label === 1);
const negativeRows = rows.filter((row) => row.label === 0);
if (rows.length < 2 || !positiveRows.length || !negativeRows.length) throw new Error('At least two labeled cases with both fraud and non-fraud classes are required before training a candidate model.');

const model = { bias: Math.log(positiveRows.length / negativeRows.length), weights: Array(featureNames.length).fill(0) };
for (let epoch = 0; epoch < 400; epoch += 1) {
  const gradient = Array(featureNames.length).fill(0);
  let biasGradient = 0;
  rows.forEach((row) => {
    const error = sigmoid(model.bias + dot(row.x, model.weights)) - row.label;
    model.weights.forEach((_, featureIndex) => { gradient[featureIndex] += error * row.x[featureIndex]; });
    biasGradient += error;
  });
  model.weights = model.weights.map((weight, featureIndex) => weight - 0.12 * (gradient[featureIndex] / rows.length + 0.01 * weight));
  model.bias -= 0.12 * biasGradient / rows.length;
}
const probabilities = rows.map((row) => sigmoid(model.bias + dot(row.x, model.weights)));
const tuned = chooseThreshold(rows, probabilities);
const candidate = {
  artifactVersion: 'candidate-1.0.0',
  generatedAt: new Date().toISOString(),
  status: 'pending_approval',
  source: { file: basename(inputPath), rows: rows.length, confirmedFraud: positiveRows.length, falsePositive: negativeRows.length, label: 'human_review' },
  features: featureNames,
  model: {
    runtime: 'logistic_regression',
    bias: Number(model.bias.toFixed(8)),
    weights: model.weights.map((weight) => Number(weight.toFixed(8))),
    threshold: Number(tuned.threshold.toFixed(2)),
    riskThreshold: Math.round(tuned.threshold * 100),
    fitMetrics: tuned.metrics,
    thresholdSelection: { objective: 'maximize F2', falsePositiveRateCeiling: TARGET_FALSE_POSITIVE_RATE, selectionData: 'reviewed labels' },
  },
  note: 'Candidate trained from reviewer labels. These are fit metrics on the labeled export, not independent production performance. Do not activate until a holdout evaluation and model-governance approval are complete.',
};
await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
console.log(`Created pending candidate from ${rows.length} reviewed labels (${positiveRows.length} fraud, ${negativeRows.length} non-fraud).`);
console.log(`Candidate threshold: ${candidate.model.riskThreshold}/100 risk score; fit recall ${candidate.model.fitMetrics.recall}%; fit false-positive rate ${candidate.model.fitMetrics.falsePositiveRate}%.`);
console.log(`Candidate artifact: ${outputPath}`);
