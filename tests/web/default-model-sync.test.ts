/**
 * 기본 모델 판정 적용(순수 함수) — 서버 판정 `defaultModelSelection` 만 따른다(2026-11-18 설계 §3.3).
 * 종전 컴포저는 목록에 없는 값을 구체 로컬 모델(`local-llm:…`)로 조용히 바꿨다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { nextSelectedModel, needsCarryOver, isFallbackStatus } from '../../apps/web/lib/default-model-sync';

const payload = (sel: unknown) => ({ defaultModel: 'local-llm:qwen-test', models: [], defaultModelSelection: sel as never });

test('key_disabled → "default"(자동), 구체 로컬 모델이 아니다', () => {
  const p = payload({ saved: 'gemini:gemini-2.5-flash', effective: 'default', status: 'key_disabled' });
  assert.equal(nextSelectedModel(p, 'gemini:gemini-2.5-flash'), 'default');
});

test('ok → saved 로 돌아온다(자동 복귀)', () => {
  const p = payload({ saved: 'gemini:gemini-2.5-flash', effective: 'gemini:gemini-2.5-flash', status: 'ok' });
  assert.equal(nextSelectedModel(p, 'default'), 'gemini:gemini-2.5-flash');
});

test('이미 같은 값이면 null(변경 없음)', () => {
  const p = payload({ saved: 'gemini:x', effective: 'gemini:x', status: 'ok' });
  assert.equal(nextSelectedModel(p, 'gemini:x'), null);
});

test('defaultModelSelection 이 null·없음 → null(store 유지)', () => {
  assert.equal(nextSelectedModel(payload(null), 'gemini:x'), null);
  assert.equal(nextSelectedModel({ defaultModel: 'local-llm:q', models: [] }, 'gemini:x'), null);
  assert.equal(nextSelectedModel(undefined, 'gemini:x'), null);
});

test('saved === null + 현재 store 가 구체 모델 → needsCarryOver true, default 면 false', () => {
  const p = payload({ saved: null, effective: 'default', status: 'auto' });
  assert.equal(needsCarryOver(p, 'gemini:gemini-2.5-flash'), true);
  assert.equal(needsCarryOver(p, 'default'), false);
  assert.equal(needsCarryOver(p, ''), false);
  assert.equal(needsCarryOver(payload({ saved: 'default', effective: 'default', status: 'auto' }), 'gemini:x'), false);
  assert.equal(needsCarryOver(payload(null), 'gemini:x'), false);
});

test('isFallbackStatus — auto·ok 외에만 true', () => {
  assert.equal(isFallbackStatus('auto'), false);
  assert.equal(isFallbackStatus('ok'), false);
  assert.equal(isFallbackStatus(undefined), false);
  for (const s of ['key_disabled', 'key_missing', 'unusable', 'not_listed'] as const) assert.equal(isFallbackStatus(s), true);
});
