/** memoryLearning 정책 — 서버 저장 설정이 authority, 클라이언트는 더 제한만 가능. */
const getPreferences = jest.fn();
jest.mock('../../data/repositories/user-repository', () => ({
    UserRepository: jest.fn().mockImplementation(() => ({ getPreferences })),
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { effectiveMemoryLearning, resolveMemoryLearning } from './memory-policy';

describe('effectiveMemoryLearning (pure)', () => {
    it('서버 false 면 클라이언트가 true 를 보내도 OFF (위조 불가)', () => {
        expect(effectiveMemoryLearning(false, true)).toBe(false);
        expect(effectiveMemoryLearning(false, undefined)).toBe(false);
    });
    it('서버 미설정/true 면 클라이언트 명시 false 만 OFF', () => {
        expect(effectiveMemoryLearning(undefined, undefined)).toBe(true);
        expect(effectiveMemoryLearning(true, undefined)).toBe(true);
        expect(effectiveMemoryLearning(true, false)).toBe(false);
        expect(effectiveMemoryLearning(undefined, false)).toBe(false);
    });
});

describe('resolveMemoryLearning', () => {
    beforeEach(() => getPreferences.mockReset());
    it('guest 는 항상 false (DB 조회 없음)', async () => {
        expect(await resolveMemoryLearning('guest')).toBe(false);
        expect(await resolveMemoryLearning(undefined)).toBe(false);
        expect(getPreferences).not.toHaveBeenCalled();
    });
    it('서버 설정 false → REST(플래그 없음)·WS(true 위조) 모두 OFF', async () => {
        getPreferences.mockResolvedValue({ memoryLearning: false });
        expect(await resolveMemoryLearning('u1')).toBe(false);
        expect(await resolveMemoryLearning('u1', true)).toBe(false);
    });
    it('서버 설정 없음 → 기본 ON, 클라이언트 false 는 존중', async () => {
        getPreferences.mockResolvedValue({});
        expect(await resolveMemoryLearning('u1')).toBe(true);
        expect(await resolveMemoryLearning('u1', false)).toBe(false);
    });
    it('조회 실패는 fail-open (클라이언트 플래그 기준)', async () => {
        getPreferences.mockRejectedValue(new Error('db down'));
        expect(await resolveMemoryLearning('u1')).toBe(true);
        expect(await resolveMemoryLearning('u1', false)).toBe(false);
    });
});
