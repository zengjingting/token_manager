# Token Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web dashboard that unifies Claude Code and Codex CLI token usage, with real-time SSE refresh and flexible time-range filtering (5h / 1d / 3d / 7d / custom).

**Architecture:** Express server reads Claude JSONL directly for sub-day queries and spawns ccusage / @ccusage/codex CLI for daily aggregates. Both sources are normalized into a single `UsageReport` JSON shape. Frontend is a single HTML file with Chart.js from CDN, receiving live pushes via SSE every 30 s.

**Tech Stack:** Node.js 22, Express 4, Chart.js 4 (CDN), ccusage CLI (npx), @ccusage/codex CLI (npx)

---

## File Map

```
Token_dashboard/
├── package.json               # dependencies: express only
├── server.js                  # Express server: GET /api/usage, GET /api/stream (SSE), static /
├── readers/
│   ├── claude-reader.js       # Direct ~/.claude/projects/**/*.jsonl reading (5h filter + sessions)
│   └── cli-runner.js          # Spawn ccusage/codex CLI with --json for date-range aggregates
├── aggregators/
│   └── normalize.js           # Merge Claude + Codex raw output → unified UsageReport shape
└── public/
    └── index.html             # SPA: period tabs, stat cards, bar chart, model doughnut, session table
```

### Unified UsageReport shape (contract between server and frontend)

