/**
 * 아티팩트 가이드 블록 조립 — message-pipeline 에서 분리 (파일 크기 가드).
 *
 * 사용자별 artifacts_enabled 설정을 조회해, 활성 시 언어별 아티팩트 가이드 프롬프트를 반환한다.
 * 조회 실패는 기본 활성으로 fallback. 동작은 원본과 동일.
 *
 * @module services/chat-service/artifact-guide-block
 */
import { createLogger } from '../../utils/logger';

const logger = createLogger('MessagePipeline');

export async function buildArtifactGuideBlock(userId: string | undefined, language: string): Promise<string> {
    try {
        let enabled = true;
        if (userId && userId !== 'guest') {
            const { UserRepository } = await import('../../data/repositories/user-repository');
            const { getPool } = await import('../../data/models/unified-database');
            enabled = await new UserRepository(getPool()).getArtifactsEnabled(userId);
        }
        if (!enabled) return '';
        const { getArtifactGuide } = await import('../../prompts/artifact-guide');
        return getArtifactGuide(language);
    } catch (e) {
        logger.warn('artifacts_enabled 조회 실패 (기본 활성으로 진행):', e);
        const { getArtifactGuide } = await import('../../prompts/artifact-guide');
        return getArtifactGuide(language);
    }
}
