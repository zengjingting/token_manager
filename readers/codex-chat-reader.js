import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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
