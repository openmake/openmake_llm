#!/usr/bin/env node
// Local: TEST_DATABASE_URL=postgresql://.../openmake_llm_test npm run test:dev -- <full SHA>
// Requires local PostgreSQL role with CREATEDB + pgvector. Never reads .env or operational DB.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { changedFiles, runFeatures } from './feature-checks.mjs';
import { isolatedDatabase, startModelFixture, assertChat, MODEL } from './dev-checks-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');
function killGroup(child, signal) {
  if (!child?.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function command(bin, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: 'inherit', detached: true });
    let timedOut = false, force;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      force = setTimeout(() => killGroup(child, 'SIGKILL'), 5000);
    }, 10 * 60_000);
    const finish = error => { clearTimeout(timer); clearTimeout(force); if (error) reject(error); else resolve(); };
    child.on('error', finish);
    child.on('exit', (code, signal) => finish(timedOut ? new Error(`${bin} timed out after 10 minutes`) : code === 0 ? null : new Error(`${bin} failed: ${code ?? signal}`)));
  });
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function request(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000), ...options });
  if (!response.ok) throw new Error(`HTTP ${response.status} at ${new URL(url).pathname}: ${(await response.text()).slice(0, 1000)}`);
  return response;
}
async function waitFor(url, child) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null) throw new Error(`App exited before ready (${child.exitCode})`);
    try { return await request(url, { signal: AbortSignal.timeout(1000) }); } catch { /* bounded startup polling */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Startup timed out: ${url}`);
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  killGroup(child, 'SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) { killGroup(child, 'SIGKILL'); await once(child, 'exit'); }
}
export async function main(sha) {
  const db = isolatedDatabase(process.env.TEST_DATABASE_URL);
  const change = changedFiles(sha);
  const startedAt = new Date().toISOString();
  const evidence = { schemaVersion: 1, stage: 'merged-dev', sha, base: change.base, startedAt, status: 'failed', checks: [] };
  const output = resolve(root, 'logs/dev-checks.json');
  const temporary = await mkdtemp(join(tmpdir(), 'omk-dev-checks-'));
  const checkout = join(temporary, 'checkout');
  const dbName = `pipeline_${Date.now()}_${process.pid}_test`;
  const admin = new Client({ connectionString: db.href });
  let connected = false, created = false, api, web, fixture;
  try {
    await admin.connect(); connected = true;
    await admin.query(`CREATE DATABASE "${dbName}"`); created = true;
    const isolated = new URL(db); isolated.pathname = `/${dbName}`;
    fixture = await startModelFixture();
    const apiPort = await freePort(), webPort = await freePort();
    await mkdir(join(temporary, 'home'));
    const env = {
      PATH: process.env.PATH, HOME: join(temporary, 'home'), TMPDIR: temporary,
      CI: 'true', NODE_ENV: 'test', DATABASE_URL: isolated.href, TEST_DATABASE_URL: isolated.href,
      JWT_SECRET: 'pipeline-disposable-jwt-secret-32bytes', API_KEY_PEPPER: 'pipeline-disposable-pepper',
      TOKEN_ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      LLM_BASE_URL: fixture.url, LLM_API_KEY: 'pipeline-fixture', LLM_DEFAULT_MODEL: MODEL,
      STORAGE_BACKEND: 'memory', REDIS_URL: '', PORT: String(apiPort), SERVER_HOST: '127.0.0.1',
      OMK_WEB_PORT: String(webPort), OMK_API_PORT: String(apiPort),
      API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`, CORS_ORIGINS: `http://127.0.0.1:${webPort}`,
      NEXT_TELEMETRY_DISABLED: '1', CSRF_PROTECTION: 'enforce',
    };
    // A fresh local clone excludes all untracked .env, operational data and developer credentials.
    await command('git', ['clone', '--shared', '--no-checkout', root, checkout], temporary, env);
    await command('git', ['checkout', '--detach', sha], checkout, env);
    await command('npm', ['ci', '--include=dev'], checkout, env);
    await command('npm', ['run', 'build'], checkout, { ...env, NODE_ENV: 'production' });
    const build = JSON.parse(await readFile(join(checkout, 'apps/api/dist/build-info.json')));
    if (!build.gitHash || !sha.startsWith(build.gitHash) || build.gitHash === 'unknown') throw new Error('Build SHA does not match tested checkout');
    await readFile(join(checkout, 'apps/web/.next/BUILD_ID'));
    evidence.checks.push('isolated-build-identity');
    await command('bash', ['scripts/setup-test-db.sh'], checkout, env);
    evidence.checks.push('isolated-db-migrations');
    evidence.features = runFeatures(change.files, { cwd: checkout, env });
    evidence.checks.push('selected-feature-tests');
    api = spawn(process.execPath, ['apps/api/dist/server.js'], { cwd: checkout, env, stdio: 'inherit', detached: true });
    const apiURL = `http://127.0.0.1:${apiPort}`;
    const health = await (await waitFor(`${apiURL}/health`, api)).json();
    if (!JSON.stringify(health).includes(build.gitHash)) throw new Error('Running API health is missing tested build identity');
    evidence.checks.push('api-startup-health');
    const csrfResponse = await request(`${apiURL}/api/csrf-token`);
    const { token: csrf } = await csrfResponse.json();
    if (!csrf || !(csrfResponse.headers.get('set-cookie') || '').includes('csrf_token=')) throw new Error('Missing CSRF token/cookie');
    const post = (path, body, cookie) => request(`${apiURL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-CSRF-Token': csrf, cookie: `csrf_token=${csrf}${cookie ? `; ${cookie}` : ''}` }, body: JSON.stringify(body) });
    const password = 'PipelineFixture!2026';
    const email = `pipeline-${Date.now()}@local.test`;
    const signup = await (await post('/api/auth/register', { username: `pipeline-${Date.now()}`, email, password, agreedToTerms: true, agreedToPrivacy: true, consentLocale: 'ko', birthDate: '1990-01-01' })).json();
    const userId = signup.data?.user?.id || signup.data?.id;
    if (!userId) throw new Error('Registration returned no user ID');
    const fixtureDB = new Client({ connectionString: isolated.href });
    await fixtureDB.connect();
    try {
      const stored = await fixtureDB.query('SELECT id FROM users WHERE id=$1', [userId]);
      if (stored.rowCount !== 1) throw new Error('Registered user not persisted to isolated DB');
      await fixtureDB.query("UPDATE users SET role='admin' WHERE id=$1", [userId]);
    } finally { await fixtureDB.end(); }
    const login = await post('/api/auth/login', { email, password });
    const token = /auth_token=([^;]+)/.exec(login.headers.get('set-cookie') || '');
    if (!token) throw new Error('Login did not issue auth_token cookie');
    evidence.checks.push('register-db-persistence-login');
    const before = fixture.calls();
    const chat = await post('/api/chat/stream', { message: 'Reply briefly with a greeting.', model: MODEL }, `auth_token=${token[1]}`);
    assertChat(await chat.text());
    if (fixture.calls() <= before) throw new Error('Chat did not reach deterministic model fixture');
    evidence.checks.push('authenticated-chat-fixture-transport');
    web = spawn(process.execPath, [join(checkout, 'node_modules/next/dist/bin/next'), 'start', '-p', String(webPort), '-H', '127.0.0.1'], { cwd: join(checkout, 'apps/web'), env: { ...env, NODE_ENV: 'production' }, stdio: 'inherit', detached: true });
    const page = await waitFor(`http://127.0.0.1:${webPort}`, web);
    if (!(page.headers.get('content-type') || '').includes('text/html') || !(await page.text()).includes('<html')) throw new Error('Built web did not serve HTML');
    evidence.checks.push('built-web-startup-html');
    evidence.status = 'passed';
  } catch (error) { evidence.error = error.message; throw error; }
  finally {
    const cleanupErrors = [];
    const cleanup = async action => { try { await action(); } catch (error) { cleanupErrors.push(error.message); evidence.status = 'failed'; } };
    await cleanup(() => stop(web)); await cleanup(() => stop(api));
    if (fixture) await cleanup(() => new Promise(resolve => { fixture.server.closeAllConnections(); fixture.server.close(resolve); }));
    if (created) await cleanup(() => admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`));
    if (connected) await cleanup(() => admin.end());
    await cleanup(() => rm(temporary, { recursive: true, force: true }));
    if (cleanupErrors.length) evidence.cleanupErrors = cleanupErrors;
    evidence.finishedAt = new Date().toISOString();
    await mkdir(resolve(root, 'logs'), { recursive: true });
    await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
    console.log(`Dev checks ${evidence.status}: ${output}`);
    if (cleanupErrors.length) throw new Error(`Disposable cleanup failed: ${cleanupErrors.join('; ')}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
