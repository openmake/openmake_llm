/**
 * video-runtime — 계획 인자 정규화 hook (P08). 원문에 적힌 길이·비율이 계획값보다 우선한다(실측 2026-09-22: 스키마에 키를 선언한 뒤에도
 * planner 가 "8초"·"6-second" 를 2/2 누락). 원문에 없으면 계획값을 그대로 둔다. job 재조회 작업(attachments 있음)은 새로 제출하지 않으므로
 * 건드리지 않는다. 종전 Base `applyStatedVideoParams` 를 옮겼다.
 * @module addons/video-runtime/plan-input
 */
import { VIDEO_GEN_ASPECT_SIZES } from '../../config/capabilities';
import { VIDEO_ASPECT_PATTERNS } from './constants';
import { statedDurationSec } from '../../services/orchestrator/orchestrate';
import type { PlanTask } from '../../services/orchestrator/plan-schema';
import { createLogger } from '../../utils/logger';

const logger = createLogger('VideoPlanInput');

export function normalizeVideoPlanInput(task: PlanTask, userMessage: string): PlanTask {
    if (task.attachments.length > 0) return task;
    const seconds = statedDurationSec(userMessage);
    const aspect = VIDEO_ASPECT_PATTERNS.find(([, re]) => re.test(userMessage))?.[0];
    if (seconds === undefined && !aspect) return task;
    const extra = { ...task.extra };
    const before = `${String(extra.seconds ?? '-')}/${String(extra.size ?? '-')}`;
    if (seconds !== undefined) extra.seconds = String(seconds);
    if (aspect) extra.size = VIDEO_GEN_ASPECT_SIZES[aspect];
    const after = `${String(extra.seconds ?? '-')}/${String(extra.size ?? '-')}`;
    if (after !== before) logger.info(`[Video] ${task.id} 영상 인자를 원문 기준으로 보정 ${before} → ${after}`);
    return { ...task, extra };
}
