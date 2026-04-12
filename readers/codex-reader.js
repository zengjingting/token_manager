import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SESSIONS_DIR = join(homedir(), '.codex', 'sessions');

function getAllJsonlFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(join(entry.parentPath ?? entry.path, entry.name));
      }
    }
  } catch {
    // directory may not exist on fresh setups
  }
  return results;
}

function toHourKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}`;
}

function makeEmptySummary() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0
  };
}

/**
 * Read Codex usage entries since a given timestamp (ms).
 * Data source: ~/.codex/sessions/*.jsonl token_count(last_token_usage) events.
 */
export function readCodexUsageSince(sinceMs) {
  const files = getAllJsonlFiles(SESSIONS_DIR);
  const hourly = {};
  const models = {};
  const sessions = {};
  const summary = makeEmptySummary();

  for (const file of files) {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue;
    }
    if (stat.mtimeMs < sinceMs - 3_600_000) continue;

    const relId = file.replace(`${SESSIONS_DIR}/`, '').replace(/\.jsonl$/, '');
    let sessionModel = 'gpt-5.3-codex';

    const lines = readFileSync(file, 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry?.type === 'turn_context' && entry?.payload?.model) {
        sessionModel = entry.payload.model;
      }

      if (!(entry?.type === 'event_msg' && entry?.payload?.type === 'token_count')) continue;
      const usage = entry?.payload?.info?.last_token_usage;
      if (!usage) continue;

      const ts = new Date(entry.timestamp).getTime();
      if (!Number.isFinite(ts) || ts < sinceMs) continue;

      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const cachedInputTokens = usage.cached_input_tokens || 0;

      summary.inputTokens += inputTokens;
      summary.outputTokens += outputTokens;
      summary.cacheReadTokens += cachedInputTokens;
      summary.totalTokens += inputTokens + outputTokens + cachedInputTokens;

      if (!models[sessionModel]) {
        models[sessionModel] = { name: sessionModel, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, cost: 0 };
      }
      models[sessionModel].inputTokens += inputTokens;
      models[sessionModel].outputTokens += outputTokens;
      models[sessionModel].cachedInputTokens += cachedInputTokens;
      models[sessionModel].totalTokens += inputTokens + outputTokens + cachedInputTokens;

      const hourKey = toHourKey(entry.timestamp);
      if (!hourly[hourKey]) {
        hourly[hourKey] = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalCost: 0 };
      }
      hourly[hourKey].inputTokens += inputTokens;
      hourly[hourKey].outputTokens += outputTokens;
      hourly[hourKey].cachedInputTokens += cachedInputTokens;

      if (!sessions[relId]) {
        sessions[relId] = {
          id: relId,
          source: 'codex',
          inputTokens: 0,
          outputTokens: 0,
          cacheTokens: 0,
          totalCost: 0,
          models: new Set(),
          lastActivityMs: ts
        };
      }
      sessions[relId].inputTokens += inputTokens;
      sessions[relId].outputTokens += outputTokens;
      sessions[relId].cacheTokens += cachedInputTokens;
      sessions[relId].models.add(sessionModel);
      if (ts > sessions[relId].lastActivityMs) sessions[relId].lastActivityMs = ts;
    }
  }

  return {
    summary,
    models: Object.values(models).sort((a, b) => b.totalTokens - a.totalTokens),
    sessions: Object.values(sessions).map(({ lastActivityMs, ...s }) => ({
      ...s,
      models: [...s.models],
      lastActivity: new Date(lastActivityMs).toISOString()
    })),
    hourlyBuckets: Object.entries(hourly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ label: key.slice(11) + ':00', ...v }))
  };
}
