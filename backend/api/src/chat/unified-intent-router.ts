/**
 * ============================================================
 * Unified Intent Router (UIR) - 단일 LLM 의도 분석기
 * ============================================================
 *
 * 기존 독립적인 LLM 호출 2-3개를 단 1번으로 통합합니다.
 * queryType + agentId + brandProfile + complexity + recommendedTools를
 * 하나의 구조화된 LLM 응답으로 결정합니다.
 *
 * 실행 모드:
 * - Shadow Mode (기본): UIR + Legacy 동시 실행, 비교 로그만 저장
 * - Active Mode (rollout > 0%): 해당 비율의 요청에 UIR 결과 사용
 *
 * @module chat/unified-intent-router
 */

import { createHash } from 'crypto';
import {
    UIR_MODEL,
    UIR_ROLLOUT_PERCENT,
    UIR_SHADOW_ENABLED,
    UIR_TIMEOUT_MS,
    UIR_TEMPERATURE,
    UIR_NUM_PREDICT,
    UIR_MAX_AGENTS,
} from '../config/routing-config';
import { analyzeTopicIntent } from '../agents/topic-analyzer';
import { isValidAgentId, getAgentSummaries } from '../agents/llm-router';
import { OllamaClient } from '../ollama/client';
import { createLogger } from '../utils/logger';
import { QUERY_TYPES, QueryType } from './model-selector-types';
import { sanitizePromptInput, validatePromptInput } from '../utils/input-sanitizer';

const logger = createLogger('UIR');

// ============================================================
// 타입 정의
// ============================================================

/**
 * UIR 분석 결과 인터페이스
 */
export interface UIRResult {
    /** 쿼리 유형 (QUERY_TYPES 중 하나) */
    queryType: QueryType;
    /** 선택된 에이전트 ID */
    agentId: string;
    /** 브랜드 프로파일 이름 ('default'|'pro'|'fast'|'think'|'code'|'vision'|'auto') */
    brandProfile: string;
    /** 쿼리 복잡도 (0.0~1.0) */
    complexity: number;
    /** 추천 MCP 도구 목록 */
    recommendedTools: string[];
    /** UIR 신뢰도 (0.0~1.0) */
    confidence: number;
    /** 실행 시간 (ms) */
    latencyMs: number;
    /** 응답 출처 (llm|fallback|cache) */
    source: 'llm' | 'fallback' | 'cache';
}

/**
 * UIR 호출 옵션
 */
export interface UIROptions {
    /** 사용자 ID (A/B 버킷팅용) */
    userId?: string;
    /** 사용자 스킬 목록 (routing에 영향) */
    userSkills?: Array<{ id: string; name: string; description?: string }>;
    /** 현재 세션 ID (로그용) */
    sessionId?: string;
    /** 강제 fallback 여부 (true면 UIR 건너뜀) */
    forceFallback?: boolean;
}

// ============================================================
// 유효한 브랜드 프로파일 목록
// ============================================================
const VALID_BRAND_PROFILES = ['default', 'pro', 'fast', 'think', 'code', 'vision', 'auto'] as const;
type BrandProfile = typeof VALID_BRAND_PROFILES[number];

// ============================================================
// UIR 전용 OllamaClient 싱글톤
// ============================================================
let uirClient: OllamaClient | null = null;

function getUIRClient(): OllamaClient {
    if (!uirClient) {
        uirClient = new OllamaClient({ model: UIR_MODEL });
    }
    return uirClient;
}

// ============================================================
// A/B 버킷팅
// ============================================================

/**
 * userId 해시 기반 rollout 결정
 * SHA256의 앞 8자리를 16진수로 변환 후 % 100으로 버킷 결정
 */
function shouldUseUIR(userId?: string): boolean {
    const rollout = UIR_ROLLOUT_PERCENT;
    if (rollout === 0) return false;
    if (rollout >= 100) return true;
    const hash = createHash('sha256').update(userId ?? 'anonymous').digest('hex');
    const bucket = parseInt(hash.slice(0, 8), 16) % 100;
    return bucket < rollout;
}

// ============================================================
// JSON 파싱 유틸리티 (llm-router와 동일한 3단계 전략)
// ============================================================