```js
{
  updatedAt: "ISO string",
  period: "5h" | "1d" | "3d" | "7d" | "custom",
  summary: {
    inputTokens: N, outputTokens: N,
    cacheCreationTokens: N, cacheReadTokens: N,
    totalTokens: N, totalCost: N   // USD
  },
  models: [{ name, totalTokens, cost, pct }],   // sorted by cost desc, pct = "12.3"
  daily: [{                                      // empty array for 5h period
    date: "YYYY-MM-DD",
    claude: { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalCost } | null,
    codex:  { inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens, totalCost } | null
  }],
  sessions: [{
    id: string, source: "claude" | "codex",
    inputTokens, outputTokens, cacheTokens, totalCost,
    lastActivity: "ISO string", models: string[]
  }]
}
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `readers/` directory
- Create: `aggregators/` directory
- Create: `public/` directory

- [ ] **Step 1: Write package.json**

```json
{
  "name": "token-dashboard",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
```

Save to `/Users/ting/Documents/Token_dashboard/package.json`.

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/ting/Documents/Token_dashboard && npm install
```

Expected: `node_modules/` created, `package-lock.json` created, output shows `added N packages` (express + its transitive deps)

- [ ] **Step 3: Create subdirectories**

```bash
mkdir -p /Users/ting/Documents/Token_dashboard/readers
mkdir -p /Users/ting/Documents/Token_dashboard/aggregators
mkdir -p /Users/ting/Documents/Token_dashboard/public
```

- [ ] **Step 4: Smoke test — Express loads**

```bash
node -e "import('/Users/ting/Documents/Token_dashboard/node_modules/express/index.js').then(() => console.log('express ok'))"
```

Expected: `express ok`

- [ ] **Step 5: Init git and commit**

```bash
cd /Users/ting/Documents/Token_dashboard
git init
git add package.json package-lock.json
git commit -m "chore: initialize token-dashboard project"
```

---

### Task 2: Claude JSONL reader

**Files:**
- Create: `readers/claude-reader.js`

JSONL entry schema (per ccusage source at `apps/ccusage/src/data-loader.ts`):
```json
{
  "sessionId": "...",
  "timestamp": "2026-04-09T12:00:00.000Z",
  "message": {
    "model": "claude-sonnet-4-6",
    "usage": {
      "input_tokens": 51,
      "output_tokens": 2164,
      "cache_creation_input_tokens": 25023,
      "cache_read_input_tokens": 754071
    }
  },
  "costUSD": 0.35267
}
```

Files live at `~/.claude/projects/**/*.jsonl`.

- [ ] **Step 1: Write readers/claude-reader.js**

```js
// readers/claude-reader.js
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

function getAllJsonlFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(join(entry.parentPath ?? entry.path, entry.name));
      }
    }
  } catch { /* dir not found */ }
  return results;
}

function parseUsageLine(line) {
  if (!line.trim()) return null;
  let entry;
  try { entry = JSON.parse(line); } catch { return null; }
  if (!entry.timestamp || !entry.message?.usage) return null;
  return entry;
}

/**
 * Read Claude usage entries since a given timestamp (ms).
 * Returns aggregated summary + per-model + per-session breakdown.
 */
export function readClaudeUsageSince(sinceMs) {
  const files = getAllJsonlFiles(PROJECTS_DIR);
  const models = {};
  const sessions = {};
  let inputTokens = 0, outputTokens = 0, cacheCreationTokens = 0, cacheReadTokens = 0, totalCost = 0;

  for (const file of files) {
    // Skip files not modified in the window (+ 1h buffer)
    let stat;
    try { stat = statSync(file); } catch { continue; }
    if (stat.mtimeMs < sinceMs - 3_600_000) continue;

    const lines = readFileSync(file, 'utf-8').split('\n');
    for (const line of lines) {
      const entry = parseUsageLine(line);
      if (!entry) continue;
      const ts = new Date(entry.timestamp).getTime();
      if (ts < sinceMs) continue;

      const usage = entry.message.usage;
      const inp    = usage.input_tokens || 0;
      const out    = usage.output_tokens || 0;
      const cCreate = usage.cache_creation_input_tokens || 0;
      const cRead   = usage.cache_read_input_tokens || 0;
      const cost    = entry.costUSD || 0;
      const model   = entry.message.model || 'unknown';

      inputTokens          += inp;
      outputTokens         += out;
      cacheCreationTokens  += cCreate;
      cacheReadTokens      += cRead;
      totalCost            += cost;

      if (!models[model]) models[model] = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0 };
      models[model].inputTokens         += inp;
      models[model].outputTokens        += out;
      models[model].cacheCreationTokens += cCreate;
      models[model].cacheReadTokens     += cRead;
      models[model].cost                += cost;

      const sid = entry.sessionId || file;
      if (!sessions[sid]) {
        sessions[sid] = {
          id: sid, source: 'claude',
          inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalCost: 0,
          models: new Set(), lastActivity: entry.timestamp
        };
      }
      sessions[sid].inputTokens  += inp;
      sessions[sid].outputTokens += out;
      sessions[sid].cacheTokens  += cCreate + cRead;
      sessions[sid].totalCost    += cost;
      sessions[sid].models.add(model);
      if (entry.timestamp > sessions[sid].lastActivity) sessions[sid].lastActivity = entry.timestamp;
    }
  }

  const totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
  return {
    summary: { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalTokens, totalCost },
    models: Object.entries(models).map(([name, v]) => ({
      name,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      cacheCreationTokens: v.cacheCreationTokens,
      cacheReadTokens: v.cacheReadTokens,
      totalTokens: v.inputTokens + v.outputTokens + v.cacheCreationTokens + v.cacheReadTokens,
      cost: v.cost
    })),
    sessions: Object.values(sessions).map(s => ({ ...s, models: [...s.models] }))
  };
}
```

- [ ] **Step 2: Verify reader**

```bash
node -e "
import('./readers/claude-reader.js').then(m => {
  const r = m.readClaudeUsageSince(Date.now() - 5 * 3600 * 1000);
  console.log('totalTokens:', r.summary.totalTokens, 'totalCost:', r.summary.totalCost.toFixed(4));
  console.log('sessions:', r.sessions.length, 'models:', r.models.map(m => m.name));
});
"
```

Expected: prints numbers (totalTokens ≥ 0, no errors)

- [ ] **Step 3: Commit**

```bash
git add readers/claude-reader.js
git commit -m "feat: add Claude JSONL reader for sub-day time ranges"
```

---

### Task 3: CLI runner

**Files:**
- Create: `readers/cli-runner.js`

Key format difference:
- `ccusage --since` → `YYYYMMDD`
- `@ccusage/codex --since` → `YYYY-MM-DD`

- [ ] **Step 1: Write readers/cli-runner.js**

```js
// readers/cli-runner.js
import { spawnSync } from 'child_process';

function toYYYYMMDD(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function runNpx(pkg, args) {
  const result = spawnSync('npx', ['--yes', pkg, ...args, '--json'], {
    encoding: 'utf-8',
    timeout: 30_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${pkg} failed (exit ${result.status}): ${result.stderr?.slice(0, 200)}`);
  return JSON.parse(result.stdout);
}

