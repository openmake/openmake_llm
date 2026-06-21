/**
 * ============================================================
 * parallelBatch - 배치 병렬 실행 헬퍼
 * ============================================================
 *
 * 배열 아이템을 동시 실행 수를 제한해 병렬 처리하는 경량 유틸리티.
 * (LangGraph 패턴의 StateGraph/CompiledGraph 엔진은 미사용으로 제거됨 — parallelBatch만 잔존)
 *
 * @module workflow/graph-engine
 */

/**
 * 배열 아이템을 병렬 처리하되 동시 실행 수를 제한하는 헬퍼.
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
