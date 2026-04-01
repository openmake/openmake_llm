/**
 * ============================================================
 * WorkflowGraph - LangGraph 패턴 기반 경량 그래프 실행 엔진
 * ============================================================
 *
 * LangGraph의 핵심 패턴(StateGraph, 병렬 노드 실행, 조건부 엣지)을
 * 외부 의존성 없이 자체 구현한 경량 워크플로우 엔진입니다.
 *
 * 핵심 개념:
 * - Node: 상태를 받아 부분 업데이트를 반환하는 비동기 함수
 * - Edge: 노드 간 정적 연결
 * - ConditionalEdge: 런타임에 다음 노드를 결정하는 동적 분기
 * - 병렬 실행: 의존성이 충족된 노드는 자동으로 동시 실행
 *
 * @module utils/graph-engine
 */

import { createLogger } from '../utils/logger';
<<<<<<< HEAD:backend/api/src/utils/graph-engine.ts
import { errorMessage } from '../utils/error-message';
=======
import { EVENT_LOOP_YIELD_MS } from '../config/runtime-limits';
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78:backend/api/src/workflow/graph-engine.ts

const logger = createLogger('WorkflowGraph');

// ============================================================
// 타입 정의
// ============================================================

/** 노드 핸들러: 현재 상태 -> 부분 상태 업데이트 */
export type NodeHandler<S> = (state: S, ctx: ExecutionContext) => Promise<Partial<S>>;

/** 조건부 라우팅 함수: 현재 상태 -> 다음 노드 ID (또는 END) */
export type ConditionFn<S> = (state: S) => string | typeof END;

/** 그래프 시작/종료 심볼 */
export const START = '__start__' as const;
export const END = '__end__' as const;

/** 노드 실행 상태 */
type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** 실행 컨텍스트 (핸들러에 전달) */
export interface ExecutionContext {
    /** 현재 노드 ID */
    nodeId: string;
    /** AbortSignal (취소 지원) */
    signal: AbortSignal;
    /** 진행 상황 콜백 */
    onProgress: (message: string, percent: number) => void;
}

/** 노드 진행 이벤트 */
export interface NodeProgressEvent {
    nodeId: string;
    status: NodeStatus;
    message?: string;
    progress?: number;
    completedCount: number;
    totalCount: number;
}

/** 그래프 실행 옵션 */
export interface GraphRunOptions<S> {
    /** 초기 상태 */
    initialState: S;
    /** AbortSignal (취소 지원) */
    signal?: AbortSignal;
    /** 노드 진행 콜백 */
    onNodeProgress?: (event: NodeProgressEvent) => void;
    /** 동시 실행 제한 (기본: Infinity) */
    concurrency?: number;
}

// ============================================================
// 내부 구조
// ============================================================

interface NodeDef<S> {
    id: string;
    handler: NodeHandler<S>;
}

interface StaticEdge {
    type: 'static';
    from: string;
    to: string;
}

interface ConditionalEdge<S> {
    type: 'conditional';
    from: string;
    condition: ConditionFn<S>;
    /** condition 반환값 -> 노드 ID 매핑. 생략 시 반환값을 노드 ID로 직접 사용 */
    pathMap?: Record<string, string>;
}

type Edge<S> = StaticEdge | ConditionalEdge<S>;

// ============================================================
// StateGraph 빌더
// ============================================================

export class StateGraph<S extends Record<string, unknown>> {
    private nodes = new Map<string, NodeDef<S>>();
    private edges: Edge<S>[] = [];

    /**
     * 노드 추가
     */
    addNode(id: string, handler: NodeHandler<S>): this {
        if (this.nodes.has(id)) {
            throw new Error(`Node "${id}" already exists`);
        }
        this.nodes.set(id, { id, handler });
        return this;
    }

    /**
     * 정적 엣지 추가 (from -> to)
     */
    addEdge(from: string, to: string): this {
        this.edges.push({ type: 'static', from, to });
        return this;
    }

    /**
     * 조건부 엣지 추가 (from -> condition(state) -> target)
     */
    addConditionalEdge(
        from: string,
        condition: ConditionFn<S>,
        pathMap?: Record<string, string>
    ): this {
        this.edges.push({ type: 'conditional', from, condition, pathMap });
        return this;
    }