function extractJSONFromResponse(response: string): Record<string, unknown> | null {
    // 1단계: ```json 코드블록 내 JSON
    const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1]);
        } catch {
            // 다음 단계로
        }
    }

    // 2단계: Greedy 매칭 (가장 바깥 {} 블록)
    const greedyMatch = response.match(/\{[\s\S]*\}/);
    if (greedyMatch) {
        try {
            return JSON.parse(greedyMatch[0]);
        } catch {
            // 다음 단계로
        }
    }

    // 3단계: Non-greedy 폴백
    const lazyMatch = response.match(/\{[\s\S]*?\}/);
    if (lazyMatch) {
        try {
            return JSON.parse(lazyMatch[0]);
        } catch {
            logger.info('UIR JSON 파싱 실패, 응답 일부:', response.substring(0, 200));
        }
    }

    return null;
}

// ============================================================
// LLM 프롬프트 구성
// ============================================================

function buildSystemPrompt(
    filteredAgentIds: string[],
    userSkills?: Array<{ id: string; name: string; description?: string }>
): string {
    // 전체 에이전트 요약에서 pre-filter된 ID만 추출
    const allSummaries = getAgentSummaries();
    const filteredSummaries = filteredAgentIds.length > 0
        ? allSummaries.filter(s => filteredAgentIds.includes(s.id))
        : allSummaries.slice(0, UIR_MAX_AGENTS);

    // 에이전트 목록을 단순 목록으로 포맷
    const agentListLines = filteredSummaries
        .map(s => `- **${s.id}**: ${s.name} (${s.category}) — ${s.description}`)
        .join('\n');

    // 스킬 섹션
    const skillsSection = (userSkills && userSkills.length > 0)
        ? `\n## 사용자 보유 스킬:\n${userSkills.map(sk => `- ${sk.name}: ${sk.description ?? ''}`).join('\n')}\n`
        : '';

    // queryType 목록
    const queryTypeList = QUERY_TYPES.join(', ');

    return `당신은 AI 의도 분석 라우터입니다. 사용자 메시지를 분석하여 아래 JSON 형식으로만 응답하세요.
${skillsSection}
## 선택 가능한 에이전트:
${agentListLines}

## queryType 목록:
${queryTypeList}

## 브랜드 프로파일:
- default: 일반 대화 및 기본 쿼리
- pro: 복잡하고 심층적인 분석 필요 시
- fast: 빠른 응답이 중요한 간단한 쿼리
- think: 논리 추론, 수학, 복잡한 문제 해결
- code: 코드 생성, 디버깅, 개발 작업
- vision: 이미지 분석 관련 쿼리
- auto: 자동 선택 (명확하지 않을 때)

## 응답 규칙:
1. 반드시 아래 JSON 형식으로만 응답
2. agentId는 위 에이전트 목록 중 하나여야 함
3. queryType은 위 목록 중 하나여야 함
4. brandProfile은 위 목록 중 하나여야 함
5. complexity는 0.0~1.0 사이 소수
6. confidence는 0.0~1.0 사이 소수
7. recommendedTools는 관련 MCP 도구 이름 배열 (없으면 빈 배열)

## 응답 형식:
{
  "queryType": "code-gen",
  "agentId": "software-engineer",
  "brandProfile": "code",
  "complexity": 0.7,
  "recommendedTools": ["code-runner", "filesystem"],
  "confidence": 0.9
}`;
}

// ============================================================
// UIR LLM 호출 (내부 함수)
// ============================================================

/**
 * UIR LLM 호출: 토픽 pre-filter → 에이전트 목록 → LLM 구조화 출력
 */
