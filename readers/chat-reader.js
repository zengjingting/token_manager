import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getClaudeSessionData } from './cli-runner.js';

const DEFAULT_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
function projectsDir() { return process.env.CLAUDE_PROJECTS_DIR || DEFAULT_PROJECTS_DIR; }

let _ccusageRunner = null;
export function _setCcusageRunnerForTests(fn) { _ccusageRunner = fn; }
// Fetch all-time session data from ccusage for cost attribution.
// No date filter is intentional — project stats are an all-time aggregate.
function fetchCcusageSessions() {
  if (_ccusageRunner) return _ccusageRunner();
  try {
    return getClaudeSessionData(undefined, undefined);
  } catch (err) {
    console.error('[chat-reader] ccusage session fetch failed:', err.message);
    return { sessions: [] };
  }
}

const SKIP_PATH_SEGMENTS = new Set([
  'users',
  'home',
  'root',
  'documents',
  'desktop',
  'downloads',
  'applications',
  'opt',
  'usr',
  'local'
]);

function parseLine(line) {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function decodeDirName(dirName) {
  const parts = dirName.replace(/^-/, '').split('-').filter(Boolean);

  let i = 0;
  if (i < parts.length && ['users', 'home', 'root'].includes(parts[i].toLowerCase())) {
    i += 2;
  }

  while (i < parts.length - 1 && SKIP_PATH_SEGMENTS.has(parts[i].toLowerCase())) {
    i++;
  }

  const result = parts.slice(i).join('-');
  return result || dirName;
}

function extractTitle(messages) {
  for (const msg of messages) {
    if (msg.role === 'user' && msg.type === 'text' && msg.content?.trim().length > 5) {
      return msg.content.trim().slice(0, 80);
    }
  }
  return 'Untitled';
}

export function parseSessionFile(filePath) {
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  const messages = [];
  const toolNameById = {};

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let totalCost = 0;
  const modelsSet = new Set();
  let lastActivity = null;

  for (const line of lines) {
    const entry = parseLine(line);
    if (!entry || entry.isMeta) continue;

    const ts = entry.timestamp;
    if (ts && (!lastActivity || ts > lastActivity)) {
      lastActivity = ts;
    }

    if (entry.type === 'assistant' && entry.message) {
      const msg = entry.message;
      if (msg.model && msg.model !== '<synthetic>') {
        modelsSet.add(msg.model);
      }

      const usage = msg.usage || {};
      inputTokens += usage.input_tokens || 0;
      outputTokens += usage.output_tokens || 0;
      cacheTokens += (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
      totalCost += entry.costUSD || 0;

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text?.trim()) {
            messages.push({ role: 'assistant', type: 'text', content: block.text });
          } else if (block.type === 'tool_use') {
            toolNameById[block.id] = block.name;
            messages.push({
              role: 'assistant',
              type: 'tool_use',
              toolId: block.id,
              name: block.name,
              input: block.input || {}
            });
          }
        }
      }
    }

    if (entry.type === 'user' && entry.message) {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            const text =
              typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content
                      .filter((b) => b.type === 'text')
                      .map((b) => b.text)
                      .join('\n')
                  : '';
            messages.push({
              role: 'user',
              type: 'tool_result',
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
    inputTokens,
    outputTokens,
    cacheTokens,
    totalCost,
    models: [...modelsSet],
    lastActivity
  };
}

export function listSessions() {
  if (!existsSync(projectsDir())) return { projects: [] };

  const dirs = readdirSync(projectsDir(), { withFileTypes: true }).filter((d) => d.isDirectory());
  const projects = [];

  for (const dir of dirs) {
    const dirPath = join(projectsDir(), dir.name);
    let files;
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    if (!files.length) continue;

    const sessions = [];
    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      try {
        const parsed = parseSessionFile(join(dirPath, file));
        sessions.push({
          id: sessionId,
          projectDir: dir.name,
          source: 'claude',
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

    if (!sessions.length) continue;
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

export function readSession(projectDir, sessionId) {
  const filePath = join(projectsDir(), projectDir, `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return null;

  const parsed = parseSessionFile(filePath);
  return {
    id: sessionId,
    projectDir,
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

export function searchSessions(query) {
  if (!query?.trim()) return { query: query || '', results: [] };
  if (!existsSync(projectsDir())) return { query, results: [] };

  const q = query.trim().toLowerCase();
  const results = [];
  const dirs = readdirSync(projectsDir(), { withFileTypes: true }).filter((d) => d.isDirectory());

  for (const dir of dirs) {
    const dirPath = join(projectsDir(), dir.name);
    let files;
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      try {
        const parsed = parseSessionFile(join(dirPath, file));
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
          results.push({
            id: sessionId,
            projectDir: dir.name,
            source: 'claude',
            projectName: decodeDirName(dir.name),
            title: extractTitle(parsed.messages),
            lastActivity: parsed.lastActivity || '',
            snippets
          });
        }
      } catch {
        continue;
      }
    }
  }

  results.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return { query, results };
}

export function getProjectStats() {
  const dir = projectsDir();
  if (!existsSync(dir)) return [];

  // 1. Build token counts from local JSONL scan
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

  // 2. Pull costs from ccusage and attribute to the correct project dir.
  // ccusage returns one entry per physical session (JSONL file or worktree).
  // A project may have multiple entries (main session + subagent sessions) — all
  // are accumulated intentionally; this is not double-counting.
  const ccusage = fetchCcusageSessions();
  for (const s of (ccusage?.sessions || [])) {
    let key = s.sessionId;
    if (!byDir.has(key) && s.projectPath && s.projectPath !== 'Unknown Project') {
      key = String(s.projectPath).split('/')[0];
    }
    if (byDir.has(key)) {
      byDir.get(key).totalCost += Number(s.totalCost) || 0;
    }
  }

  return [...byDir.values()].sort((a, b) => b.totalCost - a.totalCost);
}

export function getDailyActivity(sinceMs) {
  if (!existsSync(projectsDir())) return [];

  const byDate = {};
  const dirs = readdirSync(projectsDir(), { withFileTypes: true }).filter((d) => d.isDirectory());

  for (const dir of dirs) {
    const dirPath = join(projectsDir(), dir.name);
    let files;
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

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
            (usage.input_tokens || 0) +
            (usage.output_tokens || 0) +
            (usage.cache_creation_input_tokens || 0) +
            (usage.cache_read_input_tokens || 0);
          byDate[date].cost += entry.costUSD || 0;
        }
      } catch {
        continue;
      }
    }
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}
