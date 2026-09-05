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

/* ── autoFormMemories: tombstone dedup + source 라벨 (repo/DB mock) ── */
const repoMock = {
    // 구 코드(listActiveByUser 만 비교)가 그대로 돌게 두어야 tombstone 테스트가 공허하게 통과하지 않는다.
    listActiveByUser: jest.fn().mockResolvedValue([]),
    countActiveByUser: jest.fn(),
    listKnownContentsByUser: jest.fn(),
    create: jest.fn(),
};
jest.mock('../../data/repositories/user-memory-repository', () => ({
    UserMemoryRepository: jest.fn().mockImplementation(() => repoMock),
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../config/memory-extraction', () => {
    const actual = jest.requireActual('../../config/memory-extraction');
    return { ...actual, MEMORY_EXTRACTION: { ...actual.MEMORY_EXTRACTION, heuristicEnabled: true, llmEnabled: false, maxCount: 50 } };
});

const { autoFormMemories } = require('./memory-extraction') as typeof import('./memory-extraction');

describe('autoFormMemories — tombstone + source', () => {
    beforeEach(() => { repoMock.countActiveByUser.mockReset(); repoMock.listKnownContentsByUser.mockReset(); repoMock.create.mockReset(); });

    it('휴리스틱 추출은 source=explicit 으로 저장한다 (034 정의 — 그전엔 candidate 로 역전)', async () => {
        repoMock.countActiveByUser.mockResolvedValue(0);
        repoMock.listKnownContentsByUser.mockResolvedValue([]);
        await autoFormMemories({ userId: 'u1', message: '내 생일은 3월 5일이야 기억해줘' });
        expect(repoMock.create).toHaveBeenCalledTimes(1);
        expect(repoMock.create.mock.calls[0][3]).toBe('explicit');
    });

    it('삭제(비활성)된 문장은 다시 만들지 않는다 — 중복 판정이 비활성 행을 포함', async () => {
        repoMock.countActiveByUser.mockResolvedValue(0); // active 0 = 사용자가 지움
        repoMock.listKnownContentsByUser.mockResolvedValue(['내 생일은 3월 5일이야']); // tombstone
        await autoFormMemories({ userId: 'u1', message: '내 생일은 3월 5일이야 기억해줘' });
        expect(repoMock.create).not.toHaveBeenCalled();
    });

    it('active cap 은 활성 개수 기준 (tombstone 은 cap 을 소모하지 않음)', async () => {
        repoMock.countActiveByUser.mockResolvedValue(50);
        repoMock.listKnownContentsByUser.mockResolvedValue([]);
        await autoFormMemories({ userId: 'u1', message: '내 생일은 3월 5일이야 기억해줘' });
        expect(repoMock.create).not.toHaveBeenCalled();
        repoMock.countActiveByUser.mockResolvedValue(3);
        repoMock.listKnownContentsByUser.mockResolvedValue(new Array(400).fill('삭제된 옛 문장'));
        await autoFormMemories({ userId: 'u1', message: '내 생일은 3월 5일이야 기억해줘' });
        expect(repoMock.create).toHaveBeenCalledTimes(1);
    });

    it('guest 는 저장하지 않는다', async () => {
        await autoFormMemories({ userId: 'guest', message: '내 생일은 3월 5일이야 기억해줘' });
        expect(repoMock.create).not.toHaveBeenCalled();
    });
});
