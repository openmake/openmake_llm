/**
 * 임베딩 provider — 모델은 OpenMake capability 설정 `text.embed` 로 고르고(사용자 → 전역 → 기본값),
 * 외부 모델은 키 정책 actor-byok 에 따라 **행위자 사용자(업로드·재색인·검색한 사람)의 키**로만 실행한다.
 * 벡터는 공간에 고정된 색인 단위로 산다 — 색인에 넣거나 검색할 때는 색인에 **기록된 모델**로 임베딩한다(makeIndexEmbedder).
 * 키 문제는 조용히 바꾸지 않고 EmbeddingError(reason) 로 드러내며, 공급자가 키를 거절하면 거절 메모가 재호출을 막는다.
 * 모델명·주소·차원을 코드에 두지 않는다 — 전부 capability 해석 + 실제 응답에서 얻는다.
 * capability-resolver·http-call 은 이 파일만 import 한다(add-on 경계 허용 목록).
 *
 * @module addons/knowledge-runtime/embedding/provider
 */
import {
    resolveCapabilityTargetForModel, describeCapabilityAssignment, checkCapabilityTargetAvailability,
    CapabilityUnavailableError, type CapabilityTarget, type CapabilityUnavailableCode,
} from '../../../services/orchestrator/capability-resolver';
import { callJson, HttpCallError } from '../../../services/orchestrator/http-call';
import { recordCost } from '../../../services/cost/cost-ledger-service';
import type { CostOwner } from '../../../config/cost-kinds';
import { isExternalFullId } from '../../../config/model-roles';
import { createLogger } from '../../../utils/logger';
import { KNOWLEDGE_RUNTIME } from '../constants';
import { getDefaultLimits } from '../config/profiles';
import { isKeyRejected, noteKeyRejected } from './key-rejection-memo';

const logger = createLogger('KnowledgeEmbed');

/** 임베딩 함수 시그니처 — 파이프라인·재색인·검색이 테스트에서 주입할 수 있게 별도 타입 */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/** 임베딩을 실행하는 사용자 — 외부 모델은 이 사용자의 키로만 돈다. 없으면(시스템 작업) 로컬 모델만 가능 */
export interface EmbedActor {
    userId?: string | null;
}

/** 임베딩 실패 사유 — unassigned·key_missing·key_rejected 는 재시도해도 같은 결과(명시 실패), provider 는 일시 장애일 수 있다 */
export type EmbeddingFailureReason = 'unassigned' | 'key_missing' | 'key_rejected' | 'provider';

export class EmbeddingError extends Error {
    constructor(public readonly reason: EmbeddingFailureReason, message: string) {
        super(message);
        this.name = 'EmbeddingError';
    }
}

/** 해석기 코드 → 실패 사유(Record 룩업). 표에 없는 코드는 provider */
const UNAVAILABLE_REASON: Readonly<Partial<Record<CapabilityUnavailableCode, EmbeddingFailureReason>>> = {
    CAPABILITY_UNASSIGNED: 'unassigned',
    CAPABILITY_KEY_MISSING: 'key_missing',
    CAPABILITY_KEY_INACTIVE: 'key_missing',
    // OAuth 연결은 게이트웨이를 거치지 않는다 — API 키 등록이 필요하다(설계 D7)
    CAPABILITY_PROVIDER_NOT_GATEWAY: 'key_missing',
};

/** 임의 오류 → 실패 사유 */
export function classifyEmbedError(err: unknown): EmbeddingFailureReason {
    if (err instanceof EmbeddingError) return err.reason;
    if (err instanceof CapabilityUnavailableError) return UNAVAILABLE_REASON[err.code as CapabilityUnavailableCode] ?? 'provider';
    return 'provider';
}

function toEmbeddingError(err: unknown): EmbeddingError {
    if (err instanceof EmbeddingError) return err;
    return new EmbeddingError(classifyEmbedError(err), err instanceof Error ? err.message : String(err));
}

/** fullId(`provider:model`) 의 provider id — 로컬은 'local-llm' */
function providerIdOf(fullId: string): string {
    return isExternalFullId(fullId) ? fullId.slice(0, fullId.indexOf(':')) : 'local-llm';
}

function rejectedError(providerId: string): EmbeddingError {
    return new EmbeddingError('key_rejected', `'${providerId}' 공급자가 API 키를 거절했습니다 — 설정 → 외부 API 키에서 키를 교체하세요`);
}

/** costOwner 매핑 — 로컬/서버 인프라는 'server', 사용자 BYOK 는 'byok' */
function costOwnerOf(target: CapabilityTarget): CostOwner {
    return target.costOwner === 'user' ? 'byok' : 'server';
}

