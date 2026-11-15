/**
 * 회귀 가드 — 모드 시트의 투명 막(fixed inset-0)이 전송·승인 첫 클릭을 삼키던 결함(2026-11-15).
 * 막 대신 document pointerdown 으로 바깥을 판단한다: 시트 상자도 '도구' 버튼도 아니면 닫는다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { isOutside } from '../../apps/web/lib/outside-pointer';

const ROOT = process.cwd(); // run-tests.mjs 가 저장소 루트를 cwd 로 준다

// DOM 없이 contains 만 흉내 낸다 — 자식 집합에 있으면 안쪽.
function box(...children: object[]) {
  const set = new Set<unknown>(children);
  const self = { contains: (n: unknown) => n === self || set.has(n) };
  return self as unknown as Node;
}

test('시트 상자 안을 누르면 바깥이 아니다', () => {
  const inner = {};
  const sheet = box(inner);
  const button = box();
  assert.equal(isOutside(inner as Node, [sheet, button]), false);
});

test("'도구' 버튼을 누르면 바깥이 아니다(pointerdown 이 닫고 click 이 다시 여는 것을 막는다)", () => {
  const icon = {};
  const sheet = box();
  const button = box(icon);
  assert.equal(isOutside(icon as Node, [sheet, button]), false);
});

test('둘 다 아닌 곳(전송 버튼 등)은 바깥이다', () => {
  const send = {};
  assert.equal(isOutside(send as Node, [box(), box()]), true);
});

test('null ref 는 건너뛴다', () => {
  const inner = {};
  assert.equal(isOutside(inner as Node, [null, box(inner)]), false);
  assert.equal(isOutside({} as Node, [null, null]), true);
});

test('composer.tsx 에 fixed inset-0 막이 없다', () => {
  const src = readFileSync(join(ROOT, 'apps/web/components/chat/composer.tsx'), 'utf8');
  assert.ok(!src.includes('fixed inset-0'), '투명 막은 바깥 클릭(전송·승인)을 삼킨다 — pointerdown 판단을 쓴다');
});
