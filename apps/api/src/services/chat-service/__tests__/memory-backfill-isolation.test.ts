/**
 * 메모리 백필 격리 — 프로젝트 등 통합이 "격리"로 표시한 세션은 과거 백필에서 제외한다(전역 메모리 누출 방지).
 * DB·LLM 은 모두 mock. isSessionMemoryIsolated 를 mock 해 격리 세션 하나를 만들고, 그 세션 본문은
 * 추출기(extractLLMMemories)에 전달되지 않는지 확인한다.
 */
const queryMock = jest.fn();
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({ query: queryMock }) }));
jest.mock('../../../llm/client', () => ({ createClient: () => ({}) }));

const extractLLMMemories = jest.fn(async (_client: unknown, text: string) => [`mem:${text}`]);
jest.mock('../memory-extraction', () => ({
    extractLLMMemories,
    isDuplicateMemory: () => false,
    auditMemoryWrite: jest.fn(async () => undefined),
}));

const isSessionMemoryIsolated = jest.fn();
jest.mock('../turn-integrations', () => ({ isSessionMemoryIsolated }));

jest.mock('../../../data/repositories/user-memory-repository', () => ({
    UserMemoryRepository: class {
        listKnownContentsByUser = jest.fn(async () => [] as string[]);
        countActiveByUser = jest.fn(async () => 0);
        create = jest.fn(async (id: string) => ({ id }));
    },
}));

import { backfillUserMemories } from '../memory-backfill';

beforeEach(() => {
    jest.clearAllMocks();
    // 두 세션: bound(격리) + free(일반). user_text 는 minChars 를 넘도록 충분히 길게.
    queryMock.mockResolvedValue({
        rows: [
            { id: 'bound', user_text: '연결된 프로젝트 대화의 사용자 발화 '.repeat(3) },
            { id: 'free', user_text: '일반 대화의 사용자 발화 내용입니다 '.repeat(3) },
        ],
    });
    isSessionMemoryIsolated.mockImplementation(async (_u: string, sid: string) => sid === 'bound');
});

describe('backfillUserMemories — 격리 세션 제외', () => {
    it('(d) 격리(연결) 세션 본문은 추출기에 전달되지 않는다', async () => {
        const res = await backfillUserMemories('u1', { dryRun: true });
        expect(extractLLMMemories).toHaveBeenCalledTimes(1);
        const passedText = extractLLMMemories.mock.calls[0][1];
        expect(passedText).toContain('일반 대화');
        expect(passedText).not.toContain('연결된 프로젝트');
        expect(res.sessionsProcessed).toBe(1);
    });

    it('격리 판정이 던지면 그 세션은 fail-closed 로 제외', async () => {
        isSessionMemoryIsolated.mockImplementation(async (_u: string, sid: string) => {
            if (sid === 'bound') throw new Error('db');
            return false;
        });
        await backfillUserMemories('u1', { dryRun: true });
        expect(extractLLMMemories).toHaveBeenCalledTimes(1);
        expect(extractLLMMemories.mock.calls[0][1]).toContain('일반 대화');
    });
});