async function callUIRLLM(
    message: string,
    options?: UIROptions
): Promise<UIRResult | null> {
    const startMs = Date.now();

    // 입력 검증 및 새니타이징
    const validation = validatePromptInput(message);
    if (!validation.valid) {
        logger.info('UIR 입력 검증 실패:', validation.error);
        return null;
    }
    const sanitizedMessage = sanitizePromptInput(message);

    // 토픽 pre-filter: analyzeTopicIntent로 관련 에이전트 ID 추출
    const topicResult = analyzeTopicIntent(sanitizedMessage);
    let filteredAgentIds: string[] = topicResult.suggestedAgents.slice(0, UIR_MAX_AGENTS);

    // pre-filter 결과가 너무 적으면 전체 에이전트 사용 (UIR_MAX_AGENTS 범위)
    if (filteredAgentIds.length < 3) {
        filteredAgentIds = [];
    }

    const systemPrompt = buildSystemPrompt(filteredAgentIds, options?.userSkills);

    const userPrompt = `<user_message>
${sanitizedMessage}
</user_message>

위 메시지를 분석하여 JSON 형식으로만 응답하세요.`;

    try {
        const client = getUIRClient();

        const timeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), UIR_TIMEOUT_MS);
        });

        const llmPromise = (async () => {
            const response = await client.chat(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                {
                    temperature: UIR_TEMPERATURE,
                    num_predict: UIR_NUM_PREDICT,
                }
            );
            return response.content;
        })();

        const rawResponse = await Promise.race([llmPromise, timeoutPromise]);

        if (!rawResponse) {
            logger.info('UIR LLM 타임아웃');
            return null;
        }

        const parsed = extractJSONFromResponse(rawResponse);
        if (!parsed) {
            logger.info('UIR 응답 JSON 파싱 실패');
            return null;
        }

        // queryType 검증
        const rawQueryType = String(parsed.queryType ?? '');
        const queryType: QueryType = (QUERY_TYPES as readonly string[]).includes(rawQueryType)
            ? (rawQueryType as QueryType)
            : 'chat';

        // agentId 검증
        const rawAgentId = String(parsed.agentId ?? parsed.agent_id ?? '');
        const agentId = isValidAgentId(rawAgentId) ? rawAgentId : 'general';

        // brandProfile 검증
        const rawBrandProfile = String(parsed.brandProfile ?? parsed.brand_profile ?? '');
        const brandProfile: BrandProfile = (VALID_BRAND_PROFILES as readonly string[]).includes(rawBrandProfile)
            ? (rawBrandProfile as BrandProfile)
            : 'default';

        // complexity 검증 (0.0~1.0 클램핑)
        const rawComplexity = Number(parsed.complexity ?? 0.5);
        const complexity = Math.min(1.0, Math.max(0.0, isNaN(rawComplexity) ? 0.5 : rawComplexity));

        // confidence 검증 (0.0~1.0 클램핑)
        const rawConfidence = Number(parsed.confidence ?? 0.8);
        const confidence = Math.min(1.0, Math.max(0.0, isNaN(rawConfidence) ? 0.8 : rawConfidence));

        // recommendedTools 검증
        const recommendedTools: string[] = Array.isArray(parsed.recommendedTools)
            ? (parsed.recommendedTools as unknown[]).map(t => String(t))
            : [];

        const latencyMs = Date.now() - startMs;

        logger.info(
            `UIR 결과: queryType=${queryType}, agentId=${agentId}, brandProfile=${brandProfile}, ` +
            `complexity=${complexity.toFixed(2)}, confidence=${confidence.toFixed(2)}, latency=${latencyMs}ms`
        );

        return {
            queryType,
            agentId,
            brandProfile,
            complexity,
            recommendedTools,
            confidence,
            latencyMs,
            source: 'llm',
        };
    } catch (error) {
        logger.error('UIR LLM 호출 오류:', error);
        return null;
    }
}

// ============================================================
// Shadow 비교 로그 저장
// ============================================================

/**
 * Shadow 비교 로그를 DB에 저장 (비동기, 실패해도 메인 플로우에 영향 없음)
 */
async function logShadowComparison(
    message: string,
    uirResult: UIRResult | null,
    legacyResult: { queryType: string; agentId: string; brandProfile: string },
    sessionId?: string,
    userId?: string
): Promise<void> {
    try {
        // lazy import: DB 초기화 전 호출 방어
        const { getUnifiedDatabase } = await import('../data/models/unified-database');
        const pool = getUnifiedDatabase().getPool();

        const uirQueryType = uirResult?.queryType ?? null;
        const uirAgentId = uirResult?.agentId ?? null;
        const uirBrandProfile = uirResult?.brandProfile ?? null;
        const uirComplexity = uirResult?.complexity ?? null;
        const uirConfidence = uirResult?.confidence ?? null;
        const uirLatencyMs = uirResult?.latencyMs ?? null;

        const queryTypeMatch = uirQueryType === legacyResult.queryType;
        const agentIdMatch = uirAgentId === legacyResult.agentId;
        const brandProfileMatch = uirBrandProfile === legacyResult.brandProfile;

        // 개인정보 보호: 원문 저장 대신 SHA256 해시
        const queryHash = createHash('sha256').update(message).digest('hex');

        await pool.query(
            `INSERT INTO uir_shadow_log (
                session_id,
                user_id,
                query_hash,
                uir_query_type,
                uir_agent_id,
                uir_brand_profile,
                uir_complexity,
                uir_confidence,
                uir_latency_ms,
                legacy_query_type,
                legacy_agent_id,
                legacy_brand_profile,
                query_type_match,
                agent_match,
                profile_match,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())`,
            [
                sessionId ?? null,
                userId ?? null,
                queryHash,
                uirQueryType,
                uirAgentId,
                uirBrandProfile,
                uirComplexity,
                uirConfidence,
                uirLatencyMs,
                legacyResult.queryType,
                legacyResult.agentId,
                legacyResult.brandProfile,
                queryTypeMatch,
                agentIdMatch,
                brandProfileMatch,
            ]
        );

        logger.info(
            `UIR shadow log 저장: queryType=${queryTypeMatch ? '일치' : '불일치'}, ` +
            `agentId=${agentIdMatch ? '일치' : '불일치'}, ` +
            `brandProfile=${brandProfileMatch ? '일치' : '불일치'}`
        );
    } catch {
        // DB 저장 실패는 조용히 처리 — 메인 플로우에 영향 없음
    }
}

