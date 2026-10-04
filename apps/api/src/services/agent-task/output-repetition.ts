/**
 * 출력 반복 — 응답 본문에서 같은 구간이 연달아 되풀이되는지 보고(모델 반복 루프의 흔적), 반복이 시작된 뒤를 잘라 내며,
 * 최종 답이 될 응답이었으면 한 번 다시 요청한다. 감지·기록·자르기는 호출부(turn-call), 다시 요청은 turn-context 가 부른다.
 *
 * @module services/agent-task/output-repetition
 */
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import { OUTPUT_REPETITION_CUT_MARKER, getOutputRepetitionRetryNudge, getOutputRepetitionRetryNote } from '../../prompts/agent-task-turn-loop';
import { AGENT_TASK_STEERING_MARKER } from '../../prompts/agent-task-prompt';
import type { ChatMessage } from '../../llm/types';

/**
 * PURE: 고정 길이 창을 한 글자씩 밀며 같은 창이 **겹치지 않게** 몇 번 나오는지 센다. 임계 횟수만큼 **같은 간격으로, 사이의 글까지 같게**
 * 이어진 창이 있으면 횟수·표본·자를 자리(cutAt — 되풀이되는 단위가 처음 한 번 끝난 곳)를, 없으면 null.
 * 사이의 글이 다르면 반복이 아니다 — 같은 머리글 행을 가진 표 여럿, 같은 접두로 시작하는 목록 항목은 정당한 구조다.
 * 긴 응답은 끝부분만 본다(검사 비용 상한). 구분선·공백처럼 글자 종류가 적은 창은 건너뛴다.
 */
export function detectOutputRepetition(text: string | null | undefined): { repeats: number; sample: string; cutAt: number } | null {
    const window = AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_WINDOW_CHARS;
    const minRepeats = AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_MIN_REPEATS;
    const full = text ?? '';
    const body = full.slice(-AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_SCAN_TAIL_CHARS);
    if (window <= 0 || minRepeats < 2 || body.length < window * minRepeats) return null;
    const seen = new Map<string, number[]>();
    for (let i = 0; i + window <= body.length; i++) {
        const key = body.slice(i, i + window);
        const at = seen.get(key);
        if (!at) { seen.set(key, [i]); continue; }
        if (i - at[at.length - 1] < window) continue; // 겹친 창은 같은 한 번이다
        at.push(i);
        if (at.length < minRepeats || new Set(key).size < AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_MIN_DISTINCT_CHARS) continue;
        const tail = at.slice(-minRepeats);
        const period = tail[1] - tail[0];
        const unit = body.slice(tail[0], tail[0] + period);
        if (!tail.slice(0, -1).every((q, k) => tail[k + 1] - q === period && body.slice(q, q + period) === unit)) continue;
        let repeats = minRepeats;
        while (body.startsWith(key, tail[0] + repeats * period)) repeats++;
        return { repeats, sample: key, cutAt: full.length - body.length + tail[0] + period };
    }
    return null;
}

/**
 * PURE: 사용자가 일부러 반복 출력을 시킨 작업인가 — 그런 작업의 반복은 모델의 반복 루프가 아니라 요청한 결과다.
 * 사용자가 직접 쓴 글만 본다 — 목표(대화의 첫 사용자 메시지)와 작업 도중 보낸 지시(steering).
 * 시스템이 주입하는 안내·재촉에도 "N번 반복" 같은 말이 들어 있어 섞어 보면 오탐한다.
 */
export function goalRequestsRepetition(conversation: readonly ChatMessage[]): boolean {
    if (!AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_RESPECT_REQUEST) return false;
    const goalAt = conversation.findIndex((m) => m.role === 'user');
    const fromUser = conversation
        .filter((m, i) => m.role === 'user' && typeof m.content === 'string' && (i === goalAt || m.content.startsWith(AGENT_TASK_STEERING_MARKER)))
        .map((m) => m.content as string);
    return fromUser.some((text) => AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_REQUEST_PATTERNS.some((re) => [...text.matchAll(re)].some((m) => {
        const n = m.groups?.n ?? '';
        return /^\d+$/.test(n) ? Number(n) >= AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_MIN_REPEATS : n !== '';
    })));
}

/** PURE: 반복이 시작된 뒤를 잘라 내고 생략 표시를 붙인다 — 모델이 자기 반복을 다시 읽고 이어가지 않게 한다. */
export function cutRepeatedOutput(text: string, cutAt: number): string {
    return `${text.slice(0, cutAt).trimEnd()}${OUTPUT_REPETITION_CUT_MARKER}`;
}

interface TurnOut {
    result: { content?: string | null; tool_calls?: unknown[]; metrics?: { prompt_tokens?: number; completion_tokens?: number } };
    /** 이 응답의 본문을 반복 때문에 잘랐는가(turn-call 이 채운다). */
    repetitionCut?: boolean;
}

/**
 * 반복으로 잘린 응답이 최종 답으로 쓰이려던 것(도구 호출 없음)이면, 잘린 본문과 안내를 대화에 넣고 한 번 다시 요청한다.
 * 횟수는 대화에 남은 안내로 센다(작업당 OUTPUT_REPETITION_RETRY_MAX, 기본 1회) — 재개 뒤에도 같다.
 * 다시 받은 응답도 반복이면 잘린 채로 쓴다. 첫 호출의 토큰은 돌려주는 응답의 사용량에 합친다(작업 누적에서 빠지지 않게).
 */
export async function retryRepeatedAnswer<T extends TurnOut>(
    p: { conversation: ChatMessage[]; onNote?: (stepType: string, note: string) => void }, out: T, recall: () => Promise<T>,
): Promise<T> {
    if (!out.repetitionCut || (out.result.tool_calls?.length ?? 0) > 0) return out;
    const nudge = getOutputRepetitionRetryNudge();
    const used = p.conversation.filter((m) => m.role === 'user' && m.content === nudge).length;
    const max = AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_RETRY_MAX;
    if (used >= max) return out;
    p.conversation.push({ role: 'assistant', content: out.result.content ?? '' }, { role: 'user', content: nudge });
    try { p.onNote?.('retry', getOutputRepetitionRetryNote(used + 1, max)); } catch { /* 관측 실패 무시 */ }
    const again = await recall();
    const sum = (k: 'prompt_tokens' | 'completion_tokens'): number => (out.result.metrics?.[k] ?? 0) + (again.result.metrics?.[k] ?? 0);
    again.result.metrics = { ...again.result.metrics, prompt_tokens: sum('prompt_tokens'), completion_tokens: sum('completion_tokens') };
    return again;
}
