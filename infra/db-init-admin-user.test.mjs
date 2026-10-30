// db/init/004-admin-user.sh fixture: a fake `psql` first on PATH records its -v arguments, so no database or
// docker is involved. Verifies the neutral defaults and the skip when no initial password is given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../db/init/004-admin-user.sh', import.meta.url));

function run(t, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omk-admin-init-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'psql.args');
  const psql = join(dir, 'psql');
  writeFileSync(psql, `#!/bin/bash\nprintf '%s\\n' "$@" > ${JSON.stringify(log)}\ncat >/dev/null\n`);
  chmodSync(psql, 0o755);
  const env = { PATH: `${dir}:${process.env.PATH}`, HOME: dir, POSTGRES_USER: 'u', POSTGRES_DB: 'd', ...extraEnv };
  const result = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { args: existsSync(log) ? readFileSync(log, 'utf8').split('\n') : null };
}

test('without ADMIN_INITIAL_EMAIL/USERNAME the account uses the neutral defaults', t => {
  const { args } = run(t, { ADMIN_INITIAL_PASSWORD: 'fixture-password' });
  assert.ok(args, 'psql was called');
  assert.ok(args.includes('email=admin@example.com'), args.join(' '));
  assert.ok(args.includes('username=admin'), args.join(' '));
});

test('explicit ADMIN_INITIAL_EMAIL is passed through', t => {
  const { args } = run(t, { ADMIN_INITIAL_PASSWORD: 'fixture-password', ADMIN_INITIAL_EMAIL: 'owner@example.org' });
  assert.ok(args.includes('email=owner@example.org'), args.join(' '));
});

test('without ADMIN_INITIAL_PASSWORD no account is created', t => {
  assert.equal(run(t).args, null);
});
