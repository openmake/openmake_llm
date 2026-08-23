/**
 * 답변 검증 — 채팅 답변 완료 후 judge role 모델이 **1회** 점검하고 지적만 돌려준다.
 *
 * thinking-summarizer 와 같은 후처리 패턴(별도 role 모델 1회 호출 → WS 이벤트).
 * 실측 근거와 "고치지 않는" 이유는 prompts/answer-verification 참고.
 *
 * 불변식:
 *   - **fail-open**: 검증 실패·타임아웃은 답변에 영향을 주지 않는다(null 반환).
 *   - 자동 수정 없음 — 판단은 사용자 몫.
 *   - ANSWER_VERIFICATION_ENABLED=false 면 LLM 호출 자체가 없다.
 *
 * @module services/chat-service/answer-verifier
 */
import { resolveRoleClientForUser } from '../model-role-resolver';
import { getAnswerVerificationMessages, VERIFICATION_NONE } from '../../prompts/answer-verification';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AnswerVerifier');

const ENABLED = (process.env.ANSWER_VERIFICATION_ENABLED ?? 'false').toLowerCase() === 'true';
/** 검증 대상 최소 길이 — 짧은 답(인사·단답)은 검증 가치가 없다. */
const MIN_ANSWER_CHARS = parseInt(process.env.ANSWER_VERIFICATION_MIN_CHARS || '200', 10);
/** judge 에 싣는 답변/질문 상한 — 긴 답은 앞부분만으로 판단(비용·지연 억제). */
const MAX_ANSWER_CHARS = parseInt(process.env.ANSWER_VERIFICATION_MAX_ANSWER_CHARS || '4000', 10);
const MAX_USER_MSG_CHARS = 800;
const TIMEOUT_MS = parseInt(process.env.ANSWER_VERIFICATION_TIMEOUT_MS || '20000', 10);
const MAX_OUTPUT_TOKENS = parseInt(process.env.ANSWER_VERIFICATION_MAX_TOKENS || '300', 10);

export function isAnswerVerificationEnabled(): boolean {
    return ENABLED;
}

/**
 * @returns 지적 텍스트(사용자에게 표시) 또는 null (오류 없음·비활성·실패).
 */
export async function verifyAnswer(
    userMessage: string,
    answer: string,
    userId?: string,
    userLanguage?: string,
): Promise<string | null> {
    if (!ENABLED) return null;
    const trimmed = (answer ?? '').trim();
    if (trimmed.length < MIN_ANSWER_CHARS) return null;

    const lang = (userLanguage || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
    try {
        const resolved = await resolveRoleClientForUser('judge', userId);
        const client = resolved.client.derive({ timeout: TIMEOUT_MS });
        const { system, user } = getAnswerVerificationMessages(
            userMessage.slice(0, MAX_USER_MSG_CHARS),
            trimmed.slice(0, MAX_ANSWER_CHARS),
            lang,
        );
        const r = await client.chat(
            [{ role: 'system', content: system }, { role: 'user', content: user }],
            { num_predict: MAX_OUTPUT_TOKENS },
            undefined,
            { think: false },
        );
        const out = (r.content ?? '').trim();
        if (!out || out.toUpperCase().startsWith(VERIFICATION_NONE)) return null;
        logger.info(`답변 검증 지적 발생 (model=${resolved.fullId}, ${out.length}자)`);
        return out;
    } catch (e) {
        // fail-open — 검증이 답변을 죽이지 않는다.
        logger.warn(`답변 검증 실패 (생략): ${e instanceof Error ? e.message : e}`);
        return null;
    }
}
