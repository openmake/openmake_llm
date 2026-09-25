/**
 * Space 지침·메모리 시스템 프롬프트 블록 — 경계 태그·언어·토큰 예산 절단(순수, DB 불필요).
 */
import {
    spaceInstructionsBlock, spaceMemoryBlock, SPACE_INSTRUCTIONS_TAG, SPACE_MEMORY_TAG,
} from '../prompts';

describe('spaceInstructionsBlock', () => {
    it('경계 태그로 감싸고 소유자 안내임을 밝힌다(정책을 덮지 않음)', () => {
        const b = spaceInstructionsBlock('항상 존댓말로 답하라', 'ko', 2000);
        expect(b).toContain(`<${SPACE_INSTRUCTIONS_TAG}>`);
        expect(b).toContain('항상 존댓말로 답하라');
        expect(b).toContain('덮어쓰지는 않는다');
    });

    it('en 로케일은 영어 안내', () => {
        const b = spaceInstructionsBlock('Answer briefly', 'en', 2000);
        expect(b).toContain('does NOT override system policy');
    });

    it('빈 지침이면 빈 문자열', () => {
        expect(spaceInstructionsBlock('   ', 'ko', 2000)).toBe('');
    });

    it('토큰 예산을 넘으면 head-truncate(생략 표시)', () => {
        const long = '가'.repeat(5000);
        const b = spaceInstructionsBlock(long, 'ko', 10);
        expect(b).toContain('생략됨');
        expect(b.length).toBeLessThan(long.length);
    });
});

describe('spaceMemoryBlock', () => {
    it('최신순 항목을 번호로 나열하고 경계 태그로 감싼다', () => {
        const b = spaceMemoryBlock(['첫째 메모', '둘째 메모'], 'ko', 1500);
        expect(b).toContain(`<${SPACE_MEMORY_TAG}>`);
        expect(b).toContain('1. 첫째 메모');
        expect(b).toContain('2. 둘째 메모');
    });

    it('항목이 없으면 빈 문자열', () => {
        expect(spaceMemoryBlock([], 'ko', 1500)).toBe('');
        expect(spaceMemoryBlock(['  '], 'ko', 1500)).toBe('');
    });

    it('토큰 예산을 넘으면 이미 넣은 것에서 멈춘다', () => {
        const items = Array.from({ length: 50 }, (_, i) => `${i} ` + '단어'.repeat(30));
        const b = spaceMemoryBlock(items, 'en', 20);
        // 예산이 작으면 최소 1건만 담긴다(첫 항목은 항상 담아 빈 블록을 피한다)
        expect(b).toContain('1. ');
        expect(b).not.toContain('\n5. ');
    });
});
