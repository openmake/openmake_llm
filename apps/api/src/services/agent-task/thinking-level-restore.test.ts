jest.mock('../../utils/logger', () => {
    const shared = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { createLogger: () => shared, __shared: shared };
});
const setThinkingLevel = jest.fn(async () => undefined);
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../data/repositories/agent-task-park-repository', () => ({
    AgentTaskParkRepository: jest.fn().mockImplementation(() => ({ setThinkingLevel })),
}));

import { effectiveThinkingLevel, thinkingLevelToPersist, persistThinkingLevel } from './thinking-level-restore';

const logger = (jest.requireMock('../../utils/logger') as { __shared: { warn: jest.Mock } }).__shared;

describe('effectiveThinkingLevel', () => {
    it('요청값이 먼저다', () => {
        expect(effectiveThinkingLevel({ thinkingLevel: 'high' }, 'low')).toBe('high');
    });
    it('재개면 저장값을 쓴다', () => {
        expect(effectiveThinkingLevel({ resume: {} }, 'medium')).toBe('medium');
    });
    it('재개인데 저장값이 허용값 밖이면 off', () => {
        expect(effectiveThinkingLevel({ resume: {} }, 'xhigh')).toBe('off');
        expect(effectiveThinkingLevel({ resume: {} }, null)).toBe('off');
    });
    it('처음 시작에 요청값이 없으면 off — 저장값이 있어도 보지 않는다', () => {
        expect(effectiveThinkingLevel({}, 'high')).toBe('off');
    });
});

describe('thinkingLevelToPersist / persistThinkingLevel', () => {
    beforeEach(() => jest.clearAllMocks());
    it('처음 시작이면서 값이 있을 때만 남긴다', () => {
        expect(thinkingLevelToPersist({ thinkingLevel: 'low' })).toBe('low');
        expect(thinkingLevelToPersist({ thinkingLevel: 'low', resume: {} })).toBeNull();
        expect(thinkingLevelToPersist({})).toBeNull();
    });
    it('persist 는 남길 값이 있을 때만 저장소를 부른다', async () => {
        await persistThinkingLevel('t1', { thinkingLevel: 'medium' });
        expect(setThinkingLevel).toHaveBeenCalledWith('t1', 'medium');
        await persistThinkingLevel('t1', { resume: {} , thinkingLevel: 'medium' });
        expect(setThinkingLevel).toHaveBeenCalledTimes(1);
    });
    it('저장 실패는 warn 로그를 남기고 삼킨다', async () => {
        setThinkingLevel.mockRejectedValueOnce(new Error('db down'));
        await expect(persistThinkingLevel('t1', { thinkingLevel: 'high' })).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith('[AgentTask] t1 추론 수준 저장 실패 (무시): db down');
    });
});
