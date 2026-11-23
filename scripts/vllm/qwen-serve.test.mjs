// qwen-serve.sh(DGX 채팅 vLLM 실행기) — Flash-Next 는 DGX Compose 스택의 vllm-chat 서비스로 띄운다.
// 가짜 docker 로 실제 스크립트를 실행해 실행 위치와 넘기는 인자만 본다(GPU·네트워크 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./qwen-serve.sh', import.meta.url));

function run(extraEnv = {}, { makeHome = true } = {}) {
  const stub = realpathSync(mkdtempSync(join(tmpdir(), 'qwen-serve-')));
  try {
    writeFileSync(join(stub, 'docker'), '#!/bin/sh\npwd\nprintf "%s\\n" "$@"\n');
    chmodSync(join(stub, 'docker'), 0o755);
    if (makeHome) mkdirSync(join(stub, 'vllm'));
    const r = spawnSync('bash', [SCRIPT], {
      env: { PATH: `${stub}:${process.env.PATH}`, HOME: stub, ...extraEnv },
      encoding: 'utf8',
    });
    const [cwd, ...args] = r.stdout.split('\n').filter(Boolean);
    return { status: r.status, cwd, args, stub, stderr: r.stderr };
  } finally {
    rmSync(stub, { recursive: true, force: true });
  }
}

test('기본은 ~/vllm 에서 Flash-Next compose 로 vllm-chat 을 띄운다', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.cwd, join(r.stub, 'vllm'));
  assert.deepEqual(r.args, ['compose', '-f', 'compose.yml', '-f', 'compose.flash.yml', 'up', '-d', 'vllm-chat']);
});

test('VLLM_HOME 을 주면 그 위치에서 띄운다', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'qwen-serve-home-')));
  try {
    const r = run({ VLLM_HOME: home });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.cwd, home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('VLLM_HOME 이 없으면 docker 를 부르지 않고 실패한다', () => {
  const r = run({}, { makeHome: false });
  assert.notEqual(r.status, 0);
  assert.equal(r.cwd, undefined);
});
