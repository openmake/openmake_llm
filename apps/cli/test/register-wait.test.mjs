// RegistrationWatch (설계 2026-11-19 device-id-conflict §5.2 r4) — 빌드된 dist 를 읽는다(`npm run build --workspace=@openmake/cli`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RegistrationWatch } = require('../dist/register-wait.js');

test('connected → ok, device_conflict → conflict, 인증 사유 → auth(사유 문구)', async () => {
  for (const [code, want] of [['connected', { kind: 'ok' }], ['device_conflict', { kind: 'conflict' }], ['api_key_revoked', { kind: 'auth', text: '문구' }]]) {
    const w = new RegistrationWatch();
    const p = w.wait(5000);
    w.note('연결 중…', 'connecting');
    w.note('문구', code);
    assert.deepEqual(await p, want, code);
  }
});

test('reconnecting·server_error 만 오면 시간 뒤 timeout — 마지막 서버 오류 문구를 싣는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = new RegistrationWatch();
  const p = w.wait(15000);
  w.note('서버 오류: a', 'server_error', 'a');
  w.note('끊김', 'reconnecting');
  w.note('서버 오류: b', 'server_error', 'b');
  t.mock.timers.tick(15000);
  assert.deepEqual(await p, { kind: 'timeout', serverError: 'b' });
});

test('대기를 걸기 전에 이미 온 결정 상태도 반영하고, 처음 나온 결정 상태가 남는다', async () => {
  const w = new RegistrationWatch();
  w.note('충돌', 'device_conflict');
  w.note('연결됨', 'connected');
  assert.deepEqual(await w.wait(5000), { kind: 'conflict' });
});

test('끝난 뒤 타이머가 남지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = new RegistrationWatch();
  const p = w.wait(15000);
  w.note('연결됨', 'connected');
  assert.deepEqual(await p, { kind: 'ok' });
  // 시간을 넘겨도 다른 결과로 바뀌거나 던지지 않는다 — 걸린 타이머가 없다.
  t.mock.timers.tick(20000);
  assert.deepEqual(await w.wait(1), { kind: 'ok' });
});
