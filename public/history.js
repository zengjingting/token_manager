// history.js — History tab: session list, viewer, search, export

let historyLoaded = false;
let allProjects = [];
let activeSessionId = null;

// ── Custom session title persistence (localStorage) ───────────────────────
function getCustomTitle(id) {
  try { return localStorage.getItem('claude-session-name-' + id) || null; } catch { return null; }
}
function setCustomTitle(id, title) {
  try {
    if (title) localStorage.setItem('claude-session-name-' + id, title);
    else localStorage.removeItem('claude-session-name-' + id);
  } catch {}
}

// ── Load and render session list ──────────────────────────────────────────
async function loadHistorySessions() {
  if (historyLoaded) return;
  historyLoaded = true;
  renderSessionListLoading();

  try {
    const data = await fetch('/api/history/sessions').then(r => r.json());
    allProjects = data.projects || [];
    renderProjectList(allProjects);
  } catch {
    document.getElementById('historyList').innerHTML =
      '<div class="placeholder" style="padding:24px">加载失败，请刷新重试</div>';
    historyLoaded = false; // allow retry
  }
}

function renderSessionListLoading() {
  document.getElementById('historyList').innerHTML =
    '<div class="placeholder" style="padding:24px">加载中...</div>';
}

// Use encodeURIComponent for ID suffixes — avoids esc() mismatch when dirName
// contains &, <, >, " (esc would encode them but getElementById gets the raw string)
function dirId(dirName) { return encodeURIComponent(dirName); }

function renderProjectList(projects) {
  const list = document.getElementById('historyList');
  if (!projects.length) {
    list.innerHTML = '<div class="placeholder" style="padding:24px">暂无会话记录</div>';
    return;
  }

  // Use data-dir on each header; click delegation avoids onclick JS-string injection
  list.innerHTML = projects.map(proj => `
    <div class="project-group" data-dir="${esc(proj.dirName)}">
      <div class="project-header" data-toggle-dir="${esc(proj.dirName)}">
        <span>${esc(proj.name)}</span>
        <span>
          <span class="project-count">${proj.sessions.length}</span>
          <span class="project-toggle" id="ptoggle-${dirId(proj.dirName)}">▸</span>
        </span>
      </div>
      <div class="project-sessions" id="psessions-${dirId(proj.dirName)}">
        ${proj.sessions.map(s => renderSessionItem(s)).join('')}
      </div>
    </div>`
  ).join('');

  // Delegated click listener for project headers, copy buttons, and session items
  list.addEventListener('click', e => {
    const header = e.target.closest('[data-toggle-dir]');
    if (header) { toggleProject(header.dataset.toggleDir); return; }
    const copyBtn = e.target.closest('.session-copy-btn[data-copy-id]');
    if (copyBtn) {
      e.stopPropagation();
      const id = copyBtn.dataset.copyId;
      navigator.clipboard.writeText(id).catch(() => {});
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = '⧉'; }, 1400);
      return;
    }
    const item = e.target.closest('.session-item[data-id]');
    if (item) selectSession(item.dataset.proj, item.dataset.id);
  });

  // Auto-open the first project
  if (projects[0]) toggleProject(projects[0].dirName);
}

