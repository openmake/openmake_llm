/**
 * 위임 입력 품질 검사 — 빈 껍데기 목표를 서브에이전트에 넘기기 전에 결정적 규칙으로 거른다.
 *
 * 서브에이전트는 부모의 대화를 보지 못한다. "위 작업 계속" 같은 지시는 서브가 무엇을 할지 알 수 없어
 * 기억으로 지어낸 답이 돌아온다 — 턴과 토큰을 쓴 뒤에야 드러나므로, 실행 전에 이유와 함께 돌려보낸다.
 * 모델을 부르지 않는다(패턴·길이만).
 *
 * @module services/agent-task/delegation-input
 */
import {
    AGENT_DELEGATION, DELEGATION_PLACEHOLDER_GOAL_RE, DELEGATION_TEMPLATE_MARKER_RE, DELEGATION_CONTEXT_DEPENDENT_RES,
    DELEGATION_WIDE_CHAR_RE,
} from '../../config/agent-task-delegation';
import { getDelegationGoalProblem } from '../../prompts/agent-task-delegation';

/** PURE: 환산 글자 수 — 한글·한자·가나는 한 글자를 WIDE_CHAR_WEIGHT 로 센다. */
function weightedLength(text: string): number {
    return text.length + (text.match(DELEGATION_WIDE_CHAR_RE)?.length ?? 0) * (AGENT_DELEGATION.WIDE_CHAR_WEIGHT - 1);
}

/**
 * PURE: 목표가 위임할 만한지 — 문제가 있으면 이유 문장, 없으면 null.
 * `batch` 는 여러 태스크를 한 번에 맡기는 호출(spawn_agents 2개 이상)인지 — 최소 길이는 그때만 본다
 * (단일 위임의 짧은 목표는 정당할 수 있다).
 */
export function checkDelegationGoal(goal: string, opts: { batch: boolean }): string | null {
    const text = goal.trim().replace(/\s+/g, ' ');
    if (DELEGATION_PLACEHOLDER_GOAL_RE.test(text)) return getDelegationGoalProblem('placeholder', text);
    const marker = DELEGATION_TEMPLATE_MARKER_RE.exec(text);
    if (marker) return getDelegationGoalProblem('template', marker[0]);
    if (text.length <= AGENT_DELEGATION.CONTEXT_DEPENDENT_MAX_CHARS && DELEGATION_CONTEXT_DEPENDENT_RES.some((re) => re.test(text))) {
        return getDelegationGoalProblem('context');
    }
    if (opts.batch && weightedLength(text) < AGENT_DELEGATION.MIN_GOAL_CHARS) return getDelegationGoalProblem('short', `${text.length}자`);
    return null;
}
