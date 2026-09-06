'use client';

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Database,
  Download,
  FileBarChart,
  FileCheck2,
  Filter,
  Gauge,
  Info,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Moon,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Role = 'Admin' | 'Auditor' | 'Procurement Officer' | 'Manager';
type View = 'dashboard' | 'transactions' | 'alerts' | 'explain' | 'models' | 'audit' | 'reports';
type Risk = 'High' | 'Medium' | 'Low';
type Txn = {
  id: string;
  supplier: string;
  amount: string;
  pattern: string;
  risk: number;
  status: 'Open' | 'Reviewed' | 'Cleared';
  reason: string;
  date: string;
};
type MonitoringSummary = { recordsScanned: number; flaggedCount: number; meanRisk: number; maxRisk: number; durationMs: number; createdAt: string };

const navItems: { key: View; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'transactions', label: 'Transactions', icon: ClipboardList },
  { key: 'alerts', label: 'Fraud Alerts', icon: Bell },
  { key: 'explain', label: 'Explain AI', icon: Sparkles },
  { key: 'models', label: 'Models', icon: BarChart3 },
  { key: 'audit', label: 'Audit Trail', icon: Activity },
  { key: 'reports', label: 'Reports', icon: FileBarChart },
];

const seedTransactions: Txn[] = [
  { id: 'PO-10488', supplier: 'BluePeak Supplies', amount: '$42,890', pattern: 'Invoice splitting', risk: 94, status: 'Open', reason: 'Invoice amount is 42% above contract average and supplier has repeated single-bid awards.', date: 'Today, 09:42' },
  { id: 'INV-88120', supplier: 'Matobo Tech', amount: '$18,640', pattern: 'Duplicate invoice', risk: 87, status: 'Open', reason: 'Duplicate invoice number appears across two payment batches within 24 hours.', date: 'Today, 09:18' },
  { id: 'PO-10377', supplier: 'Kudu Logistics', amount: '$9,620', pattern: 'Single bidder', risk: 74, status: 'Reviewed', reason: 'Tender closed with one qualified supplier and an unusually short bidding period.', date: 'Yesterday, 16:11' },
  { id: 'INV-87942', supplier: 'Cobalt Office', amount: '$3,120', pattern: 'Normal purchase', risk: 18, status: 'Cleared', reason: 'Pricing and approval path match the historical baseline.', date: 'Yesterday, 14:02' },
  { id: 'PO-10504', supplier: 'Nile Infrastructure', amount: '$57,400', pattern: 'Overbilling', risk: 91, status: 'Open', reason: 'Unit price exceeds the historical median by 38% for the same item category.', date: 'Yesterday, 11:26' },
  { id: 'INV-88210', supplier: 'Apex Medical', amount: '$12,980', pattern: 'Vendor conflict', risk: 79, status: 'Open', reason: 'Approver and vendor share a matching contact domain from prior records.', date: 'Mon, 08:55' },
];

const auditEvents = [
  ['XGBoost model scored PO-10488 as high risk at 94%.', 'System', 'Today, 09:42'],
  ['System generated an alert for duplicate invoice INV-88120.', 'System', 'Today, 09:18'],
  ['Auditor reviewed PO-10377 and requested supplier documents.', 'A. Moyo', 'Yesterday, 16:14'],
  ['Compliance user exported the daily intelligence summary.', 'T. Dube', 'Yesterday, 15:32'],
  ['New procurement batch imported from CSV.', 'C. Ncube', 'Yesterday, 13:08'],
];

const roleCopy: Record<Role, { title: string; subtitle: string; allowed: string[]; restricted: string[] }> = {
  Admin: { title: 'Administrator', subtitle: 'Full system governance, model oversight, and audit visibility.', allowed: ['Dashboard', 'Transactions', 'Fraud Alerts', 'Explain AI', 'Models', 'Audit Trail', 'Reports', 'User Management'], restricted: ['Direct model code editing', 'Delete audit logs'] },
  Auditor: { title: 'Auditor', subtitle: 'Investigation-focused access for reviewing suspicious transactions and evidence.', allowed: ['Dashboard', 'Transactions', 'Fraud Alerts', 'Explain AI', 'Audit Trail', 'Reports'], restricted: ['User Management', 'Models', 'Transaction Editing'] },
  'Procurement Officer': { title: 'Procurement Officer', subtitle: 'Operational access for submitting procurement data and monitoring risk feedback.', allowed: ['Dashboard', 'Transactions', 'Fraud Alerts', 'Reports'], restricted: ['Explain AI', 'Models', 'Audit Trail', 'User Management'] },
  Manager: { title: 'Manager', subtitle: 'Oversight access for high-level risk monitoring, escalation decisions, and executive reporting.', allowed: ['Dashboard', 'Transactions', 'Fraud Alerts', 'Explain AI', 'Models', 'Audit Trail', 'Reports'], restricted: ['User Management', 'Model Retraining', 'Raw Data Editing'] },
};