interface EmbeddingResponse {
    data?: Array<{ index?: number; embedding?: number[] }>;
    usage?: { prompt_tokens?: number };
}

/**
 * 한 배치 임베딩 호출 — data 를 index 순으로 정렬해 입력 순서를 보장한다.
 * 사용자 키(BYOK)를 공급자가 거절하면 거절 메모를 남기고 key_rejected 로 던진다(서버·로컬 키의 401 은 사용자 키 문제가 아니라 provider).
 */
async function embedBatch(target: CapabilityTarget, texts: string[], userId: string | undefined): Promise<{ vectors: number[][]; promptTokens?: number }> {
    const body: Record<string, unknown> = { model: target.model, input: texts };
    if (target.params.dimensions) body.dimensions = Number(target.params.dimensions);
    let json: EmbeddingResponse;
    try {
        json = await callJson<EmbeddingResponse>(target, { body, timeoutMs: KNOWLEDGE_RUNTIME.EMBED_TIMEOUT_MS });
    } catch (err) {
        if (err instanceof HttpCallError && err.keyRejected && target.costOwner === 'user' && userId) {
            noteKeyRejected(userId, target.providerId);
            throw rejectedError(target.providerId);
        }
        throw err;
    }
    const data = json.data ?? [];
    const out: number[][] = new Array(texts.length);
    for (let i = 0; i < data.length; i++) {
        const idx = typeof data[i].index === 'number' ? (data[i].index as number) : i;
        const vec = data[i].embedding;
        if (!Array.isArray(vec) || vec.length === 0) throw new Error('임베딩 응답에 벡터가 없습니다');
        out[idx] = vec;
    }
    for (let i = 0; i < texts.length; i++) if (!out[i]) throw new Error('임베딩 응답 개수가 입력과 다릅니다');
    return { vectors: out, promptTokens: json.usage?.prompt_tokens };
}

/** 배치 임베딩 코어 — limits.embedBatchSize 로 나눠 부르고 비용을 원장 kind search.embed(호출 수)로 행위자에게 남긴다 */
async function runEmbed(target: CapabilityTarget, texts: string[], userId: string | undefined, meta: Record<string, unknown>): Promise<number[][]> {
    if (texts.length === 0) return [];
    const limits = await getDefaultLimits();
    const batchSize = Math.max(1, limits.embedBatchSize);
    const out: number[][] = [];
    let calls = 0;
    let promptTokens: number | undefined;
    try {
        for (let i = 0; i < texts.length; i += batchSize) {
            const res = await embedBatch(target, texts.slice(i, i + batchSize), userId);
            out.push(...res.vectors);
            calls++;
            if (res.promptTokens !== undefined) promptTokens = (promptTokens ?? 0) + res.promptTokens;
        }
    } finally {
        // 중간 배치가 실패해도 이미 나간 호출은 남긴다
        recordCost({
            userId: userId ?? null,
            kind: 'search.embed', unit: 'call', rateKey: target.model, quantity: calls,
            costOwner: costOwnerOf(target), ctx: { feature: 'knowledge' },
            meta: { ...meta, texts: texts.length, ...(promptTokens !== undefined ? { promptTokens } : {}) },
        });
    }
    return out;
}

/** 거절 메모 적중이면 호출 전에 key_rejected — 로컬·사용자 없음은 해당 없음 */
function assertNotRejected(fullId: string, userId: string | undefined): void {
    if (!userId || !isExternalFullId(fullId)) return;
    const providerId = providerIdOf(fullId);
    if (isKeyRejected(userId, providerId)) throw rejectedError(providerId);
}

/** 기록된 fullId·params 를 행위자 키로 해석한다 — 실패는 EmbeddingError(reason) */
async function resolveFor(fullId: string, params: Record<string, string>, userId: string | undefined): Promise<CapabilityTarget> {
    assertNotRejected(fullId, userId);
    try {
        return await resolveCapabilityTargetForModel('text.embed', fullId, userId, {}, params);
    } catch (err) {
        throw toEmbeddingError(err);
    }
}

/** makeIndexEmbedder 가 필요로 하는 색인의 기록 모델 */
export interface IndexEmbedModel {
    id?: string;
    providerRef: string;
    modelId: string;
    dimension: number;
    /** 색인이 기록한 요청 params(예: dimensions) — 그대로 보낸다 */
    requestParams?: Record<string, string>;
}

