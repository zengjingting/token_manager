import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseSessionFile, _setCcusageRunnerForTests, getProjectStats } from '../readers/chat-reader.js';

const FIXTURE_SESSION = [
  JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 'test123' }),
  JSON.stringify({
    type: 'user',
    isMeta: true,
    message: { role: 'user', content: '<system-reminder>ignore</system-reminder>' },
    timestamp: '2026-04-11T09:59:00.000Z',
    uuid: 'u0',
    parentUuid: null,
    sessionId: 'test123'
  }),
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'How do I write a for loop in Python?' },
    timestamp: '2026-04-11T10:00:00.000Z',
    uuid: 'u1',
    parentUuid: null,
    sessionId: 'test123'
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'Here is a for loop example: `for i in range(10): print(i)`' }],
      usage: { input_tokens: 50, output_tokens: 30, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 }
    },
    costUSD: 0.001,
    timestamp: '2026-04-11T10:00:05.000Z',
    uuid: 'u2',
    parentUuid: 'u1',
    sessionId: 'test123'
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'Bash',
          input: { command: 'python3 -c "for i in range(3): print(i)"', description: 'Test the loop' }
        }
      ],
      usage: { input_tokens: 20, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    },
    costUSD: 0.0005,
    timestamp: '2026-04-11T10:00:10.000Z',
    uuid: 'u3',
    parentUuid: 'u2',
    sessionId: 'test123'
  }),
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '0\n1\n2' }] },
    timestamp: '2026-04-11T10:00:11.000Z',
    uuid: 'u4',
    parentUuid: 'u3',
    sessionId: 'test123'
  })
].join('\n');

let tmpDir;

