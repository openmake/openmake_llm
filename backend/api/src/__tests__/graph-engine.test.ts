/**
 * graph-engine 테스트
 * StateGraph, CompiledGraph, parallelBatch의 핵심 기능 검증
 */

import { describe, it, expect } from 'bun:test';
import { StateGraph, START, END, parallelBatch } from '../utils/graph-engine';
import type { NodeProgressEvent } from '../utils/graph-engine';

// ═══════════════════════════════════════════
// 테스트용 상태 타입
// ═══════════════════════════════════════════

interface TestState {
    values: string[];
    count: number;
    route?: string;
    [key: string]: unknown;
}

// ═══════════════════════════════════════════
// StateGraph 빌더 테스트
// ═══════════════════════════════════════════

describe('StateGraph builder', () => {
    it('노드와 엣지를 체이닝으로 추가', () => {
        const graph = new StateGraph<TestState>()
            .addNode('a', async (s) => ({ values: [...s.values, 'a'] }))
            .addNode('b', async (s) => ({ values: [...s.values, 'b'] }))
            .addEdge(START, 'a')
            .addEdge('a', 'b')
            .addEdge('b', END);

        const compiled = graph.compile();
        expect(compiled).toBeDefined();
    });

    it('중복 노드 ID → Error', () => {
        const graph = new StateGraph<TestState>()
            .addNode('a', async () => ({}));

        expect(() => graph.addNode('a', async () => ({}))).toThrow('already exists');
    });

    it('START 엣지 없으면 compile 실패', () => {
        const graph = new StateGraph<TestState>()
            .addNode('a', async () => ({}))
            .addEdge('a', END);

        expect(() => graph.compile()).toThrow('edge from START');
    });

    it('존재하지 않는 소스 노드 → Error', () => {
        const graph = new StateGraph<TestState>()
            .addNode('a', async () => ({}))
            .addEdge(START, 'a')
            .addEdge('unknown', 'a');

        expect(() => graph.compile()).toThrow('unknown source node');
    });

    it('존재하지 않는 타겟 노드 → Error', () => {
        const graph = new StateGraph<TestState>()
            .addNode('a', async () => ({}))
            .addEdge(START, 'a')
            .addEdge('a', 'unknown');

        expect(() => graph.compile()).toThrow('unknown target node');
    });
});

// ═══════════════════════════════════════════
// 선형 실행 (A → B → C)
// ═══════════════════════════════════════════

describe('CompiledGraph - 선형 실행', () => {
    it('A → B → C 순서 실행', async () => {
        const graph = new StateGraph<TestState>()
            .addNode('A', async (s) => ({ values: [...s.values, 'A'], count: s.count + 1 }))
            .addNode('B', async (s) => ({ values: [...s.values, 'B'], count: s.count + 1 }))
            .addNode('C', async (s) => ({ values: [...s.values, 'C'], count: s.count + 1 }))
            .addEdge(START, 'A')
            .addEdge('A', 'B')
            .addEdge('B', 'C')
            .addEdge('C', END);

        const result = await graph.compile().run({
            initialState: { values: [], count: 0 }
        });

        expect(result.values).toEqual(['A', 'B', 'C']);
        expect(result.count).toBe(3);
    });
});

// ═══════════════════════════════════════════
// 병렬 실행 (START → [A, B] → C)
// ═══════════════════════════════════════════

