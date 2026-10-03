/**
 * 과거 작업 검색 도구(task_history) — 에이전트 작업이 같은 사용자의 과거 작업을 검색·최근 목록·한 건 요약으로 읽는다.
 * 읽기 전용이다. 사용자 범위는 도구를 부른 작업의 소유자(ctx.userId)로만 정해지고 인자로 바꿀 수 없다.
 * 교훈 주입은 최근 N건 안에서 자동으로 고르지만, 이 도구는 모델이 필요할 때 그 밖의 작업까지 찾아본다.
 * 기본 꺼짐(AGENT_TASK_HISTORY_TOOL=true 로 켠다).
 *
 * @module services/agent-task/task-history-tool
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskHistoryRepository, type TaskHistoryItem } from '../../data/repositories/agent-task-history-repository';
import type { ContributedAgentTaskTool } from '../chat-service/turn-integrations';
import { TASK_HISTORY_TOOL } from '../../config/agent-task-skill-memory';
import { TASK_HISTORY_TOOL_TEXT as T } from '../../prompts/agent-task-skill-memory';

export const TASK_HISTORY_TOOL_NAME = 'task_history';

/** 도구가 쓰는 조회 — 저장소가 그대로 맞는다(테스트에서 교체). */
export type TaskHistoryStore = Pick<AgentTaskHistoryRepository, 'searchTasks' | 'getTaskSummary'>;

const GUEST_USER_ID = 'guest';

function renderItem(t: TaskHistoryItem): string {
    return `- id=${t.id} [${t.status}] ${new Date(t.created_at).toISOString().slice(0, 10)} (${t.current_turn}턴) ${t.goal.replace(/\s+/g, ' ')}`;
}

/**
 * [task_history] 또는 빈 배열(꺼짐). currentTaskId 는 목록에서 뺀다(지금 작업이 자기 자신을 찾지 않게).
 */
export function createTaskHistoryTools(
    currentTaskId: string,
    deps: { enabled?: boolean; store?: TaskHistoryStore } = {},
): ContributedAgentTaskTool[] {
    if (!(deps.enabled ?? TASK_HISTORY_TOOL.ENABLED)) return [];
    const store = (): TaskHistoryStore => deps.store ?? new AgentTaskHistoryRepository(getPool());
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
                    return { text: [
                        T.viewHeader,
                        renderItem(s),
                        `goal: ${s.goal}`,
                        ...(s.error ? [`error: ${s.error}`] : []),
                        `tools: ${s.tools.join(', ') || '-'}`,
                        `result: ${s.result ?? '-'}`,
                    ].join('\n') };
                }
                if (action !== 'search' && action !== 'recent') return err(T.badAction);
                const words = action === 'search'
                    ? String(args.query ?? '').split(/\s+/).filter(Boolean).slice(0, TASK_HISTORY_TOOL.MAX_QUERY_WORDS)
                    : [];
                if (action === 'search' && words.length === 0) return err(T.needQuery);
                const asked = Math.trunc(Number(args.limit));
                const limit = Math.min(TASK_HISTORY_TOOL.MAX_LIMIT, asked > 0 ? asked : TASK_HISTORY_TOOL.DEFAULT_LIMIT);
                const items = await store().searchTasks(ctx.userId, words, { limit, excludeTaskId: currentTaskId });
                return { text: items.length === 0 ? T.empty : [T.listHeader(items.length), ...items.map(renderItem)].join('\n') };
            } catch (e) {
                return err(T.failed(e instanceof Error ? e.message : String(e)));
            }
        },
    }];
}