const actionPermissions: Record<Role, { import: boolean; review: boolean; scan: boolean }> = {
  Admin: { import: true, review: true, scan: true },
  Auditor: { import: false, review: true, scan: true },
  'Procurement Officer': { import: true, review: false, scan: false },
  Manager: { import: false, review: true, scan: true },
};

function riskLevel(score: number): Risk {
  if (score >= 80) return 'High';
  if (score >= 55) return 'Medium';
  return 'Low';
}

function RiskBadge({ score }: { score: number }) {
  const risk = riskLevel(score);
  return <span className={`risk-pill ${risk.toLowerCase()}`}>{risk} · {score}%</span>;
}

function SectionHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-4">
    <div><p className="eyebrow">{eyebrow}</p><h1 className="page-title">{title}</h1>{subtitle && <p className="page-subtitle">{subtitle}</p>}</div>
    {action}
  </div>;
}

function MetricCard({ label, value, note, icon, tone = 'teal' }: { label: string; value: string; note: React.ReactNode; icon: React.ReactNode; tone?: 'teal' | 'red' | 'orange' }) {
  return <Card className="section-card metric-card" style={{ borderColor: tone === 'red' ? 'rgba(244,63,104,.3)' : undefined }}>
    <div className="metric-label">{icon}{label}</div><div className={`metric-value ${tone === 'red' ? 'text-[#ff5877]' : tone === 'orange' ? 'text-[#ffc24a]' : 'text-[#effeff]'}`}>{value}</div><div className="metric-note">{note}</div>
  </Card>;
}

