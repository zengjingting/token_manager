# Wave 1: Dashboard Fixes & Small Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix and polish the dashboard's stat cards, charts, and project cost calculation, plus two trivial copy/regex tweaks in `history.js`. No History-tab structural changes — those are deferred to Wave 2.

**Architecture:** Two backend changes (extending the report `summary` shape and rewriting `getProjectStats()` to reuse `ccusage`'s already-computed costs) and a series of focused frontend changes to the stat cards and charts. The project chart fix is the single largest piece — it removes our broken local-cost-summing path and delegates pricing to `ccusage` via the existing `cli-runner.js`.

**Tech Stack:** Node 22, ES modules, Express, Chart.js (CDN), vanilla JS frontend, `node:test` for backend unit tests.

**Out of scope (deferred):**
- Codex sessions in the History tab → Wave 2
- Session deletion / custom title sync to dashboard / in-session search → Wave 3
- Per-session cost display in History (user decision: Pro/Max subscriber, costs not shown there)

---

## File Structure

| File | Wave 1 responsibility |
|---|---|
| `aggregators/normalize.js` | Add `claudeCost`, `codexCost`, `claudeCacheReadTokens` to `summary`. Both `buildReportFromCLI` and `buildReportFromHourly` paths. |
| `readers/chat-reader.js` | Rewrite `getProjectStats()` to fetch costs from `ccusage` session output (via `cli-runner`) and aggregate by project dir. Token counts continue to be computed locally from JSONL. |
| `tests/chat-reader.test.js` | Add tests for the new `getProjectStats()` behavior using a mocked `ccusage` runner. |
| `tests/normalize.test.js` *(new)* | Add tests for the new `summary` fields. |
| `public/index.html` | Add an info icon (`ⓘ`) to each of the 4 stat cards next to the label. Move stat-tip wrapper out of label flow. |
| `public/style.css` | Styles for `.stat-info-icon` and `.stat-label-row`. |
| `public/app.js` | Update i18n copy (`tipTokens`, `tipCost`, `tipCache`, `lCacheSub`, `lModelChart`); rewrite the stat-card hover handler to bind to icons; update `renderStats()` to display claude/codex cost split and Claude-only cache hit rate; add `title` attrs to Token chart series-control labels. |
| `public/history.js` | Two trivial fixes: button text "展示工具调用记录 (N)" and export filename regex relaxation. |

**No new files except `tests/normalize.test.js`.**

---

## Tasks

### Task 1: Backend — Extend `summary` with claude/codex cost split & claude cache read

**Files:**
- Modify: `aggregators/normalize.js:122-141` (`buildSummary`)
- Modify: `aggregators/normalize.js:198-278` (`buildReportFromHourly`)
- Create: `tests/normalize.test.js`
- Modify: `package.json:10` (test script — append the new test file)

**Why:** The frontend Cost card needs separate Claude / Codex totals to render `claude code: $X codex: $Y`, and the cache-hit-rate card needs `claudeCacheReadTokens` to compute a Claude-only ratio (since Codex has no creation tokens, mixing them in is misleading). Both fields must exist in both report-build code paths so 5h and other periods behave identically.

- [ ] **Step 1.1: Write the failing test for `buildSummary` claude/codex split**

Create `tests/normalize.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportFromCLI, buildReportFromHourly } from '../aggregators/normalize.js';

const SAMPLE_CLAUDE_DAILY = {
  daily: [
    {
      date: '2026-04-12',
      inputTokens: 100, outputTokens: 200,
      cacheCreationTokens: 50, cacheReadTokens: 1000,
      totalCost: 1.25,
      modelBreakdowns: [{ modelName: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 200, cacheCreationTokens: 50, cacheReadTokens: 1000, cost: 1.25 }]
    }
  ]
};

const SAMPLE_CODEX_DAILY = {
  daily: [
    {
      date: 'Apr 12, 2026',
      inputTokens: 80, outputTokens: 40,
      cachedInputTokens: 500,
      reasoningOutputTokens: 0,
      costUSD: 0.40,
      models: { 'gpt-5-codex': { totalTokens: 620 } }
    }
  ]
};

test('buildReportFromCLI summary exposes claudeCost, codexCost, claudeCacheReadTokens', () => {
  const report = buildReportFromCLI({
    period: '1d',
    claudeDaily: SAMPLE_CLAUDE_DAILY,
    codexDaily: SAMPLE_CODEX_DAILY,
    claudeSessions: { sessions: [] },
    codexSessions: { sessions: [] }
  });
  assert.equal(report.summary.claudeCost, 1.25);
  assert.equal(report.summary.codexCost, 0.40);
  assert.equal(report.summary.totalCost, 1.65);
  assert.equal(report.summary.claudeCacheReadTokens, 1000);
});

test('buildReportFromHourly summary exposes claudeCost, codexCost, claudeCacheReadTokens', () => {
  const report = buildReportFromHourly({
    period: '5h',
    claudeHourly: {
      summary: { inputTokens: 100, outputTokens: 200, cacheCreationTokens: 50, cacheReadTokens: 1000, totalCost: 1.25 },
      models: [], sessions: [], hourlyBuckets: []
    },
    codexHourly: {
      summary: { inputTokens: 80, outputTokens: 40, cacheReadTokens: 500, totalCost: 0.40 },
      models: [], sessions: [], hourlyBuckets: []
    }
  });
  assert.equal(report.summary.claudeCost, 1.25);
  assert.equal(report.summary.codexCost, 0.40);
  assert.equal(report.summary.claudeCacheReadTokens, 1000);
});
```

- [ ] **Step 1.2: Update `package.json` test script to include both files**

Replace line 10:
```json
"test": "node --test tests/chat-reader.test.js tests/normalize.test.js"
```

- [ ] **Step 1.3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `expected undefined to equal 1.25` (or similar — the new fields don't exist yet).

- [ ] **Step 1.4: Modify `buildSummary` in `aggregators/normalize.js`**

Replace the current function (lines 122-141) with:

```javascript
function buildSummary(daily) {
  let inputTokens = 0, outputTokens = 0;
  let cacheCreationTokens = 0, cacheReadTokens = 0;
  let claudeCacheReadTokens = 0;
  let claudeCost = 0, codexCost = 0;
  for (const day of daily) {
    if (day.claude) {
      inputTokens         += day.claude.inputTokens;
      outputTokens        += day.claude.outputTokens;
      cacheCreationTokens += day.claude.cacheCreationTokens;
      cacheReadTokens     += day.claude.cacheReadTokens;
      claudeCacheReadTokens += day.claude.cacheReadTokens;
      claudeCost          += day.claude.totalCost;
    }
    if (day.codex) {
      inputTokens     += day.codex.inputTokens;
      outputTokens    += day.codex.outputTokens;
      cacheReadTokens += day.codex.cachedInputTokens || 0;
      codexCost       += day.codex.totalCost;
    }
  }
  return {
    inputTokens, outputTokens,
    cacheCreationTokens, cacheReadTokens,
    claudeCacheReadTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
    totalCost: claudeCost + codexCost,
    claudeCost, codexCost
  };
}
```

- [ ] **Step 1.5: Modify `buildReportFromHourly` summary block in `aggregators/normalize.js`**

Replace lines 262-273 with:

```javascript
    summary: {
      inputTokens: (claudeSummary.inputTokens || 0) + (codexSummary.inputTokens || 0),
      outputTokens: (claudeSummary.outputTokens || 0) + (codexSummary.outputTokens || 0),
      cacheCreationTokens: claudeSummary.cacheCreationTokens || 0,
      cacheReadTokens: (claudeSummary.cacheReadTokens || 0) + (codexSummary.cacheReadTokens || 0),
      claudeCacheReadTokens: claudeSummary.cacheReadTokens || 0,
      totalTokens:
        (claudeSummary.inputTokens || 0) + (codexSummary.inputTokens || 0) +
        (claudeSummary.outputTokens || 0) + (codexSummary.outputTokens || 0) +
        (claudeSummary.cacheCreationTokens || 0) +
        (claudeSummary.cacheReadTokens || 0) + (codexSummary.cacheReadTokens || 0),
      totalCost,
      claudeCost: claudeSummary.totalCost || 0,
      codexCost: codexSummary.totalCost || 0
    },
```

- [ ] **Step 1.6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — both `normalize.test.js` tests green; existing `chat-reader.test.js` tests still green.

- [ ] **Step 1.7: Commit**

```bash
git add aggregators/normalize.js tests/normalize.test.js package.json
git commit -m "feat(report): add claudeCost/codexCost/claudeCacheReadTokens to summary"
```

---

### Task 2: Backend — Rewrite `getProjectStats()` to use ccusage session costs

**Files:**
- Modify: `readers/chat-reader.js:275-321` (`getProjectStats`)
- Modify: `tests/chat-reader.test.js` (add new test)

**Why:** The current implementation reads `entry.costUSD` from JSONL files, which is missing/0 for Pro/Max subscribers (the user). `ccusage session --json` already returns `totalCost` per session, computed from its internal pricing tables. We delegate cost computation to `ccusage` and keep the project-grouping logic local. Token counts stay locally computed (they're always present in JSONL).

**Investigation note for the implementer:** Run this once before writing code so you understand the shape:
```bash
/opt/homebrew/opt/node@22/bin/node /opt/homebrew/bin/ccusage session --json | head -60
```
You will see entries like:
```json
{
  "sessionId": "-Users-ting-Documents-Token-dashboard",
  "totalCost": 20.76,
  "projectPath": "Unknown Project"
}
```
**Critical:** ccusage's `sessionId` for top-level project sessions equals our `dir.name` (the encoded path). For nested sessions, `projectPath` may be `"<encoded-dir>/<uuid>"`. Use `sessionId` as the primary key — it matches `dir.name` directly. Sessions where `sessionId` is a non-encoded leaf (e.g. `"subagents"`) and `projectPath` contains a real encoded path should fall back to splitting `projectPath` on `/` and taking the first segment.

- [ ] **Step 2.1: Write the failing test**

Append to `tests/chat-reader.test.js`:

```javascript
import { _setCcusageRunnerForTests, getProjectStats } from '../readers/chat-reader.js';

test('getProjectStats: aggregates costs from injected ccusage runner, groups by project dir', (t) => {
  // Set up a fake projects dir with two project folders
  const root = join(tmpdir(), `chat-reader-projstat-${Date.now()}`);
  const projA = join(root, '-Users-x-projA');
  const projB = join(root, '-Users-x-projB');
  mkdirSync(projA, { recursive: true });
  mkdirSync(projB, { recursive: true });
  writeFileSync(join(projA, 'sess-1.jsonl'),
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
      timestamp: '2026-04-11T10:00:00.000Z'
    }) + '\n');
  writeFileSync(join(projB, 'sess-2.jsonl'),
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 20, output_tokens: 8, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
      timestamp: '2026-04-11T10:00:00.000Z'
    }) + '\n');

  // Inject a fake ccusage runner that returns cost data keyed by sessionId == dir name
  _setCcusageRunnerForTests(() => ({
    sessions: [
      { sessionId: '-Users-x-projA', totalCost: 1.50 },
      { sessionId: '-Users-x-projB', totalCost: 0.75 }
    ]
  }));

  // Override the projects dir constant via env (see Step 2.2 for env-based override)
  const prev = process.env.CLAUDE_PROJECTS_DIR;
  process.env.CLAUDE_PROJECTS_DIR = root;

  try {
    const stats = getProjectStats();
    assert.equal(stats.length, 2);
    const a = stats.find(s => s.dirName === '-Users-x-projA');
    const b = stats.find(s => s.dirName === '-Users-x-projB');
    assert.equal(a.totalCost, 1.50);
    assert.equal(b.totalCost, 0.75);
    assert.equal(a.inputTokens, 10);
    assert.equal(b.inputTokens, 20);
    // Sorted by cost desc
    assert.equal(stats[0].dirName, '-Users-x-projA');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
    else process.env.CLAUDE_PROJECTS_DIR = prev;
    _setCcusageRunnerForTests(null);
    rmSync(root, { recursive: true, force: true });
  }
});

test('getProjectStats: nested ccusage sessions fall back to projectPath first segment', () => {
  const root = join(tmpdir(), `chat-reader-projstat-nested-${Date.now()}`);
  const projA = join(root, '-Users-x-projA');
  mkdirSync(projA, { recursive: true });
  writeFileSync(join(projA, 'sess-1.jsonl'),
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
      timestamp: '2026-04-11T10:00:00.000Z'
    }) + '\n');

  _setCcusageRunnerForTests(() => ({
    sessions: [
      { sessionId: 'leaf-name', projectPath: '-Users-x-projA/sub-uuid', totalCost: 2.00 },
      { sessionId: 'orphan',    projectPath: 'Unknown Project',          totalCost: 99.00 }
    ]
  }));

  const prev = process.env.CLAUDE_PROJECTS_DIR;
  process.env.CLAUDE_PROJECTS_DIR = root;
  try {
    const stats = getProjectStats();
    const a = stats.find(s => s.dirName === '-Users-x-projA');
    assert.ok(a, 'projA should be present');
    assert.equal(a.totalCost, 2.00, 'nested ccusage entry should map to projA via projectPath');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
    else process.env.CLAUDE_PROJECTS_DIR = prev;
    _setCcusageRunnerForTests(null);
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL with `_setCcusageRunnerForTests is not a function` (or similar — the exports don't exist yet).

- [ ] **Step 2.3: Make `PROJECTS_DIR` overridable & add ccusage runner injection in `chat-reader.js`**

Find the existing `PROJECTS_DIR` constant near the top of `readers/chat-reader.js` (it's defined as something like `const PROJECTS_DIR = join(homedir(), '.claude', 'projects');`). Replace with:

```javascript
const DEFAULT_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
function projectsDir() { return process.env.CLAUDE_PROJECTS_DIR || DEFAULT_PROJECTS_DIR; }
```

Then **replace every reference to `PROJECTS_DIR` in this file with a call to `projectsDir()`**. The grep target list (verify with `grep -n PROJECTS_DIR readers/chat-reader.js`):
- `existsSync(PROJECTS_DIR)` → `existsSync(projectsDir())`
- `readdirSync(PROJECTS_DIR, ...)` → `readdirSync(projectsDir(), ...)`
- `join(PROJECTS_DIR, ...)` → `join(projectsDir(), ...)`

This affects `listSessions`, `readSession`, `searchSessions`, `getProjectStats`, `getDailyActivity`. Update all of them.

Then add the ccusage runner injection at the top of the file (after the imports):

```javascript
import { getClaudeSessionData } from './cli-runner.js';

let _ccusageRunner = null;
export function _setCcusageRunnerForTests(fn) { _ccusageRunner = fn; }
function fetchCcusageSessions() {
  if (_ccusageRunner) return _ccusageRunner();
  try {
    return getClaudeSessionData(undefined, undefined);
  } catch (err) {
    console.error('[chat-reader] ccusage session fetch failed:', err.message);
    return { sessions: [] };
  }
}
```

- [ ] **Step 2.4: Replace `getProjectStats()` body in `readers/chat-reader.js`**

Replace lines 275-321 with:

```javascript
export function getProjectStats() {
  const dir = projectsDir();
  if (!existsSync(dir)) return [];

  // 1. Build the dir.name -> { tokens } map from local JSONL scan
  const dirs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const byDir = new Map();
  for (const d of dirs) {
    const dirPath = join(dir, d.name);
    let files;
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    let inputTokens = 0, outputTokens = 0, cacheTokens = 0;
    for (const file of files) {
      try {
        const parsed = parseSessionFile(join(dirPath, file));
        inputTokens  += parsed.inputTokens;
        outputTokens += parsed.outputTokens;
        cacheTokens  += parsed.cacheTokens;
      } catch {
        continue;
      }
    }
    if (inputTokens + outputTokens > 0) {
      byDir.set(d.name, {
        name: decodeDirName(d.name),
        dirName: d.name,
        inputTokens,
        outputTokens,
        cacheTokens,
        totalCost: 0,
        sessionCount: files.length
      });
    }
  }

  // 2. Pull costs from ccusage and attribute them to the correct dirName
  const ccusage = fetchCcusageSessions();
  for (const s of (ccusage?.sessions || [])) {
    let key = s.sessionId;
    if (!byDir.has(key) && s.projectPath && s.projectPath !== 'Unknown Project') {
      // ccusage nested entry: projectPath like "<encoded-dir>/<uuid>"
      key = String(s.projectPath).split('/')[0];
    }
    if (byDir.has(key)) {
      byDir.get(key).totalCost += Number(s.totalCost) || 0;
    }
  }

  return [...byDir.values()].sort((a, b) => b.totalCost - a.totalCost);
}
```

- [ ] **Step 2.5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all four `chat-reader.test.js` tests green (existing two + new two), `normalize.test.js` still green.

- [ ] **Step 2.6: Manual smoke test against real data**

Run the server and hit the analytics endpoint:
```bash
npm start &
sleep 2
curl -s http://localhost:3333/api/analytics/projects | head -100
lsof -ti:3333 | xargs kill -9
```
Expected: at least one project has `totalCost > 0`. If everything is still 0, the ccusage path is broken — STOP and investigate before proceeding.

- [ ] **Step 2.7: Commit**

```bash
git add readers/chat-reader.js tests/chat-reader.test.js
git commit -m "fix(projects): aggregate cost via ccusage session output instead of broken JSONL costUSD"
```

---

### Task 3: Frontend HTML/CSS — Add info icons to all 4 stat cards

**Files:**
- Modify: `public/index.html:73-98` (stat-cards block)
- Modify: `public/style.css` (append new rules)

**Why:** User wants the tooltip trigger to be an explicit "ⓘ-style" icon (a small circle containing `!`) next to each card label, replacing the current "hover anywhere on the card" behavior.

- [ ] **Step 3.1: Update HTML structure for all 4 stat cards**

Replace lines 73-98 in `public/index.html` with:

```html
          <div class="stats-row">
            <div class="stat-card">
              <div class="stat-tip" id="tipTokens"></div>
              <div class="stat-label-row">
                <div class="stat-label" id="lTokens">总 Token</div>
                <span class="stat-info-icon" data-tip="tipTokens" aria-label="说明">!</span>
              </div>
              <div class="stat-value" id="sTokens">—</div>
              <div class="stat-sub"  id="sTokensSub"></div>
            </div>
            <div class="stat-card">
              <div class="stat-tip" id="tipCost"></div>
              <div class="stat-label-row">
                <div class="stat-label" id="lCost">总费用</div>
                <span class="stat-info-icon" data-tip="tipCost" aria-label="说明">!</span>
              </div>
              <div class="stat-value" id="sCost">—</div>
              <div class="stat-sub" id="lCostSub">USD</div>
            </div>
            <div class="stat-card">
              <div class="stat-tip" id="tipCache"></div>
              <div class="stat-label-row">
                <div class="stat-label" id="lCache">缓存命中</div>
                <span class="stat-info-icon" data-tip="tipCache" aria-label="说明">!</span>
              </div>
              <div class="stat-value" id="sCache">—</div>
              <div class="stat-sub" id="lCacheSub">仅 claude code</div>
            </div>
            <div class="stat-card">
              <div class="stat-tip" id="tipModels"></div>
              <div class="stat-label-row">
                <div class="stat-label" id="lModels">模型数</div>
                <span class="stat-info-icon" data-tip="tipModels" aria-label="说明">!</span>
              </div>
              <div class="stat-value" id="sModels">—</div>
              <div class="stat-sub"  id="sModelNames"></div>
            </div>
          </div>
```

- [ ] **Step 3.2: Append CSS rules to `public/style.css`**

Append at the end of the file:

```css
/* Stat-card info icon (Wave 1) */
.stat-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.stat-info-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1px solid var(--text-dim);
  color: var(--text-dim);
  font-size: 9px;
  font-weight: bold;
  font-family: Georgia, serif;
  line-height: 1;
  cursor: help;
  user-select: none;
  flex: none;
}
.stat-info-icon:hover {
  border-color: var(--accent, #D97757);
  color: var(--accent, #D97757);
}
```

- [ ] **Step 3.3: Visual smoke check**

Run: `npm start`
Open `http://localhost:3333` in a browser. Verify:
- Each of the 4 cards has the small `!` circle next to the label.
- The icon is visually aligned with the label text.
- (No tooltip trigger yet — that's Task 4.)

Stop the server before continuing: `lsof -ti:3333 | xargs kill -9`

- [ ] **Step 3.4: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat(dashboard): add info icons to stat cards (HTML/CSS)"
```

---

### Task 4: Frontend JS — Bind tooltips to icons, update copy

**Files:**
- Modify: `public/app.js:22-25` (zh tip strings)
- Modify: `public/app.js:48-51` (en tip strings)
- Modify: `public/app.js:10` (zh `lCacheSub`)
- Modify: `public/app.js:36` (en `lCacheSub`)
- Modify: `public/app.js:365-376` (the stat-card hover handler block at the bottom)

**Why:** Per user request, copy needs updating ("本周期内Claude+Codex消耗的Token数量之和..." etc.) and the hover trigger must move from the entire card to just the icons added in Task 3.

- [ ] **Step 4.1: Update zh tip strings in `T.zh` block**

Replace lines 22-25 in `public/app.js` with:

```javascript
    tipTokens:  '本周期内 Claude + Codex 消耗的 Token 数量之和，包括输入 + 输出 + 缓存创建 + 缓存读取',
    tipCost:    '本周期内 Claude + Codex 的合计 API 费用',
    tipCache:   '仅 Claude Code 的缓存读取 ÷ (缓存读取 + 缓存创建)',
    tipModels:  '本周期内使用的不同模型数量',
```

Also replace line 10:
```javascript
    lCache: '缓存命中', lCacheSub: '仅 claude code',
```

- [ ] **Step 4.2: Update en tip strings in `T.en` block**

Replace lines 48-51 in `public/app.js` with:

```javascript
    tipTokens:  'Total Tokens consumed by Claude + Codex in this period (input + output + cache creation + cache read)',
    tipCost:    'Combined Claude + Codex API cost for this period',
    tipCache:   'Claude Code only — cache_read ÷ (cache_read + cache_creation)',
    tipModels:  'Distinct models used in this period',
```

Also replace line 36:
```javascript
    lCache: 'CACHE HIT', lCacheSub: 'Claude Code only',
```

- [ ] **Step 4.3: Replace the stat-card hover handler**

Replace lines 365-376 in `public/app.js` with:

```javascript
// ── Stat-card tooltips: icon-triggered (Wave 1) ───────────────────────────
document.querySelectorAll('.stat-info-icon').forEach(icon => {
  const tipId = icon.dataset.tip;
  const tip = tipId && document.getElementById(tipId);
  if (!tip) return;
  icon.addEventListener('mouseenter', () => {
    const rect = icon.getBoundingClientRect();
    tip.style.top  = (rect.top - 8) + 'px';
    tip.style.left = (rect.left + rect.width / 2) + 'px';
    tip.style.display = 'block';
  });
  icon.addEventListener('mouseleave', () => { tip.style.display = ''; });
});
```

- [ ] **Step 4.4: Manual smoke test**

Run: `npm start`. In the browser:
- Hover over each `!` icon → tooltip appears with the new copy.
- Move cursor off the icon (but still on the card) → tooltip disappears.
- Hover anywhere on the card *except* the icon → no tooltip.
- Switch language to EN, repeat — English copy shows.

Kill the server: `lsof -ti:3333 | xargs kill -9`

- [ ] **Step 4.5: Commit**

```bash
git add public/app.js
git commit -m "feat(dashboard): icon-triggered stat tooltips with new copy"
```

---

### Task 5: Frontend JS — Cost card claude/codex split + Claude-only cache hit rate

**Files:**
- Modify: `public/app.js:151-164` (`renderStats`)

**Why:** User wants the Cost card sub-line to show "Claude Code: $X · Codex: $Y", and the Cache Hit card to compute `claudeCacheRead / (claudeCacheRead + cacheCreation)` instead of the current mixed-source ratio. Both consume the new fields added in Task 1.

- [ ] **Step 5.1: Replace `renderStats` body**

Replace lines 151-164 in `public/app.js` with:

```javascript
function renderStats(report) {
  const s = report.summary;
  document.getElementById('sTokens').textContent    = fmt(s.totalTokens);
  document.getElementById('sTokensSub').textContent =
    `${t('inSub')}:${fmt(s.inputTokens)} ${t('outSub')}:${fmt(s.outputTokens)}`;

  document.getElementById('sCost').textContent = fmtCost(s.totalCost);
  document.getElementById('lCostSub').textContent =
    `Claude Code: ${fmtCost(s.claudeCost || 0)} · Codex: ${fmtCost(s.codexCost || 0)}`;

  // Claude-only cache hit rate (Codex has no creation tokens, including it skews the ratio)
  const claudeRead   = s.claudeCacheReadTokens || 0;
  const claudeCreate = s.cacheCreationTokens || 0;  // already Claude-only in summary
  const claudeCacheTotal = claudeRead + claudeCreate;
  document.getElementById('sCache').textContent =
    claudeCacheTotal > 0 ? (claudeRead / claudeCacheTotal * 100).toFixed(1) + '%' : '—';

  document.getElementById('sModels').textContent     = report.models.length;
  document.getElementById('sModelNames').textContent =
    report.models.slice(0, 2).map(m => shortModel(m.name)).join(', ');
}
```

- [ ] **Step 5.2: Manual smoke test**

Run: `npm start`. In the browser:
- 总费用 card sub-line shows `Claude Code: $X · Codex: $Y` and the two add up to the displayed total.
- Switch period from 1d → 5h → 7d. The two values update on each switch.
- 缓存命中 card sub-line shows "仅 claude code". The percentage looks consistent with the previous (similar order of magnitude — Codex contribution should have been small unless your Codex usage was heavy).
- If summary fields are missing for any reason, the page does not crash (the `|| 0` fallbacks handle this).

Kill server.

- [ ] **Step 5.3: Commit**

```bash
git add public/app.js
git commit -m "feat(dashboard): split cost by source, Claude-only cache hit rate"
```

---

### Task 6: Frontend JS — Rename "模型分布" → "模型成本分布"

**Files:**
- Modify: `public/app.js:15` (zh `lModelChart`)
- Modify: `public/app.js:41` (en `lModelChart`)

**Why:** User clarifies the chart's semantic meaning is cost share, not model count.

- [ ] **Step 6.1: Update label strings**

Line 15:
```javascript
    lModelChart: '模型成本分布', lSessions: '会话列表', noSessions: '暂无会话',
```

Line 41:
```javascript
    lModelChart: 'Model Cost Distribution', lSessions: 'SESSIONS', noSessions: 'NO SESSIONS',
```

- [ ] **Step 6.2: Verify and commit**

Run: `npm start`, confirm the chart panel title reads "模型成本分布" in Chinese and "Model Cost Distribution" in English. Kill server.

```bash
git add public/app.js
git commit -m "feat(dashboard): rename model chart to '模型成本分布'"
```

---

### Task 7: Frontend JS — Token chart series-control tooltips on cache labels

**Files:**
- Modify: `public/app.js:184-216` (`renderTokenSeriesControls`)

**Why:** User wants hovering on the "Claude 缓存" / "Codex 缓存" toggle to show what each cache series actually contains. The Claude cache is `cache_creation + cache_read`; the Codex "cache" is actually `cached_input_tokens` (cache READ only — Codex has no creation field). Use the existing series-controls div (already custom HTML) — no need to touch Chart.js's internal legend.

- [ ] **Step 7.1: Add a tooltip metadata field to TOKEN_SERIES_META**

Replace lines 102-109 in `public/app.js` with:

```javascript
const TOKEN_SERIES_META = [
  { key: 'claudeIn',    labelKey: 'dsClaudeIn',    color: 'rgba(217,119,87,0.85)', tipKey: null,                  valueOf: r => r.claude?.inputTokens || 0 },
  { key: 'claudeOut',   labelKey: 'dsClaudeOut',   color: 'rgba(180,85,50,0.8)',   tipKey: null,                  valueOf: r => r.claude?.outputTokens || 0 },
  { key: 'claudeCache', labelKey: 'dsClaudeCache', color: 'rgba(217,119,87,0.3)',  tipKey: 'tipClaudeCacheSeries', valueOf: r => (r.claude?.cacheReadTokens || 0) + (r.claude?.cacheCreationTokens || 0) },
  { key: 'codexIn',     labelKey: 'dsCodexIn',     color: 'rgba(59,130,246,0.85)', tipKey: null,                  valueOf: r => r.codex?.inputTokens || 0 },
  { key: 'codexOut',    labelKey: 'dsCodexOut',    color: 'rgba(59,130,246,0.55)', tipKey: null,                  valueOf: r => r.codex?.outputTokens || 0 },
  { key: 'codexCache',  labelKey: 'dsCodexCache',  color: 'rgba(59,130,246,0.25)', tipKey: 'tipCodexCacheSeries', valueOf: r => r.codex?.cachedInputTokens || 0 }
];
```

- [ ] **Step 7.2: Add tooltip strings to i18n blocks**

In `T.zh` (around line 22-25), append after `tipModels`:
```javascript
    tipClaudeCacheSeries: '缓存创建 + 缓存读取',
    tipCodexCacheSeries:  '仅缓存读取（Codex 无缓存创建字段）',
```

In `T.en` (around line 48-51), append after `tipModels`:
```javascript
    tipClaudeCacheSeries: 'cache creation + cache read',
    tipCodexCacheSeries:  'cache read only (Codex has no creation field)',
```

- [ ] **Step 7.3: Render `title` attribute on series toggles**

Replace lines 184-194 in `public/app.js` with:

```javascript
function renderTokenSeriesControls() {
  const wrap = document.getElementById('tokenSeriesControls');
  if (!wrap || !tokenChart) return;
  wrap.innerHTML = tokenChart.data.datasets.map((ds, idx) => {
    const checked = ds.hidden ? '' : 'checked';
    const meta = TOKEN_SERIES_META[idx];
    const titleAttr = meta?.tipKey ? ` title="${t(meta.tipKey)}"` : '';
    return `<label class="series-toggle"${titleAttr}>
      <input type="checkbox" data-idx="${idx}" ${checked}>
      <span class="series-dot" style="background:${ds.backgroundColor}"></span>
      <span>${ds.label}</span>
    </label>`;
  }).join('');
```

(The closing brace and event listener block from line 196 onward remain unchanged.)

- [ ] **Step 7.4: Manual smoke test**

Run: `npm start`. Hover the "Claude 缓存" and "Codex 缓存" toggle pills above the Token chart — the native browser tooltip should display the explanation strings. Switch language and repeat.

Kill server.

- [ ] **Step 7.5: Commit**

```bash
git add public/app.js
git commit -m "feat(dashboard): tooltip explanations on cache series toggles"
```

---

### Task 8: Frontend (history.js) — Two trivial fixes

**Files:**
- Modify: `public/history.js` (button text)
- Modify: `public/history.js:483` (export filename regex)

**Why:** These are 1-line changes in stable code paths that won't conflict with Wave 2's history-tab restructuring. Bundling as a single task to keep the commit count manageable.

- [ ] **Step 8.1: Find the "展示操作记录" button text**

Run: `grep -n "操作记录" public/history.js`

You should find a line containing the literal `展示操作记录 (` or `展示操作记录(`. Replace `操作记录` with `工具调用记录` in that line. Also check for any English equivalent (`Show Tool Calls` etc.) — the project has light i18n, so update both if present.

- [ ] **Step 8.2: Relax the export filename regex**

Replace line 483 in `public/history.js`:

```javascript
  a.download = `${s.id.slice(0, 8)}-${s.title.slice(0, 30).replace(/[\\/:*?"<>|]+/g, '-')}.md`;
```

This change: the old regex `/[^\w\u4e00-\u9fff]/g` replaced anything that wasn't a word char or CJK ideograph. The new regex only replaces filesystem-illegal characters (Windows-safe set), preserving Chinese, spaces, hyphens, parentheses, etc.

- [ ] **Step 8.3: Manual smoke test**

Run: `npm start`. Open the History tab, pick any session:
- The button at the top right of the viewer reads "展示工具调用记录 (N)" instead of "展示操作记录 (N)".
- Click the "↓ Markdown" export button. Verify the downloaded filename contains the original Chinese title characters, spaces, and punctuation (other than `\/:*?"<>|` which are correctly replaced with `-`).

Kill server.

- [ ] **Step 8.4: Commit**

```bash
git add public/history.js
git commit -m "fix(history): button copy + preserve CJK/whitespace in export filename"
```

---

### Task 9: Final integration smoke test

**Files:** none modified — verification only.

- [ ] **Step 9.1: Run the full test suite**

```bash
npm test
```
Expected: all tests pass (existing chat-reader tests + new normalize tests + new project-stats tests).

- [ ] **Step 9.2: Boot server and walk the dashboard**

```bash
npm start
```

Open `http://localhost:3333` and verify everything end-to-end:

- [ ] All 4 stat cards show the `!` icon, hover-only tooltips with new copy.
- [ ] Cost card sub-line shows `Claude Code: $X · Codex: $Y`, sums to total.
- [ ] Cache Hit card sub-line reads "仅 claude code", percentage reasonable.
- [ ] Model chart panel reads "模型成本分布".
- [ ] Token chart cache toggles show native tooltip on hover.
- [ ] **Project Cost chart shows non-zero bars** (the main bug fix).
- [ ] Period selector (5h / 1d / 3d / 7d) all work without console errors.
- [ ] Switch to History tab; pick a session; button reads "展示工具调用记录 (N)"; export filename preserves CJK.
- [ ] Switch language EN ↔ ZH, all stat-card copy updates correctly.

If anything fails: STOP, do not create a final commit, fix the regression, and re-run this checklist.

Kill the server: `lsof -ti:3333 | xargs kill -9`

- [ ] **Step 9.3: Final review of git log**

```bash
git log --oneline main..HEAD
```
Expected: 8 commits (one per task that produced changes).

---

## Self-Review Notes

**Spec coverage check (against original Wave 1 list from the discussion):**

| Wave 1 item | Task |
|---|---|
| 统计卡片 icon 替代悬停 | Task 3 + 4 |
| 总Token / 总费用 文案修改 | Task 4 |
| 总费用拆分 claude/codex 显示 | Task 1 (backend) + Task 5 (frontend) |
| 缓存命中率仅算 Claude + 文案改"仅 claude code" | Task 1 (backend field) + Task 3 (sub label) + Task 5 (formula) |
| Token 分布图 legend tooltip | Task 7 |
| 模型分布图改名"模型成本分布" | Task 6 |
| 项目成本分布图通过 ccusage 推算费用 | Task 2 |
| 会话详情按钮文案改"展示工具调用记录" | Task 8 |
| 导出文件名不过滤特殊字符 | Task 8 |

All Wave 1 items covered.

**Type consistency check:** `claudeCost`, `codexCost`, `claudeCacheReadTokens` are introduced in Task 1 and consumed by Task 5. `_setCcusageRunnerForTests` is exported in Task 2.3 and consumed by Task 2.1's tests. `tipClaudeCacheSeries`/`tipCodexCacheSeries` keys introduced in Task 7.2 and consumed in 7.3. All consistent.

**Open risks for the implementer:**

1. **Task 2 ccusage behavior on the user's data**: We confirmed the shape via a manual run, but the user's data has a quirk — top-level Token Dashboard sessions have `projectPath: "Unknown Project"` and `sessionId` *equal to* the encoded dir name. The fallback code handles this because `sessionId` is the primary lookup key. If the implementer's smoke test (Step 2.6) shows zero costs, the most likely cause is a different ccusage version with renamed fields — investigate the JSON output before patching.

2. **Task 2.3 `PROJECTS_DIR` refactor**: `grep -n PROJECTS_DIR readers/chat-reader.js` first to make sure every reference is replaced. Missing one will cause silent test fallthrough to the real `~/.claude/projects/` dir.

3. **Task 8.1**: The exact wording "展示操作记录" needs to be confirmed by grep. If the codebase uses a slightly different string (e.g. without space, or wrapped in template literal), match the grep result exactly.
