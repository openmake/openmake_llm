/**
 * 범용 DAG 실행기 (하네스 P2-8) — 의존 관계(dependsOn)가 있는 작업들을 동시성 상한 안에서 실행한다.
 * 도메인을 모른다: 실행·판정·결과 생성은 호출부 콜백이 맡는다(멀티모달 오케스트레이터 executePlan 이 첫 소비처).
 *
 * 규칙(두 모드 공통):
 *  - 사전 확정(presettled)된 노드는 실행하지 않고 그 결과를 쓴다(예: 실행 전 거절).
 *  - 선행 노드가 실패(isOk=false)했으면 실행하지 않고 onBlocked 결과로 확정한다 — 실패는 하위로 전파된다.
 *  - 실행이 reject 하면 onRejected 결과로 확정한다(부분 실패 흡수).
 *  - signal 이 중단되면 새 노드를 시작하지 않고, 실행 중인 노드가 끝나길 기다린 뒤 남은 노드를 onUnreached 로 채운다.
 * 모드:
 *  - 'levels'(기본·종전): 레벨(같은 깊이) 단위 장벽 — 한 레벨이 모두 끝나야 다음 레벨을 시작한다.
 *  - 'eager': 장벽 없음 — 선행이 모두 끝난 노드는 바로 시작한다(긴 형제 작업이 무관한 하위 작업을 붙잡지 않는다).
 * 결과는 확정된 순서대로 돌려준다.
 *
 * 조건 분기·노드별 재개는 넣지 않는다 — 2026-11-25 보류 결정(하네스 v1.1 로드맵 P2 "범용 워크플로 그래프").
 *   - 실측: 최근 60일 운영 multi 계획 132건(nightly 평가 계정 제외) 중 depends_on 을 가진 계획 0건, 평균 작업 1.25개·최대 4개.
 *     실패 23건도 전부 의존 없는 계획이라 "선행 실패 뒤 다른 가지로" 를 쓸 자리가 없었다.
 *   - 계획 스키마(services/orchestrator/plan-schema)에 조건 필드가 없고, 만들면 Planner 가 그것을 내야 한다 — 스키마 강제
 *     디코딩은 선언한 키만 만들므로(영상 인자 선례) 프롬프트·스키마·평가까지 함께 바뀐다.
 *   - 노드별 재개: 오래 걸리는 노드(영상 job)는 이미 orchestrator_jobs 가 다음 턴에 재조회로 잇는다.
 *   - 에이전트 작업의 전면 DAG 는 별도로 반려됐다(계획 노드 마킹 고착 51%).
 * 다시 검토할 조건: 의존이 있는 계획이 실제로 나오고, 그 계획에서 선행 실패가 하위를 통째로 막는 사례가 쌓일 때.
 *
 * @module workflow/dag-runner
 */

export interface DagNode {
    id: string;
    dependsOn: readonly string[];
}

export type DagMode = 'levels' | 'eager';

export interface DagRunOptions<N extends DagNode, R> {
    nodes: readonly N[];
    /** levels 모드의 레벨 — 생략하면 nodes 에서 계산한다 */
    levels?: ReadonlyArray<readonly N[]>;
    mode?: DagMode;
    /** 동시 실행 상한(eager 모드, levels 모드는 레벨 안 상한) — 기본 무제한 */
    maxParallel?: number;
    signal?: AbortSignal;
    run: (node: N) => Promise<R>;
    isOk: (result: R) => boolean;
    presettled?: (node: N) => R | undefined;
    onBlocked: (node: N, blockedBy: string) => R;
    onRejected: (node: N, reason: unknown) => R;
    onUnreached: (node: N) => R;
    /** 노드가 확정될 때마다(사전 확정·차단·실행·미도달 포함) */
    onSettled?: (node: N, result: R, how: 'presettled' | 'blocked' | 'ran' | 'unreached') => void;
}

export interface DagRunResult<N, R> {
    settled: Array<{ node: N; result: R }>;
    /** 중단으로 미도달 노드가 생겼는가 */
    interrupted: boolean;
}

export class DagCycleError extends Error {
    constructor(readonly ids: string[]) { super(`DAG 순환 또는 알 수 없는 선행: ${ids.join(', ')}`); this.name = 'DagCycleError'; }
}