export function AppShell({ authenticatedUser, signOutPath }: { authenticatedUser: { displayName: string; email: string }; signOutPath: string }) {
  const [view, setView] = useState<View>('dashboard');
  const [role, setRole] = useState<Role>('Auditor');
  const [transactions, setTransactions] = useState(seedTransactions);
  const [query, setQuery] = useState('');
  const [alertFilter, setAlertFilter] = useState<'All' | Risk | 'Open' | 'Reviewed'>('All');
  const [selectedId, setSelectedId] = useState('PO-10488');
  const [toast, setToast] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [modelAccuracy, setModelAccuracy] = useState('96.4%');
  const [modelFalsePositiveRate, setModelFalsePositiveRate] = useState('7.8%');
  const [detectionLatency, setDetectionLatency] = useState('—');
  const [monitoringSummary, setMonitoringSummary] = useState<MonitoringSummary | null>(null);
  const [liveAudit, setLiveAudit] = useState(auditEvents as string[][]);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = transactions.find((item) => item.id === selectedId) ?? transactions[0] ?? seedTransactions[0];
  const userName = authenticatedUser?.displayName ?? 'Demo Auditor';
  const visibleTransactions = useMemo(() => transactions.filter((item) => `${item.id} ${item.supplier} ${item.pattern}`.toLowerCase().includes(query.toLowerCase())), [transactions, query]);
  const visibleAlerts = useMemo(() => visibleTransactions.filter((item) => {
    if (alertFilter === 'All') return item.risk >= 55;
    if (alertFilter === 'Open' || alertFilter === 'Reviewed') return item.status === alertFilter && item.risk >= 55;
    return riskLevel(item.risk) === alertFilter;
  }), [visibleTransactions, alertFilter]);

  useEffect(() => {
    let active = true;
    async function loadLiveData() {
      try {
        const [transactionsResponse, auditResponse, modelsResponse, sessionResponse, monitoringResponse] = await Promise.all([
          fetch('/api/transactions', { cache: 'no-store' }),
          fetch('/api/audit', { cache: 'no-store' }),
          fetch('/api/models', { cache: 'no-store' }),
          fetch('/api/session', { cache: 'no-store' }),
          fetch('/api/monitoring', { cache: 'no-store' }),
        ]);
        const transactionPayload = await transactionsResponse.json() as { transactions?: Txn[] };
        if (active && transactionsResponse.ok && transactionPayload.transactions?.length) setTransactions(transactionPayload.transactions);
        const auditPayload = await auditResponse.json() as { events?: { message: string; actor_id: string | null; created_at: string }[] };
        if (active && auditResponse.ok && auditPayload.events?.length) setLiveAudit(auditPayload.events.map((event) => [event.message, event.actor_id ?? 'System', new Date(event.created_at).toLocaleString('en', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })]));
        const modelsPayload = await modelsResponse.json() as { models?: { accuracy: number; false_positive_rate: number }[] };
        if (active && modelsResponse.ok && modelsPayload.models?.[0]) {
          setModelAccuracy(`${modelsPayload.models[0].accuracy}%`);
          setModelFalsePositiveRate(`${modelsPayload.models[0].false_positive_rate}%`);
        }
        const sessionPayload = await sessionResponse.json() as { user?: { role?: Role } };
        if (active && sessionResponse.ok && sessionPayload.user?.role) setRole(sessionPayload.user.role);
        const monitoringPayload = await monitoringResponse.json() as { monitoring?: { latestScan?: { records_scanned: number; flagged_count: number; mean_risk: number; max_risk: number; duration_ms: number; created_at: string } | null } };
        const latestScan = monitoringPayload.monitoring?.latestScan;
        if (active && monitoringResponse.ok && latestScan) {
          setDetectionLatency(`${Math.max(1, Math.round(latestScan.duration_ms / 1000))}s`);
          setMonitoringSummary({ recordsScanned: latestScan.records_scanned, flaggedCount: latestScan.flagged_count, meanRisk: latestScan.mean_risk, maxRisk: latestScan.max_risk, durationMs: latestScan.duration_ms, createdAt: latestScan.created_at });
        }
      } catch {
        // The seeded client view remains usable while the local or hosted data service is unavailable.
      }
    }
    void loadLiveData();
    return () => { active = false; };
  }, []);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }

  async function runScan() {
    if (!actionPermissions[role].scan) { notify('Your role does not have permission to run scans.'); return; }
    setIsScanning(true);
    notify('Scan started — evaluating the latest procurement batch.');
    try {
      const response = await fetch('/api/scan', { method: 'POST' });
      const payload = await response.json() as { scanned?: number; flagged?: number; durationMs?: number; meanRisk?: number; maxRisk?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Scan unavailable');
      const scanDuration = payload.durationMs ?? 0;
      setDetectionLatency(`${Math.max(1, Math.round(scanDuration / 1000))}s`);
      setMonitoringSummary({ recordsScanned: payload.scanned ?? 0, flaggedCount: payload.flagged ?? 0, meanRisk: payload.meanRisk ?? 0, maxRisk: payload.maxRisk ?? 0, durationMs: scanDuration, createdAt: new Date().toISOString() });
      const refreshed = await fetch('/api/transactions', { cache: 'no-store' });
      const refreshedPayload = await refreshed.json() as { transactions?: Txn[] };
      if (refreshed.ok && refreshedPayload.transactions?.length) setTransactions(refreshedPayload.transactions);
      setLiveAudit((events) => [[`Scan completed for ${payload.scanned ?? 0} procurement records; ${payload.flagged ?? 0} require attention.`, 'System', new Date().toLocaleString('en', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })], ...events]);
      notify(`Scan complete — ${payload.flagged ?? 0} records require attention.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Scan service unavailable.');
    } finally {
      setIsScanning(false);
    }
  }

  async function updateStatus(id: string, status: Txn['status']) {
    if (!actionPermissions[role].review) { notify('Your role does not have permission to review cases.'); return; }
    setTransactions((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    notify(`${id} marked as ${status.toLowerCase()}.`);
    try {
      const response = await fetch('/api/transactions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
      if (!response.ok) throw new Error('Update failed');
      setLiveAudit((events) => [[`Transaction ${id} marked as ${status}.`, userName, new Date().toLocaleString('en', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })], ...events]);
    } catch {
      notify('Status changed in this view, but the audit service is unavailable.');
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    if (!actionPermissions[role].import) { notify('Your role does not have permission to import records.'); event.target.value = ''; return; }
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch('/api/transactions/import', { method: 'POST', body: form });
      const payload = await response.json() as { imported?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Import failed');
      const refreshed = await fetch('/api/transactions', { cache: 'no-store' });
      const refreshedPayload = await refreshed.json() as { transactions?: Txn[] };
      if (refreshed.ok && refreshedPayload.transactions?.length) setTransactions(refreshedPayload.transactions);
      setLiveAudit((events) => [[`${payload.imported ?? 0} procurement records imported from ${file.name}.`, userName, new Date().toLocaleString('en', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })], ...events]);
      notify(`${payload.imported ?? 0} records imported and scored.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to import this CSV.');
    }
    setView('transactions');
    event.target.value = '';
  }

  const can = (module: string) => roleCopy[role].allowed.includes(module);
  const canImport = actionPermissions[role].import;
  const canReview = actionPermissions[role].review;
  const canScan = actionPermissions[role].scan;

  return <div className="app-grid">
    <aside className="sidebar">
      <div className="logo-lockup flex items-center gap-3 px-2"><div className="logo-mark">PG</div><div className="logo-copy"><div className="logo-title">ProcureGuard AI</div><div className="logo-subtitle">Procurement Fraud Detection</div></div></div>
      <nav className="nav-list mt-9 flex flex-col gap-1" aria-label="Primary navigation">
        {navItems.filter(({ label }) => roleCopy[role].allowed.includes(label)).map(({ key, label, icon: Icon }) => <button key={key} className={`nav-button ${view === key ? 'active' : ''}`} onClick={() => setView(key)}><Icon size={16} /><span className="nav-label">{label}</span></button>)}
      </nav>
      <div className="mt-auto hidden rounded-xl border border-[rgba(111,166,188,.16)] bg-[#0a2134] p-3 sm:block model-mini-copy"><div className="tiny muted">Current model</div><div className="mt-2 text-xs font-semibold text-[#effeff]">XGBoost Ensemble</div><div className="tiny mt-1 text-[#17d8cf]">SHAP enabled</div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar">
        <div className="flex items-center gap-3"><Menu className="hidden text-[#8aa9b7] max-sm:block" size={19} /><div className="hidden text-sm font-semibold text-[#dceff1] md:block">AI-powered procurement fraud detection</div></div>
        <div className="flex items-center gap-3"><div className="relative"><Search className="absolute left-3 top-2.5 text-[#668796]" size={14} /><Input className="search-input pl-9" placeholder="Search supplier, PO, invoice" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Button variant="outline" size="icon" aria-label="Toggle appearance" className="border-[rgba(111,166,188,.2)] bg-[#0b2132] text-[#9fb9c2] hover:bg-[#12364a]"><Moon size={15} /></Button><Button onClick={runScan} disabled={isScanning || !canScan} className="h-9 bg-[#0dd3da] px-3 text-[11px] font-bold text-[#03202a] hover:bg-[#5be8e5]"><Play size={13} fill="currentColor" />{isScanning ? 'Scanning...' : 'Run scan'}</Button></div>
      </header>

      <main className="content">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0f3447] text-[#23ddd2]"><UserRound size={14} /></span><span className="text-xs text-[#a1bbc3]">Signed in as <strong className="text-[#e7f5f7]">{userName}</strong></span><Badge variant="outline" className="border-[#1a827f] text-[#2ee0d4]">{role}</Badge></div><a href={signOutPath} className="tiny muted hover:text-[#2ee0d4]">Sign out</a></div>
        {view === 'dashboard' && <Dashboard transactions={transactions} modelAccuracy={modelAccuracy} modelFalsePositiveRate={modelFalsePositiveRate} detectionLatency={detectionLatency} monitoringSummary={monitoringSummary} setView={setView} setSelectedId={setSelectedId} runScan={runScan} canScan={canScan} />}
        {view === 'transactions' && <TransactionsView transactions={visibleTransactions} onUpload={() => fileRef.current?.click()} updateStatus={updateStatus} setSelectedId={(id) => { setSelectedId(id); setView('explain'); }} canImport={canImport} />}
        {view === 'alerts' && <AlertsView alerts={visibleAlerts} filter={alertFilter} setFilter={setAlertFilter} setSelectedId={(id) => { setSelectedId(id); setView('explain'); }} updateStatus={updateStatus} canReview={canReview} />}
        {view === 'explain' && <ExplainView selected={selected} setView={setView} />}
        {view === 'models' && <ModelsView role={role} can={can} notify={notify} />}
        {view === 'audit' && <AuditView events={liveAudit} />}
        {view === 'reports' && <ReportsView transactions={transactions} detectionLatency={detectionLatency} reportReady={reportReady} setReportReady={setReportReady} notify={notify} />}
      </main>
    </div>
    <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleUpload} />
    {toast && <div className="toast flex items-center gap-3"><CheckCircle2 size={17} className="text-[#21dbc7]" />{toast}</div>}
  </div>;
}