function renderSessionItem(s) {
  const ts = s.lastActivity
    ? new Date(s.lastActivity).toLocaleString('zh-CN',
        { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';
  const tokens = (s.inputTokens||0) + (s.outputTokens||0) + (s.cacheTokens||0);
  const displayTitle = getCustomTitle(s.id) || s.title;
  // No onclick — handled by delegated listener in renderProjectList
  return `
    <div class="session-item" data-id="${esc(s.id)}" data-proj="${esc(s.projectDir)}">
      <div class="session-item-main">
        <div class="session-title">${esc(displayTitle)}</div>
        <div class="session-meta">
          <span>${ts}</span>
          <span>${fmtK(tokens)} tok</span>
          <span>$${(s.totalCost||0).toFixed(4)}</span>
        </div>
      </div>
      <button class="session-copy-btn" data-copy-id="${esc(s.id)}" title="${esc(s.id)}">⧉</button>
    </div>`;
}

function toggleProject(dirName) {
  const el = document.getElementById(`psessions-${dirId(dirName)}`);
  const tog = document.getElementById(`ptoggle-${dirId(dirName)}`);
  if (!el) return;
  const isOpen = el.classList.toggle('open');
  if (tog) tog.textContent = isOpen ? '▾' : '▸';
}

function fmtK(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(0)+'K';
  return String(n);
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Session selection ──────────────────────────────────────────────────────
async function selectSession(projectDir, sessionId) {
  document.querySelectorAll('.session-item, .session-search-item').forEach(el =>
    el.classList.remove('active'));
  // Read from data-* attributes via delegated listener — no CSS selector injection risk
  const itemEl = document.querySelector(
    `.session-item[data-id="${CSS.escape(sessionId)}"][data-proj="${CSS.escape(projectDir)}"]`);
  if (itemEl) itemEl.classList.add('active');

  activeSessionId = sessionId;
  renderViewerLoading();

  try {
    const session = await fetch(
      `/api/history/session?project=${encodeURIComponent(projectDir)}&id=${encodeURIComponent(sessionId)}`
    ).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
    renderViewer(session);
  } catch {
    document.getElementById('historyViewer').innerHTML =
      '<div class="placeholder" style="padding:48px;text-align:center">加载失败</div>';
  }
}

function renderViewerLoading() {
  document.getElementById('historyViewer').innerHTML =
    '<div class="placeholder" style="padding:48px;text-align:center">加载中...</div>';
}

// ── Conversation viewer rendering ─────────────────────────────────────────
const MESSAGES_PER_PAGE = 100;
let viewerSession = null;
let viewerShown = 0;

function renderViewer(session) {
  viewerSession = session;
  viewerShown = Math.min(MESSAGES_PER_PAGE, session.messages.length);

  const totalTok = (session.inputTokens||0)+(session.outputTokens||0)+(session.cacheTokens||0);
  const ts = session.lastActivity
    ? new Date(session.lastActivity).toLocaleString('zh-CN')
    : '';

  const customTitle = getCustomTitle(session.id);
  const displayTitle = customTitle || session.title;
  const toolCount = session.messages.filter(m => m.type === 'tool_use' || m.type === 'tool_result').length;

  const viewer = document.getElementById('historyViewer');
  viewer.innerHTML = `
    <div class="viewer-header">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:flex-start;gap:4px;flex-wrap:wrap">
          <span class="viewer-title" id="viewerTitleText">${esc(displayTitle)}</span>
          <button class="rename-btn" id="renameBtn" title="重命名">✎</button>
        </div>
        <div class="viewer-meta">
          ${ts} · ${fmtK(totalTok)} tokens · $${(session.totalCost||0).toFixed(4)} ·
          ${(session.models||[]).map(m => esc(m.replace(/^claude-/,''))).join(', ')}
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:flex-start;flex-shrink:0">
        ${toolCount > 0 ? `<button class="toggle-tools-btn" id="toggleToolsBtn">展示工具调用记录 (${toolCount})</button>` : ''}
        <button class="export-btn" id="exportBtn">↓ Markdown</button>
      </div>
    </div>
    <div id="messageList"></div>
    ${session.messages.length > MESSAGES_PER_PAGE
      ? `<div class="msg-load-more"><button id="loadMoreBtn">加载更多 (${session.messages.length - viewerShown} 条)</button></div>`
      : ''}`;

  document.getElementById('exportBtn').addEventListener('click', exportMarkdown);

  // Tool messages toggle (hidden by default via CSS)
  const toggleToolsBtn = document.getElementById('toggleToolsBtn');
  if (toggleToolsBtn) {
    toggleToolsBtn.addEventListener('click', () => {
      const msgList = document.getElementById('messageList');
      const showing = msgList.classList.toggle('show-tools');
      toggleToolsBtn.classList.toggle('active', showing);
      toggleToolsBtn.textContent = showing ? '隐藏工具调用记录' : `展示工具调用记录 (${toolCount})`;
    });
  }

  // Contenteditable inline rename
  const renameBtn = document.getElementById('renameBtn');
  const titleEl   = document.getElementById('viewerTitleText');
  if (renameBtn && titleEl) {
    renameBtn.addEventListener('click', () => {
      if (titleEl.contentEditable === 'true') return;
      titleEl.contentEditable = 'true';
      titleEl.focus();
      const range = document.createRange();
      range.selectNodeContents(titleEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    titleEl.addEventListener('blur', () => {
      if (titleEl.contentEditable !== 'true') return;
      titleEl.contentEditable = 'false';
      const newTitle = titleEl.textContent.trim() || session.title;
      setCustomTitle(session.id, newTitle !== session.title ? newTitle : null);
      titleEl.textContent = newTitle;
      const listItem = document.querySelector(`.session-item[data-id="${CSS.escape(session.id)}"]`);
      if (listItem) {
        const t = listItem.querySelector('.session-title');
        if (t) t.textContent = newTitle;
      }
    });
    titleEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
      if (e.key === 'Escape') {
        titleEl.textContent = getCustomTitle(session.id) || session.title;
        titleEl.contentEditable = 'false';
      }
    });
  }

  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMoreMessages);

  // Attach tool expand/collapse once per session load (not per page)
  const msgList = document.getElementById('messageList');
  if (msgList) {
    msgList.addEventListener('click', e => {
      const label = e.target.closest('.msg-tool .msg-label');
      if (label) {
        const tool = label.closest('.msg-tool');
        if (!tool) return;
        const body = tool.querySelector('.tool-body');
        const tog = tool.querySelector('.tool-toggle');
        if (!body) return;
        const open = body.classList.toggle('open');
        if (tog) tog.textContent = open ? '▾ 折叠' : '▸ 展开';
      }
    });
  }

  renderMessages(session.messages.slice(0, viewerShown));
}

function renderMessages(messages) {
  const list = document.getElementById('messageList');
  if (!list) return;
  list.innerHTML = messages.map((msg, idx) => renderMessage(msg, idx)).join('');
}

function loadMoreMessages() {
  if (!viewerSession) return;
  viewerShown = Math.min(viewerShown + MESSAGES_PER_PAGE, viewerSession.messages.length);
  renderMessages(viewerSession.messages.slice(0, viewerShown));

  const loadMore = document.querySelector('.msg-load-more');
  if (loadMore) {
    const remaining = viewerSession.messages.length - viewerShown;
    if (remaining <= 0) loadMore.remove();
    else {
      const btn = loadMore.querySelector('button');
      if (btn) btn.textContent = `加载更多 (${remaining} 条)`;
    }
  }
}

function renderMessage(msg, idx) {
  if (msg.role === 'user' && msg.type === 'text') {
    return `<div class="message msg-user">
      <div class="msg-label">USER</div>
      <div class="msg-text">${esc(msg.content)}</div>
    </div>`;
  }

  if (msg.role === 'assistant' && msg.type === 'text') {
    return `<div class="message msg-assistant">
      <div class="msg-label">ASSISTANT</div>
      <div class="msg-text">${esc(msg.content)}</div>
    </div>`;
  }

  if (msg.type === 'tool_use') {
    const inputJson = esc(JSON.stringify(msg.input, null, 2));
    return `<div class="message msg-tool">
      <div class="msg-label">
        <span>⚙ ${esc(msg.name)}</span>
        <span class="tool-toggle">▸ 展开</span>
      </div>
      <div class="tool-body">
        <div class="tool-input-pre">${inputJson}</div>
      </div>
    </div>`;
  }

  if (msg.type === 'tool_result') {
    const preview = esc((msg.content || '').slice(0, 500));
    const truncated = msg.content && msg.content.length > 500;
    return `<div class="message msg-tool">
      <div class="msg-label">
        <span>↩ ${esc(msg.name || 'Result')}</span>
        <span class="tool-toggle">▸ 展开</span>
      </div>
      <div class="tool-body">
        <div class="tool-input-pre">${preview}${truncated ? '\n...(truncated)' : ''}</div>
      </div>
    </div>`;
  }

  return '';
}

// ── Full-text search ───────────────────────────────────────────────────────
let searchMode = false;

function initHistorySearch() {
  const input = document.getElementById('historySearch');
  const searchBtn = document.getElementById('historySearchBtn');
  const clearBtn = document.getElementById('historyClearBtn');
  if (!input || !searchBtn || !clearBtn) return;

  searchBtn.addEventListener('click', () => runSearch(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(input.value); });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    searchMode = false;
    renderProjectList(allProjects);
  });

  // Delegated listener for search result clicks — attached once, not per search
  const list = document.getElementById('historyList');
  if (list) {
    list.addEventListener('click', e => {
      const item = e.target.closest('.session-search-item[data-id]');
      if (item) selectSession(item.dataset.proj, item.dataset.id);
    });
  }
}

async function runSearch(query) {
  if (!query.trim()) return;
  searchMode = true;
  document.getElementById('historyClearBtn').style.display = '';
  document.getElementById('historyList').innerHTML =
    '<div class="placeholder" style="padding:24px">搜索中...</div>';

  try {
    const data = await fetch(`/api/search?q=${encodeURIComponent(query)}`).then(r => r.json());
    const serverResults = data.results || [];

    // Also search local custom names (not already in server results)
    const serverIds = new Set(serverResults.map(r => r.id));
    const q = query.toLowerCase();
    const localMatches = [];
    for (const proj of allProjects) {
      for (const s of proj.sessions) {
        if (serverIds.has(s.id)) continue;
        const custom = getCustomTitle(s.id);
        if (custom && custom.toLowerCase().includes(q)) {
          localMatches.push({
            id: s.id,
            projectDir: s.projectDir,
            projectName: proj.name,
            title: custom,
            snippets: []
          });
        }
      }
    }

    renderSearchResults([...serverResults, ...localMatches], query);
  } catch {
    document.getElementById('historyList').innerHTML =
      '<div class="placeholder" style="padding:24px">搜索失败</div>';
  }
}

function renderSearchResults(results, query) {
  const list = document.getElementById('historyList');
  if (!results.length) {
    list.innerHTML = `<div class="placeholder" style="padding:24px">未找到匹配"${esc(query)}"的会话</div>`;
    return;
  }

  // Escape query through esc() so regex matches against already-entity-encoded text
  // and the matched portion is safe to reinsert into innerHTML via <mark>
  function highlight(text) {
    if (!query) return esc(text);
    const escapedQuery = esc(query);
    const re = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return esc(text).replace(re, '<mark>$1</mark>');
  }

  list.innerHTML = `<div style="font-size:10px;color:var(--text-dimmer);padding:6px 14px">找到 ${results.length} 个会话</div>` +
    results.map(r => `
      <div class="session-search-item" data-id="${esc(r.id)}" data-proj="${esc(r.projectDir)}">
        <div class="search-result-project">${esc(r.projectName)}</div>
        <div class="search-result-title">${esc(r.title)}</div>
        ${r.snippets.map(s =>
          `<div class="search-snippet">...${highlight(s)}...</div>`
        ).join('')}
      </div>`
    ).join('');
  // Click listener is registered once in initHistorySearch() — not repeated here
}

// ── Markdown export ────────────────────────────────────────────────────────
function exportMarkdown() {
  if (!viewerSession) return;
  const s = viewerSession;
  const lines = [];

  lines.push(`# ${s.title.replace(/[\r\n]/g, ' ')}`);
  lines.push('');
  lines.push(`**Session:** \`${s.id}\`  `);
  lines.push(`**Project:** ${s.projectDir}  `);
  lines.push(`**Last Activity:** ${s.lastActivity}  `);
  lines.push(`**Models:** ${(s.models||[]).join(', ')}  `);
  lines.push(`**Tokens:** ${(s.inputTokens||0)+(s.outputTokens||0)+(s.cacheTokens||0)}  `);
  lines.push(`**Cost:** $${(s.totalCost||0).toFixed(4)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of s.messages) {
    if (msg.role === 'user' && msg.type === 'text') {
      lines.push('**User:**');
      lines.push('');
      lines.push(msg.content);
      lines.push('');
    } else if (msg.role === 'assistant' && msg.type === 'text') {
      lines.push('**Assistant:**');
      lines.push('');
      lines.push(msg.content);
      lines.push('');
    } else if (msg.type === 'tool_use') {
      lines.push(`**Tool:** \`${msg.name}\``);
      lines.push('```json');
      lines.push(JSON.stringify(msg.input, null, 2));
      lines.push('```');
      lines.push('');
    } else if (msg.type === 'tool_result') {
      lines.push(`**Result:** \`${msg.name || 'Tool'}\``);
      lines.push('```');
      lines.push((msg.content || '').slice(0, 2000));
      lines.push('```');
      lines.push('');
    }
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${s.id.slice(0, 8)}-${s.title.slice(0, 30).replace(/[\\/:*?"<>|]+/g, '-')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Initialization ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initHistorySearch();
});
