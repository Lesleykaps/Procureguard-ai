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
  CircleHelp,
  ClipboardList,
  Clock3,
  Database,
  Download,
  FileBarChart,
  FileCheck2,
  FileUp,
  Filter,
  Gauge,
  Info,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Moon,
  MoreHorizontal,
  Network,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export function AppShell({ authenticatedUser }: { authenticatedUser: { displayName: string; email: string } | null }) {
  const [view, setView] = useState<View>('dashboard');
  const [role, setRole] = useState<Role>('Auditor');
  const [transactions, setTransactions] = useState(seedTransactions);
  const [query, setQuery] = useState('');
  const [alertFilter, setAlertFilter] = useState<'All' | Risk | 'Open' | 'Reviewed'>('All');
  const [selectedId, setSelectedId] = useState('PO-10488');
  const [toast, setToast] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = transactions.find((item) => item.id === selectedId) ?? transactions[0];
  const userName = authenticatedUser?.displayName ?? 'Demo Auditor';
  const visibleTransactions = useMemo(() => transactions.filter((item) => `${item.id} ${item.supplier} ${item.pattern}`.toLowerCase().includes(query.toLowerCase())), [transactions, query]);
  const visibleAlerts = useMemo(() => visibleTransactions.filter((item) => {
    if (alertFilter === 'All') return item.risk >= 55;
    if (alertFilter === 'Open' || alertFilter === 'Reviewed') return item.status === alertFilter && item.risk >= 55;
    return riskLevel(item.risk) === alertFilter;
  }), [visibleTransactions, alertFilter]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }

  function runScan() {
    setIsScanning(true);
    notify('Scan started — evaluating the latest procurement batch.');
    window.setTimeout(() => { setIsScanning(false); notify('Scan complete — 3 priority alerts require review.'); }, 1200);
  }

  function updateStatus(id: string, status: Txn['status']) {
    setTransactions((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    notify(`${id} marked as ${status.toLowerCase()}.`);
  }

  function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    notify(`${file.name} validated — 24 procurement records ready for scoring.`);
    setView('transactions');
  }

  const can = (module: string) => roleCopy[role].allowed.includes(module);

  return <div className="app-grid">
    <aside className="sidebar">
      <div className="logo-lockup flex items-center gap-3 px-2"><div className="logo-mark">PG</div><div className="logo-copy"><div className="logo-title">ProcureGuard AI</div><div className="logo-subtitle">Procurement Fraud Detection</div></div></div>
      <nav className="nav-list mt-9 flex flex-col gap-1" aria-label="Primary navigation">
        {navItems.map(({ key, label, icon: Icon }) => <button key={key} className={`nav-button ${view === key ? 'active' : ''}`} onClick={() => setView(key)}><Icon size={16} /><span className="nav-label">{label}</span></button>)}
      </nav>
      <div className="mt-auto hidden rounded-xl border border-[rgba(111,166,188,.16)] bg-[#0a2134] p-3 sm:block model-mini-copy"><div className="tiny muted">Current model</div><div className="mt-2 text-xs font-semibold text-[#effeff]">XGBoost Ensemble</div><div className="tiny mt-1 text-[#17d8cf]">SHAP enabled</div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar">
        <div className="flex items-center gap-3"><Menu className="hidden text-[#8aa9b7] max-sm:block" size={19} /><div className="hidden text-sm font-semibold text-[#dceff1] md:block">AI-powered procurement fraud detection</div></div>
        <div className="flex items-center gap-3"><div className="relative"><Search className="absolute left-3 top-2.5 text-[#668796]" size={14} /><Input className="search-input pl-9" placeholder="Search supplier, PO, invoice" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Button variant="outline" size="icon" aria-label="Toggle appearance" className="border-[rgba(111,166,188,.2)] bg-[#0b2132] text-[#9fb9c2] hover:bg-[#12364a]"><Moon size={15} /></Button><Button onClick={runScan} disabled={isScanning} className="h-9 bg-[#0dd3da] px-3 text-[11px] font-bold text-[#03202a] hover:bg-[#5be8e5]"><Play size={13} fill="currentColor" />{isScanning ? 'Scanning...' : 'Run scan'}</Button></div>
      </header>

      <main className="content">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0f3447] text-[#23ddd2]"><UserRound size={14} /></span><span className="text-xs text-[#a1bbc3]">Signed in as <strong className="text-[#e7f5f7]">{userName}</strong></span><Badge variant="outline" className="border-[#1a827f] text-[#2ee0d4]">{role}</Badge></div><div className="role-switcher"><span className="tiny muted self-center">Preview role:</span>{(Object.keys(roleCopy) as Role[]).map((item) => <button key={item} className={`role-chip ${role === item ? 'active' : ''}`} onClick={() => { setRole(item); notify(`Previewing ${item} permissions.`); }}>{item}</button>)}</div></div>
        {view === 'dashboard' && <Dashboard transactions={transactions} setView={setView} setSelectedId={setSelectedId} runScan={runScan} />}
        {view === 'transactions' && <TransactionsView transactions={visibleTransactions} onUpload={() => fileRef.current?.click()} updateStatus={updateStatus} setSelectedId={(id) => { setSelectedId(id); setView('explain'); }} />}
        {view === 'alerts' && <AlertsView alerts={visibleAlerts} filter={alertFilter} setFilter={setAlertFilter} setSelectedId={(id) => { setSelectedId(id); setView('explain'); }} updateStatus={updateStatus} />}
        {view === 'explain' && <ExplainView selected={selected} setView={setView} />}
        {view === 'models' && <ModelsView role={role} can={can} notify={notify} />}
        {view === 'audit' && <AuditView />}
        {view === 'reports' && <ReportsView reportReady={reportReady} setReportReady={setReportReady} notify={notify} />}
      </main>
    </div>
    <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleUpload} />
    {toast && <div className="toast flex items-center gap-3"><CheckCircle2 size={17} className="text-[#21dbc7]" />{toast}</div>}
  </div>;
}

