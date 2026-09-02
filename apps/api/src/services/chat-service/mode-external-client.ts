/**
 * Discussion·Deep Research 모드의 외부 모델 클라이언트 해석 —
 * message-pipeline 에서 분리 (파일 크기 가드).
 *
 * 해석 우선순위:
 *   ① Deep Research → 'research' role 배정이 외부로 해석되면 그 모델 (REST /api/research 와 일치)
 *   ② 그 외(Discussion 전부 / role 미배정·로컬 해석) → 컴포저에서 선택한 모델(externalResolved)
 *
 * 어느 쪽도 외부로 해석되지 않으면 undefined 를 반환해 호출부가 로컬 svc.client 로 fail-open 한다.
 *
 * 오류 계약 — ②(사용자가 컴포저에서 명시 선택한 외부 모델)에서 그 모델이 실행 불가
 * (BYOK 키 미등록·provider 미지원 등)하면 로컬로 조용히 폴백하지 않고 ProviderError 를
 * throw 해 프론트에 사유를 노출한다("실패가 성공처럼 보이는 패턴" 차단). 반면 ①(research
 * role 배정)의 실패는 운영/설정 단위라 기존대로 fail-open(컴포저 선택 → 로컬 순으로 폴백).
 *
 * @module services/chat-service/mode-external-client
 */
import type { ResolvedProvider } from '../../providers/provider-router';
import type { LLMClient } from '../../llm';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ModeExternalClient');

export async function resolveModeExternalClient(
    externalResolved: ResolvedProvider | null,
    userId: string | number | undefined,
    modeLabel: 'Discussion' | 'DeepResearch',
): Promise<LLMClient | undefined> {
    if (!userId || String(userId) === 'guest') return undefined;

    // ① Deep Research 는 'research' role 배정을 최우선으로 따른다 (REST /api/research 와 동작 일치).
    //    role 이 외부로 해석될 때만 채택하고, 로컬 해석/미배정이면 ② 로 내려가 기존 동작을 유지한다.
    //    (Discussion 은 대응 role 이 없어 해당 없음.)
    if (modeLabel === 'DeepResearch') {
        try {
            const { resolveRoleClientForUser } = await import('../model-role-resolver');
            const resolved = await resolveRoleClientForUser('research', String(userId));
            if (resolved.providerId !== 'local-llm') {
                if (resolved.degraded) {
                    logger.warn(`[Mode] research role 해석 폴백 (${resolved.fullId}): ${resolved.degraded}`);
                } else {
                    logger.info(`[Mode] DeepResearch research role 모델 사용: ${resolved.fullId} (source=${resolved.source})`);
                }
                return resolved.client;
            }
        } catch (e) {
            logger.warn('[Mode] research role 해석 실패 (컴포저 선택으로 폴백):', e);
        }
    }

    // ② 컴포저에서 선택한 모델. provider gate 는 로컬 선택도 ResolvedProvider
    //    ('local-llm:<tag>')로 채우므로, 로컬 모델을 여러 개 운영하는 클러스터에서
    //    사용자가 고른 태그를 잃지 않도록 그대로 해석한다.
    if (!externalResolved) return undefined;

    // 명시 외부 선택이면 실행 가능성을 먼저 단언한다 — 불가하면 ProviderError 로 노출(로컬 폴백 금지).
    // (로컬 선택 'local-llm:*' 은 단언 없이 통과 → 회귀 0.)
    if (externalResolved.providerId !== 'local-llm') {
        await assertExternalModelUsable(externalResolved.providerId, String(userId));
    }

    try {
        const { resolveAssignedModelClient } = await import('../model-role-resolver');
        const resolved = await resolveAssignedModelClient(externalResolved.fullId, String(userId));
        if (resolved.degraded) {
            logger.warn(`[Mode] 선택 모델 해석 폴백 (${externalResolved.fullId}): ${resolved.degraded}`);
        } else {
            logger.info(`[Mode] ${modeLabel} 선택 모델 사용: ${externalResolved.fullId}`);
        }
        return resolved.client;
    } catch (e) {
        logger.warn('[Mode] 선택 모델 해석 실패 (로컬 폴백):', e);
        return undefined;
    }
}

/**
 * 명시 선택된 외부 모델이 이 사용자에게 실행 가능한지 단언한다.
 * 실행 불가 사유가 명확하면 대응 ProviderError 를 throw(호출부가 로컬로 폴백하지 않게),
 * 인프라 오류(pool 미초기화 등)는 삼켜서 후단 resolveAssignedModelClient 의 fail-open 에 맡긴다.
 *
 * getByUserAndProvider 는 is_active=TRUE 만 반환하므로 미등록·비활성이 모두 null →
 * MISSING_API_KEY 로 통합한다(사용자 액션은 동일: 키 등록/재활성 또는 다른 모델 선택).
 */
async function assertExternalModelUsable(providerId: string, userId: string): Promise<void> {
    const { ProviderError } = await import('../../providers/provider-errors');
    const { EXTERNAL_PROVIDER_CATALOG } = await import('../../config/external-providers');

    const entry = EXTERNAL_PROVIDER_CATALOG.find((p) => p.id === providerId);
    if (!entry) {
        throw new ProviderError('MODEL_NOT_FOUND', `카탈로그에 없는 provider '${providerId}'`);
    }
    // role/mode 실행 클라이언트는 OpenAI 호환 endpoint 만 지원(model-role-resolver 와 동일 제약).
    if (entry.sdkType !== 'openai-compatible') {
        throw new ProviderError('NOT_SUPPORTED', `provider '${providerId}' sdkType '${entry.sdkType}' 은 이 모드에서 미지원`);
    }

    let keyRow: unknown;
    try {
        const { ExternalKeysRepository } = await import('../../data/repositories/external-keys-repo');
        const { getPool } = await import('../../data/models/unified-database');
        keyRow = await new ExternalKeysRepository(getPool()).getByUserAndProvider(userId, providerId);
    } catch (e) {
        // 인프라 오류는 단언하지 않는다 — 후단 fail-open 에 위임(오탐 차단보다 가용성 우선).
        logger.warn(`[Mode] 외부 키 조회 실패 — 단언 생략 (${providerId}):`, e);
        return;
    }
    if (!keyRow) {
        throw new ProviderError('MISSING_API_KEY', `'${providerId}' BYOK 키 미등록 또는 비활성`);
    }
}
