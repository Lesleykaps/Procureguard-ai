import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import readline from 'node:readline';

const sourcePath = join(process.cwd(), 'ml', 'external', 'creditcardfraud', 'creditcard.csv');
const reportPath = join(process.cwd(), 'ml', 'creditcard-benchmark-report.json');
const featureNames = ['Time', ...Array.from({ length: 28 }, (_, index) => `V${index + 1}`), 'Amount'];
const MAX_TRAIN_NEGATIVES = 40_000;
const TARGET_NEGATIVE_TO_POSITIVE_RATIO = 4;
const EPOCHS = 45;
const LEARNING_RATE = 0.045;

function sigmoid(value) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value)))); }
function dot(left, right) { let total = 0; for (let index = 0; index < left.length; index += 1) total += left[index] * right[index]; return total; }
function seeded(index) { let value = (index + 1) * 1103515245 + 12345; value ^= value >>> 16; return (value >>> 0) / 4294967296; }
function metrics(rows, probabilities, threshold) {
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  rows.forEach((row, index) => { const predicted = probabilities[index] >= threshold; if (row.y && predicted) tp += 1; else if (row.y) fn += 1; else if (predicted) fp += 1; else tn += 1; });
  const precision = tp + fp ? tp / (tp + fp) : 0; const recall = tp + fn ? tp / (tp + fn) : 0;
  return { threshold, truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn, accuracy: Number(((tp + tn) / Math.max(rows.length, 1) * 100).toFixed(3)), precision: Number((precision * 100).toFixed(3)), recall: Number((recall * 100).toFixed(3)), falsePositiveRate: Number((fp / Math.max(fp + tn, 1) * 100).toFixed(4)), f2: Number(((5 * precision * recall) / Math.max(4 * precision + recall, 0.000001) * 100).toFixed(3)) };
}
function rocAuc(rows, probabilities) {
  const ranked = rows.map((row, index) => ({ y: row.y, probability: probabilities[index] })).sort((left, right) => right.probability - left.probability);
  const positives = ranked.filter((row) => row.y === 1).length; const negatives = ranked.length - positives;
  let tp = 0; let fp = 0; let lastTp = 0; let lastFp = 0; let area = 0;
  for (const row of ranked) { if (row.y) tp += 1; else fp += 1; area += (fp - lastFp) * (tp + lastTp) / 2; lastTp = tp; lastFp = fp; }
  return Number((area / Math.max(positives * negatives, 1)).toFixed(5));
}

const trainPositives = []; const trainNegatives = []; const validation = []; const test = [];
let rowIndex = 0; let trainNegativeSeen = 0;
for await (const line of readline.createInterface({ input: createReadStream(sourcePath) })) {
  if (rowIndex === 0) { rowIndex += 1; continue; }
  const values = line.split(',');
  if (values.length !== 31) continue;
  const x = values.slice(0, 30).map(Number); const y = Number(values[30].replaceAll('"', ''));
  const item = { x, y };
  const bucket = (rowIndex - 1) / 284807;
  if (bucket < 0.7) {
    if (y) trainPositives.push(item);
    else {
      trainNegativeSeen += 1;
      if (trainNegatives.length < MAX_TRAIN_NEGATIVES) trainNegatives.push(item);
      else { const replacement = Math.floor(seeded(rowIndex) * trainNegativeSeen); if (replacement < MAX_TRAIN_NEGATIVES) trainNegatives[replacement] = item; }
    }
  }
  else if (bucket < 0.85) validation.push(item); else test.push(item);
  rowIndex += 1;
}
if (!trainPositives.length || !validation.some((row) => row.y) || !test.some((row) => row.y)) throw new Error('The benchmark source lacks the expected labelled class distribution.');

const means = featureNames.map((_, index) => [...trainPositives, ...trainNegatives].reduce((sum, row) => sum + row.x[index], 0) / (trainPositives.length + trainNegatives.length));
const deviations = featureNames.map((_, index) => Math.sqrt([...trainPositives, ...trainNegatives].reduce((sum, row) => sum + (row.x[index] - means[index]) ** 2, 0) / (trainPositives.length + trainNegatives.length)) || 1);
const normalize = (row) => ({ ...row, x: row.x.map((value, index) => (value - means[index]) / deviations[index]) });
const normalizedPositives = trainPositives.map(normalize); const normalizedNegatives = trainNegatives.map(normalize); const normalizedValidation = validation.map(normalize); const normalizedTest = test.map(normalize);

const balanced = [...normalizedNegatives, ...normalizedPositives];
const desiredPositives = Math.ceil(normalizedNegatives.length / TARGET_NEGATIVE_TO_POSITIVE_RATIO);
for (let index = normalizedPositives.length; index < desiredPositives; index += 1) {
  const left = normalizedPositives[index % normalizedPositives.length]; const right = normalizedPositives[(index * 37 + 11) % normalizedPositives.length]; const alpha = seeded(index);
  balanced.push({ x: left.x.map((value, feature) => value + alpha * (right.x[feature] - value)), y: 1 });
}

const weights = Array(featureNames.length).fill(0); let bias = 0;
for (let epoch = 0; epoch < EPOCHS; epoch += 1) {
  for (let offset = 0; offset < balanced.length; offset += 1) {
    const row = balanced[(offset * 7919 + epoch * 104729) % balanced.length]; const error = row.y - sigmoid(dot(row.x, weights) + bias);
    for (let feature = 0; feature < weights.length; feature += 1) weights[feature] += LEARNING_RATE * (error * row.x[feature] - 0.0004 * weights[feature]);
    bias += LEARNING_RATE * error;
  }
}
const predict = (rows) => rows.map((row) => sigmoid(dot(row.x, weights) + bias));
const validationProbabilities = predict(normalizedValidation); const testProbabilities = predict(normalizedTest);
const candidates = Array.from({ length: 91 }, (_, index) => metrics(normalizedValidation, validationProbabilities, (index + 5) / 100));
const conservative = candidates.filter((candidate) => candidate.falsePositiveRate <= 3);
const selected = (conservative.length ? conservative : candidates).sort((left, right) => right.f2 - left.f2 || right.recall - left.recall)[0];
const report = { source: { provider: 'Kaggle', dataset: 'mlg-ulb/creditcardfraud', localFile: 'ml/external/creditcardfraud/creditcard.csv', domain: 'anonymized credit-card transactions; external fraud benchmark only' }, generatedAt: new Date().toISOString(), split: { strategy: 'chronological by source order', train: { positives: normalizedPositives.length, sampledNegatives: normalizedNegatives.length }, validationRows: normalizedValidation.length, testRows: normalizedTest.length }, imbalanceHandling: { method: 'SMOTE-style interpolation on training positives only', targetNegativeToPositiveRatio: TARGET_NEGATIVE_TO_POSITIVE_RATIO, trainingRowsAfterSmote: balanced.length, note: 'Validation and test sets remain untouched.' }, model: { type: 'regularized logistic regression', features: featureNames, epochs: EPOCHS, learningRate: LEARNING_RATE }, thresholdSelection: { split: 'validation', criterion: 'maximize F2 subject to validation false-positive rate <= 3%', selected }, heldOutTest: { metrics: metrics(normalizedTest, testProbabilities, selected.threshold), rocAuc: rocAuc(normalizedTest, testProbabilities) }, limitation: 'This benchmark does not establish procurement-fraud performance and is not deployed in ProcureGuard scoring.' };
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
