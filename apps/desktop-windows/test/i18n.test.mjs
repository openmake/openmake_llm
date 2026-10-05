import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_CLOSE_REASONS } from '@openmake/local-bridge-core';
import { AUTH_STATUS_KEYS, MESSAGES, isAuthClosed, translate } from '../src/i18n.mjs';

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
