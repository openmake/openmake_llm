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
    const seconds = statedDurationSec(userMessage);
    if (seconds === undefined) return task;
    const before = String(task.extra.duration ?? '-');
    const after = String(seconds);
    if (before !== after) logger.info(`[Music] ${task.id} 음악 길이를 원문 기준으로 보정 ${before} → ${after}`);
    return { ...task, extra: { ...task.extra, duration: after } };
}
