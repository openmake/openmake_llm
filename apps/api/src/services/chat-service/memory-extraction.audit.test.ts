/**
 * autoFormMemories — 자동 저장 행이 audit(memory.auto_created)에 남는지, 본문은 싣지 않는지,
 * 저장이 없으면 audit 도 없는지. 게이트 env 는 모듈 로드 시 읽히므로 require 전에 켠다.
 */
const repoMock = {
    countActiveByUser: jest.fn().mockResolvedValue(0),
    listKnownContentsByUser: jest.fn().mockResolvedValue([]),
    create: jest.fn(async (id: string, userId: string, content: string, source: string) => ({ id, user_id: userId, content, source })),
};
jest.mock('../../data/repositories/user-memory-repository', () => ({
    UserMemoryRepository: jest.fn().mockImplementation(() => repoMock),
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const logAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('../AuditService', () => ({ getAuditService: () => ({ logAudit }) }));

type Mod = typeof import('./memory-extraction');
let mod: Mod;
const saved = { auto: process.env.USER_MEMORY_AUTO_EXTRACT, llm: process.env.USER_MEMORY_LLM_EXTRACT };
const flush = () => new Promise((r) => setImmediate(r));

beforeAll(() => {
    process.env.USER_MEMORY_AUTO_EXTRACT = 'true';
    delete process.env.USER_MEMORY_LLM_EXTRACT;
    jest.resetModules();
    mod = require('./memory-extraction') as Mod;
});
afterAll(() => {
    if (saved.auto === undefined) delete process.env.USER_MEMORY_AUTO_EXTRACT; else process.env.USER_MEMORY_AUTO_EXTRACT = saved.auto;
    if (saved.llm === undefined) delete process.env.USER_MEMORY_LLM_EXTRACT; else process.env.USER_MEMORY_LLM_EXTRACT = saved.llm;
});
beforeEach(() => {
    repoMock.create.mockClear();
    repoMock.listKnownContentsByUser.mockResolvedValue([]);
    logAudit.mockClear();
});

describe('autoFormMemories — audit', () => {
    it('저장된 행을 memory.auto_created 로 감사하고 본문은 싣지 않는다', async () => {
        await mod.autoFormMemories({ userId: 'u1', message: '내 이름은 김철수야 기억해줘' });
        await flush();
        expect(repoMock.create).toHaveBeenCalledTimes(1);
        expect(repoMock.create.mock.calls[0][3]).toBe('explicit');
        expect(logAudit).toHaveBeenCalledTimes(1);
        const input = logAudit.mock.calls[0][0];
        expect(input.action).toBe('memory.auto_created');
        expect(input.userId).toBe('u1');
        expect(input.resourceType).toBe('user_memory');
        expect(input.details.count).toBe(1);
        expect(input.details.rows[0]).toEqual(expect.objectContaining({ id: expect.any(String), source: 'explicit' }));
        expect(JSON.stringify(input.details)).not.toContain('김철수');
    });

    it('중복(tombstone 포함)으로 저장이 없으면 audit 도 없다', async () => {
        repoMock.listKnownContentsByUser.mockResolvedValue(['내 이름은 김철수야']);
        await mod.autoFormMemories({ userId: 'u1', message: '내 이름은 김철수야 기억해줘' });
        await flush();
        expect(repoMock.create).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('guest 는 저장·audit 모두 없음', async () => {
        await mod.autoFormMemories({ userId: 'guest', message: '내 이름은 김철수야 기억해줘' });
        await flush();
        expect(repoMock.create).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('audit 실패는 저장을 되돌리지 않고 throw 도 없다(fail-open)', async () => {
        logAudit.mockRejectedValueOnce(new Error('audit down'));
        await expect(mod.autoFormMemories({ userId: 'u1', message: '나는 파이썬을 선호해' })).resolves.toBeUndefined();
        await flush();
        expect(repoMock.create).toHaveBeenCalledTimes(1);
    });
});
