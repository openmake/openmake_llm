/**
 * 회귀 가드 — message-list 는 scrollIntoView 를 쓰지 않는다. scrollIntoView 는 스크롤 가능한 모든 조상
 * (overflow-hidden 인 앱 셸·main 포함)을 정렬해 셸을 화면 밖으로 밀었다(2026-11-08). 자동 스크롤은
 * lib/chat-scroll 의 scrollToBottomOf(findScroller(...)) 로 메시지 스크롤 컨테이너만 움직인다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = process.cwd(); // run-tests.mjs 가 저장소 루트를 cwd 로 준다

test('message-list.tsx 소스에 scrollIntoView 가 없다', () => {
  const src = readFileSync(join(ROOT, 'apps/web/components/chat/message-list.tsx'), 'utf8');
  assert.ok(!src.includes('scrollIntoView'), 'message-list 는 컨테이너 scrollTop 으로만 자동 스크롤한다');
});