/** Claude daily: { daily: [...], totals: {...} } */
export function getClaudeDailyData(since, until) {
  const args = ['daily'];
  if (since) args.push('--since', toYYYYMMDD(since));
  if (until) args.push('--until', toYYYYMMDD(until));
  return runNpx('ccusage', args);
}

/** Claude sessions: { sessions: [...] } */
export function getClaudeSessionData(since, until) {
  const args = ['session'];
  if (since) args.push('--since', toYYYYMMDD(since));
  if (until) args.push('--until', toYYYYMMDD(until));
  return runNpx('ccusage', args);
}

/** Codex daily: { daily: [...], totals: {...} } */
export function getCodexDailyData(since, until) {
  const args = ['daily'];
  if (since) args.push('--since', toISODate(since));
  if (until) args.push('--until', toISODate(until));
  return runNpx('@ccusage/codex', args);
}

/** Codex sessions: { sessions: [...] } */
export function getCodexSessionData(since, until) {
  const args = ['session'];
  if (since) args.push('--since', toISODate(since));
  if (until) args.push('--until', toISODate(until));
  return runNpx('@ccusage/codex', args);
}
```

- [ ] **Step 2: Verify CLI runner**

```bash
node -e "
import('./readers/cli-runner.js').then(m => {
  const d = m.getClaudeDailyData(new Date(Date.now() - 7 * 86400_000), new Date());
  console.log('claude days:', d.daily?.length, 'totals cost:', d.totals?.totalCost?.toFixed(4));
  const cd = m.getCodexDailyData(new Date(Date.now() - 7 * 86400_000), new Date());
  console.log('codex days:', cd.daily?.length, 'totals cost:', cd.totals?.costUSD?.toFixed(4));
});
"
```

Expected: prints day counts and costs for both tools

- [ ] **Step 3: Commit**

```bash
git add readers/cli-runner.js
git commit -m "feat: add CLI runner for ccusage/codex date-range queries"
```

---

### Task 4: Data normalizer

**Files:**
- Create: `aggregators/normalize.js`

Normalizes raw CLI output (from Task 3) and raw JSONL reads (from Task 2) into the unified `UsageReport` shape.

- [ ] **Step 1: Write aggregators/normalize.js**

```js
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
  return isNaN(d.getTime()) ? str : d.toISOString().slice(0, 10);
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
  return {
    updatedAt: new Date().toISOString(),
    period,
    summary: claudeHourly.summary,
    models: claudeHourly.models.map(m => ({
      ...m,
      pct: totalCost > 0 ? (m.cost / totalCost * 100).toFixed(1) : '0'
    })).sort((a, b) => b.cost - a.cost),
    daily:    [],
    sessions: claudeHourly.sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
  };
}
```

- [ ] **Step 2: Verify normalizer**

```bash
node -e "
import('./aggregators/normalize.js').then(m => {
  const r = m.buildReportFromHourly({
    period: '5h',
    claudeHourly: {
      summary: { inputTokens: 100, outputTokens: 200, cacheCreationTokens: 50, cacheReadTokens: 30, totalTokens: 380, totalCost: 0.01 },
      models: [{ name: 'claude-sonnet-4-6', totalTokens: 380, cost: 0.01 }],
      sessions: []
    }
  });
  console.log('period:', r.period, 'models:', r.models.length, 'pct:', r.models[0]?.pct);
});
"
```

Expected: `period: 5h models: 1 pct: 100.0`

- [ ] **Step 3: Commit**

```bash
git add aggregators/normalize.js
git commit -m "feat: add data normalizer for unified UsageReport format"
```

---

### Task 5: Express server

**Files:**
- Create: `server.js`
- Create: `public/index.html` (placeholder, filled in Task 6)

Endpoints:
- `GET /api/usage?period=5h|1d|3d|7d|custom&since=YYYY-MM-DD&until=YYYY-MM-DD` → `UsageReport` JSON
- `GET /api/stream?period=5h&since=...&until=...` → SSE, pushes `UsageReport` every 30 s
- `GET /` → `public/index.html`

Period → date range:

| period | since | until |
|--------|-------|-------|
| 5h | (JSONL direct, sinceMs = now−5h) | — |
| 1d | start of today | now |
| 3d | 2 days ago (midnight) | now |
| 7d | 6 days ago (midnight) | now |
| custom | `since` query param | `until` query param |

- [ ] **Step 1: Write server.js**

```js
// server.js
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readClaudeUsageSince } from './readers/claude-reader.js';
import { getClaudeDailyData, getClaudeSessionData, getCodexDailyData, getCodexSessionData } from './readers/cli-runner.js';
import { buildReportFromCLI, buildReportFromHourly } from './aggregators/normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3333;

