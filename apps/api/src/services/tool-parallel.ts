/**
 * 턴 내 읽기 전용 도구 병렬 선실행 — 채팅·에이전트 작업·서브에이전트 공용.
 *
 * 패턴(generate_image 선례): 호출 목록에서 병렬 가능한 것을 골라 **먼저 동시에 실행**해 결과를
 * id → 텍스트 맵에 담고, 기존 순차 루프는 그 맵을 먼저 보고 없을 때만 직접 실행한다. 그래서
 * 대화 메시지·스텝 영속·체크포인트의 **순서 계약은 그대로**다.
 *
 * 병렬 대상 판정은 호출측이 `isEligible` 로 준다 — 이름이 읽기 전용 목록에 있는 것 외에,
 * 작업 경로는 승인 게이트(HITL fan-in 회피)도 봐야 하기 때문.
 *
 * @module services/tool-parallel
 */
import { READ_ONLY_TOOL_PARALLEL } from '../config/runtime-limits';
import { parallelBatch } from '../workflow/graph-engine';
import { createLogger } from '../utils/logger';

const logger = createLogger('ToolParallel');

/**
 * 읽기 전용(부작용 없음) 도구인가.
 *  - 빌트인: 설정의 정확한 이름 목록.
 *  - 외부 MCP(`server::tool`): 도구 부분에 조회 키워드가 있고 쓰기 키워드가 없을 때만.
 *    모르는 도구는 기본 **순차**(false) — 병렬이 잘못되면 부작용 순서가 깨지므로 보수적으로 판정.
 */
export function isReadOnlyTool(name: string): boolean {
    if ((READ_ONLY_TOOL_PARALLEL.TOOL_NAMES as readonly string[]).includes(name)) return true;
    const sep = name.indexOf('::');
    if (sep < 0) return false;
    const tool = name.slice(sep + 2).toLowerCase();
    const reads = READ_ONLY_TOOL_PARALLEL.MCP_READ_KEYWORDS.some((k) => tool.includes(k));
    const writes = READ_ONLY_TOOL_PARALLEL.MCP_WRITE_KEYWORDS.some((k) => tool.includes(k));
    return reads && !writes;
}

export interface ParallelCall {
    /** 없으면 결과를 매핑할 수 없어 병렬 대상에서 제외한다(순차 실행). */
    id: string | undefined;
    name: string;
}

/**
 * 병렬 가능한 호출을 골라 동시에 실행한다. **2건 이상일 때만** 동작한다(1건은 순차와 같다).
 * 실패는 개별 결과(`Error: …` 문자열)로 흡수해 다른 호출을 죽이지 않는다 — abort 만 전파.
 * 반환 맵에 없는 id 는 호출측이 종전대로 순차 실행한다.
 */
export async function prefetchReadOnlyCalls<T extends ParallelCall>(
    calls: T[],
    isEligible: (call: T) => boolean,
    exec: (call: T) => Promise<string>,
    opts: { signal?: AbortSignal; path: string } ,
): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    if (!READ_ONLY_TOOL_PARALLEL.ENABLED) return results;
    const eligible = calls.filter((c) => c.id !== undefined && isReadOnlyTool(c.name) && isEligible(c));
    if (eligible.length < 2) return results;

    const started = Date.now();
    await parallelBatch(
        eligible,
        async (call) => {
            try {
                results.set(call.id as string, await exec(call));
            } catch (e) {
                // 개별 실패는 그 호출의 결과로만 남긴다 — 순차 실행 때와 같은 표면.
                results.set(call.id as string, `Error: ${e instanceof Error ? e.message : String(e)}`);
            }
        },
        { concurrency: READ_ONLY_TOOL_PARALLEL.MAX_CONCURRENT, ...(opts.signal ? { signal: opts.signal } : {}) },
    );
    logger.info(`[ToolParallel] ${opts.path}: 읽기 전용 ${eligible.length}건 병렬 실행 `
        + `(${[...new Set(eligible.map((c) => c.name))].join(',')}, 동시 상한 ${READ_ONLY_TOOL_PARALLEL.MAX_CONCURRENT}, ${Date.now() - started}ms)`);
    return results;
}
