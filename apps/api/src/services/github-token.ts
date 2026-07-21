/**
 * 저장된 사용자 GitHub 연결(external_connections, serviceType='github')에서 복호화된
 * PAT 를 조회한다. Phase 2 Git 통합의 호스트측 clone/push/PR 이 이 토큰을 사용한다.
 *
 * ⚠️ 반환된 토큰은 **호스트 프로세스에서만** 사용하고 격리 컨테이너에는 절대 주입하지 않는다
 * (프롬프트 인젝션 → 토큰 유출 차단 — 보안 아키텍처의 핵심).
 *
 * @module services/github-token
 */
import { getUnifiedDatabase } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('GithubToken');

/** 사용자의 저장된 GitHub PAT(복호화됨). 미연결이면 null. 조회 실패는 null(fail-open). */
export async function getUserGithubToken(userId: string): Promise<string | null> {
    try {
        const conn = await getUnifiedDatabase().getUserConnectionByService(userId, 'github');
        return conn?.access_token ?? null;
    } catch (e) {
        logger.warn(`[${userId}] GitHub 토큰 조회 실패: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}
