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
  if (entry.message?.model === '<synthetic>') return null;  // internal placeholder, no real tokens
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
  const hourly = {};  // key: "YYYY-MM-DDTHH" → token/cost totals
  let inputTokens = 0, outputTokens = 0, cacheCreationTokens = 0, cacheReadTokens = 0, totalCost = 0;

  for (const file of files) {
    // Skip files not modified in the window (+ 1h buffer)
    let stat;
    try { stat = statSync(file); } catch { continue; }
    // Buffer of 1h: JSONL files are append-only, so mtime ≈ time of last write.
    // We add a safety margin to avoid skipping files that were written just before
    // the window but haven't been flushed yet. 1h is conservative for the 5h use-case.
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

      // per-hour bucket for 5h bar chart — use local time to avoid timezone shift
      const entryDate = new Date(entry.timestamp);
      const localHour = `${entryDate.getFullYear()}-${String(entryDate.getMonth()+1).padStart(2,'0')}-${String(entryDate.getDate()).padStart(2,'0')}T${String(entryDate.getHours()).padStart(2,'0')}`;
      if (!hourly[localHour]) hourly[localHour] = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 };
      hourly[localHour].inputTokens         += inp;
      hourly[localHour].outputTokens        += out;
      hourly[localHour].cacheCreationTokens += cCreate;
      hourly[localHour].cacheReadTokens     += cRead;
      hourly[localHour].totalCost           += cost;

      const sid = entry.sessionId || file;
      if (!sessions[sid]) {
        sessions[sid] = {
          id: sid, source: 'claude',
          inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalCost: 0,
          models: new Set(), lastActivityMs: new Date(entry.timestamp).getTime()
        };
      }
      sessions[sid].inputTokens  += inp;
      sessions[sid].outputTokens += out;
      sessions[sid].cacheTokens  += cCreate + cRead;
      sessions[sid].totalCost    += cost;
      sessions[sid].models.add(model);
      const entryTs = new Date(entry.timestamp).getTime();
      if (entryTs > sessions[sid].lastActivityMs) sessions[sid].lastActivityMs = entryTs;
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
    sessions: Object.values(sessions).map(({ lastActivityMs, ...s }) => ({ ...s, lastActivity: new Date(lastActivityMs).toISOString(), models: [...s.models] })),
    hourlyBuckets: Object.entries(hourly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ label: key.slice(11) + ':00', ...v }))
  };
}
