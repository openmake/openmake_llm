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
            '에이전트 작업 1건의 결과를 조회합니다 — 결과 요약(result)과 결과물 아티팩트(kind/title/content 전문) 포함. ' +
            '사용자가 특정 작업의 결과물(예: 생성된 HTML/보고서)을 보여달라고 하면: ① agent_task_list 로 작업을 찾고 ' +
            '② 이 도구로 아티팩트 content 를 받아 ③ 동일한 kind 의 <artifact> 태그로 재출력해 미리보기 패널에 띄우세요.',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'string', description: '조회할 작업 id (agent_task_list 의 id)' },
            },
            required: ['task_id'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const userId = context?.userId ? String(context.userId) : null;
        if (!userId) return textResult('로그인된 사용자만 에이전트 작업을 조회할 수 있습니다.', true);
        const taskId = String(args.task_id || '');
        if (!taskId) return textResult('task_id 가 필요합니다.', true);

        const db = getUnifiedDatabase();
        const task = await db.getAgentTask(taskId);
        if (!task || String(task.user_id) !== userId) {
            return textResult('작업을 찾을 수 없습니다 (본인 작업만 조회 가능).', true);
        }

        const steps = await db.getAgentTaskSteps(taskId);
        const artifacts = steps
            .filter((s) => s.step_type === 'artifact' && s.content)
            .map((s) => {
                try {
                    const a = JSON.parse(s.content as string) as { id?: string; kind?: string; title?: string; lang?: string; content?: string };
                    const content = String(a.content ?? '');
                    return {
                        id: a.id,
                        kind: a.kind,
                        title: a.title,
                        lang: a.lang,
                        content: content.length > MAX_ARTIFACT_CONTENT_CHARS
                            ? content.slice(0, MAX_ARTIFACT_CONTENT_CHARS) + '\n... (이하 생략)'
                            : content,
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        return textResult(JSON.stringify({
            id: task.id,
            goal: task.goal,
            status: task.status,
            result: task.result ?? null,
            error: task.error ?? null,
            artifacts,
        }));
    },
};

export const agentTaskTools: MCPToolDefinition[] = [agentTaskListTool, agentTaskGetTool];

/** 채팅에서 토글 없이 항상 제공되는 도구 이름 — ChatService.getAllowedTools 가 머지에 사용 */
export const CHAT_ALWAYS_ON_TOOL_NAMES: string[] = [agentTaskListTool.tool.name, agentTaskGetTool.tool.name];
