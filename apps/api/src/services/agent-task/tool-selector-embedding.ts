/**
 * Agent Task 동적 도구 서브셋팅 — 임베딩 모드 (Phase 5-4).
 *
 * 키워드 오버랩(2-A) 대신 `text.embed` 배정 모델 임베딩 코사인 유사도로 목표 관련 도구를 선별한다.
 * 어휘가 달라도 의미가 통하는 도구(예: "일정 잡아줘" → calendar 도구)를 잡는 것이 목적.
 *
 * 모델은 행위자(costUserId)의 text.embed 배정(개인 → 전역)으로 정하고, 외부 모델은 그 사용자의 키로만 돈다(text-embed).
 * 비용 설계: 도구 텍스트(name+description) 벡터는 **모듈 레벨 캐시**(모델·차원별 분리, 설명 불변 전제, 변경 시
 * 재임베딩) — 모델마다 첫 task 만 카탈로그 임베딩 비용을 내고 이후는 goal 1건만 임베딩한다.
 * 미배정·키 없음·실패/타임아웃은 키워드 모드로 폴백(절대 throw 하지 않음).
 *
 * @module services/agent-task/tool-selector-embedding
 */
import type { ToolDefinition } from '../../llm/types';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { selectRelevantTools, type SelectToolsOptions } from './tool-selector';
import { recordCost } from '../cost/cost-ledger-service';
import { resolveTextEmbed, embedTexts, logTextEmbedFailure } from '../orchestrator/text-embed';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskToolEmbed');

type ToolVecs = Map<string, { desc: string; vec: number[] }>;

/** 도구 벡터 캐시 — modelKey(모델·차원) → name → {desc(무효화 키), vec}. 다른 모델 벡터끼리 비교하지 않게 분리한다. */
const vecCache = new Map<string, ToolVecs>();

/** modelKey 의 도구 벡터 맵 — 새 키가 상한을 넘기면 가장 먼저 들어온 키를 버린다 */
function vecsFor(modelKey: string): ToolVecs {
    let m = vecCache.get(modelKey);
    if (m) return m;
    m = new Map();
    vecCache.set(modelKey, m);
    while (vecCache.size > Math.max(1, AGENT_TASK_LIMITS.DYNAMIC_TOOLS_EMBED_CACHE_MODELS)) {
        vecCache.delete(vecCache.keys().next().value as string);
    }
    return m;
}

/** 테스트용 초기화 */
export function clearToolVectorCache(): void {
    vecCache.clear();
}

function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
}

function toolText(t: ToolDefinition): string {
    return `${t.function.name}: ${(t.function.description ?? '').slice(0, 300)}`;
}

/**
 * 임베딩 기반 top-K 도구 선별. 유사도 임계 미만은 예산이 남아도 제외(무관 도구 미주입 원칙 유지).
 * 임베딩 실패/타임아웃 시 키워드 모드(selectRelevantTools)로 폴백.
 */
export async function selectRelevantToolsEmbedding(
    goal: string,
    catalog: ToolDefinition[],
    opts: SelectToolsOptions,
): Promise<ToolDefinition[]> {
    if (opts.budget <= 0) return [];
    const exclude = opts.exclude ?? new Set<string>();
    const candidates = catalog.filter((t) => !exclude.has(t.function.name));
    if (candidates.length === 0) return [];

    try {
        const deadline = AGENT_TASK_LIMITS.DYNAMIC_TOOLS_EMBED_TIMEOUT_MS;
        // 한 신호를 모든 호출이 나눠 쓴다 — 기한이 지나면 진행 중 호출이 실제로 끊기고 work 의 finally 를 지난다.
        const signal = AbortSignal.timeout(deadline);
        const work = (async () => {
            // 해석(DB 조회·키 복호화)도 기한 안이다. 미배정·키 없음은 throw → 키워드 폴백.
            const te = await resolveTextEmbed(opts.costUserId);
            const cache = vecsFor(te.modelKey);
            let embedCalls = 0;
            try {
                // 캐시 미스 도구만 배치 임베딩(설명 변경 시 재임베딩).
                const misses = candidates.filter((t) => cache.get(t.function.name)?.desc !== toolText(t));
                for (let i = 0; i < misses.length; i += 64) {
                    const batch = misses.slice(i, i + 64);
                    const vecs = await embedTexts(te, batch.map(toolText), { timeoutMs: deadline, signal });
                    embedCalls++;
                    batch.forEach((t, j) => cache.set(t.function.name, { desc: toolText(t), vec: vecs[j] }));
                }
                const [goalVec] = await embedTexts(te, [goal.slice(0, 512)], { timeoutMs: deadline, signal });
                embedCalls++;
                return candidates
                    .map((t) => ({ t, sim: cosine(goalVec, cache.get(t.function.name)!.vec) }))
                    .filter((x) => x.sim >= AGENT_TASK_LIMITS.DYNAMIC_TOOLS_EMBED_MIN_SIM)
                    .sort((a, b) => b.sim - a.sim || a.t.function.name.localeCompare(b.t.function.name))
                    .slice(0, opts.budget)
                    .map((x) => x.t);
            } finally {
                // 원장 적재(kind search.embed, unit call — F25 kind 배선, S6). 성공한 호출만 센다 — 중간 실패·기한 초과에도 이미 나간 호출은 남긴다.
                if (opts.costUserId && embedCalls > 0) {
                    recordCost({
                        userId: opts.costUserId, kind: 'search.embed', unit: 'call', rateKey: te.target.model, quantity: embedCalls,
                        costOwner: te.target.costOwner === 'user' ? 'byok' : 'user', ctx: { feature: 'agent_task_tool_select' },
                    });
                }
            }
        })();
        const timeout = new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error(`임베딩 선별 타임아웃(${deadline}ms)`)), deadline).unref());
        return await Promise.race([work, timeout]);
    } catch (e) {
        logTextEmbedFailure(logger, '[ToolEmbed] 임베딩 선별 실패 — 키워드 폴백', e);
        return selectRelevantTools(goal, catalog, opts);
    }
}
