#!/usr/bin/env node
// Local: TEST_DATABASE_URL=postgresql://.../openmake_llm_test npm run test:dev -- <full SHA>
// Requires local PostgreSQL role with CREATEDB + pgvector. Never reads .env or operational DB.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { runCommand, stopGroup } from './dev-checks-process.mjs';
import { changedFiles } from './feature-checks.mjs';
import { isolatedDatabase, startModelFixture, assertChat, MODEL } from './dev-checks-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = require('pg');
async function atomicEvidence(output, evidence) {
  await mkdir(resolve(output, '..'), { recursive: true });
  const pending = `${output}.${process.pid}.tmp`;
  await writeFile(pending, JSON.stringify(evidence, null, 2) + '\n');
  await rename(pending, output);
}
async function abortable(promise, signal) {
  signal.throwIfAborted();
  let abort;
  const interrupted = new Promise((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([promise, interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function httpRequest(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000), ...options });
  if (!response.ok) throw new Error(`HTTP ${response.status} at ${new URL(url).pathname}: ${(await response.text()).slice(0, 1000)}`);
  return response;
}
async function waitFor(url, child, signal) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null) throw new Error(`App exited before ready (${child.exitCode})`);
    signal?.throwIfAborted();
    try { return await httpRequest(url, { signal: AbortSignal.any([AbortSignal.timeout(1000), ...(signal ? [signal] : [])]) }); } catch { signal?.throwIfAborted(); }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Startup timed out: ${url}`);
}
export async function main(sha, { output = resolve(root, 'logs/dev-checks.json') } = {}) {
  const evidence = { schemaVersion: 1, stage: 'merged-dev', sha: sha ?? null, startedAt: new Date().toISOString(), status: 'failed', checks: [], error: 'Run incomplete' };
  // Invalidate old success atomically before even URL/SHA validation can fail.
  await atomicEvidence(output, evidence);
  const controller = new AbortController();
  const onSignal = signal => {
    const error = new Error(`Dev checks aborted by ${signal}`);
    evidence.status = 'failed'; evidence.error = error.message; controller.abort(error);
  };
  const onTerm = () => onSignal('SIGTERM'), onInt = () => onSignal('SIGINT');
  process.once('SIGTERM', onTerm); process.once('SIGINT', onInt);
  let temporary, admin, connected = false, created = false, api, web, fixture;
  const dbName = `pipeline_${Date.now()}_${process.pid}_test`;
  const command = (bin, args, cwd, env) => runCommand(bin, args, { cwd, env, signal: controller.signal });
  const request = (url, options = {}) => httpRequest(url, { ...options, signal: AbortSignal.any([controller.signal, options.signal || AbortSignal.timeout(90_000)]) });
  const abortApps = () => {
    void stopGroup(api); void stopGroup(web);
    // pg.end() waits for protocol completion while connecting; abort the owned socket.
    if (admin && !connected) admin.connection.stream.destroy();
  };
  controller.signal.addEventListener('abort', abortApps, { once: true });
  try {
    const db = isolatedDatabase(process.env.TEST_DATABASE_URL);
    const change = changedFiles(sha);
    evidence.base = change.base;
    temporary = await mkdtemp(join(tmpdir(), 'omk-dev-checks-'));
    const checkout = join(temporary, 'checkout');
    admin = new Client({ connectionString: db.href, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
    await abortable(admin.connect(), controller.signal); connected = true;
    controller.signal.throwIfAborted();
    await admin.query(`CREATE DATABASE "${dbName}"`); created = true;
    controller.signal.throwIfAborted();
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
    const featureInput = join(temporary, 'feature-input.json'), featureReport = join(temporary, 'feature-report.json');
    await writeFile(featureInput, JSON.stringify({ sha, files: change.files }));
    await command(process.execPath, ['scripts/ci/feature-checks.mjs', '--files', featureInput, '--report', featureReport], checkout, env);
    evidence.features = JSON.parse(await readFile(featureReport));
    evidence.checks.push('selected-feature-tests');
    api = spawn(process.execPath, ['apps/api/dist/server.js'], { cwd: checkout, env, stdio: 'inherit', detached: true });
    const apiURL = `http://127.0.0.1:${apiPort}`;
    const health = await (await waitFor(`${apiURL}/health`, api, controller.signal)).json();
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
      const stored = await fixtureDB.query('SELECT id, role FROM users WHERE id=$1', [userId]);
      if (stored.rowCount !== 1 || stored.rows[0].role !== 'user') throw new Error('Registered ordinary user not persisted to isolated DB');
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
    const page = await waitFor(`http://127.0.0.1:${webPort}`, web, controller.signal);
    if (!(page.headers.get('content-type') || '').includes('text/html') || !(await page.text()).includes('<html')) throw new Error('Built web did not serve HTML');
    evidence.checks.push('built-web-startup-html');
    controller.signal.throwIfAborted();
    evidence.status = 'passed';
    delete evidence.error;
  } catch (error) { const failure = controller.signal.aborted ? controller.signal.reason : error; evidence.error = failure.message; throw failure; }
  finally {
    const cleanupErrors = [];
    const cleanup = async action => { try { await action(); } catch (error) { cleanupErrors.push(error.message); evidence.status = 'failed'; } };
    await cleanup(() => stopGroup(web)); await cleanup(() => stopGroup(api));
    if (fixture) await cleanup(() => new Promise(resolve => { fixture.server.closeAllConnections(); fixture.server.close(resolve); }));
    if (created) await cleanup(() => admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`));
    if (admin) await cleanup(() => admin.end());
    if (temporary) await cleanup(() => rm(temporary, { recursive: true, force: true }));
    if (cleanupErrors.length) evidence.cleanupErrors = cleanupErrors;
    evidence.finishedAt = new Date().toISOString();
    await atomicEvidence(output, evidence);
    process.removeListener('SIGTERM', onTerm); process.removeListener('SIGINT', onInt);
    controller.signal.removeEventListener('abort', abortApps);
    console.log(`Dev checks ${evidence.status}: ${output}`);
    if (cleanupErrors.length) throw new Error(`Disposable cleanup failed: ${cleanupErrors.join('; ')}`);
    controller.signal.throwIfAborted();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
