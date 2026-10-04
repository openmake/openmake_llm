/**
 * dialog-policy 테스트 — `node --test infra/` 로 돈다(루트 npm test 에 포함).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDialogPolicy } from './dialog-policy.mjs';

test('기본: alert 과 beforeunload 는 받고 confirm 과 prompt 는 취소한다', () => {
    const p = createDialogPolicy();
    assert.deepEqual(p.decide('alert'), { accept: true });
    assert.deepEqual(p.decide('beforeunload'), { accept: true });
    assert.deepEqual(p.decide('confirm'), { accept: false });
    assert.deepEqual(p.decide('prompt'), { accept: false });
});

test('수락으로 바꾸면 그 뒤의 confirm 과 prompt 를 받는다', () => {
    const p = createDialogPolicy();
    p.set({ accept: true, promptText: '홍길동' });
    assert.deepEqual(p.decide('confirm'), { accept: true });
    assert.deepEqual(p.decide('prompt'), { accept: true, promptText: '홍길동' });
});

test('다시 취소로 바꿀 수 있다', () => {
    const p = createDialogPolicy();
    p.set({ accept: true });
    p.set({ accept: false });
    assert.deepEqual(p.decide('confirm'), { accept: false });
});

test('accept 가 불리언이 아니면 거절한다', () => {
    const p = createDialogPolicy();
    assert.throws(() => p.set({ accept: 'yes' }), /accept/);
    assert.throws(() => p.set({}), /accept/);
});

test('뜬 확인창을 기록하고 꺼내면 비운다', () => {
    const p = createDialogPolicy();
    p.record('confirm', '정말 삭제할까요?', p.decide('confirm'));
    p.record('alert', '저장했습니다', p.decide('alert'));
    assert.deepEqual(p.drain(), [
        { type: 'confirm', message: '정말 삭제할까요?', handled: 'dismissed' },
        { type: 'alert', message: '저장했습니다', handled: 'accepted' },
    ]);
    assert.deepEqual(p.drain(), []);
});

test('긴 문구는 자르고 기록 건수에 상한을 둔다', () => {
    const p = createDialogPolicy();
    p.record('alert', 'x'.repeat(1000), { accept: true });
    for (let i = 0; i < 50; i++) p.record('alert', `m${i}`, { accept: true });
    const out = p.drain();
    assert.equal(out[0].message.length, 300);
    assert.equal(out.length, 20);
});
