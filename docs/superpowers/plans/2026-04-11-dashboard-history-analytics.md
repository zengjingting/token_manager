# Dashboard History Browser + Enhanced Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a left-sidebar navigation shell, a History tab (session browser + search + Markdown export), and enhanced analytics (activity heatmap + project cost breakdown + billing window gauge) to the existing Token Dashboard.

**Architecture:** Single-page restructure — `index.html` becomes a shell with sidebar nav; CSS and JS split into `style.css`, `app.js` (dashboard), `history.js` (history tab). A new `readers/chat-reader.js` reads `~/.claude/projects/` JSONL files directly. Five new Express routes expose the data. No new npm dependencies.

**Tech Stack:** Node.js 22, Express 4, vanilla JS (non-module `<script>` tags for frontend), Chart.js 4 (CDN, already loaded), `node:test` + `node:assert` (built-in) for unit tests.

**Spec:** `docs/superpowers/specs/2026-04-11-dashboard-history-analytics-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `readers/chat-reader.js` | **Create** | Read `~/.claude/projects/` JSONL: list sessions, read messages, search, project stats, daily activity |
| `tests/chat-reader.test.js` | **Create** | Unit tests for `chat-reader.js` using fixture JSONL files |
| `server.js` | **Modify** | Add 5 new routes: `/api/history/sessions`, `/api/history/session`, `/api/search`, `/api/analytics/heatmap`, `/api/analytics/projects` |
| `public/style.css` | **Create** | All styles extracted from `index.html` + new sidebar / analytics / history styles |
| `public/app.js` | **Create** | Dashboard JS extracted from `index.html` + analytics view toggle logic |
| `public/history.js` | **Create** | History tab: session list, conversation viewer, search, Markdown export |
| `public/index.html` | **Modify** | Replace inline `<style>` + `<script>` with file references; add sidebar + view containers |
| `package.json` | **Modify** | Add `"test"` script |

---

## Task 1: Create `readers/chat-reader.js` (TDD)

**Files:**
- Create: `readers/chat-reader.js`
- Create: `tests/chat-reader.test.js`
- Modify: `package.json`

- [ ] **Step 1.1 — Add test script to `package.json`**

  Open `package.json` and add `"test"` to `scripts`:

  ```json
  {
    "name": "token-dashboard",
    "version": "1.0.0",
    "type": "module",
    "scripts": {
      "prestart": "lsof -ti:3333 | xargs kill -9 2>/dev/null || true",
      "start": "node server.js",
      "predev": "lsof -ti:3333 | xargs kill -9 2>/dev/null || true",
      "dev": "node --watch server.js",
      "test": "node --test tests/chat-reader.test.js"
    },
    "dependencies": {
      "express": "^4.19.2"
    }
  }
  ```

- [ ] **Step 1.2 — Write the failing tests first**

  Create `tests/chat-reader.test.js`:

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
  import { join } from 'node:path';
  import { tmpdir } from 'node:os';

  // We will import these after the file is created
  import { parseSessionFile, listSessions, searchSessions } from '../readers/chat-reader.js';

  // ── Fixtures ──────────────────────────────────────────────────────────────
  const FIXTURE_SESSION = [
    JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 'test123' }),
    // isMeta user — should be excluded
    JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: '<system-reminder>ignore</system-reminder>' }, timestamp: '2026-04-11T09:59:00.000Z', uuid: 'u0', parentUuid: null, sessionId: 'test123' }),
    // real user message
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'How do I write a for loop in Python?' }, timestamp: '2026-04-11T10:00:00.000Z', uuid: 'u1', parentUuid: null, sessionId: 'test123' }),
    // assistant text reply
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant', model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Here is a for loop example: `for i in range(10): print(i)`' }],
        usage: { input_tokens: 50, output_tokens: 30, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 }
      },
      costUSD: 0.001,
      timestamp: '2026-04-11T10:00:05.000Z', uuid: 'u2', parentUuid: 'u1', sessionId: 'test123'
    }),
    // assistant tool_use
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant', model: 'claude-sonnet-4-6',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'python3 -c "for i in range(3): print(i)"', description: 'Test the loop' } }],
        usage: { input_tokens: 20, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      },
      costUSD: 0.0005,
      timestamp: '2026-04-11T10:00:10.000Z', uuid: 'u3', parentUuid: 'u2', sessionId: 'test123'
    }),
    // user tool_result
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '0\n1\n2' }] },
      timestamp: '2026-04-11T10:00:11.000Z', uuid: 'u4', parentUuid: 'u3', sessionId: 'test123'
    }),
  ].join('\n');

  // ── Helpers ───────────────────────────────────────────────────────────────
  let tmpDir;

  function setup() {
    tmpDir = join(tmpdir(), `chat-reader-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'test123.jsonl'), FIXTURE_SESSION, 'utf-8');
    return tmpDir;
  }

  function teardown() {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }

  // ── Tests ─────────────────────────────────────────────────────────────────

  test('parseSessionFile: returns messages array', () => {
    const dir = setup();
    try {
      const result = parseSessionFile(join(dir, 'test123.jsonl'));
      assert.ok(Array.isArray(result.messages), 'messages should be an array');
    } finally { teardown(); }
  });

  test('parseSessionFile: extracts user text message, skips isMeta', () => {
    const dir = setup();
    try {
      const { messages } = parseSessionFile(join(dir, 'test123.jsonl'));
      const userTexts = messages.filter(m => m.role === 'user' && m.type === 'text');
      assert.equal(userTexts.length, 1);
      assert.match(userTexts[0].content, /for loop in Python/);
    } finally { teardown(); }
  });

  test('parseSessionFile: extracts assistant text message', () => {
    const dir = setup();
    try {
      const { messages } = parseSessionFile(join(dir, 'test123.jsonl'));
      const assistantTexts = messages.filter(m => m.role === 'assistant' && m.type === 'text');
      assert.equal(assistantTexts.length, 1);
      assert.match(assistantTexts[0].content, /for loop example/);
    } finally { teardown(); }
  });

  test('parseSessionFile: extracts tool_use with name and input', () => {
    const dir = setup();
    try {
      const { messages } = parseSessionFile(join(dir, 'test123.jsonl'));
      const toolUse = messages.find(m => m.type === 'tool_use');
      assert.ok(toolUse, 'should have a tool_use message');
      assert.equal(toolUse.name, 'Bash');
      assert.equal(toolUse.input.command, 'python3 -c "for i in range(3): print(i)"');
    } finally { teardown(); }
  });

  test('parseSessionFile: extracts tool_result with content and tool name', () => {
    const dir = setup();
    try {
      const { messages } = parseSessionFile(join(dir, 'test123.jsonl'));
      const toolResult = messages.find(m => m.type === 'tool_result');
      assert.ok(toolResult, 'should have a tool_result message');
      assert.equal(toolResult.content, '0\n1\n2');
      assert.equal(toolResult.name, 'Bash');  // looked up from preceding tool_use
    } finally { teardown(); }
  });

  test('parseSessionFile: sums token counts correctly', () => {
    const dir = setup();
    try {
      const { inputTokens, outputTokens, cacheTokens } = parseSessionFile(join(dir, 'test123.jsonl'));
      assert.equal(inputTokens, 70);   // 50 + 20
      assert.equal(outputTokens, 40);  // 30 + 10
      assert.equal(cacheTokens, 300);  // 100 + 200 (cache creation + read)
    } finally { teardown(); }
  });

  test('parseSessionFile: sums cost correctly', () => {
    const dir = setup();
    try {
      const { totalCost } = parseSessionFile(join(dir, 'test123.jsonl'));
      assert.ok(Math.abs(totalCost - 0.0015) < 0.00001, `expected ~0.0015 got ${totalCost}`);
    } finally { teardown(); }
  });

  test('parseSessionFile: extracts model', () => {
    const dir = setup();
    try {
      const { models } = parseSessionFile(join(dir, 'test123.jsonl'));
      assert.deepEqual(models, ['claude-sonnet-4-6']);
    } finally { teardown(); }
  });

  test('parseSessionFile: sets lastActivity to latest timestamp', () => {
    const dir = setup();
    try {
      const { lastActivity } = parseSessionFile(join(dir, 'test123.jsonl'));
      assert.equal(lastActivity, '2026-04-11T10:00:11.000Z');
    } finally { teardown(); }
  });

  test('parseSessionFile: handles malformed lines without throwing', () => {
    const dir = setup();
    const badContent = 'valid json line\n{broken json\n' + FIXTURE_SESSION;
    writeFileSync(join(dir, 'bad.jsonl'), badContent, 'utf-8');
    try {
      assert.doesNotThrow(() => parseSessionFile(join(dir, 'bad.jsonl')));
    } finally { teardown(); }
  });
  ```

- [ ] **Step 1.3 — Run tests and confirm they all fail**

  ```bash
  npm test
  ```

  Expected output: all 10 tests FAIL with `Cannot find module '../readers/chat-reader.js'`

- [ ] **Step 1.4 — Create `readers/chat-reader.js`**

  ```js
  // readers/chat-reader.js
  import { readFileSync, readdirSync, existsSync } from 'node:fs';
  import { join } from 'node:path';
  import { homedir } from 'node:os';

  const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

  // ── Helpers ───────────────────────────────────────────────────────────────

  function parseLine(line) {
    if (!line.trim()) return null;
    try { return JSON.parse(line); } catch { return null; }
  }

  const SKIP_PATH_SEGMENTS = new Set([
    'users', 'home', 'root', 'documents', 'desktop',
    'downloads', 'applications', 'opt', 'usr', 'local'
  ]);

  /**
   * Convert encoded project dir name to human-readable project name.
   * e.g. "-Users-ting-Documents-Token-dashboard" → "Token-dashboard"
   */
  function decodeDirName(dirName) {
    const parts = dirName.replace(/^-/, '').split('-').filter(Boolean);
    // Skip /Users/<username> or /home/<username> prefix
    let i = 0;
    if (i < parts.length && ['users', 'home', 'root'].includes(parts[i].toLowerCase())) {
      i += 2; // skip e.g. 'Users', 'ting'
    }
    // Skip common parent dirs like Documents, Desktop, etc.
    while (i < parts.length - 1 && SKIP_PATH_SEGMENTS.has(parts[i].toLowerCase())) {
      i++;
    }
    const result = parts.slice(i).join('-');
    return result || dirName;
  }

  /**
   * Extract session title: first meaningful user text message, ≤80 chars.
   */
  function extractTitle(messages) {
    for (const msg of messages) {
      if (msg.role === 'user' && msg.type === 'text' && msg.content?.trim().length > 5) {
        return msg.content.trim().slice(0, 80);
      }
    }
    return 'Untitled';
  }

  // ── Core parser ───────────────────────────────────────────────────────────

  /**
   * Parse one JSONL session file. Returns structured messages + token/cost totals.
   */
  export function parseSessionFile(filePath) {
    const lines = readFileSync(filePath, 'utf-8').split('\n');
    const messages = [];
    const toolNameById = {};          // toolId → tool name for result lookup
    let inputTokens = 0, outputTokens = 0, cacheTokens = 0, totalCost = 0;
    const modelsSet = new Set();
    let lastActivity = null;

    for (const line of lines) {
      const entry = parseLine(line);
      if (!entry) continue;
      if (entry.isMeta) continue;     // skip system meta entries

      const ts = entry.timestamp;
      if (ts && (!lastActivity || ts > lastActivity)) lastActivity = ts;

      // ── Assistant entries ──────────────────────────────────────────────
      if (entry.type === 'assistant' && entry.message) {
        const msg = entry.message;
        const model = msg.model;
        if (model && model !== '<synthetic>') modelsSet.add(model);

        const usage = msg.usage || {};
        inputTokens  += usage.input_tokens || 0;
        outputTokens += usage.output_tokens || 0;
        cacheTokens  += (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
        totalCost    += entry.costUSD || 0;

        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text?.trim()) {
              messages.push({ role: 'assistant', type: 'text', content: block.text });
            } else if (block.type === 'tool_use') {
              toolNameById[block.id] = block.name;
              messages.push({
                role: 'assistant', type: 'tool_use',
                toolId: block.id, name: block.name,
                input: block.input || {}
              });
            }
            // skip 'thinking' blocks — internal reasoning not useful to display
          }
        }
      }

      // ── User entries ───────────────────────────────────────────────────
      if (entry.type === 'user' && entry.message) {
        const content = entry.message.content;

        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              const text = typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
                  : '';
              messages.push({
                role: 'user', type: 'tool_result',
                toolId: block.tool_use_id,
                name: toolNameById[block.tool_use_id] || 'Tool',
                content: text
              });
            } else if (block.type === 'text' && block.text) {
              const cleaned = block.text.replace(/<[^>]+>/g, '').trim();
              if (cleaned) messages.push({ role: 'user', type: 'text', content: cleaned });
            }
          }
        } else if (typeof content === 'string') {
          const cleaned = content.replace(/<[^>]+>/g, '').trim();
          if (cleaned) messages.push({ role: 'user', type: 'text', content: cleaned });
        }
      }
    }

    return {
      messages,
      inputTokens, outputTokens, cacheTokens, totalCost,
      models: [...modelsSet],
      lastActivity
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * List all sessions grouped by project, sorted by most recent activity.
   * Returns: { projects: [{ dirName, name, sessions: [...] }] }
   */
  export function listSessions() {
    if (!existsSync(PROJECTS_DIR)) return { projects: [] };

    const dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());
    const projects = [];

    for (const dir of dirs) {
      const dirPath = join(PROJECTS_DIR, dir.name);
      let files;
      try { files = readdirSync(dirPath).filter(f => f.endsWith('.jsonl')); }
      catch { continue; }
      if (!files.length) continue;

      const sessions = [];
      for (const file of files) {
        const sessionId = file.replace('.jsonl', '');
        try {
          const { messages, inputTokens, outputTokens, cacheTokens, totalCost, models, lastActivity } =
            parseSessionFile(join(dirPath, file));
          sessions.push({
            id: sessionId,
            projectDir: dir.name,
            title: extractTitle(messages),
            lastActivity: lastActivity || new Date(0).toISOString(),
            messageCount: messages.length,
            inputTokens, outputTokens, cacheTokens, totalCost, models
          });
        } catch { continue; }
      }

      sessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
      projects.push({ dirName: dir.name, name: decodeDirName(dir.name), sessions });
    }

    projects.sort((a, b) => {
      const aLast = a.sessions[0]?.lastActivity || '';
      const bLast = b.sessions[0]?.lastActivity || '';
      return bLast.localeCompare(aLast);
    });

    return { projects };
  }

  /**
   * Read full message list for one session.
   * Returns null if file not found.
   */
  export function readSession(projectDir, sessionId) {
    const filePath = join(PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);
    if (!existsSync(filePath)) return null;
    const { messages, inputTokens, outputTokens, cacheTokens, totalCost, models, lastActivity } =
      parseSessionFile(filePath);
    return {
      id: sessionId,
      projectDir,
      title: extractTitle(messages),
      messages,
      inputTokens, outputTokens, cacheTokens, totalCost, models,
      lastActivity: lastActivity || new Date(0).toISOString()
    };
  }

  /**
   * Full-text search across all sessions.
   * Returns up to 3 snippets per matching session.
   */
  export function searchSessions(query) {
    if (!query?.trim()) return { query: query || '', results: [] };
    if (!existsSync(PROJECTS_DIR)) return { query, results: [] };

    const q = query.trim().toLowerCase();
    const results = [];

    const dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of dirs) {
      const dirPath = join(PROJECTS_DIR, dir.name);
      let files;
      try { files = readdirSync(dirPath).filter(f => f.endsWith('.jsonl')); }
      catch { continue; }

      for (const file of files) {
        const sessionId = file.replace('.jsonl', '');
        try {
          const { messages, lastActivity } = parseSessionFile(join(dirPath, file));
          const snippets = [];
          for (const msg of messages) {
            if (msg.type !== 'text' || !msg.content) continue;
            const lower = msg.content.toLowerCase();
            const idx = lower.indexOf(q);
            if (idx === -1) continue;
            const start = Math.max(0, idx - 40);
            const end = Math.min(msg.content.length, idx + q.length + 40);
            snippets.push(msg.content.slice(start, end).replace(/\n+/g, ' '));
            if (snippets.length >= 3) break;
          }
          if (snippets.length > 0) {
            results.push({
              id: sessionId,
              projectDir: dir.name,
              projectName: decodeDirName(dir.name),
              title: extractTitle(messages),
              lastActivity: lastActivity || '',
              snippets
            });
          }
        } catch { continue; }
      }
    }

    results.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    return { query, results };
  }

  /**
   * Per-project token and cost totals, sorted by cost descending.
   */
  export function getProjectStats() {
    if (!existsSync(PROJECTS_DIR)) return [];

    const dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());
    const stats = [];

    for (const dir of dirs) {
      const dirPath = join(PROJECTS_DIR, dir.name);
      let files;
      try { files = readdirSync(dirPath).filter(f => f.endsWith('.jsonl')); }
      catch { continue; }

      let inputTokens = 0, outputTokens = 0, cacheTokens = 0, totalCost = 0;
      for (const file of files) {
        try {
          const r = parseSessionFile(join(dirPath, file));
          inputTokens  += r.inputTokens;
          outputTokens += r.outputTokens;
          cacheTokens  += r.cacheTokens;
          totalCost    += r.totalCost;
        } catch { continue; }
      }

      if (inputTokens + outputTokens > 0) {
        stats.push({
          name: decodeDirName(dir.name),
          dirName: dir.name,
          inputTokens, outputTokens, cacheTokens, totalCost,
          sessionCount: files.length
        });
      }
    }

    return stats.sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * Daily token/cost totals for the heatmap. sinceMs = epoch milliseconds.
   * Scans all JSONL files; uses entry.timestamp for date grouping.
   */
  export function getDailyActivity(sinceMs) {
    if (!existsSync(PROJECTS_DIR)) return [];

    const byDate = {};
    const dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of dirs) {
      const dirPath = join(PROJECTS_DIR, dir.name);
      let files;
      try { files = readdirSync(dirPath).filter(f => f.endsWith('.jsonl')); }
      catch { continue; }

      for (const file of files) {
        try {
          const lines = readFileSync(join(dirPath, file), 'utf-8').split('\n');
          for (const line of lines) {
            const entry = parseLine(line);
            if (!entry || entry.type !== 'assistant' || !entry.timestamp) continue;
            const ts = new Date(entry.timestamp).getTime();
            if (ts < sinceMs) continue;

            const date = entry.timestamp.slice(0, 10);
            if (!byDate[date]) byDate[date] = { date, tokens: 0, cost: 0 };

            const usage = entry.message?.usage || {};
            byDate[date].tokens +=
              (usage.input_tokens || 0) + (usage.output_tokens || 0) +
              (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
            byDate[date].cost += entry.costUSD || 0;
          }
        } catch { continue; }
      }
    }

    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }
  ```

- [ ] **Step 1.5 — Run tests and confirm they all pass**

  ```bash
  npm test
  ```

  Expected output: `▶ 10 tests passed`

- [ ] **Step 1.6 — Commit**

  ```bash
  git add readers/chat-reader.js tests/chat-reader.test.js package.json
  git commit -m "feat: add chat-reader.js with unit tests — JSONL session parser for history browser"
  ```

---

## Task 2: Add new API routes to `server.js`

**Files:**
- Modify: `server.js`

- [ ] **Step 2.1 — Add imports at the top of `server.js`**

  After the existing imports (after line 8), add:

  ```js
  import { listSessions, readSession, searchSessions, getProjectStats, getDailyActivity } from './readers/chat-reader.js';
  ```

- [ ] **Step 2.2 — Add 5 new routes before the `app.listen` call**

  Add before the `app.listen(...)` line:

  ```js
  // ── History: list all sessions grouped by project ──────────────────────────
  app.get('/api/history/sessions', (_req, res) => {
    try {
      res.json(listSessions());
    } catch (err) {
      console.error('[/api/history/sessions]', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ── History: full message list for one session ─────────────────────────────
  // Query params: project (dirName), id (sessionId)
  app.get('/api/history/session', (req, res) => {
    const { project, id } = req.query;
    // Basic path traversal guard: reject if either param contains '..' or '/'
    if (!project || !id || /[./\\]/.test(project) || /[./\\]/.test(id)) {
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }
    try {
      const session = readSession(project, id);
      if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
      res.json(session);
    } catch (err) {
      console.error('[/api/history/session]', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ── Search: full-text search across all sessions ───────────────────────────
  app.get('/api/search', (req, res) => {
    const q = (req.query.q || '').slice(0, 200); // cap query length
    try {
      res.json(searchSessions(q));
    } catch (err) {
      console.error('[/api/search]', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ── Analytics: 90-day activity heatmap ────────────────────────────────────
  app.get('/api/analytics/heatmap', (_req, res) => {
    try {
      const sinceMs = Date.now() - 90 * 86_400_000;
      res.json({ days: getDailyActivity(sinceMs) });
    } catch (err) {
      console.error('[/api/analytics/heatmap]', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ── Analytics: per-project cost breakdown ─────────────────────────────────
  app.get('/api/analytics/projects', (_req, res) => {
    try {
      res.json({ projects: getProjectStats() });
    } catch (err) {
      console.error('[/api/analytics/projects]', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });
  ```

- [ ] **Step 2.3 — Verify endpoints manually**

  ```bash
  npm start &
  sleep 2
  curl -s http://localhost:3333/api/history/sessions | python3 -m json.tool | head -30
  curl -s "http://localhost:3333/api/search?q=test" | python3 -m json.tool | head -10
  curl -s http://localhost:3333/api/analytics/heatmap | python3 -m json.tool | head -20
  curl -s http://localhost:3333/api/analytics/projects | python3 -m json.tool | head -20
  ```

  Expected: valid JSON, no 500 errors, at least one project in `/api/history/sessions`, days array in heatmap.

- [ ] **Step 2.4 — Commit**

  ```bash
  git add server.js
  git commit -m "feat: add history, search, analytics API routes"
  ```

---

## Task 3: Extract `style.css` and `app.js` from `index.html`

**Files:**
- Create: `public/style.css`
- Create: `public/app.js`
- Modify: `public/index.html`

- [ ] **Step 3.1 — Create `public/style.css`**

  Copy everything between the existing `<style>` tags in `index.html` (lines 8–178) into `public/style.css`. Do not include the `<style>` or `</style>` tags.

- [ ] **Step 3.2 — Create `public/app.js`**

  Copy everything between the existing `<script>` tags in `index.html` (lines 281–635) into `public/app.js`. Do not include the `<script>` or `</script>` tags.

- [ ] **Step 3.3 — Update `public/index.html`**

  Replace the existing `<style>` block and `<script>` block with file references. The `<head>` section should become:

  ```html
  <!DOCTYPE html>
  <html lang="zh">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Token Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
    <link rel="stylesheet" href="style.css">
  </head>
  ```

  And just before `</body>` replace the `<script>` block with:

  ```html
  <script src="app.js"></script>
  <script src="history.js"></script>
  </body>
  </html>
  ```

- [ ] **Step 3.4 — Verify dashboard still works**

  ```bash
  npm start
  ```

  Open `http://localhost:3333` in a browser. The existing dashboard should look and work exactly as before. Check: stats load, charts render, period switching works, language toggle works.

- [ ] **Step 3.5 — Commit**

  ```bash
  git add public/style.css public/app.js public/index.html
  git commit -m "refactor: extract CSS and JS from index.html into separate files"
  ```

---

## Task 4: Sidebar navigation layout

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`
- Modify: `public/app.js`

- [ ] **Step 4.1 — Add sidebar CSS to `style.css`**

  Append to the end of `public/style.css`:

  ```css
  /* ── App shell ── */
  body { overflow: hidden; }
  .app { display: flex; height: 100vh; }

  /* ── Sidebar ── */
  .sidebar {
    width: 168px; min-width: 168px;
    background: var(--panel); border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
    padding: 0;
  }
  .sidebar-brand {
    color: var(--orange); font-size: 14px; font-weight: 700;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--border-light);
  }
  .sidebar-nav { padding: 8px 0; flex: 1; }
  .nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 16px; width: 100%;
    background: none; border: none; cursor: pointer;
    color: var(--text-dim); font-family: var(--font); font-size: 12px;
    text-align: left; transition: all 0.15s; white-space: nowrap;
  }
  .nav-item:hover { background: var(--orange-faint); color: var(--text); }
  .nav-item.active { background: var(--orange-faint); color: var(--orange); font-weight: 600; }
  .nav-icon { font-size: 15px; width: 18px; text-align: center; }
  .sidebar-footer {
    padding: 10px 16px; border-top: 1px solid var(--border-light);
  }
  .sidebar-status { color: var(--text-dimmer); font-size: 10px; font-family: var(--font-mono); margin-bottom: 6px; }
  .sidebar-lang { display: flex; gap: 6px; }

  /* ── Main content ── */
  .main-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-width: 0; }
  .context-bar {
    display: flex; align-items: center; gap: 6px;
    padding: 10px 24px; background: var(--panel);
    border-bottom: 1px solid var(--border); flex-wrap: wrap;
    flex-shrink: 0;
  }
  .context-bar.hidden { display: none; }
  .view-content { flex: 1; overflow-y: auto; }
  .view-pane { display: none; }
  .view-pane.active { display: block; }
  ```

- [ ] **Step 4.2 — Restructure `public/index.html` body**

  Replace the entire `<body>` content (everything between `<body>` and the `<script src=...>` tags) with:

  ```html
  <body>

  <div id="loadingOverlay">
    <div class="spinner"></div>
    <div class="overlay-text" id="overlayText">加载中...</div>
  </div>

  <div class="app">

    <!-- ── Sidebar ── -->
    <nav class="sidebar">
      <div class="sidebar-brand" id="hTitle">▸ Token</div>
      <div class="sidebar-nav">
        <button class="nav-item active" data-view="dashboard" id="navDashboard">
          <span class="nav-icon">⊞</span>
          <span class="nav-label" id="navLabelDashboard">仪表盘</span>
        </button>
        <button class="nav-item" data-view="history" id="navHistory">
          <span class="nav-icon">≡</span>
          <span class="nav-label" id="navLabelHistory">会话历史</span>
        </button>
      </div>
      <div class="sidebar-footer">
        <div class="sidebar-status" id="status">连接中...</div>
        <div class="sidebar-lang">
          <button class="lang-btn active" id="langZh" onclick="setLang('zh')">中文</button>
          <button class="lang-btn"        id="langEn" onclick="setLang('en')">EN</button>
        </div>
      </div>
    </nav>

    <!-- ── Main content ── -->
    <div class="main-content">

      <!-- Period bar (dashboard only) -->
      <div class="context-bar" id="contextBarDashboard">
        <button class="period-btn"        data-period="5h"     id="pb-5h">5小时</button>
        <button class="period-btn active" data-period="1d"     id="pb-1d">今日</button>
        <button class="period-btn"        data-period="3d"     id="pb-3d">3天</button>
        <button class="period-btn"        data-period="7d"     id="pb-7d">7天</button>
        <button class="period-btn"        data-period="custom" id="pb-custom">自定义</button>
        <div class="custom-range" id="customRange">
          <input type="date" id="sinceInput">
          <span style="color:var(--text-dim)">→</span>
          <input type="date" id="untilInput">
          <button id="applyCustom">应用</button>
        </div>
        <!-- Analytics view toggle -->
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="period-btn active" id="dashViewOverview" onclick="setDashView('overview')">概览</button>
          <button class="period-btn"        id="dashViewAnalytics" onclick="setDashView('analytics')">深度分析</button>
        </div>
      </div>

      <!-- History search bar (history tab only) -->
      <div class="context-bar hidden" id="contextBarHistory">
        <input type="text" id="historySearch" placeholder="搜索会话内容..." style="flex:1;max-width:400px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 10px;font-family:var(--font);font-size:12px;border-radius:6px;">
        <button class="period-btn" id="historySearchBtn">搜索</button>
        <button class="period-btn" id="historyClearBtn" style="display:none">× 清除</button>
      </div>

      <!-- Views -->
      <div class="view-content">

        <!-- Dashboard view -->
        <div class="view-pane active" id="view-dashboard">
          <div class="main" id="dashboardOverview">

            <div class="stats-row">
              <div class="stat-card">
                <div class="stat-tip" id="tipTokens"></div>
                <div class="stat-label" id="lTokens">总 Token</div>
                <div class="stat-value" id="sTokens">—</div>
                <div class="stat-sub"  id="sTokensSub"></div>
              </div>
              <div class="stat-card">
                <div class="stat-tip" id="tipCost"></div>
                <div class="stat-label" id="lCost">总费用</div>
                <div class="stat-value" id="sCost">—</div>
                <div class="stat-sub" id="lCostSub">USD</div>
              </div>
              <div class="stat-card">
                <div class="stat-tip" id="tipCache"></div>
                <div class="stat-label" id="lCache">缓存命中</div>
                <div class="stat-value" id="sCache">—</div>
                <div class="stat-sub" id="lCacheSub">读取 / (读取 + 创建)</div>
              </div>
              <div class="stat-card">
                <div class="stat-tip" id="tipModels"></div>
                <div class="stat-label" id="lModels">模型数</div>
                <div class="stat-value" id="sModels">—</div>
                <div class="stat-sub"  id="sModelNames"></div>
              </div>
            </div>

            <div class="charts-row">
              <div class="chart-panel" id="tokenChartPanel">
                <div class="panel-title" id="lTokenChart">每日 Token 分布</div>
                <div class="series-title" id="lSeriesCtrl">可见项</div>
                <div class="series-controls" id="tokenSeriesControls"></div>
                <div class="chart-wrap"><canvas id="tokenChart"></canvas></div>
              </div>
              <div class="chart-panel">
                <div class="panel-title" id="lModelChart">模型分布</div>
                <div class="chart-wrap"><canvas id="modelChart"></canvas></div>
              </div>
            </div>

            <div class="session-panel">
              <div class="session-header">
                <span class="panel-title" id="lSessions" style="margin:0;border:none;padding:0">会话列表</span>
              </div>
              <div class="session-scroll">
                <table>
                  <thead><tr>
                    <th id="thSrc">来源</th>
                    <th id="thSession">会话</th>
                    <th id="thTokens">TOKEN</th>
                    <th id="thIn">输入</th>
                    <th id="thOut">输出</th>
                    <th id="thCache">缓存</th>
                    <th id="thCost">费用</th>
                    <th id="thActivity">最后活动</th>
                    <th id="thModels">模型</th>
                  </tr></thead>
                  <tbody id="sessionBody">
                    <tr><td colspan="9" class="placeholder">加载中...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

          </div><!-- /dashboardOverview -->

          <!-- Analytics view (hidden by default) -->
          <div class="main" id="dashboardAnalytics" style="display:none">
            <div class="chart-panel" style="margin-bottom:14px">
              <div class="panel-title" id="lHeatmap">近90天活动热力图</div>
              <div id="heatmapContainer" style="overflow-x:auto"></div>
            </div>
            <div class="charts-row">
              <div class="chart-panel">
                <div class="panel-title" id="lProjectChart">项目成本分布</div>
                <div class="chart-wrap" style="height:300px"><canvas id="projectChart"></canvas></div>
              </div>
              <div class="chart-panel">
                <div class="panel-title" id="lBillingWindow">当前计费窗口 (5h)</div>
                <div id="billingWindowPanel" style="padding:8px 0"></div>
              </div>
            </div>
          </div><!-- /dashboardAnalytics -->

        </div><!-- /view-dashboard -->

        <!-- History view -->
        <div class="view-pane" id="view-history">
          <div class="history-layout">
            <div class="history-sidebar" id="historySidebar">
              <div class="history-list" id="historyList">
                <div class="placeholder" style="padding:24px">加载中...</div>
              </div>
            </div>
            <div class="history-viewer" id="historyViewer">
              <div class="placeholder" style="padding:48px;text-align:center">← 从左侧选择一个会话</div>
            </div>
          </div>
        </div><!-- /view-history -->

      </div><!-- /view-content -->
    </div><!-- /main-content -->
  </div><!-- /app -->
  ```

- [ ] **Step 4.3 — Add sidebar navigation switching to `app.js`**

  Append to the end of `public/app.js`:

  ```js
  // ── Sidebar navigation ─────────────────────────────────────────────────────
  function switchView(viewName) {
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

  // Update i18n for new elements
  const _origApplyStaticLabels = applyStaticLabels;
  function applyStaticLabels() {
    _origApplyStaticLabels();
    const L = T[lang];
    if (L.navDashboard) document.getElementById('navLabelDashboard').textContent = L.navDashboard;
    if (L.navHistory)   document.getElementById('navLabelHistory').textContent   = L.navHistory;
    if (L.dashOverview)  document.getElementById('dashViewOverview').textContent  = L.dashOverview;
    if (L.dashAnalytics) document.getElementById('dashViewAnalytics').textContent = L.dashAnalytics;
  }
  ```

  Also add the new i18n keys to the `T` object at the top of `app.js`. In the `zh` block add:
  ```js
  navDashboard: '仪表盘', navHistory: '会话历史',
  dashOverview: '概览', dashAnalytics: '深度分析',
  lHeatmap: '近90天活动热力图', lProjectChart: '项目成本分布',
  lBillingWindow: '当前计费窗口 (5h)',
  ```
  In the `en` block add:
  ```js
  navDashboard: 'Dashboard', navHistory: 'History',
  dashOverview: 'Overview', dashAnalytics: 'Analytics',
  lHeatmap: '90-Day Activity Heatmap', lProjectChart: 'Project Cost Breakdown',
  lBillingWindow: 'Current Billing Window (5h)',
  ```

- [ ] **Step 4.4 — Add history layout CSS to `style.css`**

  Append to `public/style.css`:

  ```css
  /* ── History tab layout ── */
  .history-layout {
    display: grid;
    grid-template-columns: 260px 1fr;
    height: 100%;
    overflow: hidden;
  }
  .history-sidebar {
    border-right: 1px solid var(--border);
    overflow-y: auto;
    background: var(--panel);
  }
  .history-viewer {
    overflow-y: auto;
    background: var(--bg);
    padding: 20px 24px;
  }
  .history-layout { height: calc(100vh - 45px); } /* subtract context-bar */
  ```

- [ ] **Step 4.5 — Verify layout**

  Start the server and open `http://localhost:3333`. Verify:
  - Left sidebar visible with "仪表盘" and "会话历史" nav items
  - Clicking "仪表盘" shows period bar + existing dashboard
  - Clicking "会话历史" hides period bar, shows search bar + history layout placeholder
  - "概览" / "深度分析" toggle buttons visible in dashboard context bar
  - Language toggle and status in sidebar footer

- [ ] **Step 4.6 — Commit**

  ```bash
  git add public/index.html public/style.css public/app.js
  git commit -m "feat: add sidebar navigation shell and view switching"
  ```

---

## Task 5: Dashboard analytics view (heatmap + project chart + billing gauge)

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`

- [ ] **Step 5.1 — Add heatmap CSS to `style.css`**

  Append to `public/style.css`:

  ```css
  /* ── Activity heatmap ── */
  .heatmap-grid {
    display: flex; gap: 3px; padding: 8px 0;
  }
  .heatmap-week { display: flex; flex-direction: column; gap: 3px; }
  .heatmap-cell {
    width: 12px; height: 12px; border-radius: 2px;
    background: var(--border-light);
    cursor: default; transition: opacity 0.1s;
  }
  .heatmap-cell:hover { opacity: 0.75; }
  .heatmap-labels {
    display: flex; gap: 3px; margin-bottom: 4px; padding-left: 0;
  }
  .heatmap-month-label {
    font-size: 9px; color: var(--text-dimmer); width: 12px;
    white-space: nowrap; overflow: visible;
  }

  /* ── Billing window gauge ── */
  .billing-stat { margin-bottom: 12px; }
  .billing-label { font-size: 11px; color: var(--text-dim); margin-bottom: 4px; }
  .billing-value { font-size: 20px; font-weight: 700; color: var(--orange); font-family: var(--font-mono); }
  .billing-sub { font-size: 10px; color: var(--text-dimmer); margin-top: 2px; }
  .gauge-bar { height: 6px; background: var(--border-light); border-radius: 3px; margin-top: 8px; overflow: hidden; }
  .gauge-fill { height: 100%; background: var(--orange); border-radius: 3px; transition: width 0.4s; }
  ```

- [ ] **Step 5.2 — Add `loadAnalytics()` function to `app.js`**

  Append to the end of `public/app.js`:

  ```js
  // ── Analytics view ─────────────────────────────────────────────────────────
  let analyticsLoaded = false;
  let projectChartInst = null;

  async function loadAnalytics() {
    if (analyticsLoaded) return;
    analyticsLoaded = true;

    // Load heatmap and project stats in parallel
    const [heatmapData, projectData] = await Promise.all([
      fetch('/api/analytics/heatmap').then(r => r.json()).catch(() => ({ days: [] })),
      fetch('/api/analytics/projects').then(r => r.json()).catch(() => ({ projects: [] }))
    ]);

    renderHeatmap(heatmapData.days || []);
    renderProjectChart(projectData.projects || []);
    renderBillingWindow();
  }

  function renderHeatmap(days) {
    const container = document.getElementById('heatmapContainer');
    if (!container) return;

    // Build a map of date → { tokens, cost }
    const byDate = {};
    for (const d of days) byDate[d.date] = d;

    const maxTokens = Math.max(...days.map(d => d.tokens), 1);

    // Generate 91 days (13 weeks) ending today
    const cells = [];
    const today = new Date();
    for (let i = 90; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const data = byDate[dateStr] || { tokens: 0, cost: 0 };
      cells.push({ date: dateStr, dayOfWeek: d.getDay(), ...data });
    }

    // Build 13 columns (weeks), each 7 cells
    const weeks = [];
    // Pad first week
    const firstDow = cells[0].dayOfWeek; // 0=Sun
    const firstWeek = Array(firstDow).fill(null).concat(cells.slice(0, 7 - firstDow));
    weeks.push(firstWeek);
    let idx = 7 - firstDow;
    while (idx < cells.length) {
      weeks.push(cells.slice(idx, idx + 7));
      idx += 7;
    }

    // Color scale: 0 = bg, low = faint orange, high = full orange
    function tokenColor(tokens) {
      if (!tokens) return 'var(--border-light)';
      const pct = tokens / maxTokens;
      if (pct < 0.1) return 'rgba(217,119,87,0.15)';
      if (pct < 0.3) return 'rgba(217,119,87,0.35)';
      if (pct < 0.6) return 'rgba(217,119,87,0.60)';
      if (pct < 0.85) return 'rgba(217,119,87,0.80)';
      return 'rgba(217,119,87,1)';
    }

    const grid = document.createElement('div');
    grid.className = 'heatmap-grid';

    for (const week of weeks) {
      const col = document.createElement('div');
      col.className = 'heatmap-week';
      for (let dow = 0; dow < 7; dow++) {
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        const data = week[dow];
        if (data) {
          cell.style.background = tokenColor(data.tokens);
          cell.title = `${data.date}\nTokens: ${data.tokens.toLocaleString()}\nCost: $${(data.cost||0).toFixed(4)}`;
        } else {
          cell.style.opacity = '0'; // padding cell
        }
        col.appendChild(cell);
      }
      grid.appendChild(col);
    }

    container.innerHTML = '';
    container.appendChild(grid);
  }

  function renderProjectChart(projects) {
    if (!projects.length) return;
    if (projectChartInst) projectChartInst.destroy();

    const top = projects.slice(0, 15); // cap at 15 bars for readability
    const COLORS = ['#D97757','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#10B981',
                    '#EC4899','#14B8A6','#F97316','#6366F1','#84CC16','#06B6D4',
                    '#A855F7','#22C55E','#EAB308'];

    projectChartInst = new Chart(document.getElementById('projectChart'), {
      type: 'bar',
      data: {
        labels: top.map(p => p.name),
        datasets: [{
          label: 'Cost (USD)',
          data: top.map(p => p.totalCost),
          backgroundColor: top.map((_, i) => COLORS[i % COLORS.length] + 'CC'),
          borderColor:     top.map((_, i) => COLORS[i % COLORS.length]),
          borderWidth: 1
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: ctx => ` $${Number(ctx.raw).toFixed(4)}`
          }}
        },
        scales: {
          x: { ticks: { callback: v => `$${v.toFixed(3)}`, font: { size: 10 } } },
          y: { ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  function renderBillingWindow() {
    const panel = document.getElementById('billingWindowPanel');
    if (!panel) return;
    panel.innerHTML = '<div style="color:var(--text-dimmer);font-size:11px">加载中...</div>';

    fetch('/api/usage?period=5h').then(r => r.json()).then(report => {
      const s = report.summary;
      if (!s) return;
      const totalTok = s.totalTokens || 0;
      const cost = s.totalCost || 0;

      // Show as a gauge relative to 1M tokens (visual soft cap — not a real limit)
      const CAP = 1_000_000;
      const pct = Math.min(totalTok / CAP * 100, 100).toFixed(1);

      panel.innerHTML = `
        <div class="billing-stat">
          <div class="billing-label">${lang === 'zh' ? '本窗口 Token 用量' : 'Tokens This Window'}</div>
          <div class="billing-value">${fmt(totalTok)}</div>
          <div class="billing-sub">$${cost.toFixed(4)} ${lang === 'zh' ? '费用' : 'cost'}</div>
          <div class="gauge-bar">
            <div class="gauge-fill" style="width:${pct}%"></div>
          </div>
          <div style="font-size:9px;color:var(--text-dimmer);margin-top:3px">${pct}% of 1M</div>
        </div>
        <div class="billing-stat">
          <div class="billing-label">${lang === 'zh' ? '输入' : 'Input'}</div>
          <div style="font-size:13px;font-family:var(--font-mono)">${fmt(s.inputTokens)}</div>
        </div>
        <div class="billing-stat">
          <div class="billing-label">${lang === 'zh' ? '输出' : 'Output'}</div>
          <div style="font-size:13px;font-family:var(--font-mono)">${fmt(s.outputTokens)}</div>
        </div>
        <div class="billing-stat">
          <div class="billing-label">${lang === 'zh' ? '缓存' : 'Cache'}</div>
          <div style="font-size:13px;font-family:var(--font-mono)">${fmt((s.cacheReadTokens||0) + (s.cacheCreationTokens||0))}</div>
        </div>`;
    }).catch(() => {
      panel.innerHTML = '<div style="color:var(--text-dimmer);font-size:11px">—</div>';
    });
  }
  ```

- [ ] **Step 5.3 — Verify analytics view**

  Start the server, open `http://localhost:3333`, switch to "深度分析". Verify:
  - Heatmap grid renders (90 cells, colored where there is activity)
  - Project cost horizontal bar chart renders with project names
  - Billing window gauge shows current 5h token count and fill bar

- [ ] **Step 5.4 — Commit**

  ```bash
  git add public/app.js public/style.css
  git commit -m "feat: add analytics view with heatmap, project chart, billing window gauge"
  ```

---

## Task 6: History tab — Session list

**Files:**
- Create: `public/history.js`
- Modify: `public/style.css`

- [ ] **Step 6.1 — Add session list CSS to `style.css`**

  Append to `public/style.css`:

  ```css
  /* ── History session list ── */
  .project-group { border-bottom: 1px solid var(--border-light); }
  .project-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; cursor: pointer;
    background: var(--bg); font-size: 11px; font-weight: 600;
    color: var(--text-dim); user-select: none;
    transition: background 0.1s;
    position: sticky; top: 0; z-index: 1;
  }
  .project-header:hover { background: var(--border-light); }
  .project-count { color: var(--text-dimmer); font-weight: 400; }
  .project-toggle { color: var(--text-dimmer); font-size: 10px; }
  .project-sessions { display: none; }
  .project-sessions.open { display: block; }
  .session-item {
    display: flex; flex-direction: column; gap: 3px;
    padding: 8px 14px; cursor: pointer;
    border-left: 3px solid transparent;
    transition: all 0.1s; font-size: 11px;
  }
  .session-item:hover { background: var(--orange-faint); border-left-color: var(--orange-dim); }
  .session-item.active { background: var(--orange-faint); border-left-color: var(--orange); }
  .session-title { color: var(--text); font-size: 11px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .session-meta { display: flex; gap: 8px; color: var(--text-dimmer); font-size: 10px; font-family: var(--font-mono); }
  .session-search-item { padding: 8px 14px; cursor: pointer; border-left: 3px solid transparent; transition: all 0.1s; }
  .session-search-item:hover { background: var(--orange-faint); border-left-color: var(--orange-dim); }
  .search-result-title { font-size: 11px; font-weight: 600; color: var(--text); }
  .search-result-project { font-size: 10px; color: var(--text-dimmer); margin-bottom: 4px; }
  .search-snippet { font-size: 10px; color: var(--text-dim); font-style: italic; margin-top: 2px; padding: 3px 6px; background: var(--bg); border-radius: 3px; }
  .search-snippet mark { background: rgba(217,119,87,0.25); color: var(--text); border-radius: 2px; font-style: normal; }
  ```

- [ ] **Step 6.2 — Create `public/history.js` with session list logic**

  ```js
  // history.js — History tab: session list, viewer, search, export

  let historyLoaded = false;
  let allProjects = [];   // cached project data
  let activeSessionId = null;

  // ── Load and render session list ──────────────────────────────────────────
  async function loadHistorySessions() {
    if (historyLoaded) return;
    historyLoaded = true;
    renderSessionListLoading();

    try {
      const data = await fetch('/api/history/sessions').then(r => r.json());
      allProjects = data.projects || [];
      renderProjectList(allProjects);
    } catch {
      document.getElementById('historyList').innerHTML =
        '<div class="placeholder" style="padding:24px">加载失败，请刷新重试</div>';
    }
  }

  function renderSessionListLoading() {
    document.getElementById('historyList').innerHTML =
      '<div class="placeholder" style="padding:24px">加载中...</div>';
  }

  function renderProjectList(projects) {
    const list = document.getElementById('historyList');
    if (!projects.length) {
      list.innerHTML = '<div class="placeholder" style="padding:24px">暂无会话记录</div>';
      return;
    }

    list.innerHTML = projects.map(proj => `
      <div class="project-group" data-dir="${esc(proj.dirName)}">
        <div class="project-header" onclick="toggleProject('${esc(proj.dirName)}')">
          <span>${esc(proj.name)}</span>
          <span>
            <span class="project-count">${proj.sessions.length}</span>
            <span class="project-toggle" id="ptoggle-${esc(proj.dirName)}">▸</span>
          </span>
        </div>
        <div class="project-sessions" id="psessions-${esc(proj.dirName)}">
          ${proj.sessions.map(s => renderSessionItem(s)).join('')}
        </div>
      </div>`
    ).join('');

    // Auto-open the first project
    if (projects[0]) toggleProject(projects[0].dirName);
  }

  function renderSessionItem(s) {
    const ts = s.lastActivity
      ? new Date(s.lastActivity).toLocaleString('zh-CN',
          { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';
    const tokens = (s.inputTokens||0) + (s.outputTokens||0) + (s.cacheTokens||0);
    return `
      <div class="session-item" data-id="${esc(s.id)}" data-proj="${esc(s.projectDir)}"
           onclick="selectSession('${esc(s.projectDir)}','${esc(s.id)}')">
        <div class="session-title">${esc(s.title)}</div>
        <div class="session-meta">
          <span>${ts}</span>
          <span>${fmtK(tokens)} tok</span>
          <span>$${(s.totalCost||0).toFixed(4)}</span>
        </div>
      </div>`;
  }

  function toggleProject(dirName) {
    const el = document.getElementById(`psessions-${dirName}`);
    const tog = document.getElementById(`ptoggle-${dirName}`);
    if (!el) return;
    const isOpen = el.classList.toggle('open');
    if (tog) tog.textContent = isOpen ? '▾' : '▸';
  }

  function fmtK(n) {
    if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
    if (n >= 1e3) return (n/1e3).toFixed(0)+'K';
    return String(n);
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ── Session selection ──────────────────────────────────────────────────────
  async function selectSession(projectDir, sessionId) {
    // Highlight selected item
    document.querySelectorAll('.session-item, .session-search-item').forEach(el =>
      el.classList.remove('active'));
    const itemEl = document.querySelector(
      `.session-item[data-id="${sessionId}"][data-proj="${projectDir}"]`);
    if (itemEl) itemEl.classList.add('active');

    activeSessionId = sessionId;
    renderViewerLoading();

    try {
      const session = await fetch(
        `/api/history/session?project=${encodeURIComponent(projectDir)}&id=${encodeURIComponent(sessionId)}`
      ).then(r => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      });
      renderViewer(session);
    } catch {
      document.getElementById('historyViewer').innerHTML =
        '<div class="placeholder" style="padding:48px;text-align:center">加载失败</div>';
    }
  }

  function renderViewerLoading() {
    document.getElementById('historyViewer').innerHTML =
      '<div class="placeholder" style="padding:48px;text-align:center">加载中...</div>';
  }
  ```

- [ ] **Step 6.3 — Verify session list renders**

  Start server, click "会话历史", verify:
  - Project groups appear in left panel
  - Clicking a project header expands/collapses it
  - First project is expanded by default
  - Session items show title, timestamp, token count, cost

- [ ] **Step 6.4 — Commit**

  ```bash
  git add public/history.js public/style.css
  git commit -m "feat: history tab — session list with project grouping"
  ```

---

## Task 7: History tab — Conversation viewer

**Files:**
- Modify: `public/history.js`
- Modify: `public/style.css`

- [ ] **Step 7.1 — Add viewer CSS to `style.css`**

  Append to `public/style.css`:

  ```css
  /* ── Conversation viewer ── */
  .viewer-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 12px; margin-bottom: 16px; padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .viewer-title { font-size: 14px; font-weight: 600; color: var(--text); line-height: 1.4; flex: 1; }
  .viewer-meta { font-size: 10px; color: var(--text-dimmer); margin-top: 4px; font-family: var(--font-mono); }
  .export-btn {
    background: var(--orange-faint); border: 1px solid var(--orange);
    color: var(--orange); padding: 5px 12px; cursor: pointer;
    font-family: var(--font); font-size: 11px; border-radius: 5px;
    font-weight: 600; white-space: nowrap; flex-shrink: 0;
  }
  .export-btn:hover { background: var(--orange); color: #fff; }

  /* Messages */
  .message { margin-bottom: 10px; }
  .msg-user { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; }
  .msg-assistant { background: var(--bg); border: 1px solid var(--border-light); border-radius: 8px; padding: 10px 14px; }
  .msg-tool { background: #F5F2EE; border: 1px solid var(--border); border-radius: 6px; font-size: 11px; overflow: hidden; }
  .msg-label { font-size: 10px; font-weight: 600; color: var(--text-dimmer); margin-bottom: 6px; letter-spacing: 0.3px; }
  .msg-user .msg-label { color: var(--orange-dim); }
  .msg-assistant .msg-label { color: var(--blue); }
  .msg-tool .msg-label { padding: 6px 12px; background: var(--border-light); cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; }
  .msg-tool .msg-label:hover { background: var(--border); }
  .tool-toggle { font-size: 10px; color: var(--text-dimmer); margin-left: auto; }
  .msg-text { font-size: 12px; color: var(--text); line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
  .msg-code { font-family: var(--font-mono); background: #1C1917; color: #F9F7F4; padding: 10px 14px; border-radius: 6px; font-size: 11px; overflow-x: auto; white-space: pre; }
  .tool-body { padding: 8px 12px; display: none; }
  .tool-body.open { display: block; }
  .tool-input-pre { font-family: var(--font-mono); font-size: 10px; color: var(--text-dim); white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
  .msg-load-more { text-align: center; padding: 12px; }
  .msg-load-more button { background: none; border: 1px solid var(--border); color: var(--text-dim); padding: 6px 18px; cursor: pointer; font-family: var(--font); font-size: 11px; border-radius: 6px; }
  .msg-load-more button:hover { border-color: var(--orange-dim); color: var(--orange-dim); }
  ```

- [ ] **Step 7.2 — Append viewer rendering functions to `history.js`**

  ```js
  // ── Conversation viewer rendering ─────────────────────────────────────────
  const MESSAGES_PER_PAGE = 100;
  let viewerSession = null;
  let viewerShown = 0;

  function renderViewer(session) {
    viewerSession = session;
    viewerShown = Math.min(MESSAGES_PER_PAGE, session.messages.length);

    const totalTok = (session.inputTokens||0)+(session.outputTokens||0)+(session.cacheTokens||0);
    const ts = session.lastActivity
      ? new Date(session.lastActivity).toLocaleString('zh-CN')
      : '';

    const viewer = document.getElementById('historyViewer');
    viewer.innerHTML = `
      <div class="viewer-header">
        <div>
          <div class="viewer-title">${esc(session.title)}</div>
          <div class="viewer-meta">
            ${ts} · ${fmtK(totalTok)} tokens · $${(session.totalCost||0).toFixed(4)} ·
            ${(session.models||[]).map(m => m.replace(/^claude-/,'')).join(', ')}
          </div>
        </div>
        <button class="export-btn" onclick="exportMarkdown()">↓ Markdown</button>
      </div>
      <div id="messageList"></div>
      ${session.messages.length > MESSAGES_PER_PAGE
        ? `<div class="msg-load-more"><button onclick="loadMoreMessages()">加载更多 (${session.messages.length - viewerShown} 条)</button></div>`
        : ''}`;

    renderMessages(session.messages.slice(0, viewerShown));
  }

  function renderMessages(messages) {
    const list = document.getElementById('messageList');
    if (!list) return;
    list.innerHTML = messages.map((msg, idx) => renderMessage(msg, idx)).join('');
  }

  function loadMoreMessages() {
    if (!viewerSession) return;
    viewerShown = Math.min(viewerShown + MESSAGES_PER_PAGE, viewerSession.messages.length);
    renderMessages(viewerSession.messages.slice(0, viewerShown));

    const loadMore = document.querySelector('.msg-load-more');
    if (loadMore) {
      const remaining = viewerSession.messages.length - viewerShown;
      if (remaining <= 0) loadMore.remove();
      else loadMore.querySelector('button').textContent = `加载更多 (${remaining} 条)`;
    }
  }

  function renderMessage(msg, idx) {
    if (msg.role === 'user' && msg.type === 'text') {
      return `<div class="message msg-user">
        <div class="msg-label">USER</div>
        <div class="msg-text">${esc(msg.content)}</div>
      </div>`;
    }

    if (msg.role === 'assistant' && msg.type === 'text') {
      return `<div class="message msg-assistant">
        <div class="msg-label">ASSISTANT</div>
        <div class="msg-text">${esc(msg.content)}</div>
      </div>`;
    }

    if (msg.type === 'tool_use') {
      const inputJson = JSON.stringify(msg.input, null, 2);
      return `<div class="message msg-tool">
        <div class="msg-label" onclick="toggleTool(${idx})">
          <span>⚙ ${esc(msg.name)}</span>
          <span class="tool-toggle" id="tt-${idx}">▸ 展开</span>
        </div>
        <div class="tool-body" id="tb-${idx}">
          <div class="tool-input-pre">${esc(inputJson)}</div>
        </div>
      </div>`;
    }

    if (msg.type === 'tool_result') {
      const preview = (msg.content || '').slice(0, 500);
      const truncated = msg.content && msg.content.length > 500;
      return `<div class="message msg-tool">
        <div class="msg-label" onclick="toggleTool('r${idx}')">
          <span>↩ ${esc(msg.name || 'Result')}</span>
          <span class="tool-toggle" id="tt-r${idx}">▸ 展开</span>
        </div>
        <div class="tool-body" id="tb-r${idx}">
          <div class="tool-input-pre">${esc(preview)}${truncated ? '\n...(truncated)' : ''}</div>
        </div>
      </div>`;
    }

    return '';
  }

  function toggleTool(id) {
    const body = document.getElementById(`tb-${id}`);
    const tog  = document.getElementById(`tt-${id}`);
    if (!body) return;
    const open = body.classList.toggle('open');
    if (tog) tog.textContent = open ? '▾ 折叠' : '▸ 展开';
  }
  ```

- [ ] **Step 7.3 — Verify conversation viewer**

  In the browser, click a session in the History tab. Verify:
  - Header shows session title, timestamp, tokens, cost, model
  - User messages render with "USER" label
  - Assistant messages render with "ASSISTANT" label
  - Tool calls show collapsed by default with tool name; click to expand shows JSON input
  - Tool results show collapsed by default; click to expand shows output text
  - "加载更多" button appears for sessions with > 100 messages

- [ ] **Step 7.4 — Commit**

  ```bash
  git add public/history.js public/style.css
  git commit -m "feat: history tab — conversation viewer with collapsible tool calls"
  ```

---

## Task 8: History tab — Search + Markdown export

**Files:**
- Modify: `public/history.js`
- Modify: `public/index.html`

- [ ] **Step 8.1 — Append search functions to `history.js`**

  ```js
  // ── Full-text search ───────────────────────────────────────────────────────
  let searchMode = false;

  function initHistorySearch() {
    const input = document.getElementById('historySearch');
    const searchBtn = document.getElementById('historySearchBtn');
    const clearBtn = document.getElementById('historyClearBtn');
    if (!input || !searchBtn || !clearBtn) return;

    searchBtn.addEventListener('click', () => runSearch(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(input.value); });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      searchMode = false;
      renderProjectList(allProjects);
    });
  }

  async function runSearch(query) {
    if (!query.trim()) return;
    searchMode = true;
    document.getElementById('historyClearBtn').style.display = '';
    document.getElementById('historyList').innerHTML =
      '<div class="placeholder" style="padding:24px">搜索中...</div>';

    try {
      const data = await fetch(`/api/search?q=${encodeURIComponent(query)}`).then(r => r.json());
      renderSearchResults(data.results || [], query);
    } catch {
      document.getElementById('historyList').innerHTML =
        '<div class="placeholder" style="padding:24px">搜索失败</div>';
    }
  }

  function renderSearchResults(results, query) {
    const list = document.getElementById('historyList');
    if (!results.length) {
      list.innerHTML = `<div class="placeholder" style="padding:24px">未找到匹配"${esc(query)}"的会话</div>`;
      return;
    }

    // Highlight matches: wrap query in <mark>
    function highlight(text) {
      if (!query) return esc(text);
      const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return esc(text).replace(re, '<mark>$1</mark>');
    }

    list.innerHTML = `<div style="font-size:10px;color:var(--text-dimmer);padding:6px 14px">找到 ${results.length} 个会话</div>` +
      results.map(r => `
        <div class="session-search-item" data-id="${esc(r.id)}" data-proj="${esc(r.projectDir)}"
             onclick="selectSession('${esc(r.projectDir)}','${esc(r.id)}')">
          <div class="search-result-project">${esc(r.projectName)}</div>
          <div class="search-result-title">${esc(r.title)}</div>
          ${r.snippets.map(s =>
            `<div class="search-snippet">...${highlight(s)}...</div>`
          ).join('')}
        </div>`
      ).join('');
  }

  // ── Markdown export ────────────────────────────────────────────────────────
  function exportMarkdown() {
    if (!viewerSession) return;
    const s = viewerSession;
    const lines = [];

    lines.push(`# ${s.title}`);
    lines.push('');
    lines.push(`**Session:** \`${s.id}\`  `);
    lines.push(`**Project:** ${s.projectDir}  `);
    lines.push(`**Last Activity:** ${s.lastActivity}  `);
    lines.push(`**Models:** ${(s.models||[]).join(', ')}  `);
    lines.push(`**Tokens:** ${(s.inputTokens||0)+(s.outputTokens||0)+(s.cacheTokens||0)}  `);
    lines.push(`**Cost:** $${(s.totalCost||0).toFixed(4)}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of s.messages) {
      if (msg.role === 'user' && msg.type === 'text') {
        lines.push('**User:**');
        lines.push('');
        lines.push(msg.content);
        lines.push('');
      } else if (msg.role === 'assistant' && msg.type === 'text') {
        lines.push('**Assistant:**');
        lines.push('');
        lines.push(msg.content);
        lines.push('');
      } else if (msg.type === 'tool_use') {
        lines.push(`**Tool:** \`${msg.name}\``);
        lines.push('```json');
        lines.push(JSON.stringify(msg.input, null, 2));
        lines.push('```');
        lines.push('');
      } else if (msg.type === 'tool_result') {
        lines.push(`**Result:** \`${msg.name || 'Tool'}\``);
        lines.push('```');
        lines.push((msg.content || '').slice(0, 2000));
        lines.push('```');
        lines.push('');
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${s.id.slice(0, 8)}-${s.title.slice(0, 30).replace(/[^\w\u4e00-\u9fff]/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Initialization ─────────────────────────────────────────────────────────
  // Called after DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    initHistorySearch();
  });
  ```

- [ ] **Step 8.2 — Verify search**

  In the browser, switch to "会话历史", type a term in the search bar, click "搜索". Verify:
  - Results list appears in left panel with session titles and matching snippets
  - Snippets have the query term visually highlighted with `<mark>`
  - "× 清除" button appears and restores the project list when clicked
  - Clicking a search result loads the session in the viewer

- [ ] **Step 8.3 — Verify Markdown export**

  Load any session in the viewer, click "↓ Markdown". Verify:
  - A `.md` file downloads
  - File opens in a text editor with proper headings, user/assistant sections, tool call JSON blocks

- [ ] **Step 8.4 — Final smoke test**

  Start a fresh server (`npm start`), open `http://localhost:3333` and run through the full flow:
  1. Dashboard loads with stats, charts, session list
  2. "深度分析" toggle shows heatmap, project chart, billing gauge
  3. "会话历史" tab shows project-grouped session list
  4. Click a session → conversation renders with messages
  5. Tool calls collapse/expand on click
  6. Search for a word you know is in a session → results appear with highlights
  7. Clear search → project list restored
  8. Export a session → Markdown file downloads with correct content
  9. Language toggle (中 / EN) updates sidebar and period bar labels
  10. All existing dashboard features still work (period switching, SSE updates, model chart)

- [ ] **Step 8.5 — Commit**

  ```bash
  git add public/history.js public/index.html
  git commit -m "feat: history tab — full-text search and Markdown export"
  ```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Left sidebar navigation (Task 4)
- [x] Dashboard overview view preserved (Task 3)
- [x] `概览 / 深度分析` toggle (Task 4 + 5)
- [x] Activity heatmap 90 days (Task 5)
- [x] Project cost breakdown chart (Task 5)
- [x] Billing window progress (Task 5)
- [x] `chat-reader.js` with all 5 exported functions (Task 1)
- [x] `GET /api/history/sessions` (Task 2)
- [x] `GET /api/history/session` (Task 2)
- [x] `GET /api/search` (Task 2)
- [x] `GET /api/analytics/heatmap` (Task 2)
- [x] `GET /api/analytics/projects` (Task 2)
- [x] Session list grouped by project (Task 6)
- [x] Conversation viewer with user/assistant/tool rendering (Task 7)
- [x] Export to Markdown (Task 8)
- [x] Full-text search with highlighted snippets (Task 8)
- [x] i18n extended to new labels (Task 4 + 5)
- [x] Path traversal guard on `/api/history/session` (Task 2)
- [x] Codex history explicitly out of scope (no Codex reader for history tab)

**No placeholders:** All code blocks are complete. No TBD, TODO, or "similar to above".

**Type consistency:**
- `parseSessionFile` returns `{ messages, inputTokens, outputTokens, cacheTokens, totalCost, models, lastActivity }` — used consistently in `listSessions`, `readSession`, `searchSessions`, `getProjectStats`, `getDailyActivity`
- `message` objects: `{ role, type, content?, toolId?, name?, input? }` — consistent between `chat-reader.js` and `history.js` renderer
- `session` objects from API: `{ id, projectDir, title, messages, inputTokens, outputTokens, cacheTokens, totalCost, models, lastActivity }` — consistent between `readSession` and `renderViewer`
