/**
 * 외부 provider 도구 루프의 예산·반복 가드 — external-provider.ts 에서 분리 (600줄 CI 가드).
 *
 * 두 가드 모두 "도구를 끈 최종 턴으로 전환"을 유도하는 넛지 user 메시지를 messages 에
 * 밀어 넣고 boolean 을 반환한다 — 호출부(runExternalStream 루프)가 suppressTools 전환을
 * 담당한다(루프 지역 상태라 여기서 직접 만지지 않음).
 *
 * @module services/chat-service/external-loop-guards
 */
import { createLogger } from '../../utils/logger';
import { LOOP_DETECTION, AGENT_LOOP_LIMITS } from '../../config/runtime-limits';
import type { ChatMessage } from '../../llm';

const logger = createLogger('ChatExternalProvider');

/**
 * Wall-clock 예산 가드 — 턴 수와 별개로 누적 시간 초과 시 도구 끄고 최종 응답 유도.
 * 이미지 생성(디퓨전 수십 초~수 분) 소요시간은 공제(imageGenCreditMs) — 예산의
 * 목적(모델/도구 폭주 차단)과 무관한 정상 대기가 후속 턴(덱 저장 등)을 잘라내던
 * 결함 보정 (2026-08-14 라이브 실측: 3장 배치 166s → 도구 비활성 전환).
 *
 * @returns true 면 예산 초과 — 호출부는 suppressTools 로 전환한다.
 */
export function applyWallClockGuard(p: {
    startedAt: number;
    imageGenCreditMs: number;
    messages: ChatMessage[];
}): boolean {
    if (AGENT_LOOP_LIMITS.MAX_WALL_CLOCK_MS <= 0
        || Date.now() - p.startedAt - p.imageGenCreditMs <= AGENT_LOOP_LIMITS.MAX_WALL_CLOCK_MS) {
        return false;
    }
    logger.warn(`⏱️ 외부 LLM 루프 wall-clock 예산 초과 (${AGENT_LOOP_LIMITS.MAX_WALL_CLOCK_MS}ms) — 도구 비활성 최종 턴으로 전환`);
    p.messages.push({
        role: 'user',
        content: '처리 시간이 초과되었습니다. 추가 도구 호출 없이 현재까지 수집한 정보로 답변을 완성하세요.',
    });
    return true;
}

/**
 * 같은 도구 반복 사용 가드 (인자 무관) — 검색어만 바꿔가며 부르는 패턴은
 * doom-loop(도구+인자 해시)에 걸리지 않아 최대 턴까지 소진된다.
 * 매 턴 모델 prefill 이 누적되므로 지연의 지배 요인이다(2026-08-02 실측).
 *
 * BREAK_AT 도달 시 중단 넛지를 push 하고 true 반환 — 호출부는 suppressTools 전환 후
 * continue. WARN_AT 도달 시(도구별 1회) 마무리 유도 넛지만 push 하고 false 반환.
 */
export function applyToolOveruseGuard(p: {
    toolCalls: ReadonlyArray<{ name: string }>;
    toolUseCounts: Map<string, number>;
    warnedTools: Set<string>;
    messages: ChatMessage[];
}): boolean {
    for (const tc of p.toolCalls) {
        p.toolUseCounts.set(tc.name, (p.toolUseCounts.get(tc.name) ?? 0) + 1);
    }
    const overusedTool = [...p.toolUseCounts.entries()]
        .find(([, n]) => n >= LOOP_DETECTION.SAME_TOOL_BREAK_AT);
    if (overusedTool) {
        logger.warn(`🔁 도구 과다 사용 — ${overusedTool[0]} ${overusedTool[1]}회 `
            + `(상한 ${LOOP_DETECTION.SAME_TOOL_BREAK_AT}) — 도구 비활성 최종 턴으로 전환`);
        p.messages.push({
            role: 'user',
            content: `${overusedTool[0]} 도구를 ${overusedTool[1]}회 호출했습니다. `
                + '더 검색하지 말고 지금까지 수집한 정보로 답변을 완성하세요. '
                + '확인되지 않은 부분은 모른다고 밝히면 됩니다. '
                + '(이 제한은 이번 응답에만 적용됩니다 — 당신의 도구 능력이 사라진 것이 아니므로 '
                + '"검색 불가"라고 말하지 마세요.)',
        });
        return true;
    }
    const warnTool = [...p.toolUseCounts.entries()]
        .find(([name, n]) => n >= LOOP_DETECTION.SAME_TOOL_WARN_AT && !p.warnedTools.has(name));
    if (warnTool) {
        p.warnedTools.add(warnTool[0]);
        logger.info(`⚠️ 도구 반복 경고 — ${warnTool[0]} ${warnTool[1]}회 (마무리 유도)`);
        p.messages.push({
            role: 'user',
            content: `${warnTool[0]} 도구를 이미 ${warnTool[1]}회 호출했습니다. `
                + '검색어를 바꿔 다시 시도하기보다, 지금까지의 결과로 답변을 정리하세요. '
                + '정말 필요한 경우에만 한 번 더 호출하세요.',
        });
    }
    return false;
}