describe('CompiledGraph - 병렬 실행', () => {
    it('A와 B가 병렬로 실행된 후 C 실행', async () => {
        const executionOrder: string[] = [];

        // 병렬 노드는 별개 key에 쓰야 shallow merge에서 손실 없음
        const graph = new StateGraph<TestState>()
            .addNode('A', async (s) => {
                await delay(20);
                executionOrder.push('A');
                return { nodeA: 'done' };
            })
            .addNode('B', async (s) => {
                await delay(10);
                executionOrder.push('B');
                return { nodeB: 'done' };
            })
            .addNode('C', async (s) => {
                executionOrder.push('C');
                return { values: [String(s.nodeA), String(s.nodeB), 'C'] };
            })
            .addEdge(START, 'A')
            .addEdge(START, 'B')
            .addEdge('A', 'C')
            .addEdge('B', 'C')
            .addEdge('C', END);

        const result = await graph.compile().run({
            initialState: { values: [], count: 0 }
        });

        // B가 A보다 빠르므로 B가 먼저 완료 (병렬 실행 증명)
        expect(executionOrder.indexOf('B')).toBeLessThan(executionOrder.indexOf('A'));
        // C는 A, B 모두 완료 후 실행
        expect(executionOrder.indexOf('C')).toBe(2);
        expect(result.nodeA).toBe('done');
        expect(result.nodeB).toBe('done');
        expect(result.values).toContain('C');
    });

    it('concurrency=1이면 순차 실행', async () => {
        const executionOrder: string[] = [];

        const graph = new StateGraph<TestState>()
            .addNode('A', async (s) => {
                await delay(5);
                executionOrder.push('A');
                return { values: [...s.values, 'A'] };
            })
            .addNode('B', async (s) => {
                executionOrder.push('B');
                return { values: [...s.values, 'B'] };
            })
            .addEdge(START, 'A')
            .addEdge(START, 'B')
            .addEdge('A', END)
            .addEdge('B', END);

        await graph.compile().run({
            initialState: { values: [], count: 0 },
            concurrency: 1
        });

        // concurrency=1이므로 A가 먼저 시작, 완료 후 B
        expect(executionOrder[0]).toBe('A');
        expect(executionOrder[1]).toBe('B');
    });
});

// ═══════════════════════════════════════════
// 조건부 엣지
// ═══════════════════════════════════════════

describe('CompiledGraph - 조건부 엣지', () => {
    it('condition 결과에 따라 분기', async () => {
        const graph = new StateGraph<TestState>()
            .addNode('router', async (s) => ({ route: 'path_b' }))
            .addNode('path_a', async (s) => ({ values: [...s.values, 'A'] }))
            .addNode('path_b', async (s) => ({ values: [...s.values, 'B'] }))
            .addEdge(START, 'router')
            .addConditionalEdge('router', (s) => s.route ?? END)
            .addEdge('path_a', END)
            .addEdge('path_b', END);

        const result = await graph.compile().run({
            initialState: { values: [], count: 0 }
        });

        expect(result.values).toEqual(['B']);
        expect(result.route).toBe('path_b');
    });

    it('condition이 END를 반환하면 즉시 종료', async () => {
        const graph = new StateGraph<TestState>()
            .addNode('router', async () => ({ route: '__end__' }))
            .addNode('never', async (s) => ({ values: [...s.values, 'NEVER'] }))
            .addEdge(START, 'router')
            .addConditionalEdge('router', () => END)
            .addEdge('never', END);

        const result = await graph.compile().run({
            initialState: { values: [], count: 0 }
        });

        expect(result.values).toEqual([]);
    });

    it('pathMap으로 값을 노드 ID에 매핑', async () => {
        const graph = new StateGraph<TestState>()
            .addNode('classify', async () => ({ route: 'complex' }))
            .addNode('simple_handler', async (s) => ({ values: [...s.values, 'simple'] }))
            .addNode('complex_handler', async (s) => ({ values: [...s.values, 'complex'] }))
            .addEdge(START, 'classify')
            .addConditionalEdge(
                'classify',
                (s) => s.route ?? 'simple',
                { simple: 'simple_handler', complex: 'complex_handler' }
            )
            .addEdge('simple_handler', END)
            .addEdge('complex_handler', END);

        const result = await graph.compile().run({
            initialState: { values: [], count: 0 }
        });

        expect(result.values).toEqual(['complex']);
    });
});

// ═══════════════════════════════════════════
// 진행 상황 콜백
// ═══════════════════════════════════════════

describe('CompiledGraph - progress 콜백', () => {
    it('onNodeProgress가 호출됨', async () => {
        const events: NodeProgressEvent[] = [];

        const graph = new StateGraph<TestState>()
            .addNode('A', async () => ({}))
            .addNode('B', async () => ({}))
            .addEdge(START, 'A')
            .addEdge('A', 'B')
            .addEdge('B', END);

        await graph.compile().run({
            initialState: { values: [], count: 0 },
            onNodeProgress: (e) => events.push(e)
        });

        // A: running + completed, B: running + completed = 최소 4개
        expect(events.length).toBeGreaterThanOrEqual(4);
        expect(events.some(e => e.nodeId === 'A' && e.status === 'running')).toBe(true);
        expect(events.some(e => e.nodeId === 'A' && e.status === 'completed')).toBe(true);
        expect(events.some(e => e.nodeId === 'B' && e.status === 'completed')).toBe(true);
    });

    it('ctx.onProgress로 세부 진행 보고', async () => {
        const events: NodeProgressEvent[] = [];

        const graph = new StateGraph<TestState>()
            .addNode('worker', async (_s, ctx) => {
                ctx.onProgress('50% done', 50);
                return {};
            })
            .addEdge(START, 'worker')
            .addEdge('worker', END);

        await graph.compile().run({
            initialState: { values: [], count: 0 },
            onNodeProgress: (e) => events.push(e)
        });

        expect(events.some(e => e.message === '50% done' && e.progress === 50)).toBe(true);
    });
});

