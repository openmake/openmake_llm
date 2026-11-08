// gen-env.mjs fixture: runs a copy inside a temporary root (it writes <root>/.env next to its own location),
// so the repository .env and the real home directory are never read or written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('./gen-env.mjs', import.meta.url));

function generate(t, extraEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omk-gen-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts/setup'), { recursive: true });
  copyFileSync(SOURCE, join(root, 'scripts/setup/gen-env.mjs'));
  // Only PATH from the caller — no OMK_* input leaks in, and HOME points into the temporary root.
  const env = { PATH: process.env.PATH, HOME: join(root, 'home'), ...extraEnv };
  const result = spawnSync(process.execPath, [join(root, 'scripts/setup/gen-env.mjs'), '--quiet'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim().split('\n').pop(), /^GENERATED=1$/);
  const values = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split('\n')
    .filter(line => /^[A-Z0-9_]+=/.test(line)).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  return values;
}

test('without OMK_ADMIN_EMAIL the generated admin emails use the neutral example.com default', t => {
  const values = generate(t);
  for (const key of ['DEFAULT_ADMIN_EMAIL', 'ADMIN_EMAILS', 'ADMIN_INITIAL_EMAIL']) assert.equal(values[key], 'admin@example.com', key);
  assert.equal(values.ADMIN_INITIAL_USERNAME, 'admin');
});

test('OMK_ADMIN_EMAIL from the installer replaces the default', t => {
  const values = generate(t, { OMK_ADMIN_EMAIL: 'owner@example.org' });
  for (const key of ['DEFAULT_ADMIN_EMAIL', 'ADMIN_EMAILS', 'ADMIN_INITIAL_EMAIL']) assert.equal(values[key], 'owner@example.org', key);
});

test('a fresh .env gets a Redis password and REDIS_URL carries the same password', t => {
  const values = generate(t);
  assert.match(values.REDIS_PASSWORD, /^[0-9a-f]{36}$/);
  assert.equal(values.REDIS_URL, `redis://:${values.REDIS_PASSWORD}@127.0.0.1:${values.REDIS_PORT}`);
});

test('repairing an existing .env never adds a Redis password (existing installs keep running without one)', t => {
  const root = mkdtempSync(join(tmpdir(), 'omk-gen-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts/setup'), { recursive: true });
  copyFileSync(SOURCE, join(root, 'scripts/setup/gen-env.mjs'));
  writeFileSync(join(root, '.env'), 'PORT=52416\n');
  const env = { PATH: process.env.PATH, HOME: join(root, 'home') };
  const result = spawnSync(process.execPath, [join(root, 'scripts/setup/gen-env.mjs'), '--quiet'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim().split('\n').pop(), /^REPAIRED=\d+$/);
  const text = readFileSync(join(root, '.env'), 'utf8');
  assert.doesNotMatch(text, /^REDIS_PASSWORD=/m);
  assert.match(text, /^REDIS_URL=redis:\/\/127\.0\.0\.1:6379$/m);
});
