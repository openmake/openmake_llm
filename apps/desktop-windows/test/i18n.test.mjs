import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_CLOSE_REASONS } from '@openmake/local-bridge-core';
import { AUTH_STATUS_KEYS, MESSAGES, translate } from '../src/i18n.mjs';

test('서버가 인증 사유로 닫은 연결은 사유별 문구로 보인다 — 코어의 사유 목록과 1:1', () => {
  assert.deepEqual(Object.keys(AUTH_STATUS_KEYS).sort(), [...AUTH_CLOSE_REASONS].sort());
  for (const locale of Object.keys(MESSAGES)) {
    for (const key of Object.values(AUTH_STATUS_KEYS)) assert.ok(MESSAGES[locale][key], `${locale} ${key}`);
  }
  assert.match(translate('ko', AUTH_STATUS_KEYS.api_key_revoked), /폐기/);
  assert.match(translate('en', AUTH_STATUS_KEYS.api_key_expired), /expired/);
});