    /**
     * 그래프 컴파일 -> 실행 가능한 CompiledGraph 반환
     */
    compile(): CompiledGraph<S> {
        this.validate();
        return new CompiledGraph(
            new Map(this.nodes),
            [...this.edges]
        );
    }

    private validate(): void {
        // START에서 나가는 엣지가 있는지 확인
        const hasStart = this.edges.some(e => e.from === START);
        if (!hasStart) {
            throw new Error('Graph must have at least one edge from START');
        }

        // 모든 엣지의 from/to가 유효한 노드인지 확인 (START, END 제외)
        for (const edge of this.edges) {
            if (edge.from !== START && !this.nodes.has(edge.from)) {
                throw new Error(`Edge references unknown source node: "${edge.from}"`);
            }
            if (edge.type === 'static' && edge.to !== END && !this.nodes.has(edge.to)) {
                throw new Error(`Edge references unknown target node: "${edge.to}"`);
            }
        }
    }
}

// ============================================================
// CompiledGraph 실행기
// ============================================================

export class CompiledGraph<S extends Record<string, unknown>> {
    constructor(
        private nodes: Map<string, NodeDef<S>>,
        private edges: Edge<S>[]
    ) {}

    /**
     * 그래프 실행
     *
     * DAG 기반 실행: 의존성이 충족된 노드들을 자동으로 병렬 실행합니다.
     * 조건부 엣지는 소스 노드 완료 후 런타임에 평가됩니다.
     */
    async run(options: GraphRunOptions<S>): Promise<S> {
        const { initialState, signal, onNodeProgress, concurrency = Infinity } = options;

        let state = { ...initialState };
        const nodeStatuses = new Map<string, NodeStatus>();
        const resolvedTargets = new Map<string, Set<string>>();

        // 모든 노드를 pending으로 초기화
        for (const id of this.nodes.keys()) {
            nodeStatuses.set(id, 'pending');
        }

        // START에서 나가는 직접 타겟 해석
        resolvedTargets.set(START, this.resolveTargets(START, state));

        const totalNodes = this.nodes.size;
        let completedCount = 0;

        const emitProgress = (nodeId: string, status: NodeStatus, message?: string) => {
            onNodeProgress?.({
                nodeId,
                status,
                message,
                completedCount,
                totalCount: totalNodes
            });
        };

        // 메인 실행 루프
        while (true) {
            this.throwIfAborted(signal);

            // 실행 가능한 노드 찾기: pending이고 모든 선행 노드가 completed
            const ready = this.findReadyNodes(nodeStatuses, resolvedTargets);

            if (ready.length === 0) {
                // 더 이상 실행할 노드가 없으면 종료
                const running = [...nodeStatuses.values()].filter(s => s === 'running').length;
                if (running === 0) break;
                // running 노드가 있으면 대기 (아래 Promise.race에서 처리)
            }

            // 동시 실행 제한 적용
            const runningCount = [...nodeStatuses.values()].filter(s => s === 'running').length;
            const canLaunch = Math.min(ready.length, concurrency - runningCount);
            const toRun = ready.slice(0, Math.max(0, canLaunch));

            if (toRun.length === 0 && runningCount === 0) break;

            // 노드들을 병렬 실행
            const runningPromises: Array<Promise<{ nodeId: string; result: Partial<S> | null }>> = [];

            for (const nodeId of toRun) {
                nodeStatuses.set(nodeId, 'running');
                emitProgress(nodeId, 'running');

                const node = this.nodes.get(nodeId)!;
                const ctx: ExecutionContext = {
                    nodeId,
                    signal: signal ?? new AbortController().signal,
                    onProgress: (message, percent) => {
                        emitProgress(nodeId, 'running', message);
                        onNodeProgress?.({
                            nodeId,
                            status: 'running',
                            message,
                            progress: percent,
                            completedCount,
                            totalCount: totalNodes
                        });
                    }
                };

                const promise = node.handler({ ...state }, ctx)
                    .then(result => ({ nodeId, result }))
                    .catch(error => {
                        const msg = errorMessage(error);
                        logger.error(`Node "${nodeId}" failed: ${msg}`);
                        nodeStatuses.set(nodeId, 'failed');
                        emitProgress(nodeId, 'failed', msg);
                        return { nodeId, result: null };
                    });

                runningPromises.push(promise);
            }

            // 이미 실행 중인 것이 있으면 하나라도 완료될 때까지 대기
            if (runningPromises.length === 0) {
                // running 중인 노드 대기를 위한 짧은 지연
                await new Promise(resolve => setTimeout(resolve, EVENT_LOOP_YIELD_MS));
                continue;
            }

            // 모든 병렬 노드 완료 대기
            const results = await Promise.all(runningPromises);

            for (const { nodeId, result } of results) {
                if (result === null) continue; // failed node

                // 상태 머지
                state = { ...state, ...result };
                nodeStatuses.set(nodeId, 'completed');
                completedCount++;
                emitProgress(nodeId, 'completed');

                // 완료된 노드에서 나가는 타겟 해석
                resolvedTargets.set(nodeId, this.resolveTargets(nodeId, state));
            }
        }

        return state;
    }

