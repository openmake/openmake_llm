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
    // 2026-09-06 user 3 dry-run 실측 — 같은 선호가 어미만 다르게 두 번 통과했다.
    it('어미 변형 근접 중복(토큰 유사도)', () => {
        expect(isDuplicateMemory(
            '사용자는 병렬로 업무를 처리하는 방식을 선호한다.',
            ['사용자는 병렬로 업무를 처리하기를 선호한다.'],
        )).toBe(true);
    });
    // 2026-09-06 라이브(chat.openmake.cc) 실측 — 1회 어미 제거·수식어 미제외로 0.57 에 그쳐 두 행이 저장됐다.
    it('수식어·어간 변형 근접 중복(반복 어미 제거 + 불용어)', () => {
        expect(isDuplicateMemory(
            '사용자는 코드 예시를 TypeScript로 받는 방식을 선호한다.',
            ['사용자는 모든 코드 예시를 TypeScript로 받기를 선호한다.'],
        )).toBe(true);
    });
    it('핵심어 하나가 다른 대립 쌍은 비중복', () => {
        expect(isDuplicateMemory('사용자는 코드 예시를 Python으로 받기를 선호한다.', ['사용자는 코드 예시를 TypeScript로 받기를 선호한다.'])).toBe(false);
        expect(isDuplicateMemory('사용자는 파이썬을 싫어한다.', ['사용자는 파이썬을 선호한다.'])).toBe(false);
        expect(isDuplicateMemory('사용자는 직렬로 업무를 처리하기를 선호한다.', ['사용자는 병렬로 업무를 처리하기를 선호한다.'])).toBe(false);
        expect(isDuplicateMemory('사용자는 자바를 선호한다.', ['사용자는 파이썬을 선호한다.'])).toBe(false);
        expect(isDuplicateMemory('사용자의 이름은 김영희다.', ['사용자의 이름은 김철수다.'])).toBe(false);
        expect(isDuplicateMemory('사용자는 비트코인 투자 전략 연구를 진행 중이다.', ['사용자는 코스모스(ATOM) 투자 전략 연구를 진행 중이다.'])).toBe(false);
    });
    it('"사용자는" 접두만 공유하는 무관 사실은 비중복', () => {
        expect(isDuplicateMemory(
            '사용자는 vexp.dev라는 로컬 우선 컨텍스트 엔진을 개발했다.',
            ['사용자는 코스모스(ATOM) 투자 전략 연구를 진행 중이다.'],
        )).toBe(false);
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

describe('extractLLMMemories — 답변 누출 차단 (2026-09-06 dry-run 실측)', () => {
    const clientWith = (content: string) => ({ chat: jest.fn().mockResolvedValue({ content }) }) as any;
    const { extractLLMMemories, isDuplicateMemory: _unused } = require('./memory-extraction') as typeof import('./memory-extraction');
    void _unused;

    it('"사용자는 …" 형식 줄만 통과, 질문 답변·계산 줄은 제거', async () => {
        const r = await extractLLMMemories(clientWith([
            '사용자는 HTML 형식의 간결한 요약 출력을 선호한다.',
            '부피 = 7³ = 343 cm³',
            '정육면체 한 변이 7cm이므로 부피는 343 cm³입니다.',
            '- 사용자의 이름은 김철수다',
        ].join('\n')), '정육면체 한 변이 7cm 면 부피는?');
        expect(r).toEqual(['사용자는 HTML 형식의 간결한 요약 출력을 선호한다.', '사용자의 이름은 김철수다']);
    });
    it('NONE 은 빈 배열, 분석 대상은 경계 태그로 감싼다', async () => {
        const c = clientWith('NONE');
        expect(await extractLLMMemories(c, '오늘 날씨 어때?')).toEqual([]);
        const userMsg = c.chat.mock.calls[0][0][1].content as string;
        expect(userMsg).toMatch(/^<extraction_target>\n오늘 날씨 어때\?\n<\/extraction_target>$/);
    });
});
