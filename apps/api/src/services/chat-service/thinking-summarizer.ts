/**
 * @module services/chat-service/thinking-summarizer
 * @description thinking 요약 헤드라인 생성 — 클로드 웹식 표시 (2026-07-15).
 *
 * 클로드 웹은 메인 모델의 추론과 별개로 헤드라인 전용 모델이 접힌 생각 블록
 * 상단의 한 줄 요약을 생성한다. 동일 패턴: 생각 스트림이 끝나는 시점(첫 응답
 * 토큰 도착)에 'summary' role 모델로 1회 요약 → WS 'thinking_summary' 이벤트.
 *
 * - 모델: resolveRoleClientForUser('summary', userId) — 사용자/전역 매핑으로
 *   무료 외부 소형 모델 배정 가능, 미배정 시 로컬 default.
 * - fail-open: 실패/타임아웃 시 null — 헤드라인 없이 타임라인만 표시.
 * - THINKING_SUMMARY_ENABLED=false 로 전체 비활성 (요약 LLM 호출 없음).
 */
import { getConfig } from '../../config';
import { resolveRoleClientForUser } from '../model-role-resolver';
import { getThinkingSummaryMessages } from '../../prompts/thinking-summary';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ThinkingSummarizer');

/** 요약 입력 상한 — thinking 이 수만 토큰이어도 헤드라인엔 앞부분+뒷부분이면 충분 */
const MAX_THINKING_CHARS = parseInt(process.env.THINKING_SUMMARY_MAX_INPUT_CHARS || '6000', 10);
const MAX_USER_MSG_CHARS = 500;
/** 헤드라인 1문장 호출 전용 타임아웃 — 채팅 스트림과 병행되므로 짧게 */
const SUMMARY_TIMEOUT_MS = parseInt(process.env.THINKING_SUMMARY_TIMEOUT_MS || '15000', 10);
const SUMMARY_MAX_CHARS = 120;

function truncateThinking(thinking: string): string {
    if (thinking.length <= MAX_THINKING_CHARS) return thinking;
    const head = thinking.slice(0, Math.floor(MAX_THINKING_CHARS * 0.7));
    const tail = thinking.slice(-Math.floor(MAX_THINKING_CHARS * 0.3));
    return `${head}\n…(중략)…\n${tail}`;
}

/**
 * 헤드라인 생성 — 실패 시 null (호출부는 이벤트 미전송으로 graceful degrade).
 */
export async function summarizeThinking(
    userMessage: string,
    thinking: string,
    userId?: string,
): Promise<string | null> {
    if (!getConfig().thinkingSummaryEnabled) return null;
    if (!thinking || thinking.trim().length < 20) return null; // 한두 단어 생각은 요약 무의미

    try {
        const resolved = await resolveRoleClientForUser('summary', userId);
        const client = resolved.client.derive({ timeout: SUMMARY_TIMEOUT_MS });
        const { system, user } = getThinkingSummaryMessages(
            userMessage.slice(0, MAX_USER_MSG_CHARS),
            truncateThinking(thinking),
        );
        const r = await client.chat(
            [{ role: 'system', content: system }, { role: 'user', content: user }],
            { num_predict: 80 },
            undefined,
            { think: false },
        );
        const summary = (r.content ?? '').trim().replace(/^["'「]|["'」]$/g, '').split('\n')[0].trim();
        if (!summary) return null;
        return summary.length > SUMMARY_MAX_CHARS ? `${summary.slice(0, SUMMARY_MAX_CHARS)}…` : summary;
    } catch (e) {
        logger.warn(`thinking 요약 실패 (헤드라인 생략): ${e instanceof Error ? e.message : e}`);
        return null;
    }
}