app.use(express.static(join(__dirname, 'public')));

function getDateRange(period, since, until) {
  const now  = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case '1d':    return { since: today,                              until: now };
    case '3d':    return { since: new Date(+today - 2 * 86_400_000), until: now };
    case '7d':    return { since: new Date(+today - 6 * 86_400_000), until: now };
    case 'custom':return { since: since ? new Date(since) : today,   until: until ? new Date(until) : now };
    default:      return null; // 5h handled separately
  }
}

async function fetchReport(period, since, until) {
  if (period === '5h') {
    const claudeHourly = readClaudeUsageSince(Date.now() - 5 * 3_600_000);
    return buildReportFromHourly({ period: '5h', claudeHourly });
  }
  const range = getDateRange(period, since, until);
  const [claudeDaily, claudeSessions, codexDaily, codexSessions] = await Promise.all([
    Promise.resolve().then(() => getClaudeDailyData(range.since, range.until)),
    Promise.resolve().then(() => getClaudeSessionData(range.since, range.until)),
    Promise.resolve().then(() => getCodexDailyData(range.since, range.until)),
    Promise.resolve().then(() => getCodexSessionData(range.since, range.until))
  ]);
  return buildReportFromCLI({ period, claudeDaily, codexDaily, claudeSessions, codexSessions });
}

