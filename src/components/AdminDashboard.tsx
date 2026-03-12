'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, ShieldAlert, Zap, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Wrench,
  TrendingUp, Search, ChevronDown, ChevronUp,
  GitPullRequest, Terminal, Cpu,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { apiClient } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TenantRow {
  id: string;
  email: string;
  name: string;
  plan: string;
  messages_used: number;
  messages_limit: number;
  quota_pct: number;
  stripe_customer_id: string | null;
  created_at: string;
  last_seen: string | null;
}

interface SecurityEvent {
  id: string;
  event_type: string;
  severity: string;
  ip_address: string | null;
  user_id: string | null;
  endpoint: string | null;
  created_at: string;
}

interface AutofixTicket {
  id: string;
  exception_type: string;
  file_path: string;
  line_no: number;
  status: string;
  created_at: string;
  patch?: { status: string; pr_url?: string } | null;
}

interface HealthService {
  status: string;
  latency_ms?: number | null;
  error?: string | null;
}

interface HealthSummary {
  overall: string;
  services: Record<string, HealthService>;
  schema_issues?: string[];
  checked_at?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PLAN_COLORS: Record<string, string> = {
  everywhere: '#a78bfa',
  me: '#60a5fa',
  free: 'rgba(255,255,255,0.25)',
};

const SEV_COLORS: Record<string, string> = {
  critical: '#f87171',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#4ade80',
};

const fmtRelative = (iso: string | null) => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
};

