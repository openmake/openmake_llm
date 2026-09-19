/**
 * 도구 선택·인자 평가 (F26.2).
 *
 * - mock(CI): 운영과 같은 결정적 판정(selectTurnTools → buildExternalToolPlan)으로 "이 턴에 노출되는 도구"를 구해
 *   기대 도구 포함·금지 도구 부재를 본다. LLM 없이 프롬프트 다이어트(의도 게이트) 노출 누락·과다 회귀를 잡는다.
 * - real(nightly): ChatService 에 evalToolObserver(dryRun) 를 걸어 모델의 첫 턴 tool_calls 이름·인자를 판정한다.
 *
 * 범위 밖(mock): 토글·스킬 바인딩(DB)·사용자 MCP·이미지 첨부 프로파일로만 열리는 도구(vision·load_skill 카탈로그).
 * 라벨은 사용자 의도 기준이다 — 프리필터 출력에 맞추지 않는다(CLAUDE.md eval 원칙).
 *
 * @module evaluation/tool-selection-evaluator
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { ToolDefinition } from '../llm';
import type { CaseResult, EvaluationSummary } from './types';

const argMatcher = z.union([z.string().min(1), z.object({ regex: z.string().min(1) })]);

const caseSchema = z.object({
    id: z.string().min(1),
    query: z.string().min(1),
    role: z.enum(['user', 'admin']).optional(),
    expectedTool: z.string().min(1).optional(),
    expectedToolsAny: z.array(z.string().min(1)).min(1).optional(),
    forbiddenTools: z.array(z.string().min(1)).optional(),
    expectedArgs: z.record(z.string(), argMatcher).optional(),
    language: z.string().optional(),
    tags: z.array(z.string()).optional(),
});

const datasetSchema = z.object({
    version: z.string().min(1),
    description: z.string(),
    cases: z.array(caseSchema).min(1),
});

export type ToolSelectionCase = z.infer<typeof caseSchema>;
export type ToolSelectionDataset = z.infer<typeof datasetSchema>;
export interface ObservedToolCall { name: string; args: Record<string, unknown> }

export const DEFAULT_TOOL_SELECTION_DATASET = path.resolve(__dirname, 'golden-tool-selection.json');

export function loadToolSelectionDataset(filePath: string = DEFAULT_TOOL_SELECTION_DATASET): ToolSelectionDataset {
    const parsed = datasetSchema.safeParse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    if (!parsed.success) {
        throw new Error(`도구 선택 골든셋 검증 실패 (${filePath}):\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
    }
    const errors: string[] = [];
    const ids = new Set<string>();
    for (const c of parsed.data.cases) {
        if (ids.has(c.id)) errors.push(`${c.id}: id 중복`);
        ids.add(c.id);
        if (!c.expectedTool && !c.expectedToolsAny?.length && !c.forbiddenTools?.length) {
            errors.push(`${c.id}: expectedTool, expectedToolsAny, forbiddenTools 중 하나 필요`);
        }
        if (c.expectedArgs && !c.expectedTool) errors.push(`${c.id}: expectedArgs 는 expectedTool 과 함께`);
    }
    if (errors.length) throw new Error(`도구 선택 골든셋 의미 검증 실패:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    return parsed.data;
}

/** 내장 도구 → 채팅 경로와 같은 OpenAI 호환 정의. */
export async function builtinToolDefinitions(): Promise<ToolDefinition[]> {
    const { getBuiltInTools } = await import('../mcp/tools');
    return getBuiltInTools().map((d) => ({
        type: 'function' as const,
        function: { name: d.tool.name, description: d.tool.description ?? '', parameters: d.tool.inputSchema as ToolDefinition['function']['parameters'] },
    }));
}

/** mock 판정 입력 — 역할 필터 → 턴 선별 → 도구 계획(운영 순서 그대로, 토글·스킬·사용자 MCP 없음). */
export async function exposedToolsFor(c: ToolSelectionCase, builtIns: ToolDefinition[]): Promise<{ names: string[]; forced?: string }> {
    const { filterRestrictedTools } = await import('../services/chat-service/tool-restrictions');
    const { selectTurnTools } = await import('../services/chat-service/chat-tool-selection');
    const { buildExternalToolPlan, detectOrchestrationIntents } = await import('../services/chat-service/external-tool-plan');
    const allTools = filterRestrictedTools(builtIns, c.role ?? 'user');
    const allowedTools = selectTurnTools({ allTools, merged: [], userMcpAutoOn: [], message: c.query });
    const plan = buildExternalToolPlan({
        allowedTools,
        req: { message: c.query } as never,
        toolCalling: true,
        orchestration: detectOrchestrationIntents(c.query),
    });
    return { names: plan.tools.map((t) => t.function.name), ...(plan.forcedFirstTurnToolName ? { forced: plan.forcedFirstTurnToolName } : {}) };
}

