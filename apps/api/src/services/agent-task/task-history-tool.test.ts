/**
 * 과거 작업 검색 도구(task_history) — 읽기 전용, 호출한 사용자의 작업만.
 */
import { createTaskHistoryTools, TASK_HISTORY_TOOL_NAME, type TaskHistoryStore } from './task-history-tool';
import { classifyToolRisk, hasSideEffects } from '../../config/tool-policy';

const item = { id: 't1', goal: '매출 보고서 작성', status: 'completed', current_turn: 4, created_at: '2026-10-01T00:00:00Z' };

function fakeStore(over: Partial<TaskHistoryStore> = {}) {
    const store = {
        searchTasks: jest.fn(async () => [item]),
        getTaskSummary: jest.fn(async () => null),
        ...over,
    };
    return store as jest.Mocked<TaskHistoryStore>;
}
const tool = (store: TaskHistoryStore, enabled = true) => createTaskHistoryTools('t-now', { enabled, store })[0];

describe('task_history', () => {
    it('꺼져 있으면(기본) 도구를 싣지 않는다', () => {
        expect(createTaskHistoryTools('t-now', { enabled: false, store: fakeStore() })).toEqual([]);
        expect(createTaskHistoryTools('t-now')).toEqual([]);
    });

    it('읽기 등급이다 — 부작용 없는 도구로 분류된다', () => {
        expect(classifyToolRisk(TASK_HISTORY_TOOL_NAME)).toBe('read');
        expect(hasSideEffects(TASK_HISTORY_TOOL_NAME)).toBe(false);
    });

    it('검색은 호출한 사용자 id 로만 조회한다 — 인자로 다른 사용자를 지정해도 무시한다', async () => {
        const store = fakeStore();
        const r = await tool(store).run({ action: 'search', query: '매출 보고서', user_id: 'u2', userId: 'u2' }, { userId: 'u1' });
        expect(store.searchTasks).toHaveBeenCalledWith('u1', ['매출', '보고서'], expect.objectContaining({ excludeTaskId: 't-now' }));
        expect(r.isError).toBeFalsy();
        expect(r.text).toContain('t1');
        expect(r.text).toContain('매출 보고서 작성');
    });

    it('최근 목록은 낱말 없이 조회하고 건수 상한을 지킨다', async () => {
        const store = fakeStore();
        await tool(store).run({ action: 'recent', limit: 9999 }, { userId: 'u1' });
        const [userId, words, opts] = store.searchTasks.mock.calls[0];
        expect(userId).toBe('u1');
        expect(words).toEqual([]);
        expect(opts.limit).toBeLessThanOrEqual(20);
    });

    it('한 건 보기 — 다른 사용자의 작업(저장소가 null)은 찾지 못했다고만 답한다', async () => {
        const store = fakeStore();
        const r = await tool(store).run({ action: 'view', task_id: 't-of-u1' }, { userId: 'u2' });
        expect(store.getTaskSummary).toHaveBeenCalledWith('u2', 't-of-u1', expect.any(Number));
        expect(r.isError).toBe(true);
        expect(r.text).toContain('t-of-u1');
    });

    it('한 건 보기 — 본인 작업은 목표·결과·도구를 싣는다', async () => {
        const store = fakeStore({ getTaskSummary: jest.fn(async () => ({ ...item, error: null, result: '보고서를 만들었습니다', completed_at: '2026-10-01T00:10:00Z', tools: ['bash', 'file_ops'] })) });
        const r = await tool(store).run({ action: 'view', task_id: 't1' }, { userId: 'u1' });
        expect(r.text).toContain('보고서를 만들었습니다');
        expect(r.text).toContain('bash, file_ops');
    });

    it('게스트·잘못된 action·빠진 인자는 조회하지 않고 오류', async () => {
        const store = fakeStore();
        expect((await tool(store).run({ action: 'recent' }, { userId: 'guest' })).isError).toBe(true);
        expect((await tool(store).run({ action: 'drop' }, { userId: 'u1' })).isError).toBe(true);
        expect((await tool(store).run({ action: 'search' }, { userId: 'u1' })).isError).toBe(true);
        expect((await tool(store).run({ action: 'view' }, { userId: 'u1' })).isError).toBe(true);
        expect(store.searchTasks).not.toHaveBeenCalled();
        expect(store.getTaskSummary).not.toHaveBeenCalled();
    });
});