// ═══════════════════════════════════════════
// Abort (취소)
// ═══════════════════════════════════════════

describe('CompiledGraph - abort', () => {
    it('signal.abort() 시 WORKFLOW_ABORTED 에러', async () => {
        const ac = new AbortController();

        const graph = new StateGraph<TestState>()
            .addNode('slow', async () => {
                await delay(100);
                return {};
            })
            .addNode('after', async () => ({}))
            .addEdge(START, 'slow')
            .addEdge('slow', 'after')
            .addEdge('after', END);

        setTimeout(() => ac.abort(), 20);

        try {
            await graph.compile().run({
                initialState: { values: [], count: 0 },
                signal: ac.signal
            });
            expect(true).toBe(false); // should not reach
        } catch (e) {
            expect((e as Error).message).toContain('ABORT');
        }
    });
});

// ═══════════════════════════════════════════
// 노드 실패 처리
// ═══════════════════════════════════════════

describe('CompiledGraph - 에러 핸들링', () => {
    it('노드 실패 시 failed 상태로 진행', async () => {
        const events: NodeProgressEvent[] = [];

        const graph = new StateGraph<TestState>()
            .addNode('fail_node', async () => {
                throw new Error('TEST_FAILURE');
            })
            .addEdge(START, 'fail_node')
            .addEdge('fail_node', END);

        await graph.compile().run({
            initialState: { values: [], count: 0 },
            onNodeProgress: (e) => events.push(e)
        });

        expect(events.some(e => e.nodeId === 'fail_node' && e.status === 'failed')).toBe(true);
    });
});

// ═══════════════════════════════════════════
// parallelBatch
// ═══════════════════════════════════════════

describe('parallelBatch', () => {
    it('모든 아이템 처리', async () => {
        const results = await parallelBatch(
            [1, 2, 3, 4, 5],
            async (item) => item * 2
        );
        expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it('concurrency 제한', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;

        const results = await parallelBatch(
            Array.from({ length: 10 }, (_, i) => i),
            async (item) => {
                concurrent++;
                maxConcurrent = Math.max(maxConcurrent, concurrent);
                await delay(10);
                concurrent--;
                return item;
            },
            { concurrency: 3 }
        );

        expect(maxConcurrent).toBeLessThanOrEqual(3);
        expect(results.length).toBe(10);
    });

    it('실패 아이템은 null 반환', async () => {
        const results = await parallelBatch(
            [1, 2, 3],
            async (item) => {
                if (item === 2) throw new Error('fail');
                return item;
            }
        );

        expect(results[0]).toBe(1);
        expect(results[1]).toBeNull();
        expect(results[2]).toBe(3);
    });

    it('onItemComplete 콜백 호출', async () => {
        let callCount = 0;

        await parallelBatch(
            [1, 2, 3],
            async (item) => item,
            { onItemComplete: () => { callCount++; } }
        );

        expect(callCount).toBe(3);
    });

    it('abort signal 지원', async () => {
        const ac = new AbortController();
        setTimeout(() => ac.abort(), 10);

        try {
            await parallelBatch(
                Array.from({ length: 100 }, (_, i) => i),
                async (item) => {
                    await delay(50);
                    return item;
                },
                { signal: ac.signal, concurrency: 2 }
            );
            expect(true).toBe(false);
        } catch (e) {
            expect((e as Error).message).toContain('ABORT');
        }
    });

    it('빈 배열 처리', async () => {
        const results = await parallelBatch([], async () => 1);
        expect(results).toEqual([]);
    });
});

// ═══════════════════════════════════════════
// 헬퍼
// ═══════════════════════════════════════════

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
