// ── i18n ──────────────────────────────────────────────────────────────────
const T = {
  zh: {
    title: '▸ Token 用量看板', hTitle: '▸ Token',
    connecting: '连接中...', loading: '加载中...', updated: '更新于',
    reconnecting: '重连中...', parseError: '解析错误',
    pb: { '5h':'5小时', '1d':'今日', '3d':'3天', '7d':'7天', 'custom':'自定义' },
    apply: '应用', applyCustom: '应用',
    lTokens: '总 Token', lCost: '总费用', lCostSub: 'USD',
    lCache: '缓存命中', lCacheSub: '读取 / (读取 + 创建)',
    lModels: '模型数',
    lSeriesCtrl: '可见项',
    lTokenChart5h: '近5小时 Token 分布（按小时）',
    lTokenChart:   '每日 Token 分布',
    lModelChart: '模型分布', lSessions: '会话列表', noSessions: '暂无会话',
    thSrc:'来源', thSession:'会话', thTokens:'TOKEN',
    thIn:'输入', thOut:'输出', thCache:'缓存',
    thCost:'费用', thActivity:'最后活动', thModels:'模型',
    dsClaudeIn:'Claude 输入', dsClaudeOut:'Claude 输出', dsClaudeCache:'Claude 缓存',
    dsCodexIn:'Codex 输入', dsCodexOut:'Codex 输出', dsCodexCache:'Codex 缓存',
    inSub:'输入', outSub:'输出',
    tipTokens:  '输入 + 输出 + 缓存创建 + 缓存读取',
    tipCost:    'Claude + Codex 费用合计（USD）',
    tipCache:   '缓存读取 ÷ (缓存读取 + 缓存创建)',
    tipModels:  '本周期内使用的不同模型数量',
    navDashboard: '仪表盘', navHistory: '会话历史',
    dashOverview: '概览', dashAnalytics: '深度分析',
    lHeatmap: '近90天活动热力图', lProjectChart: '项目成本分布',
    lBillingWindow: '当前计费窗口 (5h)',
  },
  en: {
    title: '▸ Token Dashboard', hTitle: '▸ Token',
    connecting: 'CONNECTING...', loading: 'LOADING...', updated: 'UPDATED',
    reconnecting: 'RECONNECTING...', parseError: 'PARSE ERROR',
    pb: { '5h':'5H', '1d':'1D', '3d':'3D', '7d':'7D', 'custom':'CUSTOM' },
    apply: 'APPLY', applyCustom: 'APPLY',
    lTokens: 'TOTAL TOKENS', lCost: 'TOTAL COST', lCostSub: 'USD',
    lCache: 'CACHE HIT', lCacheSub: 'read / (read + create)',
    lModels: 'MODELS USED',
    lSeriesCtrl: 'Visible Series',
    lTokenChart5h: 'Last 5h Token Breakdown (hourly)',
    lTokenChart:   'Token Breakdown by Day',
    lModelChart: 'Model Distribution', lSessions: 'SESSIONS', noSessions: 'NO SESSIONS',
    thSrc:'SRC', thSession:'SESSION', thTokens:'TOKENS',
    thIn:'IN', thOut:'OUT', thCache:'CACHE',
    thCost:'COST $', thActivity:'LAST ACTIVITY', thModels:'MODELS',
    dsClaudeIn:'Claude In', dsClaudeOut:'Claude Out', dsClaudeCache:'Claude Cache',
    dsCodexIn:'Codex In', dsCodexOut:'Codex Out', dsCodexCache:'Codex Cache',
    inSub:'in', outSub:'out',
    tipTokens:  'input + output + cache_creation + cache_read',
    tipCost:    'Claude + Codex combined cost (USD)',
    tipCache:   'cache_read ÷ (cache_read + cache_creation)',
    tipModels:  'Distinct models used in this period',
    navDashboard: 'Dashboard', navHistory: 'History',
    dashOverview: 'Overview', dashAnalytics: 'Analytics',
    lHeatmap: '90-Day Activity Heatmap', lProjectChart: 'Project Cost Breakdown',
    lBillingWindow: 'Current Billing Window (5h)',
  }
};

let lang = 'zh';
function t(k) { return T[lang][k] ?? k; }

function setLang(l) {
  lang = l;
  document.getElementById('langZh').classList.toggle('active', l === 'zh');
  document.getElementById('langEn').classList.toggle('active', l === 'en');
  applyStaticLabels();
  if (lastReport) renderReport(lastReport);
}

