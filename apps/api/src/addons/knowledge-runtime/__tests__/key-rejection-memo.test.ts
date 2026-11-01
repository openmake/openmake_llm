/** 키 거절 메모 — (사용자, 공급자) 별 TTL. 무효 키로 공급자를 반복 호출하지 않게 한다(설계 D7). */
import { KNOWLEDGE_RUNTIME } from '../constants';
import { clearKeyRejectionMemo, isKeyRejected, noteKeyRejected } from '../embedding/key-rejection-memo';

const TTL = KNOWLEDGE_RUNTIME.EMBED_KEY_REJECT_MEMO_MS;

beforeEach(() => clearKeyRejectionMemo());

describe('key-rejection-memo', () => {
    it('기록 뒤 TTL 안에서는 적중, 지나면 비적중', () => {
        noteKeyRejected('u1', 'gemini', 1_000);
        expect(isKeyRejected('u1', 'gemini', 1_000 + TTL - 1)).toBe(true);
        expect(isKeyRejected('u1', 'gemini', 1_000 + TTL)).toBe(false);
        // 만료된 항목은 지워진다 — 같은 시각에 다시 물어도 비적중
        expect(isKeyRejected('u1', 'gemini', 1_000)).toBe(false);
    });

    it('사용자·공급자가 다르면 서로 영향이 없다', () => {
        noteKeyRejected('u1', 'gemini', 0);
        expect(isKeyRejected('u2', 'gemini', 1)).toBe(false);
        expect(isKeyRejected('u1', 'nvidia', 1)).toBe(false);
    });

    it('TTL 기본값은 10분', () => {
        expect(TTL).toBe(600_000);
    });
});
