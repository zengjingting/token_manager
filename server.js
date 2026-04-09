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
