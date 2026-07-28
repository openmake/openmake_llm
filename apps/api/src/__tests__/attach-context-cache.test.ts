/**
 * 세션 단위 첨부 컨텍스트 캐시 단위 테스트 (2026-06-13 멀티턴 재주입)
 *
 * 세션별 누적/조회, 합산 캡 초과 시 오래된 블록 제거,
 * 세션 격리를 검증한다.
 */
import {
    getCachedAttachContext,
    appendCachedAttachContext,
    clearAttachContextCache,
} from '../services/chat-service/attach-context';
import { ATTACH_CACHE_LIMITS } from '../config/runtime-limits';

describe('attach-context 세션 캐시', () => {
    beforeEach(() => {
        clearAttachContextCache();
    });

    it('저장된 적 없는 세션은 빈 문자열을 반환한다', () => {
        expect(getCachedAttachContext('session-none')).toBe('');
    });

    it('턴별 컨텍스트를 누적해 순서대로 합쳐 반환한다', () => {
        appendCachedAttachContext('s1', '## 📎 첨부 파일 A\n');
        appendCachedAttachContext('s1', '## 🔗 링크 분석 B\n');
        expect(getCachedAttachContext('s1')).toBe('## 📎 첨부 파일 A\n## 🔗 링크 분석 B\n');
    });

    it('세션 간 캐시는 격리된다', () => {
        appendCachedAttachContext('s1', 'A');
        appendCachedAttachContext('s2', 'B');
        expect(getCachedAttachContext('s1')).toBe('A');
        expect(getCachedAttachContext('s2')).toBe('B');
    });

    it('합산 캡 초과 시 오래된 블록부터 통째로 제거한다', () => {
        const half = 'x'.repeat(Math.ceil(ATTACH_CACHE_LIMITS.MAX_CHARS * 0.6));
        appendCachedAttachContext('s1', `OLD:${half}`);
        appendCachedAttachContext('s1', `NEW:${half}`);
        const cached = getCachedAttachContext('s1');
        expect(cached).toContain('NEW:');
        expect(cached).not.toContain('OLD:');
    });

    it('빈 컨텍스트나 빈 세션 ID 는 저장하지 않는다', () => {
        appendCachedAttachContext('s1', '');
        appendCachedAttachContext('', 'ctx');
        expect(getCachedAttachContext('s1')).toBe('');
        expect(getCachedAttachContext('')).toBe('');
    });
});
