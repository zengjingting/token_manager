# Wave 2: Codex Session History Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Codex session history into the History tab so users can browse, view, search, and export Codex conversations alongside Claude sessions in a unified interface.

**Architecture:** A new `readers/codex-chat-reader.js` parses Codex JSONL files (`~/.codex/sessions/`) into the same data structures used by `chat-reader.js`. The `server.js` API layer merges both data sources at response time. The frontend `history.js` adds source labels and passes a `source` parameter for routing, reusing all existing rendering and export logic.

**Tech Stack:** Node 22, ES modules, Express, vanilla JS + Chart.js (CDN), `node:test` for backend tests.

---

## File Structure

| File | Responsibility |
|---|---|
| `readers/codex-chat-reader.js` *(new)* | Parse Codex JSONL into unified message format. Exports: `parseCodexSessionFile`, `listCodexSessions`, `readCodexSession`, `searchCodexSessions`. |
| `tests/codex-chat-reader.test.js` *(new)* | Unit tests for all four exports. |
| `readers/chat-reader.js` | Add `source: 'claude'` to session objects in `listSessions` and `searchSessions`. Export `decodeDirName` for reuse. |
| `server.js` | Merge Claude + Codex data in `/api/history/sessions`, `/api/history/session`, `/api/search`. |
| `public/history.js` | Add source badges to session list, viewer, search results. Pass `source` param on API calls. Add source line to Markdown export. |
| `package.json` | Add new test file to test script. |

---

## Tasks

### Task 1: Backend — `parseCodexSessionFile` with tests

**Files:**
- Create: `readers/codex-chat-reader.js`
- Create: `tests/codex-chat-reader.test.js`
- Modify: `package.json:10`

**Why:** Core parsing function that converts Codex JSONL into the unified message format. Everything else in this feature depends on it.

**Context for the implementer:** Codex JSONL format (from `~/.codex/sessions/YYYY/MM/DD/*.jsonl`):
- Each line is a JSON object with `{ timestamp, type, payload }`
- `type: 'session_meta'` → `payload.cwd` is the working directory, `payload.id` is the session UUID
- `type: 'response_item'` → `payload.type` can be `message`, `function_call`, `function_call_output`, `reasoning`, `custom_tool_call`, `custom_tool_call_output`
- `type: 'message'` + `role: 'user'` → `payload.content` is an array of `{ type: 'input_text', text }` blocks
- `type: 'message'` + `role: 'assistant'` → `payload.content` is an array of `{ type: 'output_text', text }` blocks
- `type: 'message'` + `role: 'developer'` → system prompt, SKIP
- `type: 'function_call'` → `payload.name`, `payload.arguments` (JSON string), `payload.call_id`
- `type: 'function_call_output'` → `payload.call_id`, `payload.output` (string)
- `type: 'reasoning'` → SKIP
- `type: 'event_msg'` + `payload.type: 'token_count'` → `payload.info.last_token_usage.{input_tokens, output_tokens, cached_input_tokens}`
- `type: 'turn_context'` → `payload.model` (optional model name)

- [ ] **Step 1.1: Write the test file**

Create `tests/codex-chat-reader.test.js`:

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseCodexSessionFile } from '../readers/codex-chat-reader.js';

const FIXTURE_SESSION = [
  JSON.stringify({
    timestamp: '2026-04-10T01:32:06.630Z',
    type: 'session_meta',
    payload: {
      id: '019d7504-3d6c-7e22-8808-5a520e781ab9',
      timestamp: '2026-04-10T01:31:45.390Z',
      cwd: '/Users/ting/Documents/Claude_Projects/granola_cn',
      cli_version: '0.118.0',
      source: 'cli',
      model_provider: 'openai'
    }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:06.631Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: '<permissions instructions>System prompt</permissions instructions>' }]
    }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:06.631Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/Users/ting</cwd>\n</environment_context>' }]
    }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:10.000Z',
    type: 'event_msg',
    payload: { type: 'user_message', message: 'Fix the login bug' }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:10.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Fix the login bug' }]
    }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:11.000Z',
    type: 'turn_context',
    payload: { turn_id: 'turn-1', model: 'gpt-5.3-codex', cwd: '/Users/ting/Documents/Claude_Projects/granola_cn' }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:12.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'I will investigate the login bug.' }]
    }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:13.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'exec_command',
      arguments: '{"cmd":"grep -rn \\"login\\" src/","max_output_tokens":4000}',
      call_id: 'call_abc123'
    }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:14.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: 'call_abc123',
      output: 'src/auth.js:42: function login(user, pass) {'
    }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:15.000Z',
    type: 'response_item',
    payload: {
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'Thinking...' }],
      content: [],
      encrypted_content: ''
    }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:16.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Found the issue in auth.js line 42.' }]
    }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:17.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 500,
          output_tokens: 120,
          cached_input_tokens: 300,
          reasoning_output_tokens: 50,
          total_tokens: 970
        },
        total_token_usage: {
          input_tokens: 500,
          output_tokens: 120,
          cached_input_tokens: 300,
          reasoning_output_tokens: 50,
          total_tokens: 970
        }
      }
    }
  }),
  JSON.stringify({
    timestamp: '2026-04-10T01:32:20.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 600,
          output_tokens: 80,
          cached_input_tokens: 400,
          reasoning_output_tokens: 30,
          total_tokens: 1110
        },
        total_token_usage: {
          input_tokens: 1100,
          output_tokens: 200,
          cached_input_tokens: 700,
          reasoning_output_tokens: 80,
          total_tokens: 2080
        }
      }
    }
  })
].join('\n');

