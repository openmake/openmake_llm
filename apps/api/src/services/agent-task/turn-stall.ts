/**
 * 도구 호출 없이 끝난 턴의 재촉 판정 — 계획만 쓴 첫 턴과, 다음 행동을 예고만 하고 멈춘 이후 턴.
 *
 * 로컬 모델은 "이제 테스트를 실행하겠습니다."처럼 할 일을 말만 하고 도구를 부르지 않은 채 턴을 끝내곤 한다.
 * 그 응답을 최종 답변으로 받으면 작업이 하다 만 채 완료 관문으로 간다. 첫 턴은 종전부터 잡았고(산출물 없으면 1회),
 * 이후 턴은 짧은 응답의 끝이 행동 예고일 때만 상한까지 재촉한다.
 *
 * @module services/agent-task/turn-stall
 */
import { AGENT_TASK_TURN_LOOP, AGENT_TASK_STALL_INTENT_RE } from '../../config/agent-task-turn-loop';
import { AGENT_TASK_INCOMPLETE_MARKER, getAgentTaskDeliverableNudge } from '../../prompts/agent-task-prompt';
import { getAgentTaskStallNudge, getAgentTaskStallNote } from '../../prompts/agent-task-turn-loop';

/** PURE: 짧은 응답이 다음 행동 예고로 **끝나는가** — 긴 응답은 실질 답변으로 보고, 끝부분만 본다(문장 중간의 예고는 제외). */
export function endsWithActionAnnouncement(text: string): boolean {
    const t = text.trim();
    if (!t || t.length > AGENT_TASK_TURN_LOOP.STALL_MAX_CHARS) return false;
    return AGENT_TASK_STALL_INTENT_RE.test(t.slice(-AGENT_TASK_TURN_LOOP.STALL_TAIL_CHARS));
}

interface NoToolTurn {
    /** 이 실행의 첫 턴인가(재개면 재개한 턴). */
    firstTurn: boolean;
    /** 산출물을 떼어낸 응답 본문. */
    content: string | null | undefined;
    artifactCount: number;
    /** 이 뒤에 도구를 쓸 수 있는 턴이 남았는가 — 마무리 턴(도구 차단)·마지막 턴이면 재촉해도 행동할 수 없다. */
    canAct: boolean;
    /** 지금까지의 행동 예고 재촉 횟수. */
    stallNudges: number;
}

/**
 * PURE: 재촉할 안내문. null 이면 최종 답변으로 받아 완료 관문으로 보낸다. note 가 있으면 행동 예고 재촉이다(단계 기록·횟수 증가).
 * 산출물이 있거나 모델이 수행 불가를 선언(마커)했으면 재촉하지 않는다 — 재촉이 불가 선언을 뭉개면 미달성이 completed 로 흘러간다.
 */
export function pickNoToolNudge(p: NoToolTurn): { nudge: string; note?: string } | null {
    const content = p.content ?? '';
    if (p.artifactCount > 0 || content.includes(AGENT_TASK_INCOMPLETE_MARKER)) return null;
    if (p.firstTurn) return { nudge: getAgentTaskDeliverableNudge() };
    if (!p.canAct || p.stallNudges >= AGENT_TASK_TURN_LOOP.STALL_NUDGE_MAX || !endsWithActionAnnouncement(content)) return null;
    return { nudge: getAgentTaskStallNudge(), note: getAgentTaskStallNote(p.stallNudges + 1, AGENT_TASK_TURN_LOOP.STALL_NUDGE_MAX) };
}
