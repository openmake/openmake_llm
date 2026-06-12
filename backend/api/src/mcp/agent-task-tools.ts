/**
 * ============================================================
 * Agent Task Tools — 채팅 AI 가 에이전트 작업 결과를 조회하는 내장 도구
 * ============================================================
 *
 * 사용자가 채팅에서 "에이전트 작업 결과 보여줘 / html 미리보기로 보여줘" 처럼
 * 요청하면, 채팅 모델이 이 도구로 본인 작업 목록·결과물(아티팩트)을 읽어
 * 답변하거나 <artifact> 태그로 재출력해 아티팩트 패널 미리보기를 띄울 수 있다.
 *
 * @security 본인 작업만 조회 가능 (context.userId 와 task.user_id 일치 검증).
 *           읽기 전용 — 생성/수정/삭제 없음.
 *
 * @module mcp/agent-task-tools
 */
import { MCPToolDefinition, MCPToolResult } from './types';
import { getUnifiedDatabase } from '../data/models/unified-database';

/** 아티팩트 content 응답 상한 — 채팅 컨텍스트 폭주 방지 */
const MAX_ARTIFACT_CONTENT_CHARS = 100_000;

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}

export const agentTaskListTool: MCPToolDefinition = {
    tool: {
        name: 'agent_task_list',
        description:
            '현재 사용자의 에이전트 작업(백그라운드 자율 작업) 목록을 조회합니다. ' +
            '각 작업의 id, 목표, 상태(completed/failed/running 등), 생성 시각을 반환합니다. ' +
            '사용자가 "에이전트 작업 결과/목록 보여줘"라고 하면 이 도구를 사용하세요.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: '최대 개수 (기본 10, 최대 30)' },
            },
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const userId = context?.userId ? String(context.userId) : null;
        if (!userId) return textResult('로그인된 사용자만 에이전트 작업을 조회할 수 있습니다.', true);
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30);
        const db = getUnifiedDatabase();
        const tasks = await db.getUserAgentTasks(userId);
        const rows = tasks.slice(0, limit).map((t) => ({
            id: t.id,
            goal: t.goal,
            status: t.status,
            progress: t.progress,
            created_at: t.created_at,
        }));
        return textResult(JSON.stringify({ total: tasks.length, tasks: rows }));
    },
};

export const agentTaskGetTool: MCPToolDefinition = {
    tool: {
        name: 'agent_task_get',
        description:
            '에이전트 작업 1건의 결과를 조회합니다 — 결과 요약(result)과 결과물 아티팩트 메타 포함. ' +
            '사용자가 특정 작업의 결과물(예: 생성된 HTML/보고서)을 보여달라고 하면 agent_task_list 로 작업 id 를 찾아 이 도구를 호출하세요. ' +
            '아티팩트 본문은 사용자 화면의 미리보기 패널에 자동으로 표시되므로, 본문을 답변에 다시 출력하지 말고 ' +
            '무엇이 표시되었는지 한두 문장으로만 안내하세요. task_id 는 앞 8자리만 입력해도 됩니다.',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'string', description: '조회할 작업 id (agent_task_list 의 id, 앞 8자리 prefix 허용)' },
            },
            required: ['task_id'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const userId = context?.userId ? String(context.userId) : null;
        if (!userId) return textResult('로그인된 사용자만 에이전트 작업을 조회할 수 있습니다.', true);
        const taskId = String(args.task_id || '').replace(/\.+$/, '').trim();
        if (!taskId) return textResult('task_id 가 필요합니다.', true);

        const db = getUnifiedDatabase();
        let task = await db.getAgentTask(taskId);
        // prefix 매칭 허용 — 모델이 목록의 축약 id("36170180...")를 그대로 넘기는 경우 대응
        if (!task && taskId.length >= 6) {
            const candidates = await db.getUserAgentTasks(userId);
            const matched = candidates.filter((t) => String(t.id).startsWith(taskId));
            if (matched.length === 1) task = await db.getAgentTask(String(matched[0]!.id));
        }
        if (!task || String(task.user_id) !== userId) {
            return textResult('작업을 찾을 수 없습니다 (본인 작업만 조회 가능).', true);
        }

        const steps = await db.getAgentTaskSteps(String(task.id));
        const artifacts = steps
            .filter((s) => s.step_type === 'artifact' && s.content)
            .map((s) => {
                try {
                    const a = JSON.parse(s.content as string) as { id?: string; kind?: string; title?: string; lang?: string; content?: string };
                    const content = String(a.content ?? '');
                    return {
                        id: a.id || 'agent-task-artifact',
                        kind: a.kind || 'markdown',
                        title: a.title || '결과물',
                        lang: a.lang,
                        content: content.length > MAX_ARTIFACT_CONTENT_CHARS
                            ? content.slice(0, MAX_ARTIFACT_CONTENT_CHARS) + '\n... (이하 생략)'
                            : content,
                    };
                } catch {
                    return null;
                }
            })
            .filter((a): a is NonNullable<typeof a> => a !== null);

        // 아티팩트 본문은 resource 로 반환 — 채팅 경로의 mcp_tool_result 채널을 타고
        // 프론트 아티팩트 패널에 즉시 렌더된다 (모델 재출력 불필요·결정적).
        // 모델에게는 메타만 텍스트로 제공 (본문 재출력 방지 + 컨텍스트 절약).
        const resourceContents = artifacts.map((a) => ({
            type: 'resource' as const,
            resource: {
                uri: `openmake://agent-task-artifact/${task!.id}/${a.id}`,
                mimeType: 'application/json',
                text: JSON.stringify(a),
            },
        }));

        const meta = JSON.stringify({
            id: task.id,
            goal: task.goal,
            status: task.status,
            result: task.result ?? null,
            error: task.error ?? null,
            artifacts: artifacts.map((a) => ({ id: a.id, kind: a.kind, title: a.title, chars: a.content.length })),
            note: artifacts.length > 0
                ? '아티팩트 본문은 사용자 화면의 미리보기 패널에 자동 표시되었습니다. 본문을 다시 출력하지 마세요.'
                : '이 작업에는 아티팩트 결과물이 없습니다.',
        });

        return { content: [{ type: 'text', text: meta }, ...resourceContents] };
    },
};

export const agentTaskTools: MCPToolDefinition[] = [agentTaskListTool, agentTaskGetTool];

/** 채팅에서 토글 없이 항상 제공되는 도구 이름 — ChatService.getAllowedTools 가 머지에 사용 */
export const CHAT_ALWAYS_ON_TOOL_NAMES: string[] = [agentTaskListTool.tool.name, agentTaskGetTool.tool.name];