let tmpDir;

function setup() {
  tmpDir = join(tmpdir(), `codex-chat-reader-test-${Date.now()}`);
  mkdirSync(join(tmpDir, '2026', '04', '10'), { recursive: true });
  const filePath = join(tmpDir, '2026', '04', '10', 'rollout-2026-04-10T01-31-45-019d7504.jsonl');
  writeFileSync(filePath, FIXTURE_SESSION, 'utf-8');
  return filePath;
}

function teardown() {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('parseCodexSessionFile: extracts cwd from session_meta', () => {
  const filePath = setup();
  try {
    const result = parseCodexSessionFile(filePath);
    assert.equal(result.cwd, '/Users/ting/Documents/Claude_Projects/granola_cn');
  } finally {
    teardown();
  }
});

test('parseCodexSessionFile: extracts user text, skips developer and environment_context', () => {
  const filePath = setup();
  try {
    const { messages } = parseCodexSessionFile(filePath);
    const userTexts = messages.filter(m => m.role === 'user' && m.type === 'text');
    assert.equal(userTexts.length, 1, 'should have exactly 1 user text message');
    assert.equal(userTexts[0].content, 'Fix the login bug');
  } finally {
    teardown();
  }
});

test('parseCodexSessionFile: extracts assistant text, skips reasoning', () => {
  const filePath = setup();
  try {
    const { messages } = parseCodexSessionFile(filePath);
    const assistantTexts = messages.filter(m => m.role === 'assistant' && m.type === 'text');
    assert.equal(assistantTexts.length, 2);
    assert.match(assistantTexts[0].content, /investigate the login bug/);
    assert.match(assistantTexts[1].content, /Found the issue/);
  } finally {
    teardown();
  }
});

test('parseCodexSessionFile: extracts function_call as tool_use', () => {
  const filePath = setup();
  try {
    const { messages } = parseCodexSessionFile(filePath);
    const toolUse = messages.find(m => m.type === 'tool_use');
    assert.ok(toolUse, 'should have a tool_use message');
    assert.equal(toolUse.role, 'assistant');
    assert.equal(toolUse.name, 'exec_command');
    assert.deepEqual(toolUse.input, { cmd: 'grep -rn "login" src/', max_output_tokens: 4000 });
    assert.equal(toolUse.toolId, 'call_abc123');
  } finally {
    teardown();
  }
});

test('parseCodexSessionFile: extracts function_call_output as tool_result', () => {
  const filePath = setup();
  try {
    const { messages } = parseCodexSessionFile(filePath);
    const toolResult = messages.find(m => m.type === 'tool_result');
    assert.ok(toolResult, 'should have a tool_result message');
    assert.equal(toolResult.role, 'user');
    assert.equal(toolResult.name, 'exec_command');
    assert.equal(toolResult.content, 'src/auth.js:42: function login(user, pass) {');
    assert.equal(toolResult.toolId, 'call_abc123');
  } finally {
    teardown();
  }
});

test('parseCodexSessionFile: sums token counts from all token_count events', () => {
  const filePath = setup();
  try {
    const { inputTokens, outputTokens, cacheTokens } = parseCodexSessionFile(filePath);
    // Two token_count events: last_token_usage summed
    assert.equal(inputTokens, 500 + 600);
    assert.equal(outputTokens, 120 + 80);
    assert.equal(cacheTokens, 300 + 400);
  } finally {
    teardown();
  }
});

test('parseCodexSessionFile: totalCost is always 0', () => {
  const filePath = setup();
  try {
    const { totalCost } = parseCodexSessionFile(filePath);
    assert.equal(totalCost, 0);
  } finally {
    teardown();
  }
});

test('parseCodexSessionFile: extracts model from turn_context', () => {
  const filePath = setup();
  try {
    const { models } = parseCodexSessionFile(filePath);
    assert.deepEqual(models, ['gpt-5.3-codex']);
  } finally {
    teardown();
  }
});

test('parseCodexSessionFile: lastActivity is latest timestamp', () => {
  const filePath = setup();
  try {
    const { lastActivity } = parseCodexSessionFile(filePath);
    assert.equal(lastActivity, '2026-04-10T01:32:20.000Z');
  } finally {
    teardown();
  }
});

test('parseCodexSessionFile: handles malformed lines without throwing', () => {
  const dir = join(tmpdir(), `codex-chat-bad-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'bad.jsonl');
  writeFileSync(filePath, 'not json\n{broken\n' + FIXTURE_SESSION, 'utf-8');
  try {
    assert.doesNotThrow(() => parseCodexSessionFile(filePath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 1.2: Update `package.json` test script**

Replace line 10 in `package.json`:

```json
"test": "node --test tests/chat-reader.test.js tests/normalize.test.js tests/codex-chat-reader.test.js"
```

- [ ] **Step 1.3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../readers/codex-chat-reader.js'`

- [ ] **Step 1.4: Implement `parseCodexSessionFile`**

Create `readers/codex-chat-reader.js`:

```javascript
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
function sessionsDir() { return process.env.CODEX_SESSIONS_DIR || DEFAULT_SESSIONS_DIR; }

function parseLine(line) {
  if (!line.trim()) return null;
  try { return JSON.parse(line); } catch { return null; }
}

function cwdToEncodedDir(cwd) {
  if (!cwd) return null;
  return '-' + cwd.replace(/^\//, '').replace(/\//g, '-');
}

export function parseCodexSessionFile(filePath) {
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  const messages = [];
  const toolNameById = {};
  const modelsSet = new Set();

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let lastActivity = null;
  let cwd = null;

  for (const line of lines) {
    const entry = parseLine(line);
    if (!entry) continue;

    const ts = entry.timestamp;
    if (ts && (!lastActivity || ts > lastActivity)) {
      lastActivity = ts;
    }

    if (entry.type === 'session_meta') {
      cwd = entry.payload?.cwd || cwd;
      continue;
    }

    if (entry.type === 'turn_context') {
      if (entry.payload?.model) modelsSet.add(entry.payload.model);
      continue;
    }

    if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
      const usage = entry.payload?.info?.last_token_usage;
      if (usage) {
        inputTokens += usage.input_tokens || 0;
        outputTokens += usage.output_tokens || 0;
        cacheTokens += usage.cached_input_tokens || 0;
      }
      continue;
    }

    if (entry.type === 'response_item') {
      const p = entry.payload;
      if (!p) continue;

      // Skip developer (system prompt) and reasoning
      if (p.type === 'reasoning') continue;
      if (p.type === 'message' && p.role === 'developer') continue;

      if (p.type === 'message') {
        const contentBlocks = p.content || [];
        for (const block of contentBlocks) {
          if (p.role === 'user' && block.type === 'input_text') {
            const text = (block.text || '').trim();
            // Skip environment_context system messages
            if (!text || text.startsWith('<environment_context>')) continue;
            messages.push({ role: 'user', type: 'text', content: text });
          } else if (p.role === 'assistant' && block.type === 'output_text') {
            const text = (block.text || '').trim();
            if (text) messages.push({ role: 'assistant', type: 'text', content: text });
          }
        }
      }

      if (p.type === 'function_call') {
        let input = {};
        try { input = JSON.parse(p.arguments || '{}'); } catch { /* keep empty */ }
        toolNameById[p.call_id] = p.name;
        messages.push({
          role: 'assistant',
          type: 'tool_use',
          toolId: p.call_id,
          name: p.name,
          input
        });
      }

      if (p.type === 'function_call_output') {
        messages.push({
          role: 'user',
          type: 'tool_result',
          toolId: p.call_id,
          name: toolNameById[p.call_id] || 'Tool',
          content: p.output || ''
        });
      }
    }
  }

  return {
    messages,
    inputTokens,
    outputTokens,
    cacheTokens,
    totalCost: 0,
    models: [...modelsSet],
    lastActivity,
    cwd
  };
}
```

- [ ] **Step 1.5: Run tests to verify they pass**

Run: `npm test`
Expected: All `codex-chat-reader.test.js` tests PASS; existing tests still PASS.

- [ ] **Step 1.6: Commit**

```bash
git add readers/codex-chat-reader.js tests/codex-chat-reader.test.js package.json
git commit -m "feat(codex-history): add parseCodexSessionFile with tests"
```

---

### Task 2: Backend — `listCodexSessions`, `readCodexSession`, `searchCodexSessions`

**Files:**
- Modify: `readers/codex-chat-reader.js` (append new exports)
- Modify: `tests/codex-chat-reader.test.js` (append new tests)
- Modify: `readers/chat-reader.js` (export `decodeDirName`, add `source: 'claude'`)

**Why:** These three functions provide the listing, reading, and search APIs for Codex sessions, mirroring the Claude `chat-reader.js` exports. `decodeDirName` is shared because both readers need the same path-to-name conversion.

- [ ] **Step 2.1: Write the failing tests**

Append to `tests/codex-chat-reader.test.js`:

```javascript
import { listCodexSessions, readCodexSession, searchCodexSessions } from '../readers/codex-chat-reader.js';

// Helper: build a minimal Codex session JSONL
function buildCodexSession({ cwd, userMsg, assistantMsg, model }) {
  return [
    JSON.stringify({
      timestamp: '2026-04-10T01:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'test-id', cwd, cli_version: '0.118.0', source: 'cli', model_provider: 'openai' }
    }),
    JSON.stringify({
      timestamp: '2026-04-10T01:00:01.000Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1', model: model || 'gpt-5.3-codex' }
    }),
    JSON.stringify({
      timestamp: '2026-04-10T01:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message', role: 'user',
        content: [{ type: 'input_text', text: userMsg }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-04-10T01:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: assistantMsg }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-04-10T01:00:04.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 80, total_tokens: 230 },
          total_token_usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 80, total_tokens: 230 }
        }
      }
    })
  ].join('\n');
}

let listTmpDir;

function setupListDir() {
  listTmpDir = join(tmpdir(), `codex-list-test-${Date.now()}`);
  // Two sessions in same cwd, one in different cwd
  const dir1 = join(listTmpDir, '2026', '04', '10');
  const dir2 = join(listTmpDir, '2026', '04', '09');
  mkdirSync(dir1, { recursive: true });
  mkdirSync(dir2, { recursive: true });

  writeFileSync(join(dir1, 'sess-a.jsonl'),
    buildCodexSession({ cwd: '/Users/x/projA', userMsg: 'Hello from projA', assistantMsg: 'Hi A' }));
  writeFileSync(join(dir2, 'sess-b.jsonl'),
    buildCodexSession({ cwd: '/Users/x/projA', userMsg: 'Second session projA', assistantMsg: 'Hi again' }));
  writeFileSync(join(dir1, 'sess-c.jsonl'),
    buildCodexSession({ cwd: '/Users/x/projB', userMsg: 'Hello from projB', assistantMsg: 'Hi B' }));

  return listTmpDir;
}

function teardownListDir() {
  if (listTmpDir && existsSync(listTmpDir)) {
    rmSync(listTmpDir, { recursive: true, force: true });
  }
}

beforeEach(() => { delete process.env.CODEX_SESSIONS_DIR; });
afterEach(() => { delete process.env.CODEX_SESSIONS_DIR; });

test('listCodexSessions: groups sessions by cwd, each has source codex', () => {
  const dir = setupListDir();
  process.env.CODEX_SESSIONS_DIR = dir;
  try {
    const { projects } = listCodexSessions();
    assert.equal(projects.length, 2, 'should have 2 projects');
    const projA = projects.find(p => p.dirName === '-Users-x-projA');
    const projB = projects.find(p => p.dirName === '-Users-x-projB');
    assert.ok(projA, 'projA should exist');
    assert.ok(projB, 'projB should exist');
    assert.equal(projA.sessions.length, 2);
    assert.equal(projB.sessions.length, 1);
    // All sessions have source: 'codex'
    for (const s of [...projA.sessions, ...projB.sessions]) {
      assert.equal(s.source, 'codex');
    }
  } finally {
    teardownListDir();
  }
});

test('readCodexSession: returns full session with messages and source', () => {
  const dir = setupListDir();
  process.env.CODEX_SESSIONS_DIR = dir;
  try {
    const session = readCodexSession('2026/04/10/sess-a');
    assert.ok(session, 'session should exist');
    assert.equal(session.source, 'codex');
    assert.ok(session.messages.length > 0);
    const userMsg = session.messages.find(m => m.role === 'user' && m.type === 'text');
    assert.equal(userMsg.content, 'Hello from projA');
  } finally {
    teardownListDir();
  }
});

test('readCodexSession: returns null for non-existent session', () => {
  const dir = setupListDir();
  process.env.CODEX_SESSIONS_DIR = dir;
  try {
    const session = readCodexSession('2026/04/10/nonexistent');
    assert.equal(session, null);
  } finally {
    teardownListDir();
  }
});

test('searchCodexSessions: finds matching text and returns snippets with source', () => {
  const dir = setupListDir();
  process.env.CODEX_SESSIONS_DIR = dir;
  try {
    const { results } = searchCodexSessions('projB');
    assert.equal(results.length, 1);
    assert.equal(results[0].source, 'codex');
    assert.ok(results[0].snippets.length > 0);
    assert.ok(results[0].snippets[0].includes('projB'));
  } finally {
    teardownListDir();
  }
});

test('searchCodexSessions: returns empty for no match', () => {
  const dir = setupListDir();
  process.env.CODEX_SESSIONS_DIR = dir;
  try {
    const { results } = searchCodexSessions('xyznonexistent');
    assert.equal(results.length, 0);
  } finally {
    teardownListDir();
  }
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `listCodexSessions is not a function` (not yet exported).

- [ ] **Step 2.3: Export `decodeDirName` from `chat-reader.js` and add `source: 'claude'`**

In `readers/chat-reader.js`, change line 45:
```javascript
export function decodeDirName(dirName) {
```
(Add `export` keyword before `function`.)

In `listSessions()`, around line 186, add `source: 'claude'` to each session object. Change:
```javascript
        sessions.push({
          id: sessionId,
          projectDir: dir.name,
          title: extractTitle(parsed.messages),
```
to:
```javascript
        sessions.push({
          id: sessionId,
          projectDir: dir.name,
          source: 'claude',
          title: extractTitle(parsed.messages),
```

In `searchSessions()`, around line 272, add `source: 'claude'` to each result. Change:
```javascript
          results.push({
            id: sessionId,
            projectDir: dir.name,
            projectName: decodeDirName(dir.name),
```
to:
```javascript
          results.push({
            id: sessionId,
            projectDir: dir.name,
            source: 'claude',
            projectName: decodeDirName(dir.name),
```

- [ ] **Step 2.4: Implement `listCodexSessions`, `readCodexSession`, `searchCodexSessions`**

Append to `readers/codex-chat-reader.js`:

```javascript
import { decodeDirName } from './chat-reader.js';

function getAllJsonlFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(join(entry.parentPath ?? entry.path, entry.name));
      }
    }
  } catch {
    // directory may not exist
  }
  return results;
}

function extractTitle(messages) {
  for (const msg of messages) {
    if (msg.role === 'user' && msg.type === 'text' && msg.content?.trim().length > 5) {
      return msg.content.trim().slice(0, 80);
    }
  }
  return 'Untitled';
}

export function listCodexSessions() {
  const dir = sessionsDir();
  if (!existsSync(dir)) return { projects: [] };

  const files = getAllJsonlFiles(dir);
  const byProject = new Map();

  for (const file of files) {
    const relId = file.replace(`${dir}/`, '').replace(/\.jsonl$/, '');
    try {
      const parsed = parseCodexSessionFile(file);
      const encodedDir = cwdToEncodedDir(parsed.cwd) || 'codex';

      if (!byProject.has(encodedDir)) {
        byProject.set(encodedDir, { dirName: encodedDir, name: decodeDirName(encodedDir), sessions: [] });
      }

      byProject.get(encodedDir).sessions.push({
        id: relId,
        projectDir: encodedDir,
        source: 'codex',
        title: extractTitle(parsed.messages),
        lastActivity: parsed.lastActivity || new Date(0).toISOString(),
        messageCount: parsed.messages.length,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        cacheTokens: parsed.cacheTokens,
        totalCost: parsed.totalCost,
        models: parsed.models
      });
    } catch {
      continue;
    }
  }

  const projects = [...byProject.values()];
  for (const proj of projects) {
    proj.sessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  }
  projects.sort((a, b) => {
    const aLast = a.sessions[0]?.lastActivity || '';
    const bLast = b.sessions[0]?.lastActivity || '';
    return bLast.localeCompare(aLast);
  });

  return { projects };
}

export function readCodexSession(sessionId) {
  const filePath = join(sessionsDir(), `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return null;

  const parsed = parseCodexSessionFile(filePath);
  return {
    id: sessionId,
    projectDir: cwdToEncodedDir(parsed.cwd) || 'codex',
    source: 'codex',
    title: extractTitle(parsed.messages),
    messages: parsed.messages,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    cacheTokens: parsed.cacheTokens,
    totalCost: parsed.totalCost,
    models: parsed.models,
    lastActivity: parsed.lastActivity || new Date(0).toISOString()
  };
}

export function searchCodexSessions(query) {
  if (!query?.trim()) return { query: query || '', results: [] };
  const dir = sessionsDir();
  if (!existsSync(dir)) return { query, results: [] };

  const q = query.trim().toLowerCase();
  const files = getAllJsonlFiles(dir);
  const results = [];

  for (const file of files) {
    const relId = file.replace(`${dir}/`, '').replace(/\.jsonl$/, '');
    try {
      const parsed = parseCodexSessionFile(file);
      const snippets = [];

      for (const msg of parsed.messages) {
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
        const encodedDir = cwdToEncodedDir(parsed.cwd) || 'codex';
        results.push({
          id: relId,
          projectDir: encodedDir,
          source: 'codex',
          projectName: decodeDirName(encodedDir),
          title: extractTitle(parsed.messages),
          lastActivity: parsed.lastActivity || '',
          snippets
        });
      }
    } catch {
      continue;
    }
  }

  results.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return { query, results };
}
```

**Important:** The `import { decodeDirName }` line must go at the top of the file, next to the existing imports. Move it from this location to the top import block.

- [ ] **Step 2.5: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS including new `listCodexSessions`, `readCodexSession`, `searchCodexSessions` tests. Existing `chat-reader.test.js` and `normalize.test.js` tests still PASS.

- [ ] **Step 2.6: Commit**

```bash
git add readers/codex-chat-reader.js readers/chat-reader.js tests/codex-chat-reader.test.js
git commit -m "feat(codex-history): add listCodexSessions, readCodexSession, searchCodexSessions"
```

---

### Task 3: Backend — `server.js` merge Claude + Codex history APIs

**Files:**
- Modify: `server.js:7` (add import)
- Modify: `server.js:105-142` (three endpoint handlers)

**Why:** The server layer merges data from both readers so the frontend gets a single unified response.

- [ ] **Step 3.1: Add import at top of `server.js`**

After line 7 (`import { listSessions, readSession, searchSessions, ... } from './readers/chat-reader.js';`), add:

```javascript
import { listCodexSessions, readCodexSession, searchCodexSessions } from './readers/codex-chat-reader.js';
```

- [ ] **Step 3.2: Replace `/api/history/sessions` handler**

Replace lines 105-112 in `server.js`:

```javascript
app.get('/api/history/sessions', (_req, res) => {
  try {
    const claude = listSessions();
    const codex = listCodexSessions();

    // Merge projects by dirName
    const merged = new Map();
    for (const proj of (claude.projects || [])) {
      merged.set(proj.dirName, { ...proj, sessions: [...proj.sessions] });
    }
    for (const proj of (codex.projects || [])) {
      if (merged.has(proj.dirName)) {
        merged.get(proj.dirName).sessions.push(...proj.sessions);
      } else {
        merged.set(proj.dirName, { ...proj, sessions: [...proj.sessions] });
      }
    }

    // Sort sessions within each project, then sort projects
    const projects = [...merged.values()];
    for (const proj of projects) {
      proj.sessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    }
    projects.sort((a, b) => {
      const aLast = a.sessions[0]?.lastActivity || '';
      const bLast = b.sessions[0]?.lastActivity || '';
      return bLast.localeCompare(aLast);
    });

    res.json({ projects });
  } catch (err) {
    console.error('[/api/history/sessions]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});
```

- [ ] **Step 3.3: Replace `/api/history/session` handler**

Replace lines 114-132 in `server.js`:

```javascript
app.get('/api/history/session', (req, res) => {
  const { project, id, source } = req.query;
  if (!id) {
    res.status(400).json({ error: 'Invalid parameters' });
    return;
  }

  try {
    let session;
    if (source === 'codex') {
      session = readCodexSession(id);
    } else {
      if (!project || /[./\\]/.test(project) || /[./\\]/.test(id)) {
        res.status(400).json({ error: 'Invalid parameters' });
        return;
      }
      session = readSession(project, id);
      if (session) session.source = 'claude';
    }

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  } catch (err) {
    console.error('[/api/history/session]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});
```

- [ ] **Step 3.4: Replace `/api/search` handler**

Replace lines 134-142 in `server.js`:

```javascript
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').slice(0, 200);
  try {
    const claude = searchSessions(q);
    const codex = searchCodexSessions(q);
    const results = [...(claude.results || []), ...(codex.results || [])];
    results.sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));
    res.json({ query: q, results });
  } catch (err) {
    console.error('[/api/search]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});
```

- [ ] **Step 3.5: Manual smoke test**

Start the server and verify the merged API responses:

```bash
npm start &
sleep 2
# Check sessions list includes codex entries
curl -s http://localhost:3333/api/history/sessions | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const all = d.projects.flatMap(p => p.sessions);
  const codex = all.filter(s => s.source === 'codex');
  const claude = all.filter(s => s.source === 'claude');
  console.log('Projects:', d.projects.length, 'Claude:', claude.length, 'Codex:', codex.length);
"
# Check reading a codex session
curl -s "http://localhost:3333/api/history/session?id=2026/04/10/rollout-2026-04-10T09-31-45-019d7504-3d6c-7e22-8808-5a520e781ab9&source=codex" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('Source:', d.source, 'Messages:', d.messages?.length, 'Title:', d.title?.slice(0,40));
"
lsof -ti:3333 | xargs kill -9
```

Expected: Projects count includes mixed projects. Codex count >= 1. Reading a Codex session returns messages with the correct source.

- [ ] **Step 3.6: Commit**

```bash
git add server.js
git commit -m "feat(codex-history): merge Claude + Codex data in history API endpoints"
```

---

### Task 4: Frontend — Source badges and `source` parameter in `history.js`

**Files:**
- Modify: `public/history.js:88-107` (`renderSessionItem`)
- Modify: `public/history.js:131-154` (`selectSession`)
- Modify: `public/history.js:166-201` (`renderViewer`)
- Modify: `public/history.js:406-432` (`renderSearchResults`)
- Modify: `public/history.js:436-488` (`exportMarkdown`)

**Why:** The frontend needs to display source badges on session list items, viewer header, and search results, and pass the `source` parameter when fetching individual sessions.

- [ ] **Step 4.1: Update `renderSessionItem` to show source badge**

Replace lines 88-107 in `public/history.js` (the `renderSessionItem` function):

```javascript
function renderSessionItem(s) {
  const ts = s.lastActivity
    ? new Date(s.lastActivity).toLocaleString('zh-CN',
        { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';
  const tokens = (s.inputTokens||0) + (s.outputTokens||0) + (s.cacheTokens||0);
  const displayTitle = getCustomTitle(s.id) || s.title;
  const source = s.source || 'claude';
  return `
    <div class="session-item" data-id="${esc(s.id)}" data-proj="${esc(s.projectDir)}" data-source="${esc(source)}">
      <div class="session-item-main">
        <div class="session-title">
          <span class="badge badge-${esc(source)}">${esc(source).toUpperCase()}</span>
          ${esc(displayTitle)}
        </div>
        <div class="session-meta">
          <span>${ts}</span>
          <span>${fmtK(tokens)} tok</span>
          <span>$${(s.totalCost||0).toFixed(4)}</span>
        </div>
      </div>
      <button class="session-copy-btn" data-copy-id="${esc(s.id)}" title="${esc(s.id)}">⧉</button>
    </div>`;
}
```

- [ ] **Step 4.2: Update `selectSession` to pass `source` parameter**

Replace the `selectSession` function (lines 131-154):

```javascript
async function selectSession(projectDir, sessionId, source) {
  document.querySelectorAll('.session-item, .session-search-item').forEach(el =>
    el.classList.remove('active'));
  const itemEl = document.querySelector(
    `.session-item[data-id="${CSS.escape(sessionId)}"][data-proj="${CSS.escape(projectDir)}"]`);
  if (itemEl) itemEl.classList.add('active');

  activeSessionId = sessionId;
  renderViewerLoading();

  try {
    const params = new URLSearchParams({ id: sessionId });
    if (source === 'codex') {
      params.set('source', 'codex');
    } else {
      params.set('project', projectDir);
    }
    const session = await fetch(`/api/history/session?${params}`).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
    renderViewer(session);
  } catch {
    document.getElementById('historyViewer').innerHTML =
      '<div class="placeholder" style="padding:48px;text-align:center">加载失败</div>';
  }
}
```

- [ ] **Step 4.3: Update click delegation to pass `source`**

In `renderProjectList`, find the click handler line (around line 81):
```javascript
    if (item) selectSession(item.dataset.proj, item.dataset.id);
```
Replace with:
```javascript
    if (item) selectSession(item.dataset.proj, item.dataset.id, item.dataset.source);
```

- [ ] **Step 4.4: Update `renderViewer` to show source badge in meta**

In the `renderViewer` function, find the `viewer.innerHTML` template (around line 180). Locate the `viewer-meta` div and add the source badge. Replace:

```javascript
      <div class="viewer-meta">
          ${ts} · ${fmtK(totalTok)} tokens · $${(session.totalCost||0).toFixed(4)} ·
          ${(session.models||[]).map(m => esc(m.replace(/^claude-/,''))).join(', ')}
        </div>
```

with:

```javascript
      <div class="viewer-meta">
          <span class="badge badge-${esc(session.source || 'claude')}">${esc(session.source || 'claude').toUpperCase()}</span>
          ${ts} · ${fmtK(totalTok)} tokens · $${(session.totalCost||0).toFixed(4)} ·
          ${(session.models||[]).map(m => esc(m.replace(/^claude-/,''))).join(', ')}
        </div>
```

- [ ] **Step 4.5: Update search result rendering and click handler**

In `renderSearchResults` (around line 424), update the search result HTML to include source badge and `data-source` attribute. Replace:

```javascript
    results.map(r => `
      <div class="session-search-item" data-id="${esc(r.id)}" data-proj="${esc(r.projectDir)}">
        <div class="search-result-project">${esc(r.projectName)}</div>
        <div class="search-result-title">${esc(r.title)}</div>
```

with:

```javascript
    results.map(r => `
      <div class="session-search-item" data-id="${esc(r.id)}" data-proj="${esc(r.projectDir)}" data-source="${esc(r.source || 'claude')}">
        <div class="search-result-project">${esc(r.projectName)}</div>
        <div class="search-result-title">
          <span class="badge badge-${esc(r.source || 'claude')}">${esc(r.source || 'claude').toUpperCase()}</span>
          ${esc(r.title)}
        </div>
```

In `initHistorySearch` (around line 362), update the search result click handler. Replace:

```javascript
      if (item) selectSession(item.dataset.proj, item.dataset.id);
```

with:

```javascript
      if (item) selectSession(item.dataset.proj, item.dataset.id, item.dataset.source);
```

- [ ] **Step 4.6: Update `exportMarkdown` to include source**

In the `exportMarkdown` function, after the `**Project:**` line (around line 443), add a source line. After:

```javascript
  lines.push(`**Project:** ${s.projectDir}  `);
```

add:

```javascript
  lines.push(`**Source:** ${s.source === 'codex' ? 'Codex' : 'Claude Code'}  `);
```

- [ ] **Step 4.7: Manual smoke test**

Run: `npm start`. Open `http://localhost:3333`, switch to the History tab:

1. Session list shows badges — verify `CLAUDE` (orange) and `CODEX` (blue) labels next to session titles.
2. Sessions within the same project (e.g. `granola_cn`) are mixed and sorted by time.
3. Click a Codex session — viewer loads with messages (USER / ASSISTANT / tool calls).
4. Viewer meta line shows `CODEX` badge.
5. Click a Claude session — still works as before with `CLAUDE` badge.
6. Search for a term that exists in a Codex session — results show with `CODEX` badge.
7. Click a search result for a Codex session — viewer loads correctly.
8. Export a Codex session as Markdown — file includes `**Source:** Codex` line.
9. Export a Claude session — file includes `**Source:** Claude Code` line.

Kill server: `lsof -ti:3333 | xargs kill -9`

- [ ] **Step 4.8: Commit**

```bash
git add public/history.js
git commit -m "feat(codex-history): source badges + codex session viewing in history tab"
```

---

### Task 5: Final integration test

**Files:** none modified — verification only.

- [ ] **Step 5.1: Run the full test suite**

```bash
npm test
```

Expected: All tests pass — `chat-reader.test.js`, `normalize.test.js`, `codex-chat-reader.test.js`.

- [ ] **Step 5.2: Boot server and walk all features**

```bash
npm start
```

Open `http://localhost:3333` and verify:

- [ ] **Dashboard tab** — unchanged, no regressions. Stat cards, charts, session table all work. Period selector works.
- [ ] **History tab — session list** — projects show both Claude and Codex sessions mixed, sorted by time. Each session has a source badge (CLAUDE orange / CODEX blue). Styles match the dashboard session table badges.
- [ ] **History tab — Codex viewer** — click a Codex session, verify: messages render as USER/ASSISTANT/tool calls. Meta line shows CODEX badge + model name (e.g. `gpt-5.3-codex`). Tool call toggle works. Pagination (load more) works if session has > 100 messages.
- [ ] **History tab — Claude viewer** — click a Claude session, verify it still works exactly as before. Meta line shows CLAUDE badge.
- [ ] **History tab — search** — search for a term in a Codex session. Results show CODEX badge. Click result → viewer loads correctly. Clear search → returns to project list.
- [ ] **History tab — export** — export a Codex session as Markdown. Open the file and verify `**Source:** Codex` is present. Export a Claude session and verify `**Source:** Claude Code`.
- [ ] **History tab — rename** — rename a Codex session (click pencil icon). Verify the custom title persists after page refresh.
- [ ] **Language toggle** — switch EN ↔ ZH. All existing labels still update. Source badges are language-independent (always show CLAUDE/CODEX).

Kill server: `lsof -ti:3333 | xargs kill -9`

- [ ] **Step 5.3: Review git log**

```bash
git log --oneline -5
```

Expected: 4 new commits (Tasks 1-4), each with a clear message.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| New `codex-chat-reader.js` with `parseCodexSessionFile` | Task 1 |
| Message type mapping (user/assistant/tool_use/tool_result) | Task 1 |
| Skip developer messages, reasoning, environment_context | Task 1 |
| Token counting from event_msg | Task 1 |
| `listCodexSessions` grouped by cwd | Task 2 |
| `readCodexSession` by session ID | Task 2 |
| `searchCodexSessions` full-text search | Task 2 |
| cwd → encoded dir name conversion | Task 1 (cwdToEncodedDir) + Task 2 (usage) |
| `chat-reader.js` exports `decodeDirName`, adds `source: 'claude'` | Task 2 |
| `/api/history/sessions` merges both sources | Task 3 |
| `/api/history/session` routes by `source` param | Task 3 |
| `/api/search` merges both sources | Task 3 |
| Session list source badges | Task 4 |
| Viewer meta source badge | Task 4 |
| Search results source badges | Task 4 |
| Markdown export source line | Task 4 |
| `totalCost: 0` for Codex sessions | Task 1 (hardcoded) |
| Unit tests for parseCodexSessionFile | Task 1 |
| Unit tests for list/read/search | Task 2 |
| Integration smoke test | Task 5 |

All spec requirements covered.

**Placeholder scan:** No TBD/TODO found.

**Type consistency:**
- `parseCodexSessionFile` returns `{ messages, inputTokens, outputTokens, cacheTokens, totalCost, models, lastActivity, cwd }` — consumed by Task 2's list/read/search functions.
- `cwdToEncodedDir` defined in Task 1, used in Task 2.
- `decodeDirName` exported from `chat-reader.js` in Task 2.3, imported in `codex-chat-reader.js` in Task 2.4.
- `source` field: `'codex'` set in Task 2 (list/read/search), `'claude'` set in Task 2.3 (chat-reader), consumed by Task 3 (server) and Task 4 (frontend).
- Session object shape matches between Claude and Codex: `{ id, projectDir, source, title, lastActivity, messageCount, inputTokens, outputTokens, cacheTokens, totalCost, models }`.

**Open risks for the implementer:**

1. **Step 2.4 import order**: The `import { decodeDirName }` line is shown inline in the appended code but must be moved to the top import block. Do not put it in the middle of the file.

2. **Step 3.2-3.4 line numbers**: The exact line numbers (105-142) are based on the current `server.js` state. If Wave 1 changes shifted lines, use `grep -n` to find the actual handler locations before editing.

3. **Step 4.1 badge CSS**: The `.badge`, `.badge-claude`, `.badge-codex` classes already exist in `style.css` (lines 107-109). If the styles look too large in the session list, the implementer may need to add a scoped override like `.session-title .badge { font-size: 9px; padding: 1px 5px; }` — but try without this first.
