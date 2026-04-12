// history.js — History tab: session list, viewer, search, export

let historyLoaded = false;
let allProjects = [];
let activeSessionId = null;

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

  // Delegated click listener for project headers
  list.addEventListener('click', e => {
    const header = e.target.closest('[data-toggle-dir]');
    if (header) { toggleProject(header.dataset.toggleDir); return; }
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
  // No onclick — handled by delegated listener in renderProjectList
  return `
    <div class="session-item" data-id="${esc(s.id)}" data-proj="${esc(s.projectDir)}">
      <div class="session-title">${esc(s.title)}</div>
      <div class="session-meta">
        <span>${ts}</span>
        <span>${fmtK(tokens)} tok</span>
        <span>$${(s.totalCost||0).toFixed(4)}</span>
      </div>
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

// ── Stub: renderViewer will be replaced in Task 7 ─────────────────────────
function renderViewer(session) {
  document.getElementById('historyViewer').innerHTML =
    `<div style="padding:24px;color:var(--text-dim);font-size:12px">Session loaded: ${esc(session.title)} (${session.messages?.length ?? 0} messages)</div>`;
}
