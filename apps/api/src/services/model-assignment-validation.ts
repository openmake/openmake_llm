/**
 * @module services/model-assignment-validation
 * @description 모델 배정 값(fullId) 검증 — 사용자 역할 매핑·Custom Agent 모델 공용 규칙.
 *
 * 규칙 (user-model-roles PUT 과 동일):
 *   - 외부 fullId: 카탈로그 존재 + openai-compatible + 그 사용자의 BYOK 키 등록·활성 필수
 *   - 로컬 태그: LiteLLM /v1/models 대조 (서버 무응답 시 fail-open — 저장 유지 정책)
 *
 * @returns 실패 사유 문자열, 통과 시 null
 */
import { getPool } from '../data/models/unified-database';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { EXTERNAL_PROVIDER_CATALOG } from '../config/external-providers';
import { isExternalFullId, toLocalModelTag } from '../config/model-roles';
import { createClient } from '../llm';
import { createLogger } from '../utils/logger';

const logger = createLogger('ModelAssignmentValidation');

async function validateExternalAssignment(userId: string, fullId: string): Promise<string | null> {
    const idx = fullId.indexOf(':');
    const providerId = fullId.slice(0, idx);
    const modelId = fullId.slice(idx + 1);
    if (!modelId) return `모델 id 가 비어 있습니다: '${fullId}'`;

    const entry = EXTERNAL_PROVIDER_CATALOG.find((p) => p.id === providerId);
    if (!entry) return `카탈로그에 없는 provider: '${providerId}'`;
    if (entry.sdkType !== 'openai-compatible') {
        return `provider '${providerId}' (sdkType=${entry.sdkType}) 는 모델 배정을 지원하지 않습니다`;
    }

    const keysRepo = new ExternalKeysRepository(getPool());
    const keyRow = await keysRepo.getByUserAndProvider(userId, providerId);
    if (!keyRow) return `'${providerId}' API 키를 먼저 등록하세요`;
    if (!keyRow.isActive) return `'${providerId}' API 키가 비활성 상태입니다`;
    return null;
}

async function validateLocalAssignment(tag: string): Promise<string | null> {
    try {
        const client = createClient();
        const { models } = await client.listModels();
        if (models.length > 0 && !models.some((m) => m.name === tag)) {
            return `LLM 서버에 없는 로컬 모델: '${tag}' (사용 가능: ${models.map((m) => m.name).join(', ')})`;
        }
    } catch (err) {
        logger.warn(`로컬 모델 검증 스킵 (LLM 서버 무응답): ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
}

/** fullId 배정 검증 단일 진입점 — 실패 사유 문자열 또는 null(통과) */
export async function validateModelAssignment(userId: string, fullId: string): Promise<string | null> {
    if (isExternalFullId(fullId)) {
        return validateExternalAssignment(userId, fullId);
    }
    const tag = toLocalModelTag(fullId);
    return tag ? validateLocalAssignment(tag) : `해석 불가한 모델 id: '${fullId}'`;
}
