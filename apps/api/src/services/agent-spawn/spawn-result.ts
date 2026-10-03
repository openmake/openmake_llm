/**
 * spawn_agents 결과 조립 — 태스크별로 예산을 나눠, 모든 태스크의 결과와 끝의 종합 지시가 부모에게 도달하게 한다.
 *
 * 종전에는 결과를 그대로 이어 붙였다. 합이 도구 결과 상한을 넘으면 뒤 태스크와 "지금 종합하라" 지시가 통째로 잘렸고,
 * 채팅 경로에는 합산 상한이 없었다. 여기서 전체를 예산 안으로 맞추므로 하류 절단이 걸리지 않는다.
 *
 * @module services/agent-spawn/spawn-result
 */
import { truncateToolResult } from '../agent-task/tool-result-truncate';
import { getSpawnResultTitle, getSpawnSynthesisNudge, getSpawnDroppedNote, SPAWN_MISSING_RESULT } from '../../prompts/subagent-system';

/** 태스크 하나에 주는 최소 글자 수 — 예산이 작아도 결론 한두 문장은 남게. */
const MIN_PER_TASK_CHARS = 300;

/** PURE: 섹션 머리말 + 태스크별 예산으로 줄인 본문 + 종합 지시. 전체 길이는 budgetChars 를 넘지 않게 맞춘다. */
export function composeSpawnResult(p: {
    tasks: ReadonlyArray<{ prompt: string; role?: string }>;
    results: ReadonlyArray<string | null | undefined>;
    noToolsNotice: string;
    droppedCount: number;
    maxTasks: number;
    budgetChars: number;
    headRatio: number;
}): string {
    const n = p.tasks.length;
    const headers = p.tasks.map((task, i) => `### 태스크 ${i + 1}/${n}${task.role ? ` (role: ${task.role})` : ''}: ${task.prompt.slice(0, 80)}`);
    const title = `${getSpawnResultTitle(n)}\n\n${p.noToolsNotice}`;
    const tail = `${p.droppedCount > 0 ? getSpawnDroppedNote(p.maxTasks, p.droppedCount) : ''}${getSpawnSynthesisNudge()}`;
    const bodies = p.results.slice(0, n).map((r) => r ?? SPAWN_MISSING_RESULT);
    const compose = (parts: string[]): string => `${title}${headers.map((h, i) => `${h}\n${parts[i]}`).join('\n\n')}${tail}`;
    const full = compose(bodies);
    if (full.length <= p.budgetChars) return full;
    // 고정 부분(제목·머리말·지시)과 생략 표시 자리를 뺀 나머지를 태스크 수로 나눈다.
    const fixed = compose(bodies.map(() => '')).length;
    const markerRoom = 60;
    const perTask = Math.max(MIN_PER_TASK_CHARS, Math.floor((p.budgetChars - fixed) / Math.max(1, n)) - markerRoom);
    return compose(bodies.map((b) => truncateToolResult(b, perTask, p.headRatio)));
}
