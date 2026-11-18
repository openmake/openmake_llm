// Shared fixtures for CLI tests: a temporary HOME with a saved config and a fake server
// (HTTP + WebSocket on one port) that records what the built CLI sends. Not a test file itself.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

export const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));
export const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

/** Temporary HOME. `serverUrl` (optional) is saved to ~/.openmake/config.json. */
export function tempHome(t, { serverUrl, hostId } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'omk-cli-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, '.openmake');
  mkdirSync(dir, { recursive: true });
  if (serverUrl) writeFileSync(join(dir, 'config.json'), JSON.stringify({ serverUrl, apiKey: 'omk_live_fixture' }));
  if (hostId) writeFileSync(join(dir, 'device-id'), hostId);
  return home;
}

/** Runs the built CLI with HOME=home (plus `env`) and resolves { code, out, err }. stdin is not a TTY. */
export function runCli(home, args, { cwd, timeoutMs = 20000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { PATH: process.env.PATH, HOME: home, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`CLI timed out: ${out}\n${err}`)); }, timeoutMs);
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

/**
 * Fake OpenMake server. `routes(method, url, body)` may return a JSON value to override the default.
 * Records every HTTP request and every bridge_hello. Sends bridge_ready after each hello and lists
 * connected hellos in /api/local-bridge/status.
 */
export async function fakeServer(t, routes = () => undefined) {
  const requests = [];
  const hellos = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, url: req.url, body });
      let out = routes(req.method, req.url, body);
      if (out === undefined) {
        if (req.url === '/api/local-bridge/status') out = { enabled: true, devices: hellos.map(h => ({ deviceId: h.deviceId, label: h.label, folderName: h.folderName })) };
        else if (req.url.startsWith('/api/agent-tasks/approvals/pending')) out = { pending: [] };
        else if (req.method === 'POST' && req.url === '/api/agent-tasks') out = { task: { id: 'task-1', status: 'pending' } };
        else if (req.url.startsWith('/api/agent-tasks?')) out = { tasks: [], total: 0 };
        else if (req.url === '/api/agent-tasks/task-1') out = { task: { id: 'task-1', status: 'completed', progress: 100 } };
        else out = {};
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', ws => {
    ws.on('message', d => {
      const m = JSON.parse(String(d));
      if (m.type === 'bridge_hello') { hellos.push(m); ws.send(JSON.stringify({ type: 'bridge_ready' })); }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { for (const c of wss.clients) c.terminate(); wss.close(); server.close(r); }));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, hellos };
}
