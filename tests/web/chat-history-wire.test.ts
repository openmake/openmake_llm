/**
 * 멀티턴 vision — 웹이 history 에 이전 턴 이미지를 실어 보낸다(2026-11-08). 요청 전체(현재 턴 + history)
 * 이미지 수는 CHAT_MAX_IMAGES 이하로, 최신 메시지부터 채우고 한 메시지의 이미지는 쪼개지 않는다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHAT_MAX_IMAGES, toWireHistory } from '../../apps/web/lib/chat-history-wire';

const imgs = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `data:image/png;base64,${tag}${i}`);

test('표시 전용 안내(notice)는 history 에서 빠진다', () => {
  const out = toWireHistory([
    { role: 'user', content: 'a' },
    { role: 'system', content: '끊김', notice: true },
    { role: 'assistant', content: 'b' },
  ], 0);
  assert.deepEqual(out, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
});

test('이미지가 없는 메시지는 images 키가 없다', () => {
  const out = toWireHistory([{ role: 'user', content: 'a', images: [] }, { role: 'assistant', content: 'b' }], 0);
  for (const m of out) assert.ok(!('images' in m));
});

test('예산 안이면 history 이미지와 현재 턴 이미지가 함께 실린다', () => {
  const prev = imgs(3, 'p');
  const out = toWireHistory([{ role: 'user', content: 'q1', images: prev }, { role: 'assistant', content: 'a1' }], 2, 20);
  assert.deepEqual(out[0], { role: 'user', content: 'q1', images: prev });
});

test('예산을 넘는 오래된 메시지는 이미지를 통째로 뺀다(쪼개지 않음)', () => {
  const older = imgs(3, 'o');
  const newer = imgs(2, 'n');
  const out = toWireHistory([
    { role: 'user', content: 'q1', images: older },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'q2', images: newer },
    { role: 'assistant', content: 'a2' },
  ], 2, 5);
  assert.ok(!('images' in out[0]), '남은 예산 1 < 3 — 이전 메시지는 이미지 없이');
  assert.deepEqual(out[2].images, newer);
});

test('남은 예산과 정확히 같은 장수는 싣고, 한 장 넘으면 뺀다', () => {
  const fit = toWireHistory([{ role: 'user', content: 'q1', images: imgs(18, 'f') }], 2, 20);
  assert.equal(fit[0].images?.length, 18, '현재 2 + history 18 = 20 — 포함');
  const over = toWireHistory([{ role: 'user', content: 'q1', images: imgs(19, 'o') }], 2, 20);
  assert.ok(!('images' in over[0]), '현재 2 + history 19 = 21 — 제외');
});

test('현재 턴이 상한만큼이면 history 이미지는 모두 빠진다', () => {
  const out = toWireHistory([{ role: 'user', content: 'q1', images: imgs(1, 'p') }], CHAT_MAX_IMAGES);
  assert.ok(!('images' in out[0]));
});

test('원래 순서를 지킨다', () => {
  const out = toWireHistory([
    { role: 'user', content: '1', images: imgs(1, 'a') },
    { role: 'assistant', content: '2' },
    { role: 'user', content: '3', images: imgs(1, 'b') },
    { role: 'assistant', content: '4' },
  ], 0);
  assert.deepEqual(out.map((m) => m.content), ['1', '2', '3', '4']);
});

test('컴포저 첨부 상한은 CHAT_MAX_IMAGES(서버 MAX_IMAGES 와 같은 20) 한 곳을 쓴다', () => {
  assert.equal(CHAT_MAX_IMAGES, 20);
  const src = readFileSync(join(process.cwd(), 'apps/web/components/chat/composer.tsx'), 'utf8');
  assert.ok(src.includes('CHAT_MAX_IMAGES'), 'composer 가 CHAT_MAX_IMAGES 를 import 해 쓴다');
  assert.ok(!/const MAX_IMAGES\s*=/.test(src), 'composer 에 별도 MAX_IMAGES 상수가 없다');
});