/** PURE: 기대 인자 부분 일치 — 문자열은 대소문자 무시 포함, {regex} 는 정규식(i). */
export function matchExpectedArgs(args: Record<string, unknown>, expected: NonNullable<ToolSelectionCase['expectedArgs']>): string | null {
    for (const [key, matcher] of Object.entries(expected)) {
        const raw = args[key];
        const actual = typeof raw === 'string' ? raw : raw === undefined ? '' : JSON.stringify(raw);
        const ok = typeof matcher === 'string'
            ? actual.toLowerCase().includes(matcher.toLowerCase())
            : new RegExp(matcher.regex, 'i').test(actual);
        if (!ok) return `인자 ${key} 불일치 (실제 ${JSON.stringify(actual).slice(0, 120)})`;
    }
    return null;
}

/** PURE: mock — 노출 집합 판정. */
export function judgeExposure(c: ToolSelectionCase, exposed: string[]): string | null {
    const set = new Set(exposed);
    if (c.expectedTool && !set.has(c.expectedTool)) return `기대 도구 미노출: ${c.expectedTool}`;
    if (c.expectedToolsAny?.length && !c.expectedToolsAny.some((t) => set.has(t))) return `기대 도구 후보 전부 미노출: ${c.expectedToolsAny.join('|')}`;
    const leaked = (c.forbiddenTools ?? []).filter((t) => set.has(t));
    if (leaked.length) return `금지 도구 노출: ${leaked.join(', ')}`;
    return null;
}

/** PURE: real — 첫 턴 호출 판정. 기대 도구가 첫 배치에 있어야 하고, 금지 도구는 호출되면 안 된다. */
export function judgeObservedCalls(c: ToolSelectionCase, calls: ObservedToolCall[]): string | null {
    const names = calls.map((x) => x.name);
    if (c.expectedTool) {
        const hit = calls.find((x) => x.name === c.expectedTool);
        if (!hit) return `기대 도구 미호출: ${c.expectedTool} (실제 ${names.join(',') || '없음'})`;
        if (c.expectedArgs) {
            const argErr = matchExpectedArgs(hit.args, c.expectedArgs);
            if (argErr) return argErr;
        }
    }
    if (c.expectedToolsAny?.length && !names.some((n) => c.expectedToolsAny!.includes(n))) {
        return `기대 도구 후보 미호출: ${c.expectedToolsAny.join('|')} (실제 ${names.join(',') || '없음'})`;
    }
    const bad = names.filter((n) => (c.forbiddenTools ?? []).includes(n));
    if (bad.length) return `금지 도구 호출: ${bad.join(', ')}`;
    return null;
}

export type ToolCallObserverRunner = (c: ToolSelectionCase) => Promise<ObservedToolCall[]>;

export async function runToolSelectionEvaluation(
    dataset: ToolSelectionDataset,
    opts: { mode: 'mock' } | { mode: 'real'; observe: ToolCallObserverRunner },
): Promise<EvaluationSummary> {
    const startedAt = new Date().toISOString();
    const builtIns = opts.mode === 'mock' ? await builtinToolDefinitions() : [];
    const results: CaseResult[] = [];
    for (const c of dataset.cases) {
        const t0 = Date.now();
        try {
            if (opts.mode === 'mock') {
                const exposure = await exposedToolsFor(c, builtIns);
                const reason = judgeExposure(c, exposure.names);
                results.push({ caseId: c.id, category: 'tool-selection', passed: !reason, ...(reason ? { failureReason: reason } : {}), actual: exposure, durationMs: Date.now() - t0 });
            } else {
                const calls = await opts.observe(c);
                const reason = judgeObservedCalls(c, calls);
                results.push({ caseId: c.id, category: 'tool-selection', passed: !reason, ...(reason ? { failureReason: reason } : {}), actual: { calls }, durationMs: Date.now() - t0 });
            }
        } catch (e) {
            results.push({ caseId: c.id, category: 'tool-selection', passed: false, failureReason: `실행 오류: ${e instanceof Error ? e.message : String(e)}`, durationMs: Date.now() - t0 });
        }
    }
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    return {
        datasetVersion: dataset.version,
        startedAt,
        completedAt: new Date().toISOString(),
        totalCases: total,
        passedCases: passed,
        failedCases: total - passed,
        passRate: total ? passed / total : 0,
        passRateByCategory: { 'tool-selection': { total, passed, rate: total ? passed / total : 0 } },
        avgDurationMs: total ? results.reduce((n, r) => n + r.durationMs, 0) / total : 0,
        results,
    };
}