// REST endpoint
app.get('/api/usage', async (req, res) => {
  const period       = req.query.period || '1d';
  const { since, until } = req.query;
  try {
    res.json(await fetchReport(period, since, until));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE endpoint
app.get('/api/stream', (req, res) => {
  const period       = req.query.period || '1d';
  const { since, until } = req.query;

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const push = async () => {
    try {
      const report = await fetchReport(period, since, until);
      res.write(`data: ${JSON.stringify(report)}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  };

  push();
  const interval = setInterval(push, 30_000);
  req.on('close', () => clearInterval(interval));
});

app.listen(PORT, () => console.log(`Token Dashboard → http://localhost:${PORT}`));
```

- [ ] **Step 2: Write placeholder public/index.html**

```html
<!DOCTYPE html><html><body>
<h1 style="font-family:monospace;color:#00ff41;background:#0d0d0d;padding:40px">
  TOKEN DASHBOARD — coming in Task 6
</h1>
</body></html>
```

- [ ] **Step 3: Start server and verify API**

```bash
node server.js &
sleep 3
curl -s "http://localhost:3333/api/usage?period=1d" | python3 -m json.tool | grep -E '"period"|"totalTokens"|"totalCost"'
```

Expected:
```
"period": "1d",
"totalTokens": <number>,
"totalCost": <number>,
```

```bash
curl -s "http://localhost:3333/api/usage?period=5h" | python3 -m json.tool | grep '"period"'
```

Expected: `"period": "5h",`

```bash
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add server.js public/index.html
git commit -m "feat: add Express server with /api/usage and /api/stream SSE endpoints"
```

---

### Task 6: Dashboard frontend

**Files:**
- Modify: `public/index.html`

UI layout (inspired by vibeusage matrix aesthetic):
- Dark background `#0d0d0d`, green `#00ff41` accent, monospace font
- Header: `▸ TOKEN DASHBOARD` + last-updated timestamp
- Period tabs: 5H | 1D | 3D | 7D | CUSTOM (custom reveals date inputs)
- 4 stat cards: Total Tokens | Total Cost $ | Cache Hit % | Models Used
- Bar chart: stacked bars per day — Claude input/output/cache (green shades) + Codex input/output (blue shades); hidden for 5h period
- Doughnut chart: model distribution by cost
- Session table: up to 50 rows, SOURCE badge (CLAUDE amber / CODEX blue), session short-ID, tokens, cost, last activity, models

- [ ] **Step 1: Write public/index.html**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Token Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0d0d0d; --panel: #111; --border: #1e1e1e;
      --green: #00ff41; --green-dim: #00b32d; --green-faint: rgba(0,255,65,0.05);
      --amber: #ffb800; --blue: #00b4ff;
      --text: #c8c8c8; --text-dim: #555;
      --font: 'Courier New', Consolas, monospace;
    }
    body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; min-height: 100vh; }

    /* ── Header ── */
    .header { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; border-bottom: 1px solid var(--border); }
    .header-title { color: var(--green); font-size: 15px; font-weight: bold; letter-spacing: 3px; }
    .header-status { color: var(--text-dim); font-size: 11px; }

    /* ── Period tabs ── */
    .period-bar { display: flex; align-items: center; gap: 4px; padding: 10px 24px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .period-btn { background: none; border: 1px solid var(--border); color: var(--text-dim); padding: 4px 14px; cursor: pointer; font-family: var(--font); font-size: 12px; letter-spacing: 1px; transition: all 0.15s; }
    .period-btn:hover  { border-color: var(--green-dim); color: var(--green-dim); }
    .period-btn.active { border-color: var(--green); color: var(--green); background: var(--green-faint); }
    .custom-range { display: none; align-items: center; gap: 8px; margin-left: 12px; }
    .custom-range.visible { display: flex; }
    .custom-range input { background: var(--panel); border: 1px solid var(--border); color: var(--text); padding: 3px 8px; font-family: var(--font); font-size: 12px; width: 130px; }
    .custom-range button { background: none; border: 1px solid var(--green-dim); color: var(--green-dim); padding: 3px 10px; cursor: pointer; font-family: var(--font); font-size: 11px; }

    /* ── Main ── */
    .main { padding: 18px 24px; display: flex; flex-direction: column; gap: 14px; }

    /* ── Stat cards ── */
    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .stat-card { background: var(--panel); border: 1px solid var(--border); padding: 14px 16px; }
    .stat-label { color: var(--text-dim); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; }
    .stat-value { font-size: 22px; font-weight: bold; color: var(--green); line-height: 1; }
    .stat-sub   { color: var(--text-dim); font-size: 10px; margin-top: 5px; }

    /* ── Charts ── */
    .charts-row { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; }
    .chart-panel { background: var(--panel); border: 1px solid var(--border); padding: 14px 16px; }
    .panel-title { color: var(--text-dim); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 12px; }
    .chart-wrap { position: relative; height: 200px; }

    /* ── Session table ── */
    .session-panel { background: var(--panel); border: 1px solid var(--border); }
    .session-header { padding: 10px 16px; border-bottom: 1px solid var(--border); }
    .session-scroll { max-height: 300px; overflow-y: auto; }
    table { width: 100%; border-collapse: collapse; }
    th { position: sticky; top: 0; background: #161616; color: var(--text-dim); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; padding: 7px 10px; text-align: left; border-bottom: 1px solid var(--border); }
    td { padding: 6px 10px; border-bottom: 1px solid #161616; font-size: 11px; }
    tr:hover td { background: var(--green-faint); }
    .badge { padding: 2px 6px; font-size: 10px; border: 1px solid; letter-spacing: 1px; }
    .badge-claude { color: var(--amber); border-color: var(--amber); }
    .badge-codex  { color: var(--blue);  border-color: var(--blue);  }
    .placeholder  { color: var(--text-dim); text-align: center; padding: 32px; letter-spacing: 2px; font-size: 11px; }

    @media (max-width: 900px) {
      .stats-row  { grid-template-columns: repeat(2, 1fr); }
      .charts-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

<div class="header">
  <div class="header-title">▸ TOKEN DASHBOARD</div>
  <div class="header-status" id="status">CONNECTING...</div>
</div>

<div class="period-bar">
  <button class="period-btn"        data-period="5h">5H</button>
  <button class="period-btn active" data-period="1d">1D</button>
  <button class="period-btn"        data-period="3d">3D</button>
  <button class="period-btn"        data-period="7d">7D</button>
  <button class="period-btn"        data-period="custom">CUSTOM</button>
  <div class="custom-range" id="customRange">
    <input type="date" id="sinceInput">
    <span style="color:var(--text-dim)">→</span>
    <input type="date" id="untilInput">
    <button id="applyCustom">APPLY</button>
  </div>
</div>

<div class="main">

  <div class="stats-row">
    <div class="stat-card">
      <div class="stat-label">TOTAL TOKENS</div>
      <div class="stat-value" id="sTokens">—</div>
      <div class="stat-sub"  id="sTokensSub"></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">TOTAL COST</div>
      <div class="stat-value" id="sCost">—</div>
      <div class="stat-sub">USD</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">CACHE HIT</div>
      <div class="stat-value" id="sCache">—</div>
      <div class="stat-sub">read / (read + create)</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">MODELS USED</div>
      <div class="stat-value" id="sModels">—</div>
      <div class="stat-sub"  id="sModelNames"></div>
    </div>
  </div>

  <div class="charts-row">
    <div class="chart-panel" id="tokenChartPanel">
      <div class="panel-title">TOKEN BREAKDOWN BY DAY</div>
      <div class="chart-wrap"><canvas id="tokenChart"></canvas></div>
    </div>
    <div class="chart-panel">
      <div class="panel-title">MODEL DISTRIBUTION</div>
      <div class="chart-wrap"><canvas id="modelChart"></canvas></div>
    </div>
  </div>

  <div class="session-panel">
    <div class="session-header">
      <span class="panel-title" style="margin:0;border:none;padding:0">SESSIONS</span>
    </div>
    <div class="session-scroll">
      <table>
        <thead><tr>
          <th>SRC</th><th>SESSION</th>
          <th>TOKENS</th><th>IN</th><th>OUT</th><th>CACHE</th>
          <th>COST $</th><th>LAST ACTIVITY</th><th>MODELS</th>
        </tr></thead>
        <tbody id="sessionBody">
          <tr><td colspan="9" class="placeholder">LOADING...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

</div>

<script>
// ── State ──────────────────────────────────────────────────────────────────
let currentPeriod = '1d';
let tokenChart = null, modelChart = null;
let es = null;

// ── Chart defaults ─────────────────────────────────────────────────────────
Chart.defaults.color       = '#555';
Chart.defaults.borderColor = '#1e1e1e';

// ── Formatters ─────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
function fmtCost(n) {
  if (!n) return '$0.0000';
  return '$' + Number(n).toFixed(4);
}
function shortModel(name) {
  return (name || '').split('-').slice(-2).join('-');
}
function shortSession(id) {
  return (id || '').split('/').pop()?.slice(-14) || (id || '').slice(-14) || '—';
}

// ── Render stats ───────────────────────────────────────────────────────────
function renderStats(report) {
  const s = report.summary;
  document.getElementById('sTokens').textContent    = fmt(s.totalTokens);
  document.getElementById('sTokensSub').textContent = `in:${fmt(s.inputTokens)} out:${fmt(s.outputTokens)}`;
  document.getElementById('sCost').textContent       = fmtCost(s.totalCost);
  const cacheTotal = (s.cacheReadTokens || 0) + (s.cacheCreationTokens || 0);
  document.getElementById('sCache').textContent      = cacheTotal > 0
    ? ((s.cacheReadTokens || 0) / cacheTotal * 100).toFixed(1) + '%' : '—';
  document.getElementById('sModels').textContent     = report.models.length;
  document.getElementById('sModelNames').textContent = report.models.slice(0, 2).map(m => shortModel(m.name)).join(', ');
}

// ── Render token bar chart ─────────────────────────────────────────────────
function renderTokenChart(report) {
  const panel = document.getElementById('tokenChartPanel');
  if (!report.daily?.length) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const d = report.daily;
  if (tokenChart) tokenChart.destroy();
  tokenChart = new Chart(document.getElementById('tokenChart'), {
    type: 'bar',
    data: {
      labels: d.map(r => r.date),
      datasets: [
        { label: 'Claude In',    data: d.map(r => r.claude?.inputTokens        || 0), backgroundColor: 'rgba(0,255,65,0.75)',  stack: 'claude' },
        { label: 'Claude Out',   data: d.map(r => r.claude?.outputTokens       || 0), backgroundColor: 'rgba(0,180,45,0.75)',  stack: 'claude' },
        { label: 'Claude Cache', data: d.map(r => (r.claude?.cacheReadTokens || 0) + (r.claude?.cacheCreationTokens || 0)), backgroundColor: 'rgba(0,80,20,0.6)', stack: 'claude' },
        { label: 'Codex In',     data: d.map(r => r.codex?.inputTokens         || 0), backgroundColor: 'rgba(0,180,255,0.75)', stack: 'codex' },
        { label: 'Codex Out',    data: d.map(r => r.codex?.outputTokens        || 0), backgroundColor: 'rgba(0,100,200,0.75)', stack: 'codex' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { family: 'Courier New', size: 10 } } },
        y: { stacked: true, ticks: { callback: v => fmt(v), font: { family: 'Courier New', size: 10 } } }
      },
      plugins: { legend: { labels: { font: { family: 'Courier New', size: 10 }, boxWidth: 10, padding: 8 } } }
    }
  });
}

// ── Render model doughnut ──────────────────────────────────────────────────
function renderModelChart(report) {
  if (!report.models.length) return;
  if (modelChart) modelChart.destroy();
  const COLORS = ['#00ff41','#00b4ff','#ffb800','#ff4444','#aa00ff','#00ffcc'];
  modelChart = new Chart(document.getElementById('modelChart'), {
    type: 'doughnut',
    data: {
      labels: report.models.map(m => shortModel(m.name)),
      datasets: [{
        data:            report.models.map(m => m.cost > 0 ? m.cost : m.totalTokens),
        backgroundColor: report.models.map((_, i) => COLORS[i % COLORS.length] + '99'),
        borderColor:     report.models.map((_, i) => COLORS[i % COLORS.length]),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'Courier New', size: 10 }, boxWidth: 10, padding: 6 } },
        tooltip: { callbacks: {
          label: ctx => ` ${ctx.label}: ${fmtCost(ctx.raw)} (${report.models[ctx.dataIndex]?.pct}%)`
        }}
      }
    }
  });
}

// ── Render session table ───────────────────────────────────────────────────
function renderSessions(report) {
  const tbody = document.getElementById('sessionBody');
  if (!report.sessions?.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="placeholder">NO SESSIONS</td></tr>';
    return;
  }
  tbody.innerHTML = report.sessions.slice(0, 50).map(s => {
    const total = (s.inputTokens || 0) + (s.outputTokens || 0) + (s.cacheTokens || 0);
    const ts    = s.lastActivity ? new Date(s.lastActivity).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const models = (s.models || []).map(m => m.split('-').pop()).join(', ');
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

// ── Render full report ─────────────────────────────────────────────────────
function renderReport(report) {
  document.getElementById('status').textContent = `UPDATED ${new Date(report.updatedAt).toLocaleTimeString()}`;
  renderStats(report);
  renderTokenChart(report);
  renderModelChart(report);
  renderSessions(report);
}

// ── SSE connection ─────────────────────────────────────────────────────────
function connect(period, since, until) {
  if (es) { es.close(); es = null; }
  document.getElementById('status').textContent = 'LOADING...';
  let url = `/api/stream?period=${period}`;
  if (since) url += `&since=${since}`;
  if (until) url += `&until=${until}`;
  es = new EventSource(url);
  es.onmessage = e => {
    try {
      const data = JSON.parse(e.data);
      if (data.error) { document.getElementById('status').textContent = 'ERROR: ' + data.error; return; }
      renderReport(data);
    } catch { document.getElementById('status').textContent = 'PARSE ERROR'; }
  };
  es.onerror = () => { document.getElementById('status').textContent = 'RECONNECTING...'; };
}

// ── Period tab clicks ──────────────────────────────────────────────────────
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod = btn.dataset.period;
    const customRange = document.getElementById('customRange');
    if (currentPeriod === 'custom') {
      customRange.classList.add('visible');
    } else {
      customRange.classList.remove('visible');
      connect(currentPeriod);
    }
  });
});

// ── Custom range apply ─────────────────────────────────────────────────────
document.getElementById('applyCustom').addEventListener('click', () => {
  const since = document.getElementById('sinceInput').value;
  const until = document.getElementById('untilInput').value;
  if (since) connect('custom', since, until || undefined);
});

// ── Boot ───────────────────────────────────────────────────────────────────
connect('1d');
</script>
</body>
</html>
```

- [ ] **Step 2: Start server and open dashboard**

```bash
node server.js
```

Open browser: `http://localhost:3333`

Expected: Dark dashboard loads. Header shows `▸ TOKEN DASHBOARD`. Status changes from `LOADING...` to `UPDATED HH:MM:SS`.

- [ ] **Step 3: Verify each period tab**

Click: `5H` → data loads, bar chart hidden, stat cards show tokens/cost  
Click: `1D` → bar chart appears with today's data  
Click: `3D` → bar chart shows 3 days  
Click: `7D` → bar chart shows up to 7 days  
Click: `CUSTOM` → date inputs appear; enter a date range and click APPLY → data updates

- [ ] **Step 4: Verify real-time refresh**

Leave the dashboard open. After 30 seconds, the `UPDATED HH:MM:SS` timestamp in the header should tick forward.

- [ ] **Step 5: Verify session table**

Session table should show rows with CLAUDE (amber badge) and CODEX (blue badge) sources mixed together. Session IDs are truncated to last 14 chars.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: complete dashboard UI — period selector, stat cards, charts, session table"
```

---

### Task 7: Final smoke test

- [ ] **Step 1: Full API verification**

```bash
node server.js &
sleep 3

curl -s "http://localhost:3333/api/usage?period=5h" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('5h  →', d['period'], '| tokens:', d['summary']['totalTokens'], '| cost:', round(d['summary']['totalCost'], 4))
"

curl -s "http://localhost:3333/api/usage?period=1d" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('1d  →', d['period'], '| tokens:', d['summary']['totalTokens'], '| daily rows:', len(d['daily']))
"

curl -s "http://localhost:3333/api/usage?period=7d" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('7d  →', d['period'], '| sessions:', len(d['sessions']), '| models:', [m['name'] for m in d['models']])
"

kill %1
```

Expected (values will vary):
```
5h  → 5h | tokens: 123456 | cost: 0.3527
1d  → 1d | tokens: 234567 | daily rows: 1
7d  → 7d | sessions: 12 | models: ['claude-sonnet-4-6', 'gpt-5.3-codex', ...]
```

- [ ] **Step 2: Verify both data sources appear in sessions**

```bash
node server.js &
sleep 3
curl -s "http://localhost:3333/api/usage?period=7d" | python3 -c "
import json, sys
d = json.load(sys.stdin)
sources = set(s['source'] for s in d['sessions'])
print('Sources found:', sources)
"
kill %1
```

Expected: `Sources found: {'claude', 'codex'}` (both present)

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: token dashboard v1 — unified Claude + Codex usage tracking with real-time refresh"
```