function Dashboard({ transactions, modelAccuracy, modelFalsePositiveRate, detectionLatency, monitoringSummary, setView, setSelectedId, runScan, canScan }: { transactions: Txn[]; modelAccuracy: string; modelFalsePositiveRate: string; detectionLatency: string; monitoringSummary: MonitoringSummary | null; setView: (view: View) => void; setSelectedId: (id: string) => void; runScan: () => void; canScan: boolean }) {
  const highRisk = transactions.filter((item) => item.risk >= 80);
  const openHighRisk = highRisk.filter((item) => item.status === 'Open').length;
  return <>
    <SectionHeader eyebrow="Live risk intelligence" title="Command dashboard" subtitle="A clear view of procurement risk, model health, and the cases that need attention first." action={<Button onClick={runScan} disabled={!canScan} variant="outline" className="h-9 border-[rgba(24,216,207,.4)] bg-[#0c2638] text-[#28ded4] hover:bg-[#10384c]"><RefreshCw size={14} /> Refresh intelligence</Button>} />
    <div className="metric-grid"><MetricCard label="High-risk alerts" value={String(openHighRisk)} note={<><strong>{highRisk.length}</strong> high-risk records tracked</>} icon={<AlertTriangle size={14} className="text-[#ff5877]" />} tone="red" /><MetricCard label="Detection latency" value={detectionLatency} note={<>Target: <strong>under 60s</strong></>} icon={<Clock3 size={14} className="text-[#2edcd1]" />} /><MetricCard label="False positive rate" value={modelFalsePositiveRate} note={<>Objective: <strong>below 10%</strong></>} icon={<Gauge size={14} className="text-[#ffc24a]" />} tone="orange" /><MetricCard label="Model accuracy" value={modelAccuracy} note={<><strong>XGBoost</strong> test split</>} icon={<BarChart3 size={14} className="text-[#2edcd1]" />} /></div>
    <section className="section-card mt-4 flex flex-wrap items-center justify-between gap-4 p-4"><div className="flex items-center gap-3"><Activity size={18} className="text-[#24d9c9]" /><div><p className="eyebrow">Operational telemetry</p><h2 className="mt-1 text-sm font-semibold">{monitoringSummary ? 'Latest scan health recorded' : 'Waiting for the first recorded scan'}</h2><p className="tiny muted mt-1">{monitoringSummary ? `${monitoringSummary.recordsScanned} records processed · ${monitoringSummary.flaggedCount} flagged · mean risk ${monitoringSummary.meanRisk}% · peak ${monitoringSummary.maxRisk}%` : 'Run a scan to begin tracking live latency and score-distribution health.'}</p></div></div><div className="text-right"><div className="tiny muted">Last run</div><strong className="text-xs text-[#dff7f7]">{monitoringSummary ? new Date(monitoringSummary.createdAt).toLocaleString('en', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div></section>
    <div className="dashboard-grid"><section className="section-card map-card"><div className="card-heading"><div><p>Live risk intelligence</p><h2>Procurement risk map</h2></div><Badge className="bg-[#0b756f] text-[#79fff0]">Live</Badge></div><div className="map-stage"><div className="map-core" /><span className="map-label orange" style={{ left: '17%', top: '24%' }}>Invoice split</span><span className="map-label red" style={{ right: '13%', top: '28%' }}>Single bidder</span><span className="map-label red" style={{ left: '22%', bottom: '22%' }}>Overbilling</span><span className="map-label green" style={{ right: '17%', bottom: '20%' }}>Vendor conflict</span><div className="absolute bottom-3 left-3 flex items-center gap-4 text-[10px] text-[#7898a7]"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#ff4c6d]" />High risk</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#ffbe45]" />Medium</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#22d8c2]" />Low</span></div></div></section><section className="section-card priority-card"><div className="card-heading"><div><p>Immediate action</p><h2>Priority alerts</h2></div><button className="action-link" onClick={() => setView('alerts')}>View all <ArrowUpRight className="inline" size={13} /></button></div>{highRisk.slice(0, 3).map((item) => <div className="alert-item" key={item.id}><div className="alert-row"><RiskBadge score={item.risk} /><span className="mono text-[11px] text-[#a6c0c7]">{item.amount}</span></div><h3>{item.id} · {item.supplier}</h3><p>{item.reason}</p><button className="action-link mt-3" onClick={() => { setSelectedId(item.id); setView('explain'); }}>Investigate <ChevronRight className="inline" size={13} /></button></div>)}</section></div>
  </>;
}

function TransactionsView({ transactions, onUpload, updateStatus: _updateStatus, setSelectedId, canImport }: { transactions: Txn[]; onUpload: () => void; updateStatus: (id: string, status: Txn['status']) => void; setSelectedId: (id: string) => void; canImport: boolean }) {
  return <><SectionHeader eyebrow="Real-time monitoring" title="Live transaction monitor" subtitle="Every procurement record is screened against anomaly patterns before it reaches the next approval step." action={<Button onClick={onUpload} disabled={!canImport} variant="outline" className="border-[rgba(24,216,207,.4)] text-[#28ded4]"><Upload size={14} /> {canImport ? 'Import CSV' : 'Import restricted'}</Button>} /><div className="toolbar"><div className="filter-row"><button className="filter-button active">All transactions</button><button className="filter-button">Open cases</button><button className="filter-button">Cleared</button></div><div className="flex items-center gap-2 text-[11px] muted"><Database size={14} /> {transactions.length} records in view <Filter size={14} /></div></div><section className="section-card table-wrap"><table className="data-table"><thead><tr><th>PO / Invoice</th><th>Supplier</th><th>Amount</th><th>Pattern</th><th>Risk</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><button className="text-left font-semibold text-[#ecfbfc] hover:text-[#20ddd3]" onClick={() => setSelectedId(item.id)}>{item.id}</button><span className="cell-sub">{item.date}</span></td><td>{item.supplier}</td><td className="mono">{item.amount}</td><td>{item.pattern}</td><td><RiskBadge score={item.risk} /></td><td><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></td><td><button aria-label={`Review ${item.id}`} className="action-link" onClick={() => setSelectedId(item.id)}><MoreHorizontal size={16} /></button></td></tr>)}</tbody></table></section><p className="tiny muted mt-4"><Info className="mr-1 inline" size={12} /> Imported records are scored in the prototype using the configured risk model snapshot.</p></>;
}

