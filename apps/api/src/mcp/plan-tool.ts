/**
 * ============================================================
 * create_plan MCP Tool (P-3, Plan Mode)
 * ============================================================
 *
 * 구현 전 읽기 전용 실행 계획을 생성하는 도구. 코드 작성/실행 없음.
 * planner(LLM 1-pass + 결정론 후처리) 호출 → 사람이 검토·승인 가능한 계획을 반환.
 * 승인 게이트는 채팅 흐름(계획 제시 → 사용자 승인 → 구현 요청)으로 실현된다.
 *
 * @module mcp/plan-tool
 * @see services/plan-mode/planner.ts
 */

import { MCPToolDefinition, MCPToolResult } from './types';
import { PLAN_MODE_CONFIG } from '../config/plan-mode';
import { createPlan, type ImplementationPlan } from '../services/plan-mode/planner';
import { createLogger } from '../utils/logger';

const logger = createLogger('PlanTool');

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}

function formatPlan(plan: ImplementationPlan): string {
    const lines: string[] = [];
    lines.push('## 📋 구현 계획 (검토 후 승인하면 진행합니다)');
    if (plan.summary) lines.push(`\n${plan.summary}`);

    lines.push('\n### 단계');
    plan.steps.forEach((s, i) => {
        lines.push(`${i + 1}. **${s.title}** — ${s.action}\n   - 검증: ${s.verify}`);
    });

    if (plan.criticalFiles.length > 0) {
        lines.push(`\n### 핵심 파일\n${plan.criticalFiles.map(f => `- \`${f}\``).join('\n')}`);
    }
    if (plan.risks.length > 0) {
        lines.push(`\n### 위험/주의\n${plan.risks.map(r => `- ${r}`).join('\n')}`);
    }
    if (plan.openQuestions.length > 0) {
        lines.push(`\n### 진행 전 확인 필요\n${plan.openQuestions.map(q => `- ${q}`).join('\n')}`);
    }
    lines.push('\n— 이 계획대로 진행할지 알려주세요. 수정이 필요하면 말씀해 주세요.');
    return lines.join('\n');
}

export const createPlanTool: MCPToolDefinition = {
    tool: {
        name: 'create_plan',
        description:
            '구현하기 전에 읽기 전용 "실행 계획"을 설계합니다 (단계별 작업+검증, 핵심 파일, 위험, 미해결 질문). ' +
            '사용자가 기능/리팩터링/버그수정 등을 "어떻게 구현할지 계획 세워줘", "먼저 계획부터", "plan" 처럼 요청하거나, ' +
            '복잡한 작업을 바로 코딩하기 전에 접근 방식을 정리·승인받고 싶을 때 사용하세요. ' +
            '이 도구는 코드를 작성하거나 실행하지 않습니다 — 계획만 제시하고, 사용자 승인 후 별도로 구현합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                task: { type: 'string', description: '계획을 세울 작업/기능 설명 (필수)' },
                context: { type: 'string', description: '참고할 코드/제약/요구사항 (선택)' },
            },
            required: ['task'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        if (!PLAN_MODE_CONFIG.enabled) {
            return textResult('Plan Mode 가 비활성화되어 있습니다 (PLAN_MODE_ENABLED=false).', true);
        }

        const task = typeof args.task === 'string' ? args.task.trim() : '';
        if (!task) return textResult('task 인자가 필요합니다 (계획을 세울 작업 설명).', true);

        let ctx = typeof args.context === 'string' ? args.context : undefined;
        if (ctx && Buffer.byteLength(ctx, 'utf8') > PLAN_MODE_CONFIG.maxContextBytes) {
            ctx = ctx.slice(0, PLAN_MODE_CONFIG.maxContextBytes);
        }

        const plan = await createPlan({
            task, context: ctx,
            userId: context?.userId ? String(context.userId) : undefined,
        });

        void (async () => {
            try {
                const { getAuditService } = await import('../services/AuditService');
                await getAuditService().logAudit({
                    action: 'create_plan',
                    userId: context?.userId ? String(context.userId) : undefined,
                    resourceType: 'plan',
                    details: { steps: plan.steps.length, criticalFiles: plan.criticalFiles.length },
                });
            } catch (e) {
                logger.warn(`create_plan audit 실패: ${e instanceof Error ? e.message : String(e)}`);
            }
        })();

        if (plan.steps.length === 0) {
            return textResult('계획을 생성하지 못했습니다. 작업 설명을 더 구체적으로 제공해 주세요.', true);
        }
        return textResult(formatPlan(plan));
    },
};