function Dashboard({ transactions, setView, setSelectedId, runScan }: { transactions: Txn[]; setView: (view: View) => void; setSelectedId: (id: string) => void; runScan: () => void }) {
  const highRisk = transactions.filter((item) => item.risk >= 80);
  return <>
    <SectionHeader eyebrow="Live risk intelligence" title="Command dashboard" subtitle="A clear view of procurement risk, model health, and the cases that need attention first." action={<Button onClick={runScan} variant="outline" className="h-9 border-[rgba(24,216,207,.4)] bg-[#0c2638] text-[#28ded4] hover:bg-[#10384c]"><RefreshCw size={14} /> Refresh intelligence</Button>} />
    <div className="metric-grid"><MetricCard label="High-risk alerts" value="3" note={<><strong>+3</strong> in the last hour</>} icon={<AlertTriangle size={14} className="text-[#ff5877]" />} tone="red" /><MetricCard label="Detection latency" value="38s" note={<>Target: <strong>under 60s</strong></>} icon={<Clock3 size={14} className="text-[#2edcd1]" />} /><MetricCard label="False positive rate" value="7.8%" note={<>Objective: <strong>below 10%</strong></>} icon={<Gauge size={14} className="text-[#ffc24a]" />} tone="orange" /><MetricCard label="Model accuracy" value="96.4%" note={<><strong>XGBoost</strong> validation</>} icon={<BarChart3 size={14} className="text-[#2edcd1]" />} /></div>
    <div className="dashboard-grid"><section className="section-card map-card"><div className="card-heading"><div><p>Live risk intelligence</p><h2>Procurement risk map</h2></div><Badge className="bg-[#0b756f] text-[#79fff0]">Live</Badge></div><div className="map-stage"><div className="map-core" /><span className="map-label orange" style={{ left: '17%', top: '24%' }}>Invoice split</span><span className="map-label red" style={{ right: '13%', top: '28%' }}>Single bidder</span><span className="map-label red" style={{ left: '22%', bottom: '22%' }}>Overbilling</span><span className="map-label green" style={{ right: '17%', bottom: '20%' }}>Vendor conflict</span><div className="absolute bottom-3 left-3 flex items-center gap-4 text-[10px] text-[#7898a7]"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#ff4c6d]" />High risk</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#ffbe45]" />Medium</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#22d8c2]" />Low</span></div></div></section><section className="section-card priority-card"><div className="card-heading"><div><p>Immediate action</p><h2>Priority alerts</h2></div><button className="action-link" onClick={() => setView('alerts')}>View all <ArrowUpRight className="inline" size={13} /></button></div>{highRisk.slice(0, 3).map((item) => <div className="alert-item" key={item.id}><div className="alert-row"><RiskBadge score={item.risk} /><span className="mono text-[11px] text-[#a6c0c7]">{item.amount}</span></div><h3>{item.id} · {item.supplier}</h3><p>{item.reason}</p><button className="action-link mt-3" onClick={() => { setSelectedId(item.id); setView('explain'); }}>Investigate <ChevronRight className="inline" size={13} /></button></div>)}</section></div>
  </>;
}

