import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_CLOSE_REASONS, DEVICE_CONFLICT_REASON } from '@openmake/local-bridge-core';
import { AUTH_STATUS_KEYS, DEVICE_CONFLICT_STATUS_KEY, MESSAGES, isAuthClosed, translate } from '../src/i18n.mjs';

test('인증 사유 상태만 "인증으로 닫힘" 으로 본다 — 설정 저장 때 같은 key 라도 다시 연결하는 근거', () => {
  for (const r of AUTH_CLOSE_REASONS) assert.equal(isAuthClosed(r), true, r);
  for (const c of ['connected', 'connecting', 'reconnecting', 'server_error', 'closed', 'idle', undefined, 'toString']) assert.equal(isAuthClosed(c), false, String(c));
});

test('서버가 인증 사유로 닫은 연결은 사유별 문구로 보인다 — 코어의 사유 목록과 1:1', () => {
  assert.deepEqual(Object.keys(AUTH_STATUS_KEYS).sort(), [...AUTH_CLOSE_REASONS].sort());
  for (const locale of Object.keys(MESSAGES)) {
    for (const key of Object.values(AUTH_STATUS_KEYS)) assert.ok(MESSAGES[locale][key], `${locale} ${key}`);
  }
  assert.match(translate('ko', AUTH_STATUS_KEYS.api_key_revoked), /폐기/);
  assert.match(translate('en', AUTH_STATUS_KEYS.api_key_expired), /expired/);
});

test('같은 기기 id 충돌(device_conflict)은 모든 언어에 문구가 있고 인증 닫힘이 아니다 — 코어 사유 값과 같다', () => {
  assert.equal(DEVICE_CONFLICT_REASON, 'device_conflict');
  assert.equal(isAuthClosed(DEVICE_CONFLICT_REASON), false);
  for (const locale of Object.keys(MESSAGES)) assert.ok(MESSAGES[locale][DEVICE_CONFLICT_STATUS_KEY], `${locale} ${DEVICE_CONFLICT_STATUS_KEY}`);
  assert.match(translate('ko', DEVICE_CONFLICT_STATUS_KEY), /다른 앱이 이미 연결돼/);
});
