import { activeModelRelease, addAuditEvent, ensureBaselineModelRelease, getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type CandidateArtifact = {
  artifactVersion?: string;
  generatedAt?: string;
  status?: string;
  features?: string[];
  source?: { rows?: number; holdoutRows?: number; label?: string };
  model?: { runtime?: string; bias?: number; weights?: number[]; threshold?: number; riskThreshold?: number; holdoutMetrics?: unknown };
  evaluation?: { holdoutAvailable?: boolean; approvalReady?: boolean; minimumRecommendedHoldoutRows?: number };
};

function safeJson(value: string) { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } }

type ReleaseRow = { id: string; name: string; version: string; status: string; artifact_json: string; metrics_json: string; source: string; submitted_by: string; approved_by: string | null; approved_at: string | null; activated_by: string | null; activated_at: string | null; decision_note: string | null; created_at: string };

function releaseView(row: ReleaseRow) {
  const artifact = safeJson(row.artifact_json) as CandidateArtifact;
  const metrics = safeJson(row.metrics_json);
  return {
    id: row.id, name: row.name, version: row.version, status: row.status, source: row.source,
    submittedBy: row.submitted_by, approvedBy: row.approved_by, approvedAt: row.approved_at,
    activatedBy: row.activated_by, activatedAt: row.activated_at, decisionNote: row.decision_note,
    createdAt: row.created_at, metrics, readiness: artifact.evaluation ?? null,
    candidate: artifact.model?.runtime === 'logistic_regression' ? { riskThreshold: artifact.model.riskThreshold, holdoutMetrics: artifact.model.holdoutMetrics, sourceRows: artifact.source?.rows, holdoutRows: artifact.source?.holdoutRows } : null,
  };
}

