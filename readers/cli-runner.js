import { spawnSync } from 'child_process';

// Absolute paths — required for launchd (runs with minimal PATH, no shell profile)
// Run as `node <script>` to bypass shebang env lookup which fails under launchd
const NODE    = '/opt/homebrew/opt/node@22/bin/node';
const CCUSAGE = '/opt/homebrew/bin/ccusage';
const CODEX   = '/opt/homebrew/bin/ccusage-codex';  // @ccusage/codex (NOT the OpenAI codex agent)

function toYYYYMMDD(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function run(bin, args) {
  // Invoke as `node <script> ...args` so the shebang env-lookup is bypassed
  const result = spawnSync(NODE, [bin, ...args, '--json'], {
    encoding: 'utf-8',
    timeout: 30_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${bin} exited with status ${result.status}`);
  return JSON.parse(result.stdout);
}

/** Claude daily: { daily: [...], totals: {...} } */
export function getClaudeDailyData(since, until) {
  const args = ['daily'];
  if (since) args.push('--since', toYYYYMMDD(since));
  if (until) args.push('--until', toYYYYMMDD(until));
  return run(CCUSAGE, args);
}

/** Claude sessions: { sessions: [...] } */
export function getClaudeSessionData(since, until) {
  const args = ['session'];
  if (since) args.push('--since', toYYYYMMDD(since));
  if (until) args.push('--until', toYYYYMMDD(until));
  return run(CCUSAGE, args);
}

/** Codex daily: { daily: [...], totals: {...} } */
export function getCodexDailyData(since, until) {
  const args = ['daily'];
  if (since) args.push('--since', toISODate(since));
  if (until) args.push('--until', toISODate(until));
  return run(CODEX, args);
}

/** Codex sessions: { sessions: [...] } */
export function getCodexSessionData(since, until) {
  const args = ['session'];
  if (since) args.push('--since', toISODate(since));
  if (until) args.push('--until', toISODate(until));
  return run(CODEX, args);
}
