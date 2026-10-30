// qwen-serve.sh(DGX 채팅 vLLM 참조본)의 served-model-name 조립 — 가짜 vllm 으로 실제 스크립트를 실행해
// 넘기는 인자만 본다(GPU·네트워크 없음). 환경을 주지 않으면 종전 이름 하나 그대로여야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./qwen-serve.sh', import.meta.url));

function run(extraEnv = {}) {
  const stub = mkdtempSync(join(tmpdir(), 'qwen-serve-'));
  try {
    writeFileSync(join(stub, 'vllm'), '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(join(stub, 'vllm'), 0o755);
    const r = spawnSync('bash', [SCRIPT], {
      env: { PATH: `${stub}:${process.env.PATH}`, HOME: stub, ...extraEnv },
      encoding: 'utf8',
    });
    return { status: r.status, args: r.stdout.split('\n').filter(Boolean), stderr: r.stderr };
  } finally {
    rmSync(stub, { recursive: true, force: true });
  }
}

/** --served-model-name 뒤에서 다음 -- 옵션 전까지의 이름들 */
function servedNames(args) {
  const i = args.indexOf('--served-model-name');
  assert.ok(i >= 0, '--served-model-name 이 없다');
  const rest = args.slice(i + 1);
  const end = rest.findIndex((a) => a.startsWith('--'));
  return end < 0 ? rest : rest.slice(0, end);
}

test('환경을 주지 않으면 종전대로 qwen3.8-27b 하나만 서빙한다', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(servedNames(r.args), ['qwen3.8-27b']);
});

test('정식 이름이 맨 앞, 호환 alias 가 뒤에 붙는다 — vLLM 은 둘 다 받는다', () => {
  const r = run({ QWEN_SERVED_MODEL_NAME: 'chat-next-32b', QWEN_SERVED_MODEL_ALIASES: 'qwen3.8-27b' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(servedNames(r.args), ['chat-next-32b', 'qwen3.8-27b']);
});

test('허용되지 않은 문자의 이름은 vLLM 을 띄우지 않고 실패한다', () => {
  for (const env of [
    { QWEN_SERVED_MODEL_NAME: 'x$(id)' },
    { QWEN_SERVED_MODEL_NAME: 'org/model' },
    { QWEN_SERVED_MODEL_NAME: 'ok-name', QWEN_SERVED_MODEL_ALIASES: 'qwen3.8-27b --api-key=leak' },
  ]) {
    const r = run(env);
    assert.notEqual(r.status, 0, JSON.stringify(env));
    assert.deepEqual(r.args, [], `vllm 이 실행됐다: ${JSON.stringify(env)}`);
  }
});

test('같은 이름이 두 번 나오면 실패한다', () => {
  const r = run({ QWEN_SERVED_MODEL_NAME: 'qwen3.8-27b', QWEN_SERVED_MODEL_ALIASES: 'qwen3.8-27b' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.args, []);
});
