/**
 * 플래닝 도구(G3) — plan_create / plan_update / plan_view. tools.ts 에서 분리(600줄 가드,
 * Execution Graph 증분 4 에서 노드 속성이 늘어남).
 *
 * 노드 속성(증분 4, 2026-09-16): `done_when`(완료 기준 — goal judge 가 노드 단위로 대조)과
 * `after`(선행 노드 — 자동 승격은 선행이 끝난 노드만). 전면 DAG 는 08-05 실측으로 반려됐고, 이 둘은
 * 08-27 측정에서 드러난 "노드 마킹 고착·완료 판정 근거 부재"를 겨냥한 최소 속성이다.
 *
 * @module services/task-sandbox/tools-plan
 */
import type { MCPToolDefinition, MCPToolResult } from '../../mcp/types';
import { TaskPlan, type PlanStepStatus } from './planning';

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}
function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

const VALID_STATUS = new Set(['not_started', 'in_progress', 'completed', 'blocked']);

export function createPlanTools(plan: TaskPlan): MCPToolDefinition[] {
    const planCreate: MCPToolDefinition = {
        tool: {
            name: 'plan_create',
            description: '작업을 시작할 때 단계별 실행 계획을 세웁니다. steps 는 문자열 또는 {text, done_when, after} 객체의 배열. ' +
                'done_when 은 그 단계가 끝났음을 확인할 수 있는 조건(예: "tests/ 의 테스트가 통과"), after 는 먼저 끝나야 하는 단계 번호. ' +
                '복잡한 작업은 먼저 이 도구로 계획하고, 진행하며 plan_update 로 상태를 갱신하세요.',
            inputSchema: {
                type: 'object',
                properties: {
                    steps: {
                        type: 'array',
                        minItems: 1,
                        description: '단계 배열(최소 1개). 문자열 또는 {"text":"…","done_when":"…","after":[1]}',
                        items: {
                            anyOf: [
                                { type: 'string' },
                                {
                                    type: 'object',
                                    properties: {
                                        text: { type: 'string', description: '단계 설명' },
                                        done_when: { type: 'string', description: '완료 기준(검증 가능한 조건)' },
                                        after: { type: 'array', items: { type: 'number' }, description: '선행 단계 번호(1부터)' },
                                    },
                                    required: ['text'],
                                },
                            ],
                        },
                    },
                },
                required: ['steps'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            // 단일 문자열을 넘기는 흔한 실수는 배열로 감싼다(계약 유지 — 값을 버리지 않음).
            const steps = Array.isArray(args.steps)
                ? args.steps
                : (typeof args.steps === 'string' && args.steps.trim() ? [args.steps] : null);
            if (!steps || steps.length === 0) {
                // 빈 배열을 "배열이 필요하다"고 되돌려주면 모델은 배열을 보냈다고 여겨 같은 호출을
                // 반복한다(라이브: 한 작업에서 62회). 무엇이 잘못됐는지 그대로 말한다.
                return textResult(Array.isArray(args.steps)
                    ? 'steps 가 빈 배열입니다 — 실제 단계를 최소 1개 넣으세요. '
                        + '예: {"steps":["자료 조사",{"text":"초안 작성","done_when":"draft.md 존재","after":[1]}]}. 계획 없이 진행하려면 이 도구를 부르지 말고 바로 작업하세요.'
                    : 'steps 배열이 필요합니다 — 예: {"steps":["자료 조사","초안 작성","검토"]}.', true);
            }
            plan.create(steps as Parameters<TaskPlan['create']>[0]);
            if (plan.length === 0) return textResult('steps 에 유효한 단계가 없습니다 — text 가 비어 있지 않은 항목을 넣으세요.', true);
            return textResult(plan.render());
        },
    };

    const planUpdate: MCPToolDefinition = {
        tool: {
            name: 'plan_update',
            description: '계획 단계의 상태를 갱신합니다. step(1-based) + status(not_started|in_progress|completed|blocked).',
            inputSchema: {
                type: 'object',
                properties: {
                    step: { type: 'number', description: '단계 번호(1부터)' },
                    status: { type: 'string', description: 'not_started | in_progress | completed | blocked' },
                    note: { type: 'string', description: '메모(선택)' },
                },
                required: ['step', 'status'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            const status = str(args.status);
            if (!VALID_STATUS.has(status)) return textResult(`status 는 ${[...VALID_STATUS].join('|')} 여야 합니다.`, true);
            const stepNo = Number(args.step);
            const ok = plan.update(stepNo, status as PlanStepStatus, args.note !== undefined ? str(args.note) : undefined);
            if (!ok) {
                return textResult(
                    plan.length === 0
                        ? '아직 계획이 없습니다 — 먼저 plan_create 로 단계를 세우세요.'
                        : `단계 ${args.step} 가 범위를 벗어났습니다 — 현재 계획은 ${plan.length}단계입니다`
                          + `(유효 step: 1..${plan.length}). plan_view 로 계획을 확인하세요.`,
                    true,
                );
            }
            // 선행 미완료 경고 — 차단하지 않는다(모델의 명시 마킹 우선). 순서를 모른 채 넘어가는 것만 막는다.
            const unmet = status === 'in_progress' || status === 'completed' ? plan.unmetDeps(stepNo) : [];
            const warn = unmet.length > 0 ? `\n⚠️ 단계 ${stepNo} 의 선행 단계 ${unmet.join(', ')} 가 아직 완료되지 않았습니다.` : '';
            return textResult(plan.render() + warn);
        },
    };

    const planView: MCPToolDefinition = {
        tool: {
            name: 'plan_view',
            description: '현재 실행 계획과 각 단계 상태·완료 기준을 봅니다.',
            inputSchema: { type: 'object', properties: {} },
        },
        handler: async (): Promise<MCPToolResult> => textResult(plan.render()),
    };

    return [planCreate, planUpdate, planView];
}