function setup() {
  tmpDir = join(tmpdir(), `chat-reader-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, 'test123.jsonl'), FIXTURE_SESSION, 'utf-8');
  return tmpDir;
}

function teardown() {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('parseSessionFile: returns messages array', () => {
  const dir = setup();
  try {
    const result = parseSessionFile(join(dir, 'test123.jsonl'));
    assert.ok(Array.isArray(result.messages), 'messages should be an array');
  } finally {
    teardown();
  }
});

test('parseSessionFile: extracts user text message, skips isMeta', () => {
  const dir = setup();
  try {
    const { messages } = parseSessionFile(join(dir, 'test123.jsonl'));
    const userTexts = messages.filter((m) => m.role === 'user' && m.type === 'text');
    assert.equal(userTexts.length, 1);
    assert.match(userTexts[0].content, /for loop in Python/);
  } finally {
    teardown();
  }
});

test('parseSessionFile: extracts assistant text message', () => {
  const dir = setup();
  try {
    const { messages } = parseSessionFile(join(dir, 'test123.jsonl'));
    const assistantTexts = messages.filter((m) => m.role === 'assistant' && m.type === 'text');
    assert.equal(assistantTexts.length, 1);
    assert.match(assistantTexts[0].content, /for loop example/);
  } finally {
    teardown();
  }
});

test('parseSessionFile: extracts tool_use with name and input', () => {
  const dir = setup();
  try {
    const { messages } = parseSessionFile(join(dir, 'test123.jsonl'));
    const toolUse = messages.find((m) => m.type === 'tool_use');
    assert.ok(toolUse, 'should have a tool_use message');
    assert.equal(toolUse.name, 'Bash');
    assert.equal(toolUse.input.command, 'python3 -c "for i in range(3): print(i)"');
  } finally {
    teardown();
  }
});

test('parseSessionFile: extracts tool_result with content and tool name', () => {
  const dir = setup();
  try {
    const { messages } = parseSessionFile(join(dir, 'test123.jsonl'));
    const toolResult = messages.find((m) => m.type === 'tool_result');
    assert.ok(toolResult, 'should have a tool_result message');
    assert.equal(toolResult.content, '0\n1\n2');
    assert.equal(toolResult.name, 'Bash');
  } finally {
    teardown();
  }
});

test('parseSessionFile: sums token counts correctly', () => {
  const dir = setup();
  try {
    const { inputTokens, outputTokens, cacheTokens } = parseSessionFile(join(dir, 'test123.jsonl'));
    assert.equal(inputTokens, 70);
    assert.equal(outputTokens, 40);
    assert.equal(cacheTokens, 300);
  } finally {
    teardown();
  }
});

test('parseSessionFile: sums cost correctly', () => {
  const dir = setup();
  try {
    const { totalCost } = parseSessionFile(join(dir, 'test123.jsonl'));
    assert.ok(Math.abs(totalCost - 0.0015) < 0.00001, `expected ~0.0015 got ${totalCost}`);
  } finally {
    teardown();
  }
});

test('parseSessionFile: extracts model', () => {
  const dir = setup();
  try {
    const { models } = parseSessionFile(join(dir, 'test123.jsonl'));
    assert.deepEqual(models, ['claude-sonnet-4-6']);
  } finally {
    teardown();
  }
});

test('parseSessionFile: sets lastActivity to latest timestamp', () => {
  const dir = setup();
  try {
    const { lastActivity } = parseSessionFile(join(dir, 'test123.jsonl'));
    assert.equal(lastActivity, '2026-04-11T10:00:11.000Z');
  } finally {
    teardown();
  }
});

test('parseSessionFile: handles malformed lines without throwing', () => {
  const dir = setup();
  const badContent = 'valid json line\n{broken json\n' + FIXTURE_SESSION;
  writeFileSync(join(dir, 'bad.jsonl'), badContent, 'utf-8');
  try {
    assert.doesNotThrow(() => parseSessionFile(join(dir, 'bad.jsonl')));
  } finally {
    teardown();
  }
});

test('getProjectStats: aggregates costs from injected ccusage runner, groups by project dir', () => {
  const root = join(tmpdir(), `chat-reader-projstat-${Date.now()}`);
  const projA = join(root, '-Users-x-projA');
  const projB = join(root, '-Users-x-projB');
  mkdirSync(projA, { recursive: true });
  mkdirSync(projB, { recursive: true });
  writeFileSync(join(projA, 'sess-1.jsonl'),
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Hello' },
      timestamp: '2026-04-11T10:00:00.000Z'
    }) + '\n' +
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant', model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Hi' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      },
      timestamp: '2026-04-11T10:00:05.000Z'
    }) + '\n');
  writeFileSync(join(projB, 'sess-2.jsonl'),
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Hello' },
      timestamp: '2026-04-11T10:00:00.000Z'
    }) + '\n' +
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant', model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Hi' }],
        usage: { input_tokens: 20, output_tokens: 8, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      },
      timestamp: '2026-04-11T10:00:05.000Z'
    }) + '\n');

  _setCcusageRunnerForTests(() => ({
    sessions: [
      { sessionId: '-Users-x-projA', totalCost: 1.50 },
      { sessionId: '-Users-x-projB', totalCost: 0.75 }
    ]
  }));

  const prev = process.env.CLAUDE_PROJECTS_DIR;
  process.env.CLAUDE_PROJECTS_DIR = root;

  try {
    const stats = getProjectStats();
    assert.equal(stats.length, 2, 'should return exactly 2 projects');
    const a = stats.find(s => s.dirName === '-Users-x-projA');
    const b = stats.find(s => s.dirName === '-Users-x-projB');
    assert.ok(a, 'projA should be present');
    assert.ok(b, 'projB should be present');
    assert.equal(a.totalCost, 1.50);
    assert.equal(b.totalCost, 0.75);
    assert.equal(a.inputTokens, 10);
    assert.equal(b.inputTokens, 20);
    assert.equal(stats[0].dirName, '-Users-x-projA', 'sorted by cost desc');
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
      type: 'user',
      message: { role: 'user', content: 'Hello' },
      timestamp: '2026-04-11T10:00:00.000Z'
    }) + '\n' +
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant', model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Hi' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      },
      timestamp: '2026-04-11T10:00:05.000Z'
    }) + '\n');

  _setCcusageRunnerForTests(() => ({
    sessions: [
      { sessionId: 'leaf-name', projectPath: '-Users-x-projA/sub-uuid', totalCost: 2.00 },
      { sessionId: 'orphan', projectPath: 'Unknown Project', totalCost: 99.00 }
    ]
  }));

  const prev = process.env.CLAUDE_PROJECTS_DIR;
  process.env.CLAUDE_PROJECTS_DIR = root;

  try {
    const stats = getProjectStats();
    const a = stats.find(s => s.dirName === '-Users-x-projA');
    assert.ok(a, 'projA should be present');
    assert.equal(a.totalCost, 2.00, 'nested ccusage entry should map to projA via projectPath');
    // orphan with 'Unknown Project' + sessionId that doesn't match any dir → ignored
    const orphan = stats.find(s => s.dirName === 'orphan');
    assert.ok(!orphan, 'orphan entry with Unknown Project should not appear');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
    else process.env.CLAUDE_PROJECTS_DIR = prev;
    _setCcusageRunnerForTests(null);
    rmSync(root, { recursive: true, force: true });
  }
});
