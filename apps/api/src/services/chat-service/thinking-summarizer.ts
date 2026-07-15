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
    mode: 'progress' | 'final' = 'final',
): Promise<string | null> {
    if (!getConfig().thinkingSummaryEnabled) return null;
    if (!thinking || thinking.trim().length < 20) return null; // 한두 단어 생각은 요약 무의미

    try {
        const resolved = await resolveRoleClientForUser('summary', userId);
        const client = resolved.client.derive({ timeout: SUMMARY_TIMEOUT_MS });
        const { system, user } = getThinkingSummaryMessages(
            userMessage.slice(0, MAX_USER_MSG_CHARS),
            truncateThinking(thinking),
            mode,
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

/* ── 요약 세션 (동적 헤드라인 — 클로드 웹의 진행 중 갱신 대응) ──────────── */

/** 진행 중 첫 중간 요약을 시작하는 생각 누적 길이 — 짧은 생각은 최종 요약만 */
const PROGRESS_MIN_CHARS = parseInt(process.env.THINKING_SUMMARY_PROGRESS_MIN_CHARS || '800', 10);
/** 다음 중간 요약까지 필요한 신규 생각 길이 */
const PROGRESS_STEP_CHARS = parseInt(process.env.THINKING_SUMMARY_PROGRESS_STEP_CHARS || '1500', 10);
/** 중간 요약 최소 간격 — 요약 호출 폭주 방지 */
const PROGRESS_MIN_INTERVAL_MS = parseInt(process.env.THINKING_SUMMARY_PROGRESS_INTERVAL_MS || '7000', 10);

export interface ThinkingSummarySession {
    /** 생각 청크 누적 — 임계값 도달 시 진행형 중간 요약을 비동기 발행 */
    onThinking(chunk: string): void;
    /** 누적된 생각 원문 (영속화용) */
    getThinking(): string;
    /**
     * 생각 종료(첫 응답 토큰) — 과거형 최종 요약 시작. 멱등(1회만 시작).
     * @returns 최종 요약 promise (실패/비활성 시 null resolve)
     */
    startFinal(): Promise<string | null>;
}

/**
 * 채팅 1건의 생각 요약 세션. 중간(진행형)·최종(과거형) 요약을 onSummary 로 발행 —
 * 호출부(WS 등)는 도착 순서대로 헤드라인을 덮어쓰면 된다.
 * in-flight 가드로 요약 호출은 항상 1개만 진행, 최종 시작 후 중간 요약은 중단.
 */
export function createThinkingSummarySession(
    userMessage: string,
    userId: string | undefined,
    onSummary: (summary: string) => void,
): ThinkingSummarySession {
    let buffer = '';
    let lastSummarizedLen = 0;
    let lastSummarizedAt = 0;
    let inFlight = false;
    let finalPromise: Promise<string | null> | null = null;

    const run = async (mode: 'progress' | 'final'): Promise<string | null> => {
        const summary = await summarizeThinking(userMessage, buffer, userId, mode);
        // 최종 요약이 이미 시작됐으면 늦게 도착한 중간 요약은 발행하지 않음 (역행 방지)
        if (summary && (mode === 'final' || !finalPromise)) onSummary(summary);
        return summary;
    };

    return {
        onThinking(chunk: string): void {
            buffer += chunk;
            if (finalPromise || inFlight) return;
            if (!getConfig().thinkingSummaryEnabled) return;
            if (buffer.length < PROGRESS_MIN_CHARS) return;
            if (lastSummarizedLen > 0 && buffer.length - lastSummarizedLen < PROGRESS_STEP_CHARS) return;
            if (Date.now() - lastSummarizedAt < PROGRESS_MIN_INTERVAL_MS && lastSummarizedAt > 0) return;
            inFlight = true;
            lastSummarizedLen = buffer.length;
            lastSummarizedAt = Date.now();
            void run('progress').catch(() => null).finally(() => { inFlight = false; });
        },
        getThinking(): string {
            return buffer;
        },
        startFinal(): Promise<string | null> {
            if (!finalPromise) {
                finalPromise = buffer.trim().length > 0
                    ? run('final').catch(() => null)
                    : Promise.resolve(null);
            }
            return finalPromise;
        },
    };
}
