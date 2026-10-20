import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
function signalGroup(child, signal) {
  if (!child?.pid) return false;
  try { process.kill(-child.pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
// Group lifetime is independent of the leader's exitCode: npm may exit before its child.
export async function stopGroup(child, { graceMs = 5000 } = {}) {
  if (!signalGroup(child, 'SIGTERM')) return;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    await delay(Math.min(25, deadline - Date.now()));
    if (!signalGroup(child, 0)) return;
  }
  signalGroup(child, 'SIGKILL');
  // Give the OS an opportunity to reap the killed group before deleting its working tree.
  await delay(25);
}
export function runCommand(bin, args, { cwd, env, signal, timeoutMs = 10 * 60_000, graceMs = 5000, stdio = 'inherit' } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio, detached: true });
    let interruption, stopping;
    const interrupt = error => {
      interruption ||= error;
      stopping ||= stopGroup(child, { graceMs });
    };
    const abort = () => interrupt(new Error(`${bin} aborted: ${signal.reason?.message || signal.reason || 'signal'}`));
    const timer = setTimeout(() => interrupt(new Error(`${bin} timed out after ${timeoutMs}ms`)), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const finish = async error => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try {
        // Never cancel the group's KILL deadline because the leader exited on TERM.
        await (stopping || stopGroup(child, { graceMs }));
        if (interruption || error) reject(interruption || error); else resolve();
      } catch (cleanupError) { reject(cleanupError); }
    };
    child.once('error', finish);
    child.once('exit', (code, exitSignal) => { void finish(code === 0 ? null : new Error(`${bin} failed: ${code ?? exitSignal}`)); });
    if (signal?.aborted) abort();
  });
}
