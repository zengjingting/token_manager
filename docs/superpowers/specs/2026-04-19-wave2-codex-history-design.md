# Wave 2: Codex Session History Integration — Design Spec

**Goal:** Integrate Codex session history into the existing History tab, so users can browse, view, search, and export Codex conversations alongside Claude sessions in a unified interface.

**Architecture:** A new `codex-chat-reader.js` backend module parses Codex JSONL files (`~/.codex/sessions/`) into the same data structures used by Claude's `chat-reader.js`. The `server.js` API layer merges both sources at response time. The frontend `history.js` adds source labels and passes a `source` parameter for routing, but otherwise reuses all existing rendering logic.

**Tech Stack:** Node 22, ES modules, Express, vanilla JS + Chart.js frontend, `node:test` for backend tests.

---

## Data Sources

### Claude sessions
- Location: `~/.claude/projects/<encoded-dir>/*.jsonl`
- Format: One JSON object per line with `type: 'user' | 'assistant'`, `message`, `timestamp`, `costUSD`, etc.
- Existing reader: `readers/chat-reader.js`

### Codex sessions
- Location: `~/.codex/sessions/YYYY/MM/DD/<name>.jsonl`
- Format: OpenAI Responses API format — entry types: `session_meta`, `response_item`, `event_msg`, `turn_context`
- `session_meta.payload.cwd`: working directory (used for project grouping)
- `response_item.payload`: messages with `role` + `content[]` containing `input_text`, `output_text`, `function_call`, `function_call_output`
- `event_msg` with `payload.type: 'token_count'`: token usage data
- Existing reader for dashboard tokens: `readers/codex-reader.js` (does NOT parse conversation messages)

---

## Backend

### New file: `readers/codex-chat-reader.js`

Parses Codex JSONL files for conversation history. Exports:

#### `parseCodexSessionFile(filePath)`
Returns:
```
{
  messages: Array<{ role, type, content, name?, input?, toolId? }>,
  inputTokens: number,
  outputTokens: number,
  cacheTokens: number,
  totalCost: 0,          // Codex JSONL has no cost data
  models: string[],
  lastActivity: string,  // ISO timestamp
  cwd: string            // from session_meta
}
```

Message type mapping from Codex JSONL → unified format:
| Codex entry | Unified output |
|---|---|
| `response_item`, `role: user`, content block `type: input_text` | `{ role: 'user', type: 'text', content }` |
| `response_item`, `role: assistant`, content block `type: output_text` | `{ role: 'assistant', type: 'text', content }` |
| `response_item`, `role: assistant`, content block `type: function_call` | `{ role: 'assistant', type: 'tool_use', name, input }` — `input` is parsed from the `arguments` JSON string |
| `response_item`, `type: function_call_output` | `{ role: 'user', type: 'tool_result', name, content }` — `content` is `payload.output` string |

Skipped entries: `session_meta` (read only for `cwd`), `event_msg` (read only for token counts), `turn_context`, `response_item` with `type: reasoning`.

Token counting: extracted from `event_msg` entries with `payload.type: 'token_count'` and `payload.info.last_token_usage`, same logic as existing `codex-reader.js`.

Model detection: from `turn_context.payload.model` or `session_meta.payload` fields.

#### `listCodexSessions()`
- Recursively scans `~/.codex/sessions/` for `.jsonl` files
- Parses each file, extracts `cwd` from `session_meta`
- Groups sessions by encoded project directory name
- Returns `{ projects: [{ dirName, name, sessions: [...] }] }` — same shape as `chat-reader.listSessions()`
- Each session object includes `source: 'codex'`

#### `readCodexSession(sessionId)`
- `sessionId` is the relative path from `~/.codex/sessions/` without `.jsonl` (e.g. `2026/04/10/rollout-2026-04-10T09-31-45-...`)
- Returns full session with messages, or `null` if not found
- Includes `source: 'codex'`

#### `searchCodexSessions(query)`
- Full-text search across all Codex session text messages
- Returns `{ query, results: [{ id, projectDir, projectName, title, lastActivity, snippets, source: 'codex' }] }`
- Same snippet format as `chat-reader.searchSessions()`

### cwd to encoded directory name

Conversion rule:
```
/Users/ting/Documents/granola_cn
→ strip leading /
→ replace all / with -
→ prepend -
→ -Users-ting-Documents-granola_cn
```

This matches Claude's `~/.claude/projects/` directory naming convention.

### Modified: `server.js`

Three endpoints modified, no new endpoints:

#### `GET /api/history/sessions`
- Calls `listSessions()` and `listCodexSessions()`
- Merges projects by encoded dir name: if both sources have sessions for the same project, combine into one project group
- Projects only in Codex get a new project entry using `decodeDirName()` for display
- Claude sessions get `source: 'claude'` (if not already set)
- All sessions within a project sorted by `lastActivity` descending
- Projects sorted by most recent session `lastActivity` descending

#### `GET /api/history/session?project=X&id=Y&source=Z`
- New `source` query parameter
- `source=codex` → `readCodexSession(id)` (project param ignored — Codex sessions located by id path)
- `source=claude` or omitted → existing `readSession(project, id)`

#### `GET /api/search?q=X`
- Calls both `searchSessions(q)` and `searchCodexSessions(q)`
- Merges results, sorted by `lastActivity` descending
- Each result includes `source` field

### Modified: `readers/chat-reader.js`

Minimal change: `listSessions()` adds `source: 'claude'` to each session object. No other changes needed.

---

## Frontend

### Modified: `public/history.js`

#### Session list (sidebar)
- `renderSessionItem(s)`: adds a `.src-badge` label (`claude` or `codex`) next to session title
- Badge CSS classes: `.src-claude`, `.src-codex` — already defined in `style.css` from dashboard work
- `selectSession(projectDir, sessionId, source)`: passes `source` parameter to `/api/history/session`

#### Conversation viewer (right panel)
- `renderViewer(session)`: adds source badge in the meta information line below the title
- `renderMessage`: no changes — Codex messages already mapped to unified format by backend
- Tool call toggle, pagination, rename: all reused as-is

#### Search results
- Each result item shows source badge
- Click handler passes `source` to `selectSession`

#### Markdown export
- `exportMarkdown()`: adds `**Source:** Claude Code` or `**Source:** Codex` in the meta header
- Message rendering unchanged (unified format)

#### No changes needed
- CSS: `.src-badge`, `.src-claude`, `.src-codex` already exist
- Custom titles (localStorage): Codex session IDs are unique (contain UUID), no collision with Claude IDs

---

## Testing

### Unit tests: `tests/codex-chat-reader.test.js`
- `parseCodexSessionFile`: verify message extraction (user text, assistant text, function_call, function_call_output), token counting, model detection, cwd extraction
- `listCodexSessions`: verify project grouping by cwd
- `searchCodexSessions`: verify text matching and snippet generation
- Use fixture data matching real Codex JSONL format (from `session_meta` + `response_item` + `event_msg` entries)
- Test with `CODEX_SESSIONS_DIR` env override for isolation

### Integration smoke test
- Server running, hit `/api/history/sessions` and verify Codex sessions appear mixed with Claude sessions
- Load a Codex session in the viewer, verify messages render correctly
- Search for text that exists in a Codex session, verify it appears in results
- Export a Codex session as Markdown, verify format

---

## Out of scope (deferred)
- Codex session cost computation (currently $0.00 — would need `ccusage-codex session` integration)
- Session deletion
- Custom title sync to dashboard
- In-session search (search within a single conversation)
