import { activeModelRelease, addAuditEvent, ensureBaselineModelRelease, getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';
import { assertSupabase, getSupabaseServer } from '../../../lib/supabase-server';

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

function safeJson(value: unknown) { try { return (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown>; } catch { return {}; } }

type ReleaseRow = { id: string; name: string; version: string; status: string; artifact_json: unknown; metrics_json: unknown; source: string; submitted_by: string; approved_by: string | null; approved_at: string | null; activated_by: string | null; activated_at: string | null; decision_note: string | null; created_at: string };

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
    const result = await getSupabaseServer().from('model_releases').select('id, name, version, status, artifact_json, metrics_json, source, submitted_by, approved_by, approved_at, activated_by, activated_at, decision_note, created_at').order('created_at', { ascending: false });
    assertSupabase(result);
    const active = await activeModelRelease();
    const priority: Record<string, number> = { active: 0, approved: 1, candidate: 2 };
    const releases = ((result.data ?? []) as ReleaseRow[]).sort((left, right) => (priority[left.status] ?? 3) - (priority[right.status] ?? 3));
    return Response.json({ releases: releases.map(releaseView), activeReleaseId: active?.id ?? null });
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
    const saved = await getSupabaseServer().from('model_releases').insert({ id, name: 'Reviewer-trained Logistic Regression', version, status: 'candidate', artifact_json: candidate, metrics_json: candidate.model?.holdoutMetrics ?? {}, source: 'reviewed_labels', submitted_by: actor.userId, approved_by: null, approved_at: null, activated_by: null, activated_at: null, decision_note: body.note?.trim() || null, created_at: now });
    assertSupabase(saved);
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
    const supabase = getSupabaseServer();
    const found = await supabase.from('model_releases').select('id, name, version, status, artifact_json').eq('id', id).maybeSingle();
    assertSupabase(found);
    const release = found.data;
    if (!release) return Response.json({ error: 'Model release not found.' }, { status: 404 });
    const now = new Date().toISOString();
    if (action === 'approve') {
      if (release.status !== 'candidate') return Response.json({ error: 'Only a candidate release can be approved.' }, { status: 409 });
      const errors = validateCandidate(safeJson(release.artifact_json) as CandidateArtifact);
      if (errors.length) return Response.json({ error: errors.join(' ') }, { status: 409 });
      const updated = await supabase.from('model_releases').update({ status: 'approved', approved_by: actor.userId, approved_at: now, decision_note: note.trim() }).eq('id', id); assertSupabase(updated);
    } else if (action === 'reject') {
      if (!['candidate', 'approved'].includes(release.status)) return Response.json({ error: 'Only a candidate or approved release can be rejected.' }, { status: 409 });
      const updated = await supabase.from('model_releases').update({ status: 'rejected', approved_by: actor.userId, approved_at: now, decision_note: note.trim() }).eq('id', id); assertSupabase(updated);
    } else {
      if (action === 'activate' && release.status !== 'approved') return Response.json({ error: 'Only an approved candidate can be activated.' }, { status: 409 });
      if (action === 'rollback' && !['retired', 'approved'].includes(release.status)) return Response.json({ error: 'Rollback requires a previously active or approved release.' }, { status: 409 });
      const retired = await supabase.from('model_releases').update({ status: 'retired' }).eq('status', 'active'); assertSupabase(retired);
      const activated = await supabase.from('model_releases').update({ status: 'active', activated_by: actor.userId, activated_at: now, decision_note: note.trim() }).eq('id', id); assertSupabase(activated);
    }
    await addAuditEvent(actor.userId, `model_${action}`, `Model release ${release.version} ${action}${action === 'activate' || action === 'rollback' ? 'd and is now the active scoring release.' : 'd'}`, id);
    return Response.json({ updated: true, action, id });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Unable to update model governance.' }, { status: 500 }); }
}
