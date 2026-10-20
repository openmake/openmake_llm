import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
export function handleSignalFailure(error, child, signal, snapshot) {
  const uid = process.getuid?.();
  const members = snapshot.status === 0 && !snapshot.error && !snapshot.signal && typeof snapshot.stdout === 'string' ? snapshot.stdout.split('\n').map(line => line.trim()).filter(line => line.split(/\s+/)[2] === String(child.pid)) : null;
  // Darwin may deny a signal-0 probe before Node reaps its exited child. Zombies
  // cannot execute; require every observed group member to be owned and a zombie.
  if (error.code === 'EPERM' && signal === 0 && uid !== undefined && members?.length && members.every(line => {
    const fields = line.split(/\s+/);
    return fields.length === 5 && /^\d+$/.test(fields[0]) && /^\d+$/.test(fields[1]) && fields[3] === String(uid) && fields[4].startsWith('Z');
  })) return false;
  error.message = `${error.message}; signal=${signal} pgid=${child.pid} uid=${uid ?? 'unknown'} leaderExit=${child.exitCode ?? child.signalCode ?? 'running'} members=[${(members || ['snapshot unavailable']).slice(0, 20).join('; ')}]`;
  throw error;
}
function signalGroup(child, signal) {
  if (!child?.pid) return false;
  try { process.kill(-child.pid, signal); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    const snapshot = spawnSync('ps', ['-axo', 'pid,ppid,pgid,uid,stat'], { encoding: 'utf8', timeout: 1000, maxBuffer: 256 * 1024 });
    return handleSignalFailure(error, child, signal, snapshot);
  }
}
// Group lifetime is independent of the leader's exitCode: npm may exit before its child.
export async function stopGroup(child, { graceMs = 5000 } = {}) {
  if (!signalGroup(child, 'SIGTERM')) return;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    await delay(Math.min(25, deadline - Date.now()));
    if (!signalGroup(child, 0)) { await delay(0); return; }
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
