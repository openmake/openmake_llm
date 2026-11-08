// compose Redis 비밀번호는 선택이다(2026-11-08 점검 후속 보강): REDIS_PASSWORD 가 있으면 requirepass 로 뜨고
// healthcheck 도 그 비밀번호로 확인하며, 없으면 종전처럼 비밀번호 없이 뜬다.
// command·healthcheck 의 셸 스크립트를 가짜 redis-server·redis-cli 로 직접 돌려 두 경우를 확인한다(docker 불필요).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const compose = yaml.load(readFileSync(new URL('./docker-compose.yml', import.meta.url), 'utf8'));
const redis = compose.services.redis;

// compose 는 `$$` 를 `$` 로 바꿔 컨테이너에 넘긴다.
const unescape = (s) => s.replace(/\$\$/g, '$');

function fakeBin(t) {
  const dir = mkdtempSync(join(tmpdir(), 'omk-redis-auth-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['redis-server', 'redis-cli']) {
    const file = join(dir, name);
    writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "$FAKE_LOG"\n[ "${name}" = redis-cli ] && echo PONG\nexit 0\n`);
    chmodSync(file, 0o755);
  }
  // 이미지 entrypoint 자리 — 기록만 하고 넘겨받은 명령을 그대로 실행한다.
  const entry = join(dir, 'docker-entrypoint.sh');
  writeFileSync(entry, '#!/bin/sh\necho "docker-entrypoint.sh $1" >> "$FAKE_LOG"\nexec "$@"\n');
  chmodSync(entry, 0o755);
  return dir;
}

function runShell(t, script, password) {
  const bin = fakeBin(t);
  const log = join(bin, 'calls.log');
  const env = { PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: log, ...(password === undefined ? {} : { REDIS_PASSWORD: password }) };
  const result = spawnSync('sh', ['-c', script], { env, encoding: 'utf8' });
  let calls = '';
  try { calls = readFileSync(log, 'utf8').trim(); } catch { /* 호출 없음 */ }
  return { status: result.status, calls };
}

test('redis passes REDIS_PASSWORD from .env into the container (empty when unset)', () => {
  assert.ok(Array.isArray(redis.environment), 'environment 는 목록 형식');
  assert.ok(redis.environment.includes('REDIS_PASSWORD=${REDIS_PASSWORD:-}'), JSON.stringify(redis.environment));
});

test('redis starts with requirepass only when REDIS_PASSWORD is set', t => {
  assert.equal(redis.command[0], 'sh');
  assert.equal(redis.command[1], '-c');
  const script = unescape(redis.command[2]);

  // 이미지 entrypoint 를 거쳐야 redis 사용자로 낮춰 실행된다(직접 실행하면 root 로 뜬다).
  const withPw = runShell(t, script, 's3cret');
  assert.equal(withPw.status, 0);
  assert.equal(withPw.calls, 'docker-entrypoint.sh redis-server\nredis-server --appendonly yes --requirepass s3cret');

  const noPw = runShell(t, script, '');
  assert.equal(noPw.status, 0);
  assert.equal(noPw.calls, 'docker-entrypoint.sh redis-server\nredis-server --appendonly yes');
});

test('redis healthcheck authenticates only when REDIS_PASSWORD is set', t => {
  assert.equal(redis.healthcheck.test[0], 'CMD-SHELL');
  const script = unescape(redis.healthcheck.test[1]);

  const withPw = runShell(t, script, 's3cret');
  assert.equal(withPw.status, 0);
  assert.equal(withPw.calls, 'redis-cli -a s3cret --no-auth-warning ping');

  const noPw = runShell(t, script, undefined);
  assert.equal(noPw.status, 0);
  assert.equal(noPw.calls, 'redis-cli ping');
});

test('docker compose accepts the file with and without REDIS_PASSWORD', t => {
  const probe = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  if (probe.status !== 0) { t.skip('docker compose 없음'); return; }
  const file = new URL('./docker-compose.yml', import.meta.url).pathname;
  for (const password of ['s3cret', '']) {
    const env = { ...process.env, POSTGRES_PASSWORD: 'x', REDIS_PASSWORD: password };
    const result = spawnSync('docker', ['compose', '-f', file, 'config', '--format', 'json'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const cfg = JSON.parse(result.stdout).services.redis;
    assert.equal(cfg.environment.REDIS_PASSWORD, password);
  }
});