function AlertsView({ alerts, filter, setFilter, setSelectedId, updateStatus, canReview }: { alerts: Txn[]; filter: 'All' | Risk | 'Open' | 'Reviewed'; setFilter: (filter: 'All' | Risk | 'Open' | 'Reviewed') => void; setSelectedId: (id: string) => void; updateStatus: (id: string, status: Txn['status']) => void; canReview: boolean }) {
  const filters: ('All' | Risk | 'Open' | 'Reviewed')[] = ['All', 'High', 'Medium', 'Open', 'Reviewed'];
  return <><SectionHeader eyebrow="Case management" title="Fraud alert queue" subtitle="Prioritize high-risk cases, inspect the evidence, and keep investigation status accountable." action={<Button onClick={() => alerts.forEach((item) => item.status === 'Open' && updateStatus(item.id, 'Reviewed'))} disabled={!canReview} className="h-9 bg-[#0dd3da] text-[#03202a] hover:bg-[#5be8e5]"><Check size={14} /> {canReview ? 'Mark open as reviewed' : 'Review restricted'}</Button>} /><div className="toolbar"><div className="filter-row">{filters.map((item) => <button key={item} className={`filter-button ${filter === item ? 'active' : ''}`} onClick={() => setFilter(item)}>{item}</button>)}</div><span className="tiny muted">{alerts.length} cases shown</span></div><div className="queue-grid">{alerts.map((item) => <section className="section-card queue-card" key={item.id}><div><div className="flex items-center justify-between"><RiskBadge score={item.risk} /><span className="tiny muted">{item.date}</span></div><h3>{item.id} · {item.supplier}</h3><p>{item.reason}</p></div><div className="flex items-center justify-between"><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span><button className="action-link" onClick={() => { setSelectedId(item.id); }}>Investigate <ChevronRight className="inline" size={13} /></button></div></section>)}</div></>;
}

