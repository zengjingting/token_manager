// aggregators/normalize.js

/** ccusage daily entry → our daily row (claude side) */
function normalizeClaudeDaily(raw) {
  if (!raw?.daily) return [];
  return raw.daily.map(d => ({
    date: d.date,  // already "YYYY-MM-DD"
    claude: {
      inputTokens:         d.inputTokens        || 0,
      outputTokens:        d.outputTokens       || 0,
      cacheCreationTokens: d.cacheCreationTokens || 0,
      cacheReadTokens:     d.cacheReadTokens    || 0,
      totalCost:           d.totalCost          || 0
    }
  }));
}

/** @ccusage/codex date string "Apr 08, 2026" → "YYYY-MM-DD" */
function parseCodexDate(str) {
  const d = new Date(str);
  if (isNaN(d.getTime())) throw new Error(`parseCodexDate: cannot parse "${str}"`);
  return d.toISOString().slice(0, 10);
}

/** codex daily entry → our daily row (codex side) */
function normalizeCodexDaily(raw) {
  if (!raw?.daily) return [];
  return raw.daily.map(d => ({
    date: parseCodexDate(d.date),
    codex: {
      inputTokens:           d.inputTokens           || 0,
      outputTokens:          d.outputTokens          || 0,
      cachedInputTokens:     d.cachedInputTokens     || 0,
      reasoningOutputTokens: d.reasoningOutputTokens || 0,
      totalCost:             d.costUSD               || 0
    }
  }));
}

/** Merge claude + codex daily arrays keyed by date */
function mergeDailyArrays(claudeRows, codexRows) {
  const map = new Map();
  for (const r of claudeRows) map.set(r.date, { date: r.date, claude: r.claude, codex: null });
  for (const r of codexRows) {
    if (map.has(r.date)) map.get(r.date).codex = r.codex;
    else map.set(r.date, { date: r.date, claude: null, codex: r.codex });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Build models list from ccusage modelBreakdowns + codex models */
function buildModels(claudeRaw, codexRaw) {
  const map = {};
  for (const day of (claudeRaw?.daily || [])) {
    for (const mb of (day.modelBreakdowns || [])) {
      if (!map[mb.modelName]) map[mb.modelName] = { name: mb.modelName, totalTokens: 0, cost: 0 };
      map[mb.modelName].totalTokens += mb.inputTokens + mb.outputTokens + mb.cacheCreationTokens + mb.cacheReadTokens;
      map[mb.modelName].cost        += mb.cost;
    }
  }
  for (const day of (codexRaw?.daily || [])) {
    for (const [name, m] of Object.entries(day.models || {})) {
      if (!map[name]) map[name] = { name, totalTokens: 0, cost: 0 };
      map[name].totalTokens += m.totalTokens || 0;
    }
    // codex cost lives at day level, assign to first model
    const firstModel = Object.keys(day.models || {})[0];
    if (firstModel && map[firstModel] && day.costUSD) {
      map[firstModel].cost += day.costUSD;
    }
  }
  const models = Object.values(map).sort((a, b) => b.cost - a.cost);
  const totalCost = models.reduce((s, m) => s + m.cost, 0);
  return models.map(m => ({ ...m, pct: totalCost > 0 ? (m.cost / totalCost * 100).toFixed(1) : '0' }));
}

/** Build summary totals from merged daily rows */
function buildSummary(daily) {
  let inputTokens = 0, outputTokens = 0, cacheCreationTokens = 0, cacheReadTokens = 0, totalCost = 0;
  for (const day of daily) {
    if (day.claude) {
      inputTokens         += day.claude.inputTokens;
      outputTokens        += day.claude.outputTokens;
      cacheCreationTokens += day.claude.cacheCreationTokens;
      cacheReadTokens     += day.claude.cacheReadTokens;
      totalCost           += day.claude.totalCost;
    }
    if (day.codex) {
      inputTokens         += day.codex.inputTokens;
      outputTokens        += day.codex.outputTokens;
      cacheCreationTokens += day.codex.cachedInputTokens || 0;
      totalCost           += day.codex.totalCost;
    }
  }
  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens, totalCost };
}

/** Normalize ccusage session output */
function normalizeClaudeSessions(raw) {
  if (!raw?.sessions) return [];
  return raw.sessions.map(s => ({
    id:           s.sessionId,
    source:       'claude',
    inputTokens:  s.inputTokens  || 0,
    outputTokens: s.outputTokens || 0,
    cacheTokens:  (s.cacheCreationTokens || 0) + (s.cacheReadTokens || 0),
    totalCost:    s.totalCost    || 0,
    lastActivity: s.lastActivity,
    models:       s.modelsUsed  || []
  }));
}

/** Normalize @ccusage/codex session output */
function normalizeCodexSessions(raw) {
  if (!raw?.sessions) return [];
  return raw.sessions.map(s => ({
    id:           s.sessionId,
    source:       'codex',
    inputTokens:  s.inputTokens       || 0,
    outputTokens: s.outputTokens      || 0,
    cacheTokens:  s.cachedInputTokens || 0,
    totalCost:    s.costUSD           || 0,
    lastActivity: s.lastActivity,
    models:       Object.keys(s.models || {})
  }));
}

/**
 * Build UsageReport from ccusage + codex CLI output (1d / 3d / 7d / custom).
 */
export function buildReportFromCLI({ period, claudeDaily, codexDaily, claudeSessions, codexSessions }) {
  const daily = mergeDailyArrays(normalizeClaudeDaily(claudeDaily), normalizeCodexDaily(codexDaily));
  const sessions = [
    ...normalizeClaudeSessions(claudeSessions),
    ...normalizeCodexSessions(codexSessions)
  ].sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

  return {
    updatedAt: new Date().toISOString(),
    period,
    summary: buildSummary(daily),
    models:   buildModels(claudeDaily, codexDaily),
    daily,
    sessions
  };
}

/**
 * Build UsageReport from direct JSONL read (5h period).
 * claudeHourly is the return value of readClaudeUsageSince().
 */
export function buildReportFromHourly({ period, claudeHourly }) {
  const totalCost = claudeHourly.summary.totalCost;
  // Map hourly buckets into the same daily-row shape for the bar chart
  const daily = (claudeHourly.hourlyBuckets || []).map(h => ({
    date: h.label,
    claude: {
      inputTokens:         h.inputTokens,
      outputTokens:        h.outputTokens,
      cacheCreationTokens: h.cacheCreationTokens,
      cacheReadTokens:     h.cacheReadTokens,
      totalCost:           h.totalCost
    },
    codex: null
  }));
  return {
    updatedAt: new Date().toISOString(),
    period,
    summary: claudeHourly.summary,
    models: claudeHourly.models.map(m => ({
      ...m,
      pct: totalCost > 0 ? (m.cost / totalCost * 100).toFixed(1) : '0'
    })).sort((a, b) => b.cost - a.cost),
    daily,
    sessions: claudeHourly.sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
  };
}
