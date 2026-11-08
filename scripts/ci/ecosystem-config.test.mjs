import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 수신 주소 선택(2026-11-07 점검): ecosystem.config.js 의 Next args 와 resolve-ports.cjs 의 webListenHost.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function evaluate(script, extraEnv) {
    const result = spawnSync(process.execPath, ['-e', script], { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...extraEnv } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split('\n').pop());
}

const NEXT_ARGS = "const c = require('./ecosystem.config.js'); console.log(JSON.stringify(c.apps.filter(a => a.name.startsWith('openmake-next')).map(a => a.args)));";

test('Next args omit -H when WEB_LISTEN_HOST is unset', () => {
    const args = evaluate(NEXT_ARGS, { WEB_LISTEN_HOST: '' });
    assert.ok(args.length >= 1);
    for (const value of args) assert.ok(!value.includes(' -H '), value);
});

test('Next args end with -H <host> when WEB_LISTEN_HOST is set', () => {
    const args = evaluate(NEXT_ARGS, { WEB_LISTEN_HOST: '127.0.0.1' });
    assert.ok(args.length >= 1);
    for (const value of args) assert.ok(value.endsWith(' -H 127.0.0.1'), value);
});

test('resolve-ports exposes webListenHost as a string, empty when unset', () => {
    const script = "console.log(JSON.stringify(require('./scripts/resolve-ports.cjs').webListenHost));";
    assert.equal(evaluate(script, { WEB_LISTEN_HOST: '' }), '');
    assert.equal(evaluate(script, { WEB_LISTEN_HOST: ' 127.0.0.1 ' }), '127.0.0.1');
});

// 로그 기본 경로(2026-11-08 점검 후속 보강): OMK_LOG_DIR 가 없으면 공용 임시 폴더가 아니라 저장소 logs/ 아래.
const LOG_FILES = "const c = require('./ecosystem.config.js'); console.log(JSON.stringify(c.apps.flatMap(a => [a.out_file, a.error_file])));";

test('PM2 log files default to the repository logs/ directory when OMK_LOG_DIR is unset', () => {
  const files = evaluate(LOG_FILES, { OMK_LOG_DIR: '' });
  assert.ok(files.length >= 2);
  const logsDir = join(repoRoot, 'logs');
  for (const file of files) assert.equal(dirname(file), logsDir, file);
});

test('OMK_LOG_DIR still overrides the log directory', () => {
  const files = evaluate(LOG_FILES, { OMK_LOG_DIR: '/var/log/openmake' });
  for (const file of files) assert.equal(dirname(file), '/var/log/openmake', file);
});
