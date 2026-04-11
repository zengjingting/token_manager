# Design: Dashboard History Browser + Enhanced Analytics

**Date:** 2026-04-11  
**Status:** Approved

## Overview

Enhance the existing Token Dashboard (local Express + vanilla JS web app) with three new capability modules inspired by the Claude Code History VSCode extension:

1. **Session History Browser** — browse actual conversation content from `~/.claude/projects/`
2. **Full-text Search + Markdown Export** — search across sessions, export a session to Markdown
3. **Enhanced Cost Analytics** — activity heatmap, project cost breakdown, billing window progress

The UI is restructured from a top-bar single-page layout to a **left sidebar + main content** layout. Everything stays in a single HTML page (no reloads).

Note: The VSCode extension source code is proprietary; all implementation is original, inspired by its feature design.

---

## Architecture

### File Structure

```
public/
  index.html      — HTML shell only (sidebar + content containers, no inline JS/CSS)
  style.css       — all styles (existing + new sidebar/history/heatmap styles)
  app.js          — dashboard tab logic (refactored from current index.html <script>)
  history.js      — history tab logic (new)
server.js         — existing routes + 5 new API routes
readers/
  claude-reader.js  — existing (unchanged)
  codex-reader.js   — existing (unchanged)
  cli-runner.js     — existing (unchanged)
  chat-reader.js    — NEW: reads ~/.claude/projects/ JSONL for messages
aggregators/
  normalize.js      — existing (unchanged)
```

### Page Layout

```
┌── 180px sidebar ──┬──────────────────────────────────────────┐
│  ▸ Token Dashboard│  [context bar: period selector OR search] │
│  ───────────────  ├──────────────────────────────────────────┤
│  [📊] 仪表盘      │                                          │
│  [💬] 会话历史    │   Main content area (view-switched)       │
│  ───────────────  │                                          │
│  Updated: HH:MM   │                                          │
│  [中] [EN]        │                                          │
└───────────────────┴──────────────────────────────────────────┘
```

---

## Tab 1: Dashboard (Enhanced)

Existing content preserved. A **概览 / 深度分析** toggle added to the dashboard header.

**概览 view** (default): existing stat cards + token bar chart + model doughnut + session table.

**深度分析 view** (new): three panels below existing stat cards:

1. **Activity Heatmap** — 90-day calendar grid (7 rows × ~13 cols). Each cell = one day. Color intensity maps to total daily tokens. Hover tooltip shows date + tokens + cost. Data from `/api/analytics/heatmap`.

2. **Project Cost Breakdown** — horizontal bar chart, one bar per project (directory name from `~/.claude/projects/`). Shows token count and cost. Data from `/api/analytics/projects`.

3. **Billing Window Progress** — reuses the existing 5h window data. Shows a progress bar: tokens used this billing window vs. a user-visible soft cap (display only, not enforced). Data from existing `/api/usage?period=5h`.

---

## Tab 2: Session History

Two-column layout inside the main content area.

### Left Panel (260px) — Session List

- Search bar at top: typing triggers `/api/search?q=xxx` and replaces the list with results
- When not searching: sessions grouped by project (collapsible), sorted by last activity
- Each session row: title (first user message, truncated), last activity timestamp, token count badge
- Clicking a session loads it in the right panel

### Right Panel — Conversation Viewer

- Session header: title, last activity, total tokens/cost, model(s) used
- **Export Markdown** button — client-side only, assembles messages into Markdown and triggers `<a download>`
- Message list:
  - **User** messages: left-labeled, full text
  - **Assistant** messages: left-labeled, text (markdown rendered as plain text with code blocks preserved)
  - **Tool Use** (tool calls): collapsed by default, shows tool name; expand to see input JSON
  - **Tool Result**: collapsed by default; expand to see output text
- Infinite-scroll or "load more" if session has > 100 messages

### Search Mode (left panel)

- Results replace session list
- Each result: session title + project name + 1–2 matching snippet lines with `<mark>` highlights
- Clicking result loads the session in right panel and scrolls to first match
- Clear search (×) returns to grouped session list

---

