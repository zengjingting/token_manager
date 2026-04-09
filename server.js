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

const VALID_PERIODS = new Set(['5h', '1d', '3d', '7d', 'custom']);
const ISO_DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;

// Fix 4: SSE connection cap to prevent DoS via runaway CLI spawns
let sseCount = 0;
const SSE_MAX = 5;

function getDateRange(period, since, until) {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Fix 5: only accept well-formed ISO dates for custom range
  const sinceDate = since && ISO_DATE_RE.test(since) ? new Date(since) : today;
  const untilDate = until && ISO_DATE_RE.test(until) ? new Date(until) : now;
  switch (period) {
    case '1d':    return { since: today,                              until: now };
    case '3d':    return { since: new Date(+today - 2 * 86_400_000), until: now };
    case '7d':    return { since: new Date(+today - 6 * 86_400_000), until: now };
    case 'custom':return { since: sinceDate, until: untilDate };
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
  // Fix 2: validate period
  const period = VALID_PERIODS.has(req.query.period) ? req.query.period : '1d';
  const { since, until } = req.query;
  try {
    res.json(await fetchReport(period, since, until));
  } catch (err) {
    // Fix 3: don't leak internal error details
    console.error('[/api/usage]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// SSE endpoint
app.get('/api/stream', (req, res) => {
  // Fix 4: cap concurrent SSE connections
  if (sseCount >= SSE_MAX) {
    res.status(429).json({ error: 'Too many SSE connections' });
    return;
  }

  // Fix 2: validate period
  const period = VALID_PERIODS.has(req.query.period) ? req.query.period : '1d';
  const { since, until } = req.query;

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  sseCount++;

  const push = async () => {
    try {
      const report = await fetchReport(period, since, until);
      res.write(`data: ${JSON.stringify(report)}\n\n`);
    } catch (err) {
      // Fix 3: don't leak internal error details over SSE
      console.error('[/api/stream]', err);
      res.write(`data: ${JSON.stringify({ error: 'Internal error' })}\n\n`);
    }
  };

  push();
  const interval = setInterval(push, 30_000);
  req.on('close', () => { clearInterval(interval); sseCount--; });
});

// Fix 1: bind to loopback only — blocks LAN access
app.listen(PORT, '127.0.0.1', () => console.log(`Token Dashboard → http://localhost:${PORT}`));