    /**
     * 소스 노드에서 나가는 타겟 노드들을 해석
     */
    private resolveTargets(sourceId: string, state: S): Set<string> {
        const targets = new Set<string>();

        for (const edge of this.edges) {
            if (edge.from !== sourceId) continue;

            if (edge.type === 'static') {
                if (edge.to !== END) {
                    targets.add(edge.to);
                }
            } else {
                const rawTarget = edge.condition(state);
                if (rawTarget === END) continue;
                const mapped = edge.pathMap?.[rawTarget] ?? rawTarget;
                if (mapped !== END && this.nodes.has(mapped)) {
                    targets.add(mapped);
                }
            }
        }

        return targets;
    }

    /**
     * 실행 가능한 노드 찾기:
     * - status가 pending
     * - 이 노드를 타겟으로 가리키는 모든 소스 노드가 completed (또는 START)
     */
    private findReadyNodes(
        statuses: Map<string, NodeStatus>,
        resolvedTargets: Map<string, Set<string>>
    ): string[] {
        const ready: string[] = [];

        for (const [nodeId, status] of statuses) {
            if (status !== 'pending') continue;

            // 이 노드를 타겟으로 지목한 소스가 있는지 확인
            let isTargeted = false;
            let allSourcesCompleted = true;

            for (const [sourceId, targets] of resolvedTargets) {
                if (targets.has(nodeId)) {
                    isTargeted = true;
                    if (sourceId !== START && statuses.get(sourceId) !== 'completed') {
                        allSourcesCompleted = false;
                        break;
                    }
                }
            }

            // 타겟으로 지목되었고, 모든 소스가 완료된 경우 실행 가능
            if (isTargeted && allSourcesCompleted) {
                ready.push(nodeId);
            }
        }

        return ready;
    }

    private throwIfAborted(signal?: AbortSignal): void {
        if (signal?.aborted) {
            throw new Error('WORKFLOW_ABORTED');
        }
    }
}

// ============================================================
// 유틸리티: 배치 병렬 실행 헬퍼
// ============================================================

/**
 * 배열 아이템을 병렬 처리하되 동시 실행 수를 제한하는 헬퍼.
 * StateGraph 없이 단순한 병렬 배치 처리가 필요한 경우에 사용.
 *
 * @param items - 처리할 아이템 배열
 * @param handler - 각 아이템 처리 함수
 * @param options - 동시 실행 수, abort signal, 진행 콜백
 * @returns 처리 결과 배열 (실패한 아이템은 null)
 */
export async function parallelBatch<T, R>(
    items: T[],
    handler: (item: T, index: number) => Promise<R>,
    options: {
        concurrency?: number;
        signal?: AbortSignal;
        onItemComplete?: (index: number, total: number, result: R | null) => void;
    } = {}
): Promise<Array<R | null>> {
    const { concurrency = 5, signal, onItemComplete } = options;
    const results: Array<R | null> = new Array(items.length).fill(null);
    let nextIndex = 0;
    let completed = 0;

    const runNext = async (): Promise<void> => {
        while (nextIndex < items.length) {
            if (signal?.aborted) throw new Error('BATCH_ABORTED');
            const idx = nextIndex++;
            try {
                results[idx] = await handler(items[idx], idx);
            } catch {
                results[idx] = null;
            }
            completed++;
            onItemComplete?.(completed, items.length, results[idx]);
        }
    };

    const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        () => runNext()
    );
    await Promise.all(workers);

    return results;
}
