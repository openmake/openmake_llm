/**
 * 대기열 순번 (Companion P1-7) — 대기 중인 작업이 몇 번째로 시작되는지(1 부터). 꺼낼 때와 같은 순서(우선순위 → 등록 순)로 센다.
 */
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ updateAgentTask: async () => undefined }) }));

import { AgentTaskQueue } from '../task-queue';

const never = (): Promise<void> => new Promise(() => undefined);
const entry = (taskId: string, userId: string, priority?: number) => ({ taskId, userId, run: never, ...(priority !== undefined ? { priority } : {}) });

describe('AgentTaskQueue.position', () => {
    it('실행 중이거나 큐에 없는 작업은 null', () => {
        const q = new AgentTaskQueue(1, 1);
        q.submit(entry('run', 'u1'));
        expect(q.position('run')).toBeNull();
        expect(q.position('nope')).toBeNull();
    });

    it('등록 순으로 1 부터 센다', () => {
        const q = new AgentTaskQueue(1, 1);
        q.submit(entry('run', 'u1'));
        q.submit(entry('a', 'u2'));
        q.submit(entry('b', 'u3'));
        expect(q.position('a')).toBe(1);
        expect(q.position('b')).toBe(2);
    });

    it('우선순위가 높은 작업이 앞선다 — 같은 우선순위는 등록 순', () => {
        const q = new AgentTaskQueue(1, 1);
        q.submit(entry('run', 'u1'));
        q.submit(entry('low', 'u2', 0));
        q.submit(entry('high', 'u3', 5));
        q.submit(entry('low2', 'u4', 0));
        expect(q.position('high')).toBe(1);
        expect(q.position('low')).toBe(2);
        expect(q.position('low2')).toBe(3);
    });

    it('대기에서 빠지면 뒤 작업의 순번이 당겨진다', () => {
        const q = new AgentTaskQueue(1, 1);
        q.submit(entry('run', 'u1'));
        q.submit(entry('a', 'u2'));
        q.submit(entry('b', 'u3'));
        q.cancelPending('a');
        expect(q.position('b')).toBe(1);
    });
});
