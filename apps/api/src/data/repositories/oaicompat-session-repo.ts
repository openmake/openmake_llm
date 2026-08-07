/**
 * @module data/repositories/oaicompat-session-repo
 * @description OpenAI 호환 엔드포인트 세션 연속성 데이터 접근 계층
 *
 * OpenAI 호환 클라이언트(Discord 봇 등)는 대화 세션 개념이 없어 매 요청이 독립적이다.
 * 라우트가 유도한 결정적 세션 키를 `conversation_sessions.metadata` 에 태깅하고,
 * 다음 호출에서 그 키로 기존 세션을 조회해 하나의 세션에 누적한다.
 *
 * @see apps/api/src/routes/openai-compat.routes.ts
 * @see apps/api/src/config/openai-compat.ts
 */
import { BaseRepository } from './base-repository';
import { OPENAI_COMPAT_SESSION } from '../../config/openai-compat';

export class OpenAICompatSessionRepository extends BaseRepository {
    /**
     * 세션 키로 인증 사용자 소유의 최근 세션 id 를 조회한다. 없으면 undefined.
     */
    async findByKeyForUser(sessionKey: string, userId: string): Promise<string | undefined> {
        const result = await this.query<{ id: string }>(
            `SELECT id FROM conversation_sessions
             WHERE metadata->>$2 = $1 AND user_id = $3
             ORDER BY updated_at DESC LIMIT 1`,
            [sessionKey, OPENAI_COMPAT_SESSION.METADATA_FIELD, userId],
        );
        return result.rows[0]?.id;
    }

    /**
     * 세션 키로 익명 소유(anon_session_id = 세션 키)의 최근 세션 id 를 조회한다. 없으면 undefined.
     * API key 에 user 가 없는 경로용 — 세션 키가 곧 익명 소유자 식별자가 된다.
     */
    async findByKeyForAnon(sessionKey: string): Promise<string | undefined> {
        const result = await this.query<{ id: string }>(
            `SELECT id FROM conversation_sessions
             WHERE metadata->>$2 = $1 AND user_id IS NULL AND anon_session_id = $1
             ORDER BY updated_at DESC LIMIT 1`,
            [sessionKey, OPENAI_COMPAT_SESSION.METADATA_FIELD],
        );
        return result.rows[0]?.id;
    }

    /**
     * 새로 생성된 세션에 세션 키를 metadata 로 태깅한다 (다음 호출의 조회 대상).
     */
    async tagKey(sessionId: string, sessionKey: string): Promise<void> {
        await this.query(
            `UPDATE conversation_sessions
             SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), $2, to_jsonb($3::text))
             WHERE id = $1`,
            [sessionId, `{${OPENAI_COMPAT_SESSION.METADATA_FIELD}}`, sessionKey],
        );
    }
}
