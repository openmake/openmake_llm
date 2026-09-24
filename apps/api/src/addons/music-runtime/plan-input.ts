/**
 * music-runtime — 계획 인자 정규화 hook (P06). 사용자 원문에 적힌 길이("5분"·"90초")가 계획값보다 우선한다 —
 * Planner 가 `duration` 을 비워 30초만 나오던 결함(2026-09-23, #982)의 보정을 Base(orchestrate)에서 이 add-on 으로 옮겼다.
 * 원문에 길이가 없으면 계획값을 그대로 둔다(원문 의미를 조용히 바꾸지 않는다). 가사 자리의 작업 참조("REFS:t1")는 Base 의
 * 검증 단계가 refs 로 옮긴다(의존성에 영향을 주므로 위상 정렬 전에 해야 한다).
 * @module addons/music-runtime/plan-input
 */
import { statedDurationSec } from '../../services/orchestrator/orchestrate';
import type { PlanTask } from '../../services/orchestrator/plan-schema';
import { createLogger } from '../../utils/logger';

const logger = createLogger('MusicPlanInput');

export function normalizeMusicPlanInput(task: PlanTask, userMessage: string): PlanTask {
    let out = task;
    // 앞 작업(가사 쓰기)에 의존하면서 가사·refs 를 비운 계획 — 그 결과가 가사로 전달되지 않아 연주곡이 됐다(2026-09-24).
    // 음악 작업이 앞 작업을 기다리는 이유는 그 결과를 쓰기 위해서뿐이므로 의존 작업을 refs 로 잇는다.
    const lyrics = typeof out.extra.lyrics === 'string' ? out.extra.lyrics.trim() : '';
    if (!lyrics && out.refs.length === 0 && out.dependsOn.length > 0) {
        logger.info(`[Music] ${out.id} 가사 참조 보정: 의존 작업 ${out.dependsOn.join(',')} 을 refs 로`);
        out = { ...out, refs: [...out.dependsOn] };
    }
    const seconds = statedDurationSec(userMessage);
    if (seconds === undefined) return out;
    const before = String(out.extra.duration ?? '-');
    const after = String(seconds);
    if (before !== after) logger.info(`[Music] ${out.id} 음악 길이를 원문 기준으로 보정 ${before} → ${after}`);
    return { ...out, extra: { ...out.extra, duration: after } };
}