function TransactionsView({ transactions, onUpload, updateStatus: _updateStatus, setSelectedId }: { transactions: Txn[]; onUpload: () => void; updateStatus: (id: string, status: Txn['status']) => void; setSelectedId: (id: string) => void }) {
  return <><SectionHeader eyebrow="Real-time monitoring" title="Live transaction monitor" subtitle="Every procurement record is screened against anomaly patterns before it reaches the next approval step." action={<Button onClick={onUpload} variant="outline" className="border-[rgba(24,216,207,.4)] text-[#28ded4]"><Upload size={14} /> Import CSV</Button>} /><div className="toolbar"><div className="filter-row"><button className="filter-button active">All transactions</button><button className="filter-button">Open cases</button><button className="filter-button">Cleared</button></div><div className="flex items-center gap-2 text-[11px] muted"><Database size={14} /> {transactions.length} records in view <Filter size={14} /></div></div><section className="section-card table-wrap"><table className="data-table"><thead><tr><th>PO / Invoice</th><th>Supplier</th><th>Amount</th><th>Pattern</th><th>Risk</th><th>Status</th><th /></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><button className="text-left font-semibold text-[#ecfbfc] hover:text-[#20ddd3]" onClick={() => setSelectedId(item.id)}>{item.id}</button><span className="cell-sub">{item.date}</span></td><td>{item.supplier}</td><td className="mono">{item.amount}</td><td>{item.pattern}</td><td><RiskBadge score={item.risk} /></td><td><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></td><td><button aria-label={`Review ${item.id}`} className="action-link" onClick={() => setSelectedId(item.id)}><MoreHorizontal size={16} /></button></td></tr>)}</tbody></table></section><p className="tiny muted mt-4"><Info className="mr-1 inline" size={12} /> Imported records are scored in the prototype using the configured risk model snapshot.</p></>;
}

function AlertsView({ alerts, filter, setFilter, setSelectedId, updateStatus }: { alerts: Txn[]; filter: 'All' | Risk | 'Open' | 'Reviewed'; setFilter: (filter: 'All' | Risk | 'Open' | 'Reviewed') => void; setSelectedId: (id: string) => void; updateStatus: (id: string, status: Txn['status']) => void }) {
  const filters: ('All' | Risk | 'Open' | 'Reviewed')[] = ['All', 'High', 'Medium', 'Open', 'Reviewed'];
  return <><SectionHeader eyebrow="Case management" title="Fraud alert queue" subtitle="Prioritize high-risk cases, inspect the evidence, and keep investigation status accountable." action={<Button onClick={() => alerts.forEach((item) => item.status === 'Open' && updateStatus(item.id, 'Reviewed'))} className="h-9 bg-[#0dd3da] text-[#03202a] hover:bg-[#5be8e5]"><Check size={14} /> Mark open as reviewed</Button>} /><div className="toolbar"><div className="filter-row">{filters.map((item) => <button key={item} className={`filter-button ${filter === item ? 'active' : ''}`} onClick={() => setFilter(item)}>{item}</button>)}</div><span className="tiny muted">{alerts.length} cases shown</span></div><div className="queue-grid">{alerts.map((item) => <section className="section-card queue-card" key={item.id}><div><div className="flex items-center justify-between"><RiskBadge score={item.risk} /><span className="tiny muted">{item.date}</span></div><h3>{item.id} · {item.supplier}</h3><p>{item.reason}</p></div><div className="flex items-center justify-between"><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span><button className="action-link" onClick={() => { setSelectedId(item.id); }}>Investigate <ChevronRight className="inline" size={13} /></button></div></section>)}</div></>;
}