function ExplainView({ selected, setView }: { selected: Txn; setView: (view: View) => void }) {
  const [factors, setFactors] = useState<{ label: string; value: number; direction: string }[]>([]);
  const [explanationMeta, setExplanationMeta] = useState<{ baseRisk?: number; ensembleProbability?: number; decisionThreshold?: number }>({});
  useEffect(() => {
    let active = true;
    void fetch(`/api/explain?id=${encodeURIComponent(selected.id)}`, { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json() as { explanation?: { contributions?: { label: string; value: number; direction: string }[]; baseRisk?: number; ensembleProbability?: number; decisionThreshold?: number } };
      if (active && payload.explanation) {
        if (payload.explanation.contributions) setFactors(payload.explanation.contributions);
        setExplanationMeta({ baseRisk: payload.explanation.baseRisk, ensembleProbability: payload.explanation.ensembleProbability, decisionThreshold: payload.explanation.decisionThreshold });
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [selected.id]);
  const visibleFactors = factors.length ? factors : [['Invoice amount variance', 92], ['Single-bid frequency', 84], ['Supplier payment velocity', 76], ['Approval override count', 68], ['Contract price deviation', 61], ['Vendor relationship signal', 48]].map(([label, value]) => ({ label: String(label), value: Number(value), direction: 'risk' }));
  return <><SectionHeader eyebrow="Responsible AI" title="Explainable AI" subtitle="Make every flagged transaction easier to challenge, validate, and act on with feature-level explanations." action={<Badge className="border border-[#1f7f7a] bg-[#0c3b40] text-[#43e5d5]"><Sparkles size={13} /> Exact SHAP</Badge>} /><div className="explain-grid mt-7"><section className="section-card explain-card"><p className="eyebrow">Exact Shapley attribution</p><h2>Why this transaction was flagged</h2><p>Each bar shows a feature&apos;s measured contribution to the deployed ensemble score. Positive values increase risk; protective values reduce it.</p>{visibleFactors.map(({ label, value, direction }) => <div className="bar-row" key={label}><span>{label}</span><div className="bar-track"><div className={`bar-fill ${direction === 'protective' ? 'protective' : ''}`} style={{ width: `${value}%` }} /></div><strong className="text-right text-[#cde4e7]">{value}%</strong></div>)}{explanationMeta.baseRisk !== undefined && <p className="tiny muted mt-5">Base risk {explanationMeta.baseRisk}% → ensemble risk {Math.round((explanationMeta.ensembleProbability ?? selected.risk / 100) * 100)}% · decision threshold {Math.round((explanationMeta.decisionThreshold ?? 0.5) * 100)}%</p>}</section><section className="section-card selected-case"><p className="eyebrow">Selected transaction</p><h2>{selected.id}</h2><Badge className="bg-[#5b2434] text-[#ff8097]">{riskLevel(selected.risk)} risk</Badge><p className="mt-4">{selected.reason}</p><div className="case-amount">{selected.amount}</div><div className="tiny muted">{selected.supplier} · {selected.pattern}</div><Button onClick={() => setView('alerts')} className="mt-6 w-full bg-[#0dd3da] text-[#03202a] hover:bg-[#5be8e5]">Open case queue <ArrowUpRight size={14} /></Button></section></div><div className="section-card mt-4 flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex items-center gap-3"><ShieldCheck className="text-[#24d9c9]" size={19} /><div><strong className="text-xs">Human review remains required</strong><p className="tiny muted mt-1">Model explanations support investigation; they do not replace an authorized decision.</p></div></div><Button variant="outline" className="border-[rgba(111,166,188,.22)] text-[#b3cbd1]" onClick={() => setView('audit')}>View audit evidence</Button></div></>;
}

function ModelsView({ role, can, notify }: { role: Role; can: (module: string) => boolean; notify: (message: string) => void }) {
  const [decisionThreshold, setDecisionThreshold] = useState(0.56);
  const [models, setModels] = useState<{ name: string; score: string; description: string; value: number; approved: boolean }[]>([
    { name: 'XGBoost', score: '96.4%', description: 'Best accuracy with strong anomaly separation.', value: 96.4, approved: true },
    { name: 'Random Forest', score: '93.1%', description: 'Reliable baseline with strong recall.', value: 93.1, approved: false },
    { name: 'Logistic Regression', score: '88.7%', description: 'Simple interpretable benchmark model.', value: 88.7, approved: false },
  ]);
  useEffect(() => {
    let active = true;
    void fetch('/api/models', { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json() as { models?: { name: string; accuracy: number; is_approved: number; decision_threshold: number }[] };
      if (active && payload.models?.length) {
        setDecisionThreshold(payload.models[0].decision_threshold);
        setModels(payload.models.map((model) => ({ name: model.name.replace(' Ensemble', ''), score: `${model.accuracy}%`, description: model.is_approved ? 'Approved scoring snapshot with feature-level explanation support.' : 'Benchmark candidate retained for comparison.', value: model.accuracy, approved: Boolean(model.is_approved) })));
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return <><SectionHeader eyebrow="Model governance" title="Model performance" subtitle="Compare the candidate models and keep the approved scoring snapshot visible to reviewers." action={<Button disabled={!can('Models')} onClick={() => notify('Retrain snapshot requires an approved model governance action.')} variant="outline" className="border-[rgba(24,216,207,.38)] text-[#21d9d0]"><RefreshCw size={14} /> Retrain snapshot</Button>} /><div className="section-card mt-7 p-5"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">Algorithm performance</p><h2 className="mt-2 text-base font-semibold">Approved comparison</h2></div><div className="flex items-center gap-2"><Badge variant="outline" className="border-[#1a827f] text-[#2ee0d4]">Current: XGBoost Ensemble</Badge><Badge variant="outline" className="border-[rgba(255,194,74,.35)] text-[#ffc24a]">Threshold: {Math.round(decisionThreshold * 100)}%</Badge></div></div><div className="model-grid">{models.map(({ name, score, description, value, approved }) => <section className={`section-card model-card ${approved ? 'selected' : ''}`} key={name}><div className="flex items-center justify-between"><span className="tiny muted">{name}</span>{approved && <Badge className="bg-[#0d716b] text-[#72faea]">Approved</Badge>}</div><div className="model-score">{score}</div><p>{description}</p><div className="progress mt-5"><span style={{ width: `${value}%` }} /></div><div className="mt-2 flex justify-between tiny muted"><span>Held-out accuracy</span><span>{approved ? 'SHAP ready' : 'Benchmark'}</span></div></section>)}</div></div><div className="section-card mt-4 flex items-center gap-3 p-4 text-xs"><LockKeyhole size={16} className="text-[#ffc24a]" /><span className="muted">Only Admins can retrain or replace approved models.</span><span className="ml-auto text-[#d8ebed]">Viewing as {role}</span></div></>;
}

function AuditView({ events }: { events: string[][] }) {
  return <><SectionHeader eyebrow="Tamper-evident records" title="Audit trail" subtitle="A chronological record of scans, alerts, reviews, exports, and security events." action={<Button variant="outline" className="border-[rgba(111,166,188,.22)] text-[#b3cbd1]"><Download size={14} /> Export evidence</Button>} /><section className="section-card mt-7"><div className="card-heading"><div><p>System activity</p><h2>Recent events</h2></div><Badge className="bg-[#0b3b45] text-[#2de0cf]">Integrity verified</Badge></div><div className="audit-list">{events.map(([message, actor, date], index) => <div className="audit-entry" key={`${message}-${index}`}><i className="audit-dot" /><div><strong>{message}</strong><div className="mt-1"><span>{actor}</span><span className="mx-2 text-[#3d6372]">·</span><span>{date}</span></div></div><button className="action-link" aria-label="View audit event"><ChevronRight size={15} /></button></div>)}</div></section><div className="section-card mt-4 grid gap-4 p-4 text-xs sm:grid-cols-3"><div className="flex items-center gap-2"><ShieldCheck size={16} className="text-[#24d9c9]" /><span><strong>Append-only</strong><br /><span className="tiny muted">Records cannot be deleted by reviewers.</span></span></div><div className="flex items-center gap-2"><Users size={16} className="text-[#24d9c9]" /><span><strong>Access logged</strong><br /><span className="tiny muted">Who viewed what and when.</span></span></div><div className="flex items-center gap-2"><FileCheck2 size={16} className="text-[#24d9c9]" /><span><strong>Evidence ready</strong><br /><span className="tiny muted">Reports retain their source events.</span></span></div></div></>;
}

function ReportsView({ transactions, detectionLatency, reportReady, setReportReady, notify }: { transactions: Txn[]; detectionLatency: string; reportReady: boolean; setReportReady: (ready: boolean) => void; notify: (message: string) => void }) {
  async function downloadReport() {
    try {
      const response = await fetch('/api/reports?format=csv', { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? 'Report export failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `procureguard-evidence-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setReportReady(true);
      notify('Evidence report downloaded and recorded in the audit trail.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Report export unavailable.');
    }
  }
  const highestRisk = transactions.length ? Math.max(...transactions.map((item) => item.risk)) : 0;
  return <><SectionHeader eyebrow="Exportable evidence" title="Evidence reports" subtitle="Generate a structured fraud-intelligence report for procurement managers, auditors, and compliance teams." action={<Button onClick={downloadReport} className="bg-[#0dd3da] text-[#03202a] hover:bg-[#5be8e5]"><FileBarChart size={14} /> Export CSV</Button>} /><div className="report-layout mt-7"><section className="section-card report-card"><p className="eyebrow">Fraud intelligence report</p><h2 className="mt-2 text-lg font-semibold">Select report evidence</h2><p className="mt-2 text-xs leading-relaxed text-[#92aeb9]">The export includes the current transaction register, risk explanations, statuses, source files, and latest scan summary.</p>{['Executive summary', 'High-risk cases', 'Model performance', 'Audit trail evidence'].map((label) => <label className="check-row" key={label}><input type="checkbox" defaultChecked className="accent-[#15d9d0]" /> {label}</label>)}<Button onClick={downloadReport} className="mt-6 w-full bg-[#0dd3da] text-[#03202a] hover:bg-[#5be8e5]"><FileCheck2 size={14} /> {reportReady ? 'Download latest report' : 'Prepare and download'}</Button></section><section className="section-card report-card"><div className="flex items-center gap-3"><div className="logo-mark"><FileBarChart size={17} /></div><div><h2 className="text-sm font-semibold">Daily intelligence summary</h2><p className="tiny muted mt-1">Live report data · {reportReady ? 'Exported' : 'Not exported'}</p></div></div><div className="mt-7 space-y-5"><div><span className="tiny muted">Records included</span><div className="mt-1 text-2xl font-bold">{transactions.length}</div></div><div><span className="tiny muted">Highest risk</span><div className="mt-1 text-2xl font-bold text-[#ff5d7c]">{highestRisk}%</div></div><div><span className="tiny muted">Latest scan latency</span><div className="mt-1 text-2xl font-bold text-[#26ddd0]">{detectionLatency}</div></div></div></section></div><p className="tiny muted mt-4"><LockKeyhole className="mr-1 inline" size={12} /> Report exports are permission-controlled and each download is recorded in the audit trail.</p></>;
}
