import { readFile } from 'node:fs/promises';

const baseUrl = process.env.PROCUREGUARD_BASE_URL ?? 'http://127.0.0.1:5173';
const artifact = JSON.parse(await readFile(new URL('../ml/model-artifacts.json', import.meta.url), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkArtifact() {
  assert(artifact.features.length === 12, 'Artifact must define the 12 deployed features.');
  assert(Math.abs(Object.values(artifact.ensemble.weights).reduce((sum, value) => sum + value, 0) - 1) < 0.0001, 'Ensemble weights must sum to one.');
  assert(artifact.ensemble.threshold > 0 && artifact.ensemble.threshold < 1, 'Ensemble threshold must be between zero and one.');
  const gradientBoosted = artifact.models.find((model) => model.runtime === 'gradient_boosted_trees');
  const randomForest = artifact.models.find((model) => model.runtime === 'random_forest');
  const logistic = artifact.models.find((model) => model.runtime === 'logistic_regression');
  assert(gradientBoosted?.parameters?.trees?.length === 32, 'Gradient-boosted artifact parameters are incomplete.');
  assert(randomForest?.parameters?.trees?.length === 24, 'Random-forest artifact parameters are incomplete.');
  assert(logistic?.parameters?.weights?.length === 12, 'Logistic-regression coefficients are incomplete.');
  assert(artifact.explanation.method === 'exact_shapley_enumeration' && artifact.explanation.featureCount === 12, 'Explanation metadata is out of sync with the deployed feature vector.');
  return { features: artifact.features.length, ensembleThreshold: artifact.ensemble.threshold, models: artifact.models.length };
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  let body = null;
  try { body = await response.json(); } catch { /* HTML error responses are reported by status below. */ }
  return { response, body };
}

async function checkApiFlow() {
  const unauthenticated = await request('/api/session');
  assert(unauthenticated.response.status === 401, `Unauthenticated session check returned ${unauthenticated.response.status}, expected 401.`);

  const identity = `verification-${Date.now()}`;
  const headers = { 'oai-authenticated-user-id': identity, 'oai-authenticated-user-email': `${identity}@example.test` };
  if (process.env.PROCUREGUARD_AUTH_COOKIE) headers.cookie = process.env.PROCUREGUARD_AUTH_COOKIE;
  const session = await request('/api/session', { headers });
  assert(session.response.ok && session.body?.user?.role, `Authenticated session check failed with ${session.response.status}.`);
  const role = session.body.user.role;

  let usersStatus = null;
  if (role === 'Admin') {
    const users = await request('/api/users', { headers });
    assert(users.response.ok && users.body?.users?.length >= 1, `User directory request failed with ${users.response.status}.`);
    const selfGuard = await request('/api/users', { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id: session.body.user.id, role: 'Auditor' }) });
    assert(selfGuard.response.status === 400, `Self-demotion guard returned ${selfGuard.response.status}, expected 400.`);
    const target = users.body.users.find((user) => user.id !== session.body.user.id);
    if (target) {
      const roleUpdate = await request('/api/users', { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id: target.id, role: 'Manager' }) });
      assert(roleUpdate.response.ok && roleUpdate.body?.updated, `User role update failed with ${roleUpdate.response.status}.`);
      const roleRestore = await request('/api/users', { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id: target.id, role: 'Auditor' }) });
      assert(roleRestore.response.ok && roleRestore.body?.updated, `User role restore failed with ${roleRestore.response.status}.`);
    }
    usersStatus = users.response.status;
  } else {
    const restrictedUsers = await request('/api/users', { headers });
    assert(restrictedUsers.response.status === 403, `Restricted user management request returned ${restrictedUsers.response.status}, expected 403.`);
    usersStatus = restrictedUsers.response.status;
  }

  const transactions = await request('/api/transactions', { headers });
  assert(transactions.response.ok && Array.isArray(transactions.body?.transactions), `Transaction read failed with ${transactions.response.status}.`);
  assert(transactions.body.transactions.length > 0, 'Transaction read returned no seeded records.');

  const scan = await request('/api/scan', { method: 'POST', headers });
  assert(scan.response.ok && scan.body?.scanned >= transactions.body.transactions.length, `Scan request failed with ${scan.response.status}.`);

  const monitoring = await request('/api/monitoring', { headers });
  assert(monitoring.response.ok && monitoring.body?.monitoring?.latestScan, `Operational monitoring request failed with ${monitoring.response.status}.`);
  assert(monitoring.body.monitoring.latestScan.records_scanned === scan.body.scanned, 'Monitoring telemetry does not match the completed scan.');
  assert(Number(monitoring.body.monitoring.latestScan.duration_ms) >= 0, 'Monitoring telemetry returned an invalid scan duration.');
  assert(Number(monitoring.body.monitoring.latestScan.high_risk_count) + Number(monitoring.body.monitoring.latestScan.medium_risk_count) + Number(monitoring.body.monitoring.latestScan.low_risk_count) === scan.body.scanned, 'Monitoring score bands do not reconcile to the completed scan.');
  assert(monitoring.body.monitoring.dataQuality?.featureCompleteness !== null, 'Monitoring data-quality summary is missing feature completeness.');
  assert(['within_reference', 'review_required'].includes(monitoring.body.monitoring.scoreDistribution?.status), 'Monitoring drift status is invalid.');
  assert(Number(monitoring.body.monitoring.transactionTotals?.total) >= transactions.body.transactions.length, 'Monitoring totals returned fewer transactions than the transaction API.');

  const reviewTarget = transactions.body.transactions[0].id;
  const review = await request('/api/transactions', { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id: reviewTarget, status: 'Reviewed' }) });
  assert(review.response.ok && review.body?.updated, `Review update failed with ${review.response.status}.`);

  const importId = `VERIFY-${Date.now()}`;
  const form = new FormData();
  form.set('file', new File([`id,supplier,amount,pattern\n${importId},Validation Supplier,12500,Normal purchase\n`], 'verification.csv', { type: 'text/csv' }));
  const imported = await request('/api/transactions/import', { method: 'POST', headers, body: form });
  assert(imported.response.ok && imported.body?.imported === 1, `CSV import failed with ${imported.response.status}.`);

  const reportResponse = await fetch(`${baseUrl}/api/reports?format=csv`, { headers });
  const reportText = await reportResponse.text();
  assert(reportResponse.ok && reportResponse.headers.get('content-type')?.includes('text/csv'), `Evidence report export failed with ${reportResponse.status}.`);
  assert(reportText.includes('ProcureGuard AI evidence report') && reportText.includes(importId), 'Evidence report did not include the imported transaction.');

  const explanation = await request('/api/explain?id=PO-10488', { headers });
  if (role === 'Admin' || role === 'Auditor' || role === 'Manager') {
    assert(explanation.response.ok, `Explanation request failed with ${explanation.response.status}.`);
    assert(explanation.body?.explanation?.contributions?.length === 12, 'Explanation did not return all 12 feature contributions.');
    assert(explanation.body.explanation.explanationMethod === 'exact_shapley_enumeration', 'Explanation method is not exact Shapley enumeration.');
  } else {
    assert(explanation.response.status === 403, `Restricted explanation request returned ${explanation.response.status}, expected 403.`);
  }

  const reviewDecision = await request('/api/reviews', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ transactionId: 'PO-10488', decision: 'confirmed_fraud', note: 'Verification evidence supports the model flag.' }) });
  if (role === 'Admin' || role === 'Auditor' || role === 'Manager') {
    assert(reviewDecision.response.status === 201 && reviewDecision.body?.review?.decision === 'confirmed_fraud', `Review decision request failed with ${reviewDecision.response.status}.`);
    const reviewHistory = await request('/api/reviews?id=PO-10488', { headers });
    assert(reviewHistory.response.ok && reviewHistory.body?.reviews?.some((review) => review.id === reviewDecision.body.review.id), 'Review history did not return the recorded decision.');
    const falsePositiveDecision = await request('/api/reviews', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ transactionId: 'INV-87942', decision: 'false_positive', note: 'Baseline pricing and approval path were verified.' }) });
    assert(falsePositiveDecision.response.status === 201, `False-positive review request failed with ${falsePositiveDecision.response.status}.`);
  } else {
    assert(reviewDecision.response.status === 403, `Restricted review decision request returned ${reviewDecision.response.status}, expected 403.`);
  }

  const evaluation = await request('/api/evaluation', { headers });
  if (role === 'Admin' || role === 'Manager') {
    assert(evaluation.response.ok && evaluation.body?.evaluation?.sampleCount >= 2, `Model evaluation request failed with ${evaluation.response.status}.`);
    assert(evaluation.body.evaluation.confusionMatrix && evaluation.body.evaluation.metrics, 'Model evaluation did not return metrics and a confusion matrix.');
  } else {
    assert(evaluation.response.status === 403, `Restricted model evaluation request returned ${evaluation.response.status}, expected 403.`);
  }

  const models = await request('/api/models', { headers });
  if (role === 'Admin' || role === 'Manager') assert(models.response.ok && models.body?.models?.length === 3, `Model registry request failed with ${models.response.status}.`);
  else assert(models.response.status === 403, `Restricted model registry request returned ${models.response.status}, expected 403.`);

  const audit = await request('/api/audit', { headers });
  assert(audit.response.ok && Array.isArray(audit.body?.events) && audit.body.events.some((event) => event.event_type === 'import' && event.actor_id), `Audit trail did not record the authenticated write actions.`);

  return { role, transactions: transactions.body.transactions.length, scanned: scan.body.scanned, scanDurationMs: scan.body.durationMs, imported: imported.body.imported, reportStatus: reportResponse.status, explanationStatus: explanation.response.status, reviewStatus: reviewDecision.response.status, evaluationStatus: evaluation.response.status, modelsStatus: models.response.status, monitoringStatus: monitoring.response.status, driftStatus: monitoring.body.monitoring.scoreDistribution.status, usersStatus, auditEvents: audit.body.events.length };
}

const artifactResult = checkArtifact();
let apiResult;
try {
  apiResult = await checkApiFlow();
} catch (error) {
  console.error(`API validation failed against ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
if (apiResult) console.log(JSON.stringify({ ok: true, artifact: artifactResult, api: apiResult }));
