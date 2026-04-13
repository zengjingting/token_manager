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
