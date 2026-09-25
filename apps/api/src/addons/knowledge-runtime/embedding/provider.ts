/**
 * 임베딩 provider — 모델은 OpenMake capability 설정 `text.embed` 의 **system 배정**으로 해석한다.
 * 사용자별 배정은 쓰지 않는다(서로 다른 모델의 벡터가 한 index 에 섞이면 안 된다).
 * 모델명·주소·차원을 코드에 두지 않는다 — 전부 capability 해석 + 실제 응답에서 얻는다.
 *
 * @module addons/knowledge-runtime/embedding/provider
 */
import { resolveCapabilityTarget, resolveCapabilityTargetForModel, type CapabilityTarget } from '../../../services/orchestrator/capability-resolver';
import { callJson } from '../../../services/orchestrator/http-call';
import { recordCost } from '../../../services/cost/cost-ledger-service';
import type { CostOwner } from '../../../config/cost-kinds';
import { createLogger } from '../../../utils/logger';
import { KNOWLEDGE_RUNTIME } from '../constants';
import { getDefaultLimits } from '../config/profiles';

const logger = createLogger('KnowledgeEmbed');

export interface EmbeddingProviderInfo {
    /** 표시·감사용 provider 참조(예: 'local-llm:bge-m3') */
    providerRef: string;
    /** 게이트웨이에 보내는 model 값 */
    modelId: string;
    /** 실제 임베딩 응답으로 측정한 차원 */
    dimension: number;
}

/** 임베딩 함수 시그니처 — 파이프라인·reindex 가 테스트에서 주입할 수 있게 별도 타입 */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

interface EmbeddingResponse {
    data?: Array<{ index?: number; embedding?: number[] }>;
}

/** system scope 로 text.embed 대상을 해석한다(userId 없음 → 전역/기본) */
async function resolveEmbedTarget(): Promise<CapabilityTarget> {
    return resolveCapabilityTarget('text.embed');
}

/** costOwner 매핑 — 로컬/서버 인프라는 'server', 사용자 BYOK 는 'byok' */
function costOwnerOf(target: CapabilityTarget): CostOwner {
    return target.costOwner === 'user' ? 'byok' : 'server';
}

/** 한 배치 임베딩 호출 — data 를 index 순으로 정렬해 입력 순서를 보장한다 */
async function embedBatch(target: CapabilityTarget, texts: string[]): Promise<number[][]> {
    const body: Record<string, unknown> = { model: target.model, input: texts };
    if (target.params.dimensions) body.dimensions = Number(target.params.dimensions);
    const json = await callJson<EmbeddingResponse>(target, { body, timeoutMs: KNOWLEDGE_RUNTIME.EMBED_TIMEOUT_MS });
    const data = json.data ?? [];
    const out: number[][] = new Array(texts.length);
    for (let i = 0; i < data.length; i++) {
        const idx = typeof data[i].index === 'number' ? (data[i].index as number) : i;
        const vec = data[i].embedding;
        if (!Array.isArray(vec) || vec.length === 0) throw new Error('임베딩 응답에 벡터가 없습니다');
        out[idx] = vec;
    }
    for (let i = 0; i < texts.length; i++) if (!out[i]) throw new Error('임베딩 응답 개수가 입력과 다릅니다');
    return out;
}

/** 배치 임베딩 코어 — limits.embedBatchSize 로 나눠 부르고 비용을 원장 kind search.embed(호출 수)로 남긴다 */
async function runEmbed(target: CapabilityTarget, texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const limits = await getDefaultLimits();
    const batchSize = Math.max(1, limits.embedBatchSize);
    const out: number[][] = [];
    let calls = 0;
    for (let i = 0; i < texts.length; i += batchSize) {
        const vecs = await embedBatch(target, texts.slice(i, i + batchSize));
        out.push(...vecs);
        calls++;
    }
    recordCost({
        userId: null, // system scope — 특정 사용자에 귀속하지 않는다
        kind: 'search.embed', unit: 'call', rateKey: target.model, quantity: calls,
        costOwner: costOwnerOf(target), ctx: { feature: 'knowledge' },
    });
    return out;
}

/**
 * 라이브 배정으로 임베딩한다 — **새 index 생성/reindex 전용**.
 * 활성 index 에 넣거나 검색할 때는 배정이 바뀌어도 안 되므로 makeIndexEmbedder 를 쓴다.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return runEmbed(await resolveEmbedTarget(), texts);
}

/** makeIndexEmbedder 가 필요로 하는 index 의 기록 모델(provider_ref·model_id·dimension) */
export interface IndexEmbedModel {
    providerRef: string;
    modelId: string;
    dimension: number;
}

/**
 * 특정 index 의 **기록된 모델**로 임베딩하는 함수를 만든다.
 * 라이브 `text.embed` 배정이 바뀌어도 활성 index 는 자기 모델로만 임베딩·검색된다
 * (배정 변경은 reindex 경로로만 반영). 기록 모델을 해석할 수 없으면 조용히 폴백하지 않고 throw,
 * 응답 벡터 차원이 index.dimension 과 다르면 throw(방어적 검증).
 */
export function makeIndexEmbedder(index: IndexEmbedModel): EmbedFn {
    return async (texts) => {
        if (texts.length === 0) return [];
        const target = await resolveEmbedTargetForModel(index.providerRef);
        if (target.model !== index.modelId) {
            throw new Error(`index 임베딩 모델 불일치 — 기록 '${index.modelId}' vs 해석 '${target.model}' (provider_ref='${index.providerRef}')`);
        }
        const vectors = await runEmbed(target, texts);
        for (const v of vectors) {
            if (v.length !== index.dimension) {
                throw new Error(`임베딩 차원 불일치 — index ${index.dimension} vs 응답 ${v.length} (모델 '${index.modelId}')`);
            }
        }
        return vectors;
    };
}

/** 기록된 provider_ref(fullId)로 임베딩 대상을 해석한다(배정 조회 없음, system scope) */
async function resolveEmbedTargetForModel(providerRef: string): Promise<CapabilityTarget> {
    return resolveCapabilityTargetForModel('text.embed', providerRef);
}

let infoCache: EmbeddingProviderInfo | null = null;

/**
 * 임베딩 provider 설명 — **라이브 배정**을 해석하고 차원은 실제 응답으로 측정한다.
 * index-manager 가 새 index(첫 index·reindex)를 만들 때 이 값(model_id·dimension·provider_ref)을 index 행에 기록한다.
 * 캐시는 해석된 라이브 배정(providerRef·modelId)에 묶는다 — 배정이 바뀌면 다시 측정해 stale 을 막는다.
 */
export async function describeEmbeddingProvider(): Promise<EmbeddingProviderInfo> {
    const target = await resolveEmbedTarget();
    if (infoCache && infoCache.providerRef === target.fullId && infoCache.modelId === target.model) return infoCache;
    const [probe] = await embedBatch(target, ['dimension probe']);
    if (!probe || probe.length === 0) throw new Error('임베딩 차원을 측정하지 못했습니다');
    infoCache = { providerRef: target.fullId, modelId: target.model, dimension: probe.length };
    logger.info(`임베딩 provider 해석: ${infoCache.providerRef} (dim=${infoCache.dimension})`);
    return infoCache;
}

/** 테스트·재배정 후 캐시 무효화 */
export function clearEmbeddingProviderCache(): void {
    infoCache = null;
}