function ExplainView({ selected, setView }: { selected: Txn; setView: (view: View) => void }) {
  const factors = [['Invoice amount variance', 92], ['Single-bid frequency', 84], ['Supplier payment velocity', 76], ['Approval override count', 68], ['Contract price deviation', 61], ['Vendor relationship signal', 48]];
  return <><SectionHeader eyebrow="Responsible AI" title="Explainable AI" subtitle="Make every flagged transaction easier to challenge, validate, and act on with feature-level explanations." action={<Badge className="border border-[#1f7f7a] bg-[#0c3b40] text-[#43e5d5]"><Sparkles size={13} /> SHAP enabled</Badge>} /><div className="explain-grid mt-7"><section className="section-card explain-card"><p className="eyebrow">SHAP-based fraud explanation</p><h2>Why this transaction was flagged</h2><p>These are the strongest contributing signals for the selected transaction. Higher contribution indicates more influence on the risk score.</p>{factors.map(([label, value]) => <div className="bar-row" key={String(label)}><span>{label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${value}%` }} /></div><strong className="text-right text-[#cde4e7]">{value}%</strong></div>)}</section><section className="section-card selected-case"><p className="eyebrow">Selected transaction</p><h2>{selected.id}</h2><Badge className="bg-[#5b2434] text-[#ff8097]">{riskLevel(selected.risk)} risk</Badge><p className="mt-4">{selected.reason}</p><div className="case-amount">{selected.amount}</div><div className="tiny muted">{selected.supplier} · {selected.pattern}</div><Button onClick={() => setView('alerts')} className="mt-6 w-full bg-[#0dd3da] text-[#03202a] hover:bg-[#5be8e5]">Open case queue <ArrowUpRight size={14} /></Button></section></div><div className="section-card mt-4 flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex items-center gap-3"><ShieldCheck className="text-[#24d9c9]" size={19} /><div><strong className="text-xs">Human review remains required</strong><p className="tiny muted mt-1">Model explanations support investigation; they do not replace an authorized decision.</p></div></div><Button variant="outline" className="border-[rgba(111,166,188,.22)] text-[#b3cbd1]" onClick={() => setView('audit')}>View audit evidence</Button></div></>;
}

function ModelsView({ role, can, notify }: { role: Role; can: (module: string) => boolean; notify: (message: string) => void }) {
  const models = [['XGBoost', '96.4%', 'Best accuracy with strong anomaly separation.', 96.4], ['Random Forest', '93.1%', 'Reliable baseline with strong recall.', 93.1], ['Logistic Regression', '88.7%', 'Simple interpretable benchmark model.', 88.7]];
  return <><SectionHeader eyebrow="Model governance" title="Model performance" subtitle="Compare the candidate models and keep the approved scoring snapshot visible to reviewers." action={<Button disabled={!can('Models')} onClick={() => notify('Retrain snapshot requires an approved model governance action.')} variant="outline" className="border-[rgba(24,216,207,.38)] text-[#21d9d0]"><RefreshCw size={14} /> Retrain snapshot</Button>} /><div className="section-card mt-7 p-5"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">Algorithm performance</p><h2 className="mt-2 text-base font-semibold">Approved comparison</h2></div><Badge variant="outline" className="border-[#1a827f] text-[#2ee0d4]">Current: XGBoost Ensemble</Badge></div><div className="model-grid">{models.map(([name, score, description, value], index) => <section className={`section-card model-card ${index === 0 ? 'selected' : ''}`} key={String(name)}><div className="flex items-center justify-between"><span className="tiny muted">{name}</span>{index === 0 && <Badge className="bg-[#0d716b] text-[#72faea]">Selected</Badge>}</div><div className="model-score">{score}</div><p>{description}</p><div className="progress mt-5"><span style={{ width: `${value}%` }} /></div><div className="mt-2 flex justify-between tiny muted"><span>Validation accuracy</span><span>{index === 0 ? 'SHAP ready' : 'Benchmark'}</span></div></section>)}</div></div><div className="section-card mt-4 flex items-center gap-3 p-4 text-xs"><LockKeyhole size={16} className="text-[#ffc24a]" /><span className="muted">Only Admins can retrain or replace approved models.</span><span className="ml-auto text-[#d8ebed]">Viewing as {role}</span></div></>;
}

function AuditView() {
  return <><SectionHeader eyebrow="Tamper-evident records" title="Audit trail" subtitle="A chronological record of scans, alerts, reviews, exports, and security events." action={<Button variant="outline" className="border-[rgba(111,166,188,.22)] text-[#b3cbd1]"><Download size={14} /> Export evidence</Button>} /><section className="section-card mt-7"><div className="card-heading"><div><p>System activity</p><h2>Recent events</h2></div><Badge className="bg-[#0b3b45] text-[#2de0cf]">Integrity verified</Badge></div><div className="audit-list">{auditEvents.map(([message, actor, date]) => <div className="audit-entry" key={message}><i className="audit-dot" /><div><strong>{message}</strong><div className="mt-1"><span>{actor}</span><span className="mx-2 text-[#3d6372]">·</span><span>{date}</span></div></div><button className="action-link" aria-label="View audit event"><ChevronRight size={15} /></button></div>)}</div></section><div className="section-card mt-4 grid gap-4 p-4 text-xs sm:grid-cols-3"><div className="flex items-center gap-2"><ShieldCheck size={16} className="text-[#24d9c9]" /><span><strong>Append-only</strong><br /><span className="tiny muted">Records cannot be deleted by reviewers.</span></span></div><div className="flex items-center gap-2"><Users size={16} className="text-[#24d9c9]" /><span><strong>Access logged</strong><br /><span className="tiny muted">Who viewed what and when.</span></span></div><div className="flex items-center gap-2"><FileCheck2 size={16} className="text-[#24d9c9]" /><span><strong>Evidence ready</strong><br /><span className="tiny muted">Reports retain their source events.</span></span></div></div></>;
}

function ReportsView({ reportReady, setReportReady, notify }: { reportReady: boolean; setReportReady: (ready: boolean) => void; notify: (message: string) => void }) {
  return <><SectionHeader eyebrow="Exportable evidence" title="Evidence reports" subtitle="Generate a structured fraud-intelligence report for procurement managers, auditors, and compliance teams." action={<Button onClick={() => { setReportReady(true); notify('Fraud intelligence report generated and added to the audit trail.'); }} className="bg-[#0dd3da] text-[#03202a] hover:bg-[#5be8e5]"><FileBarChart size={14} /> Generate report</Button>} /><div className="report-layout mt-7"><section className="section-card report-card"><p className="eyebrow">Fraud intelligence report</p><h2 className="mt-2 text-lg font-semibold">Select report evidence</h2><p className="mt-2 text-xs leading-relaxed text-[#92aeb9]">Choose which verified materials should be included in the next downloadable report.</p>{['Executive summary', 'High-risk cases', 'SHAP explanations', 'Model performance', 'Audit trail evidence'].map((label) => <label className="check-row" key={label}><input type="checkbox" defaultChecked className="accent-[#15d9d0]" /> {label}</label>)}<Button onClick={() => { setReportReady(true); notify('Report prepared with the selected evidence.'); }} className="mt-6 w-full bg-[#0dd3da] text-[#03202a] hover:bg-[#5be8e5]"><FileCheck2 size={14} /> {reportReady ? 'Report ready to download' : 'Prepare report'}</Button></section><section className="section-card report-card"><div className="flex items-center gap-3"><div className="logo-mark"><FileBarChart size={17} /></div><div><h2 className="text-sm font-semibold">Daily intelligence summary</h2><p className="tiny muted mt-1">Prototype report · {reportReady ? 'Ready' : 'Not generated'}</p></div></div><div className="mt-7 space-y-5"><div><span className="tiny muted">Cases included</span><div className="mt-1 text-2xl font-bold">6</div></div><div><span className="tiny muted">Highest risk</span><div className="mt-1 text-2xl font-bold text-[#ff5d7c]">94%</div></div><div><span className="tiny muted">Detection target</span><div className="mt-1 text-2xl font-bold text-[#26ddd0]">38s</div></div></div>{reportReady && <Button variant="outline" className="mt-7 w-full border-[rgba(24,216,207,.35)] text-[#2ce0d5]" onClick={() => notify('Download logged — report export is ready in the prototype.')}><Download size={14} /> Download report</Button>}</section></div><p className="tiny muted mt-4"><LockKeyhole className="mr-1 inline" size={12} /> Report exports are permission-controlled and each download is recorded in the audit trail.</p></>;
}