// ---------------------------------------------------------------------------
// Micro components
// ---------------------------------------------------------------------------
function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-sm ${className}`}>
      {children}
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, accent = '#c9a461',
}: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <GlassCard className="p-5 flex items-start gap-4 hover:bg-white/[0.05] transition-colors">
      <div className="p-2.5 rounded-xl shrink-0" style={{ background: `${accent}18` }}>
        <Icon size={18} style={{ color: accent }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-text-muted uppercase tracking-widest">{label}</p>
        <p className="text-2xl font-bold text-text mt-0.5 tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-text-muted mt-0.5 truncate">{sub}</p>}
      </div>
    </GlassCard>
  );
}

function StatusDot({ status }: { status: string }) {
  const ok = status === 'ok' || status === 'healthy';
  const warn = status === 'degraded';
  return (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-green-400' : warn ? 'bg-yellow-400' : 'bg-red-400'}`} />
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const styles: Record<string, string> = {
    everywhere: 'text-purple-300 bg-purple-400/10 border-purple-400/20',
    me: 'text-blue-300 bg-blue-400/10 border-blue-400/20',
    free: 'text-text-muted bg-white/5 border-white/10',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wide ${styles[plan] ?? styles.free}`}>
      {plan}
    </span>
  );
}

function UsageBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? '#f87171' : pct >= 70 ? '#fbbf24' : '#c9a461';
  return (
    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0f]/95 px-3 py-2 text-xs shadow-xl">
      {label && <p className="text-text-muted mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-text">{p.name}: <span className="text-accent font-bold">{p.value}</span></p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'tenants' | 'security' | 'autofix' | 'health'>('overview');
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [secEvents, setSecEvents] = useState<SecurityEvent[]>([]);
  const [tickets, setTickets] = useState<AutofixTicket[]>([]);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('all');
  const [sortField, setSortField] = useState<keyof TenantRow>('quota_pct');
  const [sortAsc, setSortAsc] = useState(false);
  const [overrideUid, setOverrideUid] = useState('');
  const [overrideLimit, setOverrideLimit] = useState('');
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [overrideMsg, setOverrideMsg] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalTenants, setTotalTenants] = useState(0);
  const PAGE_SIZE = 20;
  const [detailTenant, setDetailTenant] = useState<TenantRow | null>(null);
  const [planModalUid, setPlanModalUid] = useState<string | null>(null);
  const [planModalEmail, setPlanModalEmail] = useState('');
  const [planModalCurrent, setPlanModalCurrent] = useState('');
  const [planModalSelected, setPlanModalSelected] = useState('');
  const [planModalLoading, setPlanModalLoading] = useState(false);
  const [planModalMsg, setPlanModalMsg] = useState('');
  const [sevFilter, setSevFilter] = useState('all');
  const lastFetch = useRef<number>(0);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s, a, h] = await Promise.allSettled([
        apiClient<{ tenants: TenantRow[]; total: number }>(`/api/admin/tenants?page=${currentPage}&per_page=${PAGE_SIZE}`),
        apiClient<{ events: SecurityEvent[] }>('/api/admin/security-events?page_size=50'),
        apiClient<{ tickets: AutofixTicket[] }>('/api/admin/autofix/tickets?n=30'),
        apiClient<HealthSummary>('/api/admin/health'),
      ]);
      if (t.status === 'fulfilled') {
        setTenants(t.value.tenants ?? []);
        setTotalTenants(t.value.total ?? 0);
      }
      if (s.status === 'fulfilled') setSecEvents(s.value.events ?? []);
      if (a.status === 'fulfilled') setTickets(a.value.tickets ?? []);
      if (h.status === 'fulfilled') setHealth(h.value);
      lastFetch.current = Date.now();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, currentPage]);

  // ── Chart data ────────────────────────────────────────────────────────────
  const planDist = ['free', 'me', 'everywhere']
    .map(p => ({ name: p, value: tenants.filter(t => t.plan === p).length }))
    .filter(d => d.value > 0);

  const usageBuckets = [
    { range: '0–20%', count: tenants.filter(t => t.quota_pct < 20).length },
    { range: '20–40%', count: tenants.filter(t => t.quota_pct >= 20 && t.quota_pct < 40).length },
    { range: '40–60%', count: tenants.filter(t => t.quota_pct >= 40 && t.quota_pct < 60).length },
    { range: '60–80%', count: tenants.filter(t => t.quota_pct >= 60 && t.quota_pct < 80).length },
    { range: '80–100%', count: tenants.filter(t => t.quota_pct >= 80).length },
  ];

  const secTimeline = (() => {
    const days: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days[d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })] = 0;
    }
    secEvents.forEach(e => {
      const key = new Date(e.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      if (key in days) days[key]++;
    });
    return Object.entries(days).map(([date, count]) => ({ date, count }));
  })();

  // ── Filters ───────────────────────────────────────────────────────────────
  const filteredTenants = tenants
    .filter(t => planFilter === 'all' || t.plan === planFilter)
    .filter(t => !search || t.email.toLowerCase().includes(search.toLowerCase()) || (t.name ?? '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortField] ?? '';
      const bv = b[sortField] ?? '';
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });

  const filteredEvents = secEvents.filter(e => sevFilter === 'all' || e.severity === sevFilter);

  const toggleSort = (field: keyof TenantRow) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const SortIcon = ({ field }: { field: keyof TenantRow }) =>
    sortField === field ? (sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : null;

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleOverride = async () => {
    if (!overrideUid || !overrideLimit) return;
    setOverrideLoading(true);
    setOverrideMsg('');
    try {
      await apiClient(`/api/admin/tenants/${overrideUid}/quota`, {
        method: 'POST',
        body: JSON.stringify({ messages_limit: parseInt(overrideLimit, 10) }),
      });
      setOverrideMsg('✅ Quota atualizada');
      setOverrideUid('');
      setOverrideLimit('');
      fetchAll();
    } catch {
      setOverrideMsg('❌ Erro ao atualizar');
    } finally {
      setOverrideLoading(false);
    }
  };

  const handleResetUsage = async (uid: string) => {
    try {
      await apiClient(`/api/admin/tenants/${uid}/reset-usage`, { method: 'POST' });
      fetchAll();
    } catch { /* silent */ }
  };

  const handleChangePlan = async () => {
    if (!planModalUid || !planModalSelected) return;
    setPlanModalLoading(true);
    setPlanModalMsg('');
    try {
      await apiClient(`/api/admin/tenants/${planModalUid}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({ plan: planModalSelected }),
      });
      setPlanModalMsg('✅ Plano actualizado');
      fetchAll();
      setTimeout(() => {
        setPlanModalUid(null);
        setPlanModalMsg('');
      }, 1500);
    } catch {
      setPlanModalMsg('❌ Erro ao actualizar plano');
    } finally {
      setPlanModalLoading(false);
    }
  };

  // ── KPI values ────────────────────────────────────────────────────────────
  const paidTenants = tenants.filter(t => t.plan !== 'free').length;
  const criticalEvents = secEvents.filter(e => e.severity === 'critical' || e.severity === 'high').length;
  const openTickets = tickets.filter(t => t.status === 'open').length;
  const healthOk = health ? Object.values(health.services).filter(s => s.status === 'ok').length : 0;
  const healthTotal = health ? Object.values(health.services).length : 0;

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: TrendingUp },
    { id: 'tenants' as const, label: 'Tenants', icon: Users },
    { id: 'security' as const, label: 'Segurança', icon: ShieldAlert },
    { id: 'autofix' as const, label: 'AutoFix', icon: Terminal },
    { id: 'health' as const, label: 'Health', icon: Cpu },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            Admin Console
          </h1>
          <p className="text-[11px] text-text-muted mt-0.5">
            {lastFetch.current ? `Atualizado ${fmtRelative(new Date(lastFetch.current).toISOString())}` : 'Carregando...'}
          </p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-text-muted hover:text-text transition-colors text-xs border border-white/8"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Users} label="Tenants" value={tenants.length} sub={`${paidTenants} pagantes`} accent="#60a5fa" />
        <KpiCard icon={ShieldAlert} label="Alertas" value={criticalEvents} sub="críticos + altos" accent="#f87171" />
        <KpiCard icon={Wrench} label="AutoFix" value={openTickets} sub="tickets abertos" accent="#fbbf24" />
        <KpiCard icon={Cpu} label="Serviços" value={`${healthOk}/${healthTotal}`} sub={health?.overall ?? '—'} accent="#4ade80" />
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-white/[0.07]">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-all ${
              activeTab === id
                ? 'text-accent border-b-2 border-accent -mb-px'
                : 'text-text-muted hover:text-text'
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={18} className="animate-spin text-text-muted" />
        </div>
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════════
              OVERVIEW
          ═══════════════════════════════════════════════════════ */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Plan pie */}
              <GlassCard className="p-5">
                <p className="text-[10px] text-text-muted uppercase tracking-widest mb-4">Distribuição de Planos</p>
                {planDist.length === 0 ? (
                  <div className="flex items-center justify-center h-[200px] text-text-muted text-sm">Sem dados</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={190}>
                      <PieChart>
                        <Pie data={planDist} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={4} dataKey="value">
                          {planDist.map((entry, i) => (
                            <Cell key={i} fill={PLAN_COLORS[entry.name] ?? '#888'} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-5 mt-1">
                      {planDist.map(d => (
                        <div key={d.name} className="flex items-center gap-1.5 text-[11px] text-text-muted">
                          <span className="w-2 h-2 rounded-full" style={{ background: PLAN_COLORS[d.name] }} />
                          {d.name} <span className="text-text font-medium">({d.value})</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </GlassCard>

              {/* Usage histogram */}
              <GlassCard className="p-5">
                <p className="text-[10px] text-text-muted uppercase tracking-widest mb-4">Distribuição de Uso (Quota %)</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={usageBuckets} barSize={26}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="range" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} width={22} allowDecimals={false} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="count" name="Tenants" fill="#c9a461" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </GlassCard>

              {/* Security timeline */}
              <GlassCard className="p-5">
                <p className="text-[10px] text-text-muted uppercase tracking-widest mb-4">Eventos de Segurança — 7 dias</p>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={secTimeline}>
                    <defs>
                      <linearGradient id="secGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f87171" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} width={22} allowDecimals={false} />
                    <Tooltip content={<ChartTip />} />
                    <Area type="monotone" dataKey="count" name="Eventos" stroke="#f87171" fill="url(#secGrad)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </GlassCard>

              {/* Severity breakdown */}
              <GlassCard className="p-5">
                <p className="text-[10px] text-text-muted uppercase tracking-widest mb-5">Severidade dos Eventos</p>
                {secEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[160px] gap-2">
                    <CheckCircle size={28} className="text-green-400" />
                    <p className="text-sm text-text-muted">Nenhum evento</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {['critical', 'high', 'medium', 'low'].map(sev => {
                      const count = secEvents.filter(e => e.severity === sev).length;
                      const pct = secEvents.length > 0 ? (count / secEvents.length) * 100 : 0;
                      return (
                        <div key={sev} className="flex items-center gap-3">
                          <span className="text-[11px] w-14 text-text-muted capitalize">{sev}</span>
                          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: SEV_COLORS[sev] }} />
                          </div>
                          <span className="text-[11px] text-text-muted w-5 text-right tabular-nums">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </GlassCard>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              TENANTS
          ═══════════════════════════════════════════════════════ */}
          {activeTab === 'tenants' && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar por email ou nome..."
                    className="w-full pl-8 pr-3 py-2 rounded-xl bg-white/5 border border-white/8 text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-accent/40"
                  />
                </div>
                <div className="flex gap-1">
                  {['all', 'free', 'me', 'everywhere'].map(p => (
                    <button
                      key={p}
                      onClick={() => setPlanFilter(p)}
                      className={`px-3 py-2 rounded-xl text-[11px] font-medium transition-colors ${
                        planFilter === p
                          ? 'bg-accent/15 text-accent border border-accent/30'
                          : 'bg-white/5 text-text-muted hover:text-text border border-white/8'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Override */}
              <GlassCard className="p-4">
                <p className="text-[10px] text-text-muted uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Zap size={10} className="text-accent" />
                  Override de Quota
                </p>
                <div className="flex gap-2 flex-wrap items-center">
                  <input
                    value={overrideUid}
                    onChange={e => setOverrideUid(e.target.value)}
                    placeholder="User ID"
                    className="flex-1 min-w-[160px] px-3 py-2 rounded-xl bg-white/5 border border-white/8 text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-accent/40 font-mono"
                  />
                  <input
                    value={overrideLimit}
                    onChange={e => setOverrideLimit(e.target.value)}
                    placeholder="Novo limite"
                    type="number"
                    className="w-28 px-3 py-2 rounded-xl bg-white/5 border border-white/8 text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-accent/40"
                  />
                  <button
                    onClick={handleOverride}
                    disabled={overrideLoading || !overrideUid || !overrideLimit}
                    className="px-4 py-2 rounded-xl bg-accent/15 text-accent border border-accent/30 text-xs font-medium hover:bg-accent/25 disabled:opacity-40 transition-colors"
                  >
                    {overrideLoading ? 'Salvando...' : 'Aplicar'}
                  </button>
                  {overrideMsg && <span className="text-xs text-text-muted">{overrideMsg}</span>}
                </div>
              </GlassCard>

              {/* Table */}
              <GlassCard className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.07] text-text-muted">
                        {[
                          { label: 'Email', field: 'email' as keyof TenantRow },
                          { label: 'Plano', field: 'plan' as keyof TenantRow },
                          { label: 'Uso', field: 'quota_pct' as keyof TenantRow },
                          { label: 'Último acesso', field: 'last_seen' as keyof TenantRow },
                        ].map(col => (
                          <th
                            key={col.field}
                            className="text-left px-4 py-3 cursor-pointer hover:text-text select-none"
                            onClick={() => toggleSort(col.field)}
                          >
                            <span className="flex items-center gap-1">{col.label}<SortIcon field={col.field} /></span>
                          </th>
                        ))}
                        <th className="text-left px-4 py-3">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTenants.map(t => (
                        <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3">
                            <p className="text-text font-medium truncate max-w-[200px]">{t.email}</p>
                            <p className="text-text-muted font-mono text-[10px] mt-0.5">{t.id.slice(0, 8)}</p>
                          </td>
                          <td className="px-4 py-3"><PlanBadge plan={t.plan} /></td>
                          <td className="px-4 py-3 min-w-[130px]">
                            <UsageBar pct={t.quota_pct} />
                            <p className="text-text-muted text-[10px] mt-1 tabular-nums">{t.messages_used}/{t.messages_limit} ({Math.round(t.quota_pct)}%)</p>
                          </td>
                          <td className="px-4 py-3 text-text-muted">{fmtRelative(t.last_seen)}</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleResetUsage(t.id)}
                                className="text-text-muted hover:text-accent text-[10px] px-2 py-1 rounded-lg hover:bg-accent/10 transition-colors"
                              >
                                Reset uso
                              </button>
                              <button
                                onClick={() => setDetailTenant(t)}
                                className="text-text-muted hover:text-blue-400 text-[10px] px-2 py-1 rounded-lg hover:bg-blue-400/10 transition-colors"
                              >
                                Detalhe
                              </button>
                              <button
                                onClick={() => {
                                  setPlanModalUid(t.id);
                                  setPlanModalEmail(t.email);
                                  setPlanModalCurrent(t.plan);
                                  setPlanModalSelected(t.plan);
                                  setPlanModalMsg('');
                                }}
                                className="text-text-muted hover:text-yellow-400 text-[10px] px-2 py-1 rounded-lg hover:bg-yellow-400/10 transition-colors"
                              >
                                Alterar plano
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredTenants.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-text-muted">Nenhum tenant encontrado</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {totalTenants > PAGE_SIZE && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
                      <span className="text-[11px] text-text-muted">
                        {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalTenants)} de {totalTenants} tenants
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="text-[11px] px-3 py-1 rounded-lg bg-white/5 text-text-muted hover:bg-white/10 disabled:opacity-30 transition-colors"
                        >
                          ← Anterior
                        </button>
                        <span className="text-[11px] text-text-muted self-center">
                          Página {currentPage} / {Math.ceil(totalTenants / PAGE_SIZE)}
                        </span>
                        <button
                          onClick={() => setCurrentPage(p => Math.min(Math.ceil(totalTenants / PAGE_SIZE), p + 1))}
                          disabled={currentPage >= Math.ceil(totalTenants / PAGE_SIZE)}
                          className="text-[11px] px-3 py-1 rounded-lg bg-white/5 text-text-muted hover:bg-white/10 disabled:opacity-30 transition-colors"
                        >
                          Próxima →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </GlassCard>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              SECURITY
          ═══════════════════════════════════════════════════════ */}
          {activeTab === 'security' && (
            <div className="space-y-4">
              <div className="flex gap-1 flex-wrap">
                {['all', 'critical', 'high', 'medium', 'low'].map(s => (
                  <button
                    key={s}
                    onClick={() => setSevFilter(s)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-medium transition-colors ${
                      sevFilter === s
                        ? 'bg-accent/15 text-accent border border-accent/30'
                        : 'bg-white/5 text-text-muted hover:text-text border border-white/8'
                    }`}
                  >
                    {s === 'all' ? 'Todos' : s}
                    {s !== 'all' && (
                      <span className="ml-1.5 opacity-60">({secEvents.filter(e => e.severity === s).length})</span>
                    )}
                  </button>
                ))}
              </div>

              <GlassCard className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.07] text-text-muted">
                        <th className="text-left px-4 py-3">Tipo</th>
                        <th className="text-left px-4 py-3">Severidade</th>
                        <th className="text-left px-4 py-3">IP</th>
                        <th className="text-left px-4 py-3">Endpoint</th>
                        <th className="text-left px-4 py-3">Quando</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map(e => (
                        <tr key={e.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 font-medium text-text">{e.event_type.replace(/_/g, ' ')}</td>
                          <td className="px-4 py-3">
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                              style={{ color: SEV_COLORS[e.severity], background: `${SEV_COLORS[e.severity]}18` }}
                            >
                              {e.severity}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-text-muted">{e.ip_address ?? '—'}</td>
                          <td className="px-4 py-3 font-mono text-text-muted truncate max-w-[160px]">{e.endpoint ?? '—'}</td>
                          <td className="px-4 py-3 text-text-muted">{fmtRelative(e.created_at)}</td>
                        </tr>
                      ))}
                      {filteredEvents.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-text-muted">
                            <CheckCircle size={18} className="text-green-400 mx-auto mb-2" />
                            Nenhum evento encontrado
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              AUTOFIX
          ═══════════════════════════════════════════════════════ */}
          {activeTab === 'autofix' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Abertos', count: tickets.filter(t => t.status === 'open').length, color: '#fbbf24' },
                  { label: 'Resolvidos', count: tickets.filter(t => t.status === 'resolved').length, color: '#4ade80' },
                  { label: 'Com PR', count: tickets.filter(t => t.patch?.pr_url).length, color: '#60a5fa' },
                ].map(s => (
                  <GlassCard key={s.label} className="p-4 text-center">
                    <p className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.count}</p>
                    <p className="text-[11px] text-text-muted mt-0.5">{s.label}</p>
                  </GlassCard>
                ))}
              </div>

              <GlassCard className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.07] text-text-muted">
                        <th className="text-left px-4 py-3">ID</th>
                        <th className="text-left px-4 py-3">Exceção</th>
                        <th className="text-left px-4 py-3">Arquivo</th>
                        <th className="text-left px-4 py-3">Status</th>
                        <th className="text-left px-4 py-3">Patch</th>
                        <th className="text-left px-4 py-3">Quando</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map(t => (
                        <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 font-mono text-text-muted">{t.id.slice(0, 8)}</td>
                          <td className="px-4 py-3 text-red-400 font-medium">{t.exception_type}</td>
                          <td className="px-4 py-3 font-mono text-text-muted truncate max-w-[180px]">
                            {t.file_path.split('/').slice(-2).join('/')}:{t.line_no}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              t.status === 'open' ? 'text-yellow-400 bg-yellow-400/10' :
                              t.status === 'resolved' ? 'text-green-400 bg-green-400/10' :
                              'text-text-muted bg-white/5'
                            }`}>
                              {t.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {t.patch ? (
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[10px] font-medium ${
                                  t.patch.status === 'approved' ? 'text-green-400' :
                                  t.patch.status === 'rejected' ? 'text-red-400' :
                                  'text-yellow-400'
                                }`}>
                                  {t.patch.status}
                                </span>
                                {t.patch.pr_url && (
                                  <a href={t.patch.pr_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                                    <GitPullRequest size={11} />
                                  </a>
                                )}
                              </div>
                            ) : <span className="text-text-muted">—</span>}
                          </td>
                          <td className="px-4 py-3 text-text-muted">{fmtRelative(t.created_at)}</td>
                        </tr>
                      ))}
                      {tickets.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-text-muted">Nenhum ticket AutoFix</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              HEALTH
          ═══════════════════════════════════════════════════════ */}
          {activeTab === 'health' && health && (
            <div className="space-y-4">
              <GlassCard className={`p-4 flex items-center gap-3 border ${
                health.overall === 'ok' || health.overall === 'healthy' ? 'border-green-400/20' :
                health.overall === 'degraded' ? 'border-yellow-400/20' : 'border-red-400/20'
              }`}>
                <StatusDot status={health.overall} />
                <div>
                  <p className="text-sm font-semibold text-text capitalize">Sistema: {health.overall}</p>
                  {health.checked_at && (
                    <p className="text-[11px] text-text-muted">Verificado {fmtRelative(health.checked_at)}</p>
                  )}
                </div>
              </GlassCard>

              {(health.schema_issues ?? []).length > 0 && (
                <GlassCard className="p-4 border border-red-400/20">
                  <h3 className="text-xs font-semibold text-red-400 mb-2 flex items-center gap-1.5">
                    <AlertTriangle size={12} /> Problemas de Schema
                  </h3>
                  {(health.schema_issues ?? []).map((issue, i) => (
                    <p key={i} className="text-xs text-text-muted font-mono">{issue}</p>
                  ))}
                </GlassCard>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(health.services).map(([name, svc]) => (
                  <GlassCard key={name} className="p-4 flex items-center justify-between hover:bg-white/[0.04] transition-colors">
                    <div className="flex items-center gap-2.5">
                      <StatusDot status={svc.status} />
                      <div>
                        <p className="text-sm font-medium text-text capitalize">{name}</p>
                        {svc.error && <p className="text-[10px] text-red-400 mt-0.5 truncate max-w-[150px]">{svc.error}</p>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xs font-medium ${
                        svc.status === 'ok' ? 'text-green-400' :
                        svc.status === 'degraded' ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        {svc.status}
                      </p>
                      {svc.latency_ms != null && (
                        <p className="text-[10px] text-text-muted tabular-nums">{svc.latency_ms}ms</p>
                      )}
                    </div>
                  </GlassCard>
                ))}
              </div>

              {Object.values(health.services).some(s => s.latency_ms != null) && (
                <GlassCard className="p-5">
                  <p className="text-[10px] text-text-muted uppercase tracking-widest mb-4">Latência por Serviço (ms)</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart
                      data={Object.entries(health.services)
                        .filter(([, s]) => s.latency_ms != null)
                        .map(([name, s]) => ({ name, latency: s.latency_ms }))}
                      barSize={22}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                      <Tooltip content={<ChartTip />} />
                      <Bar dataKey="latency" name="ms" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </GlassCard>
              )}
            </div>
          )}

          {activeTab === 'health' && !health && (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <XCircle size={24} className="text-red-400 mx-auto mb-2" />
                <p className="text-sm text-text-muted">Health check indisponível</p>
              </div>
            </div>
          )}
        </>
      )}
      {detailTenant && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetailTenant(null)}>
          <div
            className="w-full max-w-sm h-full bg-[#0a0a0f]/98 border-l border-white/10 p-6 overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-semibold text-text">Detalhe do Tenant</h3>
              <button onClick={() => setDetailTenant(null)} className="text-text-muted hover:text-text transition-colors">✕</button>
            </div>
            <div className="space-y-4">
              {[
                { label: 'Email', value: detailTenant.email },
                { label: 'UID', value: detailTenant.id, mono: true },
                { label: 'Plano', value: detailTenant.plan.toUpperCase() },
                { label: 'Mensagens usadas', value: `${detailTenant.messages_used} / ${detailTenant.messages_limit}` },
                { label: 'Quota', value: `${Math.round(detailTenant.quota_pct)}%` },
                { label: 'Stripe ID', value: detailTenant.stripe_customer_id ?? '—', mono: true },
                { label: 'Criado em', value: detailTenant.created_at ? new Date(detailTenant.created_at).toLocaleString('pt-PT') : '—' },
                { label: 'Último acesso', value: detailTenant.last_seen ? new Date(detailTenant.last_seen).toLocaleString('pt-PT') : '—' },
              ].map(({ label, value, mono }) => (
                <div key={label} className="border-b border-white/5 pb-3">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">{label}</p>
                  <p className={`text-xs text-text break-all ${mono ? 'font-mono' : ''}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {planModalUid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0a0a0f]/95 p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-text">Alterar Plano</h3>
            <p className="text-[11px] text-text-muted font-mono">{planModalEmail}</p>
            <div className="grid grid-cols-3 gap-2">
              {['free', 'me', 'everywhere'].map(p => (
                <button
                  key={p}
                  onClick={() => setPlanModalSelected(p)}
                  className={`py-2 rounded-xl text-[11px] font-semibold border transition-colors uppercase tracking-wide ${
                    planModalSelected === p
                      ? 'bg-accent/15 text-accent border-accent/40'
                      : 'bg-white/5 text-text-muted border-white/8 hover:bg-white/10'
                  }`}
                >
                  {p}
                  {planModalCurrent === p && (
                    <span className="block text-[9px] font-normal normal-case tracking-normal opacity-60">actual</span>
                  )}
                </button>
              ))}
            </div>
            {planModalMsg && <p className="text-[11px] text-text-muted">{planModalMsg}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setPlanModalUid(null); setPlanModalMsg(''); }}
                className="flex-1 py-2 rounded-xl bg-white/5 text-text-muted text-xs hover:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleChangePlan}
                disabled={planModalLoading || planModalSelected === planModalCurrent}
                className="flex-1 py-2 rounded-xl bg-accent/15 text-accent border border-accent/30 text-xs font-medium hover:bg-accent/25 disabled:opacity-40 transition-colors"
              >
                {planModalLoading ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
