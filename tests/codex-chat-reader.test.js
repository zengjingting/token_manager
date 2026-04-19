import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseCodexSessionFile, listCodexSessions, readCodexSession, searchCodexSessions } from '../readers/codex-chat-reader.js';

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