function applyStaticLabels() {
  const L = T[lang];
  ['hTitle','pb-5h','pb-1d','pb-3d','pb-7d','pb-custom',
   'applyCustom','lTokens','lCost','lCostSub','lCache','lCacheSub',
   'lModels','lSeriesCtrl','lModelChart','lSessions',
   'thSrc','thSession','thTokens','thIn','thOut','thCache','thCost','thActivity','thModels'
  ].forEach(id => {
    const key = id.startsWith('pb-') ? 'pb' : id;
    const el = document.getElementById(id);
    if (!el) return;
    if (id.startsWith('pb-')) el.textContent = L.pb[id.slice(3)];
    else el.textContent = L[id] ?? '';
  });
  // overlay text
  document.getElementById('overlayText').textContent = L.loading;
  // tooltip texts
  document.getElementById('tipTokens').textContent = L.tipTokens;
  document.getElementById('tipCost').textContent   = L.tipCost;
  document.getElementById('tipCache').textContent  = L.tipCache;
  document.getElementById('tipModels').textContent = L.tipModels;
  // chart title depends on current period
  document.getElementById('lTokenChart').textContent =
    currentPeriod === '5h' ? L.lTokenChart5h : L.lTokenChart;
  // sidebar + analytics labels
  if (L.navDashboard) document.getElementById('navLabelDashboard').textContent = L.navDashboard;
  if (L.navHistory)   document.getElementById('navLabelHistory').textContent   = L.navHistory;
  if (L.dashOverview)  document.getElementById('dashViewOverview').textContent  = L.dashOverview;
  if (L.dashAnalytics) document.getElementById('dashViewAnalytics').textContent = L.dashAnalytics;
  if (L.lHeatmap)      { const el = document.getElementById('lHeatmap');      if (el) el.textContent = L.lHeatmap; }
  if (L.lProjectChart) { const el = document.getElementById('lProjectChart'); if (el) el.textContent = L.lProjectChart; }
  if (L.lBillingWindow){ const el = document.getElementById('lBillingWindow');if (el) el.textContent = L.lBillingWindow; }
}

// ── State ─────────────────────────────────────────────────────────────────
let currentPeriod = '1d';
let tokenChart = null, modelChart = null;
let es = null, lastReport = null;
let overlayTimer = null;
const TOKEN_SERIES_META = [
  { key: 'claudeIn',    labelKey: 'dsClaudeIn',    color: 'rgba(217,119,87,0.85)', valueOf: r => r.claude?.inputTokens || 0 },
  { key: 'claudeOut',   labelKey: 'dsClaudeOut',   color: 'rgba(180,85,50,0.8)',   valueOf: r => r.claude?.outputTokens || 0 },
  { key: 'claudeCache', labelKey: 'dsClaudeCache', color: 'rgba(217,119,87,0.3)',  valueOf: r => (r.claude?.cacheReadTokens || 0) + (r.claude?.cacheCreationTokens || 0) },
  { key: 'codexIn',     labelKey: 'dsCodexIn',     color: 'rgba(59,130,246,0.85)', valueOf: r => r.codex?.inputTokens || 0 },
  { key: 'codexOut',    labelKey: 'dsCodexOut',    color: 'rgba(59,130,246,0.55)', valueOf: r => r.codex?.outputTokens || 0 },
  { key: 'codexCache',  labelKey: 'dsCodexCache',  color: 'rgba(59,130,246,0.25)', valueOf: r => r.codex?.cachedInputTokens || 0 }
];
const tokenSeriesVisible = Object.fromEntries(TOKEN_SERIES_META.map(s => [s.key, true]));

function showOverlay() {
  const el = document.getElementById('loadingOverlay');
  el.classList.remove('hiding');
  el.classList.add('visible');
  document.getElementById('overlayText').textContent = t('loading');
}

function hideOverlay() {
  const el = document.getElementById('loadingOverlay');
  if (!el.classList.contains('visible')) return;
  el.classList.remove('visible');
  el.classList.add('hiding');
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => el.classList.remove('hiding'), 250);
}

// ── Chart defaults (light) ────────────────────────────────────────────────
Chart.defaults.color       = '#92817A';
Chart.defaults.borderColor = '#E8E4DE';

// ── Formatters ────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
function fmtCost(n) { return n ? '$' + Number(n).toFixed(4) : '$0.0000'; }

// Fix 2: strip 'claude-' prefix instead of taking last N segments
function shortModel(name) {
  if (!name) return '—';
  return name.replace(/^claude-/, '');
}
function shortSession(id) {
  return (id || '').split('/').pop()?.slice(-14) || (id || '').slice(-14) || '—';
}