/**
 * 특정 색인의 **기록된 모델**로, 행위자 사용자의 키로 임베딩하는 함수를 만든다.
 * 라이브 `text.embed` 배정이 바뀌어도 색인은 자기 모델로만 임베딩·검색된다(바꾸는 길은 공간 재색인).
 * 키 문제는 EmbeddingError(key_missing·key_rejected), 기록 모델과 해석 모델·응답 차원이 다르면 throw(조용한 폴백 금지).
 */
export function makeIndexEmbedder(index: IndexEmbedModel, actor: EmbedActor = {}, meta: { spaceId?: string } = {}): EmbedFn {
    const userId = actor.userId ?? undefined;
    return async (texts) => {
        if (texts.length === 0) return [];
        const target = await resolveFor(index.providerRef, index.requestParams ?? {}, userId);
        if (target.model !== index.modelId) {
            throw new Error(`index 임베딩 모델 불일치 — 기록 '${index.modelId}' vs 해석 '${target.model}' (provider_ref='${index.providerRef}')`);
        }
        const vectors = await runEmbed(target, texts, userId, { ...meta, ...(index.id ? { indexId: index.id } : {}) });
        for (const v of vectors) {
            if (v.length !== index.dimension) {
                throw new Error(`임베딩 차원 불일치 — index ${index.dimension} vs 응답 ${v.length} (모델 '${index.modelId}')`);
            }
        }
        return vectors;
    };
}

/** 사용자의 현재 임베딩 배정(키 값 없음) */
export interface LiveEmbedding {
    fullId: string;
    providerId: string;
    /** 게이트웨이 model 값 */
    model: string;
    params: Record<string, string>;
    source: 'user' | 'global' | 'default';
}

export type EmbeddingAvailability = { ok: true } | { ok: false; reason: EmbeddingFailureReason; message: string };

/**
 * fullId 를 이 사용자가 지금 임베딩에 쓸 수 있는가 — 거절 메모 + 키 행(존재·활성·OAuth)만 본다.
 * 복호화·공급자 호출 없음(목록·선검사용).
 */
export async function checkEmbeddingAvailability(fullId: string, userId?: string | null): Promise<EmbeddingAvailability> {
    const uid = userId ?? undefined;
    try {
        assertNotRejected(fullId, uid);
    } catch (err) {
        const e = toEmbeddingError(err);
        return { ok: false, reason: e.reason, message: e.message };
    }
    const r = await checkCapabilityTargetAvailability('text.embed', fullId, uid);
    if (r.ok) return r;
    return { ok: false, reason: UNAVAILABLE_REASON[r.code] ?? 'provider', message: r.message };
}

/**
 * 사용자의 실효 임베딩 — 배정(사용자 → 전역 → 기본값)과 그 키 상태. 공급자 호출·차원 측정·복호화 없음.
 * live 는 배정이 있으면 키 상태와 무관하게 채운다(화면이 "어느 모델인지" 를 보이도록), failure 는 지금 실행할 수 없는 이유.
 */
export async function describeLiveEmbedding(userId?: string | null): Promise<{
    live: LiveEmbedding | null;
    failure: { reason: EmbeddingFailureReason; message: string } | null;
}> {
    const uid = userId ?? undefined;
    let live: LiveEmbedding | null;
    try {
        live = await describeCapabilityAssignment('text.embed', uid);
    } catch (err) {
        const e = toEmbeddingError(err);
        return { live: null, failure: { reason: e.reason, message: e.message } };
    }
    if (!live) {
        return { live: null, failure: { reason: 'unassigned', message: '임베딩 모델이 배정되어 있지 않습니다 — 설정 → 모델 배정 → 임베딩에서 배정하세요' } };
    }
    const avail = await checkEmbeddingAvailability(live.fullId, uid);
    return { live, failure: avail.ok ? null : { reason: avail.reason, message: avail.message } };
}

/**
 * 라이브 배정의 차원을 1문장 호출로 잰다(새 색인 행을 만들 때만 — 모델당 최초 1회). 행위자 키로 부르고 원장에 남긴다.
 * model 은 실제 해석된 게이트웨이 값이라 색인 행의 model_id 로 기록한다.
 */
export async function probeDimension(live: LiveEmbedding, actor: EmbedActor): Promise<{ dimension: number; model: string }> {
    const userId = actor.userId ?? undefined;
    const target = await resolveFor(live.fullId, live.params, userId);
    const [probe] = await runEmbed(target, ['dimension probe'], userId, { probe: true });
    if (!probe || probe.length === 0) throw new EmbeddingError('provider', '임베딩 차원을 측정하지 못했습니다 — 임베딩 모델인지 확인하세요');
    logger.info(`임베딩 차원 측정: ${live.fullId} (dim=${probe.length})`);
    return { dimension: probe.length, model: target.model };
}