function validateCandidate(candidate: CandidateArtifact) {
  const errors: string[] = [];
  if (candidate.status !== 'pending_approval') errors.push('Candidate status must be pending_approval.');
  if (candidate.model?.runtime !== 'logistic_regression') errors.push('Only the reviewed-label logistic candidate format is supported.');
  if (!Array.isArray(candidate.features) || candidate.features.length !== 12) errors.push('Candidate must contain the deployed 12-feature vector.');
  if (!Array.isArray(candidate.model?.weights) || candidate.model.weights.length !== 12 || candidate.model.weights.some((value) => !Number.isFinite(value))) errors.push('Candidate must contain 12 finite model weights.');
  if (!Number.isFinite(candidate.model?.bias) || !Number.isFinite(candidate.model?.threshold) || (candidate.model?.threshold ?? 0) <= 0 || (candidate.model?.threshold ?? 1) >= 1) errors.push('Candidate threshold and bias are invalid.');
  if (!candidate.evaluation?.holdoutAvailable || !candidate.evaluation.approvalReady || Number(candidate.source?.holdoutRows ?? 0) < 10 || !candidate.model?.holdoutMetrics) errors.push('Candidate requires an independent holdout of at least 10 reviewed cases before approval.');
  return errors;
}

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'models:read')) return Response.json({ error: 'Your role cannot view model releases.' }, { status: 403 });
    await ensureBaselineModelRelease();
    const result = await env.DB.prepare(`SELECT id, name, version, status, artifact_json, metrics_json, source, submitted_by, approved_by, approved_at, activated_by, activated_at, decision_note, created_at FROM model_releases ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'approved' THEN 1 WHEN 'candidate' THEN 2 ELSE 3 END, created_at DESC`).all<ReleaseRow>();
    const active = await activeModelRelease();
    return Response.json({ releases: (result.results ?? []).map(releaseView), activeReleaseId: active?.id ?? null });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Model releases unavailable.' }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (actor.role !== 'Admin') return Response.json({ error: 'Only Admins can register model candidates.' }, { status: 403 });
    const body = await request.json() as { artifact?: CandidateArtifact; note?: string };
    const candidate = body.artifact;
    if (!candidate) return Response.json({ error: 'A candidate artifact is required.' }, { status: 400 });
    const errors = validateCandidate(candidate);
    if (errors.length) return Response.json({ error: errors.join(' ') }, { status: 400 });
    const now = new Date().toISOString();
    const id = `REL-${crypto.randomUUID()}`;
    const version = `${candidate.artifactVersion ?? 'candidate'}-${now.slice(0, 10)}`;
    await env.DB.prepare(`INSERT INTO model_releases (id, name, version, status, artifact_json, metrics_json, source, submitted_by, approved_by, approved_at, activated_by, activated_at, decision_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, 'Reviewer-trained Logistic Regression', version, 'candidate', JSON.stringify(candidate), JSON.stringify(candidate.model?.holdoutMetrics ?? {}), 'reviewed_labels', actor.userId, null, null, null, null, body.note?.trim() || null, now).run();
    await addAuditEvent(actor.userId, 'model_candidate_registered', `Candidate ${version} registered from reviewer labels; awaiting formal approval.`, id);
    return Response.json({ release: { id, name: 'Reviewer-trained Logistic Regression', version, status: 'candidate' } }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Unable to register model candidate.' }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (actor.role !== 'Admin') return Response.json({ error: 'Only Admins can approve, activate, or roll back models.' }, { status: 403 });
    const { id, action, note } = await request.json() as { id?: string; action?: 'approve' | 'reject' | 'activate' | 'rollback'; note?: string };
    if (!id || !['approve', 'reject', 'activate', 'rollback'].includes(action ?? '')) return Response.json({ error: 'A release id and valid governance action are required.' }, { status: 400 });
    if (!note?.trim()) return Response.json({ error: 'A decision note is required for the audit trail.' }, { status: 400 });
    const release = await env.DB.prepare(`SELECT id, name, version, status, artifact_json FROM model_releases WHERE id = ?`).bind(id).first<{ id: string; name: string; version: string; status: string; artifact_json: string }>();
    if (!release) return Response.json({ error: 'Model release not found.' }, { status: 404 });
    const now = new Date().toISOString();
    if (action === 'approve') {
      if (release.status !== 'candidate') return Response.json({ error: 'Only a candidate release can be approved.' }, { status: 409 });
      const errors = validateCandidate(safeJson(release.artifact_json) as CandidateArtifact);
      if (errors.length) return Response.json({ error: errors.join(' ') }, { status: 409 });
      await env.DB.prepare(`UPDATE model_releases SET status = 'approved', approved_by = ?, approved_at = ?, decision_note = ? WHERE id = ?`).bind(actor.userId, now, note.trim(), id).run();
    } else if (action === 'reject') {
      if (!['candidate', 'approved'].includes(release.status)) return Response.json({ error: 'Only a candidate or approved release can be rejected.' }, { status: 409 });
      await env.DB.prepare(`UPDATE model_releases SET status = 'rejected', approved_by = ?, approved_at = ?, decision_note = ? WHERE id = ?`).bind(actor.userId, now, note.trim(), id).run();
    } else {
      if (action === 'activate' && release.status !== 'approved') return Response.json({ error: 'Only an approved candidate can be activated.' }, { status: 409 });
      if (action === 'rollback' && !['retired', 'approved'].includes(release.status)) return Response.json({ error: 'Rollback requires a previously active or approved release.' }, { status: 409 });
      await env.DB.batch([
        env.DB.prepare(`UPDATE model_releases SET status = 'retired' WHERE status = 'active'`).bind(),
        env.DB.prepare(`UPDATE model_releases SET status = 'active', activated_by = ?, activated_at = ?, decision_note = ? WHERE id = ?`).bind(actor.userId, now, note.trim(), id),
      ]);
    }
    await addAuditEvent(actor.userId, `model_${action}`, `Model release ${release.version} ${action}${action === 'activate' || action === 'rollback' ? 'd and is now the active scoring release.' : 'd'}`, id);
    return Response.json({ updated: true, action, id });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Unable to update model governance.' }, { status: 500 }); }
}
