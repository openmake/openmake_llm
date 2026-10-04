/**
 * 과거 작업 검색 도구(task_history) — 에이전트 작업이 같은 사용자의 과거 작업을 검색·최근 목록·한 건 요약으로 읽는다.
 * 읽기 전용이다. 사용자 범위는 도구를 부른 작업의 소유자(ctx.userId)로만 정해지고 인자로 바꿀 수 없다.
 * 교훈 주입은 최근 N건 안에서 자동으로 고르지만, 이 도구는 모델이 필요할 때 그 밖의 작업까지 찾아본다.
 * 기본 켜짐 — 목표가 과거 작업을 가리킬 때만 싣는다(TASK_HISTORY_TOOL.EXPOSURE).
 *
 * @module services/agent-task/task-history-tool
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskHistoryRepository, type TaskHistoryItem } from '../../data/repositories/agent-task-history-repository';
import type { ContributedAgentTaskTool } from '../chat-service/turn-integrations';
import { TASK_HISTORY_TOOL, TASK_HISTORY_INTENT_PATTERNS } from '../../config/agent-task-skill-memory';
import { TASK_HISTORY_TOOL_TEXT as T } from '../../prompts/agent-task-skill-memory';
import { wrapUntrustedToolResult } from './tool-result-wrap';

export const TASK_HISTORY_TOOL_NAME = 'task_history';

/** 도구가 쓰는 조회 — 저장소가 그대로 맞는다(테스트에서 교체). */
export type TaskHistoryStore = Pick<AgentTaskHistoryRepository, 'searchTasks' | 'getTaskSummary'>;

const GUEST_USER_ID = 'guest';

function renderItem(t: TaskHistoryItem): string {
    return `- id=${t.id} [${t.status}] ${new Date(t.created_at).toISOString().slice(0, 10)} (${t.current_turn}턴) ${t.goal.replace(/\s+/g, ' ')}`;
}

/**
 * [task_history] 또는 빈 배열(꺼짐, 또는 목표가 과거 작업을 가리키지 않음). currentTaskId 는 목록에서 뺀다(지금 작업이 자기 자신을 찾지 않게).
 * goal(지금 작업의 목표)을 주면 과거 기록이 든 결과를 데이터 래퍼(tool-result-wrap)로 감싼다 — 과거 목표·결과에는
 * 그때 읽은 웹 페이지·파일의 문장이 섞여 있을 수 있어, 그 안의 지시문이 지금 작업의 지시처럼 읽히지 않게 한다.
 */
export function createTaskHistoryTools(
    currentTaskId: string,
    deps: { enabled?: boolean; store?: TaskHistoryStore; goal?: string; exposure?: 'intent' | 'always' } = {},
): ContributedAgentTaskTool[] {
    if (!(deps.enabled ?? TASK_HISTORY_TOOL.ENABLED)) return [];
    // 목표가 과거 작업을 가리키지 않으면 싣지 않는다 — 쓸 이유가 없는 작업에서 도구 자리(동적 도구 예산)와 스키마 토큰을 쓰지 않는다.
    const goal = deps.goal ?? '';
    if ((deps.exposure ?? TASK_HISTORY_TOOL.EXPOSURE) === 'intent' && !TASK_HISTORY_INTENT_PATTERNS.some((re) => re.test(goal))) return [];
    const store = (): TaskHistoryStore => deps.store ?? new AgentTaskHistoryRepository(getPool());
    const asData = (text: string): string => (TASK_HISTORY_TOOL.WRAP_RESULT && deps.goal ? wrapUntrustedToolResult(text, deps.goal) : text);
    return [{
        tool: {
            name: TASK_HISTORY_TOOL_NAME,
            description: T.description,
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: T.actionArg },
                    query: { type: 'string', description: T.queryArg },
                    task_id: { type: 'string', description: T.taskIdArg },
                    limit: { type: 'number', description: T.limitArg },
                },
                required: ['action'],
            },
        },
        run: async (args, ctx) => {
            const err = (text: string) => ({ text, isError: true });
            if (!ctx.userId || ctx.userId === GUEST_USER_ID) return err(T.guest);
            const action = String(args.action ?? '');
            try {
                if (action === 'view') {
                    const taskId = String(args.task_id ?? '').trim();
                    if (!taskId) return err(T.needTaskId);
                    const s = await store().getTaskSummary(ctx.userId, taskId, TASK_HISTORY_TOOL.RESULT_MAX_CHARS);
                    if (!s) return err(T.notFound(taskId));
                    return { text: asData([
                        T.viewHeader,
                        renderItem(s),
                        `goal: ${s.goal}`,
                        ...(s.error ? [`error: ${s.error}`] : []),
                        `tools: ${s.tools.join(', ') || '-'}`,
                        `result: ${s.result ?? '-'}`,
                    ].join('\n')) };
                }
                if (action !== 'search' && action !== 'recent') return err(T.badAction);
                const words = action === 'search'
                    ? String(args.query ?? '').split(/\s+/).filter(Boolean).slice(0, TASK_HISTORY_TOOL.MAX_QUERY_WORDS)
                    : [];
                if (action === 'search' && words.length === 0) return err(T.needQuery);
                const asked = Math.trunc(Number(args.limit));
                const limit = Math.min(TASK_HISTORY_TOOL.MAX_LIMIT, asked > 0 ? asked : TASK_HISTORY_TOOL.DEFAULT_LIMIT);
                const items = await store().searchTasks(ctx.userId, words, { limit, excludeTaskId: currentTaskId });
                return { text: items.length === 0 ? T.empty : asData([T.listHeader(items.length), ...items.map(renderItem)].join('\n')) };
            } catch (e) {
                return err(T.failed(e instanceof Error ? e.message : String(e)));
            }
        },
    }];
}
