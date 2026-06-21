/**
 * ============================================================
 * Plan Mode Planner (P-3)
 * ============================================================
 *
 * 읽기 전용 구현 계획 생성 코어. LLM 1-pass → 결정론 후처리(파싱·단계 정규화·
 * 상한·criticalFiles 중복제거). 후처리는 순수 함수로 분리해 LLM 없이 단위 테스트.
 *
 * @module services/plan-mode/planner
 */

import { createClient } from '../../llm';
import { LLM_TIMEOUTS } from '../../config/timeouts';
import { PLAN_MODE_CONFIG } from '../../config/plan-mode';
import { buildPlanModeSystemPrompt, buildPlanModeUserMessage } from '../../prompts/plan-mode-system';
import { createLogger } from '../../utils/logger';

const logger = createLogger('PlanMode');

export interface PlanStep {
    title: string;
    action: string;
    verify: string;
}

export interface ImplementationPlan {
    summary: string;
    steps: PlanStep[];
    criticalFiles: string[];
    risks: string[];
    openQuestions: string[];
}

/** LLM raw 출력에서 계획 JSON 을 관대하게 파싱 (코드펜스/머리말 허용) */
export function parsePlan(raw: string): Record<string, unknown> {
    if (!raw || !raw.trim()) return {};
    let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return {};
    text = text.slice(start, end + 1);
    try {
        const obj = JSON.parse(text);
        return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function asString(v: unknown, max: number): string {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** 문자열 배열 정규화 — 비문자/공백 제거, 트림, 중복제거, 상한 */
function normalizeStringList(v: unknown, max: number): string[] {
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of v) {
        const s = typeof item === 'string' ? item.trim().slice(0, 300) : '';
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
        if (out.length >= max) break;
    }
    return out;
}

/**
 * raw 계획 객체를 검증·정규화한다 (순수 함수).
 * - 각 단계는 action 이 있어야 채택(verify 비면 기본 문구 보강).
 * - steps/criticalFiles/risks/openQuestions 상한 적용.
 */
export function normalizePlan(
    raw: Record<string, unknown>,
    limits: { maxSteps: number; maxCriticalFiles: number; maxListItems: number },
): ImplementationPlan {
    const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
    const steps: PlanStep[] = [];
    for (const item of rawSteps) {
        if (!item || typeof item !== 'object') continue;
        const s = item as Record<string, unknown>;
        const action = asString(s.action, 1000);
        if (!action) continue; // action 없는 단계는 무의미 — 제외
        steps.push({
            title: asString(s.title, 200) || `단계 ${steps.length + 1}`,
            action,
            verify: asString(s.verify, 500) || '(검증 방법 미명시 — 결과 확인 필요)',
        });
        if (steps.length >= limits.maxSteps) break;
    }

    return {
        summary: asString(raw.summary, 1000),
        steps,
        criticalFiles: normalizeStringList(raw.criticalFiles, limits.maxCriticalFiles),
        risks: normalizeStringList(raw.risks, limits.maxListItems),
        openQuestions: normalizeStringList(raw.openQuestions, limits.maxListItems),
    };
}

export interface PlanInput {
    task: string;
    context?: string;
}

/** 빈 계획 (graceful fallback) */
const EMPTY_PLAN: ImplementationPlan = { summary: '', steps: [], criticalFiles: [], risks: [], openQuestions: [] };

/**
 * 구현 계획 생성 (LLM 1-pass + 결정론 후처리). 읽기 전용 — 코드 미작성/미실행.
 */
export async function createPlan(input: PlanInput): Promise<ImplementationPlan> {
    if (!input.task || !input.task.trim()) return { ...EMPTY_PLAN };

    const system = buildPlanModeSystemPrompt();
    const user = buildPlanModeUserMessage(input.task, input.context);

    const client = createClient({ timeout: LLM_TIMEOUTS.REPORT_GENERATION_TIMEOUT_MS });
    let raw = '';
    try {
        const response = await client.chat(
            [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            { temperature: PLAN_MODE_CONFIG.temperature },
            undefined,
            { format: 'json' },
        );
        raw = response.content ?? '';
    } catch (e) {
        logger.error('계획 생성 LLM 호출 실패:', e);
        return { ...EMPTY_PLAN };
    }

    return normalizePlan(parsePlan(raw), {
        maxSteps: PLAN_MODE_CONFIG.maxSteps,
        maxCriticalFiles: PLAN_MODE_CONFIG.maxCriticalFiles,
        maxListItems: PLAN_MODE_CONFIG.maxListItems,
    });
}