// ============================================================
// 메인 진입점
// ============================================================

/**
 * UIR 실행 (메인 진입점)
 *
 * rollout 비율에 따라 UIR 결과 또는 null(→ legacy 사용)을 반환합니다.
 * forceFallback=true이면 즉시 null을 반환합니다.
 *
 * @param message - 사용자 메시지
 * @param options - UIR 옵션 (userId, userSkills, sessionId, forceFallback)
 * @returns UIRResult (UIR 사용 시) 또는 null (legacy 사용 시)
 */
export async function runUIR(
    message: string,
    options?: UIROptions
): Promise<UIRResult | null> {
    // forceFallback 플래그: UIR 완전 건너뜀
    if (options?.forceFallback) {
        return null;
    }

    const useUIR = shouldUseUIR(options?.userId);

    if (!useUIR && !UIR_SHADOW_ENABLED) {
        // rollout 대상 아님, shadow도 비활성: 즉시 null
        return null;
    }

    if (!useUIR && UIR_SHADOW_ENABLED) {
        // Shadow 모드: UIR 실행하되 결과는 로그만 저장, null 반환
        const uirResult = await callUIRLLM(message, options);

        // shadow 비교 로그 (비동기 fire-and-forget)
        // legacy 결과는 호출자가 제공하지 않으므로 빈 값으로 기록
        const legacyPlaceholder = { queryType: 'unknown', agentId: 'unknown', brandProfile: 'unknown' };
        logShadowComparison(
            message,
            uirResult,
            legacyPlaceholder,
            options?.sessionId,
            options?.userId
        ).catch(() => {
            // 로그 저장 실패 무시
        });

        return null;
    }

    // Active 모드: UIR 결과를 실제 사용
    const uirResult = await callUIRLLM(message, options);

    if (!uirResult) {
        logger.info('UIR fallback → legacy 사용');
        return null;
    }

    return uirResult;
}

/**
 * Shadow 비교를 명시적으로 기록할 때 사용 (외부 호출용)
 *
 * caller가 legacy 결과를 알고 있을 때, UIR 결과와 함께 비교 로그를 저장합니다.
 *
 * @param message - 원본 사용자 메시지
 * @param uirResult - UIR 분석 결과 (null이면 UIR 미수행)
 * @param legacyResult - 기존 legacy 분류 결과
 * @param sessionId - 세션 ID
 * @param userId - 사용자 ID
 */
/**
 * UIR LLM 결과만 반환 — shadow logging 없음 (Phase 3 ChatService 통합용)
 *
 * 호출자가 legacy 결과를 알 때 recordShadowComparison()으로 직접 로그를 저장합니다.
 */
export async function computeUIRResult(
    message: string,
    options?: UIROptions
): Promise<UIRResult | null> {
    if (options?.forceFallback) return null;
    return callUIRLLM(message, options);
}

export async function recordShadowComparison(
    message: string,
    uirResult: UIRResult | null,
    legacyResult: { queryType: string; agentId: string; brandProfile: string },
    sessionId?: string,
    userId?: string
): Promise<void> {
    if (!UIR_SHADOW_ENABLED) return;
    await logShadowComparison(message, uirResult, legacyResult, sessionId, userId);
}
