/**
 * text.embed capability 임베딩 — 도구 선별(에이전트 작업·딥리서치)과 웹검색 의미 리랭킹이 쓴다.
 * 모델은 행위자의 `text.embed` 배정(개인 → 전역)으로만 정한다(코드·env 기본값 없음). 외부 모델은 키 정책
 * actor-byok 에 따라 행위자의 키로만 돈다. 호출은 http-call 경계(공급자 슬롯·계측·게이트웨이 재시도 끄기·기한 중단)를 지난다.
 * 사용자 키를 공급자가 거절하면 (사용자, 공급자) 를 TTL 동안 기억해 그 사이 호출을 막는다
 * (knowledge-runtime 의 거절 메모와 별개 — add-on 경계 때문에 합치지 않는다).
 *
 * @module services/orchestrator/text-embed
 */
import { resolveCapabilityTarget, CapabilityUnavailableError, type CapabilityTarget } from './capability-resolver';
import { callJson, HttpCallError } from './http-call';
import { CAPABILITY_LIMITS } from '../../config/capabilities';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TextEmbed');

export interface TextEmbedTarget {
    target: CapabilityTarget;
    /** 벡터 캐시 키 — 같은 모델·같은 차원끼리만 비교한다 */
    modelKey: string;
    /** 해석에 쓴 행위자 — 사용자 키 거절 메모의 주인 */
    actorUserId?: string;
}

/** 행위자의 text.embed 배정(개인 → 전역)을 해석한다. 미배정·키 문제는 CapabilityUnavailableError. */
export async function resolveTextEmbed(actorUserId?: string): Promise<TextEmbedTarget> {
    const target = await resolveCapabilityTarget('text.embed', actorUserId);
    return { target, modelKey: `${target.fullId}|${target.params.dimensions ?? ''}`, actorUserId };
}

/** 이미 경고한 설정 상태(호출처 접두 × 해석기 코드) — 미배정 환경에서 요청마다 경고가 쌓이지 않게 */
const warnedUnavailable = new Set<string>();

/**
 * 임베딩 실패 로그 — 설정 상태(CapabilityUnavailableError: 미배정·키 없음)는 호출처·코드별로 프로세스당 한 번만 warn,
 * 그 뒤는 debug. 그 밖의 실패는 매번 warn.
 */
export function logTextEmbedFailure(log: ReturnType<typeof createLogger>, prefix: string, err: unknown): void {
    const msg = `${prefix}: ${err instanceof Error ? err.message : String(err)}`;
    if (err instanceof CapabilityUnavailableError) {
        const k = `${prefix}\u0000${err.code}`;
        if (warnedUnavailable.has(k)) { log.debug(msg); return; }
        warnedUnavailable.add(k);
    }
    log.warn(msg);
}

/** `${userId}\u0000${providerId}` → 거절 기록 시각(ms) */
const rejectedAt = new Map<string, number>();
const memoKey = (userId: string, providerId: string): string => `${userId}\u0000${providerId}`;

function isRejected(key: string, now: number): boolean {
    const at = rejectedAt.get(key);
    if (at === undefined) return false;
    if (now - at < CAPABILITY_LIMITS.EMBED_KEY_REJECT_MEMO_MS) return true;
    rejectedAt.delete(key);
    return false;
}

function noteRejected(key: string, now: number): void {
    for (const [k, at] of rejectedAt) if (now - at >= CAPABILITY_LIMITS.EMBED_KEY_REJECT_MEMO_MS) rejectedAt.delete(k);
    rejectedAt.set(key, now);
}

/** 테스트용 초기화 */
export function clearTextEmbedKeyRejections(): void {
    rejectedAt.clear();
}

interface EmbeddingResponse {
    data?: Array<{ index?: number; embedding?: number[] }>;
}

/**
 * 한 번 호출로 임베딩 — 입력 순서 보장(data[].index 정렬), 개수·빈 벡터 검증, params.dimensions 전달. 재시도 없음.
 * 사용자 키 대상이면 호출 직전에 거절 메모를 보고(적중 → 호출 없이 throw), 거절당하면 메모를 남기고 throw.
 */
export async function embedTexts(
    t: TextEmbedTarget,
    texts: string[],
    opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<number[][]> {
    const { target } = t;
    const key = target.costOwner === 'user' && t.actorUserId ? memoKey(t.actorUserId, target.providerId) : undefined;
    if (key && isRejected(key, Date.now())) {
        throw new HttpCallError(`'${target.providerId}' 공급자가 API 키를 거절했습니다(최근 기록) — 설정 → 외부 API 키에서 키를 교체하세요`, 401, 'http', true);
    }
    const body: Record<string, unknown> = { model: target.model, input: texts };
    if (target.params.dimensions) body.dimensions = Number(target.params.dimensions);
    let json: EmbeddingResponse;
    try {
        json = await callJson<EmbeddingResponse>(target, { body, timeoutMs: opts.timeoutMs, signal: opts.signal });
    } catch (err) {
        if (key && err instanceof HttpCallError && err.keyRejected) {
            noteRejected(key, Date.now());
            logger.warn(`임베딩 키 거절 기록: user=${t.actorUserId} provider=${target.providerId} — ${CAPABILITY_LIMITS.EMBED_KEY_REJECT_MEMO_MS}ms 동안 호출하지 않는다`);
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
    return out;
}
