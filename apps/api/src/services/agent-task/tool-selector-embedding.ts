/**
 * Agent Task 동적 도구 서브셋팅 — 임베딩 모드 (Phase 5-4).
 *
 * 키워드 오버랩(2-A) 대신 bge-m3 임베딩 코사인 유사도로 목표 관련 도구를 선별한다.
 * 어휘가 달라도 의미가 통하는 도구(예: "일정 잡아줘" → calendar 도구)를 잡는 것이 목적.
 *
 * 비용 설계: 도구 텍스트(name+description) 벡터는 **모듈 레벨 캐시**(설명 불변 전제, 변경 시
 * 재임베딩) — 첫 task 만 카탈로그 임베딩 비용을 내고 이후는 goal 1건만 임베딩한다(로컬 bge-m3).
 * 실패/타임아웃은 키워드 모드로 폴백(절대 throw 하지 않음).
 *
 * @module services/agent-task/tool-selector-embedding
 */
import OpenAI from 'openai';
import type { ToolDefinition } from '../../llm/types';
import { getConfig } from '../../config/env';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { selectRelevantTools, type SelectToolsOptions } from './tool-selector';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskToolEmbed');

/** 도구 벡터 캐시 — name → {desc(무효화 키), vec}. 카탈로그 설명은 사실상 불변. */
const vecCache = new Map<string, { desc: string; vec: number[] }>();

async function embedBatch(texts: string[]): Promise<number[][]> {
    const cfg = getConfig();
    const client = new OpenAI({ baseURL: cfg.llmBaseUrl, apiKey: cfg.llmApiKey });
    const res = await client.embeddings.create({ model: cfg.searchRerankEmbedModel, input: texts });
    return res.data.map((d) => d.embedding as number[]);
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
        const work = (async () => {
            // 캐시 미스 도구만 배치 임베딩(설명 변경 시 재임베딩).
            const misses = candidates.filter((t) => vecCache.get(t.function.name)?.desc !== toolText(t));
            for (let i = 0; i < misses.length; i += 64) {
                const batch = misses.slice(i, i + 64);
                const vecs = await embedBatch(batch.map(toolText));
                batch.forEach((t, j) => vecCache.set(t.function.name, { desc: toolText(t), vec: vecs[j] }));
            }
            const [goalVec] = await embedBatch([goal.slice(0, 512)]);
            return candidates
                .map((t) => ({ t, sim: cosine(goalVec, vecCache.get(t.function.name)!.vec) }))
                .filter((x) => x.sim >= AGENT_TASK_LIMITS.DYNAMIC_TOOLS_EMBED_MIN_SIM)
                .sort((a, b) => b.sim - a.sim || a.t.function.name.localeCompare(b.t.function.name))
                .slice(0, opts.budget)
                .map((x) => x.t);
        })();
        const timeout = new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error(`임베딩 선별 타임아웃(${deadline}ms)`)), deadline).unref());
        return await Promise.race([work, timeout]);
    } catch (e) {
        logger.warn(`[ToolEmbed] 임베딩 선별 실패 — 키워드 폴백: ${e instanceof Error ? e.message : e}`);
        return selectRelevantTools(goal, catalog, opts);
    }
}
