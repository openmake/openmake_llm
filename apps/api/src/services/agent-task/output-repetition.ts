/**
 * 출력 반복 감지 — 응답 본문에서 짧은 구간이 여러 번 되풀이되는지 본다(모델 반복 루프의 흔적).
 * 빈도 근거가 아직 없어 차단하지 않는다 — 호출부(turn-call)가 단계 기록만 남긴다.
 *
 * @module services/agent-task/output-repetition
 */
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';

/**
 * PURE: 고정 길이 창을 한 글자씩 밀며 같은 창이 **겹치지 않게** 몇 번 나오는지 센다. 임계 이상인 창이 있으면
 * 그 횟수와 표본을, 없으면 null. 긴 응답은 끝부분만 본다(검사 비용 상한). 구분선·공백처럼 글자 종류가 적은 창은 건너뛴다.
 */
export function detectOutputRepetition(text: string | null | undefined): { repeats: number; sample: string } | null {
    const window = AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_WINDOW_CHARS;
    const minRepeats = AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_MIN_REPEATS;
    const body = (text ?? '').slice(-AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_SCAN_TAIL_CHARS);
    if (window <= 0 || body.length < window * minRepeats) return null;
    const seen = new Map<string, { count: number; lastAt: number }>();
    let best: { repeats: number; sample: string } | null = null;
    for (let i = 0; i + window <= body.length; i++) {
        const key = body.slice(i, i + window);
        const prev = seen.get(key);
        if (!prev) { seen.set(key, { count: 1, lastAt: i }); continue; }
        if (i - prev.lastAt < window) continue; // 겹친 창은 같은 한 번이다
        prev.count++;
        prev.lastAt = i;
        if (prev.count >= minRepeats && (!best || prev.count > best.repeats)
            && new Set(key).size >= AGENT_TASK_TURN_LOOP.OUTPUT_REPETITION_MIN_DISTINCT_CHARS) {
            best = { repeats: prev.count, sample: key };
        }
    }
    return best;
}