// ── Render stats ──────────────────────────────────────────────────────────
function renderStats(report) {
  const s = report.summary;
  document.getElementById('sTokens').textContent    = fmt(s.totalTokens);
  document.getElementById('sTokensSub').textContent =
    `${t('inSub')}:${fmt(s.inputTokens)} ${t('outSub')}:${fmt(s.outputTokens)}`;
  document.getElementById('sCost').textContent = fmtCost(s.totalCost);
  const cacheTotal = (s.cacheReadTokens || 0) + (s.cacheCreationTokens || 0);
  document.getElementById('sCache').textContent =
    cacheTotal > 0 ? ((s.cacheReadTokens || 0) / cacheTotal * 100).toFixed(1) + '%' : '—';
  document.getElementById('sModels').textContent     = report.models.length;
  document.getElementById('sModelNames').textContent =
    report.models.slice(0, 2).map(m => shortModel(m.name)).join(', ');
}

// ── Render token bar chart ────────────────────────────────────────────────
function calcVisibleMax(datasets) {
  let max = 0;
  for (const ds of datasets) {
    if (ds.hidden) continue;
    for (const v of (ds.data || [])) {
      const n = Number(v) || 0;
      if (n > max) max = n;
    }
  }
  return max;
}

function applyTokenYAxisScale(chart) {
  const max = calcVisibleMax(chart.data.datasets);
  chart.options.scales.y.max = max > 0 ? Math.ceil(max * 1.1) : 1;
}

function renderTokenSeriesControls() {
  const wrap = document.getElementById('tokenSeriesControls');
  if (!wrap || !tokenChart) return;
  wrap.innerHTML = tokenChart.data.datasets.map((ds, idx) => {
    const checked = ds.hidden ? '' : 'checked';
    return `<label class="series-toggle">
      <input type="checkbox" data-idx="${idx}" ${checked}>
      <span class="series-dot" style="background:${ds.backgroundColor}"></span>
      <span>${ds.label}</span>
    </label>`;
  }).join('');

  wrap.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', e => {
      const idx = Number(e.target.dataset.idx);
      const ds = tokenChart.data.datasets[idx];
      if (!ds) return;
      ds.hidden = !e.target.checked;
      if (ds.seriesKey) tokenSeriesVisible[ds.seriesKey] = !ds.hidden;

      // keep at least one visible series to avoid misleading empty chart
      const anyVisible = tokenChart.data.datasets.some(item => !item.hidden);
      if (!anyVisible) {
        ds.hidden = false;
        if (ds.seriesKey) tokenSeriesVisible[ds.seriesKey] = true;
        e.target.checked = true;
      }

      applyTokenYAxisScale(tokenChart);
      tokenChart.update();
    });
  });
}

function renderTokenChart(report) {
  const panel = document.getElementById('tokenChartPanel');
  if (!report.daily?.length) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  // Fix 3: update chart title based on period
  document.getElementById('lTokenChart').textContent =
    report.period === '5h' ? t('lTokenChart5h') : t('lTokenChart');
  const d = report.daily;
  const datasets = TOKEN_SERIES_META.map(s => ({
    seriesKey: s.key,
    label: t(s.labelKey),
    data: d.map(row => s.valueOf(row)),
    backgroundColor: s.color,
    minBarLength: 2,
    hidden: tokenSeriesVisible[s.key] === false
  }));
  const yMax = calcVisibleMax(datasets);
  if (tokenChart) tokenChart.destroy();
  tokenChart = new Chart(document.getElementById('tokenChart'), {
    type: 'bar',
    data: {
      labels: d.map(r => r.date),
      datasets
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: false, grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { stacked: false, min: 0, max: yMax > 0 ? Math.ceil(yMax * 1.1) : 1, ticks: { callback: v => fmt(v), font: { size: 11 } } }
      },
      plugins: { legend: { labels: { font: { size: 11 }, boxWidth: 10, padding: 8 } } }
    }
  });
  renderTokenSeriesControls();
}

// ── Render model doughnut ─────────────────────────────────────────────────
function renderModelChart(report) {
  if (!report.models.length) return;
  if (modelChart) modelChart.destroy();
  const COLORS = ['#D97757','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#10B981'];
  modelChart = new Chart(document.getElementById('modelChart'), {
    type: 'doughnut',
    data: {
      labels: report.models.map(m => shortModel(m.name)),
      datasets: [{
        data:            report.models.map(m => m.cost > 0 ? m.cost : m.totalTokens),
        backgroundColor: report.models.map((_, i) => COLORS[i % COLORS.length] + 'CC'),
        borderColor:     report.models.map((_, i) => COLORS[i % COLORS.length]),
        borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 10, padding: 6 } },
        tooltip: { callbacks: {
          label: ctx => ` ${ctx.label}: ${fmtCost(ctx.raw)} (${report.models[ctx.dataIndex]?.pct}%)`
        }}
      }
    }
  });
}

