/** 자동 기억형성(#3 b) 순수 함수 유닛 — DB/LLM 무관. */
import { extractHeuristicMemories, isDuplicateMemory } from './memory-extraction';

describe('extractHeuristicMemories', () => {
    it('"~ 기억해줘" 저장 의도 추출', () => {
        const r = extractHeuristicMemories('내 생일은 3월 5일이야 기억해줘');
        expect(r.length).toBe(1);
        expect(r[0]).toContain('생일');
    });
    it('"내 이름은 X" 선언 추출', () => {
        const r = extractHeuristicMemories('안녕 내 이름은 김철수야');
        expect(r.some((m) => m.includes('김철수'))).toBe(true);
    });
    it('"나는 X를 선호해" 추출', () => {
        const r = extractHeuristicMemories('나는 파이썬을 선호해');
        expect(r.some((m) => m.includes('파이썬'))).toBe(true);
    });
    it('"잊지 마" 추출', () => {
        const r = extractHeuristicMemories('회의는 매주 월요일 오전 10시 잊지 마');
        expect(r.length).toBe(1);
    });
    it('저장 의도 없는 일반 질문은 미추출', () => {
        expect(extractHeuristicMemories('오늘 날씨 어때?')).toEqual([]);
        expect(extractHeuristicMemories('이 코드 리뷰해줘')).toEqual([]);
    });
    it('빈 입력', () => {
        expect(extractHeuristicMemories('')).toEqual([]);
    });
});

describe('isDuplicateMemory', () => {
    it('정규화 exact 중복', () => {
        expect(isDuplicateMemory('나는 파이썬을 선호해.', ['나는 파이썬을 선호해'])).toBe(true);
    });
    it('부분 포함 중복', () => {
        expect(isDuplicateMemory('파이썬 선호', ['사용자는 파이썬 선호 개발자'])).toBe(true);
    });
    it('무관은 비중복', () => {
        expect(isDuplicateMemory('자바를 선호', ['나는 파이썬을 선호해'])).toBe(false);
    });
});
