import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { decodeDirName } from './chat-reader.js';

const DEFAULT_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
function sessionsDir() { return process.env.CODEX_SESSIONS_DIR || DEFAULT_SESSIONS_DIR; }

function cwdToEncodedDir(cwd) {
  if (!cwd) return null;
  return '-' + cwd.replace(/^\//, '').replace(/\//g, '-');
}

function parseLine(line) {
  if (!line.trim()) return null;
  try { return JSON.parse(line); } catch { return null; }
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

      if (p.type === 'reasoning') continue;
      if (p.type === 'message' && p.role === 'developer') continue;

      if (p.type === 'message') {
        const contentBlocks = p.content || [];
        for (const block of contentBlocks) {
          if (p.role === 'user' && block.type === 'input_text') {
            const text = (block.text || '').trim();
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

      if (p.type === 'custom_tool_call') {
        toolNameById[p.call_id] = p.name;
        messages.push({
          role: 'assistant',
          type: 'tool_use',
          toolId: p.call_id,
          name: p.name,
          input: p.input || {}
        });
      }

      if (p.type === 'custom_tool_call_output') {
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