// ── Render session table ──────────────────────────────────────────────────
function renderSessions(report) {
  const tbody = document.getElementById('sessionBody');
  if (!report.sessions?.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="placeholder">${t('noSessions')}</td></tr>`;
    return;
  }
  tbody.innerHTML = report.sessions.slice(0, 50).map(s => {
    const total = (s.inputTokens||0) + (s.outputTokens||0) + (s.cacheTokens||0);
    const ts = s.lastActivity
      ? new Date(s.lastActivity).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US',
          { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '—';
    // Fix 2: strip 'claude-' prefix from model names in session table
    const models = (s.models || []).map(m => m.replace(/^claude-/, '')).join(', ');
    return `<tr>
      <td><span class="badge badge-${s.source}">${s.source.toUpperCase()}</span></td>
      <td style="color:var(--text-dim);font-size:10px" title="${s.id}">${shortSession(s.id)}</td>
      <td>${fmt(total)}</td>
      <td>${fmt(s.inputTokens)}</td>
      <td>${fmt(s.outputTokens)}</td>
      <td>${fmt(s.cacheTokens)}</td>
      <td>${fmtCost(s.totalCost)}</td>
      <td style="color:var(--text-dim)">${ts}</td>
      <td style="color:var(--text-dim);font-size:10px">${models}</td>
    </tr>`;
  }).join('');
}

// ── Render full report ────────────────────────────────────────────────────
function renderReport(report) {
  lastReport = report;
  document.getElementById('status').textContent =
    `${t('updated')} ${new Date(report.updatedAt).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US')}`;
  renderStats(report);
  renderTokenChart(report);
  renderModelChart(report);
  renderSessions(report);
}

// ── SSE ───────────────────────────────────────────────────────────────────
function connect(period, since, until) {
  if (es) { es.close(); es = null; }
  showOverlay();
  document.getElementById('status').textContent = t('loading');
  let url = `/api/stream?period=${period}`;
  if (since) url += `&since=${since}`;
  if (until) url += `&until=${until}`;
  es = new EventSource(url);
  let firstFrame = true;
  es.onmessage = e => {
    try {
      const data = JSON.parse(e.data);
      if (firstFrame) { hideOverlay(); firstFrame = false; }
      if (data.error) { document.getElementById('status').textContent = data.error; return; }
      renderReport(data);
    } catch { hideOverlay(); document.getElementById('status').textContent = t('parseError'); }
  };
  es.onerror = () => { hideOverlay(); document.getElementById('status').textContent = t('reconnecting'); };
}

// ── Period tabs ───────────────────────────────────────────────────────────
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod = btn.dataset.period;
    document.getElementById('customRange').classList.toggle('visible', currentPeriod === 'custom');
    if (currentPeriod !== 'custom') connect(currentPeriod);
  });
});

document.getElementById('applyCustom').addEventListener('click', () => {
  const since = document.getElementById('sinceInput').value;
  const until = document.getElementById('untilInput').value;
  if (since) connect('custom', since, until || undefined);
});

// ── Boot ──────────────────────────────────────────────────────────────────
applyStaticLabels();
connect('1d');

// ── Sidebar navigation ─────────────────────────────────────────────────────
let currentView = 'dashboard';
function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.view-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('contextBarDashboard').classList.toggle('hidden', viewName !== 'dashboard');
  document.getElementById('contextBarHistory').classList.toggle('hidden', viewName !== 'history');

  const viewEl = document.getElementById(`view-${viewName}`);
  if (viewEl) viewEl.classList.add('active');
  const navEl = document.getElementById(`nav${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`);
  if (navEl) navEl.classList.add('active');

  if (viewName === 'history' && typeof loadHistorySessions === 'function') {
    loadHistorySessions();
  }
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ── Dashboard view toggle (overview / analytics) ───────────────────────────
let currentDashView = 'overview';
function setDashView(v) {
  currentDashView = v;
  document.getElementById('dashboardOverview').style.display  = v === 'overview'  ? '' : 'none';
  document.getElementById('dashboardAnalytics').style.display = v === 'analytics' ? '' : 'none';
  document.getElementById('dashViewOverview').classList.toggle('active',  v === 'overview');
  document.getElementById('dashViewAnalytics').classList.toggle('active', v === 'analytics');
  if (v === 'analytics' && typeof loadAnalytics === 'function') loadAnalytics();
}

