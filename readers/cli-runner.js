import { spawnSync } from 'child_process';

function toYYYYMMDD(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function runNpx(pkg, args) {
  const result = spawnSync('npx', ['--yes', pkg, ...args, '--json'], {
    encoding: 'utf-8',
    timeout: 30_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${pkg} failed (exit ${result.status}): ${result.stderr?.slice(0, 200)}`);
  return JSON.parse(result.stdout);
}

/** Claude daily: { daily: [...], totals: {...} } */
export function getClaudeDailyData(since, until) {
  const args = ['daily'];
  if (since) args.push('--since', toYYYYMMDD(since));
  if (until) args.push('--until', toYYYYMMDD(until));
  return runNpx('ccusage', args);
}

/** Claude sessions: { sessions: [...] } */
export function getClaudeSessionData(since, until) {
  const args = ['session'];
  if (since) args.push('--since', toYYYYMMDD(since));
  if (until) args.push('--until', toYYYYMMDD(until));
  return runNpx('ccusage', args);
}

/** Codex daily: { daily: [...], totals: {...} } */
export function getCodexDailyData(since, until) {
  const args = ['daily'];
  if (since) args.push('--since', toISODate(since));
  if (until) args.push('--until', toISODate(until));
  return runNpx('@ccusage/codex', args);
}

/** Codex sessions: { sessions: [...] } */
export function getCodexSessionData(since, until) {
  const args = ['session'];
  if (since) args.push('--since', toISODate(since));
  if (until) args.push('--until', toISODate(until));
  return runNpx('@ccusage/codex', args);
}