/** PURE: 위상 레벨(Kahn). 모르는 선행·순환이면 DagCycleError. */
export function topoLevels<N extends DagNode>(nodes: readonly N[]): N[][] {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const depth = new Map<string, number>();
    const remaining = new Set(nodes.map((n) => n.id));
    let progressed = true;
    while (remaining.size > 0 && progressed) {
        progressed = false;
        for (const id of [...remaining]) {
            const n = byId.get(id) as N;
            if (n.dependsOn.every((d) => depth.has(d))) {
                depth.set(id, n.dependsOn.reduce((m, d) => Math.max(m, (depth.get(d) as number) + 1), 0));
                remaining.delete(id);
                progressed = true;
            }
        }
    }
    if (remaining.size > 0) throw new DagCycleError([...remaining]);
    const levels: N[][] = [];
    for (const n of nodes) (levels[depth.get(n.id) as number] ??= []).push(n);
    return levels.filter(Boolean);
}

async function boundedAll<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
    const out: PromiseSettledResult<R>[] = new Array(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const i = next++;
            try { out[i] = { status: 'fulfilled', value: await fn(items[i]) }; } catch (reason) { out[i] = { status: 'rejected', reason }; }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return out;
}

export async function runDag<N extends DagNode, R>(o: DagRunOptions<N, R>): Promise<DagRunResult<N, R>> {
    const settled: Array<{ node: N; result: R }> = [];
    const outcome = new Map<string, boolean>(); // id → ok
    const limit = o.maxParallel && o.maxParallel > 0 ? o.maxParallel : Number.MAX_SAFE_INTEGER;
    const settle = (node: N, result: R, how: 'presettled' | 'blocked' | 'ran' | 'unreached'): void => {
        settled.push({ node, result });
        outcome.set(node.id, how === 'ran' || how === 'presettled' ? o.isOk(result) : false);
        o.onSettled?.(node, result, how);
    };
    /** 실행 전 확정 — 사전 확정이거나 선행 실패면 true */
    const settleWithoutRun = (node: N): boolean => {
        const pre = o.presettled?.(node);
        if (pre !== undefined) { settle(node, pre, 'presettled'); return true; }
        const blockedBy = node.dependsOn.find((d) => outcome.get(d) === false);
        if (blockedBy) { settle(node, o.onBlocked(node, blockedBy), 'blocked'); return true; }
        return false;
    };
    const runOne = async (node: N): Promise<void> => {
        let r: R;
        try { r = await o.run(node); } catch (e) { r = o.onRejected(node, e); }
        settle(node, r, 'ran');
    };

    if ((o.mode ?? 'levels') === 'levels') {
        for (const level of o.levels ?? topoLevels(o.nodes)) {
            if (o.signal?.aborted) break;
            const runnable = level.filter((n) => !settleWithoutRun(n));
            const res = await boundedAll(runnable, limit, (n) => o.run(n));
            res.forEach((s, i) => settle(runnable[i], s.status === 'fulfilled' ? s.value : o.onRejected(runnable[i], s.reason), 'ran'));
        }
    } else {
        topoLevels(o.nodes); // 순환·모르는 선행 검사(eager 는 레벨을 쓰지 않는다)
        const waiting = [...o.nodes];
        const inflight = new Set<Promise<void>>();
        for (;;) {
            if (!o.signal?.aborted) {
                // 선행이 모두 확정된 노드 — 실행 없이 확정되는 노드가 다른 노드를 풀 수 있으니 고정점까지 돈다
                for (let changed = true; changed;) {
                    changed = false;
                    for (let i = 0; i < waiting.length;) {
                        const n = waiting[i];
                        if (!n.dependsOn.every((d) => outcome.has(d))) { i++; continue; }
                        if (settleWithoutRun(n)) { waiting.splice(i, 1); changed = true; continue; }
                        if (inflight.size >= limit) { i++; continue; }
                        waiting.splice(i, 1);
                        const p: Promise<void> = runOne(n).finally(() => { inflight.delete(p); });
                        inflight.add(p);
                    }
                }
            }
            if (inflight.size === 0) break;
            await Promise.race(inflight);
        }
    }
    const done = new Set(settled.map((s) => s.node.id));
    const unreached = o.nodes.filter((n) => !done.has(n.id));
    for (const n of unreached) settle(n, o.onUnreached(n), 'unreached');
    return { settled, interrupted: unreached.length > 0 };
}