## New API Endpoints

### `GET /api/history/sessions`

Returns all Claude sessions grouped by project.

```json
{
  "projects": [
    {
      "name": "myproject",
      "path": "-Users-ting-Documents-myproject",
      "sessions": [
        {
          "id": "abc123",
          "project": "myproject",
          "title": "帮我写一个 Express 服务器...",
          "lastActivity": "2026-04-10T14:23:00Z",
          "messageCount": 42,
          "inputTokens": 12000,
          "outputTokens": 8000,
          "totalCost": 0.0124,
          "models": ["sonnet-4-6"]
        }
      ]
    }
  ]
}
```

### `GET /api/history/session/:encodedId`

Returns full message list for one session. `encodedId` = base64url of `projectPath/sessionFile`.

```json
{
  "id": "abc123",
  "title": "...",
  "messages": [
    { "role": "user", "type": "text", "content": "帮我..." },
    { "role": "assistant", "type": "text", "content": "好的..." },
    { "role": "assistant", "type": "tool_use", "name": "Bash", "input": { "command": "ls" } },
    { "role": "tool", "type": "tool_result", "name": "Bash", "content": "file1\nfile2" }
  ]
}
```

### `GET /api/search?q=TEXT`

Scans all session JSONL files for lines containing `TEXT` (case-insensitive). Returns matched sessions with snippets. No SQLite — plain file scan (sufficient for local use).

```json
{
  "query": "Express server",
  "results": [
    {
      "sessionId": "abc123",
      "project": "myproject",
      "title": "...",
      "snippets": ["...帮我写一个 **Express server**...", "..."]
    }
  ]
}
```

### `GET /api/analytics/heatmap`

Returns 90 days of daily activity data.

```json
{
  "days": [
    { "date": "2026-01-11", "tokens": 45000, "cost": 0.041 },
    ...
  ]
}
```

Data source: runs `ccusage daily --since 90d` (reuses existing cli-runner pattern).

### `GET /api/analytics/projects`

Returns per-project token and cost totals.

```json
{
  "projects": [
    { "name": "Token_dashboard", "tokens": 120000, "cost": 0.18 },
    ...
  ]
}
```

Data source: `chat-reader.js` scans `~/.claude/projects/` directories and aggregates usage data from JSONL files.

---

## New Reader: `chat-reader.js`

Reads `~/.claude/projects/` directory structure:

```
~/.claude/projects/
  -Users-ting-Documents-myproject/   ← project directory (encoded path)
    abc123.jsonl                      ← one file = one session
    def456.jsonl
```

### Key functions

**`listSessions()`** — scans all project dirs, reads each JSONL, extracts:
- Session ID (filename without `.jsonl`)
- Project name (last segment of decoded dir name)
- Title: first `role=user` + `type=text` content, truncated to 80 chars
- Last activity: timestamp of last entry
- Token/cost totals: from `usage` fields in assistant entries
- Models used

**`readSession(projectPath, sessionId)`** — reads one JSONL file, returns structured message list. Filters out internal metadata entries. Handles malformed lines gracefully.

**`searchSessions(query)`** — iterates all JSONL files, checks each text content line for case-insensitive match, returns matched sessions with up to 3 snippet strings.

**`getProjectStats()`** — aggregates token/cost per project directory.

**`getDailyActivity(since)`** — aggregates token usage by date across all sessions.

---

## i18n

New strings added to the existing `T.zh` / `T.en` objects in `app.js`. History tab labels, search placeholders, export button text, analytics panel titles — all bilingual.

---

## Error Handling

- If `~/.claude/projects/` does not exist: `/api/history/sessions` returns `{ projects: [] }`
- Malformed JSONL lines: skip silently
- Search with empty query: return `{ results: [] }`
- Session file not found: 404 with `{ error: 'Session not found' }`

---

## Scope Explicitly Out

- Codex session history browsing (Codex JSONL format differs significantly; defer to later)
- Session fork/resume (requires terminal integration)
- SQLite search index (plain file scan is sufficient for local use)
- File diff viewer (complex; not in scope)
- Community/leaderboard features
